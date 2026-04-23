/**
 * Phase 7 gate — automation readiness for cert engine vs legacy shadow parity.
 *
 * Before enabling automation:
 * - `mismatchRate` should stay under **5–10%** over a representative window.
 * - **No** high-volume unmapped strings (top unmapped should tail off after alias work).
 * - Critical catalog types (**forklift**, **food handler**, etc.) must not dominate mismatch lists.
 *
 * If any fail: extend manifest aliases, map `requiredCertificationComplianceIds` → catalog, or fix adapters — not automation.
 */
export const CERT_SHADOW_AUTOMATION_MISMATCH_RATE_MAX = 0.1;

export function certificationShadowMeetsAutomationThreshold(stats: {
  mismatchRate: number;
  totalEvents: number;
  topUnmappedStrings: Array<{ count: number }>;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (stats.totalEvents < 30) {
    reasons.push('insufficient_events (need a larger sample, e.g. 30+)');
  }
  if (stats.mismatchRate > CERT_SHADOW_AUTOMATION_MISMATCH_RATE_MAX) {
    reasons.push(`mismatch_rate ${(stats.mismatchRate * 100).toFixed(1)}% exceeds ${CERT_SHADOW_AUTOMATION_MISMATCH_RATE_MAX * 100}% cap`);
  }
  const topUnmapped = stats.topUnmappedStrings[0]?.count ?? 0;
  if (topUnmapped >= 20 && stats.totalEvents >= 50) {
    reasons.push('high_volume_unmapped_string — top unmapped count is very large relative to sample');
  }
  return { ok: reasons.length === 0, reasons };
}
