const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getSql, ensureSchema, newInvoiceId } = require('./_db');

// ── Attraction config ─────────────────────────────────────────────────────
const ATTRACTION = 'Zhangjiajie National Forest Park (Wulingyuan)';

// Three ticket tiers. adult_bundle is adults-only; youth_admission is age 14-17.
const TICKET_TYPES = {
  adult_admission: { name: '4-Day Admission + Eco-bus (Adult)',            cents: 3900 },
  youth_admission: { name: '4-Day Admission + Eco-bus (Youth 14-17)',      cents: 2200 },
  adult_bundle:    { name: '4-Day Ticket + Full Transport Bundle (Adult)', cents: 7300 },
};

const MAX_QTY = 10;   // per ticket type per order
// ─────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { visitDate, email, adultQty, youthQty, adultType, visitors } = req.body || {};

  // adultType: 'adult_admission' | 'adult_bundle'
  // adultQty: integer >= 0
  // youthQty: integer >= 0 (only valid when adultType === 'adult_admission')
  // visitors: array of { name, passportNumber, dateOfBirth }

  if (!visitDate || !email || !Array.isArray(visitors) || visitors.length === 0)
    return res.status(400).json({ error: 'Missing required fields' });

  const ticketAdultType = (adultType === 'adult_bundle') ? 'adult_bundle' : 'adult_admission';
  const adultCount = Math.max(0, Math.min(MAX_QTY, parseInt(adultQty) || 0));
  // Youth tickets are only available with standard admission, not the bundle
  const youthCount = (ticketAdultType === 'adult_admission')
    ? Math.max(0, Math.min(MAX_QTY, parseInt(youthQty) || 0))
    : 0;

  if (adultCount + youthCount < 1)
    return res.status(400).json({ error: 'At least one ticket is required' });
  if (adultCount + youthCount !== visitors.length)
    return res.status(400).json({ error: 'Visitor count does not match ticket quantities' });

  // Authoritative visit-date guard anchored to Beijing time (GMT+8): earliest
  // bookable day is Beijing today + 2.
  const minDate = new Date(Date.now() + 8 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
  const MAX_DATE = '2026-12-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate) || visitDate < minDate || visitDate > MAX_DATE)
    return res.status(400).json({ error: 'Invalid visit date' });

  const adultCents = TICKET_TYPES[ticketAdultType].cents * adultCount;
  const youthCents = TICKET_TYPES.youth_admission.cents * youthCount;
  const totalCents = adultCents + youthCents;

  // Composite ticket_type stored as a readable string, e.g. "adult_admission:2,youth_admission:1"
  const ticketTypeStr = [
    adultCount > 0 ? `${ticketAdultType}:${adultCount}` : null,
    youthCount > 0 ? `youth_admission:${youthCount}` : null,
  ].filter(Boolean).join(',');

  const invoiceId = newInvoiceId();

  // Keep only the fields we need.
  const cleanVisitors = visitors.map(v => ({
    name:           String(v.name || '').trim(),
    passportNumber: String(v.passportNumber || '').trim(),
    dateOfBirth:    String(v.dateOfBirth || '').trim(),
  }));

  // Store passport details in OUR database (not in Stripe). Fall back to
  // Stripe metadata if the DB is unavailable so checkout still works.
  let dbStored = false;
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO bookings
        (invoice_id, email, visit_date, visitor_qty, adult_qty, youth_qty,
         amount_cents, currency, ticket_type, passport_data, status)
      VALUES
        (${invoiceId}, ${email}, ${visitDate}, ${adultCount + youthCount},
         ${adultCount}, ${youthCount}, ${totalCents}, 'usd',
         ${ticketTypeStr}, ${JSON.stringify(cleanVisitors)}::jsonb, 'pending')`;
    dbStored = true;
  } catch (dbErr) {
    console.error('Booking DB unavailable — falling back to Stripe metadata:', dbErr.message);
  }

  const metadata = {
    invoiceId,
    attraction:    ATTRACTION,
    visitDate,
    adultQty:      String(adultCount),
    youthQty:      String(youthCount),
    adultType:     ticketAdultType,
    customerEmail: email,
  };
  if (!dbStored) {
    cleanVisitors.forEach((v, i) => {
      metadata[`v${i}`] = JSON.stringify({ n: v.name, p: v.passportNumber, dob: v.dateOfBirth });
    });
  }

  // Build Stripe line items — up to 2 (adult + youth).
  const lineItems = [];
  if (adultCount > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: TICKET_TYPES[ticketAdultType].name,
          description: `${ATTRACTION} · Valid 4 days from ${visitDate}`,
        },
        unit_amount: TICKET_TYPES[ticketAdultType].cents,
      },
      quantity: adultCount,
    });
  }
  if (youthCount > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: TICKET_TYPES.youth_admission.name,
          description: `${ATTRACTION} · Valid 4 days from ${visitDate} · Passport required at gate`,
        },
        unit_amount: TICKET_TYPES.youth_admission.cents,
      },
      quantity: youthCount,
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: email,
      client_reference_id: invoiceId,
      metadata,
      success_url: `${process.env.SITE_URL}/success.html?invoice=${invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#book`,
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    });

    if (dbStored) {
      try {
        const sql = getSql();
        await sql`UPDATE bookings SET stripe_session_id = ${session.id} WHERE invoice_id = ${invoiceId}`;
      } catch (e) {}
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
