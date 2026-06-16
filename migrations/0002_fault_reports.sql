-- Migration 0002: fault_reports + hausing_location_map (Sharry -> Hausing veateadete relay).
-- Created: 2026-06-16
--
-- fault_reports: iga /api/fault sundmus + Sharry<->Hausing ticket mapping + staatuse cache.
--   fault.ok               - veateade loodud Hausingus (general ticket)
--   fault.duplicate        - sama client_request_id juba olemas (idempotentsus)
--   fault.upstream_error   - Hausing vastas vea voi vork down
--   fault.validation_error - vigane sisend voi rate limit hit
--   fault.misconfig        - serveri config viga (env vars puudu)
--
-- hausing_location_map: Sharry asukoht (site/base location) -> Hausing building/room id.
--
-- IF NOT EXISTS teeb migration'i idempotentseks (safe re-run).

CREATE TABLE IF NOT EXISTS fault_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                     TEXT NOT NULL,
  client_request_id      TEXT,
  event                  TEXT NOT NULL,
  hausing_ticket_id      INTEGER,
  hausing_ticket_number  TEXT,
  hausing_status         TEXT,
  resolution             TEXT,
  category               TEXT,
  title                  TEXT,
  description            TEXT,
  building_id            TEXT,
  room_id                TEXT,
  watcher_email          TEXT,
  user_name              TEXT,
  user_id                TEXT,
  tenant_id              TEXT,
  tenant_name            TEXT,
  ip                     TEXT,
  country                TEXT,
  user_agent             TEXT,
  referer                TEXT,
  raw_context            TEXT,
  error_code             TEXT,
  error_message          TEXT,
  duration_ms            INTEGER,
  updated_at             TEXT
);

-- Idempotentsus: sama client_request_id ei tohi luua kahte ticketit.
-- Partial unique index, et NULL client_request_id (legacy/validation events) ei piiraks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fault_reports_client_request_id
  ON fault_reports(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fault_reports_ts
  ON fault_reports(ts DESC);

CREATE INDEX IF NOT EXISTS idx_fault_reports_ticket
  ON fault_reports(hausing_ticket_id);

CREATE INDEX IF NOT EXISTS idx_fault_reports_email
  ON fault_reports(watcher_email);

-- Poller leiab avatud (mitte-terminaalsed) ticketid kiiresti.
CREATE INDEX IF NOT EXISTS idx_fault_reports_open_status
  ON fault_reports(hausing_status) WHERE hausing_ticket_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hausing_location_map (
  sharry_site_id           TEXT,
  sharry_base_location_id  TEXT,
  hausing_building_id      TEXT NOT NULL,
  hausing_room_id          TEXT,
  label                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_hausing_location_map_site
  ON hausing_location_map(sharry_site_id);
