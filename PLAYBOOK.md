# Site Playbook — china-ticket-sites

Everything needed to understand, operate, and launch a new site in this network.

---

## What this network is

We sell attraction tickets to international tourists who cannot buy them directly through China's official booking systems (which require a Chinese phone number + WeChat Pay or Alipay). We hold the necessary Chinese accounts, book on the customer's behalf, and deliver confirmed QR codes by email within 24 hours.

**Operator:** Justin Leung (Hong Kong / Singapore)  
**Live sites:** terracotta-tickets.com (Terracotta Warriors, Xi'an)  
**In progress:** Mutianyu Great Wall, Zhangjiajie National Forest Park

---

## Site requirements summary

Every site in this network does the following:

### Booking flow
1. Customer selects visit date + time slot + visitor quantity
2. Submits full passport details for every visitor (name, passport number, date of birth)
3. Pays via Stripe Checkout (Visa, Mastercard, Apple Pay — in USD)
4. Receives an order confirmation email immediately
5. Receives QR codes by email within 24 hours (sent manually by operator after booking on the Chinese system)

### Operator flow
1. Receives operator email with all booking details + passport data
2. Logs into the Chinese booking system (bmy.com.cn, mutianyu.com, etc.)
3. Submits each passport individually to obtain one QR code per person
4. Forwards QR codes to the customer via email
5. Manages guide upsells through the admin dashboard

### Guide upsell flow (optional, per site)
1. Customer flags guide interest at checkout (no charge yet)
2. Operator checks availability via agency
3. Admin sends Stripe payment link for guide fee (24-hour expiry)
4. Customer pays; operator assigns guide details
5. Admin sends guide info email (meeting point, time, guide name)

---

## Tech stack

| Component | Tool | Notes |
|-----------|------|-------|
| Hosting | Vercel | Serverless functions + static HTML |
| Database | Neon Postgres (serverless) | One DB per site |
| Payments | Stripe Checkout | Webhooks for payment confirmation |
| Email | Resend | Transactional, via `bookings@[domain]` |
| Admin | Node.js HTTP server | localhost:8787, not deployed to Vercel |
| Analytics | Vercel Analytics | Script injected on all public pages |

**Runtime:** Node.js ≥ 18. No framework — plain HTML + Vercel serverless functions.

---

## What's ticket-specific (required for every new site)

These are the things a generic booking/e-commerce site would not need, but every ticket site in this network does.

### 1. Passport collection — one per visitor, not per order
```
{ name, passportNumber, dateOfBirth }[]
```
- Stored in Postgres as `passport_data JSONB`
- Never sent to Stripe (PDPA compliance — stored locally, purged after visit)
- Collected for every individual visitor, not just the lead booker
- Displayed in operator email for manual submission to Chinese booking system

### 2. Time slot selector
- Attractions operate on fixed 1-hour entry windows (e.g., 08:30–09:30)
- Slot selection happens at booking time, not after payment
- Slot must be passed through to Chinese booking system during manual fulfilment

### 3. Visit date constraints
- `min = today + 2 days` (Beijing time, not server time)
- `max = [season end date]` — update per season
- Booking window on Chinese systems: 7 days in advance for most attractions
- Dates must be validated server-side before creating Stripe session

### 4. Visitor quantity limits
- Per-order cap (default: 10 tickets) — enforced server-side
- Per-passport limit: 1 ticket per passport number (enforced by Chinese system)
- Operator emails must list every passport — bulk submission is not possible

### 5. Invoice ID format
```
[SITE_CODE]-[YYYYMMDD]-[4CHAR_RANDOM]
```
e.g., `TW-20260629-A3KX` (Terracotta Warriors), `MW-20260629-B7PQ` (Mutianyu Wall)

Site codes: TW = Terracotta, MW = Mutianyu, ZJ = Zhangjiajie

### 6. Dual-email on payment confirmation
Both emails fire in the same webhook handler:

| Email | Recipient | Contains |
|-------|-----------|---------|
| Operator email | `OPERATOR_EMAIL` env var | All passport data + instructions to book on Chinese system |
| Customer email | Booking email | Confirmation + QR delivery timeline + guide upsell if requested |

### 7. Sensitive data purge (PDPA)
- Passport data is purged automatically once `visit_date` passes
- Email is anonymised to `[deleted]` after 12 months
- Financial records (invoice_id, amount, currency, date) kept 5 years (tax)
- Implemented as a Vercel Cron job (`/api/purge`, daily 03:00 UTC)
- **This is legally required. Every new site must have it.**

### 8. Booking date: Chinese timezone
```js
const nowBeijing = new Date(Date.now() + 8*60*60*1000);
```
Minimum bookable date must be calculated in Beijing time (UTC+8), not the server's local time.

---

## What's NOT ticket-specific (generic, reusable)

These patterns apply to any service site in this network, not just tickets.

| Concern | Pattern |
|---------|---------|
| Stripe Checkout + webhooks | Standard — see `api/checkout.js`, `api/webhook.js` |
| Resend transactional email | Standard — branded HTML templates |
| Neon Postgres connection | `@neondatabase/serverless`, `neon(DATABASE_URL)` |
| `.env` loading | Force-override: `process.env[key] = val` unconditionally (Windows system vars shadow site .env otherwise) |
| Admin dashboard | Multi-site: `SITES=terracotta,mutianyu`; per-site prefixed vars (`TERRACOTTA_DATABASE_URL`) |
| SEO/GEO schema | See SEO_GEO_PLAYBOOK.md |
| Multilingual pages | `/ko/`, `/ja/`, `/id/`, `/th/`, `/es/`, `/fr/`, `/pt/` subfolders + hreflang |
| Analytics | `<script defer src="/_vercel/insights/script.js"></script>` before `</head>` |

---

## Site inventory

| Site | Attraction | Domain | Status | Site code | DB | Guide | Admin |
|------|-----------|--------|--------|---------|----|----|-----|
| terracotta | Terracotta Warriors, Xi'an | terracotta-tickets.com | ✅ Production-ready | TW | Neon | ✅ | ✅ |
| mutianyu | Mutianyu Great Wall, Beijing | — | ⚠️ Legacy (no DB) | MW | None | ❌ | ❌ |
| zhangjiajie | Zhangjiajie Forest Park, Hunan | — | ⚠️ Legacy (no DB) | ZJ | None | ❌ | ❌ |

**Legacy sites** (mutianyu, zhangjiajie): functional for basic bookings but store passport data in Stripe metadata only (not purged automatically — PDPA risk). Upgrade path: add Neon DB + purge cron + admin dashboard using terracotta as the template.

---

## Environment variables — every site

```env
# Core
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
DATABASE_URL=postgresql://...       # Neon connection string
RESEND_API_KEY=re_...

# Site identity
BRAND_NAME=Terracotta Tickets
BRAND_COLOR=#6B3200
SITE_URL=https://terracotta-tickets.com
EMAIL_DOMAIN=terracotta-tickets.com
SUPPORT_EMAIL=support@terracotta-tickets.com
OPERATOR_EMAIL=justin@...           # Where operator notifications go

# Optional
GUIDE_CENTS=15000                   # Guide fee in USD cents ($150)
CRON_SECRET=...                     # Vercel injects automatically for cron auth

# Admin (local only, not deployed)
SITES=terracotta                    # Comma-separated list for multi-site admin
TERRACOTTA_DATABASE_URL=...         # Site-prefixed override (optional if only one site)
ADMIN_PORT=8787
```

---

## Launching a new site — checklist

### 1. Code setup
- [ ] Copy `terracotta/` as template (preferred over mutianyu/zhangjiajie — it's the canonical version)
- [ ] Update all attraction-specific strings: name, location, time slots, pricing, min/max dates
- [ ] Set site code for invoice IDs (e.g., `MW` for Mutianyu)
- [ ] Update pricing array and ticket types in `api/checkout.js`
- [ ] Update operator email template (Chinese booking URL, submission steps)

### 2. Infrastructure
- [ ] Create Neon Postgres project for the site
- [ ] Create Vercel project, connect repo, set env vars
- [ ] Set up Stripe (webhook endpoint pointing to `/api/webhook`)
- [ ] Set up Resend sending domain (`bookings@[newdomain]`)
- [ ] Add site to admin dashboard: add to `SITES=` and add `[SITE]_DATABASE_URL` env var

### 3. Content
- [ ] Write homepage (booking form + FAQ with 8–10 Q&As)
- [ ] Write Visitor Guide page (`/guide.html`)
- [ ] Write About page (`/about.html`) — reuse founder story, update attraction details
- [ ] Write `llms.txt` (see terracotta template)
- [ ] Translate all 7 locales (ko, ja, id, th, es, fr, pt) — human review required

### 4. SEO/GEO — required before launch
Full detail in `docs/SEO_GEO_PLAYBOOK.md`. Minimum required:
- [ ] FAQPage schema with 8+ Q&As
- [ ] Service schema with `offers` (price in USD, priceCurrency)
- [ ] TouristAttraction schema (with `alternateName` in Chinese + pinyin)
- [ ] Organization schema
- [ ] Person schema (Justin Leung, Singapore) on About page
- [ ] Google site verification meta tag
- [ ] Sitemap with hreflang cross-links
- [ ] `llms.txt` at root
- [ ] Vercel Analytics enabled
- [ ] Google Search Console set up
- [ ] Bing Webmaster Tools set up (required for Perplexity/ChatGPT visibility)

### 5. Compliance
- [ ] PDPA purge cron wired up (`/api/purge`, daily 03:00 UTC)
- [ ] Passport data stored in DB, not Stripe metadata
- [ ] Privacy Policy updated for the new site
- [ ] Consent checkbox on booking form
- [ ] `RETENTION_POLICY.md` copied/updated for the site

### 6. Benchmark
- [ ] Create `docs/benchmarks/[site]-[YYYY-MM-DD]-baseline.md` on launch day
- [ ] Record: pages indexed (Google + Bing), AI citations, target query rankings
- [ ] Schedule 30-day follow-up check

---

## DB schema — standard for all sites

```sql
CREATE TABLE IF NOT EXISTS bookings (
  invoice_id        TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  visit_date        DATE NOT NULL,
  time_slot         TEXT,
  visitor_qty       INT,
  amount_cents      INT,
  currency          TEXT DEFAULT 'usd',
  ticket_type       TEXT DEFAULT 'admission',
  passport_data     JSONB,             -- purged after visit_date
  status            TEXT DEFAULT 'pending',
  stripe_session_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,
  purged_at         TIMESTAMPTZ,

  -- Guide upsell columns
  guide_requested       BOOLEAN DEFAULT FALSE,
  guide_size            INT,
  guide_status          TEXT,          -- requested | link_sent | paid
  guide_amount_cents    INT,
  guide_session_id      TEXT,
  guide_link_sent_at    TIMESTAMPTZ,
  guide_paid_at         TIMESTAMPTZ,

  -- Admin columns (added by admin server on first run)
  guide_agency_checked  TIMESTAMPTZ,
  guide_notes           TEXT,
  guide_info_sent_at    TIMESTAMPTZ
);
```

`passport_data` format:
```json
[
  { "name": "LEUNG TAK WA", "passportNumber": "HK1234567", "dateOfBirth": "1990-03-15" }
]
```

---

## Admin dashboard — operating instructions

Run locally from `terracotta/`:
```
npm run admin
# Opens at http://localhost:8787
```

**Guide workflow (step by step):**

1. Customer books with guide request → `guide_status = 'requested'`
2. Dashboard shows badge `[Requested]` with visitor count
3. Operator contacts agency to check availability for that date
4. Check the "Agency" checkbox in the dashboard → `guide_agency_checked` timestamp saved
5. If confirmed: click **Send [price]** → guide payment link emailed to customer (24h Stripe session)
6. Customer pays → webhook fires → `guide_status = 'paid'`
7. Enter meeting point, guide name, time in the Notes field → auto-saved on blur
8. Click **Send info** → customer receives guide details email

---

## Recurring operations

| Task | Frequency | How |
|------|-----------|-----|
| Book confirmed tickets on Chinese system | Per order (within 24h) | Manually via operator email |
| Send QR codes to customer | Per order (after booking) | Forward from Chinese system or email manually |
| Check guide availability | Per guide request | Contact agency, mark in admin |
| Send guide payment links | Per guide request | Admin dashboard → "Send link" |
| Review new bookings | Daily | Admin dashboard → http://localhost:8787 |
| Update booking window max date | Per season | Update `maxDate` in index.html |
| Run benchmark check | Monthly | See `docs/benchmarks/` |

---

## Key files per site

```
[site]/
├── index.html              ← Booking form + FAQ + schema markup (main product page)
├── guide.html              ← Visitor guide (how to get there, what to bring)
├── about.html              ← Founder story + Person schema
├── success.html            ← Post-payment confirmation page
├── cancel.html             ← Cancelled checkout page
├── guide-success.html      ← Post-guide-payment confirmation
├── llms.txt                ← AI crawler description
├── sitemap.xml             ← Sitemap with hreflang
├── robots.txt              ← Allow search bots, block training bots
├── privacy.html            ← PDPA privacy policy
├── terms.html              ← Terms of service
├── refunds.html            ← Refund policy
├── RETENTION_POLICY.md     ← Data retention documentation
├── ko/, ja/, id/, th/, es/, fr/, pt/  ← Translated locale subfolders
├── api/
│   ├── checkout.js         ← Stripe Checkout session creation + DB insert
│   ├── webhook.js          ← Payment confirmation + dual email send
│   ├── enquiry.js          ← Guide enquiry form handler
│   └── purge.js            ← PDPA purge cron (daily 03:00 UTC)
├── admin/
│   ├── server.js           ← Local admin HTTP server (localhost:8787)
│   └── index.html          ← Admin dashboard UI
├── package.json
└── vercel.json
```

---

## What to reuse vs customise per site

| Item | Reuse from terracotta | Customise |
|------|----------------------|-----------|
| API endpoint logic | ✅ Copy directly | Ticket types, pricing, max qty |
| DB schema | ✅ Identical | — |
| Admin server.js | ✅ Copy directly | — |
| Admin index.html | ✅ Copy directly | — |
| Email templates | ✅ Structure + styles | Attraction name, operator instructions |
| SEO schema | ✅ Templates from SEO_GEO_PLAYBOOK.md | Attraction details, prices |
| About page | ✅ Founder story identical | Attraction section |
| Privacy/Terms/Refunds | ✅ Copy | Site name, dates |
| CSS design system | ✅ `--primary`, `--accent` vars | Brand colour per site |
| FAQ Q&As | ⚠️ Partially | Chinese payment barrier Q&As identical; attraction-specific ones differ |
| Time slots | ❌ Site-specific | Each attraction has different opening hours |
| Visitor guide | ❌ Site-specific | Directions, tips entirely different |
| Locale translations | ❌ Site-specific | All content different |

---

## Currency conversion system

All pages show a local-price hint (e.g. `~€23`) next to USD prices for visitors whose browser language matches a supported currency. The system is purely client-side — no server changes needed.

### How it works

1. **`data-usd` attribute** — add `data-usd="25.99"` to any price element. The JS reads this and appends the hint.
2. **RATES table** — a hardcoded JS object mapping currency codes to symbol, rate, and browser language prefixes.
3. **Currency detection** — `navigator.language` is lowercased and matched against each currency's `langs` array (exact match or prefix match on the base language code).
4. **Hint injection** — a `<span class="local-price-hint">` is appended inside the matched element.

### RATES table (current — update rates periodically)

```javascript
var RATES = {
  EUR: { sym:'€',   rate:0.92,  langs:['fr','de','it','nl','pt','pl','ro','el','cs','sv','fi','da','sk','hu','bg','hr','sl','et','lv','lt'] },
  GBP: { sym:'£',   rate:0.79,  langs:['en-gb'] },
  AUD: { sym:'A$',  rate:1.54,  langs:['en-au'] },
  CAD: { sym:'C$',  rate:1.37,  langs:['en-ca'] },
  SGD: { sym:'S$',  rate:1.35,  langs:['en-sg','ms-sg'] },
  KRW: { sym:'₩',   rate:1360,  langs:['ko'], round:100 },
  JPY: { sym:'¥',   rate:155,   langs:['ja'], round:10 },
  IDR: { sym:'Rp ', rate:16300, langs:['id'], round:1000 },
  THB: { sym:'฿',   rate:35,    langs:['th'], round:1 },
  MYR: { sym:'RM',  rate:4.7,   langs:['ms','ms-my'] },
  HKD: { sym:'HK$', rate:7.8,   langs:['zh-hk'] },
  TWD: { sym:'NT$', rate:32,    langs:['zh-tw'] },
};
```

- `round` — if set, the converted value is rounded to the nearest multiple (e.g. KRW rounds to 100 won)
- French (`fr`) and Portuguese (`pt`) both fall into the EUR group — they get euro hints automatically
- USD visitors see no hint (USD is baseline)

### CSS for the hint

```css
.local-price-hint { font-size: 0.82em; color: rgba(255,255,255,0.55); margin-left: 4px; white-space: nowrap; }
```

Add this to the site's style block. Adjust colour if the price is on a light background.

### Applying to a page

1. Add `data-usd="<price>"` to every price-displaying element
2. Drop the RATES script block just before `</body>` (after all booking JS)
3. Add the `.local-price-hint` CSS rule to the style block

The script is already included in all pages in this repo. When creating a new locale page, copy it verbatim — do NOT translate or modify the RATES object.

---

## How to add a new locale

Adding a language (e.g. German `/de/`) involves these steps across all sites where you want it:

### 1. Create the translated page

Copy the English `index.html` for each site and translate all visible text:
- `<html lang="de">`, `<title>`, `<meta name="description">`, og/twitter tags
- `<link rel="canonical">` → `https://[site]/de/`
- All schema JSON-LD text fields (name, description, FAQ questions/answers)
- All body HTML text (hero, booking form labels, steps, FAQ, footer)
- JS strings: DOW/MON arrays, alert() messages, button text, visitor labels
- Update lang-select JS path detection to include the new locale

**Do NOT change:** CSS, JS logic, class names, IDs, data-* attributes, prices, RATES block.

### 2. Add hreflang to ALL pages

Every page on the site (English + all existing locales + the new one) must declare the new locale in its `<head>`:

```html
<link rel="alternate" hreflang="de" href="https://[site]/de/">
```

Use the batch script pattern (see `scripts/patch_hreflang.py` in scratchpad) or manually edit each file. Don't forget x-default always points to the English root.

### 3. Add the locale to all lang-select dropdowns

In every `index.html` (English + all existing locale pages), add the new `<option>` to the lang-select `<select>`:

```html
<option value="/de/">🇩🇪 Deutsch</option>
```

And update the lang-select path-detection JS to handle `/de`.

For terracotta, also add a button to the lang-modal (`#langOverlay`).

### 4. Update sitemaps

In each site's `sitemap.xml`:
- Add `<xhtml:link rel="alternate" hreflang="de" ...>` to the main URL's hreflang block
- Add a new `<url>` entry for `/de/` with the self-referencing hreflang + en fallback

### 5. Update schema availableLanguage (terracotta only)

In `terracotta/index.html`, add `"German"` to the `availableLanguage` array in the Service schema.

### 6. Update CLAUDE.md and PLAYBOOK.md

- `.claude/CLAUDE.md`: add the new locale to the Sites table
- `PLAYBOOK.md`: update the locale list in the patterns table and checklist

### Currency notes for new locales

Check the RATES table above:
- German (`de`) → already in EUR group ✅
- If the new language isn't in RATES, add it to the appropriate currency's `langs` array, or add a new currency entry with the correct symbol and exchange rate
