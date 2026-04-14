/**
 * Firestore-safe hiringLifecycle payloads (no `undefined`; omit empty optional fields).
 * Shared by Cloud Functions and optionally the web client (CRA may mirror under `src/`).
 */

import type { HiringLifecycle, HiringLifecycleCore, HiringLifecycleStage, HiringNextAction } from './hiringLifecycleTypes';
import { HIRING_LIFECYCLE_STAGES, HIRING_NEXT_ACTIONS } from './hiringLifecycleTypes';

const _stageSet = new Set<string>(HIRING_LIFECYCLE_STAGES);
const _nextSet = new Set<string>(HIRING_NEXT_ACTIONS);

function isHiringLifecycleStage(value: string): boolean {
  return _stageSet.has(value);
}

function isHiringNextAction(value: string): boolean {
  return _nextSet.has(value);
}

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

/** Read previous core fields from an application document for timestamp merges. */
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
    stage: stage as HiringLifecycleStage,
    subStatus,
    blockers: blockers?.length ? blockers : undefined,
    nextAction: nextAction as HiringNextAction | undefined,
  };
}
