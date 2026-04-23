/**
 * Canonical recruiter Master Score read path — prefers persisted `users.recruiterMasterScore`, else computes client-side.
 */

import {
  computeRecruiterMasterScore,
  type RecruiterMasterScore,
} from '../../shared/recruiterMasterScore';
import { parseRecruiterScoreSnapshot } from './recruiterScoreSnapshot';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import { recruiterTableLetterGrade } from '../recruiterUsersReadinessDisplay';

function mapInterviewAiToPrescreenRecord(ai: WorkerInterviewAiBlock | null | undefined): Record<string, unknown> | null {
  if (!ai || typeof ai !== 'object') return null;
  return { ...ai } as Record<string, unknown>;
}

export function parseRecruiterMasterScore(raw: unknown): RecruiterMasterScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 'v1') return null;
  const s = o.score100;
  const g = o.grade;
  if (g !== 'A' && g !== 'B' && g !== 'C' && g !== 'D' && g !== 'E' && g !== 'N/A' && g !== 'F') return null;
  if (g === 'N/A') {
    if (s != null && (typeof s !== 'number' || !Number.isFinite(s))) return null;
  } else if (typeof s !== 'number' || !Number.isFinite(s)) return null;
  return o as unknown as RecruiterMasterScore;
}

export type RecruiterMasterDisplayPack = {
  score100: number | null;
  grade: string | null;
  confidence: string | null;
  riskLevel: string | null;
  summary: string | null;
  master: RecruiterMasterScore | null;
  /** True when master was computed in-memory (persisted field missing or invalid). */
  computedFallback: boolean;
};

/**
 * Single entry for recruiter table, header, overview — same numbers everywhere.
 */
export function getRecruiterMasterDisplayForAdminUi(args: {
  recruiterMasterScoreRaw?: unknown;
  recruiterScoreSnapshotRaw?: unknown;
  /** Firestore user fields for client-side blend when master not persisted yet. */
  userData?: Record<string, unknown> | null;
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  prescreenTransportationPlan?: string | null;
}): RecruiterMasterDisplayPack {
  const persisted = parseRecruiterMasterScore(args.recruiterMasterScoreRaw);
  if (persisted) {
    const noScore = persisted.grade === 'N/A' || persisted.score100 == null;
    return {
      score100: noScore ? null : Math.round(persisted.score100 as number),
      grade: persisted.grade,
      confidence: persisted.confidence,
      riskLevel: persisted.riskLevel,
      summary: persisted.summary ?? null,
      master: persisted,
      computedFallback: false,
    };
  }

  const ud = args.userData;
  if (ud && typeof ud === 'object') {
    const snap = parseRecruiterScoreSnapshot(args.recruiterScoreSnapshotRaw);
    const snapCats = snap?.categoryScores && typeof snap.categoryScores === 'object' ? snap.categoryScores : null;
    const prescreenAi = mapInterviewAiToPrescreenRecord(args.latestPrescreenInterviewAi ?? undefined);
    const m = computeRecruiterMasterScore({
      userData: ud,
      prescreenAi,
      snapshotCategoryScores: snapCats,
      prescreenTransportationPlan: args.prescreenTransportationPlan ?? null,
    });
    const noScore = m.grade === 'N/A' || m.score100 == null;
    return {
      score100: noScore ? null : Math.round(m.score100 as number),
      grade: m.grade,
      confidence: m.confidence,
      riskLevel: m.riskLevel,
      summary: m.summary ?? null,
      master: m,
      computedFallback: true,
    };
  }

  return {
    score100: null,
    grade: null,
    confidence: null,
    riskLevel: null,
    summary: null,
    master: null,
    computedFallback: false,
  };
}

/** Letter grade for master score — same bands as recruiter table (90=A … &lt;60=E). */
export function masterScoreToGrade(score100: number | null | undefined): string {
  if (score100 == null || !Number.isFinite(score100)) return '—';
  return recruiterTableLetterGrade(Math.round(Math.max(0, Math.min(100, score100))));
}
