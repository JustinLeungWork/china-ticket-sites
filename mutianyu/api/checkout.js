const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getSql, ensureSchema, newInvoiceId } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const ATTRACTION = 'Mutianyu Great Wall, Beijing';
// Three ticket tiers — price in cents (USD).
const TICKET_TYPES = {
  admission:                   { name: 'Admission Only',                                 cents: 1100 },
  admission_shuttle:           { name: 'Admission + Round-trip Shuttle Bus',             cents: 1400 },
  admission_shuttle_cable_car: { name: 'Admission + Shuttle Bus + Round-trip Cable Car', cents: 3300 },
};
const MAX_QTY = 10;  // tickets per order
const MAX_DATE = '2026-12-31';
// ─────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ticketType, visitDate, visitorQty, email, visitors } = req.body || {};

  if (!ticketType || !visitDate || !email || !Array.isArray(visitors) || visitors.length === 0)
    return res.status(400).json({ error: 'Missing required fields' });

  const tier = TICKET_TYPES[ticketType];
  if (!tier) return res.status(400).json({ error: 'Invalid ticket type' });

  // Authoritative visit-date guard, anchored to Beijing time (GMT+8): the earliest
  // bookable day is Beijing today + 2, so today/tomorrow can never be booked even
  // if the client clock is wrong or the request is crafted. Mirrors the calendar.
  const minDate = new Date(Date.now() + 8 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate) || visitDate < minDate || visitDate > MAX_DATE)
    return res.status(400).json({ error: 'Invalid visit date' });

  const qty = Math.min(MAX_QTY, Math.max(1, parseInt(visitorQty) || visitors.length));
  const amountCents = tier.cents * qty;
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
  let dbStored = false;
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO bookings (invoice_id, email, visit_date, visitor_qty, amount_cents, currency, ticket_type, passport_data, status)
      VALUES (${invoiceId}, ${email}, ${visitDate}, ${qty}, ${amountCents}, 'usd', ${ticketType}, ${JSON.stringify(cleanVisitors)}::jsonb, 'pending')`;
    dbStored = true;
  } catch (dbErr) {
    console.error('Booking DB unavailable — falling back to Stripe metadata:', dbErr.message);
  }

  const metadata = {
    invoiceId,
    attraction: ATTRACTION,
    ticketType,
    ticketName: tier.name,
    visitDate,
    visitorQty: String(qty),
    customerEmail: email,
  };
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
          product_data: { name: tier.name, description: `${ATTRACTION} · ${visitDate}` },
          unit_amount: tier.cents,
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
