/**
 * Possible-duplicate detection + "nearby similar reports" lookup.
 * Heuristic: within DUPLICATE_RADIUS_METERS and DUPLICATE_WINDOW_HOURS,
 * an existing OPEN report of the same category is considered a likely duplicate.
 * Uses the Haversine formula for distance; a cheap lat/lng bounding box is
 * applied first in SQL so we don't scan the whole table.
 */
const { query } = require('../db');

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * @returns {Promise<{isDuplicate: boolean, duplicateOfReportId: string|null}>}
 */
async function findPossibleDuplicate(latitude, longitude, category) {
  const radiusMeters = Number(process.env.DUPLICATE_RADIUS_METERS || 40);
  const windowHours = Number(process.env.DUPLICATE_WINDOW_HOURS || 72);

  // Rough bounding box (~1 degree lat ~= 111km) to pre-filter in SQL cheaply.
  const degreeDelta = radiusMeters / 111000;

  const { rows } = await query(
    `SELECT report_id, latitude, longitude
     FROM reports
     WHERE category = $1
       AND status NOT IN ('resolved', 'rejected', 'duplicate')
       AND created_at >= now() - ($2 || ' hours')::interval
       AND latitude BETWEEN $3 AND $4
       AND longitude BETWEEN $5 AND $6
     ORDER BY created_at DESC
     LIMIT 50`,
    [
      category,
      windowHours,
      latitude - degreeDelta,
      latitude + degreeDelta,
      longitude - degreeDelta,
      longitude + degreeDelta,
    ]
  );

  for (const row of rows) {
    const dist = haversineMeters(latitude, longitude, row.latitude, row.longitude);
    if (dist <= radiusMeters) {
      return { isDuplicate: true, duplicateOfReportId: row.report_id };
    }
  }

  return { isDuplicate: false, duplicateOfReportId: null };
}

/**
 * Nearby reports lookup for the citizen-facing "transparency" feature:
 * "N similar issues already reported near this location" — shown right after
 * submission, regardless of category, so citizens see the community context.
 * Wider radius than duplicate detection and not restricted to open reports,
 * so resolved history counts too (proves the system follows through).
 *
 * @returns {Promise<Array<{report_id, tracking_code, category, status, severity, created_at, distance_m}>>}
 */
async function findNearbyReports(latitude, longitude, { excludeReportId, radiusMeters = 150, limit = 5 } = {}) {
  const degreeDelta = radiusMeters / 111000;

  const { rows } = await query(
    `SELECT report_id, tracking_code, category, status, severity, description, created_at, latitude, longitude
     FROM reports
     WHERE latitude BETWEEN $1 AND $2
       AND longitude BETWEEN $3 AND $4
       ${excludeReportId ? 'AND report_id <> $5' : ''}
     ORDER BY created_at DESC
     LIMIT 100`,
    excludeReportId
      ? [latitude - degreeDelta, latitude + degreeDelta, longitude - degreeDelta, longitude + degreeDelta, excludeReportId]
      : [latitude - degreeDelta, latitude + degreeDelta, longitude - degreeDelta, longitude + degreeDelta]
  );

  return rows
    .map((row) => ({
      ...row,
      distance_m: Math.round(haversineMeters(latitude, longitude, row.latitude, row.longitude)),
    }))
    .filter((row) => row.distance_m <= radiusMeters)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

module.exports = { findPossibleDuplicate, findNearbyReports, haversineMeters };
