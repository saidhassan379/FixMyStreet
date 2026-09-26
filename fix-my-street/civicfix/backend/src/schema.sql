-- CivicFix PostgreSQL schema
-- Run with: psql "$DATABASE_URL" -f src/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Category enum used by Gemini classification
DO $$ BEGIN
  CREATE TYPE report_category AS ENUM (
    'pothole',
    'broken_streetlight',
    'damaged_sidewalk',
    'blocked_accessibility_ramp',
    'damaged_sign',
    'overflowing_garbage_bin',
    'road_obstruction',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM (
    'submitted',
    'under_review',
    'assigned',
    'in_progress',
    'resolved',
    'rejected',
    'duplicate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE department_name AS ENUM (
    'roads_and_transportation',
    'street_lighting',
    'sidewalks_and_accessibility',
    'signage',
    'sanitation',
    'public_works_general'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Municipal employees / admins who can update reports
CREATE TABLE IF NOT EXISTS employees (
  employee_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  department department_name,
  role VARCHAR(30) NOT NULL DEFAULT 'staff', -- staff | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Main reports table
CREATE TABLE IF NOT EXISTS reports (
  report_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_code VARCHAR(12) UNIQUE NOT NULL, -- short public code e.g. CF-8X3K9Q
  photo_url TEXT NOT NULL,
  photo_thumb_url TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  address_text TEXT,
  description TEXT,
  category report_category NOT NULL DEFAULT 'unknown',
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0, -- 0.0000 - 1.0000 from Gemini
  severity report_severity NOT NULL DEFAULT 'medium',
  safety_risk BOOLEAN NOT NULL DEFAULT FALSE,
  safety_risk_reason TEXT,
  possible_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_report_id UUID REFERENCES reports(report_id),
  department department_name NOT NULL DEFAULT 'public_works_general',
  status report_status NOT NULL DEFAULT 'submitted',
  reporter_name VARCHAR(120),
  reporter_contact VARCHAR(180),
  ai_raw_response JSONB, -- full Gemini response for audit/debug
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_department ON reports(department);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
-- Spatial-ish index for cheap distance pre-filtering (bounding box scans)
CREATE INDEX IF NOT EXISTS idx_reports_lat_lng ON reports(latitude, longitude);

-- Status history / timeline (append-only, drives "view history timeline")
CREATE TABLE IF NOT EXISTS status_history (
  history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  status report_status NOT NULL,
  note TEXT,
  changed_by_employee_id UUID REFERENCES employees(employee_id),
  changed_by_name VARCHAR(120), -- denormalized for display even if employee later removed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_report_id ON status_history(report_id);

-- Trigger: keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Trigger: auto-insert initial history row when a report is created
CREATE OR REPLACE FUNCTION insert_initial_history() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO status_history (report_id, status, note, changed_by_name)
  VALUES (NEW.report_id, NEW.status, 'Report submitted by citizen', 'System');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_initial_history ON reports;
CREATE TRIGGER trg_reports_initial_history
  AFTER INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION insert_initial_history();
