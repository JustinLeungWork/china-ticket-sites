const { getSql, ensureSchema } = require('./_db');

// Automated data-retention purge. Run daily by Vercel Cron (see vercel.json).
// Per the retention policy:
//   1. Passport + DOB — cleared once the visit date has passed, and for
//      abandoned/unpaid checkouts (Stripe sessions expire in 30 min).
//   2. Customer email — removed after 12 months (dispute window).
// The non-personal financial record (invoice, amount, date) is kept for tax.
module.exports = async (req, res) => {
  // Vercel includes "Authorization: Bearer <CRON_SECRET>" on cron calls when the
  // CRON_SECRET env var is set. If set, require it so the endpoint can't be
  // triggered publicly.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await ensureSchema();
    const sql = getSql();
    // 1. Passport + DOB once no longer needed.
    // For Zhangjiajie the ticket is valid for 4 days from visit_date, so purge
    // passport data 5 days after the start date (giving the full 4-day window).
    const purged = await sql`
      UPDATE bookings
      SET passport_data = NULL, purged_at = now()
      WHERE passport_data IS NOT NULL
        AND (visit_date < CURRENT_DATE - INTERVAL '5 days'
             OR (status = 'pending' AND created_at < now() - INTERVAL '1 day'))
      RETURNING invoice_id`;
    // 2. Customer email after 12 months; financial record (invoice/amount/date) kept.
    const anonymized = await sql`
      UPDATE bookings
      SET email = '[deleted]', purged_at = now()
      WHERE email <> '[deleted]'
        AND created_at < now() - INTERVAL '12 months'
      RETURNING invoice_id`;
    return res.status(200).json({ purged: purged.length, anonymized: anonymized.length });
  } catch (err) {
    console.error('Purge error:', err.message);
    return res.status(500).json({ error: 'purge_failed' });
  }
};
