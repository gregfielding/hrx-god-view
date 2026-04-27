export type HomeReadinessLaunchStep =
  | 'start'
  | 'profile_photo'
  | 'resume'
  | 'education'
  | 'work_authorization'
  | 'certifications'
  | 'skills'
  | 'work_experience';

export type HomeChecklistItemStatus = 'missing' | 'in_progress' | 'complete' | 'recommended';
export type HomeChecklistItemPriority = 'required' | 'high_impact' | 'optional';

export interface HomeChecklistItem {
  id: string;
  title: string;
  benefit: string;
  status: HomeChecklistItemStatus;
  priority: HomeChecklistItemPriority;
  launchStep: HomeReadinessLaunchStep;
}

export interface ReadinessSummaryCardData {
  readinessPercent: number;
  completedCount: number;
  requiredCount: number;
}
