/**
 * Single semantic writer for `entity_employments` lifecycle fields (`status`, `active`, `employmentState`,
 * hire/onboarding/termination timestamps). Triggers and callables should use these builders — not ad-hoc patches.
 */
import type * as admin from "firebase-admin";
import type { EmploymentStateV1 } from "../types/workforceStateV1";

export const STRONG_EMPLOYMENT_STATUSES = new Set(["terminated", "inactive", "blocked"]);

/** v1 `employmentState` mirrors whatever legacy `status` would be for this migration. */
export function employmentStateV1FromLegacyStatus(raw: string): EmploymentStateV1 {
  const s = String(raw || "").toLowerCase();
  if (s === "active") return "active";
  if (s === "inactive") return "inactive";
  if (s === "terminated") return "terminated";
  if (s === "blocked") return "blocked";
  return "onboarding";
}

export type EntityEmploymentAdminSettableStatus = "onboarding" | "active" | "inactive" | "terminated";

/**
 * Admin callable `updateEntityEmploymentStatus` — preserves existing product rules for timestamps and forcing active.
 */
export function buildAdminEntityEmploymentLifecyclePatch(args: {
  status: EntityEmploymentAdminSettableStatus;
  terminationReason?: string | null;
  now: admin.firestore.FieldValue;
}): Record<string, unknown> {
  const { status, terminationReason, now } = args;
  const updates: Record<string, unknown> = {
    status,
    active: status === "active",
    employmentState: employmentStateV1FromLegacyStatus(status),
    updatedAt: now,
  };
  if (status === "terminated" || status === "inactive") {
    updates.terminatedAt = now;
    if (terminationReason) updates.terminationReason = terminationReason;
  }
  if (status === "active") {
    updates.hiredAt = now;
    updates.onboardingCompletedAt = now;
  }
  return updates;
}

/**
 * Bootstrap / ensure path: new employment row in onboarding (not yet active).
 */
export function buildBootstrapOnboardingLifecyclePatch(): Record<string, unknown> {
  return {
    status: "onboarding",
    active: false,
    employmentState: "onboarding",
  };
}

export type EngineSyncLifecycleInput = {
  /** Lowercased `entity_employments.status` before this sync. */
  employmentStatusNowLower: string;
  /** Engine output: all required steps satisfied. */
  engineOnboardingComplete: boolean;
  serverTimestamp: admin.firestore.FieldValue;
};

/**
 * Lifecycle fragment for onboarding engine sync (merged with engine summary fields).
 * When status is strong (terminated / inactive / blocked), returns {} so onboarding sync does not
 * change lifecycle outputs.
 */
export function buildEngineSyncLifecycleFragment(input: EngineSyncLifecycleInput): Record<string, unknown> {
  const { employmentStatusNowLower, engineOnboardingComplete, serverTimestamp } = input;
  if (STRONG_EMPLOYMENT_STATUSES.has(employmentStatusNowLower)) {
    return {};
  }
  const nextStatus = engineOnboardingComplete ? "active" : "onboarding";
  const fragment: Record<string, unknown> = {
    status: nextStatus,
    active: engineOnboardingComplete,
    employmentState: employmentStateV1FromLegacyStatus(nextStatus),
  };
  if (engineOnboardingComplete && employmentStatusNowLower === "onboarding") {
    fragment.hiredAt = serverTimestamp;
    fragment.onboardingCompletedAt = serverTimestamp;
  }
  return fragment;
}
