import type { HomeReadinessLaunchStep } from '../components/worker/home/types';

export type ReadinessChecklistPriority = 'required' | 'high_impact' | 'optional';
export type ReadinessChecklistStatus = 'missing' | 'in_progress' | 'complete' | 'recommended';

export interface FirestoreReadinessChecklistItem {
  id: string;
  title: string;
  benefit: string;
  priority: ReadinessChecklistPriority;
  status: ReadinessChecklistStatus;
  launchStep: HomeReadinessLaunchStep;
  weight: number;
  industries: Array<'hospitality' | 'industrial'>;
  relevanceScore: number;
  sortOrder: number;
  completedAt?: unknown;
}

export interface FirestoreReadinessScoring {
  readinessPercent: number;
  completedCount: number;
  requiredCount: number;
  totalWeight: number;
  completedWeight: number;
  industryContext: Array<'hospitality' | 'industrial'>;
}

export interface FirestoreReadinessSnapshotV1 {
  version: 1;
  updatedAt?: unknown;
  scoring: FirestoreReadinessScoring;
  checklist: FirestoreReadinessChecklistItem[];
  orderedNextStepIds: string[];
}

export interface HomeReadinessViewModel {
  readinessPercent: number;
  completedCount: number;
  requiredCount: number;
  orderedChecklist: FirestoreReadinessChecklistItem[];
  orderedNextStepIds: string[];
  source: 'computed' | 'snapshot';
}
