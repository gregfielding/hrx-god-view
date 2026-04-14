import { isHiringLifecycleStage } from '../constants/hiringLifecycle';
import { normalizeApplicationStatus, type ApplicationStatus } from './applicationStatusNormalize';

/**
 * Recruiter job-order applicants: coarse lifecycle bucket for counts + table filter.
 * Prefer `hiringLifecycle.stage` when present; otherwise map canonical legacy status; else unknown/legacy.
 */
export type RecruiterLifecycleFilterBucket =
  | 'profile_incomplete'
  | 'interview_pending'
  | 'qualified'
  | 'review'
  | 'waitlisted'
  | 'other'
  | 'unknown_legacy';

export const RECRUITER_LIFECYCLE_BUCKET_ORDER: RecruiterLifecycleFilterBucket[] = [
  'profile_incomplete',
  'interview_pending',
  'qualified',
  'review',
  'waitlisted',
  'other',
  'unknown_legacy',
];

const BUCKET_KEY_SET = new Set<string>(RECRUITER_LIFECYCLE_BUCKET_ORDER);

/** Parse `?lifecycle=` for Applications tab deep links from Hiring. */
export function parseJobOrderApplicationsLifecycleParam(
  raw: string | null | undefined,
): RecruiterLifecycleFilterBucket | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = String(raw).trim().toLowerCase();
  return BUCKET_KEY_SET.has(t) ? (t as RecruiterLifecycleFilterBucket) : null;
}

export const RECRUITER_LIFECYCLE_BUCKET_LABELS: Record<RecruiterLifecycleFilterBucket, string> = {
  profile_incomplete: 'Profile incomplete',
  interview_pending: 'Interview pending',
  qualified: 'Qualified',
  review: 'Review',
  waitlisted: 'Waitlisted',
  other: 'Other lifecycle',
  unknown_legacy: 'Unknown / legacy',
};

/** Compact labels for count chips in recruiter tables. */
export const RECRUITER_LIFECYCLE_BUCKET_SHORT_LABELS: Record<RecruiterLifecycleFilterBucket, string> = {
  profile_incomplete: 'Profile',
  interview_pending: 'Interview',
  qualified: 'Qualified',
  review: 'Review',
  waitlisted: 'Waitlist',
  other: 'Other',
  unknown_legacy: 'Unknown',
};

const FOCUS = new Set<string>([
  'profile_incomplete',
  'interview_pending',
  'qualified',
  'review',
  'waitlisted',
]);

function stageStringToBucket(stage: string): RecruiterLifecycleFilterBucket {
  const s = stage.trim();
  if (!s) return 'unknown_legacy';
  if (FOCUS.has(s)) return s as RecruiterLifecycleFilterBucket;
  if (isHiringLifecycleStage(s)) return 'other';
  return 'other';
}

/**
 * Map canonical application status to a recruiter bucket when `hiringLifecycle.stage` is absent.
 * `null` means: treat as unknown/legacy (no confident mapping).
 */
function legacyStatusToBucket(canonical: ApplicationStatus | null): RecruiterLifecycleFilterBucket | null {
  if (canonical == null) return 'unknown_legacy';
  switch (canonical) {
    case 'under_review':
      return 'review';
    case 'interview':
      return 'interview_pending';
    case 'offer_pending':
      return 'qualified';
    case 'waitlisted':
      return 'waitlisted';
    case 'submitted':
      return null;
    case 'accepted':
    case 'rejected':
    case 'withdrawn':
      return 'other';
    default:
      return null;
  }
}

export type RecruiterLifecycleBucketInput = {
  hiringLifecycle?: { stage?: string } | null;
  applicationStatus?: string | null;
  /** Raw status on `applicationData` when present (e.g. before normalization in UI). */
  rawApplicationStatus?: string | null;
};

export function deriveRecruiterLifecycleBucket(input: RecruiterLifecycleBucketInput): RecruiterLifecycleFilterBucket {
  const stageRaw = input.hiringLifecycle?.stage;
  if (typeof stageRaw === 'string' && stageRaw.trim()) {
    return stageStringToBucket(stageRaw);
  }

  const raw = input.rawApplicationStatus ?? input.applicationStatus ?? 'submitted';
  const canonical = normalizeApplicationStatus(raw);
  const mapped = legacyStatusToBucket(canonical);
  if (mapped !== null) return mapped;
  return 'unknown_legacy';
}

export function countRecruiterLifecycleBuckets(
  rows: RecruiterLifecycleBucketInput[],
): Record<RecruiterLifecycleFilterBucket, number> {
  const initial = (): Record<RecruiterLifecycleFilterBucket, number> => ({
    profile_incomplete: 0,
    interview_pending: 0,
    qualified: 0,
    review: 0,
    waitlisted: 0,
    other: 0,
    unknown_legacy: 0,
  });
  const out = initial();
  for (const r of rows) {
    const b = deriveRecruiterLifecycleBucket(r);
    out[b] += 1;
  }
  return out;
}
