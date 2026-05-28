import { captureAboveFoldBuffer } from '../src/lib/audit/captureAboveFoldBuffer.ts';
import { captureVisualSignals } from '../src/lib/audit/captureVisualSignals.ts';
import { captureCopyCritique } from '../src/lib/audit/captureCopyCritique.ts';

const TARGET = process.argv[2] || 'https://stripe.com';
console.log('[1/3] captureAboveFoldBuffer...');
const buf = await captureAboveFoldBuffer(TARGET);
console.log('  →', buf ? `${buf.length} bytes` : 'NULL');
if (!buf) { console.error('STOP: no screenshot'); process.exit(1); }

console.log('[2/3] captureVisualSignals...');
const signals = await captureVisualSignals({ url: TARGET, domain: new URL(TARGET).host, screenshot: buf });
console.log('  →', signals ? 'OK' : 'NULL');
if (signals) {
  console.log('  pageType:', signals.pageType);
  console.log('  primaryCta:', signals.visualPrimaryCta?.text);
  console.log('  heroBlock.headline:', signals.heroBlock?.headline?.slice(0, 80));
  console.log('  heroBlock.subheadline:', signals.heroBlock?.subheadline?.slice(0, 80));
  console.log('  heroBlock.firstParagraph:', signals.heroBlock?.firstParagraph?.slice(0, 80));
}
if (!signals) { console.error('STOP: vision returned null'); process.exit(1); }
if (!signals.heroBlock) { console.error('STOP: signals.heroBlock is falsy'); process.exit(1); }

console.log('[3/3] captureCopyCritique...');
const critique = await captureCopyCritique({
  url: TARGET,
  heroBlock: signals.heroBlock,
  primaryCtaText: signals.visualPrimaryCta?.text ?? null,
  pageType: signals.pageType,
});
console.log('  →', critique ? 'OK' : 'NULL');
if (critique) {
  console.log('  specificity:', critique.specificity);
  console.log('  vagueTerms:', critique.vagueTerms);
  console.log('  proofSignals:', critique.proofSignals);
  console.log('  ctaAlignment:', JSON.stringify(critique.ctaAlignment));
}
