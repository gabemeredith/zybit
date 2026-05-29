import { runSnapshot, SnapshotError } from '@/lib/phase2/snapshots';
import type { PageSnapshotData } from '@/lib/phase2/snapshots';

export type IntakeFindingKind = 'no_h1' | 'no_above_fold_cta' | 'heavy_form';

export interface IntakeFinding {
  kind: IntakeFindingKind;
  title: string;
  evidence: string;
  prescription: string;
  confidence: number;
  domain: string;
}

export type StructuralAuditResult =
  | { status: 'ok'; finding: IntakeFinding }
  | { status: 'no_finding' }
  | { status: 'spa' }
  | { status: 'error'; reason: string };

function isSpa(data: PageSnapshotData, byteSize: number): boolean {
  return data.headings.length === 0 && data.ctas.length === 0 && byteSize < 5_000;
}

function check(data: PageSnapshotData, domain: string): IntakeFinding | null {
  const h1s = data.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    return {
      kind: 'no_h1',
      title: 'No H1 on the page',
      evidence: `${domain} has no H1 heading in its static HTML. Search engines and screen readers both expect one primary headline to anchor the page hierarchy.`,
      prescription: 'Add a single H1 that names the product and its core value proposition. Place it above the fold as the first prominent text element.',
      confidence: 0.88,
      domain,
    };
  }

  const aboveFoldCta = data.ctas.find(
    (c) => c.foldGuess === 'above' && c.visualWeight >= 0.3 && !c.disabled,
  );
  if (!aboveFoldCta) {
    const ctaCount = data.ctas.length;
    return {
      kind: 'no_above_fold_cta',
      title: 'No primary CTA above the fold',
      evidence: `${domain} has ${ctaCount === 0 ? 'no detectable CTAs' : `${ctaCount} CTA${ctaCount !== 1 ? 's' : ''}`} but none with sufficient visual weight above the fold. Visitors who don't scroll have no clear action to take.`,
      prescription: 'Place a visually prominent button (filled, high-contrast) above the fold, ideally within the hero. The label should name what happens when clicked, not generic copy like "Learn more".',
      confidence: 0.82,
      domain,
    };
  }

  const heavyForm = data.forms.find((f) => f.fieldCount >= 6 && f.hasSubmitButton);
  if (heavyForm) {
    return {
      kind: 'heavy_form',
      title: `${heavyForm.fieldCount}-field form on the page`,
      evidence: `${domain} presents a form with ${heavyForm.fieldCount} required fields. Conversion rate typically drops ~10% per additional field beyond 3.`,
      prescription: `Trim to the minimum fields needed to qualify a lead (email + one qualifier is usually enough). Move optional fields to a follow-up step after the primary conversion.`,
      confidence: 0.76,
      domain,
    };
  }

  return null;
}

export async function runStructuralAudit(url: string): Promise<StructuralAuditResult> {
  const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let domain: string;
  try {
    domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');
  } catch {
    return { status: 'error', reason: `Invalid URL: ${url}` };
  }

  try {
    const { data, byteSize } = await runSnapshot(normalizedUrl, { timeoutMs: 12_000 });

    if (isSpa(data, byteSize)) {
      return { status: 'spa' };
    }

    const finding = check(data, domain);
    if (!finding) {
      return { status: 'no_finding' };
    }

    return { status: 'ok', finding };
  } catch (err) {
    if (err instanceof SnapshotError) {
      return { status: 'error', reason: `${err.code}: ${err.message}` };
    }
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'Unknown snapshot error',
    };
  }
}
