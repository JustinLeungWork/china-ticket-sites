const { getSql, ensureSchema } = require('./_db');

// Automated data-retention purge. Run daily by Vercel Cron (see vercel.json).
// Clears passport data once it is no longer needed:
//   - bookings whose visit date has passed, and
//   - abandoned/unpaid checkouts (Stripe sessions expire in 30 min).
// The non-sensitive invoice/financial record is kept for disputes and tax.
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
    const rows = await sql`
      UPDATE bookings
      SET passport_data = NULL, purged_at = now()
      WHERE passport_data IS NOT NULL
        AND (visit_date < CURRENT_DATE
             OR (status = 'pending' AND created_at < now() - INTERVAL '1 day'))
      RETURNING invoice_id`;
    return res.status(200).json({ purged: rows.length });
  } catch (err) {
    console.error('Purge error:', err.message);
    return res.status(500).json({ error: 'purge_failed' });
  }
};
