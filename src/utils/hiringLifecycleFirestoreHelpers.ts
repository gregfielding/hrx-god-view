import type { HiringLifecycle, HiringLifecycleCore } from '../shared/hiringLifecycleTypes';
import { isHiringLifecycleStage, isHiringNextAction } from '../constants/hiringLifecycle';

/**
 * Omit undefined recursively so Firestore writes never include `undefined` (SDK rejects).
 */
export function firestoreSafeHiringLifecycle(h: HiringLifecycle): Record<string, unknown> {
  const o: Record<string, unknown> = {
    stage: h.stage,
  };
  if (h.subStatus != null && String(h.subStatus).trim() !== '') o.subStatus = h.subStatus;
  if (h.blockers != null && h.blockers.length > 0) o.blockers = h.blockers;
  if (h.nextAction != null) o.nextAction = h.nextAction;
  if (h.stageEnteredAt != null && Object.keys(h.stageEnteredAt).length > 0) o.stageEnteredAt = h.stageEnteredAt;
  if (h.updatedAt != null) o.updatedAt = h.updatedAt;
  return o;
}

/** Read previous core fields from an application document snapshot for timestamp merges. */
export function hiringLifecycleCoreFromApplicationData(data: Record<string, unknown> | undefined): HiringLifecycleCore | null {
  const hl = data?.hiringLifecycle;
  if (!hl || typeof hl !== 'object') return null;
  const o = hl as Record<string, unknown>;
  const stage = o.stage;
  if (typeof stage !== 'string' || !isHiringLifecycleStage(stage)) return null;
  const nextRaw = o.nextAction;
  const nextAction =
    typeof nextRaw === 'string' && isHiringNextAction(nextRaw) ? nextRaw : undefined;
  const blockers = Array.isArray(o.blockers) ? (o.blockers as string[]).filter((x) => typeof x === 'string') : undefined;
  const subStatus = typeof o.subStatus === 'string' ? o.subStatus : undefined;
  return {
    stage,
    subStatus,
    blockers: blockers?.length ? blockers : undefined,
    nextAction,
  };
}
