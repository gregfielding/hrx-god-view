/**
 * Emits a one-time activity score when `users/{uid}` gains geocoded home coordinates.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { maybeEmitAddressGeocodedCategoryScore } from './activityCategoryScoreEmit';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** True when the user doc gains a finite home lat where none existed before (addressInfo or root). */
export function didUserGainGeocodedHomeLat(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): boolean {
  if (!after) return false;
  const prevAi = before && typeof before === 'object' ? (before.addressInfo as Record<string, unknown> | undefined) : undefined;
  const nextAi = after.addressInfo && typeof after.addressInfo === 'object' ? (after.addressInfo as Record<string, unknown>) : undefined;
  const prevLat =
    numOrUndef(prevAi?.homeLat) ??
    numOrUndef(prevAi?.latitude) ??
    numOrUndef(before?.homeLat as unknown) ??
    numOrUndef((before as { address?: { homeLat?: unknown } } | undefined)?.address?.homeLat);
  const nextLat =
    numOrUndef(nextAi?.homeLat) ??
    numOrUndef(nextAi?.latitude) ??
    numOrUndef(after.homeLat as unknown) ??
    numOrUndef((after as { address?: { homeLat?: unknown } }).address?.homeLat);
  if (prevLat != null && Number.isFinite(prevLat)) return false;
  return nextLat != null && Number.isFinite(nextLat);
}

export const syncActivityCategoryScoreOnUserGeocodeWrite = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const uid = event.params.uid as string;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    if (!after) return;
    if (!didUserGainGeocodedHomeLat(before, after)) return;
    try {
      await maybeEmitAddressGeocodedCategoryScore(db, { uid });
    } catch (err) {
      logger.error('activityCategoryScoreOnUserWrite.geocode_emit_failed', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
