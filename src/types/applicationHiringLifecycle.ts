/**
 * Optional hiring lifecycle snapshot on application documents (see docs/HIRING_LIFECYCLE_STATE_MACHINE.md).
 * Firestore may omit this until backfill; strings allow forward-compatible unknown values from newer backends.
 */
import type { HiringBlockerCode, HiringLifecycleStage, HiringNextAction } from '../shared/hiringLifecycleTypes';

export type { HiringBlockerCode, HiringLifecycleStage, HiringNextAction } from '../shared/hiringLifecycleTypes';

export type ApplicationHiringLifecycle = {
  stage?: HiringLifecycleStage | string;
  subStatus?: string;
  nextAction?: HiringNextAction | string;
  blockers?: (HiringBlockerCode | string)[];
  stageEnteredAt?: Record<string, string>;
  updatedAt?: string;
};
