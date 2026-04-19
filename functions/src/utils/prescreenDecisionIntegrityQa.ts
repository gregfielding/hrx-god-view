/**
 * Pure checks for prescreen AI / hiring decision consistency (QA reports).
 */

export type PrescreenIntegrityFinding = {
  code: string;
  severity: 'warn' | 'error';
  message: string;
};

const HARD_FLAG = ['drug_risk_high', 'background_risk_high', 'physical_mismatch'];

function num(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return Math.round(x);
}

export function analyzePrescreenInterviewIntegrity(args: {
  ai: Record<string, unknown> | null | undefined;
}): PrescreenIntegrityFinding[] {
  const ai = args.ai;
  if (!ai || typeof ai !== 'object') return [];

  const out: PrescreenIntegrityFinding[] = [];

  const base = num(ai.baseInterviewScore) ?? num(ai.overallScore);
  const adj = num(ai.overrideAdjustedScore) ?? base;
  const rec = String(ai.recommendation || '').toLowerCase();
  const hd = ai.hiringDecision as Record<string, unknown> | undefined;
  const decision = String(hd?.decision || '').toLowerCase();
  const aa = hd?.eligibleForAutoAdvance;
  const flags = Array.isArray(ai.flags) ? (ai.flags as string[]) : [];
  const hardBlocks = Array.isArray(ai.hardBlocks) ? (ai.hardBlocks as string[]) : [];
  const hasHardFlag = flags.some((f) => HARD_FLAG.includes(f)) || hardBlocks.length > 0;
  const moderateCompliance = flags.some((f) =>
    ['drug_risk_moderate', 'background_risk_moderate'].includes(f),
  );

  if (adj != null && adj >= 80 && decision === 'reject') {
    out.push({
      code: 'high_adj_reject',
      severity: 'warn',
      message: `Adjusted score ${adj} but hiring decision is reject`,
    });
  }

  if (rec === 'proceed' && decision === 'reject' && !hasHardFlag) {
    out.push({
      code: 'proceed_vs_reject',
      severity: 'warn',
      message: 'Recommendation proceed but hiring decision reject without hard block / hard flag',
    });
  }

  if (aa === true && (hardBlocks.length > 0 || flags.some((f) => HARD_FLAG.includes(f)))) {
    out.push({
      code: 'advance_with_hard',
      severity: 'error',
      message: 'Auto-advance eligible true while hard blocks or hard screening flags exist',
    });
  }

  if (base != null && adj != null && Math.abs(adj - base) > 40) {
    out.push({
      code: 'large_delta',
      severity: 'warn',
      message: `Base vs adjusted delta ${adj - base} exceeds threshold (40)`,
    });
  }

  if (moderateCompliance && adj != null && adj >= 78 && decision === 'reject' && !hasHardFlag) {
    out.push({
      code: 'moderate_compliance_strong_adj_reject',
      severity: 'warn',
      message: 'Moderate compliance flags with strong operational score still rejected — confirm gate reasons',
    });
  }

  return out;
}
