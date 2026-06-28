// Shared Neon Postgres helper. The leading underscore keeps Vercel from treating
// this as an HTTP route. Lazy-init so a missing DATABASE_URL surfaces as a handled
// runtime error rather than crashing the function at import time.
const { neon } = require('@neondatabase/serverless');

let _sql;
function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Idempotent — safe to call on every request (cheap with IF NOT EXISTS, and the
// in-process flag skips it once a warm instance has run it).
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS bookings (
      invoice_id        TEXT PRIMARY KEY,
      email             TEXT NOT NULL,
      visit_date        DATE NOT NULL,
      visitor_qty       INTEGER NOT NULL,
      amount_cents      INTEGER NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'usd',
      ticket_type       TEXT NOT NULL DEFAULT 'admission',
      passport_data     JSONB,
      stripe_session_id TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at           TIMESTAMPTZ,
      purged_at         TIMESTAMPTZ
    )`;
  // Private-guide add-on tracking (added later; ADD COLUMN IF NOT EXISTS is
  // idempotent so this is safe to run on every warm start).
  //   guide_status: NULL = none · 'requested' = ticked at checkout, awaiting
  //   availability · 'link_sent' = $150 payment link emailed · 'paid' = settled.
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_requested    BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_size         INTEGER`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_status       TEXT`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_amount_cents INTEGER`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_session_id   TEXT`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_link_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_paid_at      TIMESTAMPTZ`;
  schemaReady = true;
}

// Booking reference / invoice number, e.g. TW-20260628-7F3K
function newInvoiceId() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TW-${ymd}-${rand}`;
}

module.exports = { getSql, ensureSchema, newInvoiceId };
