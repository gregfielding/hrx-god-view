/**
 * Callable entry (HRX or server secret) + re-export of internal processor for triggers / automations.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { applyCategoryScoreEventInternal } from './applyCategoryScoreEventCore';
import type { ApplyCategoryScoreEventInput } from './categoryScoreEventTypes';
import type { CategoryScoreEventSourceV1 } from './categoryScoreEventTypes';
import { PREENSCREEN_CATEGORY_IDS, type PrescreenCategoryId } from './prescreenCategoryScoresParse';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function assertCanInvokeCategoryScoreProcessor(request: CallableRequest): void {
  const configured = process.env.CATEGORY_SCORE_EVENT_CALLABLE_SECRET;
  const body = request.data as Record<string, unknown> | undefined;
  const serverSecret = body?.serverSecret;
  if (configured && typeof serverSecret === 'string' && serverSecret === configured) {
    return;
  }
  const tok = request.auth?.token as Record<string, unknown> | undefined;
  const hrx = tok?.hrx === true || tok?.isHRX === true;
  if (hrx) return;
  throw new HttpsError(
    'permission-denied',
    'Not authorized to apply category score events (HRX claim or valid server secret required).',
  );
}

/**
 * Trusted path to record one category delta and update `users/{uid}.categoryScoresCurrent`.
 * Clients should not write to `category_score_events` directly; use this callable or internal API.
 */
export const applyCategoryScoreEvent = onCall(async (request) => {
  assertCanInvokeCategoryScoreProcessor(request);
  const d = request.data as Record<string, unknown>;
  const rawCd = d.categoryDeltas;
  let categoryDeltas: Partial<Record<PrescreenCategoryId, number>> | undefined;
  if (rawCd && typeof rawCd === 'object' && !Array.isArray(rawCd)) {
    categoryDeltas = {};
    for (const k of PREENSCREEN_CATEGORY_IDS) {
      const v = (rawCd as Record<string, unknown>)[k];
      if (v === undefined) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n !== 0) categoryDeltas[k] = n;
    }
    if (Object.keys(categoryDeltas).length === 0) categoryDeltas = undefined;
  }
  const input: ApplyCategoryScoreEventInput = {
    uid: String(d.uid ?? ''),
    ...(categoryDeltas
      ? { categoryDeltas }
      : {
          category: String(d.category ?? '') as PrescreenCategoryId,
          delta: Number(d.delta),
        }),
    source: String(d.source ?? '') as CategoryScoreEventSourceV1,
    idempotencyKey: String(d.idempotencyKey ?? ''),
    referenceId: d.referenceId == null || d.referenceId === undefined ? null : String(d.referenceId),
  };
  return applyCategoryScoreEventInternal(db, input);
});

export { applyCategoryScoreEventInternal } from './applyCategoryScoreEventCore';
export type { ApplyCategoryScoreEventInput, ApplyCategoryScoreEventResult, CategoryScoreEventSourceV1 } from './categoryScoreEventTypes';
export {
  CATEGORY_SCORE_EVENTS_COLLECTION,
  CATEGORY_SCORE_EVENT_KEYS_COLLECTION,
  CATEGORY_SCORE_EVENT_TALLIES_FIELD,
  CATEGORY_SCORE_INTERVIEW_APPLY_COUNT_FIELD,
  idempotencyKeyHash,
} from './applyCategoryScoreEventCore';
