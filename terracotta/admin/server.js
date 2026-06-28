#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Local-only admin dashboard for Terracotta Tickets.
//
// Reads bookings from Neon, optionally cross-checks Stripe payment status, and
// lets you send the $150 private-guide payment link in ONE click (creates a
// Stripe Checkout session + emails it to the customer + records it).
//
// SECURITY: binds to 127.0.0.1 ONLY. Never expose this — it uses your Stripe
// secret key + DB connection string from terracotta/.env. It is also excluded
// from the Vercel deploy via terracotta/.vercelignore.
//
// Run from the terracotta/ directory:   npm run admin
// Then open:                            http://localhost:8787
// ─────────────────────────────────────────────────────────────────────────────
const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Load terracotta/.env into process.env (no dotenv dependency) ─────────────
(function loadEnv() {
  let raw;
  try { raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); } catch (_) { return; }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const PORT         = parseInt(process.env.ADMIN_PORT || '8787', 10);
const SITE_URL     = process.env.SITE_URL || 'https://terracotta-tickets.com';
const GUIDE_CENTS  = 15000;
const BRAND_NAME   = 'Terracotta Tickets';
const BRAND_COLOR  = '#6B3200';
const SUPPORT_EMAIL= 'support@terracotta-tickets.com';

const { neon }   = require('@neondatabase/serverless');
const Stripe     = require('stripe');
const { Resend } = require('resend');
const { ensureSchema } = require('../api/_db');  // single source of truth for the schema

let _sql, _stripe, _resend;
function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set in terracotta/.env — add your Neon connection string.');
  return _sql || (_sql = neon(process.env.DATABASE_URL));
}
function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set in terracotta/.env');
  return _stripe || (_stripe = Stripe(process.env.STRIPE_SECRET_KEY));
}
function resendClient() { return _resend || (_resend = new Resend(process.env.RESEND_API_KEY)); }

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const isoDate = d => (d instanceof Date) ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10);

function envStatus() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  return {
    DATABASE_URL:      !!process.env.DATABASE_URL,
    STRIPE_SECRET_KEY: k ? (k.startsWith('sk_live') ? 'live' : 'test') : false,
    RESEND_API_KEY:    !!process.env.RESEND_API_KEY,
    EMAIL_DOMAIN:      process.env.EMAIL_DOMAIN || null,
    OPERATOR_EMAIL:    process.env.OPERATOR_EMAIL || null,
    SITE_URL,
  };
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

async function listBookings(withStripe) {
  await ensureSchema();           // create table + guide columns if missing
  const sql = sqlClient();
  const rows = await sql`
    SELECT invoice_id, email, visit_date, time_slot, visitor_qty, amount_cents, currency, status,
           passport_data, stripe_session_id, created_at, paid_at,
           guide_requested, guide_size, guide_status, guide_amount_cents,
           guide_session_id, guide_link_sent_at, guide_paid_at
    FROM bookings
    ORDER BY created_at DESC
    LIMIT 200`;
  if (withStripe) {
    const stripe = stripeClient();
    for (const r of rows) {
      r.stripe_admission_status = null;
      r.stripe_guide_status = null;
      if (r.stripe_session_id) {
        try { r.stripe_admission_status = (await stripe.checkout.sessions.retrieve(r.stripe_session_id)).payment_status; } catch (_) {}
      }
      if (r.guide_session_id) {
        try { r.stripe_guide_status = (await stripe.checkout.sessions.retrieve(r.guide_session_id)).payment_status; } catch (_) {}
      }
    }
  }
  return rows;
}

// Create a $150 guide Checkout session, email it to the customer, record it.
async function sendGuideLink(invoiceId) {
  await ensureSchema();
  const sql = sqlClient();
  const rows = await sql`SELECT invoice_id, email, visit_date FROM bookings WHERE invoice_id = ${invoiceId}`;
  const b = rows[0];
  if (!b) throw new Error('Booking not found: ' + invoiceId);
  const visitDate = isoDate(b.visit_date);

  const session = await stripeClient().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: 'Private English Guide — Terracotta Warriors', description: `For your visit on ${visitDate} · up to 10 people` },
        unit_amount: GUIDE_CENTS,
      },
      quantity: 1,
    }],
    customer_email: b.email,
    client_reference_id: invoiceId,
    metadata: { invoiceId, type: 'guide', visitDate, customerEmail: b.email },
    success_url: `${SITE_URL}/guide-success.html?invoice=${invoiceId}`,
    cancel_url:  `${SITE_URL}/`,
    expires_at:  Math.floor(Date.now() / 1000) + 23 * 3600,  // Stripe max is 24h
  });

  const FROM = `${BRAND_NAME} <bookings@${process.env.EMAIL_DOMAIN}>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto"><div style="background:${BRAND_COLOR};color:#fff;padding:24px;text-align:center"><h1 style="margin:0;font-size:20px">Your Private Guide Is Available</h1><p style="margin:8px 0 0;opacity:.85;font-size:13px">Terracotta Warriors · ${esc(visitDate)}</p></div><div style="padding:24px;background:#f8f8f8"><p style="font-size:15px;margin-bottom:8px">Good news!</p><p style="font-size:14px;color:#555;line-height:1.65;margin-bottom:20px">A <strong>private English-speaking guide</strong> is available for your visit on <strong>${esc(visitDate)}</strong> (up to 10 people). To lock it in, please complete the one-time guide fee below. <strong>This link is valid for 24 hours.</strong></p><div style="text-align:center;margin:24px 0"><a href="${session.url}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:15px;font-weight:600">Pay $150 to confirm your guide</a></div><div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin-bottom:20px"><table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:5px 0;color:#888">Booking reference</td><td style="padding:5px 0;text-align:right"><strong>${esc(invoiceId)}</strong></td></tr><tr><td style="padding:5px 0;color:#888">Visit date</td><td style="padding:5px 0;text-align:right"><strong>${esc(visitDate)}</strong></td></tr><tr style="border-top:1px solid #eee"><td style="padding:10px 0;font-weight:600">Private guide (flat, up to 10)</td><td style="padding:10px 0;text-align:right;font-weight:600">$150 USD</td></tr></table></div><p style="font-size:12px;color:#999">If the button doesn't work, paste this link into your browser:<br><a href="${session.url}" style="color:${BRAND_COLOR};word-break:break-all">${session.url}</a></p><p style="font-size:13px;color:#888">Questions? Quote ${esc(invoiceId)} and email <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR}">${SUPPORT_EMAIL}</a></p></div></div>`;

  let emailed = false, emailError = null;
  try {
    const { error } = await resendClient().emails.send({ from: FROM, to: b.email, subject: `Your private guide is available — confirm with payment (${invoiceId})`, html });
    if (error) emailError = error.message || String(error); else emailed = true;
  } catch (e) { emailError = e.message || String(e); }

  await sql`UPDATE bookings SET guide_status = 'link_sent', guide_link_sent_at = now(), guide_session_id = ${session.id}, guide_amount_cents = ${GUIDE_CENTS} WHERE invoice_id = ${invoiceId}`;
  return { url: session.url, emailed, emailError, email: b.email };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    }
    if (req.method === 'GET' && u.pathname === '/api/bookings') {
      const env = envStatus();
      try {
        const rows = await listBookings(u.searchParams.get('stripe') === '1');
        return json(res, 200, { ok: true, bookings: rows, env });
      } catch (e) {
        // Still return env so the dashboard can show what's misconfigured.
        return json(res, 200, { ok: true, bookings: [], env, dbError: e.message });
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/guide-link') {
      const body = await readBody(req);
      if (!body.invoice) return json(res, 400, { ok: false, error: 'invoice required' });
      return json(res, 200, { ok: true, ...(await sendGuideLink(body.invoice)) });
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('Admin error:', err.message);
    json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const e = envStatus();
  console.log(`\n  Terracotta admin  →  http://localhost:${PORT}\n`);
  console.log(`  DB:       ${e.DATABASE_URL ? 'DATABASE_URL set' : '⚠ MISSING DATABASE_URL — add your Neon string to terracotta/.env'}`);
  console.log(`  Stripe:   ${e.STRIPE_SECRET_KEY ? e.STRIPE_SECRET_KEY + ' mode' : '⚠ MISSING'}`);
  console.log(`  Resend:   ${e.RESEND_API_KEY ? 'set' : '⚠ MISSING'}`);
  console.log(`  Sending:  bookings@${e.EMAIL_DOMAIN || '??'}  →  operator ${e.OPERATOR_EMAIL || '??'}\n`);
});
