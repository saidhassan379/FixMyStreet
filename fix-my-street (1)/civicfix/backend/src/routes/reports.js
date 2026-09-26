const express = require('express');
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { upload, uploadDir } = require('../middleware/upload');
const { requireAuth } = require('../middleware/auth');
const { classifyPhoto } = require('../services/gemini');
const { assignDepartment } = require('../services/department');
const { findPossibleDuplicate, findNearbyReports } = require('../services/duplicate');
const { generateTrackingCode } = require('../utils/trackingCode');

const router = express.Router();

const VALID_STATUSES = [
  'submitted',
  'under_review',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
  'duplicate',
];

/**
 * POST /api/reports
 * Citizen submits a new infrastructure report.
 * multipart/form-data: photo (file), latitude, longitude, description, reporter_name?, reporter_contact?
 */
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A photo is required' });
    }
    const { latitude, longitude, description, reporter_name, reporter_contact } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }

    // 1. Classify photo with Gemini
    let classification;
    try {
      classification = await classifyPhoto(req.file.path, description);
    } catch (aiErr) {
      console.error('Gemini classification failed:', aiErr.message);
      // Fail-safe: still store the report so the citizen isn't blocked by an AI outage.
      classification = {
        category: 'unknown',
        confidence: 0,
        severity: 'medium',
        safety_risk: false,
        safety_risk_reason: '',
        short_summary: '',
        raw: { error: aiErr.message },
      };
    }

    // 2. Assign department based on category
    const department = assignDepartment(classification.category);

    // 3. Possible-duplicate check (same category, nearby, recent, still open)
    const dup = await findPossibleDuplicate(lat, lng, classification.category);

    // 4. Persist
    const trackingCode = generateTrackingCode();
    const photoUrl = `/uploads/${path.basename(req.file.path)}`;

    const { rows } = await query(
      `INSERT INTO reports (
         tracking_code, photo_url, latitude, longitude, description, category,
         confidence, severity, safety_risk, safety_risk_reason, possible_duplicate,
         duplicate_of_report_id, department, status, reporter_name, reporter_contact, ai_raw_response
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        trackingCode,
        photoUrl,
        lat,
        lng,
        description || null,
        classification.category,
        classification.confidence,
        classification.severity,
        classification.safety_risk,
        classification.safety_risk_reason,
        dup.isDuplicate,
        dup.duplicateOfReportId,
        department,
        dup.isDuplicate ? 'under_review' : 'submitted',
        reporter_name || null,
        reporter_contact || null,
        JSON.stringify(classification.raw),
      ]
    );

    // 5. Nearby reports (transparency feature) — shown to the citizen right after
    // submitting, regardless of category, so they immediately see community context.
    const nearby = await findNearbyReports(lat, lng, { excludeReportId: rows[0].report_id });

    res.status(201).json({
      report: rows[0],
      ai_summary: classification.short_summary,
      nearby_reports: nearby,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

/**
 * GET /api/reports/track/:trackingCode
 * Public: citizen tracking page lookup (no auth).
 */
router.get('/track/:trackingCode', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM reports WHERE tracking_code = $1', [
      req.params.trackingCode.toUpperCase(),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Report not found' });

    const history = await query(
      'SELECT * FROM status_history WHERE report_id = $1 ORDER BY created_at ASC',
      [rows[0].report_id]
    );
    const nearby = await findNearbyReports(rows[0].latitude, rows[0].longitude, {
      excludeReportId: rows[0].report_id,
    });
    res.json({ report: rows[0], history: history.rows, nearby_reports: nearby });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * GET /api/reports
 * Municipal dashboard: list + filter reports. Auth required.
 * Query params: status, department, category, severity, safety_risk, page, pageSize, q
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      status, department, category, severity, safety_risk,
      page = 1, pageSize = 25, q,
    } = req.query;

    const conditions = [];
    const params = [];
    let i = 1;

    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    if (department) { conditions.push(`department = $${i++}`); params.push(department); }
    if (category) { conditions.push(`category = $${i++}`); params.push(category); }
    if (severity) { conditions.push(`severity = $${i++}`); params.push(severity); }
    if (safety_risk !== undefined) { conditions.push(`safety_risk = $${i++}`); params.push(safety_risk === 'true'); }
    if (q) { conditions.push(`(description ILIKE $${i} OR tracking_code ILIKE $${i})`); params.push(`%${q}%`); i++; }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Number(pageSize) || 25, 100);
    const offset = (Math.max(Number(page), 1) - 1) * limit;

    const listQuery = `
      SELECT * FROM reports
      ${whereClause}
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);

    const countQuery = `SELECT COUNT(*) FROM reports ${whereClause}`;

    const [listRes, countRes] = await Promise.all([
      query(listQuery, params),
      query(countQuery, params.slice(0, params.length - 2)),
    ]);

    res.json({
      reports: listRes.rows,
      total: Number(countRes.rows[0].count),
      page: Number(page),
      pageSize: limit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET /api/reports/stats
 * Dashboard summary counters.
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'submitted') AS submitted,
        COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
        COUNT(*) FILTER (WHERE status = 'assigned') AS assigned,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'duplicate') AS duplicate,
        COUNT(*) FILTER (WHERE safety_risk = true AND status NOT IN ('resolved','rejected','duplicate')) AS open_safety_risks
      FROM reports
    `);
    const byDept = await query(`
      SELECT department, COUNT(*) AS count
      FROM reports
      WHERE status NOT IN ('resolved','rejected','duplicate')
      GROUP BY department
      ORDER BY count DESC
    `);
    res.json({ totals: rows[0], open_by_department: byDept.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/reports/:reportId
 * Municipal detail view including full timeline.
 */
router.get('/:reportId', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM reports WHERE report_id = $1', [req.params.reportId]);
    if (!rows[0]) return res.status(404).json({ error: 'Report not found' });

    const history = await query(
      'SELECT * FROM status_history WHERE report_id = $1 ORDER BY created_at ASC',
      [req.params.reportId]
    );
    res.json({ report: rows[0], history: history.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * PATCH /api/reports/:reportId/status
 * Municipal employee updates status (and optionally department/severity), leaves a note.
 * Body: { status, note?, department? }
 */
router.patch('/:reportId/status', requireAuth, async (req, res) => {
  try {
    const { status, note, department } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const { rows } = await query('SELECT * FROM reports WHERE report_id = $1', [req.params.reportId]);
    if (!rows[0]) return res.status(404).json({ error: 'Report not found' });

    const updateFields = ['status = $1'];
    const params = [status];
    let i = 2;
    if (department) {
      updateFields.push(`department = $${i++}`);
      params.push(department);
    }
    params.push(req.params.reportId);

    const updated = await query(
      `UPDATE reports SET ${updateFields.join(', ')} WHERE report_id = $${i} RETURNING *`,
      params
    );

    await query(
      `INSERT INTO status_history (report_id, status, note, changed_by_employee_id, changed_by_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.reportId, status, note || null, req.employee.employeeId, req.employee.name]
    );

    res.json({ report: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
