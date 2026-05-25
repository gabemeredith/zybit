# Zybit

Conversion intelligence for product managers. Zybit audits your website, watches real user behavior, surfaces exactly what's blocking conversions, and runs A/B tests on your behalf.

**Product doctrine:** [DOCTRINE.md](DOCTRINE.md)

---

## Status

Analysis engine is live. The PM-facing dashboard and A/B deployment layer are in progress.

What works today:
- Full-site design audits via static page snapshots
- PostHog and Segment behavioral data ingestion
- 12 audit rules (design + pain) producing specific, evidence-backed findings
- A/B test prescriptions with revenue impact estimates
- Audit receipt export (JSON + Markdown)

---

## Local setup

```bash
cd zybit && npm install && npm run dev
```

Open `http://localhost:3000`. Before opening a PR: `npm run verify` (lint + TypeScript + build).

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes (postgres driver) | Neon/Postgres connection |
| `RESEND_API_KEY` | Yes | Email delivery |
| `BLOB_READ_WRITE_TOKEN` | Optional locally | Vercel Blob for discovery + Phase 1 fallback |
| `PHASE1_STORAGE_DRIVER` | Optional (`auto`) | `auto` \| `blob` \| `postgres` |
| `NEXT_PUBLIC_DEFAULT_ORG_ID` | Optional | Fallback org context in dev |
| `PHASE1_ORG_IDENTITY_MODE` | Optional (`dev`) | `dev` (lenient) \| `header_required` (strict) |
| `POSTHOG_API_KEY__<TAG>` | For PostHog connector | API key referenced by integration `secretRef` |
| `AXIOM_TOKEN` | Observability | Axiom ingest token — logs drain to `axiom-audit` dataset |
| `AXIOM_DATASET` | Observability | Set to `axiom-audit` (token verified 2026-05-21) |
| `FORGE_CRON_SECRET` | Cron routes | Shared secret for `/api/phase2/cron/*` auth |
| `EDGE_CONFIG` | Proxy / kill-switch | Vercel Edge Config read connection string |
| `EDGE_CONFIG_ID` / `VERCEL_API_TOKEN` / `VERCEL_TEAM_ID` | Optional (kill-switch) | Enable the Edge Config kill-switch write on experiment stop (Zybit-116); no-op when unset |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE` | Billing | Stripe price IDs for each plan |
| `BROWSERLESS_API_KEY` | Snapshots | Browserless.io API key for JS-rendered snapshot fallback |
| `CRONITOR_API_KEY` | Monitoring | Cronitor ping key for cron health monitoring |
| `GEMINI_API_KEY` | AI Variant Advisor + public-audit vision pass (both non-essential) | Gemini 2.0 Flash key used by `POST /api/dashboard/experiments/ai-suggest` (route returns 503 when unset — PMs fall back to manual variant entry; per-org daily rate limit 10 calls/UTC day via `phase2_ai_advisor_usage`, migration `0018`) and by `src/lib/audit/visionPass.ts` (skipped when unset — report email omits the "What we saw" caption). |
| `PUBLIC_AUDIT_ENABLED` | Public URL-audit kill switch | Set to `0` to make `POST /api/audit/public/submit` return 503 without a redeploy. Any other value (or unset) leaves the surface live. |
| `ZYBIT_BOOK_CALL_URL` | Public URL-audit report email | Calendly link used as the report-email CTA. Falls back to a hardcoded default when unset. |
| `NEXT_PUBLIC_APP_URL` / `APP_BASE_URL` | Public URL-audit | Base URL used to mint the confirmation link in the double-opt-in email and the `/audit/[id]` redirect target. Falls back to `https://getzybit.com`. |
| `PUBLIC_AUDIT_SIGNING_SECRET` | Public URL-audit funnel | HMAC secret for the confirmation cookie (`zb_audit_confirmed`) and the report-email signup CTA URL. Required in production — `/api/auth/request-link-from-audit` rejects every request without it set. |
| `AUDIT_FROM_EMAIL` | Public URL-audit | `from` field for both the confirmation email and the report email. Default is `asad@getzybit.com`; needs a verified Resend domain before mail actually delivers. |

To run without Postgres: `PHASE1_STORAGE_DRIVER=blob npm run dev`

---

## Repository structure

```
zybit/
  src/
    app/              — Next.js routes (UI + API handlers)
    lib/
      phase1/         — Readiness scoring + insights engine
      phase2/         — Audit pipeline: canonical events, rules, connectors, snapshots
      auth/           — Invite-only magic-link auth + M2M API keys
      db/             — Drizzle schema + client
  drizzle/            — SQL migrations (apply before first run with Postgres)
  docs/               — Technical reference
```

---

## Technical reference

- [docs/PHASE2_EVIDENCE_MODEL.md](docs/PHASE2_EVIDENCE_MODEL.md) — Canonical event schema, audit rule contracts, connector specs
- [docs/PHASE2_LIVE_TUNING_PLAYBOOK.md](docs/PHASE2_LIVE_TUNING_PLAYBOOK.md) — Calibrating rules against live traffic
- [docs/BACKLOG.md](docs/BACKLOG.md) — Commercial epics and execution order

---

## Contributing

Open an issue or PR with a clear problem statement and scope. `npm run verify` must pass.
