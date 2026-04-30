import type { ScoreSummary } from '../utils/scoreSummary';

/**
 * Row shape for recruiter Users list and shared Applicants (Users-style) columns.
 */
export interface RecruiterUser {
  id: string;
  firstName: string;
  lastName: string;
  /** Profile display name when present (search + fallback when first/last missing). */
  displayName?: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  avatar?: string;
  securityLevel: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
  scoreSummary?: ScoreSummary;
  lastLoginAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  aiProfileScore?: number;
  aiJobFitScore?: number;
  userGroupIds: string[];
  skills: string[];
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean; attestedAt?: unknown };
  /** Apply flow / profile — used by Documented (E-Verify) column */
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string };
  /** Firestore `resume` map — used for inline resume link in Person column */
  resume?: Record<string, unknown> | null;
  addedToIndeedFlex?: boolean;
  addedToFieldglass?: boolean;
  /** Screening / payroll — readiness breakdown (same shape as profile credentials) */
  eVerifyOrders?: Array<{
    status?: string;
    result?: string;
    dateSubmitted?: string;
    completionDate?: string;
    dateOrdered?: string;
  }>;
  backgroundCheckOrders?: Array<{
    status?: string;
    result?: string;
    dateOrdered?: string;
    completionDate?: string;
  }>;
  /** Structured AI + compliance risk layer */
  riskProfile?: unknown;
  /** Canonical recruiter score — single UI source when present */
  recruiterScoreSnapshot?: unknown;
  /** Blended Master Recruiter Score (preferred headline). */
  recruiterMasterScore?: unknown;
  /** Twilio / Firestore verification */
  phoneVerified?: boolean;
  /** Set when worker AI prescreen interview completes — list interview UX must not rely only on scoreSummary aggregates */
  hasWorkerAiPrescreenInterview?: boolean;
  interviewStatus?: string;
  lastInterviewCompletedAt?: unknown;
  /** Last time a recruiter triggered the "Order Interview" SMS from the profile / list. */
  recruiterOrderInterviewSmsLastSentAt?: unknown;
  /** Job titles from work experience (most recent first), for Users-style tables */
  workHistoryJobTitles?: string[];
}
