"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { phase1Sites, zybitExperiments, zybitFindings } from "@/lib/db/schema";
import type { VariantModification, InsertPosition } from "@/lib/experiments/types";
import { targetPageIsSpaShell } from "@/lib/experiments/spaGuard";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import {
  validateBriefShape,
  INSERT_POSITIONS,
  type ValidationError as BriefValidationError,
} from "@/lib/experiments/validateBrief";

const VALID_CHANGE_TYPES = ["copy", "style", "hide", "insert"] as const;
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
  insertPosition?: InsertPosition;
}

export type ValidationError = BriefValidationError;

export async function saveExperimentBriefAction(
  input: SaveBriefInput,
): Promise<ValidationError | void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  if (!VALID_CHANGE_TYPES.includes(input.changeType)) {
    return {
      type: "validation_error",
      field: "changeType",
      message: "Unknown change type.",
    };
  }

  const selector = input.selector.trim().slice(0, 500);
  // For 'insert' the field carries an HTML fragment, not a CSS class string —
  // preserve internal whitespace, cap on total length to keep the proxy quick.
  const newValue =
    input.changeType === "insert"
      ? input.newValue.slice(0, 8000)
      : input.newValue.trim();
  const insertPosition = input.changeType === "insert" ? input.insertPosition : undefined;
  const validation = validateBriefShape(input.changeType, selector, newValue, insertPosition);
  if (validation) return validation;

  const experimentBrief = {
    experimentName: input.experimentName.trim().slice(0, 200),
    selector,
    changeType: input.changeType,
    newValue,
    variantDescription: input.variantDescription.trim(),
    primaryMetric: input.primaryMetric.trim().slice(0, 200),
    hypothesis: input.hypothesis.trim() || null,
    insertPosition: insertPosition ?? null,
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
  insertPosition: InsertPosition | undefined,
): VariantModification[] {
  if (changeType === "copy") {
    return [{ type: "text-replace", selector, text: newValue }];
  }
  if (changeType === "hide") {
    return [{ type: "element-hide", selector }];
  }
  if (changeType === "insert") {
    const position: InsertPosition =
      insertPosition && (INSERT_POSITIONS as readonly string[]).includes(insertPosition)
        ? insertPosition
        : "before";
    const mods: VariantModification[] = [
      { type: "element-insert", selector, position, html: newValue },
    ];
    // The insert sanitizer strips inline styles, so a raw inserted block
    // renders with browser defaults (ugly in the preview). Our scaffolds carry
    // a `.zybit-insert` class; pair the insert with companion css-inject rules
    // scoped to that class so the section renders as a styled card. Gated on
    // the class being present, so a custom insert without it is untouched.
    if (/\bzybit-insert\b/.test(newValue)) {
      // Theme-adaptive styling so the card blends into the host page's design
      // instead of pasting a white sticker on it: a neutral translucent surface
      // (subtle on both dark and light themes) and text that inherits the host's
      // own color (`currentColor`) so it's legible on any background. No brand
      // tokens or AI needed — universally-supported rgba + currentColor only.
      mods.push(
        { type: "css-inject", selector: ".zybit-insert", css: "background:rgba(127,127,127,0.08);border:1px solid rgba(127,127,127,0.22);border-radius:16px;padding:20px 24px;margin:0 0 24px 0" },
        { type: "css-inject", selector: ".zybit-insert h2", css: "margin:0 0 8px 0;font-size:18px;font-weight:700;line-height:1.3" },
        { type: "css-inject", selector: ".zybit-insert p", css: "margin:0 0 12px 0;font-size:14px;line-height:1.5;opacity:0.75" },
        { type: "css-inject", selector: ".zybit-insert li", css: "margin:6px 0" },
        { type: "css-inject", selector: ".zybit-insert a", css: "color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px" },
      );
    }
    return mods;
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

// Zybit-123: surfaced when the target page renders client-side. The proxy
// modifies server-rendered HTML, so a SPA variant would be a silent no-op.
export type SpaWarning = {
  type: "spa_warning";
  targetUrl: string;
};

export async function launchExperimentAction(
  findingId: string,
  acknowledgedOverlapIds: string[] = [],
  acknowledgeSpa = false,
): Promise<OverlapWarning | SpaWarning | ValidationError | void> {
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

  // Re-validate the loaded brief: it may have been saved before the form
  // grew its required/no-match gates, or written by a non-form caller.
  // Refuse to launch a brief that would produce no-op modifications.
  const briefValidation = validateBriefShape(
    finding.experimentBrief.changeType,
    finding.experimentBrief.selector,
    finding.experimentBrief.newValue,
    finding.experimentBrief.insertPosition ?? undefined,
  );
  if (briefValidation) return briefValidation;

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

  // Warn if any currently-running overlap has not been explicitly
  // acknowledged. Tracking acknowledgment by experiment id — rather than a
  // blanket boolean — means an experiment that starts after the PM acknowledged
  // the original set (e.g. while a follow-up SPA warning is on screen) is still
  // surfaced for acknowledgment.
  const unacknowledgedOverlaps = runningOnSite.filter(
    (e) => !acknowledgedOverlapIds.includes(e.id),
  );
  if (unacknowledgedOverlaps.length > 0) {
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

  // Zybit-123: SPA-shell guard. The proxy applies variant modifications to
  // server-rendered HTML; a client-side-rendered page has no target nodes at
  // request time, so the variant would render identical to control and the
  // experiment would conclude on data that was never a real variant. Fetch
  // the target page once and warn before launch. Fails open — a fetch error
  // never blocks a launch (see targetPageIsSpaShell).
  if (!acknowledgeSpa) {
    const siteRows = await db
      .select({ domain: phase1Sites.domain })
      .from(phase1Sites)
      .where(
        and(
          eq(phase1Sites.id, finding.siteId),
          eq(phase1Sites.organizationId, auth.orgId),
        )
      )
      .limit(1);
    const domain = siteRows[0]?.domain;
    if (domain) {
      const targetUrl = `https://${domain}${finding.pathRef ?? "/"}`;
      if (await targetPageIsSpaShell(targetUrl)) {
        return { type: "spa_warning", targetUrl };
      }
    }
  }

  const brief = finding.experimentBrief;
  const now = new Date();
  const experimentId = randomUUID();

  // Demo polish: when the audit fix-preview already produced a brand-matched,
  // vision-validated variant (`fixModifications`) for this finding, launch with
  // THAT instead of the brief scaffold, and reuse its cached before/after
  // screenshots so the experiment preview is instant + on-brand. Scoped to the
  // demo org so real customers' launches stay driven by the brief they authored.
  const fixMods =
    auth.orgId === DEMO_ORG_ID && Array.isArray(finding.fixModifications)
      ? (finding.fixModifications as VariantModification[])
      : [];
  const useFix = fixMods.length > 0;
  const fixInsert = fixMods.find((m) => m.type === "element-insert");

  const notes: Record<string, unknown> = {
    name: brief.experimentName,
    // Surface the variant that actually launches in the Configuration panel.
    selector: useFix && fixInsert ? fixInsert.selector : brief.selector,
    changeType: useFix && fixInsert ? "insert" : brief.changeType,
    newValue: useFix && fixInsert ? fixInsert.html : brief.newValue,
    insertPosition: useFix && fixInsert ? fixInsert.position : brief.insertPosition ?? null,
  };
  if (useFix && finding.screenshotBeforeUrl && finding.screenshotAfterUrl) {
    notes.screenshotBeforeUrl = finding.screenshotBeforeUrl;
    notes.screenshotAfterUrl = finding.screenshotAfterUrl;
  }

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
    modifications: useFix
      ? fixMods
      : briefToModifications(
          brief.changeType,
          brief.selector,
          brief.newValue,
          brief.insertPosition ?? undefined,
        ),
    overlappingExperimentIds: runningOnSite.length > 0 ? runningOnSite.map((e) => e.id) : null,
    notes: JSON.stringify(notes),
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
