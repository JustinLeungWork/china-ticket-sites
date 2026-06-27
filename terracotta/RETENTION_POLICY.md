# Data Retention Policy — TerracottaWarriorsTickets.com

Internal record of our personal-data retention schedule and the rationale for each
period, kept to satisfy the **PDPA Retention Limitation Obligation** (s.25), which
requires us to (a) retain personal data only as long as it serves the purpose it was
collected for or a legal/business purpose, and (b) document and apply that decision.
There is no fixed maximum period in the PDPA — the test is reasonableness.

Last reviewed: June 2026.

## Schedule

| Data | Retention | Rationale |
|---|---|---|
| **Passport number + date of birth** (sensitive) | Until **visit date + 30 days**, then delete | Needed to book and, after booking, to handle rebooking, name corrections, and the refund/chargeback window. 30 days comfortably covers the visit and the dispute window while keeping the most sensitive data for the shortest reasonable time. |
| **Name, email, visit date, booking reference** | **12 months**, then delete | Customer service and dispute resolution. |
| **Financial / transaction records** (amount, date, invoice — *no passport data*) | **5 years** | Singapore tax/accounting record-keeping. These records do **not** contain passport numbers. |
| **Payment records** | Per Stripe's retention policy | Held by Stripe as payment processor. |

## Where the data lives (and what must be deleted)

We keep **no database**. Personal data exists only in:
1. **Stripe Checkout Session metadata** (passport details, during the booking) — *known weak point; see "Hardening" below.*
2. **Operator mailbox** (the order-notification email from `/api/webhook`).
3. **Resend** transaction logs (transient).

Deleting "passport + DOB" on schedule therefore means deleting **both** the operator
email copy **and** clearing the Stripe record. The operator notification email states
this deadline explicitly.

## Operator deletion process (current — manual)

1. On each order, note `visit date + 30 days` as the deletion deadline.
2. After the QR code is issued and any rebooking window has closed, delete the
   order email (inbox + trash) and remove the passport details from the Stripe record.
3. Do not copy passport details into any other store (spreadsheet, notes, chat).

## Hardening (recommended next steps — not yet implemented)

- **Stop storing passport numbers in Stripe metadata.** Move to a "collect passports
  after payment" flow so sensitive IDs never enter Stripe. This is the single biggest
  risk reduction.
- **Automate deletion** (e.g. a scheduled job that clears passport metadata at
  `visit date + 30 days`) so retention is enforced, not reliant on manual action.

Until automated, the manual process above is the control.
