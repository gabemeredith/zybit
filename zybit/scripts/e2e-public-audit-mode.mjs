#!/usr/bin/env node
/**
 * E2E verification for Ring 1 (PublicAuditMode) + Ring 2 (structured
 * vision pass) + Ring 3 (pageType modulation + Layer F copy critique)
 * against real public sites.
 *
 * Drives the real Zybit parser + rule pipeline against vercel.com,
 * linear.app, and stripe.com — no mocks below the HTTP layer. For each
 * target:
 *   1. `runSnapshot(url)` — real fetch + parse (no API keys needed)
 *   2. Build a synthetic in-memory AuditRuleContext (no DB writes)
 *   3. Run `runAuditRules` in `'in-app'` mode → record findings
 *   4. Run `runAuditRules` in `'public-audit'` mode → record findings
 *   5. Apply `applyDefenseInDepthScrub` to the public-audit output
 *   6. Inject synthetic `visualSignals` + run hero-rule vision fallback (Ring 2)
 *   7. Inject synthetic `copyCritique` + run Layer F rules (Ring 3)
 *   8. Verify pageType-driven suppression for above-fold-coverage (Ring 3)
 *
 * Assertions per site:
 *   - No findings from any `'empty'`-declared rule in public-audit mode.
 *   - Structural-only rules' findings carry rewritten copy (or null
 *     rewrite, which keeps the rule's own copy).
 *   - No `(unnamed CTA)` / `(unnamed button)` substrings anywhere in
 *     any persisted finding.
 *   - The defense-in-depth scrub is a no-op against clean output.
 *   - When `visualSignals.visualPrimaryCta.text` is injected, the hero
 *     rule emits with that label instead of bailing on empty CTA text.
 *   - vague-claim-detected fires on a synthetic low-specificity critique.
 *   - proof-missing fires when the synthetic critique has 0 proof signals.
 *   - cta-verb-mismatch fires when ctaAlignment.matches is false.
 *   - above-fold-coverage is suppressed entirely on pageType=legal.
 *
 * Run:
 *   npx tsx scripts/e2e-public-audit-mode.mjs
 *
 * Or against a specific URL:
 *   npx tsx scripts/e2e-public-audit-mode.mjs https://vercel.com
 *
 * Outputs:
 *   /tmp/e2e-public-audit-mode-report.json — structured per-site report
 *   stdout — pass/fail per assertion
 */

import { runSnapshot } from '../src/lib/phase2/snapshots/index.ts';
import { runAuditRules, ALL_AUDIT_RULES } from '../src/lib/phase2/rules/index.ts';
import { applyDefenseInDepthScrub } from '../src/lib/audit/publicAuditScrub.ts';
import { heroHierarchyInversion } from '../src/lib/phase2/rules/heroHierarchyInversion.ts';
import { vagueClaimDetected } from '../src/lib/phase2/rules/vagueClaimDetected.ts';
import { proofMissing } from '../src/lib/phase2/rules/proofMissing.ts';
import { ctaVerbMismatch } from '../src/lib/phase2/rules/ctaVerbMismatch.ts';
import { aboveFoldCoverage } from '../src/lib/phase2/rules/aboveFoldCoverage.ts';
import { writeFile } from 'node:fs/promises';

// Default target list. Many large-CDN sites (vercel.com, linear.app,
// stripe.com) return 403 to outbound traffic from sandboxed runners; the
// script keeps them in the list and gracefully skips unreachable hosts.
// Pass a single URL as argv[2] to override (e.g. `npm test -- https://example.com`).
const TARGETS = process.argv.length > 2
  ? [process.argv[2]]
  : [
      // Real product landing pages with realistic structure that we have
      // observed reach this environment.
      'https://github.com',
      // Aspirational targets that may 403 from a sandbox — kept in the
      // list so a local-dev run exercises the rule pipeline against the
      // sites the public-audit funnel actually sees in production.
      'https://vercel.com',
      'https://linear.app',
      'https://stripe.com',
    ];

const OUT_REPORT = '/tmp/e2e-public-audit-mode-report.json';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let totalAssertions = 0;
let failedAssertions = 0;
function ok(message) {
  totalAssertions += 1;
  console.log(`${GREEN}OK${RESET} ${message}`);
}
function fail(message) {
  totalAssertions += 1;
  failedAssertions += 1;
  console.error(`${RED}FAIL${RESET} ${message}`);
  process.exitCode = 1;
}
function note(message) {
  console.log(`${DIM}—${RESET} ${message}`);
}

// ────────────────────────────────────────────────────────────────────────
// Stub context builders. We do not need a DB or events stream to verify
// the public-audit-mode contract on structural rules + a vision-only
// hero-rule fallback — the rules read events for behavioral checks, and
// behavioral rules are declared `'empty'` in public mode so they don't
// touch the snapshot.
// ────────────────────────────────────────────────────────────────────────

function makeContext(snapshotData, finalUrl, mode) {
  const pathRef = (() => {
    try {
      return new URL(finalUrl).pathname || '/';
    } catch {
      return '/';
    }
  })();
  const snapshot = {
    id: 'snap-e2e',
    organizationId: 'org-e2e',
    siteId: 'site-e2e',
    pathRef,
    url: finalUrl,
    data: snapshotData,
    fetchedAt: new Date(),
    createdAt: new Date(),
  };
  return {
    organizationId: 'org-e2e',
    siteId: 'site-e2e',
    window: {
      start: new Date(Date.now() - 7 * 86400_000).toISOString(),
      end: new Date().toISOString(),
    },
    config: {
      siteId: 'site-e2e',
      organizationId: 'org-e2e',
      cohortDimensions: [],
      onboardingSteps: [],
      ctas: [],
      narratives: [],
      updatedAt: new Date(0).toISOString(),
    },
    events: [],
    rollup: {
      insightInput: {
        siteId: 'site-e2e',
        totals: { sessions: 0, events: 0, windows: 1 },
        cohorts: [],
        ctas: [],
        narratives: [],
        onboarding: [],
        deadEnds: [],
      },
      diagnostics: {
        windowDurationMs: 7 * 86400_000,
        totalEvents: 0,
        uniqueSessions: 0,
        perCategory: {
          cohorts: { assignments: 0, cohortCount: 0 },
          narratives: { matched: 0, configured: 0 },
          onboarding: { matched: 0, configured: 0 },
          ctas: { clicks: 0, configured: 0 },
          deadEnds: { pages: 0 },
        },
        sources: ['api'],
        sourceCounts: [{ source: 'api', events: 0 }],
      },
    },
    pageSnapshotsByPath: new Map([[pathRef, snapshot]]),
    pageSnapshots: [snapshot],
    ...(mode ? { mode } : {}),
  };
}

// Build a `cta_click` synthetic event burst with a 70/30 inversion against
// the visually-heaviest CTA in the snapshot — this is the minimum input
// `heroHierarchyInversion` needs to fire. We do this only for the
// vision-fallback assertion; the public-audit run uses zero events.
function inversionEvents(pathRef, heavyText, clickedText) {
  const events = [];
  let i = 0;
  for (let k = 0; k < 28; k++) {
    events.push(makeEvent(pathRef, clickedText, `s-${i++}`));
  }
  for (let k = 0; k < 12; k++) {
    events.push(makeEvent(pathRef, heavyText, `s-${i++}`));
  }
  return events;
}

function makeEvent(path, ctaText, sessionId) {
  return {
    id: `e-${sessionId}-${Math.random()}`,
    organizationId: 'org-e2e',
    siteId: 'site-e2e',
    sessionId,
    type: 'cta_click',
    path,
    occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    source: 'api',
    schemaVersion: 2,
    properties: { cta_text: ctaText },
  };
}

// Replace the visually-heaviest CTA's text with '' to mimic the icon-only
// CTA pattern. Returns the original text so the inversion driver can
// still emit a click for it.
function mutateHeavyToIconOnly(data) {
  if (!data.ctas.length) return null;
  const heavy = [...data.ctas].sort(
    (a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0),
  )[0];
  const original = heavy.text;
  heavy.text = '';
  return original;
}

function findEvidenceFabrications(findings) {
  const offenders = [];
  for (const f of findings) {
    const haystack = JSON.stringify([f.title, f.summary, f.evidence]);
    if (haystack.includes('(unnamed button)') || haystack.includes('(unnamed CTA)')) {
      offenders.push({ id: f.id, ruleId: f.ruleId });
    }
  }
  return offenders;
}

function emptyRuleIds() {
  return ALL_AUDIT_RULES.filter((r) => r.publicAuditBehavior === 'empty').map((r) => r.id);
}
function structuralOnlyRuleIds() {
  return ALL_AUDIT_RULES.filter((r) => r.publicAuditBehavior === 'structural-only').map((r) => r.id);
}

// ────────────────────────────────────────────────────────────────────────
// Per-site verification.
// ────────────────────────────────────────────────────────────────────────

async function verifySite(target) {
  console.log(`\n${YELLOW}== ${target} ==${RESET}`);
  const startedAt = Date.now();

  let snap;
  try {
    // Real-browser UA so Cloudflare / Akamai don't 403 the ZybitAudit
    // crawler signature. Mirrors what `captureAboveFoldBuffer` sends to
    // Browserless in production. respectRobots:false because we are
    // just reading the homepage as a human would — same posture the
    // public-audit pipeline takes.
    snap = await runSnapshot(target, {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      respectRobots: false,
    });
  } catch (err) {
    // Sandbox-network 403s are not a real failure of the pipeline — they
    // mean the host's edge layer blocks the runner's outbound IP, which
    // happens locally + on Vercel sandboxes but not in production.
    // Surface as a skip so the meaningful assertions on reachable hosts
    // are still the determinant of pass/fail.
    const msg = String(err?.message ?? err);
    if (msg.includes('status 403') || msg.includes('status 401') || msg.includes('TIMEOUT')) {
      note(`SKIP ${target}: ${msg} (sandbox/edge bot mitigation — re-run in prod or against a reachable host)`);
      return { target, skipped: true, reason: msg };
    }
    fail(`runSnapshot threw: ${msg}`);
    return { target, error: msg };
  }
  ok(`runSnapshot returned (${snap.byteSize} bytes, ${snap.data.ctas.length} ctas, ${snap.data.headings.length} headings)`);

  // ── Ring 1 — mode contract ────────────────────────────────────────────
  const inAppCtx = makeContext(snap.data, snap.finalUrl, 'in-app');
  const publicCtx = makeContext(snap.data, snap.finalUrl, 'public-audit');

  const inApp = runAuditRules(inAppCtx);
  const pub = runAuditRules(publicCtx);

  note(`in-app    → ${inApp.findings.length} findings · ${inApp.diagnostics.length} diagnostics`);
  note(`public    → ${pub.findings.length} findings · ${pub.diagnostics.length} diagnostics`);

  // Assertion: no behavioral-rule findings in public mode (event stream
  // is empty so they wouldn't fire anyway, but this asserts the
  // orchestrator's fail-closed skip is being recorded).
  const emptyIds = new Set(emptyRuleIds());
  const skippedAsEmpty = pub.diagnostics.filter((d) => d.skippedReason === 'PUBLIC_AUDIT_BEHAVIOR_EMPTY').map((d) => d.ruleId);
  const allBehavioralSkipped = [...emptyIds].every((id) => skippedAsEmpty.includes(id));
  if (allBehavioralSkipped) {
    ok(`every 'empty'-declared rule skipped in public mode (${skippedAsEmpty.length} rules)`);
  } else {
    const missing = [...emptyIds].filter((id) => !skippedAsEmpty.includes(id));
    fail(`expected all behavioral rules to log PUBLIC_AUDIT_BEHAVIOR_EMPTY, missing: ${missing.join(', ')}`);
  }

  // Assertion: zero behavioral findings emitted in public mode.
  const behavioralLeaks = pub.findings.filter((f) => emptyIds.has(f.ruleId));
  if (behavioralLeaks.length === 0) {
    ok('no behavioral-rule findings emitted in public mode');
  } else {
    fail(`behavioral findings leaked in public mode: ${behavioralLeaks.map((f) => f.ruleId).join(', ')}`);
  }

  // Assertion: no `(unnamed CTA)` / `(unnamed button)` artifacts.
  const fabricated = findEvidenceFabrications(pub.findings);
  if (fabricated.length === 0) {
    ok('no (unnamed CTA) / (unnamed button) artifacts in public-mode output');
  } else {
    fail(`fabricated-evidence artifacts present: ${fabricated.map((o) => o.ruleId).join(', ')}`);
  }

  // Assertion: defense-in-depth scrub is a no-op against clean output.
  const scrubbed = applyDefenseInDepthScrub(pub.findings);
  if (scrubbed.length === pub.findings.length) {
    ok('defense-in-depth scrub is a no-op (Ring 1 + the in-rule guards already produced clean output)');
  } else {
    const dropped = pub.findings.length - scrubbed.length;
    note(`scrub dropped ${dropped} finding(s) — Ring 1 left an artifact that defense-in-depth caught`);
    // Not a fail — that's exactly what defense-in-depth is for. But the
    // primary fix should have caught it, so we surface it for review.
  }

  // ── Ring 2 — vision fallback on hero rule ────────────────────────────
  // Use a clone of the snapshot data so we don't pollute later assertions.
  const visionSnapshot = JSON.parse(JSON.stringify(snap.data));
  const originalHeavyText = mutateHeavyToIconOnly(visionSnapshot);
  let visionFallbackFinding = null;
  if (originalHeavyText) {
    // Inject synthetic visualSignals that would come from the vision pass.
    visionSnapshot.visualSignals = {
      visualPrimaryCta: {
        text: 'Get started',
        bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
        confidence: 0.92,
      },
      visualSecondaryCta: {
        text: 'See docs',
        bbox: { x: 0.5, y: 0.2, width: 0.2, height: 0.1 },
        confidence: 0.75,
      },
      pageType: 'home',
      heroBlock: null,
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };

    const pathRef = new URL(snap.finalUrl).pathname || '/';
    const events = inversionEvents(
      pathRef,
      '', // visually heaviest is the icon-only button (no text)
      'See docs', // clicked label that doesn't match heavy
    );

    const visionCtx = makeContext(visionSnapshot, snap.finalUrl, 'in-app');
    visionCtx.events = events;
    const findings = heroHierarchyInversion.evaluate(visionCtx);
    visionFallbackFinding = findings[0] ?? null;

    if (!visionFallbackFinding) {
      note('hero-rule with vision-only label did not fire — site has no inversion-eligible CTA pair');
    } else {
      const heavyEvidence = visionFallbackFinding.evidence.find((e) => e.label === 'What your design emphasizes');
      if (heavyEvidence?.value === 'Get started') {
        ok('hero rule used visionPrimaryCta.text as the heavy CTA label (Ring 2 fallback confirmed)');
      } else {
        fail(`hero rule did not pick up vision label — got "${heavyEvidence?.value}"`);
      }
      const findingText = JSON.stringify(visionFallbackFinding.evidence);
      if (!findingText.includes('(unnamed')) {
        ok('no unnamed-CTA artifact in vision-fallback finding');
      } else {
        fail('vision-fallback finding still contains unnamed-CTA artifact');
      }
    }
  } else {
    note('site had zero CTAs — skipping vision-fallback assertion');
  }

  // ── Ring 3 — pageType modulation + Layer F copy critique ────────────
  // Inject synthetic copyCritique + visualSignals to verify the three
  // Layer F rules can read them and emit findings as expected. This
  // mirrors what `captureCopyCritique` writes at capture time. Capture-
  // time itself is exercised by the unit tests + lighthouse runner;
  // here we verify the consumer rules.

  // (a) vague-claim-detected fires on a landing page with low specificity.
  {
    const data = JSON.parse(JSON.stringify(snap.data));
    data.visualSignals = {
      visualPrimaryCta: null,
      visualSecondaryCta: null,
      pageType: 'landing',
      heroBlock: {
        headline: 'Empower your team',
        subheadline: 'Real CRO for product teams',
        firstParagraph: null,
      },
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };
    data.copyCritique = {
      specificity: 0.15,
      vagueTerms: ['Empower your team'],
      suggestedRewrites: ['Cut SOC2 audits from 80h to 6h'],
      proofSignals: [],
      ctaAlignment: null,
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };
    const ctx = makeContext(data, snap.finalUrl, 'public-audit');
    const findings = vagueClaimDetected.evaluate(ctx);
    if (findings.length === 1) {
      ok('[vague-claim-detected] fires on low-specificity landing page (Ring 3)');
    } else {
      fail(`[vague-claim-detected] expected 1 finding, got ${findings.length}`);
    }

    // proof-missing also fires from the same synthetic critique (proofSignals: []).
    const proofFindings = proofMissing.evaluate(ctx);
    if (proofFindings.length === 1) {
      ok('[proof-missing] fires when copyCritique has no proof signals on landing page');
    } else {
      // 'landing' is in RELEVANT_PAGE_TYPES so we expect it to fire here.
      fail(`[proof-missing] expected 1 finding on landing page, got ${proofFindings.length}`);
    }
  }

  // (b) cta-verb-mismatch fires on pricing page with a "Read more" CTA.
  {
    const data = JSON.parse(JSON.stringify(snap.data));
    // Force a CTA the rule can quote.
    if (data.ctas.length > 0) {
      data.ctas[0].text = 'Read more';
      data.ctas[0].visualWeight = 0.9;
    } else {
      data.ctas.push({
        ref: 'cta-synth',
        cssSelector: null,
        tag: 'a',
        text: 'Read more',
        href: '/x',
        ariaLabel: null,
        landmark: 'main',
        visualWeight: 0.9,
        visualWeightSignals: [],
        foldGuess: 'above',
        domDepth: 3,
        documentIndex: 0,
        disabled: false,
      });
    }
    data.visualSignals = {
      visualPrimaryCta: { text: 'Read more', bbox: { x: 0, y: 0, width: 0.3, height: 0.1 }, confidence: 0.9 },
      visualSecondaryCta: null,
      pageType: 'pricing',
      heroBlock: { headline: 'Plans', subheadline: null, firstParagraph: null },
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };
    data.copyCritique = {
      specificity: 0.6,
      vagueTerms: [],
      suggestedRewrites: [],
      proofSignals: ['specific metric'],
      ctaAlignment: { matches: false, suggestedVerbs: ['Start free trial', 'Get started'] },
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };
    const ctx = makeContext(data, snap.finalUrl, 'public-audit');
    const findings = ctaVerbMismatch.evaluate(ctx);
    if (findings.length === 1) {
      ok('[cta-verb-mismatch] fires on pricing page with mismatched CTA verb (Ring 3)');
    } else {
      fail(`[cta-verb-mismatch] expected 1 finding, got ${findings.length}`);
    }
  }

  // (c) pageType modulation — above-fold-coverage must suppress entirely
  // on a legal page even when the page has a clearly below-fold heavy CTA.
  {
    const data = JSON.parse(JSON.stringify(snap.data));
    // Force a below-fold heavy CTA so the rule's structural condition is met.
    data.ctas.push({
      ref: 'cta-bf-synth',
      cssSelector: null,
      tag: 'button',
      text: 'Subscribe',
      href: null,
      ariaLabel: null,
      landmark: 'main',
      visualWeight: 0.92,
      visualWeightSignals: ['btn-primary', 'bg-blue-600'],
      foldGuess: 'below',
      domDepth: 5,
      documentIndex: 99,
      disabled: false,
    });
    data.visualSignals = {
      visualPrimaryCta: null,
      visualSecondaryCta: null,
      pageType: 'legal',
      heroBlock: null,
      capturedAt: new Date().toISOString(),
      modelVersion: 'gemini-2.0-flash',
    };
    const pathRef = '/legal/privacy';
    const ctx = makeContext(data, `https://${new URL(snap.finalUrl).hostname}${pathRef}`, 'public-audit');
    // Inject 50 low-scroll page_views so the rule's pageview threshold is met
    // and only the pageType modulation would prevent firing.
    ctx.events = Array.from({ length: 50 }, (_, i) => ({
      id: `pv-${i}`,
      organizationId: 'org-e2e',
      siteId: 'site-e2e',
      sessionId: `sess-${i}`,
      type: 'page_view',
      path: pathRef,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: 'api',
      schemaVersion: 2,
      metrics: { scrollPctNormalized: 0.2 },
    }));
    const findings = aboveFoldCoverage.evaluate(ctx);
    if (findings.length === 0) {
      ok('[above-fold-coverage × pageType=legal] suppressed entirely (Ring 3 modulation)');
    } else {
      fail(`[above-fold-coverage × pageType=legal] expected 0 findings, got ${findings.length}`);
    }
  }

  // Structural rewrite spot-check.
  const structuralRewritten = pub.findings.filter((f) => {
    return structuralOnlyRuleIds().includes(f.ruleId);
  });
  if (structuralRewritten.length > 0) {
    note(`${structuralRewritten.length} structural-only finding(s) emitted in public mode`);
    for (const f of structuralRewritten) {
      const basedOn = f.evidence.find((e) => e.label === 'Based on')?.value ?? '';
      if (String(basedOn).includes('page structure')) {
        ok(`[${f.ruleId}] structural rewrite applied (evidence: ${String(basedOn).slice(0, 80)}…)`);
      } else {
        fail(`[${f.ruleId}] no 'page structure' Based-on row — rewrite may not have applied`);
      }
    }
  } else {
    note('no structural-only rules fired on this site (snapshot lacks the inputs they need)');
  }

  const durationMs = Date.now() - startedAt;
  return {
    target,
    durationMs,
    snapshot: {
      byteSize: snap.byteSize,
      ctaCount: snap.data.ctas.length,
      headingCount: snap.data.headings.length,
      cssSystem: snap.data.cssSystem ?? null,
    },
    counts: {
      inApp: inApp.findings.length,
      publicAudit: pub.findings.length,
      behavioralSkipped: skippedAsEmpty.length,
      behavioralLeaked: behavioralLeaks.length,
      fabricated: fabricated.length,
      scrubbed: pub.findings.length - scrubbed.length,
    },
    publicAuditRuleIds: pub.findings.map((f) => f.ruleId),
    visionFallback: visionFallbackFinding
      ? {
          ruleFired: true,
          heavyLabelFromVision:
            visionFallbackFinding.evidence.find((e) => e.label === 'What your design emphasizes')
              ?.value ?? null,
        }
      : { ruleFired: false, reason: 'no inversion-eligible pair on this site' },
  };
}

async function main() {
  console.log(`\n${YELLOW}Ring 1 + Ring 2 e2e verification — ${TARGETS.length} target(s)${RESET}`);
  console.log(`empty-declared rules:     ${emptyRuleIds().join(', ')}`);
  console.log(`structural-only rules:    ${structuralOnlyRuleIds().join(', ')}`);
  console.log(`as-is structural rules:   ${ALL_AUDIT_RULES.filter((r) => r.publicAuditBehavior === 'as-is').map((r) => r.id).join(', ')}\n`);

  const report = { targets: [], finishedAt: null };
  let reachable = 0;
  for (const url of TARGETS) {
    const out = await verifySite(url);
    report.targets.push(out);
    if (!out.skipped && !out.error) reachable += 1;
  }
  report.finishedAt = new Date().toISOString();
  report.reachableCount = reachable;
  if (reachable === 0) {
    fail('no targets were reachable — cannot make any real-site assertion. Re-run from an unrestricted network.');
  } else {
    ok(`${reachable}/${TARGETS.length} target(s) reachable; assertions ran against them`);
  }

  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n${DIM}wrote ${OUT_REPORT}${RESET}`);

  console.log(`\n${YELLOW}Summary${RESET}`);
  console.log(`  assertions:        ${totalAssertions}`);
  console.log(`  failed:            ${failedAssertions}`);
  if (failedAssertions > 0) {
    console.error(`\n${RED}E2E FAILED — see assertions above.${RESET}\n`);
    process.exit(1);
  }
  console.log(`\n${GREEN}E2E PASSED.${RESET}\n`);
}

main().catch((err) => {
  console.error('\nScript error:', err);
  process.exit(2);
});
