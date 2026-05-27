#!/usr/bin/env node
/**
 * One-shot: read a saved findings.json from /tmp/audit-batch and email it
 * via Resend. Used to verify a step's effect on the real prospect email
 * without re-running the pipeline (which would also bill Browserless +
 * Gemini again for the same data). Intentionally minimal — no fix-preview
 * pipeline, no vision-obs caption.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/audit-send-email.mjs \
 *     /tmp/audit-batch/stripe.com.findings.json \
 *     gabriel.b.meredith@gmail.com
 */

import { readFile } from 'node:fs/promises';
import { sendAuditReportEmail } from '../src/lib/email/auditReportEmail.ts';
import { generateFixPreviews } from '../src/lib/audit/fixPreview/index.ts';

const [, , jsonPath, toEmail] = process.argv;
if (!jsonPath || !toEmail) {
  console.error('Usage: scripts/audit-send-email.mjs <findings.json> <to-email>');
  process.exit(2);
}

const raw = JSON.parse(await readFile(jsonPath, 'utf8'));
const { url, domain, top4, siteId } = raw;
// Older harness runs predate the organizationId field; derive it from the
// siteId using the lighthouse provisioner's naming convention so old saved
// JSONs still work.
const organizationId =
  raw.organizationId ?? siteId.replace('lighthouse_site_', 'lighthouse_org_');

console.log(`Running fix-preview pipeline for ${top4.length} finding(s)…`);
const findingsForPreview = top4.map((f) => ({
  id: f.id,
  ruleId: f.ruleId,
  title: f.title,
  pathRef: f.pathRef,
  prescription: f.prescription
    ? {
        ...(f.prescription.whyItMatters !== undefined
          ? { whyItMatters: f.prescription.whyItMatters }
          : {}),
        whatToChange: f.prescription.whatToChange,
        whyItWorks: f.prescription.whyItWorks,
        experimentVariantDescription: f.prescription.experimentVariantDescription,
      }
    : null,
}));
const previewOutcomes = await generateFixPreviews({
  organizationId,
  siteId,
  auditUrl: url,
  findings: findingsForPreview,
});
const previewByFindingId = new Map();
for (const outcome of previewOutcomes) {
  if (outcome.preview) previewByFindingId.set(outcome.findingId, outcome.preview);
}
console.log(`Fix-preview: ${previewByFindingId.size}/${top4.length} produced visual pairs.`);

function severityFromScore(s) {
  if (s >= 0.6) return 'high';
  if (s >= 0.3) return 'medium';
  return 'low';
}

const findings = top4.map((f, i) => {
  const preview = previewByFindingId.get(f.id) ?? null;
  return {
    id: f.id,
    rank: i + 1,
    severity: severityFromScore(f.priorityScore),
    confidence: f.confidence,
    ruleId: f.ruleId,
    title: f.title,
    whyItMatters: f.prescription?.whyItMatters ?? null,
    evidence: (Array.isArray(f.evidence) ? f.evidence : [])
      .map((e) => `${e.label}: ${e.value}`)
      .join(' · '),
    whatToChange: f.prescription?.whatToChange ?? f.recommendation?.[0] ?? '',
    estimatedImpactMonthlyUsd:
      f.impactEstimate?.unit === 'usd' ? Number(f.impactEstimate.value) : null,
    screenshotBeforeUrl: preview?.beforeUrl ?? null,
    screenshotAfterUrl: preview?.afterUrl ?? null,
    fixPreviewTier: preview?.tier ?? null,
    fixRationale: preview?.rationale ?? null,
  };
});

const report = {
  auditId: `verify-${domain}-${Date.now()}`,
  domain,
  url,
  prospect: { email: toEmail, role: 'Product Manager' },
  generatedAt: new Date().toLocaleString('en-US'),
  pagesScanned: raw.counts?.snapshots ?? 0,
  totalFindings: raw.counts?.findings ?? 0,
  findings,
  bookCallUrl: 'https://calendly.com/asad-getzybit/30min',
  screenshotUrl: null,
  visionObs: null,
  brandDna: null,
};

console.log(`Sending ${domain} audit (${findings.length} findings) to ${toEmail}…`);
const result = await sendAuditReportEmail(toEmail, report);
if (result.success) {
  console.log(`OK — email sent.`);
  console.log(`Top-4 paths in email: ${findings.map((f) => `[#${f.rank}] ${f.title}`).join('\n                       ')}`);
} else {
  console.error(`FAIL: ${result.error}`);
  process.exit(1);
}
