const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { getSql, ensureSchema } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const BRAND_NAME    = 'Zhangjiajie Forest Park Tickets';
const BRAND_COLOR   = '#1E3D2F';
const SUPPORT_EMAIL = 'support@zhangjiajie-tickets.com';
// ─────────────────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Buffer the raw request stream before verifying — Stripe verifies the exact
  // bytes that were signed, which breaks if the body is re-parsed.
  let rawBody;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    rawBody = Buffer.concat(chunks);
  } catch (e) {
    return res.status(400).send('Webhook Error: could not read request body');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') return res.json({ received: true });
  const session = event.data.object;
  if (session.payment_status !== 'paid') return res.json({ received: true });

  const m = session.metadata || {};
  const invoiceId = m.invoiceId || session.client_reference_id;
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  if (!invoiceId) {
    console.log('Webhook: ignoring session with no invoiceId', session.id);
    return res.json({ received: true });
  }

  // Look up passport details from our DB (preferred); fall back to Stripe metadata
  // if the DB wasn't available at checkout time.
  let visitors = [];
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT passport_data, email FROM bookings WHERE invoice_id = ${invoiceId}`;
    if (rows[0] && Array.isArray(rows[0].passport_data)) visitors = rows[0].passport_data;
    await sql`UPDATE bookings SET status = 'paid', paid_at = now() WHERE invoice_id = ${invoiceId}`;
  } catch (err) {
    console.error('Booking lookup/update failed:', err.message);
  }
  if (visitors.length === 0) {
    visitors = Object.entries(m)
      .filter(([k]) => /^v\d+$/.test(k))
      .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
      .map(([, val]) => {
        try { const v = JSON.parse(val); return { name: v.n, passportNumber: v.p, dateOfBirth: v.dob }; }
        catch (_) { return null; }
      })
      .filter(Boolean);
  }

  const customerEmail = m.customerEmail || session.customer_details?.email || session.customer_email;
  const visitDate     = m.visitDate || '';
  const totalUSD      = (session.amount_total / 100).toFixed(2);
  const firstName     = esc(visitors[0]?.name?.split(' ')[0] || 'there');
  const FROM          = `${BRAND_NAME} <bookings@${process.env.EMAIL_DOMAIN}>`;
  const adultQty      = m.adultQty || '?';
  const youthQty      = parseInt(m.youthQty) > 0 ? m.youthQty : '0';
  const adultTypeName = m.adultType === 'adult_bundle'
    ? '4-Day Full Transport Bundle (Adult)'
    : '4-Day Admission + Eco-bus (Adult)';

  const visitorRows = visitors.map((v, i) => `
    <tr><td colspan="2" style="padding:8px 10px;background:${BRAND_COLOR};color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Visitor ${i + 1}</td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;width:130px">Full name</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(v.name)}</strong></td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Passport no.</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(v.passportNumber)}</strong></td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Date of birth</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(v.dateOfBirth)}</td></tr>
  `).join('');

  const operatorHtml = `<div style="font-family:Arial,sans-serif;max-width:600px"><div style="background:${BRAND_COLOR};color:#fff;padding:20px 24px"><h2 style="margin:0;font-size:18px">New Order — Action Required</h2><p style="margin:6px 0 0;opacity:.8;font-size:13px">${BRAND_NAME} · ${esc(invoiceId)}</p></div><div style="padding:24px;background:#f9f9f9"><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;width:130px">Invoice / Ref</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(invoiceId)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Attraction</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">Zhangjiajie National Forest Park (Wulingyuan)</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Ticket (adult)</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(adultTypeName)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">First entry date</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(visitDate)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Valid until</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">4 days from first entry</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Adults</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(adultQty)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Youth (14-17)</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(youthQty)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Customer</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(customerEmail)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Amount paid</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>$${totalUSD} USD</strong></td></tr>${visitorRows}</table><div style="background:#fff3cd;border-left:4px solid #ffc107;padding:14px;font-size:13px;line-height:1.6;border-radius:2px"><strong>ACTION REQUIRED:</strong><br>1. Purchase ticket(s) on the official Wulingyuan system using the passport details above.<br>2. Forward QR code(s) to <strong>${esc(customerEmail)}</strong>.<br>3. <strong>Delete passport details after the visit window ends</strong> — the database purges them automatically 5 days after the visit start date; also delete this email copy (PDPA compliance).</div></div></div>`;

  const customerHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto"><div style="background:${BRAND_COLOR};color:#fff;padding:24px;text-align:center"><h1 style="margin:0;font-size:20px">Booking Confirmed</h1><p style="margin:8px 0 0;opacity:.8;font-size:13px">Zhangjiajie National Forest Park · ${esc(visitDate)}</p></div><div style="padding:24px;background:#f8f8f8"><p style="font-size:15px;margin-bottom:8px">Hi ${firstName},</p><p style="font-size:14px;color:#555;line-height:1.65;margin-bottom:20px">Payment received and your booking is confirmed. We'll email your QR code within <strong>24 hours</strong> — no further action needed for now.</p><div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin-bottom:20px"><table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:5px 0;color:#888">Booking reference</td><td style="padding:5px 0;text-align:right"><strong>${esc(invoiceId)}</strong></td></tr><tr><td style="padding:5px 0;color:#888">Park</td><td style="padding:5px 0;text-align:right">Zhangjiajie National Forest Park</td></tr><tr><td style="padding:5px 0;color:#888">First entry date</td><td style="padding:5px 0;text-align:right"><strong>${esc(visitDate)}</strong></td></tr><tr><td style="padding:5px 0;color:#888">Ticket validity</td><td style="padding:5px 0;text-align:right"><strong>4 days from your first entry</strong></td></tr><tr><td style="padding:5px 0;color:#888">Adults</td><td style="padding:5px 0;text-align:right">${esc(adultQty)}</td></tr><tr><td style="padding:5px 0;color:#888">Youth (14-17)</td><td style="padding:5px 0;text-align:right">${esc(youthQty)}</td></tr><tr style="border-top:1px solid #eee"><td style="padding:10px 0;font-weight:600">Total paid</td><td style="padding:10px 0;text-align:right;font-weight:600">$${totalUSD} USD</td></tr></table></div><div style="background:#fff8e1;border-left:3px solid #ffc107;padding:14px;font-size:13px;line-height:1.6;margin-bottom:20px"><strong>Remember:</strong> Bring your original passport each day you enter the park — name must match exactly. <strong>Children under 14 enter free</strong> with their passport (no ticket needed from us).</div><p style="font-size:13px;color:#888">Questions? Quote ${esc(invoiceId)} and email <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR}">${SUPPORT_EMAIL}</a></p></div><div style="padding:16px;text-align:center;font-size:11px;color:#bbb">Independent ticket procurement service. Not affiliated with Wulingyuan Scenic Area or any government body.</div></div>`;

  try {
    const { error } = await resend.emails.send({ from: FROM, to: process.env.OPERATOR_EMAIL, subject: `🎫 New order ${invoiceId} — Zhangjiajie · ${visitDate}`, html: operatorHtml });
    if (error) { console.error('Operator email rejected by Resend:', error); return res.status(500).json({ error: 'operator_email_failed', detail: error.message || String(error) }); }
  } catch (err) {
    console.error('Operator email threw:', err);
    return res.status(500).json({ error: 'operator_email_failed' });
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to: customerEmail, subject: `Your booking is confirmed (${invoiceId}) — Zhangjiajie National Forest Park · ${visitDate}`, html: customerHtml });
    if (error) console.error('Customer email rejected by Resend:', error);
  } catch (err) {
    console.error('Customer email threw:', err);
  }
  return res.json({ received: true });
};

// Disable Vercel's automatic body parsing so the handler can read the raw body
// for Stripe signature verification.
module.exports.config = { api: { bodyParser: false } };
