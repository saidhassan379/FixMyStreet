/**
 * Applies schema.sql and seeds a default admin employee if none exists.
 * Usage: node src/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { query, pool } = require('./db');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema...');
  await query(sql);
  console.log('Schema applied.');

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@civicfix.local').toLowerCase();
  const { rows } = await query('SELECT 1 FROM employees WHERE email = $1', [email]);

  if (!rows[0]) {
    const password = process.env.SEED_ADMIN_PASSWORD || 'change_me_now';
    const hash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO employees (name, email, password_hash, role, department)
       VALUES ($1, $2, $3, 'admin', 'public_works_general')`,
      ['CivicFix Admin', email, hash]
    );
    console.log(`Seeded admin account: ${email} (change the password after first login)`);
  } else {
    console.log('Admin account already exists, skipping seed.');
  }

  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
