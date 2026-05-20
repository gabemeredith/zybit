# Lighthouse — Start here

Reproduction guide for the Phase 1 end-to-end demo. If everything below
holds, the loop is working.

---

## 0. Prereqs

- Node ≥ 20 (project tested on 22).
- macOS or Linux (`zsh`/`bash` for the commands below).
- Postgres reachable via `DATABASE_URL` — the same DB Zybit uses (so
  `lighthouse_*` rows live alongside Zybit's). If you're running the
  Zybit app, this is already set up.

## 1. Clone and install

From the **outer repo root** (the directory that owns the npm
workspace):

```bash
cd /path/to/Zybit/zybit         # outer workspace root, not the inner zybit/
git checkout feat/lighthouse
npm install                     # installs tsx etc. for the workspace
```

## 2. Env files

Lighthouse reads two `.env` files: Zybit's (for `DATABASE_URL` and
`ADMIN_PASSWORD`) and its own (for `LIGHTHOUSE_*`).

Confirm Zybit's `.env` exists at the app root and has both keys:

```bash
cd zybit                        # inner app root
grep -E '^(DATABASE_URL|ADMIN_PASSWORD)' .env
```

Create `lighthouse/.env` (gitignored):

```env
LIGHTHOUSE_PORT=3001
```

The password gate reuses `ADMIN_PASSWORD` from Zybit's `.env` — no
separate Lighthouse password to maintain.

## 3. Boot

From the **app root** (`zybit/zybit/`):

```bash
npx tsx --env-file=.env --env-file=lighthouse/.env lighthouse/server/index.ts
```

You should see:

```
lighthouse listening on http://localhost:3001/lighthouse
```

## 4. Drive the GUI

1. Open <http://localhost:3001/lighthouse>.
2. Enter `ADMIN_PASSWORD` from Zybit's `.env`. The dashboard loads.
3. Confirm the dropdown lists **AcmeBank — synthetic, designed to bounce**.
4. Sessions defaults to **300**; mode = **direct**.
5. Click **Generate**.
6. Watch the left pane show progress (`provisioning → sessions →
   snapshots → insights → done`); the right pane fills in.

## 5. Expected output

After ~2 seconds:

```
sessions:   300
events:     1890
snapshots:  1
findings:   2

findings:
  - return-visit-thrash   /    priority 1.000
    "Return-visit thrash"
  - bounce-on-key-page    /    priority 0.533
    "300 sessions land on / and 53.3% leave without clicking anything"
```

Exact numbers will be deterministic across re-runs that share the
scenario seed — `events` will match exactly; `findings` priority and
copy will match.

The progress pane also shows the audit gate output:

```
gate: trustworthy=true warnings=WINDOW_TOO_SHORT,EMPTY_NARRATIVES_CONFIG,EMPTY_ONBOARDING_CONFIG
auditReport: 2 findings (legacy 0)
```

Those three warnings are expected on a synthetic 1-page site — the
gate still reports `trustworthy=true` and the audit rules fire.

## 6. Sanity-check the DB

The lighthouse_*-prefixed rows are easy to identify. From an inner-zybit
shell with `DATABASE_URL` available:

```bash
psql "$DATABASE_URL" -c "
  SELECT site_id, type, COUNT(*) FROM phase1_events
  WHERE site_id = 'lighthouse_site_acmebank' GROUP BY 1,2 ORDER BY 3 DESC;
"
psql "$DATABASE_URL" -c "
  SELECT site_id, path_ref FROM phase2_page_snapshots
  WHERE site_id = 'lighthouse_site_acmebank';
"
```

Expected: ~1890 events (`page_view`, `scroll`, some `cta_click`,
`form_submit`) and 1 snapshot at `/`.

To reset between runs, delete the lighthouse_* rows in this order
(integrations → snapshots → events → site_configs → sites → orgs).

## 7. What's built

| Step | What | Where |
|---|---|---|
| 1 | http server scaffold | `lighthouse/server/index.ts`, `lighthouse/lib/types.ts` |
| 2 | password gate, HMAC cookie, GUI shell | `lighthouse/server/{auth,routes/auth}.ts`, `lighthouse/web/*` |
| 3 | seeded RNG + distributions (16 tests) | `lighthouse/lib/generators/{rng,distributions}.ts` |
| 4 | 5 personas, bias-controls locked (7 tests) | `lighthouse/lib/personas/*` |
| 5 | DB seeder for org/site/config/integration | `lighthouse/lib/seeder/orgSite.ts` |
| 6 | batched direct event sink → `phase1_events` | `lighthouse/lib/sinks/direct.ts` |
| 7 | persona-driven session simulator (8 tests) | `lighthouse/lib/generators/sessionDriver.ts` |
| 8 | scenario runner (provision → sessions → snapshots → pipeline) | `lighthouse/lib/runner/runScenario.ts` |
| 9 | `/lighthouse/api/generate` + `/lighthouse/api/runs/:id` + inspector UI | `lighthouse/server/routes/{generate,scenarios}.ts`, `lighthouse/web/app.js` |
| 10 | cloudflared tunnel wrapper | `lighthouse/lib/tunnel/cloudflared.ts` |
| 11 | PostHog opt-in sink (4 tests) | `lighthouse/lib/sinks/posthog.ts` |
| 12 | acmebank fake site + scenario + smoke | `lighthouse/fake-sites/acmebank/*`, `lighthouse/lib/scenarios/acmebank.ts` |
| 13 | findings persist to `forge_findings`; synthetic `app_users` row per scenario; auto-reset of events/snapshots/findings/experiments per run | `lighthouse/lib/runner/runScenario.ts`, `lighthouse/lib/seeder/orgSite.ts` |
| 14 | "open as PM" iframe — mints a `zb_session` for the synthetic user and embeds `/app/loop`; amber banner inside `/app/*` for `lighthouse_org_*` | `lighthouse/server/routes/impersonate.ts`, `lighthouse/web/app.js`, `src/components/app/ImpersonationBanner.tsx`, `src/app/app/layout.tsx` |

Steps 13–14 touch `src/`: `src/lib/phase2/jobs/insightsTrigger.ts`
(one `export`), `src/components/app/ImpersonationBanner.tsx` (new),
`src/app/app/layout.tsx` (mount the banner).

Run tests:

```bash
npx vitest run --config lighthouse/vitest.config.ts
```

## 8. Known limitations (Phase 1 scope)

- **Test/Measure/Learn surfaces render empty for lighthouse sites.**
  `/app/experiments/*` is DNS-gated and the variant-preview route
  fetches `https://<domain>/<path>` which doesn't fit the synthetic
  `localhost:3001/fake-sites/...` origin. Fixing this means
  synthesizing `forge_experiments` + `zybit_experiment_outcomes` per
  scenario (and patching the preview route for `lighthouse_site_*`).
  Deferred — out of scope for v1 embed.
- **Cookie handoff is localhost-only.** The impersonation route mints
  a `zb_session` cookie without a `Domain` attribute; browsers share
  it across ports on `localhost` but a deployed Lighthouse would need
  a signed handoff token + a `/api/lighthouse/handoff` endpoint on
  the Zybit side. Local-dev only.
- `--mode posthog` and the `cloudflared` tunnel wrapper are wired up
  but only exercised against real OSS sites you feed in (see §9).
  posthog mode also requires `LIGHTHOUSE_POSTHOG_API_KEY` in
  `lighthouse/.env`.
- The other AcmeBank pages (`index.html`, `pricing.html`,
  `signup.html`) still have placeholder copy. Only matters if a
  finding surfaces them in a snapshot diagram.

## 8a. The PM view

After a Generate finishes, the right column shows **open as PM**. Click
it:

1. `POST /lighthouse/api/impersonate/start` mints a real `zb_session`
   cookie for the synthetic `app_users` row that the seeder created
   (`lighthouse_user_<slug>`).
2. The button swaps for an iframe of `http://localhost:3000/app/loop`
   (override origin via `ZYBIT_APP_BASE_URL` in `lighthouse/.env`).
3. An amber banner at the top of every `/app/*` page identifies the
   session as synthetic (`Synthetic Lighthouse PM view (lighthouse_org_<slug>)`).
4. The cookie scopes to host `localhost`, so it's also valid in any
   other browser tab on `:3000`. Side effect: opening as PM overwrites
   any real `zb_session` you have on `localhost`. Log back in if you
   had a real session running.

A new run via Generate auto-clears prior events/snapshots/findings/
experiments for the same `lighthouse_site_<slug>` so the PM view shows
only the current run's state. Org/site/user rows are preserved so the
session cookie keeps working across runs.

## 9. Adding more scenarios

The acmebank scenario is the only one registered out of the box. To
add a new bucketed site:

1. Drop a `lighthouse/sites/<slug>/manifest.json` describing the site
   (slug, bucket, baseUrl, primaryFunnelPaths, primaryCtaSelector,
   businessProfile.mrr/aov, requiresTunnel, isSpa, biasNotes).
2. Create `lighthouse/lib/scenarios/<slug>.ts` that builds a
   `Scenario` from the manifest and calls `registerScenario(...)`.
3. Add a side-effect import to `lighthouse/server/index.ts`:
   `import '../lib/scenarios/<slug>';`.
4. Restart the server. The scenario appears in the dropdown.

Full manifest field list and field-by-field guide: see the plan file
referenced in the Lighthouse roadmap (the "How to feed me bucketed
sites" section).

## 10. If something doesn't match

The most common failure modes and their fixes:

- **Server boots but `/api/scenarios` returns 401** — your cookie
  doesn't match the running server's `ADMIN_PASSWORD`. Restart after
  changing the env var; cookies are signed against it.
- **Server fails with `ADMIN_PASSWORD env var is required`** — you
  booted without `--env-file=.env` (Zybit's env). Both env files are
  required.
- **`Cannot find module 'drizzle-orm'`** — you're running the script
  from outside the workspace. Use absolute paths or cd into
  `zybit/zybit/`.
- **`findings: 0` instead of 2** — confirm `phase1_events.type` rows
  for the lighthouse site include `page_view` (not `pageview`). If
  they're `pageview`, your build is from before Step 12's rename.
  Pull latest and re-run.
- **Pipeline error mentioning `learn_adjustment` column** — your
  Postgres is missing `drizzle/0013`. Either apply migrations or the
  runner already works around this by reading findings from the
  in-memory result instead of the DB.
