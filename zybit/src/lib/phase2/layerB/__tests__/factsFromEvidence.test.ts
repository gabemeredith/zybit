import { describe, expect, it } from 'vitest';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import { factsFromEvidence } from '../factsFromEvidence';
import { collectFactNumbers, verifyOutputAgainstFacts } from '../runLayerB';
import type { LayerBOutput } from '../runLayerB';

const bounce: AuditFinding = {
  id: 'bounce-on-key-page:/checking-accounts',
  ruleId: 'bounce-on-key-page',
  category: 'bounce',
  severity: 'warn',
  confidence: 0.87,
  priorityScore: 0.67,
  pathRef: '/checking-accounts',
  title: 'High bounce on key page',
  summary: 'template',
  recommendation: ['template'],
  evidence: [
    { label: 'Landing path', value: '/checking-accounts' },
    { label: 'Entries', value: 300 },
    { label: 'Bounces', value: 201 },
    { label: 'Bounce rate', value: '67%' },
  ],
  impactEstimate: {
    value: 6030,
    unit: 'sessions',
    period: 'monthly',
    formatted: '~6k sessions/month',
    basis: 'x',
  },
};

describe('factsFromEvidence', () => {
  it('camelCases evidence labels into fact keys', () => {
    const facts = factsFromEvidence(bounce);
    expect(facts.landingPath).toBe('/checking-accounts');
    expect(facts.entries).toBe(300);
    expect(facts.bounces).toBe(201);
    expect(facts.bounceRate).toBe('67%');
    expect(facts.pathRef).toBe('/checking-accounts');
  });

  it('includes the impact estimate headline number', () => {
    const facts = factsFromEvidence(bounce) as { impact?: { value: number } };
    expect(facts.impact?.value).toBe(6030);
  });

  it('returns an empty object for a finding with no evidence or impact', () => {
    const bare = { ...bounce, evidence: [], impactEstimate: undefined, pathRef: null };
    expect(Object.keys(factsFromEvidence(bare))).toHaveLength(0);
  });
});

describe('grounding over derived facts (string number parsing)', () => {
  it('collects numbers embedded in string fact values', () => {
    const { counts, percents } = collectFactNumbers(factsFromEvidence(bounce));
    expect(percents.has(67)).toBe(true); // from "67%"
    expect(counts.has(300)).toBe(true);
    expect(counts.has(6030)).toBe(true); // from impact.value
  });

  it('does not harvest numbers out of path identifiers', () => {
    const { counts } = collectFactNumbers({ pathRef: '/v1/api/2fa' });
    expect(counts.has(1)).toBe(false);
    expect(counts.has(2)).toBe(false);
  });

  it('passes verification for prose grounded in derived string facts', () => {
    const facts = factsFromEvidence(bounce);
    const out: LayerBOutput = {
      summary: '300 sessions land on /checking-accounts and 67% bounce.',
      recommendation: ['Match the hero to arrival intent.'],
      prescription: {
        whatToChange: 'Put one clear CTA above the fold.',
        whyItWorks: '67% leave without engaging — intent and content are mismatched.',
        experimentVariantDescription: 'Variant B: hero rewritten to top referrer intent.',
      },
    };
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(true);
  });

  it('still rejects a fabricated number against derived facts', () => {
    const facts = factsFromEvidence(bounce);
    const out: LayerBOutput = {
      summary: '888 sessions bounce at a 99% rate.',
      recommendation: ['ok'],
      prescription: { whatToChange: 'x', whyItWorks: 'y', experimentVariantDescription: 'z' },
    };
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(false);
  });
});
