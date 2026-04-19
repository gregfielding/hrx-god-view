import type { ScoreSummary } from '../scoreSummary';
import type { UserListEntityOnboardingItem } from '../userListEntityEmploymentStatus';
import type { EntityEmploymentActionSignal } from './entitySignalsFromEmploymentDocs';

/**
 * Everything needed to derive Action Items v1 on the profile Overview without extra Firestore reads.
 */
export type ActionItemsV1Input = {
  uid: string;
  enabled: boolean;
  phoneVerified: boolean;
  phone: string;
  /** True when an interview exists (header-grade signal from parent + scoreSummary). */
  hasInterview: boolean;
  workAuthorized: boolean;
  scoreSummary: ScoreSummary | undefined | null;
  riskProfileRaw: unknown;
  entityItems: UserListEntityOnboardingItem[];
  entitySignals: EntityEmploymentActionSignal[];
  backgroundCheckOrders: Array<{ id: string; status: string; result?: string; typeLabel?: string }>;
  /** Raw certification entries from user doc */
  certifications: unknown[];
  /**
   * Set false until the user doc has hydrated (first snapshot). Avoids “missing interview”
   * before scoreSummary / header interview signals exist.
   */
  actionSignalsReady?: boolean;
};
