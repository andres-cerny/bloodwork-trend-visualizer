-- One practice's database. Applied identically to both tenant D1s;
-- isolation is by database, not by column, so a query cannot forget a
-- WHERE tenant clause that never exists.
--
-- reports.payload is the source of truth: the full LabReport JSON exactly as
-- lab-core produced it, bbox and snippets included. The measurements and
-- summary tables are DERIVED INDEXES rebuilt by the seeder — they exist so
-- SQL can filter (find, cohort) what lab-core already computed, and they must
-- never be written by anything but the seeder. If a number in an answer could
-- only have come from one of these tables and not from a payload, something
-- has gone wrong with the layering.

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,       -- stable ref, e.g. "p-novak-1988"
  full_name  TEXT NOT NULL,
  name_norm  TEXT NOT NULL,          -- lowercased, diacritics stripped, single spaces
  birth_date TEXT NOT NULL,          -- ISO YYYY-MM-DD
  sex        TEXT NOT NULL CHECK (sex IN ('m', 'f')),
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients (name_norm);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  patient_id  TEXT NOT NULL REFERENCES patients (id),
  report_date TEXT NOT NULL,
  lab_name    TEXT NOT NULL,
  payload     TEXT NOT NULL          -- full LabReport JSON, lossless
);
CREATE INDEX IF NOT EXISTS idx_reports_patient ON reports (patient_id, report_date);

-- Derived: one row per normalized numeric measurement, for SQL filtering only.
CREATE TABLE IF NOT EXISTS measurements (
  patient_id   TEXT NOT NULL REFERENCES patients (id),
  report_id    TEXT NOT NULL REFERENCES reports (id),
  report_date  TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  value        REAL NOT NULL,
  flag         TEXT NOT NULL,
  ref_low      REAL,
  ref_high     REAL
);
CREATE INDEX IF NOT EXISTS idx_meas_patient ON measurements (patient_id, canonical_id, report_date);
CREATE INDEX IF NOT EXISTS idx_meas_analyte ON measurements (canonical_id);

-- Derived at seed time by lab-core trend logic: per patient x analyte, where
-- the series currently stands and which way it is moving. The cohort tool is
-- a filter over this table and computes nothing itself.
CREATE TABLE IF NOT EXISTS patient_analyte_summary (
  patient_id   TEXT NOT NULL REFERENCES patients (id),
  canonical_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  last_value   REAL NOT NULL,
  last_date    TEXT NOT NULL,
  last_flag    TEXT NOT NULL,
  delta        REAL,                 -- last minus previous; NULL for a single draw
  direction    TEXT NOT NULL CHECK (direction IN ('rising', 'falling', 'stable', 'single')),
  PRIMARY KEY (patient_id, canonical_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id),
  doc_date   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('perf_eval', 'physio_note', 'imaging', 'op_report')),
  title      TEXT NOT NULL,
  body_text  TEXT NOT NULL,
  body_norm  TEXT NOT NULL           -- lowercased, diacritics stripped; SQL prefilter only,
                                     -- the authoritative match runs offset-mapped in TS
);
CREATE INDEX IF NOT EXISTS idx_docs_patient ON documents (patient_id, doc_date);

CREATE TABLE IF NOT EXISTS document_pages (
  document_id TEXT NOT NULL REFERENCES documents (id),
  page_num    INTEGER NOT NULL,
  image_url   TEXT NOT NULL,         -- app-relative for committed synthetic pages, /api/evidence/... for R2
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  PRIMARY KEY (document_id, page_num)
);

-- The patient card's spine: one row per clinic visit. DERIVED at seed time by
-- grouping reports, documents and performance tests that share a date — the
-- seeder computes the grouping, SQL only stores it. A visit without a note is
-- an honest gap, not a defect: the real record has visits where only the
-- tests survive.
CREATE TABLE IF NOT EXISTS visits (
  id               TEXT PRIMARY KEY,
  patient_id       TEXT NOT NULL REFERENCES patients (id),
  visit_date       TEXT NOT NULL,    -- ISO YYYY-MM-DD
  kind             TEXT NOT NULL CHECK (kind IN ('annual', 'blood', 'perf_test', 'thb')),
  title            TEXT NOT NULL,    -- Czech, as the card shows it
  note_document_id TEXT REFERENCES documents (id)  -- the visit's zpráva, when one exists
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits (patient_id, visit_date);

-- Derived: performance results as the clinic's own protocols print them —
-- VO2max, thresholds, spirometry, tHb mass. The closed metric list lives in
-- docs/csm-protocol.md; a metric_id not in that inventory has no business
-- here (the app only knows what the record says). Reference bounds are
-- carried only where the protocol itself prints one.
CREATE TABLE IF NOT EXISTS perf_metrics (
  patient_id   TEXT NOT NULL REFERENCES patients (id),
  visit_id     TEXT NOT NULL REFERENCES visits (id),
  metric_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  value        REAL NOT NULL,
  ref_low      REAL,
  ref_high     REAL,
  test_date    TEXT NOT NULL,
  -- One value per metric per visit, structurally: a re-seed that forgot the
  -- wipe conflicts instead of silently doubling every chart point.
  PRIMARY KEY (patient_id, visit_id, metric_id)
);
CREATE INDEX IF NOT EXISTS idx_perf_patient ON perf_metrics (patient_id, metric_id, test_date);
CREATE INDEX IF NOT EXISTS idx_perf_visit ON perf_metrics (visit_id);
