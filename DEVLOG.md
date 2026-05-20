# Zybit — Dev Log

One entry per work session. Most recent at top. Captures decisions made, what shipped, blockers, and what's next. Meant for async handoff between engineers.

---

## 2026-05-20

**Session:** Architecture review + sprint scaffolding
**Author:** —

### Decisions made this session

**Visual element picker (Sprint 3):** DOM tree view + screenshot thumbnail. No iframe embedding — CORS and CSP are an unwinnable fight for this use case. Browserless screenshot stored in Vercel Blob; collapsible element tree alongside it; PM clicks element → selector populates → bounding-box highlight on thumbnail. 7 days of real work vs 12+ days of CSP fighting for a broken result.

**AI Variant Advisor degraded mode:** When Browserless is unavailable (bot protection, plan tier, cost budget), the AI advisor still runs using the structural snapshot only. `phase2_site_design_snapshot.captureMethod` field is `'structural'` in this case. The AI prompt includes this signal. UI shows "Visual confidence: limited — computed styles unavailable." This way customers whose sites block Browserless still get value from Sprint 3.

**Experiment collision policy:** Overlap allowed by default. A second experiment on the same page triggers a mandatory acknowledgment warning. `forge_experiments.overlappingExperimentIds: string[]` stored so outcomes can be flagged. Mutual exclusion (`exclusionGroup`) is a later feature.

**No AI in Identify phase:** Doctrine holds. 12 deterministic rules, same input = same output. AI is used only in the Propose phase (Sprint 3, Zybit-144) to generate variant modifications from design context. PM approves before anything deploys.

**GA4 limitation documented:** GA4 is aggregate-grain — cannot join to visitor assignment events for outcome measurement. Documented in onboarding and cockpit. PostHog or Segment required for the full loop.

### What was scaffolded

- `docs/sprints/ROADMAP.md` — full sprint arc with locked architectural decisions
- `docs/sprints/sprint-0.md` — fully detailed (Zybit-114 to 120)
- `docs/sprints/sprint-1.md` — fully detailed (Zybit-121 to 128)
- `docs/sprints/sprint-2.md` — brief (Zybit-133 to 137)
- `docs/sprints/sprint-3.md` — brief (Zybit-141 to 148)
- `docs/sprints/sprint-4.md` — brief (Zybit-153 to 157)
- `docs/sprints/sprint-5.md` — brief (Zybit-161 to 165)

### State of the codebase as of this session

All items from the previous sprint are shipped (GA4 connector, PostHog bridge, last-computed-at, guardrail visual, learn Layer 1, Stripe bug fixes). The core loop (Understand → Identify → Propose → Test → Measure → Learn Layer 1) is built. What remains is hardening, demo readiness, the AI advisor, and observability.

### What's next

Start Sprint 0. Suggested split:
- Engineer 1: Zybit-114 (Stripe), Zybit-116 (Edge Config kill-switch), Zybit-118 (snapshot cadence)
- Engineer 2: Zybit-115 (auth rate limiting), Zybit-117 (Browserless live test), Zybit-119 (experiment overlap)
- Zybit-120 (E2E smoke test) — begin in parallel with Sprint 1, does not gate Sprint 0

### Open questions (not blocking Sprint 0)

- Vercel Blob plan tier — needed for Sprint 3 (screenshot storage). Check if current plan includes Blob or if it needs to be added.
- Anthropic API key — needed for Sprint 3 Zybit-144 (AI Variant Advisor). Add to Vercel env vars before Sprint 3 starts.
- `ops@zybit.run` email address — needed for Sprint 4 cron failure alerts. Verify Resend is configured to send from this address.

---

<!-- Template for future entries:

## YYYY-MM-DD

**Session:** [what this session was about]
**Author:** —

### What shipped
- 

### Decisions made
- 

### Blockers
- 

### What's next
- 

-->
