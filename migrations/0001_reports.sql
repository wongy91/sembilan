CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL,
  reporter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reports_expires ON reports (expires_at);
CREATE INDEX IF NOT EXISTS reports_position ON reports (lat, lon);
CREATE INDEX IF NOT EXISTS reports_reporter ON reports (reporter, created_at);

CREATE TABLE IF NOT EXISTS votes (
  report_id TEXT NOT NULL,
  reporter TEXT NOT NULL,
  up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, reporter)
);
