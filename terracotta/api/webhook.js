const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { getSql, ensureSchema } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const BRAND_NAME    = 'Terracotta Tickets';
const BRAND_COLOR   = '#6B3200';
const SUPPORT_EMAIL = 'hello@terracotta-tickets.com';
// ─────────────────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel: disable body parsing so Stripe can verify the raw signature
module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') return res.json({ received: true });
  const session = event.data.object;
  if (session.payment_status !== 'paid') return res.json({ received: true });

  const m = session.metadata || {};
  const invoiceId = m.invoiceId || session.client_reference_id;
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Passport details live in OUR database, not in Stripe — look them up by invoice id.
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

  const customerEmail = m.customerEmail || session.customer_details?.email || session.customer_email;
  const visitDate = m.visitDate || '';
  const totalUSD = (session.amount_total / 100).toFixed(2);
  const firstName = esc(visitors[0]?.name?.split(' ')[0] || 'there');
  const FROM = `${BRAND_NAME} <bookings@${process.env.EMAIL_DOMAIN}>`;

  const visitorRows = visitors.map((v, i) => `
    <tr><td colspan="2" style="padding:8px 10px;background:${BRAND_COLOR};color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Visitor ${i + 1}</td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;width:130px">Full name</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(v.name)}</strong></td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Passport no.</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(v.passportNumber)}</strong></td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Nationality</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(v.nationality)}</td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Date of birth</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(v.dateOfBirth)}</td></tr>
  `).join('');

  const operatorHtml = `<div style="font-family:Arial,sans-serif;max-width:600px"><div style="background:${BRAND_COLOR};color:#fff;padding:20px 24px"><h2 style="margin:0;font-size:18px">New Order — Action Required</h2><p style="margin:6px 0 0;opacity:.8;font-size:13px">${BRAND_NAME} · ${esc(invoiceId)}</p></div><div style="padding:24px;background:#f9f9f9"><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;width:130px">Invoice / Ref</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(invoiceId)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Attraction</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(m.attraction)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Ticket</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(m.ticketName)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Visit date</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(visitDate)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Visitors</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(m.visitorQty)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Customer</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(customerEmail)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Amount paid</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>$${totalUSD} USD</strong></td></tr>${visitorRows}</table><div style="background:#fff3cd;border-left:4px solid #ffc107;padding:14px;font-size:13px;line-height:1.6;border-radius:2px"><strong>ACTION REQUIRED:</strong><br>1. Purchase tickets on bmy.com.cn using the passport details above (1 ticket per passport).<br>2. Forward QR codes to <strong>${esc(customerEmail)}</strong>.<br>3. <strong>Delete passport details after the visit date</strong> — kept only as long as needed to fulfil the booking (PDPA retention limit). The booking database purges them automatically; also delete this email copy.</div></div></div>`;

  const customerHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto"><div style="background:${BRAND_COLOR};color:#fff;padding:24px;text-align:center"><h1 style="margin:0;font-size:20px">Booking Confirmed</h1><p style="margin:8px 0 0;opacity:.8;font-size:13px">${esc(m.attraction)}</p></div><div style="padding:24px;background:#f8f8f8"><p style="font-size:15px;margin-bottom:8px">Hi ${firstName},</p><p style="font-size:14px;color:#555;line-height:1.65;margin-bottom:20px">Payment received. We're purchasing your ticket now and will send your QR code within <strong>4 hours</strong>.</p><div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin-bottom:20px"><table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:5px 0;color:#888">Booking reference</td><td style="padding:5px 0;text-align:right"><strong>${esc(invoiceId)}</strong></td></tr><tr><td style="padding:5px 0;color:#888">Attraction</td><td style="padding:5px 0;text-align:right">${esc(m.attraction)}</td></tr><tr><td style="padding:5px 0;color:#888">Visit date</td><td style="padding:5px 0;text-align:right"><strong>${esc(visitDate)}</strong></td></tr><tr style="border-top:1px solid #eee"><td style="padding:10px 0;font-weight:600">Total paid</td><td style="padding:10px 0;text-align:right;font-weight:600">$${totalUSD} USD</td></tr></table></div><div style="background:#fff8e1;border-left:3px solid #ffc107;padding:14px;font-size:13px;line-height:1.6;margin-bottom:20px"><strong>Important:</strong> Bring your original passport on ${esc(visitDate)}. The museum allows <strong>one ticket per passport per day</strong> — name must match exactly.</div><p style="font-size:13px;color:#888">Questions? Quote ${esc(invoiceId)} and email <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR}">${SUPPORT_EMAIL}</a></p></div><div style="padding:16px;text-align:center;font-size:11px;color:#bbb">Independent ticket procurement service. Not affiliated with Emperor Qinshihuang's Mausoleum Site Museum or any government body.</div></div>`;

  try {
    await resend.emails.send({ from: FROM, to: process.env.OPERATOR_EMAIL, subject: `🎫 New order ${invoiceId} — ${m.attraction} · ${visitDate}`, html: operatorHtml });
  } catch (err) {
    console.error('Operator email failed:', err);
    return res.status(500).json({ error: 'operator_email_failed' });
  }
  try {
    await resend.emails.send({ from: FROM, to: customerEmail, subject: `Your booking is confirmed (${invoiceId}) — ${m.attraction} · ${visitDate}`, html: customerHtml });
  } catch (err) {
    console.error('Customer email failed:', err);
  }
  return res.json({ received: true });
};
