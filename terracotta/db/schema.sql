-- Booking database for Terracotta Tickets (Neon Postgres).
-- The app also creates this automatically (api/_db.js ensureSchema); this file is
-- for reference or to run once manually in the Neon SQL editor.

CREATE TABLE IF NOT EXISTS bookings (
  invoice_id        TEXT PRIMARY KEY,          -- booking reference / invoice number, e.g. TW-20260628-7F3K
  email             TEXT NOT NULL,
  visit_date        DATE NOT NULL,
  visitor_qty       INTEGER NOT NULL,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  ticket_type       TEXT NOT NULL DEFAULT 'admission',
  passport_data     JSONB,                     -- sensitive; purged after the visit date
  stripe_session_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | paid
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ,
  purged_at         TIMESTAMPTZ,
  time_slot          TEXT,             -- chosen 1-hour entry window, e.g. 08:30-09:30
  -- Private English guide add-on ($150 flat, request-only, billed separately).
  guide_requested    BOOLEAN NOT NULL DEFAULT false,
  guide_size         INTEGER,
  guide_status       TEXT,             -- NULL | requested | link_sent | paid
  guide_amount_cents INTEGER,
  guide_session_id   TEXT,
  guide_link_sent_at TIMESTAMPTZ,
  guide_paid_at      TIMESTAMPTZ
);

-- Helps the daily purge job find rows to clear.
CREATE INDEX IF NOT EXISTS bookings_purge_idx ON bookings (visit_date) WHERE passport_data IS NOT NULL;
