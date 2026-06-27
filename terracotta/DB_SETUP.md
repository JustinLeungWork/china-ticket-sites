# Booking Database Setup (Neon Postgres)

The site now uses a Neon Postgres database as the system of record for bookings.
**Checkout will fail until `DATABASE_URL` is set in Vercel** — provision this before testing.

## 1. Provision Neon (recommended: via Vercel)

- Vercel dashboard → your project → **Storage** → **Create Database** → **Neon** (Postgres).
- Vercel automatically injects the connection string env var. Make sure the variable is
  named **`DATABASE_URL`** (rename/add it if the integration uses a different name), and
  that it's enabled for **Production** (and Preview, if you test there).
- Alternatively, create a project at neon.tech, copy its connection string, and add it to
  Vercel → Settings → Environment Variables as `DATABASE_URL`.

## 2. Add a cron secret (protects the purge endpoint)

- Vercel → Settings → Environment Variables → add **`CRON_SECRET`** = any long random string.
- Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>` on cron runs, and
  `/api/purge` rejects anything else.

## 3. Schema

Created automatically on first checkout (`api/_db.js` runs `CREATE TABLE IF NOT EXISTS`).
To create it manually instead, run [`db/schema.sql`](db/schema.sql) in the Neon SQL editor.

## 4. Redeploy

After the env vars are set, redeploy so the functions pick them up.

## What it does

- **`/api/checkout`** writes the booking (incl. passport data) to the `bookings` table and
  sends Stripe **only** the invoice id + non-sensitive fields. Passport data never reaches Stripe.
- **`/api/webhook`** looks the booking up by invoice id, marks it paid, and emails you the
  passport details to book on bmy.com.cn.
- **`/api/purge`** (daily cron, 03:00 UTC) clears `passport_data` once the visit date has
  passed, and for abandoned unpaid checkouts. Non-sensitive invoice/financial data is kept
  (12 months / 5 years per the retention policy).

## Quick checks after deploy

- Make a test booking → a row appears in `bookings` (Neon SQL editor: `SELECT invoice_id, status, visit_date, passport_data IS NOT NULL AS has_pp FROM bookings;`).
- Confirm the Stripe session metadata contains the invoice id but **no** passport fields.
- Manually trigger a purge: `curl -H "Authorization: Bearer <CRON_SECRET>" https://terracotta-tickets.com/api/purge`.
