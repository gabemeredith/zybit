/**
 * Layer B eval — turns "is the LLM prose better than the template?" into a
 * number. Reads the prose pairs the orchestrator already captured
 * (telemetry.findings[].prose.{template, llm}) and runs the pairwise judge on
 * each, in BOTH orders. A pair only counts as a win when the judge agrees in
 * both orders — disagreement is recorded as a tie, which cancels position bias
 * AND surfaces how decisive the judge actually was.
 */

import type { LayerBRunTelemetry } from '../orchestrator';
import { runJudge, type JudgeOpts, type JudgeProse } from './judge';

export interface EvalFinding {
  ruleId: string;
  pathRef: string | null;
  winner: 'llm' | 'template' | 'tie';
  reason: string;
}

export interface EvalReport {
  /** Findings that had both a template and an LLM version to compare. */
  judged: number;
  llmWins: number;
  templateWins: number;
  ties: number;
  /** llmWins / judged. */
  llmWinRate: number;
  /** (llmWins + templateWins) / judged — how often the judge was decisive. */
  decisiveRate: number;
  // Operational passthrough from the generation run.
  generatorModel: string;
  attempted: number;
  fellBack: number;
  fallbackRate: number;
  fabricationRejections: number;
  perFinding: EvalFinding[];
}

function proseOf(p: { summary: string; prescription?: { whatToChange?: string } }): JudgeProse {
  return p.prescription?.whatToChange
    ? { summary: p.summary, whatToChange: p.prescription.whatToChange }
    : { summary: p.summary };
}

export async function runEval(
  telemetry: LayerBRunTelemetry,
  opts?: JudgeOpts,
): Promise<EvalReport> {
  const pairs = telemetry.findings.filter((f) => f.prose.llm);

  const perFinding = await Promise.all(
    pairs.map(async (f): Promise<EvalFinding> => {
      const template = proseOf(f.prose.template);
      const llm = proseOf(f.prose.llm!);
      const base = { ruleId: f.ruleId, pathRef: f.pathRef };

      // Order 1: A=template, B=llm. Order 2: A=llm, B=template.
      const [v1, v2] = await Promise.all([
        runJudge({ ...base, a: template, b: llm }, opts),
        runJudge({ ...base, a: llm, b: template }, opts),
      ]);

      if (!v1 || !v2) {
        return { ...base, winner: 'tie', reason: 'judge unavailable' };
      }
      const llmBothOrders = v1.winner === 'B' && v2.winner === 'A';
      const templateBothOrders = v1.winner === 'A' && v2.winner === 'B';
      if (llmBothOrders) return { ...base, winner: 'llm', reason: v1.reason };
      if (templateBothOrders) return { ...base, winner: 'template', reason: v1.reason };
      return { ...base, winner: 'tie', reason: `order-inconsistent (${v1.winner}/${v2.winner})` };
    }),
  );

  const llmWins = perFinding.filter((p) => p.winner === 'llm').length;
  const templateWins = perFinding.filter((p) => p.winner === 'template').length;
  const ties = perFinding.filter((p) => p.winner === 'tie').length;
  const judged = perFinding.length;

  return {
    judged,
    llmWins,
    templateWins,
    ties,
    llmWinRate: judged ? llmWins / judged : 0,
    decisiveRate: judged ? (llmWins + templateWins) / judged : 0,
    generatorModel: telemetry.model,
    attempted: telemetry.attempted,
    fellBack: telemetry.fellBack,
    fallbackRate: telemetry.fallbackRate,
    fabricationRejections: telemetry.fabricationRejections,
    perFinding,
  };
}
