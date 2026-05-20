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
  const now = new Date();

  // These are only set when transitioning a non-running experiment to running.
  // Initialized as undefined so Drizzle omits them from the UPDATE in all other cases,
  // preventing audit trail wipe and spurious startedAt resets.
  let overlappingIds: string[] | null | undefined = undefined;
  let startedAt: Date | undefined = undefined;

  if (status === "running") {
    const [thisExp] = await db
      .select({ siteId: zybitExperiments.siteId, status: zybitExperiments.status })
      .from(zybitExperiments)
      .where(
        and(
          eq(zybitExperiments.id, experimentId),
          eq(zybitExperiments.organizationId, auth.orgId),
        )
      )
      .limit(1);

    // Only run overlap detection when actually launching (draft → running).
    // Skip if already running to avoid resetting startedAt or wiping the audit trail.
    if (thisExp && thisExp.status !== "running") {
      startedAt = now;

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
            let name = e.hypothesis;
            try {
              if (e.notes) name = (JSON.parse(e.notes) as { name?: string }).name ?? e.hypothesis;
            } catch { /* malformed notes — fall back to hypothesis */ }
            return { id: e.id, name };
          }),
        };
      }

      overlappingIds = runningOnSite.length > 0 ? runningOnSite.map((e) => e.id) : null;
    }
  }

  await db
    .update(zybitExperiments)
    .set({
      status,
      startedAt,
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
