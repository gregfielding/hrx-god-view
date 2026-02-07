/**
 * Persist scoreSummary.completenessScore and scoreSummary.aiScore from current profile.
 * Call after profile updates so the stored AI score stays in sync with the formula.
 */
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { calculateCompletenessScore } from './applicantScoring';
import {
  getScoreSummaryUpdateFromCompleteness,
  normalizeScoreSummary,
  type ScoreSummary,
} from './scoreSummary';

export async function persistScoreSummaryFromProfile(userId: string): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  const completeness = calculateCompletenessScore(data);
  const existingSummary = normalizeScoreSummary(data.scoreSummary) as ScoreSummary | undefined;
  const { completenessScore, aiScore } = getScoreSummaryUpdateFromCompleteness(
    completeness,
    existingSummary
  );
  await updateDoc(userRef, {
    'scoreSummary.completenessScore': completenessScore,
    'scoreSummary.aiScore': aiScore,
    'scoreSummary.aiScoreUpdatedAt': serverTimestamp(),
  });
}
