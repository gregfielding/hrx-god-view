/**
 * Compact orchestrator snapshot for recruiter tooltips (not a primary status label).
 */
export function formatAiAutomationRecruiterTooltip(data: Record<string, unknown> | undefined | null): string | null {
  if (!data || typeof data !== 'object') return null;
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  const v1 = aa?.orchestratorV1 as Record<string, unknown> | undefined;
  if (!v1 || typeof v1 !== 'object') return null;
  const final = v1.finalResult as Record<string, unknown> | undefined;
  const policyEngine = v1.policyEngineResult as Record<string, unknown> | undefined;
  const fr =
    final && typeof final.decision === 'string'
      ? final
      : policyEngine && typeof policyEngine.decision === 'string'
        ? policyEngine
        : final ?? policyEngine;
  const decRaw = fr && typeof fr.decision === 'string' ? fr.decision : '';
  if (!decRaw) return null;
  const reasonCodes = Array.isArray(fr?.reasonCodes)
    ? (fr!.reasonCodes as unknown[]).map((x) => String(x))
    : [];
  const parts = [`decision=${decRaw}`];
  if (reasonCodes.length) parts.push(`reasons: ${reasonCodes.join(', ')}`);
  return parts.join(' · ');
}
