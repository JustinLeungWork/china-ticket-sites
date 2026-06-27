const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getSql, ensureSchema, newInvoiceId } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const ATTRACTION = "Terracotta Warriors Museum, Xi'an";
// Single full-price admission ticket. Every visitor (incl. children) pays the
// same — the museum's discounted child/student/senior tickets require Chinese
// ID and aren't available to foreign passport holders. The English private
// guide is handled separately as a request (see /api/enquiry), not here.
const ADMISSION = { name: 'Full-Price Admission', cents: 2599 };
// ─────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { visitDate, visitorQty, email, visitors } = req.body || {};

  if (!visitDate || !email || !Array.isArray(visitors) || visitors.length === 0)
    return res.status(400).json({ error: 'Missing required fields' });

  const qty = Math.max(1, parseInt(visitorQty) || visitors.length);
  const amountCents = ADMISSION.cents * qty;
  const invoiceId = newInvoiceId();

  // Keep only the fields we need; this is what's stored (in OUR database, never Stripe).
  const cleanVisitors = visitors.map(v => ({
    name: String(v.name || '').trim(),
    passportNumber: String(v.passportNumber || '').trim(),
    nationality: String(v.nationality || '').trim(),
    dateOfBirth: String(v.dateOfBirth || '').trim(),
  }));

  try {
    await ensureSchema();
    const sql = getSql();

    // Passport details go into our booking database, keyed by the invoice id.
    await sql`
      INSERT INTO bookings (invoice_id, email, visit_date, visitor_qty, amount_cents, currency, ticket_type, passport_data, status)
      VALUES (${invoiceId}, ${email}, ${visitDate}, ${qty}, ${amountCents}, 'usd', 'admission', ${JSON.stringify(cleanVisitors)}::jsonb, 'pending')`;

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
      // Stripe receives ONLY the invoice reference + non-sensitive fields.
      // No passport data is ever sent to Stripe.
      metadata: { invoiceId, attraction: ATTRACTION, ticketName: ADMISSION.name, visitDate, visitorQty: String(qty) },
      success_url: `${process.env.SITE_URL}/success.html?invoice=${invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#book`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    await sql`UPDATE bookings SET stripe_session_id = ${session.id} WHERE invoice_id = ${invoiceId}`;
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
