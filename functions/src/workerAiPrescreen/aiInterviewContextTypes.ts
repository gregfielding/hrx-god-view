/**
 * Context + extended outcome shapes for context-aware worker AI pre-screen.
 * Aligned with `AI_PRESCREEN_CONTEXT_AND_DYNAMIC_QUESTIONING.md`.
 */

import type { ResolvedAiPrescreenTenantPolicy } from './aiPrescreenJobSlice';
import type { HiringPolicyBundle } from './aiHiringPolicyResolution';

export type AiInterviewContext = {
  worker: {
    userId: string;
    hasResume: boolean;
    workHistoryCount: number;
    phone: boolean;
    location: {
      city?: string;
      state?: string;
      zip?: string;
    };
  };

  entity: {
    entityId: string;
    entityName: string;
    workerType: 'W2' | '1099';
    requiresDrugScreen: boolean;
    requiresBackgroundCheck: boolean;
    requiresEVerify: boolean;
  };

  assignment?: {
    /** Jobs board posting id (same as `sources.jobPostingId`). */
    jobId: string;
    /** Job order id when resolved (same as `sources.jobOrderId`). */
    jobOrderId?: string | null;
    title: string;
    startTime?: string;
    days?: string[];
    location?: string;
    requiresDrugScreen?: boolean;
    requiresBackgroundCheck?: boolean;
    physicalRequirements?: string[];
    certificationsRequired?: string[];
    uniformRequirements?: string[];
  };

  /**
   * Profile-level gaps only (e.g. phone, location)—not assignment/readiness snapshot.
   * `hasOpenScreening` is always false for prescreen; kept for stored shape compatibility.
   */
  readiness: {
    missingRequirements: string[];
    hasOpenScreening: boolean;
  };

  businessRules?: {
    allowGigPath?: boolean;
    tenant?: string;
    /** Resolved `aiPrescreen` (tenant + optional posting merge). */
    aiPrescreen?: ResolvedAiPrescreenTenantPolicy;
  };

  /** Resolved hiring container + `aiHiring` (tenant → job order | group). No automation yet. */
  hiringPolicy?: HiringPolicyBundle;

  /** Resolved document ids used for this context (analytics / support). */
  sources?: {
    jobPostingId?: string;
    jobOrderId?: string | null;
  };
};

export type AssignmentReadinessStatus = 'ready' | 'review' | 'blocked';

export type PrescreenAssignmentReadiness = {
  status: AssignmentReadinessStatus;
  reasons: string[];
};

export type PrescreenAlternatePaths = {
  gigEligible?: boolean;
};

export type DynamicPrescreenModule =
  | 'shift'
  | 'location'
  | 'compliance_drug'
  | 'compliance_background'
  | 'physical'
  | 'certification'
  | 'uniform'
  | 'gig_path';

export type DynamicPrescreenStep = {
  id: string;
  type: 'single_select';
  /** English fallback (e.g. logs, older clients). */
  prompt: string;
  /** Worker portal i18n key (e.g. `workerAiPrescreen.dynamic.dyn_shift_punctuality`). */
  promptKey?: string;
  promptParams?: Record<string, string | number>;
  options: { value: string; label: string }[];
  module: DynamicPrescreenModule;
};
