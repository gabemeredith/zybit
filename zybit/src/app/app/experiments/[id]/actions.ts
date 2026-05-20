"use server";

import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { zybitExperiments } from "@/lib/db/schema";

const VALID_STATUSES = ["running", "completed", "stopped"] as const;
type ExperimentStatus = (typeof VALID_STATUSES)[number];

export type OverlapWarning = {
  type: "overlap_warning";
  overlaps: Array<{ id: string; name: string }>;
};

export async function updateExperimentStatusAction(
  experimentId: string,
  status: ExperimentStatus,
  acknowledgeOverlap = false,
): Promise<OverlapWarning | void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  if (!VALID_STATUSES.includes(status)) return;

  const db = getDb();

  // When launching (draft → running), detect concurrent experiments on the same site.
  let overlappingIds: string[] | null = null;
  if (status === "running") {
    const [thisExp] = await db
      .select({ siteId: zybitExperiments.siteId })
      .from(zybitExperiments)
      .where(
        and(
          eq(zybitExperiments.id, experimentId),
          eq(zybitExperiments.organizationId, auth.orgId),
        )
      )
      .limit(1);

    if (thisExp) {
      const runningOnSite = await db
        .select({
          id: zybitExperiments.id,
          notes: zybitExperiments.notes,
          hypothesis: zybitExperiments.hypothesis,
        })
        .from(zybitExperiments)
        .where(
          and(
            eq(zybitExperiments.siteId, thisExp.siteId),
            eq(zybitExperiments.organizationId, auth.orgId),
            eq(zybitExperiments.status, "running"),
          )
        );

      if (runningOnSite.length > 0 && !acknowledgeOverlap) {
        return {
          type: "overlap_warning",
          overlaps: runningOnSite.map((e) => {
            const name = e.notes
              ? (JSON.parse(e.notes) as { name?: string }).name ?? e.hypothesis
              : e.hypothesis;
            return { id: e.id, name };
          }),
        };
      }

      if (runningOnSite.length > 0) {
        overlappingIds = runningOnSite.map((e) => e.id);
      }
    }
  }

  const now = new Date();
  await db
    .update(zybitExperiments)
    .set({
      status,
      startedAt: status === "running" ? now : undefined,
      completedAt: status === "completed" || status === "stopped" ? now : undefined,
      overlappingExperimentIds: overlappingIds,
      updatedAt: now,
    })
    .where(
      and(
        eq(zybitExperiments.id, experimentId),
        eq(zybitExperiments.organizationId, auth.orgId),
      )
    );
}

export async function recordResultsAction(
  experimentId: string,
  controlRate: number,
  variantRate: number,
  confidence: number,
  participants: number,
): Promise<void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const db = getDb();
  await db
    .update(zybitExperiments)
    .set({
      resultControlRate: controlRate,
      resultVariantRate: variantRate,
      resultConfidence: confidence,
      resultParticipants: participants,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(zybitExperiments.id, experimentId),
        eq(zybitExperiments.organizationId, auth.orgId),
      )
    );
}
