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
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE` | Billing | Stripe price IDs for each plan |
| `BROWSERLESS_API_KEY` | Snapshots | Browserless.io API key for JS-rendered snapshot fallback |
| `CRONITOR_API_KEY` | Monitoring | Cronitor ping key for cron health monitoring |

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
