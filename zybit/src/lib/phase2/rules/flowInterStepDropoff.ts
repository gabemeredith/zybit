/**
 * Rule: flow-inter-step-dropoff
 *
 * Flow-aware audit rule (PRD Milestone 1, scope item 4). Reads the derived
 * flow graph and names the mid-flow step that loses the most users — a route
 * users navigate *to* (it has inbound transitions) yet leave the product from
 * at a high rate.
 *
 * Pure entry/landing pages are deliberately excluded: a high bounce on the
 * page everyone lands on is the `bounce-on-key-page` rule's territory. This
 * rule is specifically about loss *between steps* of a flow — the inter-step
 * drop-off the page-level rules cannot see.
 *
 * Deterministic, same contract as the 12 page-level rules. Routed through
 * Layer 2 calibration via `calibratedFloor`.
 */

import type { FlowEdge } from '@/lib/phase2/flow/types';
import { clamp, formatCount, pct } from './helpers';
import { calibratedFloor } from './ruleCalibration';
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
} from './types';

const RULE_ID = 'flow-inter-step-dropoff';

/** The whole graph must carry at least this many sessions before the rule speaks. */
const MIN_GRAPH_SESSIONS = 50;
/** A chokepoint must be reached by at least this many sessions. */
const MIN_NODE_SESSIONS = 30;
/** ...and reached *via navigation* — at least this many inbound transitions. */
const MIN_INBOUND_TRANSITIONS = 20;
/** Detection floor: a chokepoint's exit rate must exceed this. Calibrated. */
const EXIT_RATE_FLOOR = 0.55;
/** Exit rate at/above which the finding is critical rather than a warning. */
const CRITICAL_EXIT_RATE = 0.75;

export const flowInterStepDropoff: AuditRule = {
  id: RULE_ID,
  name: 'Flow inter-step drop-off',
  category: 'flow',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const graph = ctx.flowGraph;
    if (!graph || graph.sessionCount < MIN_GRAPH_SESSIONS) return [];

    const floor = calibratedFloor(ctx, RULE_ID, EXIT_RATE_FLOOR);

    // Inbound transition totals + the single biggest inbound edge per route.
    const inboundTotal = new Map<string, number>();
    const topInboundEdge = new Map<string, FlowEdge>();
    for (const e of graph.edges) {
      inboundTotal.set(e.to, (inboundTotal.get(e.to) ?? 0) + e.transitions);
      const top = topInboundEdge.get(e.to);
      if (!top || e.transitions > top.transitions) {
        topInboundEdge.set(e.to, e);
      }
    }

    // Candidate chokepoints: mid-flow nodes (reached via navigation) with
    // enough traffic and an exit rate above the calibrated floor.
    const candidates = graph.nodes.filter(
      (n) =>
        n.sessions >= MIN_NODE_SESSIONS &&
        (inboundTotal.get(n.route) ?? 0) >= MIN_INBOUND_TRANSITIONS &&
        n.exitRate > floor,
    );
    if (candidates.length === 0) return [];

    // The step that loses the most users — by absolute lost sessions, then by
    // exit rate, then route for a deterministic tiebreak.
    candidates.sort((a, b) => {
      if (b.exits !== a.exits) return b.exits - a.exits;
      if (b.exitRate !== a.exitRate) return b.exitRate - a.exitRate;
      return a.route.localeCompare(b.route);
    });

    const node = candidates[0];
    const topEdge = topInboundEdge.get(node.route);
    const predecessor = topEdge ? topEdge.from : null;
    const continued = node.sessions - node.exits;
    const trafficShare =
      graph.sessionCount > 0 ? node.sessions / graph.sessionCount : 0;
    const exitPct = pct(node.exitRate);

    const summary =
      `${formatCount(node.exits)} of ${formatCount(node.sessions)} sessions that reach ` +
      `${node.route} (${exitPct}%) leave the product there instead of continuing` +
      `${predecessor ? `, most arriving from ${predecessor}` : ''}. ` +
      `This is the single step in the flow losing the most users.`;

    const recommendation: string[] = [
      `${node.route} is a mid-flow step — users navigate to it${
        predecessor ? ` (most from ${predecessor})` : ''
      } rather than landing on it cold — yet ${exitPct}% of the sessions that ` +
        `reach it end there. That is drop-off the page-level audit cannot see, ` +
        `because the problem is the transition, not the page in isolation.`,
      `Look at what this step asks of the user relative to the steps that retain ` +
        `them: a form, a decision, a price, a dead end with no obvious next action. ` +
        `Only ${formatCount(continued)} of the arriving sessions continued anywhere ` +
        `in the product. Reducing the friction here compounds across every flow ` +
        `that routes through it.`,
    ];

    const prescription = {
      whatToChange:
        `Reduce drop-off at ${node.route} — the mid-flow step ${exitPct}% of ` +
        `arriving sessions abandon. Give it one unambiguous next action and ` +
        `remove anything that competes with it.`,
      whyItWorks:
        `Users reach ${node.route} with intent (they navigated here${
          predecessor ? ` from ${predecessor}` : ''
        }), so the loss is friction, not lack of interest. A clearer single ` +
        `next step converts that intent instead of stranding it.`,
      experimentVariantDescription:
        `Variant B: ${node.route} restructured around one primary next action, ` +
        `competing CTAs and optional detail demoted. Primary metric: the share ` +
        `of sessions reaching ${node.route} that continue to a following step.`,
    };

    const evidence: AuditFindingEvidence[] = [
      { label: 'Sessions reaching the step', value: node.sessions },
      { label: 'Sessions that left here', value: node.exits },
      {
        label: 'Exit rate',
        value: `${exitPct}%`,
        context: 'share of arriving sessions that ended on this step',
      },
      { label: 'Continued past the step', value: continued },
    ];
    if (predecessor && topEdge) {
      evidence.push({
        label: 'Top inbound path',
        value: `${predecessor} → ${node.route}`,
        context: `${formatCount(topEdge.transitions)} transitions`,
      });
    }

    const funnelSteps = [
      ...(predecessor && topEdge
        ? [{ label: `Arrived from ${predecessor}`, value: topEdge.transitions }]
        : []),
      { label: `Reached ${node.route}`, value: node.sessions, isFlagged: true },
      { label: 'Continued in the product', value: continued },
    ];

    return [
      {
        id: `${RULE_ID}:${node.route}`,
        ruleId: RULE_ID,
        category: 'flow',
        severity: node.exitRate >= CRITICAL_EXIT_RATE ? 'critical' : 'warn',
        confidence: clamp(
          0.4 + Math.log10(Math.max(node.sessions, 1)) * 0.2,
          0,
          0.95,
        ),
        priorityScore: clamp(node.exitRate * 0.7 + trafficShare * 0.3, 0, 1),
        pathRef: node.route,
        title: `Users drop out at ${node.route}`,
        summary,
        recommendation,
        prescription,
        evidence,
        snapshotDiagram: {
          type: 'flow-funnel',
          pathRef: node.route,
          funnelSteps,
          proposedFix:
            `Give ${node.route} one clear next action so the ${exitPct}% who ` +
            `abandon it continue through the flow instead.`,
        },
      },
    ];
  },
};
