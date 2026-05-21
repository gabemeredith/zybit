import { describe, it, expect } from 'vitest';
import { copyHints } from '../copyHint';

const messages = (text: string) => copyHints(text).map((h) => h.message);

describe('copyHints', () => {
  it('returns no hints for empty/whitespace copy', () => {
    expect(copyHints('')).toEqual([]);
    expect(copyHints('   ')).toEqual([]);
  });

  it('accepts a strong action-led CTA with no hints', () => {
    expect(copyHints('Start free trial')).toEqual([]);
    expect(copyHints('Get started')).toEqual([]);
  });

  it('warns when the copy is too long / too many words', () => {
    const hints = copyHints('Click this button to begin your completely free onboarding journey now');
    expect(hints.some((h) => h.level === 'warn')).toBe(true);
  });

  it('flags all-caps as shouting', () => {
    expect(messages('BUY NOW')).toEqual(expect.arrayContaining([expect.stringContaining('shouting')]));
  });

  it('flags generic labels', () => {
    expect(messages('Click here')).toEqual(expect.arrayContaining([expect.stringContaining('Generic')]));
    expect(messages('Submit')).toEqual(expect.arrayContaining([expect.stringContaining('Generic')]));
  });

  it('suggests leading with an action verb when the first word is not one', () => {
    expect(messages('Free account')).toEqual(expect.arrayContaining([expect.stringContaining('action verb')]));
  });

  it('flags a trailing period on button copy', () => {
    expect(messages('Get started.')).toEqual(expect.arrayContaining([expect.stringContaining('trailing period')]));
  });

  it('is deterministic', () => {
    expect(copyHints('Free account')).toEqual(copyHints('Free account'));
  });
});
