/**
 * Derive a lightweight, deterministic "brand DNA" for finding prose — the
 * textual signal that makes Layer B sound like it was written FOR this site:
 *
 *   - ctaVocabulary: the real action labels the brand uses ("Open an account",
 *     not a generic "Get started") — so the LLM reuses the site's own verbs.
 *   - voiceSamples: hero headline / subheadline / top-heading copy — the
 *     brand's register, so the prose matches its tone.
 *
 * Pulled from the page snapshots the insights pipeline already has — no extra
 * fetch, no LLM. For PROSE, this textual signal matters more than colours/fonts
 * (which are a separate, visual-variant concern). Site-wide: derived from ALL
 * snapshots, since brand voice is a property of the site, not one page.
 */

import type { PageSnapshot } from '@/lib/phase2/snapshots/types';

export interface BrandProfile {
  /** Real CTA labels the brand uses across the site — its action vocabulary. */
  ctaVocabulary: string[];
  /** Hero / heading copy samples — the brand's voice + register. */
  voiceSamples: string[];
}

const CTA_CAP = 12;
const VOICE_CAP = 6;
const MIN_LEN = 2;
const MAX_LEN = 120;

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < MIN_LEN || t.length > MAX_LEN) return null;
  return t;
}

export function deriveBrandProfile(snapshots: PageSnapshot[]): BrandProfile | null {
  const ctas = new Set<string>();
  const voice = new Set<string>();

  for (const snap of snapshots) {
    const data = snap?.data;
    if (!data) continue;

    for (const cta of data.ctas ?? []) {
      const t = clean(cta.text);
      if (t) ctas.add(t);
    }
    const visualCta = clean(data.visualSignals?.visualPrimaryCta?.text);
    if (visualCta) ctas.add(visualCta);

    const hero = data.visualSignals?.heroBlock;
    for (const line of [hero?.headline, hero?.subheadline]) {
      const t = clean(line);
      if (t) voice.add(t);
    }
    // h1/h2 carry the brand's framing vocabulary; deeper headings are noise.
    for (const head of data.headings ?? []) {
      if (head.level > 2) continue;
      const t = clean(head.text);
      if (t) voice.add(t);
    }
  }

  const ctaVocabulary = [...ctas].slice(0, CTA_CAP);
  const voiceSamples = [...voice].slice(0, VOICE_CAP);
  if (ctaVocabulary.length === 0 && voiceSamples.length === 0) return null;
  return { ctaVocabulary, voiceSamples };
}
