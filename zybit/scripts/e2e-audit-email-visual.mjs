#!/usr/bin/env node
/**
 * Visual e2e check for the audit-report email after the PR #84 brand-DNA
 * terminology rename.
 *
 *   1. Imports `renderAuditReportEmailHtml` + `sampleAuditReport` via tsx.
 *   2. Renders the email twice — once with a full brand-DNA payload, once
 *      with `cssSystem: null` (the Stripe/Linear case) — and grep-asserts
 *      every relabeled string.
 *   3. Boots Playwright (chromium-core) and loads each HTML payload as a
 *      data: URL, then writes a viewport screenshot to disk.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/e2e-audit-email-visual.mjs
 *
 * Outputs:
 *   /tmp/audit-email-with-css-system.png
 *   /tmp/audit-email-no-css-system.png
 *   /tmp/audit-email-with-css-system.html
 *   /tmp/audit-email-no-css-system.html
 */

import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
// The email renderer is TS — import via tsx loader when this script runs.
// When run as a module via `tsx`, tsx resolves the .ts extension itself.
import {
  renderAuditReportEmailHtml,
  sampleAuditReport,
} from '../src/lib/email/auditReportEmail.ts';

const CHROMIUM_BINARY = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT_DIR = '/tmp';

const EXPECTED_LABELS = [
  // Section heading rename
  'What we observed',
  // Swatch labels
  'CTA fill',
  'Heading',
  // Fact rows
  'Observed type sizes',
  'Conversion copy',
  // New explanatory line replacing the "calibrated to these tokens" overclaim
  'These are the visible signals we extracted',
];

const REMOVED_LABELS = [
  'Your brand DNA',
  'Primary</span>',
  'Secondary</span>',
  'CTA voice',
  'Type scale',
  'calibrated to these tokens',
];

const UNKNOWN_FRAMEWORK_COPY = 'unknown (compiled or hashed utility classes)';

function fail(message) {
  console.error(`[31mFAIL[0m ${message}`);
  process.exitCode = 1;
}
function ok(message) {
  console.log(`[32mOK[0m ${message}`);
}

async function renderTwo() {
  const withSystem = renderAuditReportEmailHtml(sampleAuditReport());
  const sampleNoSystem = sampleAuditReport();
  if (sampleNoSystem.brandDna) {
    sampleNoSystem.brandDna = { ...sampleNoSystem.brandDna, cssSystem: null };
  }
  const noSystem = renderAuditReportEmailHtml(sampleNoSystem);
  return { withSystem, noSystem };
}

function assertContains(html, label, scenario) {
  if (html.includes(label)) {
    ok(`[${scenario}] contains "${label}"`);
  } else {
    fail(`[${scenario}] missing "${label}"`);
  }
}

function assertAbsent(html, label, scenario) {
  if (!html.includes(label)) {
    ok(`[${scenario}] no longer contains "${label}"`);
  } else {
    fail(`[${scenario}] still contains stale label "${label}"`);
  }
}

async function screenshotEmail(html, outPath) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_BINARY,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 1200 } });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  const { withSystem, noSystem } = await renderTwo();

  // Scenario A: full brand DNA (tailwind detected)
  for (const label of EXPECTED_LABELS) assertContains(withSystem, label, 'with-cssSystem');
  for (const label of REMOVED_LABELS) assertAbsent(withSystem, label, 'with-cssSystem');
  assertContains(withSystem, 'tailwind', 'with-cssSystem');

  // Scenario B: cssSystem null — must now render the "unknown" fallback row
  for (const label of EXPECTED_LABELS) assertContains(noSystem, label, 'no-cssSystem');
  assertContains(noSystem, UNKNOWN_FRAMEWORK_COPY, 'no-cssSystem');

  const a = path.join(OUT_DIR, 'audit-email-with-css-system.html');
  const b = path.join(OUT_DIR, 'audit-email-no-css-system.html');
  await writeFile(a, withSystem, 'utf8');
  await writeFile(b, noSystem, 'utf8');
  ok(`wrote ${a}`);
  ok(`wrote ${b}`);

  await screenshotEmail(withSystem, path.join(OUT_DIR, 'audit-email-with-css-system.png'));
  ok(`wrote /tmp/audit-email-with-css-system.png`);
  await screenshotEmail(noSystem, path.join(OUT_DIR, 'audit-email-no-css-system.png'));
  ok(`wrote /tmp/audit-email-no-css-system.png`);

  if (process.exitCode === 1) {
    console.error('\nVisual e2e FAILED — see assertions above.');
    process.exit(1);
  }
  console.log('\nVisual e2e PASSED.');
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(2);
});
