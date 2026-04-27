/**
 * Client-side display normalization for risk summaries (legacy rows + edge cases).
 * Keep aligned with `functions/src/workerAiPrescreen/riskSummaryNormalize.ts`.
 */

const SNAKE_PHRASES: Record<string, string> = {
  moderate_flags_present: 'Moderate flags present',
  risk_admission_detected: 'Risk admission noted',
  recommendation_decline: 'Review recommended',
  recommendation_review: 'Review recommended',
  vague_response: 'Thin interview answers',
  low_effort_response: 'Low-effort interview answers',
  attendance_risk: 'Attendance concern',
  background_unknown: 'Background check unclear',
  drug_unknown: 'Drug screening unclear',
};

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeOperationalRiskSummary(raw: string): string {
  const trimmed = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (SNAKE_PHRASES[lower]) return SNAKE_PHRASES[lower];
  if (/^[a-z0-9_]+$/.test(trimmed) && trimmed.includes('_')) {
    return titleCaseWords(trimmed.replace(/_/g, ' '));
  }
  if (trimmed.length > 160) return `${trimmed.slice(0, 157)}…`;
  return trimmed;
}
