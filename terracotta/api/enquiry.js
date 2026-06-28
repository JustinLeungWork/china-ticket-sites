const { Resend } = require('resend');

// ── Config ─────────────────────────────────────────────────────────────────
const BRAND_NAME    = 'Terracotta Tickets';
const BRAND_COLOR   = '#6B3200';
const SUPPORT_EMAIL = 'hello@terracotta-tickets.com';
const GUIDE_PRICE   = '$150 USD';   // flat, up to 10 people
// ─────────────────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);

// Private English guide is booked on request: we check availability first,
// then email the customer a payment link. No charge is taken here.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, visitDate, groupSize, message } = req.body || {};

  if (!name || !email || !email.includes('@') || !visitDate || !groupSize)
    return res.status(400).json({ error: 'Missing required fields' });

  const size = Math.max(1, Math.min(10, parseInt(groupSize) || 1));
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const firstName = esc(String(name).split(' ')[0] || 'there');
  const FROM = `${BRAND_NAME} <bookings@${process.env.EMAIL_DOMAIN}>`;

  const operatorHtml = `<div style="font-family:Arial,sans-serif;max-width:600px"><div style="background:${BRAND_COLOR};color:#fff;padding:20px 24px"><h2 style="margin:0;font-size:18px">New Guide Request — Check Availability</h2><p style="margin:6px 0 0;opacity:.8;font-size:13px">${BRAND_NAME} · Private English Guide</p></div><div style="padding:24px;background:#f9f9f9"><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;width:140px">Name</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(name)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Email</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(email)}</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Preferred date</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px"><strong>${esc(visitDate)}</strong></td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Group size</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${size} (max 10)</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px">Quote</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${GUIDE_PRICE} flat</td></tr><tr><td style="padding:7px 10px;border:1px solid #eee;background:#fafafa;font-size:13px;vertical-align:top">Message</td><td style="padding:7px 10px;border:1px solid #eee;font-size:13px">${esc(message) || '—'}</td></tr></table><div style="background:#fff3cd;border-left:4px solid #ffc107;padding:14px;font-size:13px;line-height:1.6;border-radius:2px"><strong>ACTION REQUIRED:</strong><br>1. Check guide availability for ${esc(visitDate)}.<br>2. Reply to <strong>${esc(email)}</strong> to confirm + send a Stripe payment link (${GUIDE_PRICE}).</div></div></div>`;

  const customerHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto"><div style="background:${BRAND_COLOR};color:#fff;padding:24px;text-align:center"><h1 style="margin:0;font-size:20px">Guide Request Received</h1><p style="margin:8px 0 0;opacity:.8;font-size:13px">Private English Guide · Terracotta Warriors</p></div><div style="padding:24px;background:#f8f8f8"><p style="font-size:15px;margin-bottom:8px">Hi ${firstName},</p><p style="font-size:14px;color:#555;line-height:1.65;margin-bottom:20px">Thanks for your request. We're checking guide availability for your date and will email you within <strong>24 hours</strong> to confirm and send a secure payment link (${GUIDE_PRICE}, up to 10 people). <strong>No payment is due yet.</strong></p><div style="background:#fff;border:1px solid #eee;border-radius:4px;padding:20px;margin-bottom:20px"><table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:5px 0;color:#888">Preferred date</td><td style="padding:5px 0;text-align:right"><strong>${esc(visitDate)}</strong></td></tr><tr><td style="padding:5px 0;color:#888">Group size</td><td style="padding:5px 0;text-align:right">${size}</td></tr><tr><td style="padding:5px 0;color:#888">Guide fee</td><td style="padding:5px 0;text-align:right">${GUIDE_PRICE} (flat)</td></tr></table></div><p style="font-size:13px;color:#888">Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR}">${SUPPORT_EMAIL}</a></p></div><div style="padding:16px;text-align:center;font-size:11px;color:#bbb">Independent ticket procurement service. Not affiliated with Emperor Qinshihuang's Mausoleum Site Museum or any government body.</div></div>`;

  try {
    await resend.emails.send({ from: FROM, to: process.env.OPERATOR_EMAIL, replyTo: email, subject: `🧑‍🏫 Guide request — ${visitDate} · ${size} pax`, html: operatorHtml });
  } catch (err) {
    console.error('Operator enquiry email failed:', err);
    return res.status(500).json({ error: 'operator_email_failed' });
  }
  try {
    await resend.emails.send({ from: FROM, to: email, subject: `We received your guide request — Terracotta Warriors`, html: customerHtml });
  } catch (err) {
    console.error('Customer enquiry email failed:', err);
  }
  return res.status(200).json({ ok: true });
};
