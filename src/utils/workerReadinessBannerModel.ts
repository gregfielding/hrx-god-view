import type { EmploymentEntityKey, EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerReadinessV1Snapshot } from '../hooks/useWorkerReadinessV1';
import type { WorkerState } from '../types/workforceStateV1';
import { EMPLOYMENT_ENTITY_KEYS, entityLabelForKey } from './employmentEntityPresentation';

export const EMPLOYMENT_V2_ANCHOR_ONBOARDING = 'employment-v2-section-onboarding';
/** Scroll target for Readiness → Employment (I-9 / work authorization). */
export const EMPLOYMENT_I9_SECTION_ELEMENT_ID = 'employment-i9-section';
/** @deprecated Assignment readiness moved to the Assignments tab; banner scroll targets relationship onboarding only. */
export const EMPLOYMENT_V2_ANCHOR_ASSIGNMENT = 'employment-v2-section-assignment';

/** Max bullets in the banner after prioritization / dedupe. */
export const WORKER_READINESS_BANNER_MAX_LINES = 4;

const PROFILE_BLOCKING_LABELS: Record<string, string> = {
  confirm_date_of_birth: 'Confirm date of birth (worker profile)',
  verify_phone_number: 'Verify phone number (worker profile)',
};

/** Profile gates outrank in-Employment work; assignment package blockers outrank generic onboarding pending. */
const PROFILE_ID_PRIORITY: Record<string, number> = {
  confirm_date_of_birth: 1000,
  verify_phone_number: 980,
};

type BannerCandidate = {
  priority: number;
  /** `null` = not tied to a hiring-entity tab (profile gates). */
  entityKey: EmploymentEntityKey | null;
  section: 'onboarding' | 'assignment';
  line: string;
  dedupeKey: string;
};

function positiveHeadlineForState(state: WorkerState | null): string {
  switch (state) {
    case 'active':
      return 'Ready and working';
    case 'ready_for_placement':
      return 'Ready for assignment';
    case 'onboarding_in_progress':
      return 'Onboarding in progress';
    case 'profile_incomplete':
      return 'Profile incomplete';
    case 'blocked':
      return 'Blocked';
    case 'inactive':
      return 'Inactive';
    case 'terminated':
      return 'Not eligible (terminated)';
    case 'applicant':
      return 'Applicant';
    default:
      return 'Workforce readiness';
  }
}

function stateSeverity(state: WorkerState | null): 'success' | 'info' | 'warning' | 'error' {
  switch (state) {
    case 'active':
    case 'ready_for_placement':
      return 'success';
    case 'onboarding_in_progress':
      return 'warning';
    case 'profile_incomplete':
      return 'warning';
    case 'blocked':
    case 'terminated':
      return 'error';
    case 'inactive':
      return 'info';
    case 'applicant':
      return 'info';
    default:
      return 'info';
  }
}

function profilePriority(id: string): number {
  return PROFILE_ID_PRIORITY[id] ?? 960;
}

function lineFingerprint(line: string): string {
  return line.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasTruthyFirestoreTimestamp(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return true;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const s = (value as { seconds?: unknown }).seconds;
    return typeof s === 'number';
  }
  return false;
}

/** Relationship-path blockers only (entity onboarding — not job package / assignment readiness). */
function entityRelationshipBlockerCount(overview: EmploymentEntityOverview): number {
  return overview.blockers.length;
}

/**
 * Employment V2: render the readiness banner only when this tab’s entity has started or has work in flight.
 * Visibility is **not** driven by global `workerReadinessV1` alone (no profile-only / unsynced banner).
 */
export function isEmploymentEntityRelevantForWorkerReadinessBanner(overview: EmploymentEntityOverview): boolean {
  const ee = overview.entityEmployment;
  if (hasTruthyFirestoreTimestamp(ee?.onboardingStartedAt)) return true;
  if (String(ee?.onboardingPhase || '').trim()) return true;
  if (entityRelationshipBlockerCount(overview) > 0) return true;
  return false;
}

export type WorkerReadinessBannerModel = {
  headline: string;
  stateLine: string;
  severity: 'success' | 'info' | 'warning' | 'error';
  blockingLines: string[];
  moreBlockingCount: number;
  fixScrollElementId: string;
  /** When set, Fix now / View details should select this entity tab before scrolling. */
  fixEntityKey: EmploymentEntityKey | null;
  showBlockingList: boolean;
};

/**
 * Employment tab banner for the **active** entity: `workerReadinessV1` profile gates (global) +
 * **relationship** onboarding signals for `scopeEntityKey` only (no assignment / job package rows).
 * Candidates are sorted by priority; Fix now scrolls to relationship onboarding.
 */
export function buildWorkerReadinessBannerModel(args: {
  wr: WorkerReadinessV1Snapshot | null;
  byEntityKey: Record<EmploymentEntityKey, EmploymentEntityOverview>;
  /** Active hiring-entity tab — entity rows are limited to this key (profile rows still included). */
  scopeEntityKey: EmploymentEntityKey;
}): WorkerReadinessBannerModel {
  const { wr, byEntityKey, scopeEntityKey } = args;
  const state = wr?.overallWorkerState ?? null;
  const profileBlocking = wr?.profileReadiness?.blockingItemIds ?? [];

  const candidates: BannerCandidate[] = [];

  for (const id of profileBlocking) {
    const label = PROFILE_BLOCKING_LABELS[id] || `${id.replace(/_/g, ' ')} (worker profile)`;
    candidates.push({
      priority: profilePriority(id),
      entityKey: null,
      section: 'onboarding',
      line: label,
      dedupeKey: `profile:${id}`,
    });
  }

  const scopedOverview = byEntityKey[scopeEntityKey];
  const entityIndex = EMPLOYMENT_ENTITY_KEYS.indexOf(scopeEntityKey);
  const tierBias = Math.max(0, entityIndex) * 2;

  if (scopedOverview) {
    const entityKey = scopeEntityKey;
    const o = scopedOverview;
    const entityTitle = o.headerEntityName?.trim() || entityLabelForKey(entityKey);

    o.blockers.forEach((b, i) => {
      const t = b.title?.trim();
      if (!t) return;
      candidates.push({
        priority: 780 - i * 3 - tierBias,
        entityKey,
        section: 'onboarding',
        line: `${entityTitle}: ${t}`,
        dedupeKey: `blk:${entityKey}:${b.id}`,
      });
    });

    const pending = o.onboardingCompletionPendingItems?.[0];
    if (pending?.rowLabel?.trim()) {
      candidates.push({
        priority: 720 - tierBias,
        entityKey,
        section: 'onboarding',
        line: `${entityTitle}: ${pending.rowLabel.trim()}`,
        dedupeKey: `onb:${entityKey}:${pending.rowId}`,
      });
    }
  }

  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);

  const uniqueOrdered: BannerCandidate[] = [];
  const seenLine = new Set<string>();
  const seenDedupe = new Set<string>();
  for (const c of sorted) {
    if (seenDedupe.has(c.dedupeKey)) continue;
    const fp = lineFingerprint(c.line);
    if (seenLine.has(fp)) continue;
    seenDedupe.add(c.dedupeKey);
    seenLine.add(fp);
    uniqueOrdered.push(c);
  }

  const topFix = uniqueOrdered[0];
  const showBlockingList = uniqueOrdered.length > 0;
  const o = byEntityKey[scopeEntityKey];
  let headline = showBlockingList ? 'Not ready to work' : positiveHeadlineForState(state);
  if (!showBlockingList && !state) {
    headline = `Company onboarding · ${o.entityLabel}`;
  }
  let severity = stateSeverity(state);
  if (showBlockingList) {
    if (state === 'blocked' || state === 'terminated') severity = 'error';
    else if (severity === 'success') severity = 'warning';
  }

  const fixScrollElementId = EMPLOYMENT_V2_ANCHOR_ONBOARDING;

  const fixEntityKey = topFix?.entityKey ?? null;

  const blockingLines = uniqueOrdered.slice(0, WORKER_READINESS_BANNER_MAX_LINES).map((c) => c.line);
  const moreBlockingCount = Math.max(0, uniqueOrdered.length - blockingLines.length);

  const stateLine = state ? `Worker state: ${positiveHeadlineForState(state)}` : '';

  return {
    headline,
    stateLine,
    severity,
    blockingLines,
    moreBlockingCount,
    fixScrollElementId,
    fixEntityKey,
    showBlockingList,
  };
}

export function scrollToEmploymentV2Anchor(elementId: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(elementId);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
