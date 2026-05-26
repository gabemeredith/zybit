/**
 * Tests for Layer E structural / accessibility / SEO audit rules.
 * All rules are snapshot-only — no behavioral events required.
 */
import { describe, it, expect } from 'vitest';
import { headingHierarchyJump } from '@/lib/phase2/rules/headingHierarchyJump';
import { formLabelMissing } from '@/lib/phase2/rules/formLabelMissing';
import { imageAltTextMissing } from '@/lib/phase2/rules/imageAltTextMissing';
import { linkTextGeneric } from '@/lib/phase2/rules/linkTextGeneric';
import { missingMetaDescription } from '@/lib/phase2/rules/missingMetaDescription';
import { missingCanonicalUrl } from '@/lib/phase2/rules/missingCanonicalUrl';
import { deadClickTarget } from '@/lib/phase2/rules/deadClickTarget';
import {
  makeContext,
  makeSnapshot,
  makeCta,
  makeForm,
  makeImage,
  makeLink,
} from './fixtures';

// ---------------------------------------------------------------------------
// headingHierarchyJump
// ---------------------------------------------------------------------------

describe('headingHierarchyJump', () => {
  it('clean hierarchy → no findings', () => {
    const snap = makeSnapshot('/', [], [
      { level: 1, text: 'Home' },
      { level: 2, text: 'Features' },
      { level: 3, text: 'Pricing' },
    ]);
    expect(headingHierarchyJump.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('missing H1 → fires warn', () => {
    const snap = makeSnapshot('/', [], [
      { level: 2, text: 'Features' },
      { level: 3, text: 'Details' },
    ]);
    const findings = headingHierarchyJump.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].ruleId).toBe('heading-hierarchy-jump');
    expect(findings[0].title).toContain('no H1');
  });

  it('H1→H3 skip → fires info', () => {
    const snap = makeSnapshot('/', [], [
      { level: 1, text: 'Home' },
      { level: 3, text: 'Skip' },
    ]);
    const findings = headingHierarchyJump.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.some((e) => e.label.includes('H1→H3'))).toBe(true);
  });

  it('multiple H1s → fires', () => {
    const snap = makeSnapshot('/', [], [
      { level: 1, text: 'Title one' },
      { level: 1, text: 'Title two' },
    ]);
    const findings = headingHierarchyJump.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('2 H1');
  });

  it('going back up levels (H3→H2) is not a skip — no findings', () => {
    const snap = makeSnapshot('/', [], [
      { level: 1, text: 'Title' },
      { level: 2, text: 'Features' },
      { level: 3, text: 'Details' },
      { level: 2, text: 'Pricing' }, // going back to H2 is fine
    ]);
    const findings = headingHierarchyJump.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formLabelMissing
// ---------------------------------------------------------------------------

describe('formLabelMissing', () => {
  it('all inputs labelled → no findings', () => {
    const form = makeForm('form-1', [
      { name: 'email', required: true, labelText: 'Email' },
      { name: 'password', required: true, labelText: 'Password' },
    ]);
    const snap = makeSnapshot('/', [], [], [form]);
    expect(formLabelMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('unlabelled text input → fires', () => {
    const form = makeForm('form-2', [
      { name: 'email', required: true },
      { name: 'given-name', required: false, labelText: 'Name' },
    ]);
    form.inputs[0].labelText = null; // explicitly remove the label
    const snap = makeSnapshot('/', [], [], [form]);
    const findings = formLabelMissing.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('form-label-missing');
    expect(findings[0].evidence[0].value).toBe(1);
  });

  it('submit inputs are skipped', () => {
    const form = makeForm('form-3', [
      { name: 'submit', required: false, type: 'submit' },
      { name: 'email', required: true, labelText: 'Email' },
    ]);
    const snap = makeSnapshot('/', [], [], [form]);
    expect(formLabelMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('multiple unlabelled → severity warn when ≥50% unlabelled', () => {
    const form2 = makeForm('form-5', [
      { name: 'a', required: true },
      { name: 'b', required: true },
    ]);
    form2.inputs[0].labelText = null;
    form2.inputs[1].labelText = null;
    const snap = makeSnapshot('/', [], [], [form2]);
    const findings = formLabelMissing.evaluate(makeContext([], [snap]));
    expect(findings[0].severity).toBe('warn');
  });

  it('checkbox/radio inputs without per-input labels do not fire (grouped via fieldset/legend)', () => {
    // Preferences forms commonly use <fieldset><legend>...</legend> with
    // checkbox/radio inputs that have no per-input <label>. Flagging these
    // would false-positive on every signup/preferences form.
    const form = makeForm('form-grouped', [
      { name: 'newsletter', required: false, type: 'checkbox' },
      { name: 'marketing', required: false, type: 'checkbox' },
      { name: 'plan', required: true, type: 'radio' },
      { name: 'plan', required: true, type: 'radio' },
      { name: 'email', required: true, labelText: 'Email' },
    ]);
    form.inputs[0].labelText = null;
    form.inputs[1].labelText = null;
    form.inputs[2].labelText = null;
    form.inputs[3].labelText = null;
    const snap = makeSnapshot('/', [], [], [form]);
    expect(formLabelMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// imageAltTextMissing
// ---------------------------------------------------------------------------

describe('imageAltTextMissing', () => {
  it('all images have alt → no findings', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('/img/hero.jpg', { alt: 'Hero image', hasAlt: true }),
      makeImage('/img/logo.png', { alt: 'Company logo', hasAlt: true }),
    ]);
    expect(imageAltTextMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('fewer than 2 meaningful images → no findings', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('/img/hero.jpg', { hasAlt: false }),
    ]);
    expect(imageAltTextMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('images missing alt → fires', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('/img/hero.jpg', { hasAlt: false }),
      makeImage('/img/product.jpg', { hasAlt: false }),
      makeImage('/img/logo.png', { alt: 'Logo', hasAlt: true }),
    ]);
    const findings = imageAltTextMissing.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('image-alt-text-missing');
    expect(findings[0].evidence[0].value).toBe(2);
  });

  it('data URI images are skipped (decorative/tracking)', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('data:image/gif;base64,R0lGOD', { hasAlt: false }),
      makeImage('data:image/png;base64,abc', { hasAlt: false }),
      makeImage('data:image/png;base64,def', { hasAlt: false }),
    ]);
    expect(imageAltTextMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('CTA child images are skipped', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('/img/arrow.svg', { hasAlt: false, isCtaChild: true }),
      makeImage('/img/arrow2.svg', { hasAlt: false, isCtaChild: true }),
      makeImage('/img/content.jpg', { alt: 'Content', hasAlt: true }),
    ]);
    expect(imageAltTextMissing.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('≥40% missing alt → severity warn', () => {
    const snap = makeSnapshot('/', [], [], [], [
      makeImage('/img/a.jpg', { hasAlt: false }),
      makeImage('/img/b.jpg', { hasAlt: false }),
      makeImage('/img/c.jpg', { hasAlt: false }),
      makeImage('/img/d.jpg', { hasAlt: false }),
      makeImage('/img/e.jpg', { alt: 'Present', hasAlt: true }),
    ]);
    const findings = imageAltTextMissing.evaluate(makeContext([], [snap]));
    expect(findings[0].severity).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// linkTextGeneric
// ---------------------------------------------------------------------------

describe('linkTextGeneric', () => {
  it('descriptive link text → no findings', () => {
    const snap = makeSnapshot('/', [
      makeLink('Read the pricing guide', '/pricing'),
      makeLink('Start your free trial', '/signup'),
    ]);
    expect(linkTextGeneric.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('"click here" link → fires', () => {
    const snap = makeSnapshot('/', [
      makeLink('click here', '/a'),
      makeLink('read more', '/b'),
    ]);
    const findings = linkTextGeneric.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('link-text-generic');
  });

  it('case-insensitive: "Click Here" is flagged', () => {
    const snap = makeSnapshot('/', [
      makeLink('Click Here', '/a'),
      makeLink('Read More', '/b'),
    ]);
    const findings = linkTextGeneric.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
  });

  it('only button CTAs (no <a> tags) → no findings', () => {
    const snap = makeSnapshot('/', [
      makeCta('click here', 0.3, 'above'),
    ]);
    expect(linkTextGeneric.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('single "Get started" primary CTA → no finding (frequency-only pattern)', () => {
    // Common pattern on every landing page: one hero "Get started" CTA plus
    // descriptive navigation. Must not fire — the 3× threshold gates it.
    const snap = makeSnapshot('/', [
      makeLink('Get started', '/signup'),
      makeLink('Read the pricing guide', '/pricing'),
      makeLink('View documentation', '/docs'),
    ]);
    expect(linkTextGeneric.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('three identical "Get started" links → fires via high-frequency path', () => {
    const snap = makeSnapshot('/', [
      makeLink('Get started', '/signup'),
      makeLink('Get started', '/signup-2'),
      makeLink('Get started', '/signup-3'),
    ]);
    const findings = linkTextGeneric.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.some((e) => String(e.label).includes('Get started'))).toBe(true);
  });

  it('descriptive links mixed with generic → fires for generic count', () => {
    const snap = makeSnapshot('/', [
      makeLink('click here', '/a'),
      makeLink('View the documentation', '/docs'),
      makeLink('learn more', '/b'),
    ]);
    const findings = linkTextGeneric.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence[0].value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// missingMetaDescription
// ---------------------------------------------------------------------------

describe('missingMetaDescription', () => {
  it('page with description ≥50 chars → no findings', () => {
    const snap = makeSnapshot('/', [], [], [], [], { description: 'A long enough meta description to pass the minimum length check, definitely.' });
    expect(missingMetaDescription.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('null description → fires', () => {
    const snap = makeSnapshot('/', [], [], [], [], { description: null });
    const findings = missingMetaDescription.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('missing-meta-description');
    expect(findings[0].title).toContain('No meta description');
  });

  it('short description (<50 chars) → fires with different title', () => {
    const snap = makeSnapshot('/', [], [], [], [], { description: 'Too short.' });
    const findings = missingMetaDescription.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('too short');
  });

  it('empty string description → fires as missing', () => {
    const snap = makeSnapshot('/', [], [], [], [], { description: '   ' });
    const findings = missingMetaDescription.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('No meta description');
  });
});

// ---------------------------------------------------------------------------
// missingCanonicalUrl
// ---------------------------------------------------------------------------

describe('missingCanonicalUrl', () => {
  it('page with canonical → no findings', () => {
    const snap = makeSnapshot('/', [], [], [], [], { canonical: 'https://example.com/' });
    expect(missingCanonicalUrl.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('null canonical → fires info', () => {
    const snap = makeSnapshot('/pricing', [], [], [], [], { canonical: null });
    const findings = missingCanonicalUrl.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('missing-canonical-url');
    expect(findings[0].severity).toBe('info');
  });

  it('empty canonical → fires', () => {
    const snap = makeSnapshot('/pricing', [], [], [], [], { canonical: '' });
    const findings = missingCanonicalUrl.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
  });

  it('multiple pages, mix of canonical/missing → one finding per missing page', () => {
    const snap1 = makeSnapshot('/', [], [], [], [], { canonical: 'https://example.com/' });
    const snap2 = makeSnapshot('/pricing', [], [], [], [], { canonical: null });
    const snap3 = makeSnapshot('/about', [], [], [], [], { canonical: null });
    const findings = missingCanonicalUrl.evaluate(makeContext([], [snap1, snap2, snap3]));
    expect(findings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// deadClickTarget — the deterministic counterpart to rage-click-target
// ---------------------------------------------------------------------------

describe('deadClickTarget', () => {
  it('all real hrefs → no findings', () => {
    const snap = makeSnapshot('/', [
      makeLink('See pricing', '/pricing'),
      makeLink('Read docs', 'https://docs.example.com'),
      makeLink('Contact', 'mailto:hello@example.com'),
    ]);
    expect(deadClickTarget.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('href="#" placeholder → fires', () => {
    const snap = makeSnapshot('/', [makeLink('Pricing', '#')]);
    const findings = deadClickTarget.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('dead-click-target');
    expect(findings[0].severity).toBe('info');
    expect(JSON.stringify(findings[0].evidence)).toContain('Pricing');
  });

  it('javascript:void(0) → fires', () => {
    const snap = makeSnapshot('/', [makeLink('Demo', 'javascript:void(0)')]);
    const findings = deadClickTarget.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
  });

  // The parens-less variant `javascript:void 0` is a common placeholder in
  // production HTML — Gemini code review flagged that the original regex
  // missed it.
  it('javascript:void 0 (no parens) → fires', () => {
    const snap = makeSnapshot('/', [makeLink('Demo', 'javascript:void 0')]);
    const findings = deadClickTarget.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('dead-click-target');
  });

  it('5+ dead links on a page → severity warn', () => {
    const snap = makeSnapshot('/', [
      makeLink('A', '#'),
      makeLink('B', '#'),
      makeLink('C', '#'),
      makeLink('D', '#'),
      makeLink('E', '#'),
      makeLink('F', 'javascript:void(0)'),
    ]);
    const findings = deadClickTarget.evaluate(makeContext([], [snap]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(JSON.stringify(findings[0].evidence)).toContain('+1 more');
  });

  it('skip-link patterns (`#main`, `#content`) are not treated as dead', () => {
    // Defensive — parser filters these out upstream, but the rule should
    // not double-count them if they ever leak through (e.g. via a custom
    // capture path that doesn't run the parser's skip-link filter).
    const snap = makeSnapshot('/', [
      makeLink('Skip to content', '#main'),
      makeLink('Skip nav', '#content'),
    ]);
    expect(deadClickTarget.evaluate(makeContext([], [snap]))).toEqual([]);
  });

  it('buttons are ignored (rule scopes to <a>) — handler-less buttons need a separate signal', () => {
    const snap = makeSnapshot('/', [makeCta('Click', 0.5, 'above')]);
    expect(deadClickTarget.evaluate(makeContext([], [snap]))).toEqual([]);
  });
});
