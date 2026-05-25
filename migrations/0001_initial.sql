-- Migration 0001: parking_events table (audit log).
-- Created: 2026-05-25
--
-- Salvestab koik /api/park sundmused:
--   park.ok           - edukas parkimine Europark API kaudu
--   park.upstream_error - Europark vastas vea (401/422/jne) v6i v6rk down
--   park.validation_error - vigane sisend v6i rate limit hit
--   park.misconfig    - server'i config viga (env vars puudu)
--
-- IF NOT EXISTS klauslid teevad migration'i idempotentseks - kui tabel juba
-- olemas (manuaalselt loodud REST API kaudu 2026-05-25), siis migration on
-- safe no-op.

CREATE TABLE IF NOT EXISTS parking_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                  TEXT NOT NULL,
  event               TEXT NOT NULL,
  floor               TEXT,
  company             TEXT,
  plate               TEXT,
  europark_session_id INTEGER,
  europark_status     TEXT,
  start_time          TEXT,
  end_time            TEXT,
  user_email          TEXT,
  user_name           TEXT,
  user_id             TEXT,
  tenant_id           TEXT,
  tenant_name         TEXT,
  ip                  TEXT,
  country             TEXT,
  user_agent          TEXT,
  referer             TEXT,
  raw_context         TEXT,
  error_code          TEXT,
  error_message       TEXT,
  duration_ms         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_parking_events_ts
  ON parking_events(ts DESC);

CREATE INDEX IF NOT EXISTS idx_parking_events_plate
  ON parking_events(plate);

CREATE INDEX IF NOT EXISTS idx_parking_events_user_email
  ON parking_events(user_email);

CREATE INDEX IF NOT EXISTS idx_parking_events_floor
  ON parking_events(floor);
