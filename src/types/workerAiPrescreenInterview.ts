/**
 * Optional fields on users/{uid}/interviews/* when interviewKind === 'worker_ai_prescreen'.
 */

export type WorkerAiPrescreenInterviewKind = 'worker_ai_prescreen';

export type WorkerAiPrescreenRecommendation = 'proceed' | 'review' | 'caution' | 'decline';

export interface WorkerInterviewAiBlock {
  overallScore: number;
  recommendation: WorkerAiPrescreenRecommendation;
  flags: string[];
  subScores?: {
    experience?: number;
    reliability?: number;
    transportation?: number;
    risk?: number;
    physical?: number;
    /** Legacy shape from older scoring runs */
    fit?: number;
    compliance?: number;
  };
  summary?: string;
  model?: string;
  computedAt?: Date;
}
