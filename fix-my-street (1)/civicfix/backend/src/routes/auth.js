const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const router = express.Router();

// POST /api/auth/login  -- municipal employee login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await query('SELECT * FROM employees WHERE email = $1', [email.toLowerCase()]);
    const employee = rows[0];
    if (!employee) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, employee.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        employeeId: employee.employee_id,
        email: employee.email,
        role: employee.role,
        department: employee.department,
        name: employee.name,
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      employee: {
        employeeId: employee.employee_id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/register -- admin-only creation of new municipal staff accounts
const { requireAuth, requireRole } = require('../middleware/auth');
router.post('/register', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, department, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO employees (name, email, password_hash, department, role)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'staff'))
       RETURNING employee_id, name, email, department, role, created_at`,
      [name, email.toLowerCase(), password_hash, department || null, role || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An employee with this email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to register employee' });
  }
});

module.exports = router;
