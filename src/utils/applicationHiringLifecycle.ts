import { isHiringLifecycleStage, isHiringNextAction, type HiringBlockerCode } from '../constants/hiringLifecycle';
import type { ApplicationHiringLifecycle } from '../types/applicationHiringLifecycle';

/**
 * Parse optional `hiringLifecycle` blob from a Firestore application document.
 * Unknown stage/nextAction strings are preserved for display; blockers list keeps known codes only.
 */
export function parseApplicationHiringLifecycle(raw: unknown): ApplicationHiringLifecycle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: ApplicationHiringLifecycle = {};

  if (typeof o.stage === 'string' && o.stage.trim()) {
    const s = o.stage.trim();
    out.stage = isHiringLifecycleStage(s) ? s : s;
  }

  if (typeof o.subStatus === 'string' && o.subStatus.trim()) {
    out.subStatus = o.subStatus.trim();
  }

  if (typeof o.nextAction === 'string' && o.nextAction.trim()) {
    const n = o.nextAction.trim();
    out.nextAction = isHiringNextAction(n) ? n : n;
  }

  if (Array.isArray(o.blockers) && o.blockers.length > 0) {
    const blockers = o.blockers
      .map((b) => (typeof b === 'string' ? b.trim() : ''))
      .filter((b) => b.length > 0);
    if (blockers.length) out.blockers = blockers as (HiringBlockerCode | string)[];
  }

  if (o.stageEnteredAt && typeof o.stageEnteredAt === 'object' && !Array.isArray(o.stageEnteredAt)) {
    out.stageEnteredAt = o.stageEnteredAt as Record<string, string>;
  }

  if (typeof o.updatedAt === 'string' && o.updatedAt.trim()) {
    out.updatedAt = o.updatedAt.trim();
  }

  if (
    out.stage == null &&
    out.nextAction == null &&
    !out.blockers?.length &&
    (out.subStatus == null || out.subStatus === '')
  ) {
    return undefined;
  }
  return out;
}
