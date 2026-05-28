import { describe, it, expect } from 'vitest';
import { classifySiteFromSnapshots, isNonCommercialNiche } from '../siteClassifier';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';

// Minimal snapshot factory — only the fields the classifier reads.
function makeSnapshot(overrides: {
  url?: string;
  pathRef?: string;
  title?: string;
  description?: string;
  headings?: string[];
  ctas?: string[];
}): PageSnapshot {
  return {
    id: 'test-id',
    organizationId: 'org',
    siteId: 'site',
    pathRef: overrides.pathRef ?? '/',
    url: overrides.url ?? 'https://example.com/',
    fetchedAt: new Date(),
    createdAt: new Date(),
    data: {
      schemaVersion: 1 as const,
      meta: {
        title: overrides.title ?? null,
        description: overrides.description ?? null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        canonical: null,
        lang: 'en',
        charset: 'UTF-8',
        themeColor: null,
        viewport: 'width=device-width',
        robotsMeta: null,
      },
      headings: (overrides.headings ?? []).map((text, i) => ({
        level: (i === 0 ? 1 : 2) as 1 | 2,
        text,
        documentIndex: i,
        cssSelector: `h${i === 0 ? 1 : 2}:nth-of-type(${i + 1})`,
      })),
      ctas: (overrides.ctas ?? []).map((text, i) => ({
        ref: `ref-${i}`,
        tag: 'a' as const,
        text,
        ariaLabel: null,
        href: '#',
        landmark: 'main' as const,
        visualWeight: 0.5,
        visualWeightSignals: [],
        foldGuess: 'above' as const,
        domDepth: 3,
        disabled: false,
        documentIndex: i,
        cssSelector: `a:nth-of-type(${i + 1})`,
      })),
      forms: [],
      images: [],
      contentHash: 'abc',
      rawByteSize: 1000,
      parsedAt: new Date().toISOString(),
    },
  };
}

describe('classifySiteFromSnapshots', () => {
  it('returns unknown for an empty snapshot array', () => {
    expect(classifySiteFromSnapshots([])).toBe('unknown');
  });

  it('classifies a SaaS site from trial + pricing copy', () => {
    const snap = makeSnapshot({
      url: 'https://acme.io/',
      title: 'Acme — Project Management Software',
      description: 'Start your free trial. No credit card required.',
      headings: ['Trusted by 3,000+ companies', 'Book a demo today'],
      ctas: ['Start free trial', 'Contact sales', 'See enterprise plan'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('saas');
  });

  it('classifies a devtools site from npm + open-source signals', () => {
    const snap = makeSnapshot({
      url: 'https://mylib.dev/',
      title: 'MyLib — Open Source HTTP Client',
      description: 'npm install mylib. Zero config. TypeScript-ready.',
      headings: ['API Reference', 'Quickstart', 'GitHub →'],
      ctas: ['Star on GitHub', 'View API reference', 'npm install mylib'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('devtools');
  });

  it('classifies an e-commerce site from cart + shipping signals', () => {
    const snap = makeSnapshot({
      url: 'https://shop.example.com/',
      title: 'StyleHaus — Women\'s Clothing',
      description: 'Free shipping on orders over $50. Shop new arrivals.',
      headings: ['New Arrivals', 'Best Sellers', 'Shop the collection'],
      ctas: ['Add to cart', 'Buy now', 'Shop now'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('ecommerce');
  });

  it('classifies a fraternity site as community', () => {
    const snap = makeSnapshot({
      url: 'https://alphabeta.cornell.edu/',
      title: 'Alpha Beta Gamma — Cornell Chapter',
      description: 'Brotherhood, scholarship, and service. Join our chapter this rush week.',
      headings: ['About Our Brotherhood', 'Recruitment Season', 'Philanthropy Events'],
      ctas: ['Rush Info', 'Meet the Brothers', 'Alumni Network'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('community');
  });

  it('classifies a nonprofit as community', () => {
    const snap = makeSnapshot({
      url: 'https://helpkids.org/',
      title: 'Help Kids Foundation — 501(c)(3) Nonprofit',
      description: 'Donate today. Volunteer with us. Community service opportunities.',
      headings: ['Our Mission', 'Ways to Give', 'Board of Directors'],
      ctas: ['Donate now', 'Volunteer', 'Join as a member'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('community');
  });

  it('classifies a university as education', () => {
    const snap = makeSnapshot({
      url: 'https://state.edu/',
      title: 'State University — Admissions',
      description: 'Apply for admission. Financial aid and scholarships available.',
      headings: ['Undergraduate Programs', 'Graduate School', 'Campus Life'],
      ctas: ['Apply now', 'Request information', 'Schedule a campus visit'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('education');
  });

  it('classifies an online course platform as education', () => {
    const snap = makeSnapshot({
      url: 'https://learncode.io/',
      title: 'LearnCode — Online Coding Bootcamp',
      description: 'Enroll today. Certificate programs and degree programs available.',
      headings: ['Online Courses', 'Coding Bootcamp', 'Continuing Education'],
      ctas: ['Enroll now', 'View course catalog', 'Apply for financial aid'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('education');
  });

  it('classifies a news site as media', () => {
    const snap = makeSnapshot({
      url: 'https://daily-news.com/',
      title: 'The Daily — Breaking News and Analysis',
      description: 'Subscribe to our newsletter. Latest news coverage from our editorial team.',
      headings: ['Breaking News', 'Editor in Chief', 'Latest Articles'],
      ctas: ['Subscribe to newsletter', 'Read more', 'Follow on Twitter'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('media');
  });

  it('classifies a restaurant as local', () => {
    const snap = makeSnapshot({
      url: 'https://pasta-place.com/',
      title: 'Pasta Palace — Family-Owned Italian Restaurant',
      description: 'Book a table. Serving Ithaca since 1988. Dine in or takeout.',
      headings: ['Our Menu', 'Happy Hour', 'Hours of Operation'],
      ctas: ['Make a reservation', 'View our menu', 'Order online'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('local');
  });

  it('returns unknown when signals are mixed and do not exceed the confidence margin', () => {
    // A generic corporate homepage with weak signals across multiple categories
    const snap = makeSnapshot({
      url: 'https://generic-corp.com/',
      title: 'GenericCorp — Solutions',
      description: 'We help businesses grow.',
      headings: ['About us', 'Our services'],
      ctas: ['Contact us'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('unknown');
  });

  it('does NOT misclassify a fraternity as devtools just because it mentions GitHub', () => {
    const snap = makeSnapshot({
      url: 'https://alphabeta.org/',
      title: 'Alpha Beta — Our Chapter',
      description: 'Brotherhood and service. Rush week starting soon. Philanthropy events.',
      headings: ['Our Brotherhood', 'Recruitment', 'Sisterhood', 'Philanthropy Event'],
      ctas: ['Rush Info', 'Meet the Brothers', 'Follow on GitHub'],
    });
    // GitHub alone (weight 2) is swamped by all the community signals
    expect(classifySiteFromSnapshots([snap])).toBe('community');
  });

  it('uses .edu TLD as a domain-level signal', () => {
    const snap = makeSnapshot({
      url: 'https://cs.state.edu/programs',
      pathRef: '/programs',
      title: 'Computer Science — Programs',
      description: 'Undergraduate and graduate programs. Apply for admission.',
      headings: ['Academic Programs', 'Faculty', 'Scholarships'],
      ctas: ['Apply now', 'View curriculum'],
    });
    expect(classifySiteFromSnapshots([snap])).toBe('education');
  });

  it('accumulates signals across multiple snapshots', () => {
    const home = makeSnapshot({
      url: 'https://acme.com/',
      title: 'Acme — Software',
      ctas: ['Start free trial'],
    });
    const pricing = makeSnapshot({
      url: 'https://acme.com/pricing',
      pathRef: '/pricing',
      title: 'Pricing — Acme',
      description: 'No credit card required. Cancel anytime.',
      headings: ['Starter plan', 'Pro plan', 'Enterprise plan'],
      ctas: ['Get started free', 'Book a demo', 'Contact sales'],
    });
    expect(classifySiteFromSnapshots([home, pricing])).toBe('saas');
  });
});

describe('isNonCommercialNiche', () => {
  it('returns true for community', () => {
    expect(isNonCommercialNiche('community')).toBe(true);
  });

  it('returns true for education', () => {
    expect(isNonCommercialNiche('education')).toBe(true);
  });

  it('returns false for saas', () => {
    expect(isNonCommercialNiche('saas')).toBe(false);
  });

  it('returns false for unknown', () => {
    expect(isNonCommercialNiche('unknown')).toBe(false);
  });
});
