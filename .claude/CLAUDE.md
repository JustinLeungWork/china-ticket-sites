# china-ticket-sites

Three static booking sites (terracotta, mutianyu, zhangjiajie) hosted on Vercel.
Tech: HTML/CSS/JS + Stripe Checkout + Resend + Neon Postgres.

## Skills

- **analytics** (`.claude/skills/analytics/SKILL.md`) — live dashboard: Vercel traffic + Stripe revenue + Neon bookings. Trigger: `/analytics`

When the user types `/analytics`, invoke the Skill tool with `skill: "analytics"` before doing anything else.

## Key IDs

- Vercel project: `prj_XNMSR1Bg7ln0DAiNCeVAGDoZ6ILE`
- Vercel team slug: `justins-projects-35e6874a`
- Credentials: all in `terracotta/.env`

## Sites

| Site | Domain | Locales |
|------|---------|---------|
| terracotta | terracotta-tickets.com | en, ko, ja, id, th, es, fr, pt |
| mutianyu | mutianyu-tickets.com | en, ko, ja, id, th, es, fr, pt |
| zhangjiajie | zhangjiajie-tickets.com | en, ko, ja, id, th, es, fr, pt |

## Vercel token limitation

The current `VERCEL_TOKEN` (`vck_*`) is CLI-scoped and cannot access the Web Analytics REST API.
For API analytics, create a full personal access token at https://vercel.com/account/settings/tokens
and update `VERCEL_TOKEN` in `terracotta/.env`.
Until then, use Chrome MCP to read the analytics dashboard at:
https://vercel.com/justins-projects-35e6874a/china-ticket-sites/analytics
