/**
 * Firestore field payload for Hiring Score v1.1 — shared by app and Cloud Functions (repair scripts).
 */
import { computeHiringScoreInputSignature, computeHiringScoreV1 } from './hiringScoreV1';

export function getScoreSummaryUpdateFromHiringScoreV1(userDoc: any): {
  'scoreSummary.aiScore': number;
  'scoreSummary.completenessScore': number;
  'scoreSummary.components': {
    completeness: number;
    depth: number;
    reliability: number;
  };
  'scoreSummary.explainability': {
    missingFields?: string[];
    nextActions?: { label: string; priority?: number }[];
  };
  'scoreSummary.hiringScoreVersion': 'v1.1';
  'scoreSummary.hiringScoreComputedAt': Date;
  'scoreSummary.aiScoreUpdatedAt': Date;
  'scoreSummary.hiringScoreInputSignature': string;
} {
  const result = computeHiringScoreV1(userDoc);
  return {
    'scoreSummary.aiScore': result.score,
    'scoreSummary.completenessScore': result.components.completeness,
    'scoreSummary.components': result.components,
    'scoreSummary.explainability': result.explainability,
    'scoreSummary.hiringScoreVersion': 'v1.1',
    'scoreSummary.hiringScoreComputedAt': result.computedAt,
    'scoreSummary.aiScoreUpdatedAt': result.computedAt,
    'scoreSummary.hiringScoreInputSignature': computeHiringScoreInputSignature(userDoc),
  };
}
