/**
 * Illinois AI-in-hiring definitions (Greg 2026-09-10). Byte-identical in
 * shared/ and src/shared/ — edit both.
 *
 * Postings whose worksite is in Illinois show applicants an AI-use notice
 * before the prescreen, let them ask for a recruiter review or an
 * accommodation, and invite voluntary self-identification that feeds the
 * admin-only AI hiring monitor. Codes are stored; each client localizes the
 * labels.
 */

export const RACE_ETHNICITY_CODES = [
  'hispanic_latino',
  'white',
  'black_african_american',
  'asian',
  'american_indian_alaska_native',
  'native_hawaiian_pacific_islander',
  'two_or_more',
  'decline',
] as const;
export type RaceEthnicityCode = (typeof RACE_ETHNICITY_CODES)[number];

export const SEX_CODES = ['male', 'female', 'nonbinary', 'decline'] as const;
export type SexCode = (typeof SEX_CODES)[number];

export type RecruiterReviewRequestKind = 'review' | 'accommodation';

/**
 * Bump when the notice copy changes materially so workers acknowledge it again
 * (users/{uid}.aiHiringNotice.version; the Flutter app uses the same value).
 */
export const AI_HIRING_NOTICE_VERSION = 'il-ai-notice-2026-09';

/** Worksite state for a posting or job order: top-level `state`, then the worksite address. */
export function postingStateCode(posting: Record<string, unknown> | null | undefined): string {
  if (!posting) return '';
  const addr = (posting.worksiteAddress ?? {}) as Record<string, unknown>;
  const raw = String(posting.state ?? addr.state ?? '').trim().toUpperCase();
  return raw === 'ILLINOIS' ? 'IL' : raw;
}

export const isIllinoisPosting = (posting: Record<string, unknown> | null | undefined): boolean =>
  postingStateCode(posting) === 'IL';
