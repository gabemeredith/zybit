import { describe, expect, it } from 'vitest';
import type { CanonicalEventInput } from '@/lib/phase2/types';
import type { EventSink } from '../sinks/types';
import { PERSONAS, personaById } from '../personas';
import { seededRng } from './rng';
import { runSession } from './sessionDriver';

class MemorySink implements EventSink {
  public emitted: CanonicalEventInput[] = [];
  async emit(input: CanonicalEventInput): Promise<void> {
    this.emitted.push(input);
  }
  async flush(): Promise<{ written: number }> {
    return { written: this.emitted.length };
  }
}

const baseOpts = (overrides: Partial<Parameters<typeof runSession>[0]> = {}) => ({
  siteId: 'lighthouse_site_test',
  paths: ['/', '/pricing', '/signup', '/docs'],
  sessionId: 'sess_0',
  distinctId: 'visitor_0',
  ...overrides,
});

describe('runSession', () => {
  it('emits at least pagesVisited pageview events', async () => {
    const sink = new MemorySink();
    const result = await runSession({
      ...baseOpts(),
      persona: personaById('casual'),
      rng: seededRng('test|casual|0'),
      sink,
    });
    const pageviews = sink.emitted.filter((e) => e.type === 'page_view').length;
    expect(pageviews).toBe(result.pagesVisited);
    expect(pageviews).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', async () => {
    const seedKey = 'test|evaluator|42';
    const sinkA = new MemorySink();
    const sinkB = new MemorySink();
    await runSession({
      ...baseOpts(),
      persona: personaById('evaluator'),
      rng: seededRng(seedKey),
      sink: sinkA,
    });
    await runSession({
      ...baseOpts(),
      persona: personaById('evaluator'),
      rng: seededRng(seedKey),
      sink: sinkB,
    });
    // Compare on the shape that doesn't depend on wall-clock occurredAt.
    const proj = (e: CanonicalEventInput) => ({
      type: e.type,
      path: e.path,
      metrics: e.metrics,
      sourceEventId: e.sourceEventId,
    });
    expect(sinkA.emitted.map(proj)).toEqual(sinkB.emitted.map(proj));
  });

  it('all emitted events share siteId and anonymousId', async () => {
    const sink = new MemorySink();
    await runSession({
      ...baseOpts({ siteId: 'site_abc', distinctId: 'vis_abc' }),
      persona: personaById('power-user'),
      rng: seededRng('test|power|0'),
      sink,
    });
    expect(sink.emitted.length).toBeGreaterThan(0);
    for (const e of sink.emitted) {
      expect(e.siteId).toBe('site_abc');
      expect(e.anonymousId).toBe('vis_abc');
      expect(e.sessionId).toBe('sess_0');
    }
  });

  it('cta_click events carry primaryCta properties when configured', async () => {
    const sink = new MemorySink();
    await runSession({
      ...baseOpts(),
      persona: personaById('power-user'),
      rng: seededRng('test|cta|0'),
      primaryCta: { ctaId: 'signup', selector: '[data-testid=signup-cta]' },
      sink,
    });
    const clicks = sink.emitted.filter((e) => e.type === 'cta_click');
    expect(clicks.length).toBeGreaterThan(0);
    for (const c of clicks) {
      expect(c.properties?.ctaId).toBe('signup');
      expect(c.properties?.selector).toBe('[data-testid=signup-cta]');
    }
  });

  it('respects bounce probability — many churning-persona sessions produce 1-page sessions', async () => {
    const churning = personaById('churning');
    let bounces = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const sink = new MemorySink();
      const r = await runSession({
        ...baseOpts(),
        persona: churning,
        rng: seededRng(`test|churning|${i}`),
        sink,
      });
      if (r.pagesVisited === 1) bounces++;
    }
    // churning.bounceProbability = 0.6 → expect majority bounce; floor at 0.5
    expect(bounces / N).toBeGreaterThan(0.5);
  });

  it('power users emit notably more cta_click than churning users (intent spread holds end-to-end)', async () => {
    const N = 50;
    const countClicks = async (id: string): Promise<number> => {
      let total = 0;
      for (let i = 0; i < N; i++) {
        const sink = new MemorySink();
        await runSession({
          ...baseOpts(),
          persona: personaById(id),
          rng: seededRng(`spread|${id}|${i}`),
          sink,
        });
        total += sink.emitted.filter((e) => e.type === 'cta_click').length;
      }
      return total;
    };
    const power = await countClicks('power-user');
    const churn = await countClicks('churning');
    expect(power).toBeGreaterThan(churn * 3);
  });

  it('produces unique sourceEventIds within a session', async () => {
    const sink = new MemorySink();
    await runSession({
      ...baseOpts(),
      persona: personaById('evaluator'),
      rng: seededRng('uniq|evaluator|0'),
      sink,
    });
    const ids = sink.emitted.map((e) => e.sourceEventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('walks across all five personas without throwing', async () => {
    for (const p of PERSONAS) {
      const sink = new MemorySink();
      await runSession({
        ...baseOpts(),
        persona: p,
        rng: seededRng(`smoke|${p.id}|0`),
        sink,
      });
      expect(sink.emitted.length).toBeGreaterThan(0);
    }
  });
});
