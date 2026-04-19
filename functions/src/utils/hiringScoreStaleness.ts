/**
 * Operational staleness for `users.{uid}.scoreSummary.aiScore` (mirror of riskProfile staleness pattern).
 * Compares meaningful input timestamps vs `scoreSummary.aiScoreUpdatedAt`.
 *
 * Kept in `functions/src/utils/` so Cloud Functions `tsc` (rootDir: src) resolves without importing the web app tree.
 * Align with `src/utils/hiringScoreStaleness.ts` in the repo root when changing logic.
 */

export type HiringScoreStalenessLabel = 'missing' | 'stale' | 'fresh';

function toMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (ts as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (ts instanceof Date) {
    const t = ts.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return Number.isNaN(p) ? null : p;
  }
  if (typeof ts === 'object') {
    const o = ts as { _seconds?: number };
    if (typeof o._seconds === 'number') return o._seconds * 1000;
  }
  return null;
}

/**
 * - **missing** — no finite `scoreSummary.aiScore`, or no `aiScoreUpdatedAt` to compare.
 * - **stale** — max(`user.updatedAt`, latest interview, `categoryScoresCurrentUpdatedAt`) > `aiScoreUpdatedAt`.
 * - **fresh** — otherwise.
 */
export function computeHiringScoreStaleness(userDoc: Record<string, unknown>): HiringScoreStalenessLabel {
  const ss = userDoc.scoreSummary as Record<string, unknown> | undefined;
  const aiScore = ss?.aiScore;
  const hasAi = typeof aiScore === 'number' && Number.isFinite(aiScore);
  if (!hasAi) return 'missing';

  const aiUp = toMillis(ss?.aiScoreUpdatedAt);
  if (aiUp == null) return 'missing';

  const candidates: number[] = [];
  const u = toMillis(userDoc.updatedAt);
  if (u != null) candidates.push(u);

  const interviewLast = toMillis(ss?.interviewLastAt);
  if (interviewLast != null) candidates.push(interviewLast);

  const cat = toMillis(userDoc.categoryScoresCurrentUpdatedAt);
  if (cat != null) candidates.push(cat);

  if (candidates.length === 0) return 'fresh';

  const maxInput = Math.max(...candidates);
  return maxInput > aiUp + 1 ? 'stale' : 'fresh';
}
