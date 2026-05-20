# Lighthouse

Internal pipeline-observation tool for Zybit. Drives synthetic data through the
audit pipeline so we can verify the loop and see the PM dashboard with realistic
data before real customers exist.

- Vision: [`LIGHTHOUSE.md`](./LIGHTHOUSE.md)
- Phase 1 plan: [`phase1.md`](./phase1.md)

## What lives here

Lighthouse is a **standalone Node process** that runs on a separate port (3001
by default), serves a password-gated GUI, and imports Zybit's pipeline functions
directly to seed synthetic data. It never modifies any file under `src/`.

## Prerequisites

Lighthouse shares Zybit's Postgres database. You need:

- The same `DATABASE_URL` that Zybit uses (already in your shell or `.env.local`
  for Zybit).
- Node 20+ and `npm install` having been run at the repo root.

## Setup

1. Install deps from the **workspace root** (the outer `zybit/` that owns
   `package.json` with `"workspaces": ["zybit"]`). This adds `tsx`:

   ```bash
   npm install
   ```

2. Create `lighthouse/.env` (gitignored) with your password:

   ```env
   LIGHTHOUSE_PASSWORD=pick-something
   LIGHTHOUSE_PORT=3001
   ```

## Run

From the **app root** (the inner `zybit/` that owns the Next.js app and
`lighthouse/`):

```bash
npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts
```

Then open <http://localhost:3001/lighthouse>.

## Env vars

| Var | Required | Default | Used by |
|---|---|---|---|
| `LIGHTHOUSE_PASSWORD` | yes | — | password gate (Step 2) |
| `LIGHTHOUSE_PORT` | no | `3001` | http server |
| `DATABASE_URL` | yes | — | inherited from Zybit; Lighthouse uses `getDb()` |
| `LIGHTHOUSE_POSTHOG_API_KEY` | only for `--mode posthog` | — | posthog sink (Step 11) |
| `LIGHTHOUSE_POSTHOG_HOST` | only for `--mode posthog` | `https://us.i.posthog.com` | posthog sink |
