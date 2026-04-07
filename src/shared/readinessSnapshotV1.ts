/**
 * Persisted HRX V1 readiness snapshot on `tenants/{tid}/assignments/{id}.readinessSnapshotV1`.
 * Cross-app contract (e.g. Flutter) — separate from `assignmentReadinessV1` (onboarding/package sync).
 */

import type {
  BuildAssignmentReadinessResult,
  OverallReadinessState,
  ReadinessCategory,
  ReadinessRequirement,
  ReadinessRequirementStatus,
  ReadinessSeverity,
} from './buildAssignmentReadiness';

export const READINESS_SNAPSHOT_V1_SOURCE_VERSION = 1;

export type ReadinessSnapshotV1Requirement = {
  key: string;
  label: string;
  category: ReadinessCategory;
  status: ReadinessRequirementStatus;
  severity: ReadinessSeverity;
};

/** Firestore document shape (`updatedAt` = `serverTimestamp()` at write time). */
export type ReadinessSnapshotV1Firestore = {
  state: OverallReadinessState;
  sourceVersion: number;
  summary: {
    blockers: number;
    warnings: number;
    completed: number;
  };
  requirements: ReadinessSnapshotV1Requirement[];
  updatedAt?: unknown;
};

/** Serializable payload for comparisons (no timestamps). */
export type ReadinessSnapshotV1Comparable = {
  state: OverallReadinessState;
  sourceVersion: number;
  summary: { blockers: number; warnings: number; completed: number };
  requirements: ReadinessSnapshotV1Requirement[];
};

export function buildReadinessSnapshotV1Comparable(result: BuildAssignmentReadinessResult): ReadinessSnapshotV1Comparable {
  return {
    state: result.readiness,
    sourceVersion: READINESS_SNAPSHOT_V1_SOURCE_VERSION,
    summary: { ...result.summary },
    requirements: result.requirements.map(requirementToSnapshotRow),
  };
}

export function requirementToSnapshotRow(r: ReadinessRequirement): ReadinessSnapshotV1Requirement {
  return {
    key: r.key,
    label: r.label,
    category: r.category,
    status: r.status,
    severity: r.severity,
  };
}

export function readinessSnapshotV1ComparableJson(c: ReadinessSnapshotV1Comparable): string {
  return JSON.stringify(c);
}
