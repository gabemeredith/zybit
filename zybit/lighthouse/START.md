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

For **URL-audit mode** (§8b) add a Firecrawl key to `lighthouse/.env`:

```env
FIRECRAWL_KEY=fc-...
```

It's only needed to "audit a live URL"; the scenario runner doesn't use it.

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
3. Confirm the dropdown lists both scenarios: **AcmeBank — synthetic, designed to bounce** and **WovenBasics — realistic DTC, well-built**.
4. Sessions defaults to **300**; mode = **direct**.
5. Click **Generate**.
6. Watch the left pane show progress (`provisioning → sessions →
   snapshots → insights → experiments → done`); the right pane fills in.
7. The **logs** pane (below the run pane) streams the run's `console`
   output live — every pipeline step, DB write, and LLM call — with
   category filters (AI/LLM, snapshot, db, …). Diagnostic fields
   (`error`, `reason`, tokens, latency) show inline.
8. The **database browser** panel at the bottom opens a read-only view
   of every table across all orgs (auto-loads on open; narrow by
   org/site).

### Full-LLM-depth URL audit (QA the LLM path)

Under the URL-audit controls, the **owned sites — full LLM depth** row
has one-click presets (`commitmint.app`, `cohor7.com`) that run vision +
copy-critique + Layer B + fix-preview + variant advisor against a real
site. Results render in the inspector as before/after fix-preview cards +
per-finding variant-advisor option JSON. Needs `OPENAI_API_KEY`,
`FIRECRAWL_KEY`, `BROWSERLESS_KEY`, and `AUDIT_FIX_PREVIEW_ENABLED=1`
(missing keys fail soft — the log panel shows why). See
`LIGHTHOUSE.md` §7.1a for known limitations surfaced by this QA.

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
| 15 | Preview iframe loads for Lighthouse sites — origin rewritten to `http://<domain>/fake-sites/<slug>/<path>`, `frame-ancestors` extended so the page can embed inside Lighthouse on `:3001` (PR #56) | `src/app/api/preview/[experimentId]/route.ts` |
| 16 | Parse-time `cssSelector` per CtaCandidate/FormCandidate (stability ladder, 17 tests); synthetic experiment generator picks selector from the snapshot — control + variant iframes now diverge instead of rendering identical HTML (PR #56) | `src/lib/phase2/snapshots/cssSelector.ts`, `lighthouse/lib/runner/syntheticExperiment.ts` |
| 17 | wovenbasics fake site + scenario — realistic well-built DTC funnel (home → PDP → cart → checkout); calibration / false-positive counterpart to AcmeBank (PR #56) | `lighthouse/fake-sites/wovenbasics/*`, `lighthouse/lib/scenarios/wovenbasics.ts` |
| 18 | URL-audit mode — `POST /lighthouse/api/audit-url` crawls a live site (Firecrawl `/v1/map`), snapshots each page with Zybit's own fetch+parse, emits a snapshot-grounded synthetic event layer, runs the audit, and surfaces findings + a page-structure inspector. See §8b | `lighthouse/lib/crawl/firecrawl.ts`, `lighthouse/lib/generators/groundedEvents.ts`, `lighthouse/lib/runner/runUrlAudit.ts`, `lighthouse/server/routes/auditUrl.ts` |

Steps 13–14 touch `src/`: `src/lib/phase2/jobs/insightsTrigger.ts`
(one `export`), `src/components/app/ImpersonationBanner.tsx` (new),
`src/app/app/layout.tsx` (mount the banner).

## 7a. What's next

Roadmap lives in [`LIGHTHOUSE.md` §7.2](./LIGHTHOUSE.md#72-reordered-roadmap).
Short version, in order:

1. **Accurate scenarios.** Fix the random-walk driver: per-scenario
   transition matrix, then per-path CTA registry, then continuous
   per-step exit hazard. Re-author AcmeBank + WovenBasics on the new
   fields. Full ranking + fix sketches in [`LIGHTHOUSE.md` §13](./LIGHTHOUSE.md#13-session-driver-realism--known-gaps).
2. Per-scenario internals view at `/lighthouse/scenarios/[id]` —
   vertical step-by-step timeline of one run.
3. Assertion engine — add an `expected` field to the Scenario type,
   build the comparator, surface pass/fail badges in the timeline.
4. Scenario authoring tools (Firecrawl + LLM-grounded generation).
5. Cross-scenario regression dashboard.
6. Polish + deploy-ready impersonation handoff.

Run tests:

```bash
npx vitest run --config lighthouse/vitest.config.ts
```

## 8. Known limitations (Phase 1 scope)

- **Session driver is a random walk, not a directed funnel.** The
  shipped direct-mode `sessionDriver.ts` does independent weighted
  path sampling on every transition (`pickPath` at lines 124 + 192),
  so sessions look like `[/, /checkout, /, /product]` rather than
  `home → PDP → cart → checkout`. Funnel drop-off — the central
  concept in DTC and SaaS conversion — cannot be modeled. Four
  related limitations (binary bounce, path-agnostic CTA clicks,
  SaaS-flavored persona `preferredPaths`, persona-only dwell/scroll)
  compound the effect. Full ranking + fix sketches in
  [`LIGHTHOUSE.md` §13](./LIGHTHOUSE.md#13-session-driver-realism--known-gaps).
  The cheapest credible fix (transition matrix, ~40 lines) is the
  load-bearing change; should land before any Phase 3 assertion work.
- **Preview iframe + DNS-gated experiment surface for Lighthouse sites.**
  ✅ Preview now works for `lighthouse_site_*` (PR #56). The DNS gate
  on `/app/experiments/*` still requires either a synthesized
  `proxy_live=true` row or a cloudflared tunnel to exercise the live
  proxy stack — see [`LIGHTHOUSE.md` §10 Q2](./LIGHTHOUSE.md#10-open-questions)
  for the two remaining paths.
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

## 8b. URL-audit mode

Where a scenario drives a hand-authored fake site, **URL-audit mode**
points the Zybit audit at an arbitrary live site. The dashboard's "audit
url" row takes a URL + a page cap; the pipeline is:

1. **Crawl** — Firecrawl `/v1/map` discovers the site's pages (one fast
   call). Lighthouse uses Firecrawl *only* for discovery.
2. **Snapshot** — each discovered page is fetched + parsed by Zybit's own
   snapshot pipeline (`runSnapshot`), so the real `Understand` fetch+parse
   path is exercised against messy real-world HTML.
3. **Ground** — a deterministic synthetic event layer
   (`groundedEvents.ts`) is emitted, keyed to each page's *actual* parsed
   CTAs: pageviews carry a scroll distribution, clicks are weighted by
   document order, nav clicks spread uniformly across nav destinations.
4. **Audit** — Zybit's Phase 2 insights pipeline runs and produces
   findings; the right pane shows a page-structure inspector.

**Important — the findings are not ground truth.** The event layer is
engineered, not observed. URL-audit mode verifies that the rule machinery
fires and formats findings correctly against *real page structure* — it
does not verify that any given finding is *true*. `hero-hierarchy`,
`above-fold-coverage`, `nav-dispersion`, and `rage-click-target` can fire;
`mobile-engagement-asymmetry` cannot (it needs onboarding-step config an
arbitrary site has no way to declare).

Requires `FIRECRAWL_KEY` in `lighthouse/.env` (see §2).

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
