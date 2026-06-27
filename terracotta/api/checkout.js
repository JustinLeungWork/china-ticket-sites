const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  // Number of visitors = number of passport entries (each needs its own ticket).
  const qty = Math.max(1, parseInt(visitorQty) || visitors.length);

  const lineItems = [{
    price_data: {
      currency: 'usd',
      product_data: { name: ADMISSION.name, description: `${ATTRACTION} · ${visitDate}` },
      unit_amount: ADMISSION.cents,
    },
    quantity: qty,
  }];

  const visitorMeta = {};
  visitors.forEach((v, i) => {
    visitorMeta[`v${i}`] = JSON.stringify({ n: v.name, p: v.passportNumber, nat: v.nationality, dob: v.dateOfBirth });
  });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: email,
      metadata: {
        attraction: ATTRACTION, ticketType: 'admission', ticketName: ADMISSION.name,
        visitDate, visitorQty: String(qty),
        customerEmail: email, ...visitorMeta,
      },
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#book`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
