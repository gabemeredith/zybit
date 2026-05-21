/**
 * Copy-quality hint (Zybit-125).
 *
 * A deterministic, builder-side suggestion for variant *copy* (the text a
 * PM types for a `copy` modification). This is NOT an audit rule — it never
 * produces findings or touches detection. It's advisory guidance shown next
 * to the copy field so a PM writes a stronger CTA. Pure: same text → same
 * hints, no LLM, no invented numbers.
 *
 * Tuned for short calls-to-action (button/link labels), which is what the
 * `copy` change type targets in practice.
 */

export interface CopyHint {
  level: 'suggest' | 'warn';
  message: string;
}

/** Verbs that make a strong, action-led CTA. Lowercased, matched on the first word. */
const ACTION_VERBS = new Set([
  'get', 'start', 'try', 'claim', 'join', 'create', 'build', 'book', 'buy',
  'add', 'see', 'find', 'discover', 'download', 'unlock', 'explore', 'save',
  'grab', 'request', 'schedule', 'subscribe', 'upgrade', 'send', 'shop',
  'browse', 'compare', 'choose', 'pick', 'activate', 'launch',
]);

/** Generic, low-signal labels that don't tell the visitor what happens next. */
const GENERIC = [/\bclick here\b/i, /\bsubmit\b/i, /\blearn more\b/i, /\bread more\b/i, /\bmore info\b/i];

const MAX_CTA_CHARS = 30;
const MAX_CTA_WORDS = 6;

export function copyHints(text: string): CopyHint[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const hints: CopyHint[] = [];
  const words = trimmed.split(/\s+/);
  const letters = trimmed.replace(/[^A-Za-z]/g, '');

  if (trimmed.length > MAX_CTA_CHARS || words.length > MAX_CTA_WORDS) {
    hints.push({ level: 'warn', message: 'Long for a button — strong CTAs are usually 2–4 words.' });
  }

  if (letters.length >= 3 && trimmed === trimmed.toUpperCase()) {
    hints.push({ level: 'suggest', message: 'All-caps can read as shouting; try sentence case.' });
  }

  if (GENERIC.some((re) => re.test(trimmed))) {
    hints.push({ level: 'suggest', message: "Generic label — say what happens next (e.g. 'Start free trial')." });
  }

  const firstWord = words[0].toLowerCase().replace(/[^a-z]/g, '');
  if (firstWord && !ACTION_VERBS.has(firstWord)) {
    hints.push({ level: 'suggest', message: 'Lead with an action verb (Get, Start, Try, Claim…).' });
  }

  if (/[.]$/.test(trimmed)) {
    hints.push({ level: 'suggest', message: 'Drop the trailing period on button copy.' });
  }

  return hints;
}
