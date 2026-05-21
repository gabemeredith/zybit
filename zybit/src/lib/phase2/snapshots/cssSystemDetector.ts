/**
 * Detect the CSS authoring system used by a page from its class names.
 *
 * Pure function — takes the full set of class tokens extracted from the DOM
 * and returns the most likely system. Confidence is based on hit-rate against
 * system-specific fingerprints.
 */

export type CssSystem =
  | 'tailwind'
  | 'styled-components'
  | 'emotion'
  | 'css-modules'
  | 'bootstrap'
  | 'unknown';

// Tailwind utility tokens: prefix-value patterns. We check a broad set of
// spacing/color/layout tokens that only appear in Tailwind projects.
// Tailwind spacing/sizing patterns require numeric or known keyword values
// (e.g. px-4, mt-8, w-full) to avoid matching arbitrary hyphenated class names.
const TAILWIND_PATTERNS = [
  /^(bg|text|border|ring|shadow|fill|stroke)-(inherit|current|transparent|black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-?\d*$/,
  /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-(\d+|auto|px|full|screen)$/,
  /^(w|h)-(0|1|2|3|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96|auto|full|screen|min|max|fit|px|\d+\/\d+)$/,
  /^(flex|grid|block|inline|inline-block|hidden|absolute|relative|fixed|sticky|static)$/,
  /^(rounded|rounded-(sm|md|lg|xl|2xl|3xl|full|none))$/,
  /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
  /^gap-\d+$/,
  /^(justify|items|self|content)-(start|end|center|between|around|evenly|stretch|baseline)$/,
  /^(flex-(row|col|wrap|nowrap|1|auto|none|grow|shrink))$/,
  /^(col|row)-span-\d+$/,
  /^(space-(x|y))-\d+$/,
  /^(duration|delay)-\d+$/,
];

// styled-components generates sc-<6-8 alphanumeric chars>
const STYLED_COMPONENTS_PATTERN = /^sc-[a-zA-Z0-9]{4,}$/;
const EMOTION_PATTERN = /^css-[a-zA-Z0-9]{5,}$/;
// CSS Modules: _ClassName, BEM __modifier, or CamelCase_hash (underscore-based, not hyphen)
const CSS_MODULES_PATTERN = /^_[a-zA-Z]|__[a-zA-Z]|[A-Z][a-zA-Z0-9]*_[a-zA-Z0-9]{5,}$/;
const BOOTSTRAP_CLASSES = new Set([
  'container', 'row', 'col', 'btn', 'card', 'navbar', 'nav', 'modal',
  'alert', 'badge', 'dropdown', 'form-control', 'form-group', 'd-flex',
  'd-none', 'd-block', 'text-center', 'text-muted', 'float-left', 'float-right',
  'justify-content-center', 'align-items-center',
]);

interface Scores {
  tailwind: number;
  'styled-components': number;
  emotion: number;
  'css-modules': number;
  bootstrap: number;
}

export function detectCssSystem(classTokens: string[]): CssSystem {
  if (classTokens.length === 0) return 'unknown';

  const scores: Scores = {
    tailwind: 0,
    'styled-components': 0,
    emotion: 0,
    'css-modules': 0,
    bootstrap: 0,
  };

  for (const token of classTokens) {
    if (STYLED_COMPONENTS_PATTERN.test(token)) {
      scores['styled-components'] += 2;
      continue;
    }
    if (EMOTION_PATTERN.test(token)) {
      scores.emotion += 2;
      continue;
    }
    if (BOOTSTRAP_CLASSES.has(token) || /^col-(xs|sm|md|lg|xl)-\d+$/.test(token)) {
      scores.bootstrap += 2;
      continue;
    }
    if (TAILWIND_PATTERNS.some((re) => re.test(token))) {
      scores.tailwind += 1;
      continue;
    }
    if (CSS_MODULES_PATTERN.test(token)) {
      scores['css-modules'] += 1;
    }
  }

  const total = classTokens.length;
  // Require meaningful signal density before declaring a winner
  const winner = (Object.entries(scores) as [CssSystem, number][])
    .filter(([, score]) => score / total > 0.05)
    .sort(([, a], [, b]) => b - a)[0];

  return winner?.[0] ?? 'unknown';
}

export function extractClassTokens(html: string): string[] {
  const tokens = new Set<string>();
  // Fast regex scan — no full DOM parse needed for class extraction
  const classAttrRe = /class(?:Name)?=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = classAttrRe.exec(html)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      if (tok) tokens.add(tok);
    }
  }
  return Array.from(tokens);
}
