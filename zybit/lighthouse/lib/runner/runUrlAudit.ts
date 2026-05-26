/**
 * URL-audit runner — points the Zybit audit at an arbitrary live site.
 *
 *   crawl pages (Firecrawl /map)
 *      → snapshot each page with Zybit's own fetch+parse pipeline
 *      → emit a snapshot-grounded synthetic event layer
 *      → run Zybit's Phase 2 insights pipeline
 *      → return findings + a parsed-structure inspector
 *
 * This is the counterpart to `runScenario`: where that drives hand-authored
 * fake sites with persona simulations, this drives a real URL. The findings
 * it produces are NOT ground truth (the event layer is engineered) — they
 * verify the rule machinery + finding formatting against real page structure.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase1Events, phase2PageSnapshots, zybitFindings } from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import { upsertFindings } from '@/lib/phase2/jobs/insightsTrigger';
import { runPhase2InsightsPipeline } from '@/lib/phase2/runInsightsPipeline';
import type { AuditFinding, AuditMode } from '@/lib/phase2/rules/types';
import { applyDefenseInDepthScrub } from '@/lib/audit/publicAuditScrub';
import { runSnapshot, SnapshotError } from '@/lib/phase2/snapshots';
import { capturePageAllBreakpoints } from '@/lib/phase2/capture/record';
import { buildFullDesignSnapshot } from '@/lib/phase2/snapshots/designCapture';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import { mapSite } from '../crawl/firecrawl';
import { generateGroundedEvents, type GroundedPage } from '../generators/groundedEvents';
import { provisionLighthouseSite } from '../seeder/orgSite';
import { DirectEventSink } from '../sinks/direct';
import type { GenerateProgressEvent, GenerateResult } from '../types';

export interface RunUrlAuditOpts {
  url: string;
  /** Max pages to snapshot (after crawl + dedupe). */
  maxPages: number;
  onProgress?: (event: GenerateProgressEvent) => void;
  /**
   * Pipeline mode. `'public-audit'` makes the insights pipeline fail-closed
   * on undeclared rules and applies each rule's `structuralPublicAuditCopy`
   * in-place so persisted findings already carry the prospect-safe framing.
   * The route handler no longer needs a post-hoc DELETE/UPDATE scrub.
   * Defaults to `'in-app'` so the lighthouse scenario driver and any
   * operator-triggered runs see full rule output.
   */
  mode?: AuditMode;
}

function now(): string {
  return new Date().toISOString();
}

function progress(
  cb: ((e: GenerateProgressEvent) => void) | undefined,
  step: GenerateProgressEvent['step'],
  message: string,
): void {
  cb?.({ step, message, at: now() });
}

function sanitize(value: string): string {
  return (
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site'
  );
}

export async function runUrlAudit(opts: RunUrlAuditOpts): Promise<GenerateResult> {
  const startedAt = now();
  const runId = `lh_run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const { url, maxPages, onProgress, mode } = opts;

  // 1) Crawl — discover the site's pages.
  progress(onProgress, 'crawl', `discovering pages on ${url}`);
  const map = await mapSite(url, maxPages);
  progress(
    onProgress,
    'crawl',
    `discovered ${map.discovered} page(s) — auditing ${map.pages.length}`,
  );

  const host = new URL(url).host.replace(/^www\./, '');
  const slug = `urlaudit-${sanitize(host)}`;

  // 2) Provision a synthetic lighthouse_* org/site for the findings to hang off.
  progress(onProgress, 'provisioning', 'creating lighthouse_* org/site/config');
  const { organizationId, siteId } = await provisionLighthouseSite({
    slug,
    displayName: host,
    domain: host,
  });

  // 3) Reset prior data for this site so re-runs start clean. Scoped to a
  //    single lighthouse_site_* id — cannot touch real customer rows.
  {
    const db = getDb();
    await Promise.all([
      db.delete(phase1Events).where(eq(phase1Events.siteId, siteId)),
      db.delete(phase2PageSnapshots).where(eq(phase2PageSnapshots.siteId, siteId)),
      db.delete(zybitFindings).where(eq(zybitFindings.siteId, siteId)),
    ]);
  }

  // 3.5) Brand-DNA capture — fire in parallel with the snapshot loop +
  //      insights pipeline. Desktop-only (v1) per the audit-funnel spec; the
  //      array shape leaves the capture layer forward-compatible, but the
  //      `phase2_site_design_snapshot` row is keyed (siteId, pathRef) without
  //      a breakpoint column — adding mobile here today would silently
  //      overwrite the desktop row on upsert. Don't expand without a schema
  //      change. Fail-soft: errors are logged via the progress channel and
  //      the audit completes without a brand-DNA section in the report.
  const primaryPathRef = new URL(url).pathname || '/';
  const brandDnaPromise = (async () => {
    try {
      const summary = await capturePageAllBreakpoints({
        url,
        pathRef: primaryPathRef,
        siteId,
        organizationId,
        breakpoints: ['desktop'],
        runId: randomUUID(),
      });
      const capture = summary.captures[0];
      if (!capture) {
        progress(onProgress, 'snapshots', 'brand-DNA capture returned no captures');
        return;
      }
      const row = buildFullDesignSnapshot({
        organizationId,
        capture,
        // `cssSystem` lives on the structural snapshot, not on the
        // PageCapture — leave null at audit time; the AI advisor falls back
        // to the structural snapshot's own `cssSystem` field.
        cssSystem: null,
      });
      await createDesignSnapshotRepository().upsert(row);
      progress(onProgress, 'snapshots', `brand-DNA captured for ${primaryPathRef}`);
    } catch (err) {
      progress(
        onProgress,
        'snapshots',
        `brand-DNA capture failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();

  // 4) Snapshot every crawled page with Zybit's real fetch+parse pipeline.
  progress(onProgress, 'snapshots', `snapshotting ${map.pages.length} page(s)`);
  const repository = createPhase1Repository();
  const grounded: GroundedPage[] = [];
  const inspector: NonNullable<GenerateResult['inspector']> = [];
  const snapshotErrors: { path: string; code: string; message: string }[] = [];
  for (const page of map.pages) {
    try {
      const r = await runSnapshot(page.url, { respectRobots: false });
      await repository.upsertPageSnapshot({
        organizationId,
        siteId,
        pathRef: page.pathRef,
        url: r.finalUrl,
        data: r.data,
        fetchedAt: new Date(),
      });
      grounded.push({ pathRef: page.pathRef, data: r.data });
      inspector.push({
        pathRef: page.pathRef,
        url: r.finalUrl,
        title: r.data.meta.title,
        cssSystem: r.data.cssSystem,
        ctaCount: r.data.ctas.length,
        formCount: r.data.forms.length,
        headingCount: r.data.headings.length,
        topCtas: [...r.data.ctas]
          .sort((a, b) => b.visualWeight - a.visualWeight)
          .slice(0, 4)
          .map((c) => ({
            text: c.text,
            visualWeight: c.visualWeight,
            landmark: c.landmark,
            foldGuess: c.foldGuess,
          })),
      });
    } catch (err) {
      if (err instanceof SnapshotError) {
        snapshotErrors.push({ path: page.pathRef, code: err.code, message: err.message });
      } else {
        snapshotErrors.push({
          path: page.pathRef,
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 5) Emit the snapshot-grounded synthetic event layer.
  progress(
    onProgress,
    'sessions',
    `generating grounded events for ${grounded.length} snapshotted page(s)`,
  );
  const baseTime = Date.now();
  const sink = new DirectEventSink({ organizationId });
  const events = generateGroundedEvents({ siteId, pages: grounded, baseTime });
  for (const event of events) {
    await sink.emit(event);
  }
  const { written } = await sink.flush();

  // 6) Run Zybit's Phase 2 insights pipeline.
  progress(onProgress, 'insights', 'running Phase 2 insights pipeline');
  const padMs = 300_000;
  const insights = await runPhase2InsightsPipeline({
    organizationId,
    siteId,
    window: {
      start: new Date(baseTime - padMs).toISOString(),
      end: new Date(baseTime + padMs).toISOString(),
    },
    maxFindings: 50,
    ...(mode ? { mode } : {}),
  });
  let auditFindings = (insights.auditReport?.findings ?? []) as AuditFinding[];

  // Defense-in-depth scrub for public-audit mode. The rule-level rewrites
  // and the fail-closed orchestrator are the primary fix; this catches any
  // future regression that emits `(unnamed CTA)` artifacts after a guard
  // is loosened. Lives in a shared module so the public-audit HTTP route
  // and this runner can't drift (handover §13.3).
  if (mode === 'public-audit') {
    auditFindings = applyDefenseInDepthScrub(auditFindings);
  }
  if (insights.warnings.length > 0 || !insights.trustworthy) {
    progress(
      onProgress,
      'insights',
      `gate: trustworthy=${insights.trustworthy} warnings=${insights.warnings
        .map((w) => w.code)
        .join(',')}`,
    );
  }
  progress(onProgress, 'insights', `auditReport: ${auditFindings.length} findings`);

  // Persist findings so the synthetic org's /app/findings can render them.
  // Non-fatal: an audit is still useful even if persistence fails.
  if (auditFindings.length > 0) {
    try {
      const writtenFindings = await upsertFindings(
        organizationId,
        siteId,
        auditFindings,
        baseTime - padMs,
        baseTime + padMs,
      );
      progress(onProgress, 'insights', `persisted ${writtenFindings} findings`);
    } catch (err) {
      progress(
        onProgress,
        'insights',
        `persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 7) Sample rows for the inspector.
  const db = getDb();
  const [eventSample, snapshotSample] = await Promise.all([
    db
      .select({
        id: phase1Events.id,
        type: phase1Events.type,
        path: phase1Events.path,
        source: phase1Events.source,
        occurredAt: phase1Events.occurredAt,
      })
      .from(phase1Events)
      .where(eq(phase1Events.siteId, siteId))
      .limit(5),
    db
      .select({
        pathRef: phase2PageSnapshots.pathRef,
        url: phase2PageSnapshots.url,
        contentHash: phase2PageSnapshots.contentHash,
        fetchedAt: phase2PageSnapshots.fetchedAt,
      })
      .from(phase2PageSnapshots)
      .where(eq(phase2PageSnapshots.siteId, siteId))
      .limit(5),
  ]);
  const findingsSample = auditFindings.slice(0, 10).map((f) => ({
    ruleId: f.ruleId,
    pathRef: f.pathRef,
    title: f.title,
    priorityScore: f.priorityScore,
    severity: f.severity,
    category: f.category,
    summary: f.summary,
  }));

  // Make sure the brand-DNA row is committed before we return — the route
  // composes the report email immediately after this and reads from
  // `phase2_site_design_snapshot`. Already non-throwing.
  await brandDnaPromise;

  progress(onProgress, 'done', 'url audit complete');
  return {
    runId,
    scenarioId: url,
    organizationId,
    siteId,
    counts: {
      sessions: 0,
      events: written,
      snapshots: grounded.length,
      findings: auditFindings.length,
    },
    sample: {
      events: eventSample,
      snapshots: snapshotSample,
      findings: findingsSample,
    },
    startedAt,
    finishedAt: now(),
    crawl: {
      requestedUrl: map.requestedUrl,
      pagesDiscovered: map.discovered,
      pagesSnapshotted: grounded.length,
    },
    inspector,
    ...(snapshotErrors.length ? { snapshotErrors } : {}),
  };
}
