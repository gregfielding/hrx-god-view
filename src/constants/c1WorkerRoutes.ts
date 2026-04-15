/** Worker C1 shell — stable paths for cross-links (Employment ↔ Screening). */
export const C1_WORKER_SCREENING_PATH = '/c1/workers/screening';

/** Worker self-serve AI pre-screen questionnaire (writes via callable). */
export const C1_WORKER_AI_PRESCREEN_PATH = '/c1/workers/prescreen';

/** Work eligibility / US work authorization attestation (`profileSection.tsx` → `work-authorization`). */
export const C1_WORKER_WORK_AUTHORIZATION_PROFILE_PATH = '/c1/workers/profile/work-authorization';

/** My Employment list — safe link when a specific `entity_employments` doc id is unknown. */
export const C1_WORKER_MY_EMPLOYMENT_LIST_PATH = '/c1/workers/my-employment';
