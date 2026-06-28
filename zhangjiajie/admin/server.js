#!/usr/bin/env node
// Multi-site admin dashboard — china-ticket-sites
//
// Sites are defined in .env:
//   SITES=terracotta,mutianyu
//   TERRACOTTA_DATABASE_URL=...    (falls back to DATABASE_URL)
//   TERRACOTTA_BRAND_NAME=Terracotta Tickets
//   TERRACOTTA_BRAND_COLOR=#6B3200
//   TERRACOTTA_SITE_URL=https://terracotta-tickets.com
//   TERRACOTTA_EMAIL_DOMAIN=terracotta-tickets.com
//   TERRACOTTA_SUPPORT_EMAIL=support@terracotta-tickets.com
//   TERRACOTTA_OPERATOR_EMAIL=...
//   TERRACOTTA_GUIDE_CENTS=15000
//   STRIPE_SECRET_KEY=...          (shared; or per-site TERRACOTTA_STRIPE_SECRET_KEY)
//   RESEND_API_KEY=...             (shared; or per-site TERRACOTTA_RESEND_API_KEY)
//
// Run:  npm run admin   (from terracotta/)
// Open: http://localhost:8787
// SECURITY: binds 127.0.0.1 only, excluded from Vercel deploy via .vercelignore

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Load .env (terracotta/.env, then ../china-ticket-sites/.env as fallback) ──
(function loadEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const f of candidates) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq === -1) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[key] = val;
    }
  }
})();

const PORT = parseInt(process.env.ADMIN_PORT || '8787', 10);

// ── Site registry ─────────────────────────────────────────────────────────────
function buildSiteConfig(siteId) {
  const P = siteId.toUpperCase() + '_';
  const get = (k, fallback = '') => process.env[P + k] || process.env[k] || fallback;
  return {
    id:            siteId,
    name:          get('BRAND_NAME',    siteId),
    color:         get('BRAND_COLOR',   '#4a2300'),
    siteUrl:       get('SITE_URL',      'https://localhost'),
    emailDomain:   get('EMAIL_DOMAIN',  ''),
    supportEmail:  get('SUPPORT_EMAIL', ''),
    operatorEmail: get('OPERATOR_EMAIL',''),
    guideCents:    parseInt(get('GUIDE_CENTS', '15000'), 10),
    tripAdvisorUrl: get('TRIPADVISOR_URL', ''),
    dbUrl:         process.env[P + 'DATABASE_URL'] || process.env['DATABASE_URL'] || '',
    stripeKey:     process.env[P + 'STRIPE_SECRET_KEY'] || process.env['STRIPE_SECRET_KEY'] || '',
    resendKey:     process.env[P + 'RESEND_API_KEY'] || process.env['RESEND_API_KEY'] || '',
  };
}

const SITE_IDS = (process.env.SITES || 'terracotta').split(',').map(s => s.trim()).filter(Boolean);
const SITES    = Object.fromEntries(SITE_IDS.map(id => [id, buildSiteConfig(id)]));
const DEFAULT  = SITE_IDS[0];

function getSite(id) { return SITES[id] || SITES[DEFAULT]; }

// ── Lazy clients (one per site) ───────────────────────────────────────────────
const { neon }   = require('@neondatabase/serverless');
const Stripe     = require('stripe');
const { Resend } = require('resend');

const _cache = {};
function sql(site) {
  if (!site.dbUrl) throw new Error(`DATABASE_URL not set for site "${site.id}" — add ${site.id.toUpperCase()}_DATABASE_URL to your .env`);
  return _cache['sql:'+site.id] || (_cache['sql:'+site.id] = neon(site.dbUrl));
}
function stripe(site) {
  if (!site.stripeKey) throw new Error(`STRIPE_SECRET_KEY not set for site "${site.id}"`);
  return _cache['stripe:'+site.id] || (_cache['stripe:'+site.id] = Stripe(site.stripeKey));
}
function resend(site) {
  return _cache['resend:'+site.id] || (_cache['resend:'+site.id] = new Resend(site.resendKey));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const isoDate = d => (d instanceof Date) ? d.toISOString().slice(0,10) : String(d||'').slice(0,10);

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function envStatus(site) {
  const k = site.stripeKey;
  return {
    db:       !!site.dbUrl,
    stripe:   k ? (k.startsWith('sk_live') ? 'live' : 'test') : false,
    resend:   !!site.resendKey,
    from:     site.emailDomain || null,
    operator: site.operatorEmail || null,
  };
}

// ── Admin-only schema additions (idempotent) ──────────────────────────────────
async function ensureAdminColumns(site) {
  const db = sql(site);
  await db`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_agency_checked TIMESTAMPTZ`;
  await db`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_notes TEXT`;
  await db`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_info_sent_at TIMESTAMPTZ`;
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function listBookings(site, withStripe) {
  const db = sql(site);
  const rows = await db`
    SELECT invoice_id, email, visit_date, time_slot, visitor_qty,
           amount_cents, currency, status, passport_data,
           stripe_session_id, created_at, paid_at,
           guide_requested, guide_size, guide_status, guide_amount_cents,
           guide_session_id, guide_link_sent_at, guide_paid_at,
           guide_agency_checked, guide_notes, guide_info_sent_at
    FROM bookings ORDER BY created_at DESC LIMIT 200`;

  if (withStripe) {
    const st = stripe(site);
    for (const r of rows) {
      r.stripe_admission_status = null;
      r.stripe_guide_status = null;
      if (r.stripe_session_id) try { r.stripe_admission_status = (await st.checkout.sessions.retrieve(r.stripe_session_id)).payment_status; } catch(_){}
      if (r.guide_session_id)  try { r.stripe_guide_status     = (await st.checkout.sessions.retrieve(r.guide_session_id)).payment_status;  } catch(_){}
    }
  }
  return rows;
}

async function sendGuideLink(site, invoiceId) {
  const db = sql(site);
  const rows = await db`SELECT invoice_id, email, visit_date FROM bookings WHERE invoice_id = ${invoiceId}`;
  const b = rows[0];
  if (!b) throw new Error('Booking not found: ' + invoiceId);
  const visitDate = isoDate(b.visit_date);
  const priceFmt  = `$${(site.guideCents / 100).toFixed(0)}`;

  const session = await stripe(site).checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Private English Guide — ${site.name}`, description: `Visit on ${visitDate} · up to 10 people` },
        unit_amount: site.guideCents,
      },
      quantity: 1,
    }],
    customer_email: b.email,
    client_reference_id: invoiceId,
    metadata: { invoiceId, type: 'guide', visitDate, customerEmail: b.email, siteId: site.id },
    success_url: `${site.siteUrl}/guide-success.html?invoice=${invoiceId}`,
    cancel_url:  `${site.siteUrl}/`,
    expires_at:  Math.floor(Date.now() / 1000) + 23 * 3600,
  });

  const FROM = `${site.name} <bookings@${site.emailDomain}>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
<div style="background:${site.color};color:#fff;padding:24px;text-align:center">
  <h1 style="margin:0;font-size:20px">Your Private Guide Is Available</h1>
  <p style="margin:8px 0 0;opacity:.85;font-size:13px">${esc(site.name)} · ${esc(visitDate)}</p>
</div>
<div style="padding:24px;background:#f8f8f8">
  <p style="font-size:14px;color:#555;line-height:1.65;margin-bottom:20px">
    A <strong>private English-speaking guide</strong> is available for your visit on <strong>${esc(visitDate)}</strong>.
    To confirm, complete the one-time guide fee below. <strong>This link is valid for 24 hours.</strong>
  </p>
  <div style="text-align:center;margin:24px 0">
    <a href="${session.url}" style="display:inline-block;background:${site.color};color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:15px;font-weight:600">Pay ${priceFmt} to confirm your guide</a>
  </div>
  <div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin-bottom:20px">
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:5px 0;color:#888">Booking reference</td><td style="padding:5px 0;text-align:right"><strong>${esc(invoiceId)}</strong></td></tr>
      <tr><td style="padding:5px 0;color:#888">Visit date</td><td style="padding:5px 0;text-align:right"><strong>${esc(visitDate)}</strong></td></tr>
      <tr style="border-top:1px solid #eee"><td style="padding:10px 0;font-weight:600">Private guide (flat)</td><td style="padding:10px 0;text-align:right;font-weight:600">${priceFmt} USD</td></tr>
    </table>
  </div>
  <p style="font-size:12px;color:#999">Button not working? Paste this into your browser:<br>
    <a href="${session.url}" style="color:${site.color};word-break:break-all">${session.url}</a></p>
  <p style="font-size:13px;color:#888">Questions? Quote ${esc(invoiceId)} and email
    <a href="mailto:${site.supportEmail}" style="color:${site.color}">${site.supportEmail}</a></p>
</div></div>`;

  let emailed = false, emailError = null;
  try {
    const { error } = await resend(site).emails.send({
      from: FROM, to: b.email,
      subject: `Your private guide is available — confirm with payment (${invoiceId})`,
      html,
    });
    if (error) emailError = error.message || String(error); else emailed = true;
  } catch (e) { emailError = e.message || String(e); }

  await db`UPDATE bookings
    SET guide_status = 'link_sent', guide_link_sent_at = now(),
        guide_session_id = ${session.id}, guide_amount_cents = ${site.guideCents}
    WHERE invoice_id = ${invoiceId}`;

  return { url: session.url, emailed, emailError, email: b.email };
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    }

    // List configured sites (for UI tab rendering)
    if (req.method === 'GET' && u.pathname === '/api/sites') {
      return json(res, 200, {
        sites: SITE_IDS.map(id => ({
          id, name: SITES[id].name, color: SITES[id].color,
          env: envStatus(SITES[id]),
        })),
        default: DEFAULT,
      });
    }

    if (req.method === 'GET' && u.pathname === '/api/bookings') {
      const site = getSite(u.searchParams.get('site') || DEFAULT);
      const env  = envStatus(site);
      try {
        const rows = await listBookings(site, u.searchParams.get('stripe') === '1');
        return json(res, 200, {
          ok: true, bookings: rows, env,
          site: { id: site.id, name: site.name, color: site.color, guideCents: site.guideCents },
        });
      } catch (e) {
        return json(res, 200, {
          ok: true, bookings: [], env, dbError: e.message,
          site: { id: site.id, name: site.name, color: site.color, guideCents: site.guideCents },
        });
      }
    }

    if (req.method === 'POST' && u.pathname === '/api/guide-link') {
      const body = await readBody(req);
      if (!body.invoice) return json(res, 400, { ok: false, error: 'invoice required' });
      const site = getSite(body.site || DEFAULT);
      return json(res, 200, { ok: true, ...(await sendGuideLink(site, body.invoice)) });
    }

    if (req.method === 'POST' && u.pathname === '/api/guide-info') {
      const body = await readBody(req);
      if (!body.invoice) return json(res, 400, { ok: false, error: 'invoice required' });
      const site = getSite(body.site || DEFAULT);
      const db   = sql(site);
      const rows = await db`SELECT invoice_id, email, visit_date, time_slot FROM bookings WHERE invoice_id = ${body.invoice}`;
      const b = rows[0];
      if (!b) return json(res, 404, { ok: false, error: 'booking not found' });
      const visitDate = isoDate(b.visit_date);
      const slot = b.time_slot ? ` at ${b.time_slot}` : '';
      const FROM = `${site.name} <bookings@${site.emailDomain}>`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
<div style="background:${site.color};color:#fff;padding:24px;text-align:center">
  <h1 style="margin:0;font-size:20px">Your Visit Guide</h1>
  <p style="margin:8px 0 0;opacity:.85;font-size:13px">${esc(site.name)} · ${esc(visitDate)}${esc(slot)}</p>
</div>
<div style="padding:24px;background:#f8f8f8">
  <p style="font-size:14px;color:#555;line-height:1.7">Here's everything you need to know before your visit to Zhangjiajie National Forest Park.</p>
  <div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin:16px 0">
    <h3 style="margin:0 0 12px;font-size:14px;color:#333">Getting to the park</h3>
    <ul style="font-size:13px;color:#555;line-height:1.9;margin:0;padding-left:18px">
      <li><strong>From Zhangjiajie Hehua Airport (DYG):</strong> ~30 min taxi to Wulingyuan, ¥80–120</li>
      <li><strong>From Changsha:</strong> high-speed train to Zhangjiajie city (~2.5h), then taxi to Wulingyuan (~45 min)</li>
      <li><strong>From Zhangjiajie city:</strong> taxi or bus to Wulingyuan North Gate, ~35 km, 30–45 min</li>
    </ul>
  </div>
  <div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin:16px 0">
    <h3 style="margin:0 0 12px;font-size:14px;color:#333">On the day</h3>
    <ul style="font-size:13px;color:#555;line-height:1.9;margin:0;padding-left:18px">
      <li>Bring your <strong>original passport</strong> every day — name must match the booking exactly</li>
      <li>Show your QR code at the entrance gate on each visit day</li>
      <li>Comfortable walking shoes with grip — some paths are steep and may be slippery</li>
      <li>Bring a rain jacket — mist and light rain are common year-round</li>
      <li>Carry water and snacks — onsite food is convenient but expensive</li>
      <li>Cable cars and eco-buses are included (if you booked the bundle)</li>
    </ul>
  </div>
  <div style="text-align:center;margin:20px 0">
    <a href="${site.siteUrl}/guide.html" style="display:inline-block;background:${site.color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:4px;font-size:14px;font-weight:600">Full Visitor Guide →</a>
  </div>
  <p style="font-size:12px;color:#999">Booking reference: ${esc(body.invoice)}<br>
  Questions? Email <a href="mailto:${site.supportEmail}" style="color:${site.color}">${site.supportEmail}</a></p>
</div></div>`;
      let emailed = false, emailError = null;
      try {
        const { error } = await resend(site).emails.send({
          from: FROM, to: b.email,
          subject: `Your Zhangjiajie visit — practical guide (${body.invoice})`,
          html,
        });
        if (error) emailError = error.message || String(error); else emailed = true;
      } catch (e) { emailError = e.message || String(e); }
      if (emailed) {
        await db`UPDATE bookings SET guide_info_sent_at = now() WHERE invoice_id = ${body.invoice}`;
      }
      return json(res, 200, { ok: true, emailed, emailError, email: b.email });
    }

    if (req.method === 'PATCH' && u.pathname === '/api/booking') {
      const body = await readBody(req);
      if (!body.invoice) return json(res, 400, { ok: false, error: 'invoice required' });
      const site = getSite(body.site || DEFAULT);
      const db = sql(site);
      if ('agency_checked' in body) {
        const ts = body.agency_checked ? new Date() : null;
        await db`UPDATE bookings SET guide_agency_checked = ${ts} WHERE invoice_id = ${body.invoice}`;
      }
      if ('notes' in body) {
        await db`UPDATE bookings SET guide_notes = ${body.notes || null} WHERE invoice_id = ${body.invoice}`;
      }
      return json(res, 200, { ok: true });
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('Admin error:', err.message);
    json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Multi-site admin  →  http://localhost:${PORT}`);
  console.log(`  Sites: ${SITE_IDS.join(', ')}\n`);
  for (const id of SITE_IDS) {
    const e = envStatus(SITES[id]);
    console.log(`  [${id}]  DB:${e.db?'ok':'MISSING'}  Stripe:${e.stripe||'MISSING'}  Resend:${e.resend?'ok':'MISSING'}  from:bookings@${e.from||'??'}`);
    if (e.db) ensureAdminColumns(SITES[id]).catch(err => console.warn(`  [${id}] column migration warning:`, err.message));
  }
  console.log('');
});
