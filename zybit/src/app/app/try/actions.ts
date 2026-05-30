"use server";

/**
 * `/app/try` — the in-app "Try one free experiment" funnel glue
 * (docs/sprints/free-experiment-loop.md §1, Phase 7/8 step-2).
 *
 * This is the cold-URL entry surface the handoff calls the "un-wired
 * centerpiece": until now `createPreviewExperiment` was only ever called by the
 * demo seed. These two actions finally mint a projected preview from a *real*
 * pasted URL for an authenticated PM.
 *
 * The split mirrors `freeExperimentFlow.ts` exactly, which is the whole point of
 * locked-decision #8 (auth timing is a pluggable seam):
 *
 *   1. `generateFreeExperimentAction` — the RENDER half. Validates the URL,
 *      checks the gate (cheap, so a blocked org never pays for an audit), and
 *      runs `runFreeExperimentFlow` (audit → proposal → projection). Touches NO
 *      DB state and returns a fully renderable result + a serializable payload.
 *   2. `saveFreeExperimentAction` — the PERSIST half. Re-checks + atomically
 *      claims the org's one free slot, resolves/creates the site, and writes the
 *      `previewOnly` experiment, then lands the PM in the cockpit.
 *
 * Keeping (1) free of (2) means the projected result can render inline-before or
 * behind a sign-in gate without rework — the cofounder's public funnel layers on
 * top of the same two halves.
 */

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import { validatePublicUrl } from "@/lib/audit/urlValidator";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import {
  loadFreeExperimentGate,
  claimFreeExperimentSlot,
} from "@/lib/billing/freeExperimentGate";
import {
  runFreeExperimentFlow,
  persistFreeExperiment,
} from "@/lib/experiments/freeExperimentFlow";
import type { ManufacturedExperiment } from "@/lib/experiments/auditFindingBrief";
import type { ProjectedImpact } from "@/lib/experiments/projectedImpact";

export interface FreeExperimentNumbersInput {
  monthlyVisitors: number | null;
  monthlyRevenue: number | null;
}

/**
 * The bundle the client carries from generate → save. It is the *already
 * computed* proposal + projection, so saving never re-runs the (expensive)
 * audit. An authenticated PM can only ever persist a preview into their own org,
 * and a preview never touches real traffic, so trusting these client-held
 * fields carries no cross-tenant risk — but `saveFreeExperimentAction` still
 * re-validates the URL and re-checks the gate before writing anything.
 */
export interface FreeExperimentSavePayload {
  url: string;
  source: "finding" | "starter";
  experiment: ManufacturedExperiment;
  projection: ProjectedImpact;
}

export type GenerateFreeExperimentResult =
  | {
      status: "ok";
      source: "finding" | "starter";
      domain: string;
      /** Present only for a real finding (null for the clean-page starter). */
      findingTitle: string | null;
      experiment: ManufacturedExperiment;
      projection: ProjectedImpact;
      payload: FreeExperimentSavePayload;
    }
  // Client-rendered page — we can't proxy-modify it; client pivots to "connect
  // your data" (§3 SPA fallback).
  | { status: "spa" }
  // Audit failed even after one retry — client pivots to connect-data (§3 error).
  | { status: "error"; reason: string }
  // Bad / unsafe URL — surfaced inline on the form.
  | { status: "invalid"; reason: string }
  // Unpaid org has already used its one free experiment → render upgrade moment.
  | { status: "blocked" };

function deriveTargetPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Render half — audit → proposal → projection, no DB writes. Gate is checked up
 * front purely to avoid spending an audit on an org that can't save the result;
 * the authoritative, race-safe claim happens in `saveFreeExperimentAction`.
 */
export async function generateFreeExperimentAction(
  url: string,
  numbers: FreeExperimentNumbersInput,
): Promise<GenerateFreeExperimentResult> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const validation = await validatePublicUrl(url);
  if (!validation.valid) {
    return { status: "invalid", reason: validation.reason };
  }
  const safeUrl = validation.url.toString();

  // Cheap gate pre-check: an unpaid org that already used its free slot should
  // see the upgrade moment, not burn an audit. The demo org is exempt — it
  // stages several experiments by design.
  if (auth.orgId !== DEMO_ORG_ID) {
    const gate = await loadFreeExperimentGate(auth.orgId);
    if (!gate.allowed) return { status: "blocked" };
  }

  // Run the flow. On a transient audit error, retry once, then pivot (§3).
  let result = await runFreeExperimentFlow(safeUrl, numbers);
  if (result.status === "error") {
    result = await runFreeExperimentFlow(safeUrl, numbers);
  }

  if (result.status === "spa") return { status: "spa" };
  if (result.status === "error") return { status: "error", reason: result.reason };

  return {
    status: "ok",
    source: result.source,
    domain: validation.url.hostname.replace(/^www\./, ""),
    findingTitle: result.finding?.title ?? null,
    experiment: result.experiment,
    projection: result.projection,
    payload: {
      url: safeUrl,
      source: result.source,
      experiment: result.experiment,
      projection: result.projection,
    },
  };
}

export type SaveFreeExperimentResult =
  | { status: "blocked" }
  | { status: "invalid"; reason: string };
// On success the action redirects (throws), so there is no success variant.

/**
 * Persist half — claim the one free slot atomically, resolve/create the site,
 * and write the `previewOnly` experiment, then land the PM on the experiment
 * detail page (which renders the projected arc). Returns only on the blocked /
 * invalid branches; the happy path ends in a redirect.
 */
export async function saveFreeExperimentAction(
  payload: FreeExperimentSavePayload,
): Promise<SaveFreeExperimentResult> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  // Re-validate the URL server-side — never trust a client-held value to drive
  // a site row, even from an authenticated user.
  const validation = await validatePublicUrl(payload.url);
  if (!validation.valid) return { status: "invalid", reason: validation.reason };

  const isDemoOrg = auth.orgId === DEMO_ORG_ID;
  const now = new Date();

  // Authoritative gate + atomic claim. The `IS NULL` guard inside
  // claimFreeExperimentSlot makes two concurrent saves race-safe: only the first
  // flips the column; the loser falls through to the upgrade moment.
  if (!isDemoOrg) {
    const gate = await loadFreeExperimentGate(auth.orgId);
    if (!gate.allowed) return { status: "blocked" };
    if (gate.reason === "free-slot-available") {
      const claimed = await claimFreeExperimentSlot(auth.orgId, now);
      if (!claimed) return { status: "blocked" };
    }
    // reason 'paid' falls through without consuming a slot.
  }

  // Resolve the site to attach the preview to. Mirror the onboarding pilot model
  // (`createSiteAction`): one org = one site — reuse the org's site if it has
  // one, else create it from the audited domain. Both `/app/loop` and
  // `/app/experiments` default to the org's primary site, so attaching here is
  // what makes the projected arc show up in the cockpit.
  const domain = validation.url.hostname.replace(/^www\./, "");
  const repository = createPhase1Repository();
  const existing = await repository.listSites({ organizationId: auth.orgId, limit: 1 });
  const site =
    existing[0] ??
    (await repository.createSite({
      id: randomUUID(),
      organizationId: auth.orgId,
      name: domain,
      domain,
      createdAt: now.toISOString(),
    }));

  const experimentId = await persistFreeExperiment(
    {
      status: "ok",
      source: payload.source,
      finding: null,
      experiment: payload.experiment,
      projection: payload.projection,
    },
    {
      organizationId: auth.orgId,
      siteId: site.id,
      findingId: null,
      targetPath: deriveTargetPath(payload.url),
    },
  );

  redirect(`/app/experiments/${experimentId}`);
}
