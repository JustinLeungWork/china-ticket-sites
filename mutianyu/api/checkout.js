const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── Attraction config ─────────────────────────────────────────────────────
const ATTRACTION = 'Mutianyu Great Wall, Beijing';
const TICKETS = {
  admission: { name: 'Admission + Shuttle Bus',  adultCents: 1200, childCents: 600  },
  cablecar:  { name: 'Admission + Cable Car Up', adultCents: 3200, childCents: 1600 },
  toboggan:  { name: 'Cable Car + Toboggan',     adultCents: 4200, childCents: 2100 },
};
// ─────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ticketType, visitDate, adultQty, childQty, email, visitors } = req.body || {};

  if (!ticketType || !visitDate || !email || !Array.isArray(visitors) || visitors.length === 0)
    return res.status(400).json({ error: 'Missing required fields' });

  const ticket = TICKETS[ticketType];
  if (!ticket) return res.status(400).json({ error: 'Invalid ticket type' });

  const adults   = Math.max(1, parseInt(adultQty)  || 1);
  const children = Math.max(0, parseInt(childQty)  || 0);

  const lineItems = [{
    price_data: {
      currency: 'usd',
      product_data: { name: `${ticket.name} — Adult`, description: `${ATTRACTION} · ${visitDate}` },
      unit_amount: ticket.adultCents,
    },
    quantity: adults,
  }];

  if (children > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: `${ticket.name} — Child (under 18)`, description: `${ATTRACTION} · ${visitDate}` },
        unit_amount: ticket.childCents,
      },
      quantity: children,
    });
  }

  // One Stripe metadata key per visitor (50 keys × 500 chars — no truncation risk)
  const visitorMeta = {};
  visitors.forEach((v, i) => {
    visitorMeta[`v${i}`] = JSON.stringify({ n: v.name, p: v.passportNumber, nat: v.nationality, dob: v.dateOfBirth, t: v.type });
  });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: email,
      metadata: {
        attraction:    ATTRACTION,
        ticketType,
        ticketName:    ticket.name,
        visitDate,
        adultQty:      String(adults),
        childQty:      String(children),
        customerEmail: email,
        ...visitorMeta,
      },
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#book`,
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
