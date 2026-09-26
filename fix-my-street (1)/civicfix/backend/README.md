# CivicFix — Backend

Node.js + Express API for the CivicFix infrastructure reporting system.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL and GEMINI_API_KEY
npm run migrate        # creates tables + seeds an admin account
npm run dev             # or: npm start
```

The API listens on `PORT` (default `4000`). Uploaded photos are served from `/uploads/...` and stored in the folder named by `UPLOAD_DIR`.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `GEMINI_API_KEY`, `JWT_SECRET`.

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/reports` | none | Citizen submits a report (`multipart/form-data`: `photo`, `latitude`, `longitude`, `description`, `reporter_name?`, `reporter_contact?`) |
| GET | `/api/reports/track/:trackingCode` | none | Citizen tracking page lookup |
| GET | `/api/reports` | employee | List/filter reports (`status`, `department`, `category`, `severity`, `safety_risk`, `q`, `page`, `pageSize`) |
| GET | `/api/reports/stats` | employee | Dashboard summary counters |
| GET | `/api/reports/:reportId` | employee | Full report + timeline |
| PATCH | `/api/reports/:reportId/status` | employee | Update status/department, appends a timeline entry |
| POST | `/api/auth/login` | none | Employee login → JWT |
| POST | `/api/auth/register` | admin | Create new employee account |
| GET | `/api/health` | none | Liveness check |

## How a report is processed

1. Citizen uploads a photo + GPS coordinates (+ optional description) via `POST /api/reports`.
2. The photo is saved via Multer, then sent to **Gemini** (`services/gemini.js`) which returns a strict JSON classification: `category`, `confidence`, `severity`, `safety_risk`, `safety_risk_reason`, `short_summary`.
3. `services/department.js` maps the category to a responsible department.
4. `services/duplicate.js` checks for an open report of the same category within ~40m and 72h (Haversine distance) and flags `possible_duplicate`.
5. The report row is inserted; a DB trigger writes the first `status_history` row automatically.
6. A short public `tracking_code` (e.g. `CF-8X3K9Q`) is returned to the citizen for tracking.
7. Municipal staff use the dashboard (JWT-authenticated) to list, filter, and `PATCH` status — every change appends to `status_history`, which is the timeline citizens and staff both see.

## Database

Schema lives in `src/schema.sql` — run automatically by `npm run migrate`, or manually:

```bash
psql "$DATABASE_URL" -f src/schema.sql
```
