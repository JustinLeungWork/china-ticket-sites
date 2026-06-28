const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getSql, ensureSchema, newInvoiceId } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const ATTRACTION = "Terracotta Warriors Museum, Xi'an";
// Single full-price admission ticket. Every visitor (incl. children) pays the
// same — the museum's discounted child/student/senior tickets require Chinese
// ID and aren't available to foreign passport holders. The English private
// guide is handled separately as a request (see /api/enquiry), not here.
const ADMISSION = { name: 'Full-Price Admission', cents: 2600 };
// ─────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { visitDate, visitorQty, email, visitors, guideRequested } = req.body || {};

  if (!visitDate || !email || !Array.isArray(visitors) || visitors.length === 0)
    return res.status(400).json({ error: 'Missing required fields' });

  // Authoritative visit-date guard, anchored to Beijing time (GMT+8): the earliest
  // bookable day is Beijing today + 2, so today/tomorrow can never be booked even
  // if the client clock is wrong or the request is crafted. Mirrors the calendar.
  const minDate = new Date(Date.now() + 8 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  const MAX_DATE = '2026-09-30';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate) || visitDate < minDate || visitDate > MAX_DATE)
    return res.status(400).json({ error: 'Invalid visit date' });

  const qty = Math.max(1, parseInt(visitorQty) || visitors.length);
  const amountCents = ADMISSION.cents * qty;
  const invoiceId = newInvoiceId();

  // Keep only the fields we need.
  const cleanVisitors = visitors.map(v => ({
    name: String(v.name || '').trim(),
    passportNumber: String(v.passportNumber || '').trim(),
    dateOfBirth: String(v.dateOfBirth || '').trim(),
  }));

  // Store passport details in OUR database when available (so they never reach
  // Stripe). If the DB isn't configured yet (no DATABASE_URL) or is briefly
  // unavailable, fall back to Stripe metadata so checkout still works — this
  // self-heals the moment DATABASE_URL is set.
  const guideReq = !!guideRequested;
  let dbStored = false;
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO bookings (invoice_id, email, visit_date, visitor_qty, amount_cents, currency, ticket_type, passport_data, status, guide_requested, guide_size, guide_status)
      VALUES (${invoiceId}, ${email}, ${visitDate}, ${qty}, ${amountCents}, 'usd', 'admission', ${JSON.stringify(cleanVisitors)}::jsonb, 'pending', ${guideReq}, ${guideReq ? Math.min(qty, 10) : null}, ${guideReq ? 'requested' : null})`;
    dbStored = true;
  } catch (dbErr) {
    console.error('Booking DB unavailable — falling back to Stripe metadata:', dbErr.message);
  }

  const metadata = { invoiceId, attraction: ATTRACTION, ticketName: ADMISSION.name, visitDate, visitorQty: String(qty), customerEmail: email, guide: guideRequested ? 'yes' : 'no' };
  if (!dbStored) {
    // Fallback only: pack passports into metadata so the operator still gets them.
    cleanVisitors.forEach((v, i) => { metadata[`v${i}`] = JSON.stringify({ n: v.name, p: v.passportNumber, dob: v.dateOfBirth }); });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: ADMISSION.name, description: `${ATTRACTION} · ${visitDate}` },
          unit_amount: ADMISSION.cents,
        },
        quantity: qty,
      }],
      customer_email: email,
      client_reference_id: invoiceId,
      metadata,
      success_url: `${process.env.SITE_URL}/success.html?invoice=${invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#book`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    if (dbStored) {
      try { const sql = getSql(); await sql`UPDATE bookings SET stripe_session_id = ${session.id} WHERE invoice_id = ${invoiceId}`; } catch (e) {}
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
