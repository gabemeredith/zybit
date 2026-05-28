/**
 * Site-level niche classifier — assigns a commercial context category to
 * the entire site so downstream rules and prescriptions can be tailored to
 * the kind of organisation being audited.
 *
 * Runs over ALL page snapshots (not just the home page) using a weighted
 * signal-scoring approach rather than first-match keyword logic. A
 * fraternity site that happens to mention "GitHub" in its footer will not
 * be misclassified as a developer-tools product.
 *
 * Design constraints (mirrors pageTypeModulation.ts):
 *   - Pure function. No I/O. No LLM calls. Deterministic: same input →
 *     same output. The classifier is allowed to read snapshot fields that
 *     are always present (meta, headings, ctas, pathRefs); it does NOT read
 *     optional vision-pass fields so it degrades gracefully when Gemini is
 *     unavailable.
 *   - Fail-open: when no niche scores above the confidence threshold the
 *     function returns `'unknown'`. Rules treat `'unknown'` as "apply base
 *     thresholds unchanged" — same as the pageTypeModulation NEUTRAL shape.
 *   - Conservative thresholds. The classifier must achieve a 2:1 margin over
 *     the next-highest contender AND a minimum absolute score before it will
 *     commit to a label. A tie or near-tie returns `'unknown'`.
 *
 * Tested by `classification/__tests__/siteClassifier.test.ts`.
 */

import type { PageSnapshot } from '@/lib/phase2/snapshots/types';

export type SiteNiche =
  | 'saas'        // B2B/B2C software product — trials, pricing, enterprise CTAs
  | 'devtools'    // Developer tools, open-source, CLI/SDK, API-first products
  | 'ecommerce'   // Transactional — product catalog, cart, checkout flow
  | 'community'   // Non-commercial — student orgs, clubs, nonprofits, membership groups
  | 'media'       // Content-first — blog, news, magazine, publication, podcast
  | 'local'       // Local business — restaurant, salon, clinic, service provider
  | 'education'   // Formal education — schools, universities, online courses/academies
  | 'unknown';    // Insufficient / ambiguous signal — rules apply base thresholds

interface SiteNicheScores {
  saas: number;
  devtools: number;
  ecommerce: number;
  community: number;
  media: number;
  local: number;
  education: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal table
//
// Weight bands:
//   3 = near-conclusive (this phrase appears almost exclusively in this niche)
//   2 = strong evidence (common in this niche, rare in others)
//   1 = moderate evidence (present in this niche, occasionally in others)
//   0.5 = weak / coincidental (provides a small push in the right direction)
//
// Patterns are tested against the full text blob of all snapshot pages.
// The table deliberately avoids single very short words (e.g. /\bfree\b/
// would fire on every niche) — prefer phrases over isolated words.
// ─────────────────────────────────────────────────────────────────────────────

const SIGNAL_TABLE: ReadonlyArray<{
  pattern: RegExp;
  niche: keyof SiteNicheScores;
  weight: number;
}> = [
  // ── SaaS — B2B/B2C software products ─────────────────────────────────────
  { pattern: /\bfree trial\b/i,                niche: 'saas', weight: 3 },
  { pattern: /\bstart (your )?free trial\b/i,  niche: 'saas', weight: 3 },
  { pattern: /\bno credit card required\b/i,   niche: 'saas', weight: 3 },
  { pattern: /\bbook a demo\b/i,               niche: 'saas', weight: 3 },
  { pattern: /\bschedule (a |your )?demo\b/i,  niche: 'saas', weight: 3 },
  { pattern: /\brequest a demo\b/i,            niche: 'saas', weight: 3 },
  { pattern: /\bwatch (a )?demo\b/i,           niche: 'saas', weight: 2 },
  { pattern: /\btalk to (sales|us)\b/i,        niche: 'saas', weight: 3 },
  { pattern: /\bcontact sales\b/i,             niche: 'saas', weight: 3 },
  { pattern: /\benterprise plan\b/i,           niche: 'saas', weight: 3 },
  { pattern: /\bbusiness plan\b/i,             niche: 'saas', weight: 2 },
  { pattern: /\bper seat\b/i,                  niche: 'saas', weight: 3 },
  { pattern: /\bper user.*month\b/i,           niche: 'saas', weight: 3 },
  { pattern: /\bmonthly.*annual\b/i,           niche: 'saas', weight: 2 },
  { pattern: /\bpaid annually\b/i,             niche: 'saas', weight: 2 },
  { pattern: /\bsave.*%.*annually\b/i,         niche: 'saas', weight: 3 },
  { pattern: /\bsaas\b/i,                      niche: 'saas', weight: 3 },
  { pattern: /\bsubscription plan\b/i,         niche: 'saas', weight: 2 },
  { pattern: /\bworkspace\b/i,                 niche: 'saas', weight: 1 },
  { pattern: /\bteam (plan|pricing)\b/i,       niche: 'saas', weight: 2 },
  { pattern: /\bunlimited (seats|users|members)\b/i, niche: 'saas', weight: 2 },
  { pattern: /\bsingle sign.?on\b/i,           niche: 'saas', weight: 2 },
  { pattern: /\bsso\b/i,                       niche: 'saas', weight: 1 },
  { pattern: /\brole.?based access\b/i,        niche: 'saas', weight: 2 },
  { pattern: /\baudit log\b/i,                 niche: 'saas', weight: 2 },
  { pattern: /\bsoc 2\b/i,                     niche: 'saas', weight: 2 },
  { pattern: /\bgdpr compliant\b/i,            niche: 'saas', weight: 2 },
  { pattern: /\buptime (sla|guarantee)\b/i,    niche: 'saas', weight: 3 },
  { pattern: /\bonboarding\b/i,                niche: 'saas', weight: 1 },
  { pattern: /\bcustomer success\b/i,          niche: 'saas', weight: 2 },
  { pattern: /\bdedicated (account|cso|csm)\b/i, niche: 'saas', weight: 2 },
  { pattern: /\bwhite.?label\b/i,              niche: 'saas', weight: 2 },
  { pattern: /\bcustom (domain|branding)\b/i,  niche: 'saas', weight: 2 },
  { pattern: /\bget started for free\b/i,      niche: 'saas', weight: 2 },
  { pattern: /\bsign up for free\b/i,          niche: 'saas', weight: 2 },
  { pattern: /\btry (it )?for free\b/i,        niche: 'saas', weight: 2 },
  { pattern: /\bstarter plan\b/i,              niche: 'saas', weight: 2 },
  { pattern: /\bpro plan\b/i,                  niche: 'saas', weight: 2 },
  { pattern: /\bgrowth plan\b/i,               niche: 'saas', weight: 2 },
  { pattern: /\bintegrations?\b/i,             niche: 'saas', weight: 1 },
  { pattern: /\bdashboard\b/i,                 niche: 'saas', weight: 1 },
  { pattern: /\banalytics dashboard\b/i,       niche: 'saas', weight: 2 },
  { pattern: /\breal.?time (analytics|data)\b/i, niche: 'saas', weight: 2 },
  { pattern: /\bchurn\b/i,                     niche: 'saas', weight: 2 },
  { pattern: /\bmrr\b/i,                       niche: 'saas', weight: 3 },
  { pattern: /\barr\b/i,                       niche: 'saas', weight: 2 },
  { pattern: /\b(b2b|b2c) (software|platform|solution)\b/i, niche: 'saas', weight: 3 },
  { pattern: /\bplatform for (teams|companies|businesses)\b/i, niche: 'saas', weight: 2 },
  { pattern: /\bcancel anytime\b/i,            niche: 'saas', weight: 2 },
  { pattern: /\btrusted by.*companies\b/i,     niche: 'saas', weight: 2 },
  { pattern: /\btrusted by.*teams\b/i,         niche: 'saas', weight: 2 },
  { pattern: /\bused by.*companies\b/i,        niche: 'saas', weight: 2 },

  // ── DevTools / Developer Tools / Open Source ──────────────────────────────
  { pattern: /\bnpm install\b/i,               niche: 'devtools', weight: 3 },
  { pattern: /\bpip install\b/i,               niche: 'devtools', weight: 3 },
  { pattern: /\bbrew install\b/i,              niche: 'devtools', weight: 3 },
  { pattern: /\byarn add\b/i,                  niche: 'devtools', weight: 3 },
  { pattern: /\bpnpm add\b/i,                  niche: 'devtools', weight: 3 },
  { pattern: /\bcargo add\b/i,                 niche: 'devtools', weight: 3 },
  { pattern: /\bgo get\b/i,                    niche: 'devtools', weight: 3 },
  { pattern: /\bdocker pull\b/i,               niche: 'devtools', weight: 3 },
  { pattern: /\bopen.?source\b/i,              niche: 'devtools', weight: 3 },
  { pattern: /\bstar on github\b/i,            niche: 'devtools', weight: 3 },
  { pattern: /\bgithub\.com\//i,               niche: 'devtools', weight: 2 },
  { pattern: /\bfork on github\b/i,            niche: 'devtools', weight: 3 },
  { pattern: /\bcontribut(e|ing)\b/i,          niche: 'devtools', weight: 1.5 },
  { pattern: /\bpull request\b/i,              niche: 'devtools', weight: 2 },
  { pattern: /\bapi reference\b/i,             niche: 'devtools', weight: 3 },
  { pattern: /\brest api\b/i,                  niche: 'devtools', weight: 2 },
  { pattern: /\bgraphql (api|schema|query)\b/i,niche: 'devtools', weight: 3 },
  { pattern: /\bwebhook\b/i,                   niche: 'devtools', weight: 2 },
  { pattern: /\bcli\b/i,                       niche: 'devtools', weight: 1.5 },
  { pattern: /\bcommand.?line\b/i,             niche: 'devtools', weight: 2 },
  { pattern: /\bsdk\b/i,                       niche: 'devtools', weight: 2 },
  { pattern: /\bdeveloper docs\b/i,            niche: 'devtools', weight: 2 },
  { pattern: /\bquickstart\b/i,                niche: 'devtools', weight: 2 },
  { pattern: /\bgetting started guide\b/i,     niche: 'devtools', weight: 1.5 },
  { pattern: /\bpackage manager\b/i,           niche: 'devtools', weight: 3 },
  { pattern: /\bopen source (library|project|framework|tool)\b/i, niche: 'devtools', weight: 3 },
  { pattern: /\bself.?host(ed)?\b/i,           niche: 'devtools', weight: 2 },
  { pattern: /\bself.?deploy\b/i,              niche: 'devtools', weight: 2 },
  { pattern: /\bkubernetes\b/i,                niche: 'devtools', weight: 2 },
  { pattern: /\bterraform\b/i,                 niche: 'devtools', weight: 3 },
  { pattern: /\bhelm chart\b/i,                niche: 'devtools', weight: 3 },
  { pattern: /\btype(script)?\b/i,             niche: 'devtools', weight: 0.5 },
  { pattern: /\brust\b/i,                      niche: 'devtools', weight: 0.5 },
  { pattern: /\bci\/cd\b/i,                    niche: 'devtools', weight: 2 },
  { pattern: /\bgithub actions?\b/i,           niche: 'devtools', weight: 2 },
  { pattern: /\bchangelog\b/i,                 niche: 'devtools', weight: 1 },
  { pattern: /\brelease notes\b/i,             niche: 'devtools', weight: 1 },
  { pattern: /\bapi (key|token|secret)\b/i,    niche: 'devtools', weight: 2 },
  { pattern: /\brate limit\b/i,                niche: 'devtools', weight: 2 },
  { pattern: /\bendpoint\b/i,                  niche: 'devtools', weight: 1.5 },
  { pattern: /\bserver.?less\b/i,              niche: 'devtools', weight: 1.5 },
  { pattern: /\bedge (function|network|runtime)\b/i, niche: 'devtools', weight: 2 },
  { pattern: /\bmonorepo\b/i,                  niche: 'devtools', weight: 3 },
  { pattern: /\btype.?safe\b/i,                niche: 'devtools', weight: 2 },
  { pattern: /\bzero.?config\b/i,              niche: 'devtools', weight: 2 },
  { pattern: /\bcode (snippet|example|sample)\b/i, niche: 'devtools', weight: 1.5 },
  { pattern: /\bplayground\b/i,                niche: 'devtools', weight: 1.5 },
  { pattern: /\bsandbox (environment)?\b/i,    niche: 'devtools', weight: 1.5 },
  { pattern: /\bstars?\b.*\bgithub\b/i,        niche: 'devtools', weight: 2 },
  { pattern: /\blicense.*mit\b/i,              niche: 'devtools', weight: 3 },
  { pattern: /\blicense.*apache\b/i,           niche: 'devtools', weight: 3 },
  { pattern: /\blicense.*bsd\b/i,              niche: 'devtools', weight: 3 },

  // ── E-commerce — Transactional retail / DTC / marketplace ─────────────────
  { pattern: /\badd to (cart|bag|basket)\b/i,  niche: 'ecommerce', weight: 3 },
  { pattern: /\bproceed to checkout\b/i,       niche: 'ecommerce', weight: 3 },
  { pattern: /\bfree (shipping|delivery)\b/i,  niche: 'ecommerce', weight: 3 },
  { pattern: /\bshopping (cart|bag|basket)\b/i,niche: 'ecommerce', weight: 3 },
  { pattern: /\bin stock\b/i,                  niche: 'ecommerce', weight: 3 },
  { pattern: /\bout of stock\b/i,              niche: 'ecommerce', weight: 3 },
  { pattern: /\bonly \d+ left\b/i,             niche: 'ecommerce', weight: 3 },
  { pattern: /\bwishlist\b/i,                  niche: 'ecommerce', weight: 2 },
  { pattern: /\bsize guide\b/i,                niche: 'ecommerce', weight: 3 },
  { pattern: /\breturn policy\b/i,             niche: 'ecommerce', weight: 2 },
  { pattern: /\brefund policy\b/i,             niche: 'ecommerce', weight: 2 },
  { pattern: /\bexchange policy\b/i,           niche: 'ecommerce', weight: 2 },
  { pattern: /\bbuy now\b/i,                   niche: 'ecommerce', weight: 2 },
  { pattern: /\bshop now\b/i,                  niche: 'ecommerce', weight: 2 },
  { pattern: /\bshop (the )?collection\b/i,    niche: 'ecommerce', weight: 3 },
  { pattern: /\bnew arrivals?\b/i,             niche: 'ecommerce', weight: 3 },
  { pattern: /\bbest sellers?\b/i,             niche: 'ecommerce', weight: 2 },
  { pattern: /\bsale.*%\s*off\b/i,             niche: 'ecommerce', weight: 3 },
  { pattern: /\blimited time offer\b/i,        niche: 'ecommerce', weight: 2 },
  { pattern: /\bflash sale\b/i,                niche: 'ecommerce', weight: 3 },
  { pattern: /\bpromo code\b/i,                niche: 'ecommerce', weight: 3 },
  { pattern: /\bdiscount code\b/i,             niche: 'ecommerce', weight: 3 },
  { pattern: /\buse code\b/i,                  niche: 'ecommerce', weight: 2 },
  { pattern: /\bproduct review\b/i,            niche: 'ecommerce', weight: 2 },
  { pattern: /\bverified (buyer|purchase)\b/i, niche: 'ecommerce', weight: 3 },
  { pattern: /\btrack (your )?(order|package|shipment)\b/i, niche: 'ecommerce', weight: 3 },
  { pattern: /\bsku\b/i,                       niche: 'ecommerce', weight: 3 },
  { pattern: /\bproduct (variant|option)\b/i,  niche: 'ecommerce', weight: 2 },
  { pattern: /\bshipping (to|from|cost|fee)\b/i, niche: 'ecommerce', weight: 2 },
  { pattern: /\bpaypal\b/i,                    niche: 'ecommerce', weight: 1.5 },
  { pattern: /\bklarna\b/i,                    niche: 'ecommerce', weight: 2 },
  { pattern: /\bafterpayor|afterpay\b/i,       niche: 'ecommerce', weight: 2 },
  { pattern: /\bbuy now pay later\b/i,         niche: 'ecommerce', weight: 3 },
  { pattern: /\bsecure checkout\b/i,           niche: 'ecommerce', weight: 2 },
  { pattern: /\bshopify\b/i,                   niche: 'ecommerce', weight: 2 },
  { pattern: /\bwoocommerce\b/i,               niche: 'ecommerce', weight: 2 },
  { pattern: /\bsubscription box\b/i,          niche: 'ecommerce', weight: 3 },
  { pattern: /\bmonthly box\b/i,               niche: 'ecommerce', weight: 2 },

  // ── Community — Non-commercial orgs, clubs, nonprofits ────────────────────
  { pattern: /\bjoin.*chapter\b/i,             niche: 'community', weight: 3 },
  { pattern: /\bour chapter\b/i,               niche: 'community', weight: 3 },
  { pattern: /\bbrotherhood\b/i,               niche: 'community', weight: 3 },
  { pattern: /\bsisterhood\b/i,                niche: 'community', weight: 3 },
  { pattern: /\bfraternity\b/i,                niche: 'community', weight: 3 },
  { pattern: /\bsorority\b/i,                  niche: 'community', weight: 3 },
  { pattern: /\bvolunteer\b/i,                 niche: 'community', weight: 2 },
  { pattern: /\bdonat(e|ion)\b/i,              niche: 'community', weight: 2 },
  { pattern: /\bnonprofit\b/i,                 niche: 'community', weight: 3 },
  { pattern: /\bnon.?profit\b/i,               niche: 'community', weight: 3 },
  { pattern: /\b501\s*\(c\)\b/i,               niche: 'community', weight: 3 },
  { pattern: /\bmembership fee\b/i,            niche: 'community', weight: 2 },
  { pattern: /\balumni\b/i,                    niche: 'community', weight: 2 },
  { pattern: /\brecruitment (season|event|week)\b/i, niche: 'community', weight: 3 },
  { pattern: /\brush (week|event)\b/i,         niche: 'community', weight: 3 },
  { pattern: /\bstudent org(anization)?\b/i,   niche: 'community', weight: 3 },
  { pattern: /\bcommunity service\b/i,         niche: 'community', weight: 2 },
  { pattern: /\bphilanthropy (event|day|week)\b/i, niche: 'community', weight: 3 },
  { pattern: /\bcharity (event|drive|auction)\b/i, niche: 'community', weight: 3 },
  { pattern: /\bfundraiser\b/i,                niche: 'community', weight: 2 },
  { pattern: /\bgrant (funding|recipient|application)\b/i, niche: 'community', weight: 2 },
  { pattern: /\bboard of (directors|trustees)\b/i, niche: 'community', weight: 2 },
  { pattern: /\bchurch\b/i,                    niche: 'community', weight: 2 },
  { pattern: /\bcongregation\b/i,              niche: 'community', weight: 3 },
  { pattern: /\bministry\b/i,                  niche: 'community', weight: 2 },
  { pattern: /\bpastor\b/i,                    niche: 'community', weight: 3 },
  { pattern: /\bcivic (organization|group|club)\b/i, niche: 'community', weight: 3 },
  { pattern: /\brotary (club)?\b/i,            niche: 'community', weight: 3 },
  { pattern: /\blions club\b/i,                niche: 'community', weight: 3 },
  { pattern: /\bhomeowners association\b/i,    niche: 'community', weight: 3 },
  { pattern: /\bhoa\b/i,                       niche: 'community', weight: 2 },
  { pattern: /\bprofessional association\b/i,  niche: 'community', weight: 2 },
  { pattern: /\btrade association\b/i,         niche: 'community', weight: 2 },
  { pattern: /\bclub members?\b/i,             niche: 'community', weight: 1.5 },
  { pattern: /\bgeneral meeting\b/i,           niche: 'community', weight: 2 },
  { pattern: /\btown hall\b/i,                 niche: 'community', weight: 1 },
  { pattern: /\bpetition\b/i,                  niche: 'community', weight: 1.5 },
  { pattern: /\badvocacy\b/i,                  niche: 'community', weight: 1.5 },
  { pattern: /\bmission.driven\b/i,            niche: 'community', weight: 2 },

  // ── Media — Content-first publication, news, podcast, newsletter ──────────
  { pattern: /\bsubscribe to.*newsletter\b/i,  niche: 'media', weight: 3 },
  { pattern: /\bjoin.*newsletter\b/i,          niche: 'media', weight: 2 },
  { pattern: /\blatest articles?\b/i,          niche: 'media', weight: 2 },
  { pattern: /\blatest news\b/i,               niche: 'media', weight: 3 },
  { pattern: /\bbreaking news\b/i,             niche: 'media', weight: 3 },
  { pattern: /\bnews (coverage|analysis|update)\b/i, niche: 'media', weight: 3 },
  { pattern: /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/, niche: 'media', weight: 1 }, // "By John Smith" byline
  { pattern: /\beditor.?in.?chief\b/i,         niche: 'media', weight: 3 },
  { pattern: /\bstaff writer\b/i,              niche: 'media', weight: 3 },
  { pattern: /\bjournalist\b/i,                niche: 'media', weight: 3 },
  { pattern: /\bcontributing writer\b/i,       niche: 'media', weight: 3 },
  { pattern: /\bmagazine\b/i,                  niche: 'media', weight: 2 },
  { pattern: /\beditorial\b/i,                 niche: 'media', weight: 2 },
  { pattern: /\bop.?ed\b/i,                    niche: 'media', weight: 3 },
  { pattern: /\bcolumnist\b/i,                 niche: 'media', weight: 3 },
  { pattern: /\bpodcast (episode|series)\b/i,  niche: 'media', weight: 3 },
  { pattern: /\blisten.*episode\b/i,           niche: 'media', weight: 2 },
  { pattern: /\bspotify.*podcast\b/i,          niche: 'media', weight: 2 },
  { pattern: /\bapple podcasts?\b/i,           niche: 'media', weight: 2 },
  { pattern: /\bvideo (series|essay)\b/i,      niche: 'media', weight: 2 },
  { pattern: /\bwatch (the )?latest\b/i,       niche: 'media', weight: 1.5 },
  { pattern: /\bsubstack\b/i,                  niche: 'media', weight: 2 },
  { pattern: /\bpaid (subscribers?|members?)\b/i, niche: 'media', weight: 2 },
  { pattern: /\bpremium access\b/i,            niche: 'media', weight: 1.5 },
  { pattern: /\barchive\b/i,                   niche: 'media', weight: 1 },
  { pattern: /\bweekly roundup\b/i,            niche: 'media', weight: 2 },
  { pattern: /\bdaily (digest|brief|edition)\b/i, niche: 'media', weight: 2 },
  { pattern: /\breporter\b/i,                  niche: 'media', weight: 2 },
  { pattern: /\bpublication\b/i,               niche: 'media', weight: 1.5 },
  { pattern: /\bissue #\d+\b/i,                niche: 'media', weight: 3 },
  { pattern: /\bmin read\b/i,                  niche: 'media', weight: 2 },
  { pattern: /\breading time\b/i,              niche: 'media', weight: 2 },

  // ── Local Business — Location-based service providers ────────────────────
  { pattern: /\bmake a reservation\b/i,        niche: 'local', weight: 3 },
  { pattern: /\bbook a table\b/i,              niche: 'local', weight: 3 },
  { pattern: /\bbook (an )?appointment\b/i,    niche: 'local', weight: 3 },
  { pattern: /\bschedule (an )?appointment\b/i,niche: 'local', weight: 3 },
  { pattern: /\border (online|for pickup|for delivery)\b/i, niche: 'local', weight: 2 },
  { pattern: /\bcurb.?side pickup\b/i,         niche: 'local', weight: 3 },
  { pattern: /\bour (restaurant|salon|clinic|gym|studio|spa)\b/i, niche: 'local', weight: 3 },
  { pattern: /\bvisit us\b/i,                  niche: 'local', weight: 2 },
  { pattern: /\bget directions\b/i,            niche: 'local', weight: 3 },
  { pattern: /\bhours of operation\b/i,        niche: 'local', weight: 3 },
  { pattern: /\bopen (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, niche: 'local', weight: 3 },
  { pattern: /\bcall us\b/i,                   niche: 'local', weight: 1.5 },
  { pattern: /\bfamily.?owned\b/i,             niche: 'local', weight: 3 },
  { pattern: /\bserving.*since \d{4}\b/i,      niche: 'local', weight: 3 },
  { pattern: /\bour (menu|services|treatments)\b/i, niche: 'local', weight: 2 },
  { pattern: /\bview (our )?menu\b/i,          niche: 'local', weight: 3 },
  { pattern: /\bhappy hour\b/i,                niche: 'local', weight: 3 },
  { pattern: /\bdine.?in\b/i,                  niche: 'local', weight: 3 },
  { pattern: /\btakeout\b/i,                   niche: 'local', weight: 3 },
  { pattern: /\bdelivery (area|zone|fee)\b/i,  niche: 'local', weight: 3 },
  { pattern: /\bopen.*am.*pm\b/i,              niche: 'local', weight: 3 },
  { pattern: /\bmonday.?friday.*am.*pm\b/i,    niche: 'local', weight: 3 },
  { pattern: /\bgoogle maps?\b/i,              niche: 'local', weight: 1 },
  { pattern: /\byelp\b/i,                      niche: 'local', weight: 1.5 },
  { pattern: /\bgoogle reviews?\b/i,           niche: 'local', weight: 1.5 },
  { pattern: /\btrip(advisor)?\b/i,            niche: 'local', weight: 2 },
  { pattern: /\bdentist\b/i,                   niche: 'local', weight: 2 },
  { pattern: /\bchiropractor\b/i,              niche: 'local', weight: 2 },
  { pattern: /\bphysical therapy\b/i,          niche: 'local', weight: 2 },
  { pattern: /\bveterinarian\b/i,              niche: 'local', weight: 2 },
  { pattern: /\blaw (firm|office)\b/i,         niche: 'local', weight: 2 },
  { pattern: /\battorney\b/i,                  niche: 'local', weight: 1.5 },
  { pattern: /\breal estate (agent|office)\b/i,niche: 'local', weight: 2 },
  { pattern: /\bhome (listing|for sale)\b/i,   niche: 'local', weight: 2 },
  { pattern: /\bplumbing\b/i,                  niche: 'local', weight: 2 },
  { pattern: /\belectrician\b/i,               niche: 'local', weight: 2 },
  { pattern: /\bhvac\b/i,                      niche: 'local', weight: 2 },
  { pattern: /\broofing\b/i,                   niche: 'local', weight: 2 },
  { pattern: /\blasik\b/i,                     niche: 'local', weight: 3 },
  { pattern: /\bdaycare\b/i,                   niche: 'local', weight: 2 },
  { pattern: /\bpersonal trainer\b/i,          niche: 'local', weight: 2 },
  { pattern: /\bgroup (class|fitness|yoga|pilates)\b/i, niche: 'local', weight: 2 },

  // ── Education — Schools, universities, online courses / academies ─────────
  { pattern: /\bapply (now|today)\b/i,         niche: 'education', weight: 2 },
  { pattern: /\bapply for admission\b/i,       niche: 'education', weight: 3 },
  { pattern: /\badmissions?\b/i,               niche: 'education', weight: 2 },
  { pattern: /\bfinancial aid\b/i,             niche: 'education', weight: 3 },
  { pattern: /\bscholarship\b/i,               niche: 'education', weight: 3 },
  { pattern: /\btuition\b/i,                   niche: 'education', weight: 3 },
  { pattern: /\bacademic (program|calendar|year)\b/i, niche: 'education', weight: 3 },
  { pattern: /\bdegree program\b/i,            niche: 'education', weight: 3 },
  { pattern: /\bundergraduate\b/i,             niche: 'education', weight: 3 },
  { pattern: /\bgraduate (school|program|student)\b/i, niche: 'education', weight: 3 },
  { pattern: /\bmaster('s)? (degree|program)\b/i, niche: 'education', weight: 3 },
  { pattern: /\bphd\b/i,                       niche: 'education', weight: 3 },
  { pattern: /\bdoctoral program\b/i,          niche: 'education', weight: 3 },
  { pattern: /\bcertificate (program|course)\b/i, niche: 'education', weight: 2 },
  { pattern: /\benroll (now|today)\b/i,        niche: 'education', weight: 2 },
  { pattern: /\bonline (course|class|learning|degree)\b/i, niche: 'education', weight: 2 },
  { pattern: /\bcourse (catalog|curriculum|syllabus)\b/i, niche: 'education', weight: 2 },
  { pattern: /\bcoursework\b/i,                niche: 'education', weight: 2 },
  { pattern: /\binstructor.led\b/i,            niche: 'education', weight: 2 },
  { pattern: /\bcme (credit|hour)\b/i,         niche: 'education', weight: 3 },
  { pattern: /\bcontinuing education\b/i,      niche: 'education', weight: 3 },
  { pattern: /\bprofessional development\b/i,  niche: 'education', weight: 2 },
  { pattern: /\bbootcamp\b/i,                  niche: 'education', weight: 2 },
  { pattern: /\bcoding bootcamp\b/i,           niche: 'education', weight: 2 },
  { pattern: /\blearning management\b/i,       niche: 'education', weight: 2 },
  { pattern: /\blms\b/i,                       niche: 'education', weight: 2 },
  { pattern: /\bstudent (portal|login|record)\b/i, niche: 'education', weight: 3 },
  { pattern: /\bfaculty (member|staff|profile)\b/i, niche: 'education', weight: 3 },
  { pattern: /\bprofessor\b/i,                 niche: 'education', weight: 3 },
  { pattern: /\btenure\b/i,                    niche: 'education', weight: 3 },
  { pattern: /\bcampus\b/i,                    niche: 'education', weight: 2 },
  { pattern: /\bdorm(itory)?\b/i,              niche: 'education', weight: 3 },
  { pattern: /\boffice of.*admissions?\b/i,    niche: 'education', weight: 3 },
  { pattern: /\bsat|act\b/i,                   niche: 'education', weight: 2 },
  { pattern: /\bgpa\b/i,                       niche: 'education', weight: 2 },
  { pattern: /\baccredited\b/i,                niche: 'education', weight: 2 },
  { pattern: /\bk.?12\b/i,                     niche: 'education', weight: 3 },
  { pattern: /\belementary school\b/i,         niche: 'education', weight: 3 },
  { pattern: /\bmiddle school\b/i,             niche: 'education', weight: 3 },
  { pattern: /\bhigh school\b/i,               niche: 'education', weight: 2 },
  { pattern: /\bsummer school\b/i,             niche: 'education', weight: 2 },
  { pattern: /\bafter.?school program\b/i,     niche: 'education', weight: 3 },
  { pattern: /\btest prep\b/i,                 niche: 'education', weight: 2 },
  { pattern: /\btutoring\b/i,                  niche: 'education', weight: 2 },
  { pattern: /\bonline (academy|institute|university)\b/i, niche: 'education', weight: 2 },
];

// Path-based niche hints — URL structure is a reliable, owner-controlled
// signal but weighted lower than text copy. A single blog section on a SaaS
// site should not outweigh all the commercial copy.
const PATH_SIGNALS: ReadonlyArray<{
  pattern: RegExp;
  niche: keyof SiteNicheScores;
  weight: number;
}> = [
  { pattern: /\/api-?reference\//i,    niche: 'devtools',   weight: 2 },
  { pattern: /\/docs?\//i,             niche: 'devtools',   weight: 1 },
  { pattern: /\/changelog\//i,         niche: 'devtools',   weight: 1 },
  { pattern: /\/integrations?\//i,     niche: 'devtools',   weight: 1 },
  { pattern: /\/products?\//i,         niche: 'ecommerce',  weight: 1 },
  { pattern: /\/collections?\//i,      niche: 'ecommerce',  weight: 1.5 },
  { pattern: /\/shop\//i,              niche: 'ecommerce',  weight: 2 },
  { pattern: /\/catalog\//i,           niche: 'ecommerce',  weight: 1.5 },
  { pattern: /\/cart\//i,              niche: 'ecommerce',  weight: 3 },
  { pattern: /\/checkout\//i,          niche: 'ecommerce',  weight: 3 },
  { pattern: /\/blog\//i,              niche: 'media',      weight: 1 },
  { pattern: /\/news\//i,              niche: 'media',      weight: 1 },
  { pattern: /\/articles?\//i,         niche: 'media',      weight: 1 },
  { pattern: /\/episodes?\//i,         niche: 'media',      weight: 1.5 },
  { pattern: /\/issues?\//i,           niche: 'media',      weight: 1 },
  { pattern: /\/events?\//i,           niche: 'community',  weight: 0.5 },
  { pattern: /\/chapters?\//i,         niche: 'community',  weight: 2 },
  { pattern: /\/members?\//i,          niche: 'community',  weight: 1 },
  { pattern: /\/volunteer\//i,         niche: 'community',  weight: 2 },
  { pattern: /\/give\//i,              niche: 'community',  weight: 1 },
  { pattern: /\/donate\//i,            niche: 'community',  weight: 2 },
  { pattern: /\/pricing\/?$/i,         niche: 'saas',       weight: 1.5 },
  { pattern: /\/enterprise\/?$/i,      niche: 'saas',       weight: 1.5 },
  { pattern: /\/for-teams\/?/i,        niche: 'saas',       weight: 1.5 },
  { pattern: /\/admissions?\//i,       niche: 'education',  weight: 2 },
  { pattern: /\/academics?\//i,        niche: 'education',  weight: 2 },
  { pattern: /\/courses?\//i,          niche: 'education',  weight: 1.5 },
  { pattern: /\/curriculum\//i,        niche: 'education',  weight: 2 },
  { pattern: /\/programs?\//i,         niche: 'education',  weight: 1 },
  { pattern: /\/menu\/?$/i,            niche: 'local',      weight: 2 },
  { pattern: /\/reservations?\//i,     niche: 'local',      weight: 2 },
  { pattern: /\/locations?\//i,        niche: 'local',      weight: 1 },
  { pattern: /\/appointments?\//i,     niche: 'local',      weight: 2 },
];

// Domain TLD / hostname pattern hints. Applied once from any snapshot's URL.
const DOMAIN_SIGNALS: ReadonlyArray<{
  pattern: RegExp;
  niche: keyof SiteNicheScores;
  weight: number;
}> = [
  { pattern: /\.edu(\/|$)/i,           niche: 'education', weight: 3 },
  { pattern: /\.k12\.[a-z]+\.us\b/i,   niche: 'education', weight: 3 },
  { pattern: /\.ac\.[a-z]+\b/i,        niche: 'education', weight: 2 },
  { pattern: /\.org(\/|$)/i,           niche: 'community', weight: 1 },
  { pattern: /\.gov(\/|$)/i,           niche: 'community', weight: 2 },
  { pattern: /\.ngo(\/|$)/i,           niche: 'community', weight: 3 },
  { pattern: /\.io(\/|$)/i,            niche: 'devtools',  weight: 0.5 },
  { pattern: /\.dev(\/|$)/i,           niche: 'devtools',  weight: 0.5 },
  { pattern: /\.app(\/|$)/i,           niche: 'saas',      weight: 0.5 },
  { pattern: /\.shop(\/|$)/i,          niche: 'ecommerce', weight: 1.5 },
  { pattern: /\.store(\/|$)/i,         niche: 'ecommerce', weight: 1.5 },
  { pattern: /\.news(\/|$)/i,          niche: 'media',     weight: 1.5 },
  { pattern: /\.press(\/|$)/i,         niche: 'media',     weight: 1.5 },
];

// Minimum score margin (winner ÷ runner-up) before committing to a label.
const CONFIDENCE_MARGIN = 2.0;

// Minimum absolute score the winner must achieve. Prevents weak signal noise
// (e.g. a single "donate" link in a footer) from misclassifying the site.
const MIN_ABSOLUTE_SCORE = 4.0;

function scoreText(text: string, scores: SiteNicheScores): void {
  for (const { pattern, niche, weight } of SIGNAL_TABLE) {
    if (pattern.test(text)) {
      scores[niche] += weight;
    }
  }
}

function zeroScores(): SiteNicheScores {
  return { saas: 0, devtools: 0, ecommerce: 0, community: 0, media: 0, local: 0, education: 0 };
}

/**
 * Classify the site represented by the given snapshots into a `SiteNiche`.
 *
 * Returns `'unknown'` when the evidence is ambiguous or below the minimum
 * score threshold — this is the safe default. Rules must treat `'unknown'`
 * the same as absent: apply base thresholds with no modulation.
 */
export function classifySiteFromSnapshots(snapshots: PageSnapshot[]): SiteNiche {
  if (snapshots.length === 0) return 'unknown';

  const scores = zeroScores();

  // Apply domain-level signals once from the first snapshot's URL.
  const sampleUrl = snapshots[0].url;
  for (const { pattern, niche, weight } of DOMAIN_SIGNALS) {
    if (pattern.test(sampleUrl)) {
      scores[niche] += weight;
    }
  }

  for (const snapshot of snapshots) {
    // Path-level signals
    for (const { pattern, niche, weight } of PATH_SIGNALS) {
      if (pattern.test(snapshot.pathRef)) {
        scores[niche] += weight;
      }
    }

    // Text extraction — title, meta description, headings, CTA labels.
    // Deliberately excludes body text (not stored on snapshot) — the fields
    // above are the highest signal:noise sources in the parsed snapshot.
    const texts: string[] = [];
    if (snapshot.data.meta.title) texts.push(snapshot.data.meta.title);
    if (snapshot.data.meta.description) texts.push(snapshot.data.meta.description);
    if (snapshot.data.meta.ogDescription) texts.push(snapshot.data.meta.ogDescription);
    if (snapshot.data.meta.ogTitle) texts.push(snapshot.data.meta.ogTitle);
    for (const h of snapshot.data.headings) texts.push(h.text);
    for (const c of snapshot.data.ctas) texts.push(c.text);

    const blob = texts.join(' ');
    scoreText(blob, scores);
  }

  // Pick winner
  const entries = Object.entries(scores) as Array<[keyof SiteNicheScores, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  const [winner, runnerUp] = entries;

  const winnerScore = winner[1];
  const runnerUpScore = runnerUp?.[1] ?? 0;

  if (winnerScore < MIN_ABSOLUTE_SCORE) return 'unknown';
  if (runnerUpScore > 0 && winnerScore / runnerUpScore < CONFIDENCE_MARGIN) return 'unknown';

  return winner[0] as SiteNiche;
}

/**
 * Whether a site niche is non-commercial in nature. Used by rules to skip
 * commercial-conversion prescriptions that would be irrelevant or tone-deaf
 * on community / nonprofit / student-org sites.
 */
export function isNonCommercialNiche(niche: SiteNiche): boolean {
  return niche === 'community' || niche === 'education';
}
