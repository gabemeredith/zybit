/**
 * Repository for `phase2_site_design_snapshot` — one row per (site, pathRef)
 * holding the full or structural design capture used by the AI Variant Advisor
 * (Zybit-144) and element picker (Zybit-146).
 *
 * Read methods scope by `organizationId` for tenant isolation.
 */

import { and, eq, inArray, type InferInsertModel } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase2SiteDesignSnapshot } from '@/lib/db/schema';

type DesignSnapshotInsert = InferInsertModel<typeof phase2SiteDesignSnapshot>;

export type DesignCaptureMethod = 'full' | 'structural';

export interface DesignSnapshotRow {
  id: string;
  organizationId: string;
  siteId: string;
  pathRef: string;
  capturedAt: Date;
  captureMethod: DesignCaptureMethod;
  screenshotUrl: string | null;
  computedStyles: Record<string, unknown> | null;
  designTokens: Record<string, unknown> | null;
  cssSystem: string | null;
  createdAt: Date;
}

export interface UpsertDesignSnapshotInput {
  id: string;
  organizationId: string;
  siteId: string;
  pathRef: string;
  capturedAt: Date;
  captureMethod: DesignCaptureMethod;
  screenshotUrl: string | null;
  computedStyles: Record<string, unknown> | null;
  designTokens: Record<string, unknown> | null;
  cssSystem: string | null;
}

export interface DesignSnapshotRepository {
  upsert(input: UpsertDesignSnapshotInput): Promise<void>;
  findBySitePath(
    organizationId: string,
    siteId: string,
    pathRef: string,
  ): Promise<DesignSnapshotRow | null>;
  listForSite(organizationId: string, siteId: string): Promise<DesignSnapshotRow[]>;
  listByIds(organizationId: string, ids: string[]): Promise<DesignSnapshotRow[]>;
}

function toRow(r: typeof phase2SiteDesignSnapshot.$inferSelect): DesignSnapshotRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    siteId: r.siteId,
    pathRef: r.pathRef,
    capturedAt: r.capturedAt,
    captureMethod: r.captureMethod as DesignCaptureMethod,
    screenshotUrl: r.screenshotUrl,
    computedStyles: r.computedStyles as Record<string, unknown> | null,
    designTokens: r.designTokens as Record<string, unknown> | null,
    cssSystem: r.cssSystem,
    createdAt: r.createdAt,
  };
}

export function createDesignSnapshotRepository(): DesignSnapshotRepository {
  return {
    async upsert(input) {
      const db = getDb();
      // Cast jsonb payloads to the schema's inferred shape so the repo's
      // looser `Record<string, unknown>` interface lines up with Drizzle's
      // narrower `$type<...>()` inference.
      const computedStyles =
        input.computedStyles as DesignSnapshotInsert['computedStyles'];
      const designTokens =
        input.designTokens as DesignSnapshotInsert['designTokens'];

      await db
        .insert(phase2SiteDesignSnapshot)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          siteId: input.siteId,
          pathRef: input.pathRef,
          capturedAt: input.capturedAt,
          captureMethod: input.captureMethod,
          screenshotUrl: input.screenshotUrl,
          computedStyles,
          designTokens,
          cssSystem: input.cssSystem,
        })
        .onConflictDoUpdate({
          target: [phase2SiteDesignSnapshot.siteId, phase2SiteDesignSnapshot.pathRef],
          set: {
            // organizationId must move with the row — without this, a site
            // transferred between orgs would be invisible to org-scoped reads.
            organizationId: input.organizationId,
            capturedAt: input.capturedAt,
            captureMethod: input.captureMethod,
            screenshotUrl: input.screenshotUrl,
            computedStyles,
            // Preserve designTokens on upserts that don't compute them
            // (Zybit-143 writes them in a separate pass).
            ...(input.designTokens !== null && { designTokens }),
            cssSystem: input.cssSystem,
          },
        });
    },

    async findBySitePath(organizationId, siteId, pathRef) {
      const db = getDb();
      const rows = await db
        .select()
        .from(phase2SiteDesignSnapshot)
        .where(
          and(
            eq(phase2SiteDesignSnapshot.organizationId, organizationId),
            eq(phase2SiteDesignSnapshot.siteId, siteId),
            eq(phase2SiteDesignSnapshot.pathRef, pathRef),
          ),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async listForSite(organizationId, siteId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(phase2SiteDesignSnapshot)
        .where(
          and(
            eq(phase2SiteDesignSnapshot.organizationId, organizationId),
            eq(phase2SiteDesignSnapshot.siteId, siteId),
          ),
        );
      return rows.map(toRow);
    },

    async listByIds(organizationId, ids) {
      if (ids.length === 0) return [];
      const db = getDb();
      const rows = await db
        .select()
        .from(phase2SiteDesignSnapshot)
        .where(
          and(
            eq(phase2SiteDesignSnapshot.organizationId, organizationId),
            inArray(phase2SiteDesignSnapshot.id, ids),
          ),
        );
      return rows.map(toRow);
    },
  };
}
