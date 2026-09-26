require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const reportsRouter = require('./routes/reports');
const authRouter = require('./routes/auth');
const { uploadDir } = require('./middleware/upload');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Same-origin by default (frontend + dashboard are served by this process on Replit),
// but CORS stays open so the static apps can also be hosted separately if you split them out.
const allowedOrigins = [process.env.FRONTEND_ORIGIN, process.env.DASHBOARD_ORIGIN].filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded photos statically
app.use('/uploads', express.static(path.resolve(uploadDir)));

// Rate limit report submissions to deter abuse
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports submitted from this network. Please try again later.' },
});
app.use('/api/reports', (req, res, next) => {
  if (req.method === 'POST') return submitLimiter(req, res, next);
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'fix-my-street-backend' }));

app.use('/api/reports', reportsRouter);
app.use('/api/auth', authRouter);

// Serve the citizen app and municipal dashboard from this same process —
// simplest possible setup for a single Replit container running one server.
app.use(express.static(path.resolve(__dirname, '../../frontend')));
app.use('/admin', express.static(path.resolve(__dirname, '../../dashboard')));

app.get('/admin', (req, res) => res.sendFile(path.resolve(__dirname, '../../dashboard/index.html')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler (catches multer errors etc.)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message && err.message.includes('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Photo is too large.' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Fix My Street server listening on port ${PORT}`);
});
