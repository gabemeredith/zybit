/**
 * Slice 2 shared core — turn a finding id into annotated HTML ready to
 * render in an iframe or hand to Browserless for a screenshot. Both the
 * preview route and the screenshot helper call this so they produce
 * byte-identical HTML (and so a fix in one surface never drifts from
 * the other).
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitFindings } from '@/lib/db/schema';
import { applyModifications, stripScripts } from '@/lib/experiments/htmlModifier';
import { createPhase1Repository } from '@/lib/phase1/repository';
import { getRuleById } from '@/lib/phase2/rules';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import type { DesignTokens } from '@/lib/phase2/snapshots/tokenExtractor';

const FETCH_TIMEOUT_MS = 8_000;

export interface BuildAnnotatedFindingHtmlOk {
  ok: true;
  html: string;
  annotationsCount: number;
  /** Set when the finding's site is a Lighthouse synthetic site. */
  lighthouseSlug: string | null;
  finding: AuditFinding;
}

export interface BuildAnnotatedFindingHtmlErr {
  ok: false;
  status: number;
  message: string;
}

export type BuildAnnotatedFindingHtmlResult =
  | BuildAnnotatedFindingHtmlOk
  | BuildAnnotatedFindingHtmlErr;

export async function buildAnnotatedFindingHtml(
  findingId: string,
  organizationId: string,
): Promise<BuildAnnotatedFindingHtmlResult> {
  const db = getDb();
  const findingRows = await db
    .select()
    .from(zybitFindings)
    .where(
      and(eq(zybitFindings.id, findingId), eq(zybitFindings.organizationId, organizationId)),
    )
    .limit(1);
  const findingRow = findingRows[0];
  if (!findingRow) return { ok: false, status: 404, message: 'Not Found' };
  if (!findingRow.pathRef) {
    return { ok: false, status: 404, message: 'Finding has no pathRef' };
  }

  const repository = createPhase1Repository();
  const snapshot = await repository.getPageSnapshot({
    organizationId,
    siteId: findingRow.siteId,
    pathRef: findingRow.pathRef,
  });
  if (!snapshot) return { ok: false, status: 404, message: 'No snapshot for this finding' };

  const siteRows = await db
    .select({ domain: phase1Sites.domain })
    .from(phase1Sites)
    .where(eq(phase1Sites.id, findingRow.siteId))
    .limit(1);
  const domain = siteRows[0]?.domain;
  if (!domain) return { ok: false, status: 404, message: 'Site domain not found' };

  const designRepo = createDesignSnapshotRepository();
  const designRow = await designRepo.findBySitePath(
    organizationId,
    findingRow.siteId,
    findingRow.pathRef,
  );
  const designTokens = (designRow?.designTokens as DesignTokens | null) ?? null;

  const lighthouseSlug = findingRow.siteId.startsWith('lighthouse_site_')
    ? findingRow.siteId.slice('lighthouse_site_'.length)
    : null;
  const originUrl = lighthouseSlug
    ? `http://${domain}/fake-sites/${lighthouseSlug}${findingRow.pathRef}`
    : `https://${domain}${findingRow.pathRef}`;

  let html: string;
  try {
    const res = await fetch(originUrl, {
      headers: { 'User-Agent': 'Zybit-Preview/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, status: 502, message: `Origin returned ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    return { ok: false, status: 504, message: `Could not reach origin: ${message}` };
  }

  const finding = rowToFinding(findingRow);
  const rule = getRuleById(finding.ruleId);
  const annotations = rule?.proposeAnnotations?.(finding, { snapshot, designTokens }) ?? [];
  const annotated = annotations.length > 0 ? applyModifications(html, annotations) : html;
  const stripped = stripScripts(annotated);
  const out = injectBaseHref(stripped, originUrl);

  return {
    ok: true,
    html: out,
    annotationsCount: annotations.length,
    lighthouseSlug,
    finding,
  };
}

function injectBaseHref(html: string, originUrl: string): string {
  if (/<base\s/i.test(html)) return html;
  const baseTag = `<base href="${escapeAttr(originUrl)}">`;
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    return html.replace(headOpen[0], `${headOpen[0]}${baseTag}`);
  }
  return `${baseTag}${html}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function rowToFinding(row: typeof zybitFindings.$inferSelect): AuditFinding {
  return {
    id: row.id,
    ruleId: row.ruleId,
    category: row.category as AuditFinding['category'],
    severity: row.severity as AuditFinding['severity'],
    confidence: row.confidence,
    priorityScore: row.priorityScore,
    pathRef: row.pathRef,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    evidence: row.evidence,
    prescription: row.prescription ?? undefined,
    impactEstimate: row.impactEstimate ?? undefined,
    refs: (row.refs as AuditFinding['refs']) ?? undefined,
  };
}
