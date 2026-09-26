/**
 * Maps an AI-classified category (+ severity) to the municipal department
 * responsible for handling it. Kept as a pure function so it's trivial to
 * unit test and to override later with a config table if needed.
 */

const CATEGORY_TO_DEPARTMENT = {
  pothole: 'roads_and_transportation',
  road_obstruction: 'roads_and_transportation',
  broken_streetlight: 'street_lighting',
  damaged_sidewalk: 'sidewalks_and_accessibility',
  blocked_accessibility_ramp: 'sidewalks_and_accessibility',
  damaged_sign: 'signage',
  overflowing_garbage_bin: 'sanitation',
  unknown: 'public_works_general',
};

function assignDepartment(category) {
  return CATEGORY_TO_DEPARTMENT[category] || 'public_works_general';
}

module.exports = { assignDepartment, CATEGORY_TO_DEPARTMENT };
