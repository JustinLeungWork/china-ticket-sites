# Data Retention Policy — Terracotta Tickets

Internal record of our personal-data retention schedule and rationale, kept to satisfy
the **PDPA Retention Limitation Obligation** (s.25): retain personal data only as long
as it serves the purpose it was collected for or a legal/business purpose, then delete.
There is no fixed maximum period in the PDPA — the test is reasonableness — so we do
**not** publish an arbitrary day count for sensitive data; we tie it to the actual need.

Last reviewed: June 2026.

## Schedule

| Data | Retention | Rationale |
|---|---|---|
| **Passport number + date of birth** (sensitive) | Until the **visit date has passed**, then **purged automatically** | Needed up to and including the visit to book and re-submit if the booking bounces / needs a name correction. Once the visit date is past, there is no further need — so it is purged. Shortest reasonable retention for the most sensitive data. |
| **Name, email, visit date, invoice ID** | Up to 12 months, then delete | Customer service and dispute resolution. |
| **Financial / transaction records** (invoice ID, amount, date — *no passport data*) | Up to 5 years | Singapore tax/accounting record-keeping. Contains no passport data. |
| **Payment records** | Per Stripe's retention policy | Held by Stripe as payment processor. |

## Architecture (target)

- **Lightweight booking database** is the system of record. Each booking row holds an
  **invoice ID**, the non-sensitive order data (email, visit date, visitor count,
  amount, Stripe session ID, status) and a sensitive `passport_data` field.
- **Passport data is NOT sent to Stripe.** Stripe receives only the invoice ID + the
  non-sensitive fields in metadata. This keeps sensitive IDs out of Stripe entirely.
- **Automated purge:** a scheduled job clears `passport_data` for any booking whose
  visit date has passed. No reliance on manual deletion.
- The operator order-notification email still contains passport details (needed to book
  on bmy.com.cn); the operator deletes that email copy after booking.

## Operator process

1. Book on bmy.com.cn using the passport details in the order email.
2. Forward QR codes to the customer.
3. Delete the order email after the booking is issued. (The database purges the stored
   copy automatically once the visit date passes.)
4. Never copy passport details into any other store (spreadsheet, notes, chat).
