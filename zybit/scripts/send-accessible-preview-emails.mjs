#!/usr/bin/env node
/**
 * One-off: send preview audit-report emails that exercise the NEW accessible
 * copy (plain-language rule output + trimmed "What we observed" panel).
 *
 * It reuses the production path — real fetch+parse via `runSnapshot`, real
 * `runAuditRules` in `'public-audit'` mode (so structural-only rewrites
 * apply), and the real `renderAuditReportEmailHtml`. The only synthetic
 * inputs are the behavioral signals the live crawl can't see (nav clicks,
 * vision signals, copy critique) — exactly what the pipeline injects
 * downstream. No DB, no Browserless, no fix-preview screenshots.
 *
 * Sends 3 scenario emails so every changed rule's copy is visible:
 *   1. Structure & SEO   — meta, canonical, headings, images, links, forms
 *   2. Copy clarity      — vague headline, missing proof, button mismatch
 *   3. Navigation & layout — menu dispersion, hero emphasis, below-fold button
 *
 * Run (from the worktree's zybit/ dir), pointing at the MAIN repo's .env:
 *   npx tsx --env-file=/Users/gabemeredith/Code/Zybit/zybit/zybit/.env \
 *     scripts/send-accessible-preview-emails.mjs <to-email>
 */

import { runSnapshot } from '../src/lib/phase2/snapshots/index.ts';
import { runAuditRules } from '../src/lib/phase2/rules/index.ts';
import { renderAuditReportEmailHtml, subjectForReport } from '../src/lib/email/auditReportEmail.ts';
import { severityFromScore } from '../src/lib/audit/auditReportFormatting.ts';
import { generateFixPreviews } from '../src/lib/audit/fixPreview/index.ts';
import { Resend } from 'resend';

const TO = process.argv[2];
if (!TO) {
  console.error('Error: pass the recipient email as an argument.');
  console.error('Usage: npx tsx --env-file=<.env> scripts/send-accessible-preview-emails.mjs <to-email>');
  process.exit(2);
}
const CANDIDATE_URLS = ['https://github.com', 'https://news.ycombinator.com', 'https://example.com'];

function makeContext(data, finalUrl, mode) {
  const pathRef = (() => {
    try { return new URL(finalUrl).pathname || '/'; } catch { return '/'; }
  })();
  const snapshot = {
    id: 'snap-preview', organizationId: 'org-preview', siteId: 'site-preview',
    pathRef, url: finalUrl, data, fetchedAt: new Date(), createdAt: new Date(),
  };
  return {
    organizationId: 'org-preview', siteId: 'site-preview',
    window: { start: new Date(Date.now() - 7 * 86400_000).toISOString(), end: new Date().toISOString() },
    config: { siteId: 'site-preview', organizationId: 'org-preview', cohortDimensions: [], onboardingSteps: [], ctas: [], narratives: [], updatedAt: new Date(0).toISOString() },
    events: [],
    rollup: {
      insightInput: { siteId: 'site-preview', totals: { sessions: 0, events: 0, windows: 1 }, cohorts: [], ctas: [], narratives: [], onboarding: [], deadEnds: [] },
      diagnostics: { windowDurationMs: 7 * 86400_000, totalEvents: 0, uniqueSessions: 0, perCategory: { cohorts: { assignments: 0, cohortCount: 0 }, narratives: { matched: 0, configured: 0 }, onboarding: { matched: 0, configured: 0 }, ctas: { clicks: 0, configured: 0 }, deadEnds: { pages: 0 } }, sources: ['api'], sourceCounts: [{ source: 'api', events: 0 }] },
    },
    pageSnapshotsByPath: new Map([[pathRef, snapshot]]),
    pageSnapshots: [snapshot],
    ...(mode ? { mode } : {}),
  };
}

let evIdx = 0;
function navEvent(path, dest) {
  return {
    id: `e-${evIdx++}-${Math.random()}`, organizationId: 'org-preview', siteId: 'site-preview',
    sessionId: `s-${evIdx}`, type: 'cta_click', path, occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), source: 'api', schemaVersion: 2,
    properties: { element_role: 'nav', cta_text: dest },
  };
}
function clickEvent(path, ctaText) {
  return {
    id: `e-${evIdx++}-${Math.random()}`, organizationId: 'org-preview', siteId: 'site-preview',
    sessionId: `s-${evIdx}`, type: 'cta_click', path, occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), source: 'api', schemaVersion: 2,
    properties: { cta_text: ctaText },
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function toEmailFinding(f, rank, preview) {
  return {
    id: f.id, rank, severity: severityFromScore(f.priorityScore ?? 0), confidence: f.confidence ?? 0.8,
    ruleId: f.ruleId, title: f.title,
    whyItMatters: f.prescription?.whyItMatters ?? null,
    evidence: (Array.isArray(f.evidence) ? f.evidence : []).map((e) => `${e.label}: ${e.value}`).join(' · '),
    whatToChange: f.prescription?.whatToChange ?? f.recommendation?.[0] ?? '',
    estimatedImpactMonthlyUsd: null,
    screenshotBeforeUrl: preview?.beforeUrl ?? null,
    screenshotAfterUrl: preview?.afterUrl ?? null,
    fixPreviewTier: preview?.tier ?? null,
    fixRationale: preview?.rationale ?? null,
  };
}

// Real before/after pipeline: Browserless render + Gemini advisor + Blob
// upload, same as production. DB lookups are stubbed (synthetic site) and
// the persist step is a no-op so we don't write forge_findings rows.
async function attachPreviews(findings, url, domain) {
  const outcomes = await generateFixPreviews(
    {
      organizationId: 'org-preview', siteId: 'site-preview', auditUrl: url,
      findings: findings.map((f) => ({ id: f.id, ruleId: f.ruleId, title: f.title, pathRef: f.pathRef, prescription: f.prescription ?? null })),
    },
    {
      persist: async () => {},
      lookupDomain: async () => domain,
      lookupDesign: async () => null,
      lookupCtaVocabulary: async () => [],
    },
  );
  const byId = new Map();
  for (const o of outcomes) if (o.preview) byId.set(o.findingId, o.preview);
  return byId;
}

function buildReport(domain, url, findings, previewMap) {
  return {
    auditId: 'pub_preview000000000000000', domain, url,
    prospect: { email: TO, role: 'Reviewer' },
    generatedAt: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    pagesScanned: 1, rulesEvaluated: 13,
    totalFindings: findings.length,
    findings: findings.slice(0, 4).map((f, i) => toEmailFinding(f, i + 1, previewMap?.get(f.id))),
    bookCallUrl: 'https://calendly.com/asad-getzybit/30min',
    screenshotUrl: null, visionObs: null,
    // Trimmed panel (colors + text sizes only — no framework / conversion copy).
    brandDna: { primaryColor: '#1A73E8', secondaryColor: '#0F2540', typeScale: [14, 16, 20, 28, 48] },
  };
}

function pick(findings, ruleIds) {
  const order = new Map(ruleIds.map((r, i) => [r, i]));
  return findings.filter((f) => order.has(f.ruleId)).sort((a, b) => order.get(a.ruleId) - order.get(b.ruleId));
}

async function main() {
  let base = null, finalUrl = null, domain = null;
  for (const url of CANDIDATE_URLS) {
    try {
      const snap = await runSnapshot(url);
      if (snap?.data) { base = snap.data; finalUrl = snap.finalUrl ?? url; domain = new URL(finalUrl).hostname.replace(/^www\./, ''); break; }
    } catch (e) { console.log(`fetch failed for ${url}: ${e?.message ?? e}`); }
  }
  if (!base) throw new Error('Could not fetch any candidate site for a base snapshot.');
  console.log(`Base snapshot from ${finalUrl} (${(base.ctas || []).length} buttons/links, ${(base.headings || []).length} headings)`);

  // ── Scenario 1: Structure & SEO ─────────────────────────────────────
  const seoData = clone(base);
  seoData.meta = { ...(seoData.meta || {}), description: null, canonical: null };
  const seoFindings = pick(
    runAuditRules(makeContext(seoData, finalUrl, 'public-audit')).findings,
    ['missing-meta-description', 'missing-canonical-url', 'heading-hierarchy-jump', 'image-alt-text-missing', 'link-text-generic', 'form-label-missing', 'dead-click-target'],
  );

  // ── Scenario 2: Copy clarity (vague + proof on landing; cta-verb on pricing) ──
  const landingData = clone(base);
  landingData.visualSignals = { visualPrimaryCta: null, visualSecondaryCta: null, pageType: 'landing', heroBlock: { headline: 'Empower your team', subheadline: null, firstParagraph: null }, capturedAt: new Date().toISOString(), modelVersion: 'preview' };
  landingData.copyCritique = { specificity: 0.15, vagueTerms: ['Empower your team', 'Reimagine your workflow'], suggestedRewrites: ['Cut onboarding from 3 weeks to 3 days', 'Ship your first audit in 60 seconds'], proofSignals: [], ctaAlignment: null, capturedAt: new Date().toISOString(), modelVersion: 'preview' };
  const copyCtx = makeContext(landingData, finalUrl, 'public-audit');
  const copyFromLanding = pick(runAuditRules(copyCtx).findings, ['vague-claim-detected', 'proof-missing']);

  const pricingData = clone(base);
  if ((pricingData.ctas || []).length > 0) { pricingData.ctas[0].text = 'Read more'; pricingData.ctas[0].visualWeight = 0.9; }
  pricingData.visualSignals = { visualPrimaryCta: { text: 'Read more', bbox: { x: 0, y: 0, width: 0.3, height: 0.1 }, confidence: 0.9 }, visualSecondaryCta: null, pageType: 'pricing', heroBlock: { headline: 'Plans', subheadline: null, firstParagraph: null }, capturedAt: new Date().toISOString(), modelVersion: 'preview' };
  pricingData.copyCritique = { specificity: 0.6, vagueTerms: [], suggestedRewrites: [], proofSignals: ['specific metric'], ctaAlignment: { matches: false, suggestedVerbs: ['Choose a plan', 'Start free trial', 'Pick a plan'] }, capturedAt: new Date().toISOString(), modelVersion: 'preview' };
  const ctaFindings = pick(runAuditRules(makeContext(pricingData, finalUrl, 'public-audit')).findings, ['cta-verb-mismatch']);
  const copyFindings = [...copyFromLanding, ...ctaFindings];

  // ── Scenario 3: Navigation & layout (nav dispersion + hero inversion) ──
  const navData = clone(base);
  navData.visualSignals = { visualPrimaryCta: { text: 'Get started', bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, confidence: 0.92 }, visualSecondaryCta: { text: 'See docs', bbox: { x: 0.5, y: 0.2, width: 0.2, height: 0.1 }, confidence: 0.75 }, pageType: 'home', heroBlock: null, capturedAt: new Date().toISOString(), modelVersion: 'preview' };
  // Icon-only heaviest CTA so the hero rule's vision fallback supplies the label.
  if ((navData.ctas || []).length > 0) {
    const heavy = [...navData.ctas].sort((a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0))[0];
    heavy.text = '';
  }
  const pathRef = new URL(finalUrl).pathname || '/';
  const navDests = ['Teachers', 'Alumni', 'Calendar', 'Students', 'Judge & Volunteer', 'Area Leaders', 'Media', 'Donate'];
  const navEvents = [];
  for (let i = 0; i < 64; i++) navEvents.push(navEvent(pathRef, navDests[i % navDests.length]));
  // Hero inversion: visitors click "See docs" while the heaviest (icon-only) button dominates.
  for (let i = 0; i < 28; i++) navEvents.push(clickEvent(pathRef, 'See docs'));
  for (let i = 0; i < 12; i++) navEvents.push(clickEvent(pathRef, ''));
  const navCtx = makeContext(navData, finalUrl, 'public-audit');
  navCtx.events = navEvents;
  const navLayoutFindings = pick(runAuditRules(navCtx).findings, ['nav-dispersion', 'hero-hierarchy-inversion', 'above-fold-coverage']);

  const scenarios = [
    { name: 'Structure & SEO', findings: seoFindings },
    { name: 'Copy clarity', findings: copyFindings },
    { name: 'Navigation & layout', findings: navLayoutFindings },
  ];

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set (point --env-file at the main repo .env).');
  const resend = new Resend(apiKey);
  const from = process.env.AUDIT_FROM_EMAIL ?? 'Asad & Jad at Zybit <asad@getzybit.com>';

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    console.log(`\n[${s.name}] ${s.findings.length} finding(s): ${s.findings.map((f) => f.ruleId).join(', ') || '(none)'}`);
    if (s.findings.length === 0) { console.log('  skipped — no findings fired for this scenario'); continue; }
    const top = s.findings.slice(0, 4);
    console.log('  generating before/after screenshots…');
    const previewMap = await attachPreviews(top, finalUrl, domain);
    console.log(`  ${previewMap.size}/${top.length} finding(s) got a screenshot pair`);
    const report = buildReport(domain, finalUrl, s.findings, previewMap);
    const html = renderAuditReportEmailHtml(report);
    const subject = subjectForReport(report);
    const { error } = await resend.emails.send({ from, to: TO, subject, html });
    if (error) console.error(`  SEND FAILED: ${JSON.stringify(error)}`);
    else console.log(`  sent → ${TO}  "${subject}"`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
