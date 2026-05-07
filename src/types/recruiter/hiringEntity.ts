/**
 * HiringEntity — TypeScript interface for `tenants/{tid}/entities/{entityId}`.
 *
 * This file is the first formal definition of `HiringEntity` in the codebase
 * even though `hiringEntityId` has been referenced by ~50 modules
 * (PlacementsTab, RecruiterAccountDetails, evereeService, syncHiringEntityFromNationalAccount,
 * onJobOrderStatusTransitionSnapshot, etc.). Created as part of the TS.1
 * timesheet build because the new `payPeriodPolicy` field needs a typed home,
 * and bolting it onto an `any`-typed entity doc would defeat the purpose of
 * the rest of TS.1 being strictly typed.
 *
 * Add new fields here as we formalize the entity doc — this is intentionally
 * narrow today and only covers the fields TS.1 needs to read or write. Fields
 * that already live on entity docs but aren't consumed by TS.1 are
 * intentionally omitted (add them as you encounter them in other features).
 */

import { FieldValue } from 'firebase/firestore';

/** Worker classification used by Everee + downstream payroll. */
export type HiringEntityWorkerType = 'W2' | '1099' | 'mixed';

/**
 * Pay-period policy — drives the default date selection in
 * `<PeriodPicker />` on `/timesheets`. C1 Events LLC pays per event/per day
 * (manual dates entity-wide, auto-resolved when loaded inside a Shift or
 * JO scope). All other entities default to weekly Sun–Sat.
 *
 * `weekStartDOW` / `weekEndDOW` use 0=Sun..6=Sat. They're required when
 * `policyType === 'weekly'` — `<PeriodPicker />` falls back to Sun-Sat
 * if either is missing, but recruiters should always set them explicitly.
 */
export type PayPeriodPolicyType = 'per_event' | 'weekly';

export interface PayPeriodPolicy {
  policyType: PayPeriodPolicyType;
  weekStartDOW?: number;
  weekEndDOW?: number;
  description?: string;
}

/**
 * Payroll provider configuration. Mirrors the existing untyped object
 * already attached to entity docs in production. Listed here so TS.1
 * code paths can read it without `any`.
 */
export interface HiringEntityPayrollSettings {
  provider: 'tempworks' | 'everee' | 'manual';
  mode: 'portal_link_only' | 'manual_tracking' | 'integrated';
  onboardingUrl: string | null;
  portalUrl: string | null;
}

/**
 * The hiring entity document shape — `tenants/{tid}/entities/{entityId}`.
 * All fields except `id`, `tenantId`, `name`, and `workerType` are
 * optional because legacy entity docs predate most of these and may not
 * have been backfilled.
 */
export interface HiringEntity {
  id: string;
  tenantId: string;
  name: string;
  workerType: HiringEntityWorkerType;

  /** Everee approval-group id, set during entity onboarding into Everee. */
  evereeApprovalGroupId?: number;
  /** Name of the Everee Embed event handler this entity uses. */
  evereeEmbedEventHandlerName?: string;

  payrollSettings?: HiringEntityPayrollSettings;

  /** TS.1 — drives `<PeriodPicker />` default dates on `/timesheets`. */
  payPeriodPolicy?: PayPeriodPolicy;

  createdAt?: Date | FieldValue;
  updatedAt?: Date | FieldValue;
}
