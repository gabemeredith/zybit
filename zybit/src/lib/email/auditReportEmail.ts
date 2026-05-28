/**
 * Audit report email — the artifact for the public URL-audit lead magnet.
 *
 * Premium positioning (see `docs/sprints/url-audit-lead-magnet.md` §0):
 * the on-site teaser shows ONE finding; the full report is this email.
 * It is meant to feel like a consultancy one-pager, not a tool dump.
 *
 * Wiring is deferred to Phase B. For now this module exports:
 *   - `AuditReport` type
 *   - `renderAuditReportEmailHtml(report)` — returns the email HTML string
 *   - `sendAuditReportEmail(to, report)` — Resend send (no-op until Phase B
 *     plumbs the route)
 *   - `sampleAuditReport()` — used by `/audit/email-preview` to render mock
 *
 * The HTML uses inline styles only (no external CSS, no fonts loaded
 * from Google) so it renders consistently across Gmail / Apple Mail /
 * Outlook web. Receipt-card pattern mirrors the landing page.
 */

import { Resend } from 'resend';
import { PUBLIC_AUDIT_DEFERRED_RULE_COUNT } from '@/lib/audit/publicAuditRuleCount';

export interface AuditFindingForEmail {
  id: string;
  rank: number;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  ruleId: string;
  title: string;
  /**
   * Optional PM-first business framing rendered above the title. Surfaced
   * from `prescription.whyItMatters` when the underlying rule provides it.
   * Falsy → the section is omitted, no empty placeholder is rendered.
   */
  whyItMatters: string | null;
  evidence: string;
  whatToChange: string;
  estimatedImpactMonthlyUsd: number | null;
  /**
   * Before/after fix-preview pair populated by `generateFixPreviews`. Both
   * URLs are public Vercel Blob PNGs. `fixPreviewTier`: 1 = deterministic
   * variant render, 2 = vision inpaint, 3 = before-only fallback (afterUrl
   * is null in tier 3, the email card degrades to a single screenshot
   * with a "sign up to see the fix" CTA underneath). All fields null →
   * the card renders without any visual at all.
   */
  screenshotBeforeUrl?: string | null;
  screenshotAfterUrl?: string | null;
  fixPreviewTier?: 1 | 2 | 3 | null;
  /** Model-emitted one-liner — "Replaced 'Click here' with action-led copy." */
  fixRationale?: string | null;
}

/**
 * Brand-DNA payload extracted from `phase2_site_design_snapshot` for the
 * audited URL. Absent or fully-empty → the "What we observed" section in
 * the email is skipped (fail-soft per the audit-funnel spec). The renderer
 * also skips individual fields that are null so a partial capture still
 * produces a sensible card.
 *
 * Field names are kept as `primaryColor` / `secondaryColor` / `typeScale`
 * to stay drop-in with `phase2_site_design_snapshot.designTokens` and the
 * existing `extractDesignTokens` writer. The email surface relabels these
 * to what they actually measure (dominant CTA fill, dominant heading color,
 * observed font sizes) — see PR #84 rename notes. A future schema refactor
 * can rename the storage fields once we have a migration story; that's not
 * blocking the audit-funnel ship.
 */
export interface AuditBrandDna {
  /** Hex color (e.g. "#1A73E8") — mode of CTA background-color. */
  primaryColor: string | null;
  /** Hex color — mode of heading color. */
  secondaryColor: string | null;
  /** Sorted heading font sizes in px. */
  typeScale: number[] | null;
  /** Detected CSS authoring framework ("tailwind", "bootstrap", etc).
   * Null doesn't mean "no system" — it means the signature matcher didn't
   * recognize a fingerprint (common on sites that compile / hash / tree-shake
   * utility classes). The renderer surfaces this distinction. */
  cssSystem: string | null;
  /** Up to 5 unique CTA copy samples from the structural snapshot (nav and
   * header items excluded — this is conversion copy, not IA labels). */
  ctaVocabulary: string[];
}

export interface AuditReport {
  /** The public_audits.id — used to mint the signed signup-CTA URL. */
  auditId: string;
  domain: string;
  url: string;
  prospect: {
    email: string;
    role: string;
  };
  generatedAt: string;
  pagesScanned: number;
  /**
   * Count of rules actually evaluated against the site in public-audit
   * mode. Threaded through so the intro line ("We ran our N friction
   * rules…") stays accurate as the rule set grows; computed from
   * `getPublicAuditRuleCount()` at the call site.
   */
  rulesEvaluated: number;
  totalFindings: number;
  findings: AuditFindingForEmail[];
  bookCallUrl: string;
  /** Public URL of the above-fold homepage screenshot, if captured. */
  screenshotUrl?: string | null;
  /** 2-sentence AI visual observation from the screenshot, if run. */
  visionObs?: string | null;
  /** Brand-DNA tokens for the audited URL, if Browserless capture succeeded. */
  brandDna?: AuditBrandDna | null;
}


const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';
const HAIRLINE = 'rgba(0,0,0,0.12)';
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";

// Number word for prose flow at the small counts the audit produces.
// Falls back to digits for 11+ (the audit caps at 4 today, so the high
// branch only exists for safety).
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;
function numberWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

// "1 page" vs "7 pages" — the homepage-only case needs the singular form.
function pagesPhrase(n: number): string {
  if (n <= 0) return 'your homepage';
  return `your homepage and the ${numberWord(n)} internal page${n === 1 ? '' : 's'} we could reach`;
}

function introCopy(report: AuditReport): string {
  const n = report.findings.length;
  const rulesCount = numberWord(report.rulesEvaluated);
  const pages = pagesPhrase(report.pagesScanned);
  if (n === 0) {
    return `We crawled ${pages} and ran ${rulesCount} structural checks against the HTML. Nothing exceeded our detection threshold — on pages with clean markup and strong SEO fundamentals, that is a real result. The ${numberWord(PUBLIC_AUDIT_DEFERRED_RULE_COUNT)} behavioral rules light up once you connect PostHog and we can see how your visitors actually move through the site.`;
  }
  const findingPhrase = `<strong>${numberWord(n)} finding${n === 1 ? '' : 's'} below</strong>`;
  const tail = n === 1 ? 'is the one' : 'are the ones';
  return `We crawled ${pages} and ran ${rulesCount} structural checks against the HTML. The ${findingPhrase} ${tail} that stood out — each grounded in something specific we found in your markup, with a concrete fix.`;
}

/**
 * Maps a ruleId to a human-readable category label for the email card header.
 * Categories are meaningful to founders (SEO, Accessibility, etc.) unlike
 * internal severity/confidence scores which are heuristic-derived and opaque.
 */
const RULE_CATEGORIES: Record<string, string> = {
  'hero-hierarchy-inversion': 'CTA structure',
  'above-fold-coverage': 'CTA structure',
  'cta-low-contrast': 'Visual contrast',
  'nav-dispersion': 'Navigation',
  'nav-item-count': 'Navigation',
  'heading-hierarchy-jump': 'Page structure',
  'form-label-missing': 'Accessibility',
  'image-alt-text-missing': 'Accessibility',
  'link-text-generic': 'Link quality',
  'dead-click-target': 'Interaction',
  'missing-meta-description': 'SEO',
  'missing-canonical-url': 'SEO',
  'vague-claim-detected': 'Copy quality',
  'proof-missing': 'Copy quality',
  'cta-verb-mismatch': 'Copy quality',
  'rage-click-target': 'Behavioral',
  'bounce-on-key-page': 'Behavioral',
  'return-visit-thrash': 'Behavioral',
  'help-seeking-spike': 'Behavioral',
  'hesitation-pattern': 'Behavioral',
  'form-abandonment': 'Behavioral',
  'freeze-on-cta': 'Behavioral',
  'dead-zone': 'Behavioral',
  'scroll-reversal': 'Behavioral',
  'frustration-signal': 'Behavioral',
  'flow-inter-step-dropoff': 'Conversion flow',
};

function ruleCategoryTag(ruleId: string): string {
  return RULE_CATEGORIES[ruleId] ?? 'Structural';
}

/**
 * Parses evidence atoms (split on " · ") into categorized groups and renders
 * a structured diagnostic block:
 *   - main observations → bullet list (or single paragraph when only one)
 *   - "Examples: …" atoms → monospace inset block
 *   - "Page: …" / "Pages: …" atoms → monospace path tags
 *   - "Based on: …" atoms → italic footnote
 *
 * Email-safe: indented divs, no flex/grid, Outlook-compatible.
 */
function renderEvidenceStructured(evidence: string): string {
  const atoms = evidence
    .split(/\s+·\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const main: string[] = [];
  const pageRefs: string[] = [];
  const basedOn: string[] = [];
  const examples: string[] = [];

  for (const atom of atoms) {
    if (/^pages?:\s*/i.test(atom)) {
      pageRefs.push(atom.replace(/^pages?:\s*/i, '').trim());
    } else if (/^based on:\s*/i.test(atom)) {
      basedOn.push(atom.replace(/^based on:\s*/i, '').trim());
    } else if (/^examples?:\s*/i.test(atom)) {
      examples.push(atom.replace(/^examples?:\s*/i, '').trim());
    } else {
      main.push(atom);
    }
  }

  let html = '';

  if (main.length === 0 && atoms.length > 0) {
    // Fallback: no categorizable atoms — render everything as plain text
    html += `<div style="font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.6; color: ${INK};">${escapeHtml(evidence)}</div>`;
  } else if (main.length === 1) {
    html += `<div style="font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.6; color: ${INK};">${escapeHtml(main[0])}</div>`;
  } else {
    html += main
      .map(
        (a) =>
          `<div style="font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.55; color: ${INK}; padding-left: 14px; text-indent: -8px; margin: 0 0 5px;"><span style="color: ${MUTED};">•</span>&nbsp;${escapeHtml(a)}</div>`,
      )
      .join('');
  }

  if (examples.length > 0) {
    html += `<div style="margin-top: 8px; padding: 5px 10px; background: rgba(0,0,0,0.04); border-left: 2px solid ${HAIRLINE}; font-family: 'Courier New', Courier, monospace; font-size: 12px; color: ${INK};">${examples.map(escapeHtml).join(' · ')}</div>`;
  }

  if (pageRefs.length > 0) {
    const tags = pageRefs
      .map(
        (p) =>
          `<span style="display: inline-block; padding: 1px 7px; background: rgba(0,0,0,0.05); border: 1px solid ${HAIRLINE}; font-family: 'Courier New', Courier, monospace; font-size: 11px; color: ${INK}; margin-right: 4px; margin-bottom: 2px;">${escapeHtml(p)}</span>`,
      )
      .join('');
    html += `<div style="margin-top: 9px;">${tags}</div>`;
  }

  if (basedOn.length > 0) {
    html += `<div style="margin-top: 8px; font-family: ${FONT_STACK}; font-size: 11px; color: ${MUTED}; font-style: italic;">Based on: ${escapeHtml(basedOn.join('; '))}</div>`;
  }

  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline before/after pair for the email card. Side-by-side images +
 * model rationale. Email-client safe — table layout, no flexbox, no
 * srcset, no <picture>. Skipped when no before URL is present.
 */
function fixPreviewRow(f: AuditFindingForEmail): string {
  const beforeUrl = f.screenshotBeforeUrl;
  const afterUrl = f.screenshotAfterUrl;
  if (!beforeUrl) return '';

  // Tier 3 (before only) — single screenshot with a "sign up to see the fix"
  // note underneath the image. The signup CTA at the bottom of the email
  // is the actual conversion path; this nudges the reader toward it.
  if (!afterUrl) {
    return `
      <tr>
        <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Current state</div>
          <img src="${escapeHtml(beforeUrl)}" alt="Current page state" width="540" style="display: block; width: 100%; max-width: 540px; height: auto; border: 1px solid ${HAIRLINE};" />
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; color: ${MUTED}; margin-top: 10px;">Sign up to see the proposed fix rendered side-by-side.</div>
        </td>
      </tr>`;
  }

  const rationaleRow = f.fixRationale
    ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; color: ${MUTED}; margin-top: 10px; font-style: italic;">${escapeHtml(f.fixRationale)}</div>`
    : '';

  return `
    <tr>
      <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 10px;">Before vs after</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="50%" valign="top" style="padding-right: 6px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 6px;">Before</div>
              <img src="${escapeHtml(beforeUrl)}" alt="Page before fix" width="260" style="display: block; width: 100%; height: auto; border: 1px solid ${HAIRLINE};" />
            </td>
            <td width="50%" valign="top" style="padding-left: 6px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${INK}; margin-bottom: 6px;">After</div>
              <img src="${escapeHtml(afterUrl)}" alt="Page after fix" width="260" style="display: block; width: 100%; height: auto; border: 2px solid ${INK};" />
            </td>
          </tr>
        </table>
        ${rationaleRow}
      </td>
    </tr>`;
}

function findingCard(f: AuditFindingForEmail): string {
  const metaBar = `
    <tr>
      <td style="padding: 9px 18px; border-bottom: 1px solid ${HAIRLINE}; background: rgba(0,0,0,0.02);">
        <span style="font-family: ${FONT_STACK}; font-size: 9px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">${escapeHtml(ruleCategoryTag(f.ruleId))}</span>
      </td>
    </tr>`;

  const whyItMattersRow = f.whyItMatters
    ? `
      <tr>
        <td style="padding: 14px 18px 4px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: ${FONT_STACK}; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Why this matters</div>
          <div style="font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.6; color: ${INK}; padding-bottom: 10px;">${escapeHtml(f.whyItMatters)}</div>
        </td>
      </tr>`
    : '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 24px; border-collapse: separate; border: 2px solid ${INK}; box-shadow: 6px 6px 0 ${INK}; background: ${CREAM};">
      ${metaBar}
      <tr>
        <td style="padding: 16px 18px 14px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: ${FONT_STACK}; font-size: 18px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; color: ${INK};">${escapeHtml(f.title)}</div>
        </td>
      </tr>
      ${whyItMattersRow}
      <tr>
        <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: ${FONT_STACK}; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 10px;">Structural observation</div>
          ${renderEvidenceStructured(f.evidence)}
        </td>
      </tr>
      <tr>
        <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: ${FONT_STACK}; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Recommendation</div>
          <div style="font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.6; color: ${INK};">${escapeHtml(f.whatToChange)}</div>
        </td>
      </tr>
      ${fixPreviewRow(f)}
      <tr>
        <td style="padding: 14px 18px; background: ${INK};">&nbsp;</td>
      </tr>
    </table>
  `;
}

/**
 * Returns true when the brand-DNA payload has at least one signal worth
 * rendering. An all-null payload — which is what a structural-mode capture
 * (or a failed Browserless run that was upserted by some other path) would
 * produce — gets the same treatment as a fully-absent payload: skip the
 * section entirely instead of rendering an empty card.
 */
function hasBrandDna(brandDna: AuditBrandDna | null | undefined): brandDna is AuditBrandDna {
  if (!brandDna) return false;
  return Boolean(
    brandDna.primaryColor ||
      brandDna.secondaryColor ||
      (brandDna.typeScale && brandDna.typeScale.length > 0) ||
      brandDna.cssSystem ||
      brandDna.ctaVocabulary.length > 0,
  );
}

/**
 * Inline color swatch + hex label. Both inline so Outlook renders it.
 *
 * `hex` comes from a third-party page via `extractDesignTokens` and lands
 * in a CSS `background` declaration. `escapeHtml` neutralizes HTML entities
 * but leaves `;` and `}` intact, so a non-hex value with CSS-special chars
 * could inject additional declarations into the email body (PR #85 review
 * issue #2). Validate against a strict hex pattern before rendering and
 * drop the swatch entirely on a mismatch — a missing swatch is preferable
 * to a CSS injection vector.
 */
const SAFE_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
function colorSwatch(hex: string, label: string): string {
  if (!SAFE_HEX_RE.test(hex)) return '';
  const safe = escapeHtml(hex);
  // Use table layout (not flex/gap) so Outlook 2016 renders correctly.
  return `
    <td style="vertical-align: top; padding-right: 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 8px;">
            <span style="display: block; width: 22px; height: 22px; background: ${safe}; border: 1px solid ${HAIRLINE};"></span>
          </td>
          <td style="vertical-align: middle;">
            <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; color: ${INK};">
              <span style="display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 2px;">${escapeHtml(label)}</span>
              ${safe}
            </span>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function brandDnaSection(report: AuditReport): string {
  if (!hasBrandDna(report.brandDna)) return '';
  const b = report.brandDna;

  // Labels reflect what's actually measured: `primaryColor` is the mode of
  // CTA backgrounds (not a brand-system primary), `secondaryColor` is the
  // mode of heading colors. Calling the first "Brand primary" overstates a
  // detector that just sees that Stripe ships black CTAs on its hero.
  const swatchCells: string[] = [];
  if (b.primaryColor) {
    const cell = colorSwatch(b.primaryColor, 'CTA fill');
    if (cell) swatchCells.push(cell);
  }
  if (b.secondaryColor) {
    const cell = colorSwatch(b.secondaryColor, 'Heading');
    if (cell) swatchCells.push(cell);
  }
  const swatchRow = swatchCells.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 14px;"><tr>${swatchCells.join('')}</tr></table>`
    : '';

  const factRow = (label: string, value: string): string =>
    `<tr><td style="padding: 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${MUTED}; width: 38%;">${escapeHtml(label)}</td><td style="padding: 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; color: ${INK};">${value}</td></tr>`;

  const factRows: string[] = [];
  // `cssSystem === null` doesn't mean "no system" — it means the matcher
  // didn't recognize a fingerprint. Render the row anyway with explanatory
  // copy so a Stripe/Linear-class site doesn't look broken in the report.
  if (b.cssSystem) {
    factRows.push(factRow('Framework', escapeHtml(b.cssSystem)));
  } else {
    factRows.push(
      factRow('Framework', `<span style="color: ${MUTED};">custom compiled CSS</span>`),
    );
  }
  if (b.typeScale && b.typeScale.length > 0) {
    const scale = b.typeScale.map((n) => `${n}px`).join(' · ');
    factRows.push(factRow('Observed type sizes', escapeHtml(scale)));
  }
  if (b.ctaVocabulary.length > 0) {
    const samples = b.ctaVocabulary
      .slice(0, 5)
      .map((t) => `&ldquo;${escapeHtml(t)}&rdquo;`)
      .join(' · ');
    factRows.push(factRow('Conversion copy', samples));
  }
  const factsTable = factRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${factRows.join('')}</table>`
    : '';

  return `
          <tr>
            <td style="padding: 0 28px 24px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 12px;">What we observed</div>
              <div style="border: 1px solid ${HAIRLINE}; padding: 16px 18px;">
                ${swatchRow}
                ${factsTable}
                <p style="margin: 12px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.55; color: ${MUTED};">These are the visible signals we extracted from your homepage — the colors your CTAs and headings actually render with, the type sizes the page uses, and the conversion copy we found. The findings below reference them by name.</p>
              </div>
            </td>
          </tr>
  `;
}

function screenshotSection(report: AuditReport): string {
  if (!report.screenshotUrl) return '';

  const imgTag = `<img src="${escapeHtml(report.screenshotUrl)}" width="544" alt="Above-fold screenshot of ${escapeHtml(report.domain)}" style="display: block; width: 100%; max-width: 544px; border: 2px solid ${INK}; box-shadow: 6px 6px 0 ${INK};" />`;

  const caption = report.visionObs
    ? `<p style="margin: 10px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; line-height: 1.6; color: ${INK}; font-style: italic;">${escapeHtml(report.visionObs)}</p>`
    : '';

  return `
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 12px;">What we saw</div>
              ${imgTag}
              ${caption}
            </td>
          </tr>
  `;
}

export function renderAuditReportEmailHtml(report: AuditReport): string {
  const findingsHtml = report.findings.map(findingCard).join('\n');
  const safeDomain = escapeHtml(report.domain);
  const safeRole = escapeHtml(report.prospect.role);
  const moreCount = Math.max(0, report.totalFindings - report.findings.length);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Zybit audit — ${safeDomain}</title>
</head>
<body style="margin: 0; padding: 0; background: #EFEEE9;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #EFEEE9;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: ${CREAM};">

          <!-- Cover -->
          <tr>
            <td style="padding: 28px 28px 8px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: ${MUTED};">Zybit · 60-second audit</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 28px 24px;">
              <h1 style="margin: 8px 0 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 36px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: ${INK};">${safeDomain}</h1>
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.55; color: ${INK};">
                ${introCopy(report)}
              </p>
            </td>
          </tr>

          <!-- Summary strip -->
          <tr>
            <td style="padding: 0 28px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid ${HAIRLINE}; border-bottom: 1px solid ${HAIRLINE};">
                <tr>
                  <td style="padding: 14px 0; width: 50%; vertical-align: top;">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">Findings ranked</div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: ${INK}; margin-top: 4px;">${report.totalFindings}</div>
                  </td>
                  <td style="padding: 14px 0; width: 50%; vertical-align: top;">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">Pages scanned</div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: ${INK}; margin-top: 4px;">${report.pagesScanned}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${brandDnaSection(report)}

          ${screenshotSection(report)}

          <!-- Findings -->
          <tr>
            <td style="padding: 0 28px;">
              ${findingsHtml}
            </td>
          </tr>

          <!-- "more findings" note + CTA pair -->
          <tr>
            <td style="padding: 8px 28px 28px;">
              ${
                moreCount > 0
                  ? `<p style="margin: 0 0 22px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 14px; line-height: 1.55; color: ${MUTED};">
                <strong style="color: ${INK};">${moreCount} other findings didn&rsquo;t make the cut.</strong> They&rsquo;re lower-impact or lower-confidence — worth seeing once you&rsquo;ve fixed the ones above.
              </p>`
                  : ''
              }
              <!-- Primary CTA: book a call with founders -->
              <a href="${escapeHtml(report.bookCallUrl)}" style="display: inline-block; padding: 14px 28px; background: ${INK}; color: ${CREAM}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; box-shadow: 4px 4px 0 ${INK}; border: 1px solid ${INK};">Book 30 min with us →</a>
              <p style="margin: 12px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.5; color: ${MUTED};">
                30 minutes on a screen-share. We&rsquo;ll walk through each finding, answer your questions, and tell you straight whether Zybit fits your team. No pitch deck.
              </p>
            </td>
          </tr>

          <!-- Caveat: what this audit can and can't see -->
          <tr>
            <td style="padding: 0 28px 24px;">
              <div style="border: 1px dashed ${HAIRLINE}; padding: 14px 16px; background: rgba(0,0,0,0.02);">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 6px;">Based on page structure, not your visitors yet</div>
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; line-height: 1.55; color: ${INK};">
                  The findings above come from parsing your HTML — what your page emphasizes, how the nav is structured, where the CTAs sit. They&rsquo;re real structural observations, but we can&rsquo;t see how your real visitors actually behave yet. <a href="${escapeHtml(report.bookCallUrl)}" style="color: ${INK}; text-decoration: underline; font-weight: 600;">Jump on a call</a> and we&rsquo;ll explain how the other ${numberWord(PUBLIC_AUDIT_DEFERRED_RULE_COUNT)} rules light up once we connect your analytics — rage-clicks, drop-offs, form abandonment, hesitation, and the patterns you only see in session data.
                </p>
              </div>
            </td>
          </tr>

          <!-- Founder signature -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="border-top: 1px solid ${HAIRLINE}; padding-top: 18px;">
                <p style="margin: 0 0 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 14px; line-height: 1.55; color: ${INK};">
                  — Asad &amp; Jad
                </p>
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${MUTED};">
                  Zybit · Built at Cornell
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; line-height: 1.55; color: #999;">
                Sent to ${escapeHtml(report.prospect.email)} (${safeRole}) because you requested a Zybit audit of <a href="${escapeHtml(report.url)}" style="color: #999;">${safeDomain}</a> on ${escapeHtml(report.generatedAt)}. We hold this audit for 90 days. Reply to this email if you'd like it removed sooner.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Inbox-line subject for the report email. Used to be hardcoded "Four
 * things to fix" — broken once the body learned to handle 0/1/N findings.
 * Empty-state runs need a subject that doesn't promise findings, and the
 * common 4-finding path still reads as "Four things to fix on acme.com".
 */
export function subjectForReport(report: AuditReport): string {
  const n = report.findings.length;
  if (n === 0) return `Your ${report.domain} audit is ready`;
  const word = numberWord(n);
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  return `${capitalized} ${n === 1 ? 'thing' : 'things'} to fix on ${report.domain}`;
}

export async function sendAuditReportEmail(
  to: string,
  report: AuditReport,
): Promise<{ success: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { success: false, error: 'RESEND_API_KEY not set' };
  }
  try {
    const html = renderAuditReportEmailHtml(report);
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      // AUDIT_FROM_EMAIL is the same env var auditConfirmationEmail uses, so
      // both transactional + report mail come from the same verified domain
      // once Resend DNS is set up. Default points at the production sender
      // address; until DNS is green Resend will reject these and the
      // pipeline will mark the audit failed via the existing error path.
      from: process.env.AUDIT_FROM_EMAIL ?? 'Asad & Jad at Zybit <asad@getzybit.com>',
      to,
      subject: subjectForReport(report),
      html,
    });
    if (error) {
      const detail =
        typeof error === 'object' && error !== null
          ? JSON.stringify(error)
          : String(error);
      return { success: false, error: detail };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function sampleAuditReport(): AuditReport {
  return {
    auditId: 'pub_sample0000000000000000',
    domain: 'acme.com',
    url: 'https://acme.com',
    prospect: {
      email: 'priya@acme.com',
      role: 'Head of Growth',
    },
    generatedAt: 'May 23, 2026 at 4:12 PM ET',
    pagesScanned: 7,
    rulesEvaluated: 13,
    totalFindings: 11,
    bookCallUrl: 'https://calendly.com/asad-getzybit/30min',
    screenshotUrl: 'https://fakeimg.pl/544x300/EFEEE9/111?text=acme.com+homepage',
    visionObs:
      'The hero section leads with a "Book a demo" CTA in a heavy filled button, but the scroll depth and CTA click data both point to trial-intent visitors. The above-fold layout dedicates roughly 60% of its visual weight to a product illustration — the CTA competes with it rather than anchoring it.',
    brandDna: {
      primaryColor: '#1A73E8',
      secondaryColor: '#0F2540',
      typeScale: [14, 16, 20, 28, 48],
      cssSystem: 'tailwind',
      ctaVocabulary: ['Start free trial', 'Book a demo', 'See pricing', 'Get started'],
    },
    findings: [
      {
        id: 'f1',
        rank: 1,
        severity: 'high',
        confidence: 0.84,
        ruleId: 'rage-click-target',
        title: 'Visitors are rage-clicking your checkout promo-code field',
        whyItMatters: null,
        evidence:
          '847 rage-click events on #promo-code over the last 7 days. Checkout completion rate is 2.1% for sessions that interact with the field vs. 3.4% for sessions that skip it — a 38% relative drop.',
        whatToChange:
          'Collapse the promo-code input behind a "Have a code?" toggle below the primary CTA. Keeps the field reachable for the 4% who need it without making the other 96% pause on it.',
        estimatedImpactMonthlyUsd: 3200,
        screenshotBeforeUrl: 'https://fakeimg.pl/540x340/EFEEE9/111?text=Before+(promo+field+visible)',
        screenshotAfterUrl: 'https://fakeimg.pl/540x340/E8F5E9/111?text=After+(collapsed+behind+toggle)',
        fixPreviewTier: 2,
        fixRationale: 'AI-generated visual edit: collapsed the promo-code input behind a "Have a code?" toggle, reducing above-the-fold friction on the checkout flow.',
      },
      {
        id: 'f2',
        rank: 2,
        severity: 'high',
        confidence: 0.79,
        ruleId: 'hero-hierarchy-inversion',
        title: 'Your visitors want "Start free trial", but your homepage points them at "Book a demo"',
        whyItMatters:
          'Your visitors are reaching for "Start free trial", but your hero is pointing them at "Book a demo" with the loud filled button. Every visitor who arrives wanting the trial has to scan past the demo CTA to find the one they actually want — that\'s friction you\'re paying for on every session.',
        evidence:
          'What visitors click most: "Start free trial" · 58% of clicks · 312 clicks · What your design emphasizes: "Book a demo" in the hero with a filled background and bold weight · Page: your homepage · Based on: 538 button clicks over the last 14 days',
        whatToChange:
          'Promote "Start free trial" to the hero with the same filled background and bold weight "Book a demo" has today. Demote "Book a demo" to a secondary outlined style.',
        estimatedImpactMonthlyUsd: 5400,
      },
      {
        id: 'f3',
        rank: 3,
        severity: 'medium',
        confidence: 0.71,
        ruleId: 'cta-low-contrast',
        title: 'Pricing-page CTA fails WCAG contrast at body size',
        whyItMatters: null,
        evidence:
          'The "Choose Growth" button on /pricing uses #B8E0CC on #FAFAF8 — contrast ratio 1.9:1, well below the 4.5:1 floor. On mobile (where 62% of pricing traffic lands) the button is the smallest tap target on the page.',
        whatToChange:
          'Darken the button background to a contrast ratio ≥ 4.5:1 (e.g. #2D7A50 against the cream background) and increase the mobile tap target to ≥ 44×44 px.',
        estimatedImpactMonthlyUsd: 1800,
      },
      {
        id: 'f4',
        rank: 4,
        severity: 'medium',
        confidence: 0.66,
        ruleId: 'nav-dispersion',
        title: 'Top nav forces users to choose between 9 items',
        whyItMatters: null,
        evidence:
          'The primary nav contains 9 top-level items (Product, Features, Solutions, Use cases, Customers, Pricing, Docs, Blog, Login). Click distribution is concentrated on 3 — Pricing (41%), Docs (22%), Login (18%) — and the other 6 collectively absorb 19% of clicks. The variance is hurting discoverability.',
        whatToChange:
          'Consolidate Product/Features/Solutions/Use cases under a single "Product" dropdown. Move Customers + Blog under a "Company" dropdown. Surface Pricing, Docs, and Login as top-level only.',
        estimatedImpactMonthlyUsd: 1100,
      },
    ],
  };
}
