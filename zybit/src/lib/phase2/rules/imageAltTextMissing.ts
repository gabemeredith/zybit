/**
 * Rule: image-alt-text-missing
 *
 * Fires when meaningful images on a page lack alt attributes. Images without
 * alt text fail WCAG 1.1.1 (Non-text Content), are invisible to screen
 * readers, and provide no SEO signal for the image or surrounding content.
 *
 * Skips images that are already children of CTA elements (covered by the CTA
 * parser), and decorative data URIs (typically tracking pixels / spacers).
 * An empty alt (alt="") is WCAG-correct for purely decorative images — only
 * a missing alt attribute is flagged.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import type { ImageItem } from '../snapshots/types';

const MIN_IMAGES_TO_FIRE = 2;

function isDecorative(img: ImageItem): boolean {
  // data URIs are usually tracking pixels or spacers; skip them.
  return img.src.startsWith('data:');
}

export const imageAltTextMissing: AuditRule = {
  id: 'image-alt-text-missing',
  category: 'accessibility',
  name: 'Images missing alt text',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const allImages = snapshot.data.images ?? [];
      const meaningful = allImages.filter((img) => !img.isCtaChild && !isDecorative(img));
      if (meaningful.length < MIN_IMAGES_TO_FIRE) continue;

      const noAlt = meaningful.filter((img) => !img.hasAlt);
      if (noAlt.length === 0) continue;

      const evidence: AuditFindingEvidence[] = [
        {
          label: 'Images missing alt attribute',
          value: noAlt.length,
          context: noAlt
            .slice(0, 4)
            .map((img) => img.src.split('/').pop() ?? img.src.slice(0, 40))
            .join(', '),
        },
        { label: 'Total meaningful images', value: meaningful.length },
        {
          label: 'Alt text coverage',
          value: `${Math.round(((meaningful.length - noAlt.length) / meaningful.length) * 100)}%`,
        },
      ];

      const rate = noAlt.length / Math.max(meaningful.length, 1);
      const severity = rate >= 0.4 ? 'warn' : 'info';

      findings.push({
        id: `image-alt-text-missing:${snapshot.pathRef}`,
        ruleId: 'image-alt-text-missing',
        category: 'accessibility',
        severity,
        confidence: 0.93,
        priorityScore: 0.4,
        pathRef: snapshot.pathRef,
        title: `${noAlt.length} image${noAlt.length > 1 ? 's' : ''} missing alt text on ${snapshot.pathRef}`,
        summary: `${snapshot.pathRef} has ${noAlt.length} of ${meaningful.length} images with no alt attribute. Screen readers skip these images entirely. Search engines cannot index their content or use them as relevance signals. WCAG 1.1.1 requires all non-decorative images to have a text alternative.`,
        recommendation: [
          `Add alt attributes to all ${noAlt.length} flagged images. For informational images, describe what the image shows. For decorative images, use alt="" (empty string) to tell screen readers to skip them.`,
          `Audit src filenames for context: ${noAlt.slice(0, 3).map((img) => img.src.split('/').pop() ?? '—').join(', ')}.`,
        ],
        evidence,
        prescription: {
          whyItMatters: `Alt text is what screen reader users hear when an image loads — without it, they hear "image" or the raw filename. It's also the only signal Google Images has about what's actually in the picture, so a missing alt on your product screenshot means the image can't show up for any relevant search query. Both your accessibility scores and your image-search traffic are leaving signal on the table.`,
          whatToChange: `Add alt="[description]" to each missing image. If the image is decorative, use alt="".`,
          whyItWorks: `Alt text makes images accessible to screen reader users and provides Google Image Search with content signals. Pages with complete alt text often see a lift in organic image traffic and improved accessibility scores.`,
          experimentVariantDescription: `Variant adds descriptive alt text to all flagged images. Measure Lighthouse accessibility score and Google Image Search impressions over 30 days.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};
