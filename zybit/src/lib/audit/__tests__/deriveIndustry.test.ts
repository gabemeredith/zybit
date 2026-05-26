import { describe, it, expect } from 'vitest';
import { deriveIndustry } from '../deriveIndustry';

describe('deriveIndustry', () => {
  describe('host hints', () => {
    it('classifies myshopify subdomains as ecommerce', () => {
      expect(deriveIndustry('https://acme.myshopify.com/')).toBe('ecommerce');
    });

    it('classifies salesforce as saas', () => {
      expect(deriveIndustry('https://app.salesforce.com/')).toBe('saas');
    });

    it('classifies stripe.com as fintech', () => {
      expect(deriveIndustry('https://stripe.com/pricing')).toBe('fintech');
    });

    it('classifies media outlets as media', () => {
      expect(deriveIndustry('https://www.nytimes.com/section/business')).toBe('media');
    });
  });

  describe('subdomain hints', () => {
    it('classifies shop.* as ecommerce', () => {
      expect(deriveIndustry('https://shop.example.com/')).toBe('ecommerce');
    });

    it('classifies app.* as saas', () => {
      expect(deriveIndustry('https://app.example.io/')).toBe('saas');
    });

    it('classifies bank.* as fintech', () => {
      expect(deriveIndustry('https://bank.example.com/login')).toBe('fintech');
    });
  });

  describe('path hints', () => {
    it('classifies /checkout as ecommerce', () => {
      expect(deriveIndustry('https://example.com/checkout')).toBe('ecommerce');
    });

    it('classifies /pricing as saas', () => {
      expect(deriveIndustry('https://example.com/pricing')).toBe('saas');
    });

    it('classifies /articles as media', () => {
      expect(deriveIndustry('https://example.com/articles/winter-roundup')).toBe('media');
    });
  });

  describe('copy signals', () => {
    it('classifies fintech keywords before saas (bank-platform should be fintech)', () => {
      const r = deriveIndustry('https://example.com/', {
        title: 'Acme Bank — the all-in-one platform for your money',
      });
      expect(r).toBe('fintech');
    });

    it('uses headings when title and description are absent', () => {
      const r = deriveIndustry('https://example.com/', {
        headings: ['Telehealth visits in 15 minutes'],
      });
      expect(r).toBe('healthtech');
    });

    it('classifies saas-only copy as saas', () => {
      const r = deriveIndustry('https://example.com/', {
        description: 'The workflow automation platform for sales teams',
      });
      expect(r).toBe('saas');
    });
  });

  describe('null cases', () => {
    it('returns null for an unparseable URL', () => {
      expect(deriveIndustry('not a url')).toBeNull();
    });

    it('returns null when no signal fires', () => {
      expect(deriveIndustry('https://example.com/about')).toBeNull();
    });

    it('returns null when copy signals are blank', () => {
      const r = deriveIndustry('https://example.com/about', {
        title: '',
        description: null,
        headings: [],
      });
      expect(r).toBeNull();
    });
  });
});
