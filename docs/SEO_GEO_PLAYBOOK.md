# SEO + GEO Playbook — china-ticket-sites

Best practices for all ticket sites in this network (terracotta, mutianyu, zhangjiajie, …).
Based on 2025-2026 research. Update annually.

---

## What this covers

1. Technical checklist (do once per site, verify quarterly)
2. Schema markup spec (what every site must have)
3. Content playbook (what to write and how)
4. GEO / AI citation signals
5. Off-site (30-day and 90-day effort)
6. Multilingual SEO rules
7. Benchmarking — what to measure and when

---

## 1. Technical checklist

**One-time setup (must have before launch):**

- [ ] Google Search Console — URL prefix property for each locale subfolder (/, /ko/, /ja/, /id/, /th/)
- [ ] Bing Webmaster Tools — submit sitemap (Perplexity and ChatGPT use Bing's index, not Google's)
- [ ] Sitemap with hreflang cross-links for all language variants
- [ ] `robots.txt` — allow Googlebot, Bingbot, PerplexityBot, OAI-SearchBot, Claude-SearchBot; block GPTBot, ClaudeBot, CCBot (training bots)
- [ ] `llms.txt` at root — plain Markdown description of the site for AI crawlers (see template)
- [ ] Google site verification meta tag on all pages
- [ ] Vercel Analytics enabled in Vercel dashboard
- [ ] Canonical tags on all pages
- [ ] No orphan pages — every URL linked from at least one other page

**Quarterly:**

- [ ] Verify all hreflang tags are bidirectional (every alternate page links back)
- [ ] Check GSC Coverage report — fix any Excluded or Crawled-but-not-indexed pages
- [ ] Run Rich Results Test on homepage — verify Service and FAQPage markup parses
- [ ] PageSpeed Insights — confirm LCP < 2.5s, INP < 200ms, CLS < 0.1 (field data, not lab)
- [ ] Check `site:yourdomain.com` in both Google and Bing — confirm all key pages are indexed

---

## 2. Schema markup spec

Every site must have all of the following in the `<head>` as a JSON-LD array.

### Required schema types

| Type | Purpose | Priority |
|------|---------|----------|
| `Service` | Describes what the business does; price; provider | Must have |
| `Organization` | Brand entity; `sameAs` links to Wikidata/Wikipedia | Must have |
| `FAQPage` | Powers AI Overview citations; 3.2× lift vs no FAQ schema | Must have |
| `TouristAttraction` | Describes the attraction being visited | Must have |
| `AboutPage` + `BreadcrumbList` | On the About page | Must have |
| `Person` | Founder/operator identity — critical E-E-A-T signal | Must have |

### Service schema template

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "[Site Name] Ticket Booking Service",
  "description": "English-language ticket procurement for [Attraction] in [City]. We purchase official tickets on behalf of international visitors who cannot use China's real-name booking system, which requires a Chinese phone number and Alipay or WeChat Pay.",
  "url": "https://[domain]",
  "provider": {
    "@type": "Organization",
    "name": "[Site Name]",
    "url": "https://[domain]",
    "email": "support@[domain]",
    "areaServed": "Worldwide",
    "availableLanguage": ["English", "Korean", "Japanese", "Indonesian", "Thai"],
    "sameAs": ["https://www.wikidata.org/wiki/Q[ID]"]
  },
  "serviceType": "Ticket Booking",
  "category": "Tourism",
  "offers": {
    "@type": "Offer",
    "name": "[Attraction] Admission Ticket",
    "price": "[USD price]",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "priceValidUntil": "[YYYY-12-31]"
  }
}
```

### FAQPage requirements

- Minimum 6 Q&As, ideally 8–10
- Each answer must be self-contained (AI extracts the answer text alone)
- Lead answer with the direct response in under 30 words, then expand
- Cover these foreigner pain points for every China ticket site:
  1. Why can't I book on the official website?
  2. Do I need my original passport?
  3. How far in advance?
  4. What if tickets sell out?
  5. Can I cancel/change?
  6. Is a guide worth it?
  7. What does the ticket include?
  8. What's prohibited?

### Person schema template (on About page)

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Justin Leung",
  "jobTitle": "Founder",
  "homeLocation": { "@type": "City", "name": "Singapore" },
  "nationality": { "@type": "Country", "name": "Hong Kong" },
  "worksFor": { "@type": "Organization", "name": "[Site Name]", "url": "https://[domain]" },
  "description": "Hong Kong-born, Singapore-based founder. Built [Site Name] after watching international friends fail to book China attraction tickets due to WeChat Pay and Chinese phone number requirements."
}
```

---

## 3. Content playbook

### Content that wins in this niche

Competitors (chinadiscovery, travelchinaguide, chinaxiantour) publish the same 2,000-word guide every year. They all *describe* the Chinese payment barrier — none of them *solve* it. Your content edge is owning the "foreigner who can't use WeChat" angle.

**Write these pages / sections for every site:**

1. **Homepage** — booking form + **"How to Book Without WeChat" prose section** + 8-10 FAQ Q&As + visitor guide card
2. **Visitor Guide** — how to get there, what to bring, entry tips, prohibited items
3. **About** — founder story, why the service exists, named person (E-E-A-T)
4. **"Can foreigners buy [X] tickets without WeChat Pay?"** — this is the money page

### Required: "How to Book Without WeChat" section (on every page, above FAQ)

Every homepage and every locale page must have a visible (non-accordion) prose section above the FAQ that directly targets the informational long-tail queries. Use `<section class="htb-section">` with `class="htb-inner"`. Structure:

```
H2: How to Buy [Attraction] Tickets Without WeChat or Alipay
P:  [Explain the Alipay/WeChat Pay barrier — NOT "Chinese phone number"]
OL: 5 steps (date → passport → pay → we book → gate)
P.htb-note: [Advance booking / sellout tip specific to attraction]
```

Key rules:
- The H2 must contain the exact phrase "Without WeChat or Alipay" — that is the long-tail keyword
- Frame the barrier as **Alipay/WeChat Pay requiring a Chinese bank account**, NOT "requires a Chinese phone number" (the phone number claim is inaccurate and was adversarially refuted)
- Step 2 must name the real-name system (实名制) — reassurance content for anxious bookers
- Step 5 must explain that the physical passport IS the ticket at the gate (unique to China; confusing for tourists)
- The `htb-note` must include attraction-specific detail (daily cap, advance booking window, peak season)
- Translate into every locale — this section is the highest-leverage SEO addition per locale page
   - Put the direct answer in the first sentence: "Yes — through [Site Name]."
   - Explain what WeChat Pay requires, why it blocks international visitors
   - Explain exactly how your service handles it
   - Internal link to booking page

**Writing rules:**

- Question-based H2 headings (AI models extract section-level Q&A)
- Direct answer in the first 40 words of each section
- Use specific, citable numbers: daily cap, ticket price in CNY and USD, booking window days
- Year-stamp content: "2026" in H1 + page title for ticketing/price pages (these rotate annually)
- Name your sources inline — pages that cite authoritative sources get cited more by AI
- No generic bylines ("admin", "staff") — named author on every page

### Content NOT worth writing (incumbents own it)

- "Everything about the Terracotta Warriors history" — Lonely Planet / Wikipedia own this
- "Xi'an travel guide" — chinahighlights.com dominates
- Generic "how to visit China" — wrong competition level

---

## 4. GEO / AI citation signals

### Platform differences

| Platform | Index source | Cite preference | Recency weight |
|----------|-------------|-----------------|----------------|
| Google AI Overviews | Google | E-E-A-T + schema | Moderate |
| ChatGPT Search | Bing | FAQ markup + citations | Moderate |
| Perplexity | Own + Bing | Recency + crawlability | High (last 90 days) |
| Claude | Web search when active | Fewer, higher-authority refs | Moderate |

**Perplexity-specific:** allow `PerplexityBot` in robots.txt. Perplexity uses Bing's index — if not in Bing, invisible to Perplexity regardless of Google ranking.

**ChatGPT-specific:** uses Bing's index for real-time retrieval. Submit sitemap to Bing Webmaster Tools.

### How to get cited faster

1. FAQPage schema — single highest-leverage action (3.2× AI Overview citation probability)
2. Self-contained answer blocks under every H2 (AI extracts section text, not the full page)
3. Named operator with Person schema (content with named author cited 40% more)
4. Specific statistics with source attribution inline
5. Consistent brand mention across TripAdvisor + Reddit + press (AI uses "consensus signal")
6. `llms.txt` at root (emerging standard; low cost, directional benefit)

### Wikidata (90-day effort)

Once you have 1–2 external references (press mention, directory listing, TripAdvisor), create a Wikidata Q-item for each site. Then add `"sameAs": "https://www.wikidata.org/wiki/Q[ID]"` to the Organization schema. Linked to the attraction's own Wikidata entity via `"about"` property. This is the fastest path to a Knowledge Panel and higher AI citation probability.

**Do not attempt until you have an external reference** — Wikidata will delete the entry without notability evidence.

---

## 5. Off-site effort

### 30-day plan (per new site)

**Week 1 — technical foundation:**
- [ ] Google Search Console set up, sitemap submitted
- [ ] Bing Webmaster Tools set up, sitemap submitted
- [ ] TripAdvisor listing created (English + primary locale languages)
- [ ] About page live with named founder + Person schema
- [ ] llms.txt live

**Week 2 — content:**
- [ ] Write "Can foreigners buy [X] without WeChat Pay?" page
- [ ] Write "What to do if [X] tickets sell out" (add to FAQ or standalone)
- [ ] Add "2026" to H1 of all booking/price pages
- [ ] Submit URL Inspection in GSC for all key pages to request indexing

**Week 3 — community:**
- [ ] Reddit: 3–5 genuine answers in relevant subreddits (r/travel, r/China, r/JapanTravel, r/koreatravel, r/[destination]-specific)
- [ ] Answer any TripAdvisor Q&A on the attraction's listing
- [ ] Naver Search Advisor registration (for Korean audience)

**Week 4 — authority signals:**
- [ ] Check for any press/blog mentions via Google `"[sitename]"` — ask for link if unlinked
- [ ] Verify all hreflang is bidirectional (use GSC URL Inspection per locale)
- [ ] Check GSC: any pages indexed? Any impressions appearing?

### 90-day plan

- [ ] Wikidata Q-item creation (after first external reference lands)
- [ ] `sameAs` link in Organization schema updated to Wikidata Q-number
- [ ] First outreach to a China travel blogger for a link exchange or guest mention
- [ ] Pitch one data-driven angle to press: "International tourists can't buy [X] tickets" — include price comparison vs OTA markup
- [ ] Native speaker review of Korean and Japanese translations (machine translation risks ranking suppression post-2024 Google updates)
- [ ] Naver Blog: first Korean-language post for Naver's Korean audience (Google doesn't reach 56% of Korean searchers)

---

## 6. Multilingual SEO rules

**Structure:** `/[lang]/` subfolders (e.g., `/ko/`, `/ja/`, `/id/`, `/th/`). Not subdomains. Correct.

**Hreflang requirements (non-negotiable):**
- Every page must include hreflang for itself AND all alternate versions
- Bidirectional: if `/ko/` links to `/`, the `/` page must link back to `/ko/`
- `x-default` must point to the English root (`/`)
- Fully-qualified URLs (`https://...` not `//...`)
- Add `/ko/` and `/ja/` as separate URL prefix properties in GSC for per-locale data

**Machine translation warning:** Google's 2024 Helpful Content updates penalise unedited machine translation. AI draft is fine as a starting point; each locale needs a native human review pass. Budget for this before launch.

**Korea special case:** Naver holds 56% of Korean search. `/ko/` reaches the Google-using ~40% only. For Naver: register on Naver Search Advisor + publish on Naver Blog. 90-day+ effort.

---

## 8. Long-tail keyword targets by locale

*From June 2026 SEO research (105-agent adversarial workflow). Volume figures are directional — verify in a live SEO tool before using as targets.*

### English (all sites)

These are the winnable long-tail queries. OTAs hold head terms; their product pages are transactional and don't produce informational FAQ content.

| Query | Why winnable |
|-------|-------------|
| `terracotta warriors tickets without wechat` | OTAs don't explain the payment barrier |
| `terracotta warriors real name registration` | No specialist FAQ content ranks for this |
| `how to book terracotta warriors tickets with passport` | Passport-as-ticket is unique and confusing |
| `terracotta warriors tickets for foreigners` | High-anxiety transactional query |
| `terracotta warriors advance booking required` | Walk-in vs advance question not well answered |
| `mutianyu great wall tickets without chinese app` | Same pattern, Mutianyu |
| `zhangjiajie tickets without alipay` | Same pattern, Zhangjiajie |

### Korean (병마용 / 만리장성 / 장가계) — compete with MyRealTrip

| Query | Notes |
|-------|-------|
| `병마용 티켓 예약` | MyRealTrip dominates; standalone locale page can compete |
| `병마용 실명제 예약` | Your exact service, in Korean |
| `병마용 한국어 예약` | Korean-language booking angle |
| `중국 앱 없이 병마용 예약` | "Without Chinese app" — underserved |
| `시안 여행 병마용` | Broader trip-planning intent |

### Japanese (兵馬俑 / 万里の長城 / 張家界) — compete with VELTRA, KKday JP

| Query | Notes |
|-------|-------|
| `兵馬俑 チケット 予約` | Core transactional term |
| `兵馬俑 実名登録 方法` | Real-name registration how-to |
| `西安 兵馬俑 個人旅行` | Independent travel angle |
| `兵馬俑 WeChat なし` | Without WeChat/Chinese app |
| `兵馬俑 外国人 チケット` | Foreigner ticket angle |

### Indonesian — underserved by Western OTAs

| Query | Notes |
|-------|-------|
| `tiket tembok besar cina tanpa aplikasi cina` | Great Wall without Chinese app |
| `beli tiket terracotta warriors tanpa wechat` | Terracotta without WeChat |
| `tiket zhangjiajie tanpa alipay` | Zhangjiajie without Alipay |

### Thai — very underserved

| Query | Notes |
|-------|-------|
| `ตั๋วนักรบดินเผา จีน ไม่ต้องแอปจีน` | Terracotta Warriors without Chinese app |
| `ซื้อตั๋วกำแพงเมืองจีน ไม่ต้องวีแชท` | Great Wall without WeChat |

### Spanish — EUR market, Latin American + Spanish tourists, compete with Viator ES

| Query | Notes |
|-------|-------|
| `entradas guerreros terracota sin wechat` | Terracotta without WeChat |
| `comprar entradas guerreros terracota china sin alipay` | Terracotta without Alipay |
| `entradas gran muralla china sin wechat pay` | Great Wall without WeChat Pay |
| `entradas zhangjiajie sin aplicacion china` | Zhangjiajie without Chinese app |
| `guerreros de terracota entradas para extranjeros` | Terracotta for foreigners angle |

### French + Portuguese — EUR market, compete with Viator FR/PT

| Query | Notes |
|-------|-------|
| `billets guerriers terre cuite sans wechat` | FR: Terracotta without WeChat |
| `ingressos guerreiros terracota sem aplicativo chines` | PT: Terracotta without Chinese app |

### What was adversarially refuted — do NOT use in content

- "requires a Chinese phone number" — **refuted 0-3**. Say "requires Alipay or WeChat Pay (Chinese bank account)" instead.
- Trip.com as the official workaround — **refuted 0-3**.
- 7-day advance release window (unverified) — verify against bmy.com.cn before publishing.
- Specific OTA prices for Korean/Japanese markets — **refuted**, don't benchmark against them.

---

## 7. Benchmarking

See `docs/benchmarks/` for per-site baseline files.

**Benchmark on:** day of launch, 30 days, 60 days, 90 days, then quarterly.

### What to measure

| Metric | Source | How |
|--------|--------|-----|
| Google indexing | GSC Coverage | Pages indexed count |
| GSC impressions | GSC Performance | Filter by site |
| GSC clicks | GSC Performance | Filter by site |
| Top queries | GSC Performance | Queries tab |
| Bing indexing | Bing Webmaster Tools | URL Inspection |
| AI citation — Perplexity | Manual | Query "Terracotta Warriors tickets international tourist" |
| AI citation — ChatGPT | Manual | Same query |
| AI citation — Google AI Overview | Manual | Google search |
| TripAdvisor listing | TripAdvisor | Views + reviews |

### Manual AI probe (run monthly, record in benchmark file)

Open each AI platform and run these queries. Record: cited / not cited / cited with link.

```
"Terracotta Warriors tickets foreigners"
"how to buy Terracotta Warriors tickets without WeChat Pay"
"Terracotta Warriors tickets international visitors 2026"
```

Same in target locales:
```
Korean:  "병마용 티켓 외국인"
Japanese: "兵馬俑 チケット 外国人"
```

### Baseline format

See `docs/benchmarks/[SITE]-[YYYY-MM-DD]-baseline.md` for the template.
