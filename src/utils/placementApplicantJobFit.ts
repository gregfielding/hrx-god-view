/**
 * Per-application job match score for Placements worker tiles (same job/posting context as the tab).
 * Source: `applications/{id}.jobScoreSummary` (v1 `jobScore` or legacy `fitScore` / `jobScore`).
 */

export function pickJobScoreFromApplicationData(data: Record<string, unknown>): number | undefined {
  const js = data.jobScoreSummary as Record<string, unknown> | undefined;
  if (!js || typeof js !== 'object') return undefined;
  if (js.version === 'v1' && typeof js.jobScore === 'number' && Number.isFinite(js.jobScore)) {
    return js.jobScore;
  }
  if (typeof js.jobScore === 'number' && Number.isFinite(js.jobScore)) return js.jobScore;
  if (typeof js.fitScore === 'number' && Number.isFinite(js.fitScore)) return js.fitScore;
  return undefined;
}

/** When a user has multiple applications for this job, keep the best (max) job score. */
export function buildPlacementJobFitMap(
  applicationDocs: Array<{ id: string; data: Record<string, unknown> }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const { data } of applicationDocs) {
    const uid = String(data.userId || '').trim();
    if (!uid) continue;
    const score = pickJobScoreFromApplicationData(data);
    if (score == null) continue;
    const prev = m.get(uid);
    if (prev == null || score > prev) m.set(uid, score);
  }
  return m;
}
