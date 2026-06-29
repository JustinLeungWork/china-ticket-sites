# Skill: analytics

Invoke with `/analytics` to pull a live dashboard combining Vercel traffic, Stripe revenue, and Neon booking counts for all three china-ticket-sites.

---

## What this skill does

1. Reads recent Vercel Web Analytics (visitors, pages, countries, referrers)
2. Reads recent Stripe charges (revenue, booking count, last payment)
3. Reads Neon booking table (pending/confirmed/refunded counts)
4. Prints a combined markdown summary with actionable observations

---

## Credentials (all in `terracotta/.env`)

| Key | Used for |
|-----|---------|
| `VERCEL_TOKEN` | Vercel Analytics API — **must be a full personal access token** (see below) |
| `STRIPE_SECRET_KEY` | Stripe API |
| `DATABASE_URL` | Neon Postgres (bookings table) |

### ⚠️ Vercel token scope

The `vck_` token currently stored only works for Vercel CLI deployments, not the Analytics API.
To enable API analytics, create a **full personal access token** once:

1. Go to <https://vercel.com/account/settings/tokens>
2. Token name: `claude-analytics`, Scope: **Full Account**, No expiry
3. Copy the token and replace `VERCEL_TOKEN=` in `terracotta/.env`

Until then, the skill will fall back to reading the Vercel dashboard in the browser.

**Known IDs:**
- Project ID: `prj_XNMSR1Bg7ln0DAiNCeVAGDoZ6ILE`
- Team slug: `justins-projects-35e6874a`

---

## Execution steps

### Step 1 — Load credentials

```powershell
$env_file = "C:\Users\Justin\Documents\code\china-ticket-sites\terracotta\.env"
Get-Content $env_file | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.+)$') { Set-Variable -Name $Matches[1] -Value $Matches[2] }
}
$stripeHeaders = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${STRIPE_SECRET_KEY}:")))" }
$vercelHeaders = @{ Authorization = "Bearer $VERCEL_TOKEN" }
$projectId = "prj_XNMSR1Bg7ln0DAiNCeVAGDoZ6ILE"
$teamSlug  = "justins-projects-35e6874a"
```

### Step 2 — Vercel: traffic overview (last 7 days)

```powershell
$since = (Get-Date).AddDays(-7).ToString("yyyy-MM-dd")
$until = (Get-Date).ToString("yyyy-MM-dd")
$base  = "https://api.vercel.com/v1/query/web-analytics"

# Total visitors
$totals = Invoke-RestMethod "$base/visits/count?projectId=$projectId&slug=$teamSlug" -Headers $vercelHeaders
Write-Host "Visitors (all-time): $($totals.data.visitors), PageViews: $($totals.data.pageviews)"

# Top pages (last 7d)
$pages = Invoke-RestMethod "$base/visits/aggregate?projectId=$projectId&slug=$teamSlug&since=$since&until=$until&by=requestPath&limit=10" -Headers $vercelHeaders
$pages.data | ForEach-Object { Write-Host "$($_.requestPath): $($_.visitors) visitors" }

# Countries (last 7d)
$countries = Invoke-RestMethod "$base/visits/aggregate?projectId=$projectId&slug=$teamSlug&since=$since&until=$until&by=country&limit=10" -Headers $vercelHeaders
$countries.data | ForEach-Object { Write-Host "$($_.country): $($_.visitors) visitors ($($_.pageviews) views)" }

# Referrers (last 7d)
$refs = Invoke-RestMethod "$base/visits/aggregate?projectId=$projectId&slug=$teamSlug&since=$since&until=$until&by=referrerHostname&limit=10" -Headers $vercelHeaders
$refs.data | ForEach-Object { Write-Host "$($_.referrerHostname): $($_.visitors)" }
```

**Available `by=` dimensions:** `requestPath`, `route`, `country`, `referrerHostname`, `deviceType`, `browserName`, `day`, `week`, `month`

**OData filter syntax** (URL-encode in actual requests):
```
filter=requestPath eq '/ko'
filter=country eq 'KR'
filter=requestPath eq '/' and country eq 'FR'
```

### Step 3 — Stripe: revenue & bookings

```powershell
# Last 30 days of succeeded payment intents
$since30 = [DateTimeOffset]::UtcNow.AddDays(-30).ToUnixTimeSeconds()
$pi = Invoke-RestMethod "https://api.stripe.com/v1/payment_intents?limit=100&created[gte]=$since30" -Headers $stripeHeaders
$succeeded = $pi.data | Where-Object { $_.status -eq 'succeeded' }
$total_usd  = ($succeeded | Measure-Object -Property amount -Sum).Sum / 100
Write-Host "Last 30d — Bookings: $($succeeded.Count), Revenue: `$$total_usd USD"

# Recent succeeded charges (has email in billing_details)
$charges = Invoke-RestMethod "https://api.stripe.com/v1/charges?limit=20" -Headers $stripeHeaders
$paid = $charges.data | Where-Object { $_.status -eq 'succeeded' }
$paid | ForEach-Object {
    $date = [DateTimeOffset]::FromUnixTimeSeconds($_.created).ToString("yyyy-MM-dd HH:mm")
    Write-Host "$date | `$$($_.amount/100) $($_.currency.ToUpper()) | $($_.billing_details.email) | $($_.description)"
}

# Balance
$bal = Invoke-RestMethod "https://api.stripe.com/v1/balance" -Headers $stripeHeaders
$bal.available | ForEach-Object { Write-Host "Available: $($_.amount/100) $($_.currency.ToUpper())" }
$bal.pending   | ForEach-Object { Write-Host "Pending:   $($_.amount/100) $($_.currency.ToUpper())" }
```

Key fields on a charge/payment_intent:
- `amount` — cents (divide by 100 for dollars)
- `currency` — `usd`
- `status` — `succeeded | requires_payment_method | canceled`
- `created` — Unix timestamp
- `billing_details.email` — customer email
- `metadata` — custom data (e.g. visit_date, ticket_type from the booking form)

### Step 4 — Neon: booking counts

Use the Neon HTTP API (no psql needed):

```powershell
# Neon serverless HTTP endpoint
$neonUrl = $DATABASE_URL -replace 'postgresql://([^:]+):([^@]+)@([^/]+)/(\w+).*', 'https://$3/sql'
# Actually, use the neon-http driver or run via node:
$query = "SELECT status, COUNT(*) as cnt, SUM(amount_usd) as revenue FROM bookings GROUP BY status ORDER BY cnt DESC"
# Via node one-liner:
$nodeCmd = "node -e `"const {neon}=require('@neondatabase/serverless');const sql=neon('$DATABASE_URL');sql\`\`$query\`\`.then(r=>console.log(JSON.stringify(r,null,2)))`""
Invoke-Expression $nodeCmd

# Recent 10 bookings:
$recentQ = "SELECT id, name, visit_date, ticket_type, amount_usd, status, created_at FROM bookings ORDER BY created_at DESC LIMIT 10"
```

If `@neondatabase/serverless` isn't installed:
```powershell
cd "C:\Users\Justin\Documents\code\china-ticket-sites\terracotta"
npm install @neondatabase/serverless
```

---

## Browser fallback (when Vercel token is restricted)

Navigate to the Vercel analytics dashboard and read it via Chrome MCP:

```
navigate: https://vercel.com/justins-projects-35e6874a/china-ticket-sites/analytics
get_page_text → parse the visitor/country/page/referrer data
```

---

## Standard report format

When invoked with `/analytics`, output this structure:

```
## China Ticket Sites — Analytics Report
Period: [X days ending today]

### 🌐 Traffic (Vercel)
- Visitors: X  |  Page views: X  |  Bounce rate: X%
- Currently online: X

Top pages:
  / (terracotta home)   — X visitors
  /ko                   — X visitors
  /ja                   — X visitors
  ...

Top countries:
  🇫🇷 France       30%
  🇸🇬 Singapore    20%
  ...

Top referrers:
  checkout.stripe.com — X  (Stripe redirect-backs)
  google.com          — X
  ...

### 💰 Revenue (Stripe)
- Last 30d bookings: X
- Last 30d revenue: $X USD
- Available balance: $X USD
- Pending: $X USD

Recent payments:
  [date] | $26 USD | email@example.com | Terracotta ticket x2

### 📋 Bookings (Neon)
  confirmed:  X  ($X)
  pending:    X  ($X)
  refunded:   X  ($X)

### 💡 Observations
[2-3 actionable notes based on the data, e.g.:]
- France is top traffic source — EUR currency hints are being shown correctly
- /ko gets X visits but 0 Korean bookings → KRW pricing might be a friction point
- checkout.stripe.com referrer = someone bounced from checkout — consider abandoned-cart email
```

---

## Quick one-liners (copy-paste)

```powershell
# Stripe balance
$k=(gc terracotta\.env|sls STRIPE_SECRET_KEY).ToString().Split('=',2)[1]; irm https://api.stripe.com/v1/balance -H @{Authorization="Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${k}:")))"} | ConvertTo-Json

# Stripe last 5 charges
$k=(gc terracotta\.env|sls STRIPE_SECRET_KEY).ToString().Split('=',2)[1]; (irm "https://api.stripe.com/v1/charges?limit=5" -H @{Authorization="Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${k}:")))"}). data | select @{n='date';e={[DateTimeOffset]::FromUnixTimeSeconds($_.created).ToString('MM-dd HH:mm')}},@{n='usd';e={$_.amount/100}},status,@{n='email';e={$_.billing_details.email}} | ft
```

---

## First-time setup checklist

- [ ] Create full-scope Vercel token at https://vercel.com/account/settings/tokens → update `VERCEL_TOKEN` in `terracotta/.env`
- [ ] `npm install @neondatabase/serverless` in `terracotta/` for Neon queries
- [ ] Confirm Stripe live key is `sk_live_*` (not test) — already set in `.env`
