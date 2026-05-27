import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Auth — users, magic-link tokens, sessions (Clerk-free invite-only auth)
// ---------------------------------------------------------------------------

export const appUsers = pgTable(
  'app_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    organizationId: text('organization_id').notNull(),
    role: text('role').notNull().default('member'), // 'member' | 'admin'
    status: text('status').notNull().default('approved'), // 'approved' | 'revoked'
    /** scrypt password hash (set post-approval via the set-password link). NULL until set. */
    passwordHash: text('password_hash'),
    /** 'password' | 'google' — which credential the row last authenticated with. */
    authProvider: text('auth_provider'),
    /** Stable Google OIDC `sub`. Unique — a Google login resolves to one user. */
    googleSub: text('google_sub'),
    source: text('source'), // origin tag: 'public_audit' for auto-provisioned audit users; NULL for pre-existing users.
    sourceAuditId: text('source_audit_id'),
    /** Auto-detected from first audit URL (e.g. 'saas', 'ecommerce', 'media', 'fintech'). */
    industry: text('industry'),
    /** PM / founder / engineer / designer etc. — free-form, set during onboarding. */
    roleTitle: text('role_title'),
    /** ISO timestamp of the last time this user triggered a public audit. */
    lastAuditAt: timestamp('last_audit_at', { withTimezone: true }),
    // Acquisition tracking lives on `app_users.source` (added by the
    // audit-funnel migration). Do not add signup_source here — it overlaps.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('app_users_email_idx').on(table.email),
    orgIdx: index('app_users_org_idx').on(table.organizationId),
    sourceAuditIdx: index('app_users_source_audit_idx').on(table.sourceAuditId),
    googleSubIdx: uniqueIndex('app_users_google_sub_idx').on(table.googleSub),
  })
);

/**
 * The single pending-lead queue. Every front-door action — the "Request
 * access" form (`source='request_form'`) and the free public audit
 * (`source='public_audit'`) — upserts a row here with status='pending'.
 *
 * Approval is a deliberate human act in /admin: it mints an organizations +
 * app_users row and flips the request to 'invited'. Pending leads live HERE,
 * not in app_users, so /app auth logic stays simple (a session always maps to
 * an approved user that already has an org).
 *
 * `email` is uniquely indexed — re-requesting upserts the existing row instead
 * of piling up duplicates.
 */
export const accessRequests = pgTable(
  'access_requests',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    domain: text('domain'),
    roleTitle: text('role_title'),
    analyticsTool: text('analytics_tool'),
    /** 'request_form' | 'public_audit' */
    source: text('source').notNull(),
    /** 'pending' | 'invited' | 'rejected' */
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    stripePaymentLink: text('stripe_payment_link'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
  },
  (table) => ({
    emailIdx: uniqueIndex('access_requests_email_idx').on(table.email),
    statusIdx: index('access_requests_status_idx').on(table.status),
  })
);

/**
 * Queryable log of which audit rules have fired for a user.
 * Written whenever the insights pipeline surfaces a finding for an org
 * that has an associated user (post-signup). Used for personalization,
 * onboarding analytics, and "rules found on your site" UI.
 */
export const appUserRulesFired = pgTable(
  'app_user_rules_fired',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    siteId: text('site_id').notNull(),
    findingId: text('finding_id'),
    ruleId: text('rule_id').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('app_user_rules_fired_user_idx').on(table.userId),
    ruleIdx: index('app_user_rules_fired_rule_idx').on(table.ruleId),
    orgIdx: index('app_user_rules_fired_org_idx').on(table.orgId),
    siteIdx: index('app_user_rules_fired_site_idx').on(table.siteId),
  })
);

export const authMagicLinks = pgTable(
  'auth_magic_links',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('auth_magic_links_token_hash_idx').on(table.tokenHash),
    emailIdx: index('auth_magic_links_email_idx').on(table.email),
  })
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('auth_sessions_token_hash_idx').on(table.tokenHash),
    userIdx: index('auth_sessions_user_idx').on(table.userId),
  })
);

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
  })
);

// Zybit-148: per-org daily call counter for the AI Variant Advisor.
// `day_utc` is YYYY-MM-DD (UTC). One row per org per day. Denied calls
// do not increment — see `aiAdvisorRateLimit.ts`.
export const phase2AiAdvisorUsage = pgTable(
  'phase2_ai_advisor_usage',
  {
    organizationId: text('organization_id').notNull(),
    dayUtc: text('day_utc').notNull(),
    callCount: integer('call_count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.dayUtc] }),
  })
);

// ---------------------------------------------------------------------------
// Phase 1 (capture): headless page captures + blob assets + run tracking
// ---------------------------------------------------------------------------

export const phase2PageCaptures = pgTable(
  'phase2_page_captures',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id'),
    pathRef: text('path_ref').notNull(),
    finalUrl: text('final_url').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    breakpoint: text('breakpoint').notNull(),
    cohort: text('cohort').notNull().default('logged_out'),
    contentHash: text('content_hash').notNull(),
    captureData: jsonb('capture_data').$type<Record<string, unknown>>().notNull(),
    costUsd: decimal('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_page_captures_org_idx').on(table.organizationId),
    siteIdx: index('phase2_page_captures_site_idx').on(table.siteId),
    siteCapturedIdx: index('phase2_page_captures_site_captured_idx').on(
      table.siteId,
      table.capturedAt,
    ),
    sitePathBpIdx: index('phase2_page_captures_site_path_bp_idx').on(
      table.siteId,
      table.pathRef,
      table.breakpoint,
    ),
    runIdx: index('phase2_page_captures_run_idx').on(table.runId),
  }),
);

export const phase2CaptureAssets = pgTable(
  'phase2_capture_assets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    captureId: text('capture_id').notNull(),
    assetType: text('asset_type').notNull(), // 'screenshot' | 'har'
    blobUrl: text('blob_url').notNull(),
    breakpoint: text('breakpoint'),
    byteSize: integer('byte_size'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    captureIdx: index('phase2_capture_assets_capture_idx').on(table.captureId),
    siteIdx: index('phase2_capture_assets_site_idx').on(table.siteId),
  }),
);

export const phase2CaptureRuns = pgTable(
  'phase2_capture_runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    status: text('status').notNull().default('pending'), // 'pending'|'running'|'completed'|'failed'
    totalPaths: integer('total_paths').notNull().default(0),
    completedPaths: integer('completed_paths').notNull().default(0),
    failedPaths: integer('failed_paths').notNull().default(0),
    totalCostUsd: decimal('total_cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    siteIdx: index('phase2_capture_runs_site_idx').on(table.siteId),
    orgIdx: index('phase2_capture_runs_org_idx').on(table.organizationId),
  }),
);

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('starter'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  planUpdatedAt: timestamp('plan_updated_at', { withTimezone: true }),
  // Set the first time an unpaid org launches its single free experiment
  // (free-experiment loop, docs/sprints/free-experiment-loop.md §6). Stays
  // null for orgs that never used the free on-ramp, so the gate is inert for
  // every existing org until the free flow claims it. Lifetime, not per-period.
  freeExperimentUsedAt: timestamp('free_experiment_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const zybitUsage = pgTable(
  'zybit_usage',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    period: text('period').notNull(),
    eventsIngested: integer('events_ingested').notNull().default(0),
    snapshotsTaken: integer('snapshots_taken').notNull().default(0),
    insightsRuns: integer('insights_runs').notNull().default(0),
  },
  (table) => ({
    orgPeriodIdx: uniqueIndex('zybit_usage_org_period_idx').on(
      table.organizationId,
      table.period
    ),
  })
);

export const phase1Sites = pgTable(
  'phase1_sites',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    analyticsProvider: text('analytics_provider'),
    proxySlug: text('proxy_slug'),
    /** Customer-side subdomain they CNAME at <proxy_slug>.zybit.run, e.g. "experiments.acme.com". */
    customerSubdomain: text('customer_subdomain'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase1_sites_org_idx').on(table.organizationId),
    proxySlugIdx: uniqueIndex('phase1_sites_proxy_slug_idx').on(table.proxySlug),
  })
);

export const phase1Events = pgTable(
  'phase1_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull(),
    path: text('path').notNull(),
    metrics: jsonb('metrics').$type<Record<string, number> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Phase 2 canonical-event extensions (nullable for backward compatibility).
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    source: text('source'),
    sourceEventId: text('source_event_id'),
    anonymousId: text('anonymous_id'),
    properties: jsonb('properties').$type<Record<
      string,
      string | number | boolean | null
    > | null>(),
    schemaVersion: integer('schema_version'),
  },
  (table) => ({
    orgIdx: index('phase1_events_org_idx').on(table.organizationId),
    siteIdx: index('phase1_events_site_idx').on(table.siteId),
    occurredAtIdx: index('phase1_events_occurred_at_idx').on(table.occurredAt),
    siteOccurredIdx: index('phase1_events_site_occurred_idx').on(
      table.siteId,
      table.occurredAt
    ),
    dedupeIdx: uniqueIndex('phase1_events_dedupe_idx').on(
      table.siteId,
      table.source,
      table.sourceEventId
    ),
  })
);

export const phase2SiteConfigs = pgTable(
  'phase2_site_configs',
  {
    siteId: text('site_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    cohortDimensions: jsonb('cohort_dimensions').$type<unknown>().notNull(),
    onboardingSteps: jsonb('onboarding_steps').$type<unknown>().notNull(),
    ctas: jsonb('ctas').$type<unknown>().notNull(),
    narratives: jsonb('narratives').$type<unknown>().notNull(),
    conversionEventTypes: jsonb('conversion_event_types').$type<string[] | null>(),
    /** Per-site daily capture budget in USD. Default $1.00/day. */
    captureBudgetUsdDay: decimal('capture_budget_usd_day', { precision: 12, scale: 4 }).notNull().default('1.0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_site_configs_org_idx').on(table.organizationId),
  })
);

export const phase2Integrations = pgTable(
  'phase2_integrations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    /** Provider-specific config (e.g. PostHog host + projectId). Never holds secrets. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Env-var name where the secret API key lives (never the secret value itself). */
    secretRef: text('secret_ref'),
    cursor: jsonb('cursor').$type<Record<string, unknown> | null>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_integrations_org_idx').on(table.organizationId),
    siteIdx: index('phase2_integrations_site_idx').on(table.siteId),
    siteProviderIdx: uniqueIndex('phase2_integrations_site_provider_idx').on(
      table.siteId,
      table.provider
    ),
  })
);

export const phase2PageSnapshots = pgTable(
  'phase2_page_snapshots',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    /** Canonical path key (no query, no trailing slash) — `/`, `/pricing`, etc. */
    pathRef: text('path_ref').notNull(),
    /** Fully-qualified URL we fetched (final URL after redirects). */
    url: text('url').notNull(),
    /** Parsed snapshot payload (PageSnapshotData). */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    /** sha256 hex of the normalized HTML — drift detector across re-fetches. */
    contentHash: text('content_hash').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_page_snapshots_org_idx').on(table.organizationId),
    siteIdx: index('phase2_page_snapshots_site_idx').on(table.siteId),
    sitePathIdx: uniqueIndex('phase2_page_snapshots_site_path_idx').on(
      table.siteId,
      table.pathRef
    ),
  })
);

/**
 * Full-fidelity design capture per (site, path). One row per pathRef.
 *
 * `captureMethod = 'full'` → Browserless captured a screenshot + computed
 * styles; `screenshotUrl` + `computedStyles` populated.
 * `captureMethod = 'structural'` → degraded mode (Browserless/Blob
 * unavailable). Token extraction still possible from structural parse.
 *
 * Read by the AI Variant Advisor (Zybit-144) and element picker (Zybit-146).
 */
export const phase2SiteDesignSnapshot = pgTable(
  'phase2_site_design_snapshot',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    pathRef: text('path_ref').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    /** 'full' | 'structural' */
    captureMethod: text('capture_method').notNull(),
    /** Vercel Blob URL — null in structural mode. */
    screenshotUrl: text('screenshot_url'),
    /** Per-element computed styles keyed by data-zybit-ref. */
    computedStyles: jsonb('computed_styles').$type<Record<
      string,
      {
        color?: string;
        backgroundColor?: string;
        fontSize?: string;
        fontWeight?: string;
        fontFamily?: string;
        padding?: string;
        margin?: string;
        borderRadius?: string;
        boxShadow?: string;
        boundingBox?: { x: number; y: number; width: number; height: number };
      }
    > | null>(),
    /** Extracted design tokens (primaryColor, fontFamily, typeScale, etc). */
    designTokens: jsonb('design_tokens').$type<{
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      fontFamily?: string;
      typeScale?: number[];
      borderRadius?: string;
      spacingUnit?: number;
      ctaVocabulary?: string[];
    } | null>(),
    /** Passed through from the structural parser. */
    cssSystem: text('css_system'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_site_design_snapshot_org_idx').on(table.organizationId),
    siteIdx: index('phase2_site_design_snapshot_site_idx').on(table.siteId),
    sitePathIdx: uniqueIndex('phase2_site_design_snapshot_site_path_idx').on(
      table.siteId,
      table.pathRef,
    ),
  }),
);

/**
 * Persisted flow-graph advisory (PRD Milestone 1). One row per site holding
 * the derived route-transition graph — nodes are normalized routes, edges are
 * observed session transitions with per-edge drop-off. Upserted by the
 * insights pipeline; read by `/app/flow`. The graph is a deterministic
 * derivation of canonical events, so this table is a render cache, not a
 * source of truth.
 */
export const phase2FlowGraph = pgTable(
  'phase2_flow_graph',
  {
    siteId: text('site_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    sessionCount: integer('session_count').notNull().default(0),
    /** Serialized FlowGraph (nodes + edges). */
    graph: jsonb('graph').$type<Record<string, unknown>>().notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('phase2_flow_graph_org_idx').on(table.organizationId),
  }),
);

export const zybitApiKeys = pgTable(
  'forge_api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    hashIdx: uniqueIndex('forge_api_keys_hash_idx').on(table.keyHash),
    orgIdx: index('forge_api_keys_org_idx').on(table.organizationId),
  })
);

// ---------------------------------------------------------------------------
// Forge Dashboard — Findings & Experiments (FORGE-065/066/067/068/069)
// ---------------------------------------------------------------------------

/**
 * Persisted audit findings. Upserted on every insight sync run so status
 * (open → approved → shipped → measured) survives across runs without losing
 * operator decisions (preview URL, dismissal, linked experiment).
 *
 * Deduplication key: (siteId, ruleId, pathRef) — one finding per rule×path.
 * pathRef is null for site-wide findings; the unique index uses a sentinel.
 */
export const zybitFindings = pgTable(
  'forge_findings',
  {
    id: text('id').primaryKey(), // deterministic: sha-ish of siteId+ruleId+pathRef
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    // AuditFinding fields
    ruleId: text('rule_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(), // 'info' | 'warn' | 'critical'
    confidence: real('confidence').notNull(), // 0..1
    priorityScore: real('priority_score').notNull(), // 0..1
    pathRef: text('path_ref'), // null = site-wide
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    recommendation: jsonb('recommendation').$type<string[]>().notNull(),
    evidence: jsonb('evidence').$type<Array<{ label: string; value: string | number; context?: string }>>().notNull(),
    prescription: jsonb('prescription').$type<{ whyItMatters?: string; whatToChange: string; whyItWorks: string; experimentVariantDescription: string } | null>(),
    impactEstimate: jsonb('impact_estimate').$type<{ value: number; unit: string; period: 'monthly'; formatted: string; basis: string } | null>(),
    snapshotDiagram: jsonb('snapshot_diagram').$type<Record<string, unknown> | null>(),
    refs: jsonb('refs').$type<Record<string, string | undefined> | null>(),
    experimentBrief: jsonb('experiment_brief').$type<{
      experimentName: string;
      selector: string;
      changeType: 'copy' | 'style' | 'hide' | 'insert';
      newValue: string;
      variantDescription: string;
      primaryMetric: string;
      hypothesis: string | null;
      /** For changeType === 'insert': where to splice the new markup relative
       * to the anchor element. Null/undefined for the other change types. */
      insertPosition?: 'before' | 'after' | 'prepend' | 'append' | null;
      createdAt: string;
    } | null>(),
    learnAdjustment: jsonb('learn_adjustment').$type<{
      delta: number;
      tier: 1 | 2 | 3 | 4;
      direction: 'boost' | 'dampen';
      reason: string;
      basedOnOutcomeIds: string[];
      visible: boolean;
      /** Layer 2 calibration receipt — present when the rule's threshold was tuned. */
      calibration?: {
        direction: 'loosen' | 'tighten';
        multiplier: number;
        reason: string;
        conclusiveCount: number;
      };
    } | null>(),
    // Lifecycle
    status: text('status').notNull().default('open'), // 'open'|'approved'|'dismissed'|'shipped'|'measured'
    previewUrl: text('preview_url'),
    previewType: text('preview_type'), // 'staging'|'deployment'|'image'|'mock'
    previewNotes: text('preview_notes'),
    // Annotated screenshot of the finding's page (Vercel Blob URL).
    // Populated lazily by `renderFindingScreenshot` on first preview view.
    screenshotUrl: text('screenshot_url'),
    screenshotCapturedAt: timestamp('screenshot_captured_at', { withTimezone: true }),
    // Before/after fix-preview pair (Vercel Blob URLs). Written by
    // `generateFixPreviews` during the public-audit run. `fixPreviewTier`:
    // 1 = deterministic mutation render, 2 = vision inpaint, 3 = annotated
    // before only (in which case the new URL columns stay null and the UI
    // falls back to `screenshotUrl`). `fixModifications` carries the
    // VariantModification[] from tier 1 so the in-product dashboard can
    // replay the fix as an experiment.
    screenshotBeforeUrl: text('screenshot_before_url'),
    screenshotAfterUrl: text('screenshot_after_url'),
    fixPreviewTier: smallint('fix_preview_tier'),
    fixRationale: text('fix_rationale'),
    fixModifications: jsonb('fix_modifications').$type<unknown | null>(),
    fixPreviewGeneratedAt: timestamp('fix_preview_generated_at', { withTimezone: true }),
    // Discriminator for the prose path that wrote summary/recommendation/
    // prescription. 'template' = rule's deterministic templating function;
    // 'llm-v1' = Layer B Gemini call. See drizzle/0024.
    proseSource: text('prose_source').notNull().default('template').$type<'template' | 'llm-v1'>(),
    // Run context (most recent sync that emitted this finding)
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    insightWindowStart: timestamp('insight_window_start', { withTimezone: true }),
    insightWindowEnd: timestamp('insight_window_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('forge_findings_org_idx').on(table.organizationId),
    siteIdx: index('forge_findings_site_idx').on(table.siteId),
    siteStatusIdx: index('forge_findings_site_status_idx').on(table.siteId, table.status),
    sitePriorityIdx: index('forge_findings_site_priority_idx').on(table.siteId, table.priorityScore),
  })
);

/**
 * Experiment / rollout entity. Created when an operator approves a finding
 * and defines how production impact will be measured.
 */
export const zybitExperiments = pgTable(
  'forge_experiments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    findingId: text('finding_id'), // FK → forge_findings.id (nullable: standalone experiments)
    hypothesis: text('hypothesis').notNull(),
    primaryMetric: text('primary_metric').notNull(), // event name
    primaryMetricSource: text('primary_metric_source'), // 'posthog'|'segment'|'custom'
    audienceControlPct: integer('audience_control_pct').notNull().default(50),
    audienceVariantPct: integer('audience_variant_pct').notNull().default(50),
    durationDays: integer('duration_days').notNull().default(14),
    status: text('status').notNull().default('draft'), // 'draft'|'running'|'completed'|'stopped'
    // Preview-only experiments (free-experiment loop, docs/sprints/free-experiment-loop.md §5)
    // are projected, never served to real visitors. The proxy config query
    // excludes preview_only rows so a preview can never reach production traffic,
    // while the cockpit + loop timeline still render it as a "Projected" entry.
    previewOnly: boolean('preview_only').notNull().default(false),
    externalUrl: text('external_url'), // link to PostHog / LaunchDarkly etc
    externalProvider: text('external_provider'), // 'posthog'|'custom'
    externalId: text('external_id'),
    modifications: jsonb('modifications').$type<import('@/lib/experiments/types').VariantModification[]>(),
    targetPath: text('target_path'),
    guardrails: jsonb('guardrails').$type<string[]>(),
    notes: text('notes'),
    overlappingExperimentIds: jsonb('overlapping_experiment_ids').$type<string[]>(),
    // Results snapshot (optional — updated manually or via future webhook)
    resultControlRate: real('result_control_rate'),   // 0..1 conversion rate
    resultVariantRate: real('result_variant_rate'),   // 0..1 conversion rate
    resultConfidence: real('result_confidence'),      // 0..1 statistical confidence
    resultParticipants: integer('result_participants'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('forge_experiments_org_idx').on(table.organizationId),
    siteIdx: index('forge_experiments_site_idx').on(table.siteId),
    findingIdx: index('forge_experiments_finding_idx').on(table.findingId),
    siteStatusIdx: index('forge_experiments_site_status_idx').on(table.siteId, table.status),
  })
);

/**
 * Per-site operational metadata for data-volume-triggered insight runs.
 * Updated by the PostHog sync cron after each sync.
 */
export const zybitSiteMeta = pgTable('forge_site_meta', {
  siteId: text('site_id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  /** Total session count the last time insights ran for this site. */
  sessionCountAtLastRun: integer('session_count_at_last_run').notNull().default(0),
  /** Minimum new sessions required to trigger a fresh insights run. */
  insightThreshold: integer('insight_threshold').notNull().default(100),
  lastInsightRunAt: timestamp('last_insight_run_at', { withTimezone: true }),
  /**
   * Monthly recurring revenue in cents (USD). Used to compute estimated revenue
   * at risk per finding: revenueAtRisk = (monthlyRevenueCents / 100) × priorityScore × confidence.
   * Optional — findings display without it, but impact framing is suppressed.
   */
  monthlyRevenueCents: integer('monthly_revenue_cents'),
  /** Average order / conversion value in cents. Refines per-finding impact estimates. */
  avgOrderValueCents: integer('avg_order_value_cents'),
  /** Accumulated capture spend today (UTC). Reset when captureSpendDayDate changes. */
  captureSpendDayUsd: decimal('capture_spend_day_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  /** ISO date string (YYYY-MM-DD UTC) for the current spend window. */
  captureSpendDayDate: text('capture_spend_day_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per concluded experiment — the outcome-labeled dataset that powers
 * per-site rule calibration and (eventually) cross-site priors.
 *
 * Written by the compute-outcomes cron when an experiment transitions to
 * 'completed' or 'stopped'. Never mutated after insert.
 */
export const zybitExperimentOutcomes = pgTable(
  'zybit_experiment_outcomes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    findingId: text('finding_id'),
    ruleId: text('rule_id'),
    pathRef: text('path_ref'),
    modificationType: text('modification_type'),
    // 'positive' | 'negative' | 'inconclusive'
    result: text('result').notNull(),
    liftPct: real('lift_pct'),
    confidence: real('confidence'),
    controlConversions: integer('control_conversions'),
    controlParticipants: integer('control_participants'),
    variantConversions: integer('variant_conversions'),
    variantParticipants: integer('variant_participants'),
    // null = no breach; metric name = the guardrail event type that tripped
    guardrailBreached: text('guardrail_breached'),
    concludedAt: timestamp('concluded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    experimentIdx: index('zybit_outcomes_experiment_idx').on(table.experimentId),
    siteIdx: index('zybit_outcomes_site_idx').on(table.siteId),
    orgIdx: index('zybit_outcomes_org_idx').on(table.organizationId),
  })
);

// ---------------------------------------------------------------------------
// Public URL-audit lead magnet (Phase B)
// ---------------------------------------------------------------------------

export const publicAudits = pgTable(
  'public_audits',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    domain: text('domain').notNull(),
    url: text('url').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'), // 'pending'|'running'|'done'|'failed'
    ip: text('ip').notNull(),
    teaserFinding: jsonb('teaser_finding').$type<Record<string, unknown> | null>(),
    findings: jsonb('findings').$type<unknown[] | null>(),
    pagesScanned: integer('pages_scanned'),
    totalFindings: integer('total_findings'),
    costUsd: decimal('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    error: text('error'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    emailIdx: index('public_audits_email_idx').on(table.email),
    domainIdx: index('public_audits_domain_idx').on(table.domain),
    statusIdx: index('public_audits_status_idx').on(table.status),
  }),
);

export const auditTokens = pgTable(
  'audit_tokens',
  {
    id: text('id').primaryKey(),
    auditId: text('audit_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    hashIdx: uniqueIndex('audit_tokens_hash_idx').on(table.tokenHash),
    auditIdx: index('audit_tokens_audit_idx').on(table.auditId),
  }),
);

export const publicAuditBudget = pgTable('public_audit_budget', {
  dayUtc: text('day_utc').primaryKey(),
  costUsd: decimal('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
});

export const publicAuditRateLimits = pgTable(
  'public_audit_rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
  }),
);

export const phase1ReadinessSnapshots = pgTable(
  'phase1_readiness_snapshots',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    siteId: text('site_id').notNull(),
    score: integer('score').notNull(),
    status: text('status').notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull(),
    eventCount: integer('event_count').notNull(),
    sessionCount: integer('session_count').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    orgIdx: index('phase1_readiness_snapshots_org_idx').on(table.organizationId),
    siteIdx: index('phase1_readiness_snapshots_site_idx').on(table.siteId),
  })
);
