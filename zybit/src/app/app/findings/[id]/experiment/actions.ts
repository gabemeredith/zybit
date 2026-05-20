"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { zybitExperiments, zybitFindings } from "@/lib/db/schema";
import type { VariantModification } from "@/lib/experiments/types";

const VALID_CHANGE_TYPES = ["copy", "style", "hide"] as const;
type ChangeType = (typeof VALID_CHANGE_TYPES)[number];

interface SaveBriefInput {
  findingId: string;
  experimentName: string;
  selector: string;
  changeType: ChangeType;
  newValue: string;
  variantDescription: string;
  primaryMetric: string;
  hypothesis: string;
}

export async function saveExperimentBriefAction(input: SaveBriefInput): Promise<void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  if (!VALID_CHANGE_TYPES.includes(input.changeType)) return;

  const experimentBrief = {
    experimentName: input.experimentName.trim().slice(0, 200),
    selector: input.selector.trim().slice(0, 500),
    changeType: input.changeType,
    newValue: input.newValue.trim(),
    variantDescription: input.variantDescription.trim(),
    primaryMetric: input.primaryMetric.trim().slice(0, 200),
    hypothesis: input.hypothesis.trim() || null,
    createdAt: new Date().toISOString(),
  };

  const db = getDb();
  await db
    .update(zybitFindings)
    .set({ experimentBrief, updatedAt: new Date() })
    .where(
      and(
        eq(zybitFindings.id, input.findingId),
        eq(zybitFindings.organizationId, auth.orgId),
      )
    );

  redirect(`/app/findings/${input.findingId}`);
}

// ---------------------------------------------------------------------------
// Launch — promotes a saved brief into a live running experiment
// ---------------------------------------------------------------------------

function briefToModifications(
  changeType: ChangeType,
  selector: string,
  newValue: string,
): VariantModification[] {
  if (changeType === "copy") {
    return [{ type: "text-replace", selector, text: newValue }];
  }
  if (changeType === "hide") {
    return [{ type: "element-hide", selector }];
  }
  // style: use css-inject to force the variant visual. newValue may be class names
  // or raw CSS — the PM decides. We store the raw value; the manifest API
  // also surfaces the original brief fields for the client-side script path.
  return [{ type: "css-inject", selector, css: newValue }];
}

export type OverlapWarning = {
  type: "overlap_warning";
  overlaps: Array<{ id: string; name: string }>;
};

export async function launchExperimentAction(
  findingId: string,
  acknowledgeOverlap = false,
): Promise<OverlapWarning | void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const db = getDb();

  // Load the finding + brief
  const rows = await db
    .select()
    .from(zybitFindings)
    .where(
      and(
        eq(zybitFindings.id, findingId),
        eq(zybitFindings.organizationId, auth.orgId),
      )
    )
    .limit(1);

  const finding = rows[0];
  if (!finding || !finding.experimentBrief) return;

  // Check for running experiments on the same site (overlap detection).
  // Policy: overlap-allowed with mandatory acknowledgment (DOCTRINE.md).
  const runningOnSite = await db
    .select({
      id: zybitExperiments.id,
      notes: zybitExperiments.notes,
      hypothesis: zybitExperiments.hypothesis,
    })
    .from(zybitExperiments)
    .where(
      and(
        eq(zybitExperiments.siteId, finding.siteId),
        eq(zybitExperiments.organizationId, auth.orgId),
        eq(zybitExperiments.status, "running"),
      )
    );

  if (runningOnSite.length > 0 && !acknowledgeOverlap) {
    return {
      type: "overlap_warning",
      overlaps: runningOnSite.map((e) => {
        let name = e.hypothesis;
        try {
          if (e.notes) name = (JSON.parse(e.notes) as { name?: string }).name ?? e.hypothesis;
        } catch { /* malformed notes — fall back to hypothesis */ }
        return { id: e.id, name };
      }),
    };
  }

  const brief = finding.experimentBrief;
  const now = new Date();
  const experimentId = randomUUID();

  await db.insert(zybitExperiments).values({
    id: experimentId,
    organizationId: auth.orgId,
    siteId: finding.siteId,
    findingId: finding.id,
    hypothesis: brief.hypothesis ?? brief.variantDescription,
    primaryMetric: brief.primaryMetric,
    audienceControlPct: 50,
    audienceVariantPct: 50,
    durationDays: 14,
    status: "running",
    targetPath: finding.pathRef ?? null,
    modifications: briefToModifications(brief.changeType, brief.selector, brief.newValue),
    overlappingExperimentIds: runningOnSite.length > 0 ? runningOnSite.map((e) => e.id) : null,
    // Store original brief fields so the client-side manifest can serve them directly
    notes: JSON.stringify({
      name: brief.experimentName,
      selector: brief.selector,
      changeType: brief.changeType,
      newValue: brief.newValue,
    }),
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // Move finding to shipped
  await db
    .update(zybitFindings)
    .set({ status: "shipped", updatedAt: now })
    .where(eq(zybitFindings.id, findingId));

  redirect(`/app/experiments/${experimentId}`);
}
