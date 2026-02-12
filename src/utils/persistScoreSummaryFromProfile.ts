/**
 * Persist scoreSummary from current profile using Hiring Score v1.1.
 * Formula: 0.60*Completeness + 0.25*Depth + 0.15*Reliability.
 * Call after profile updates so the stored Hiring Score stays in sync.
 */
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getScoreSummaryUpdateFromHiringScoreV1 } from './scoreSummary';

export async function persistScoreSummaryFromProfile(userId: string): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  const payload = getScoreSummaryUpdateFromHiringScoreV1(data);
  await updateDoc(userRef, {
    ...payload,
    'scoreSummary.aiScoreUpdatedAt': serverTimestamp(),
    'scoreSummary.hiringScoreComputedAt': serverTimestamp(),
  });
}
