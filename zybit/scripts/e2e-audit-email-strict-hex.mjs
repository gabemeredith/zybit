#!/usr/bin/env node
/**
 * E2E verification of the strict-hex `colorSwatch` validator + brand-DNA
 * rendering — Ring 1's PR #85 review issue #2 fix.
 *
 * Renders the audit-report email three ways:
 *
 *   1. Clean hex (#1d4ed8) — swatch should render with the color applied.
 *   2. Hex with CSS-injection payload (`#ff0000; }body{display:none;}{`) —
 *      swatch should be dropped; payload must NOT appear anywhere in the
 *      rendered HTML.
 *   3. Non-hex DB value (rgb(255,0,0)) — swatch dropped; legitimate
 *      `rgb()` strings would still bypass the strict check, but the swatch
 *      doesn't render so there's no injection vector.
 *
 * Plus opens the rendered HTML in Playwright (chromium-core) and writes
 * a screenshot artifact per scenario. Mirrors the existing
 * `e2e-audit-email-visual.mjs` pattern.
 *
 * Run:
 *   npx tsx scripts/e2e-audit-email-strict-hex.mjs
 *
 * Outputs:
 *   /tmp/audit-email-strict-hex-clean.{html,png}
 *   /tmp/audit-email-strict-hex-injection.{html,png}
 *   /tmp/audit-email-strict-hex-non-hex.{html,png}
 */

import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  renderAuditReportEmailHtml,
  sampleAuditReport,
} from '../src/lib/email/auditReportEmail.ts';

const CHROMIUM_BINARY = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT_DIR = '/tmp';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let failed = 0;
function ok(message) {
  console.log(`${GREEN}OK${RESET} ${message}`);
}
function fail(message) {
  failed += 1;
  console.error(`${RED}FAIL${RESET} ${message}`);
  process.exitCode = 1;
}

function reportWithColors(primary, secondary) {
  const base = sampleAuditReport();
  if (!base.brandDna) {
    throw new Error('sampleAuditReport returned no brandDna — fixture has drifted');
  }
  return {
    ...base,
    brandDna: { ...base.brandDna, primaryColor: primary, secondaryColor: secondary },
  };
}

async function screenshotEmail(html, outPath) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_BINARY,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 1400 } });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

const INJECTION_PAYLOAD = '#ff0000; }body{display:none;}{';
const NON_HEX = 'rgb(255,0,0)';

async function main() {
  // --- Scenario A: clean hex --------------------------------------------
  const clean = renderAuditReportEmailHtml(reportWithColors('#1d4ed8', '#0a0a0a'));
  if (clean.includes('background: #1d4ed8')) {
    ok('clean primary hex renders as `background: #1d4ed8`');
  } else {
    fail('clean primary hex did not appear in the swatch background');
  }
  if (clean.includes('background: #0a0a0a')) {
    ok('clean secondary hex renders as `background: #0a0a0a`');
  } else {
    fail('clean secondary hex did not appear in the swatch background');
  }

  // --- Scenario B: CSS-injection attempt -------------------------------
  // colorSwatch must drop a non-hex value entirely. The payload must not
  // appear anywhere in the rendered HTML (no `background: #ff0000; }…`,
  // no escaped variant landing inside a style attribute).
  const injected = renderAuditReportEmailHtml(reportWithColors(INJECTION_PAYLOAD, '#0a0a0a'));
  if (!injected.includes(INJECTION_PAYLOAD)) {
    ok('injection payload does not appear in rendered HTML');
  } else {
    fail('injection payload leaked into the rendered HTML — strict-hex regex did not bail');
  }
  // The `}body{display:none;}{` fragment specifically would close the
  // `<style>` context if the swatch were rendered. Even the HTML-escaped
  // variant of the payload should not appear since the swatch is dropped.
  if (!injected.includes('display:none')) {
    ok('payload fragment "display:none" not present in rendered HTML');
  } else {
    fail('payload fragment "display:none" still present in rendered HTML');
  }
  // The secondary swatch (clean hex) should still render — the dropper
  // is per-swatch, not per-section.
  if (injected.includes('background: #0a0a0a')) {
    ok('clean secondary swatch still renders alongside the dropped primary');
  } else {
    fail('clean secondary swatch was also dropped — colorSwatch over-filtering');
  }

  // --- Scenario C: non-hex (rgb()) -------------------------------------
  // Even legitimate `rgb()` strings get dropped under the strict-hex
  // guard. This is intentional — the brand-DNA writer should normalize
  // to hex before persisting; if it doesn't, the email surfaces the gap
  // as a missing swatch rather than risk injection.
  const nonHex = renderAuditReportEmailHtml(reportWithColors(NON_HEX, '#0a0a0a'));
  if (!nonHex.includes(NON_HEX)) {
    ok('non-hex rgb() value does not appear in rendered HTML');
  } else {
    fail('non-hex rgb() value leaked into the rendered HTML');
  }

  // Brand-DNA section must still render — only the bad swatch was dropped.
  if (nonHex.includes('What we observed')) {
    ok('brand-DNA section still renders when one swatch is dropped');
  } else {
    fail('entire brand-DNA section vanished — drop should be per-swatch not per-section');
  }

  // Persist artifacts.
  const out = (n) => path.join(OUT_DIR, `audit-email-strict-hex-${n}`);
  await writeFile(`${out('clean')}.html`, clean, 'utf8');
  await writeFile(`${out('injection')}.html`, injected, 'utf8');
  await writeFile(`${out('non-hex')}.html`, nonHex, 'utf8');
  ok('wrote HTML artifacts to /tmp/audit-email-strict-hex-*.html');

  await screenshotEmail(clean, `${out('clean')}.png`);
  await screenshotEmail(injected, `${out('injection')}.png`);
  await screenshotEmail(nonHex, `${out('non-hex')}.png`);
  ok('wrote Playwright screenshots to /tmp/audit-email-strict-hex-*.png');

  if (failed > 0) {
    console.error(`\n${RED}strict-hex e2e FAILED.${RESET}\n`);
    process.exit(1);
  }
  console.log(`\n${GREEN}strict-hex e2e PASSED.${RESET}\n`);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(2);
});
