/**
 * Work Readiness column for recruiter /users/all: entity chips only (C1 Select / Workforce / Events).
 * Colors come from entity_employment chip tones — no generic fallback copy in this column.
 */

import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { PrescreenCategoryScoresV1 } from '../types/prescreenCategoryScores';
import { accusourceScreeningLineItems } from './accusourceScreeningLineItems';
import { getEVerifyComfortStatusFromUserData } from './eVerifyComfortDisplay';
import type { RecruiterUserBreakdownExtras, RecruiterUserReadinessLike } from './recruiterUsersReadinessDisplay';
import { hasRecruiterInterviewCompletionEvidence } from './scoreSummary';
import { getWorkAuthorizedStatus } from './workAuthorizedDisplay';
import type { UserListEntityOnboardingItem } from './userListEntityEmploymentStatus';
import type { UserListEntityOnboardingTone } from './userListEntityEmploymentStatus';

const ENTITY_LABEL: Record<'select' | 'workforce' | 'events', string> = {
  select: 'C1 Select',
  workforce: 'C1 Workforce',
  events: 'C1 Events',
};

/** Final UI states for Work Readiness chips (entity name only; color carries meaning). */
export type WorkReadinessDisplayState = 'onboarding' | 'active' | 'terminated_or_dnr';

export type EntityWorkReadinessChip = {
  key: string;
  /** Canonical C1 entity name only */
  label: string;
  displayState: WorkReadinessDisplayState;
};

/** C1 Select / Workforce W-2 path — used by Risk / Concern column. */
export function w2EmployeeOnboardingComplete(user: RecruiterUserReadinessLike): boolean {
  return String(user.employeeOnboardStatus || '').toLowerCase() === 'completed';
}

function pickLatestOrder<T extends Record<string, unknown>>(rows: T[]): T | undefined {
  if (!rows.length) return undefined;
  return rows[rows.length - 1];
}

/** E-Verify case outcome from `users.eVerifyOrders` when present. */
function everifyCaseState(user: RecruiterUserBreakdownExtras): 'favorable' | 'unfavorable' | 'pending' | 'none' {
  const orders = user.eVerifyOrders;
  if (!Array.isArray(orders) || orders.length === 0) return 'none';
  const latest = pickLatestOrder(orders as Record<string, unknown>[]) as { result?: string; status?: string } | undefined;
  if (!latest) return 'none';
  const blob = `${latest.result || ''} ${latest.status || ''}`.toLowerCase();
  if (blob.includes('nonconfirmation') || blob.includes('no show') || blob.includes('referral')) {
    return 'unfavorable';
  }
  if (blob.includes('authorized') || blob.includes('employment authorized') || blob.includes('verified')) {
    return 'favorable';
  }
  if (blob.includes('tentative')) return 'pending';
  return 'pending';
}

function backgroundPending(latestBg: BackgroundCheckRecord | null | undefined): boolean {
  if (!latestBg) return false;
  if (latestBg.hrxStatus === 'error') return true;
  const lines = accusourceScreeningLineItems(latestBg);
  if (lines.length === 0) {
    const st = String(latestBg.hrxStatus || '').toLowerCase();
    return ['submitted', 'awaiting_applicant', 'in_progress', 'draft', 'queued'].includes(st);
  }
  return lines.some((l) => {
    const s = l.status.toLowerCase();
    if (/complete|cleared|clear|passed|authorized|closed|final/.test(s)) return false;
    return true;
  });
}

export function eventsContractorReady(user: RecruiterUserReadinessLike): boolean {
  const c = String(user.contractorOnboardStatus || '').toLowerCase();
  const ot = String(user.onboardingType || '').toLowerCase();
  if (c === 'completed') return true;
  if (ot === 'contractor' && c === 'completed') return true;
  return false;
}

export function inferCanonicalEntityKey(item: UserListEntityOnboardingItem): 'select' | 'workforce' | 'events' | null {
  if (item.entityKey) {
    const k = item.entityKey.toLowerCase();
    if (k === 'select' || k === 'workforce' || k === 'events') return k;
  }
  const L = item.entityLabel.toLowerCase();
  if (L.includes('select')) return 'select';
  if (L.includes('workforce')) return 'workforce';
  if (L.includes('events')) return 'events';
  return null;
}

/**
 * Map entity employment tone → one of three display states (no extra UI pseudo-states).
 */
function toneToDisplayState(tone: UserListEntityOnboardingTone): WorkReadinessDisplayState {
  if (tone === 'inactive' || tone === 'needs_attention') {
    return 'terminated_or_dnr';
  }
  if (tone === 'onboarding') {
    return 'onboarding';
  }
  return 'active';
}

function mergeDisplayStates(states: WorkReadinessDisplayState[]): WorkReadinessDisplayState {
  if (states.includes('terminated_or_dnr')) return 'terminated_or_dnr';
  if (states.includes('onboarding')) return 'onboarding';
  return 'active';
}

const ENTITY_ORDER: Array<'select' | 'workforce' | 'events'> = ['select', 'workforce', 'events'];

/**
 * Work Readiness column: only canonical C1 entity chips from `entity_employments`-derived items.
 * No caption when empty. Chip label is entity name only; color = onboarding (warning) / active (success) / terminated or DNR (error).
 */
/**
 * Display state for a single C1 entity from `entity_employments`-derived items (for sorting when one entity is selected).
 */
export function getWorkReadinessDisplayStateForEntityKey(
  entityItems: UserListEntityOnboardingItem[] | undefined,
  entityKey: 'select' | 'workforce' | 'events',
): WorkReadinessDisplayState | null {
  const chips = getWorkReadinessEntityChipsDisplay(entityItems);
  const prefix = `${entityKey}-`;
  const chip = chips.find((c) => c.key.startsWith(prefix));
  return chip?.displayState ?? null;
}

/** Lower rank sorts first when direction is asc (onboarding → active → terminated). */
function workReadinessRank(s: WorkReadinessDisplayState | null): number {
  if (s == null) return -1;
  if (s === 'onboarding') return 0;
  if (s === 'active') return 1;
  return 2;
}

/**
 * Sort two users by work readiness for the selected entity only (null = no row for that entity → sort last).
 */
export function compareWorkReadinessForEntity(
  itemsA: UserListEntityOnboardingItem[] | undefined,
  itemsB: UserListEntityOnboardingItem[] | undefined,
  entityKey: 'select' | 'workforce' | 'events',
  direction: 'asc' | 'desc',
): number {
  const sa = getWorkReadinessDisplayStateForEntityKey(itemsA, entityKey);
  const sb = getWorkReadinessDisplayStateForEntityKey(itemsB, entityKey);
  const ra = workReadinessRank(sa);
  const rb = workReadinessRank(sb);
  if (ra === -1 && rb === -1) return 0;
  if (ra === -1) return 1;
  if (rb === -1) return -1;
  const diff = ra - rb;
  return direction === 'asc' ? diff : -diff;
}

export function getWorkReadinessEntityChipsDisplay(
  entityItems: UserListEntityOnboardingItem[] | undefined,
): EntityWorkReadinessChip[] {
  if (!entityItems?.length) return [];

  const byKey = new Map<
    'select' | 'workforce' | 'events',
    { label: string; states: WorkReadinessDisplayState[] }
  >();

  for (const item of entityItems) {
    const k = inferCanonicalEntityKey(item);
    if (!k) continue;
    const label = ENTITY_LABEL[k];
    const displayState = toneToDisplayState(item.tone);
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, { label, states: [displayState] });
    } else {
      cur.states.push(displayState);
    }
  }

  const chips: EntityWorkReadinessChip[] = [];
  for (const k of ENTITY_ORDER) {
    const entry = byKey.get(k);
    if (!entry) continue;
    const displayState = mergeDisplayStates(entry.states);
    chips.push({
      key: `${k}-${displayState}`,
      label: entry.label,
      displayState,
    });
  }

  return chips;
}

export type TopConcernContext = {
  latestAccusourceBackground?: BackgroundCheckRecord | null;
  categoryScores?: PrescreenCategoryScoresV1 | null;
  hasSelectEntity?: boolean;
  hasWorkforceEntity?: boolean;
  hasEventsEntity?: boolean;
};

/** More specific top risk / blocker copy for the Risk / Concern column. */
export function getRecruiterUserTopConcernDetailed(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems: UserListEntityOnboardingItem[] | undefined,
  ctx?: TopConcernContext,
): string {
  const sec = String(user.securityLevel ?? '0');
  if (sec === '0') return 'Account suspended';

  const auth = getWorkAuthorizedStatus(user);
  if (auth === 'no') return 'Work authorization denied';

  const evComfort = getEVerifyComfortStatusFromUserData(user);
  if (evComfort === 'no') return 'E-Verify participation declined';

  const evCase = everifyCaseState(user);
  if (evCase === 'unfavorable') return 'E-Verify unfavorable outcome';

  const hasSelect = ctx?.hasSelectEntity ?? (entityItems ?? []).some((i) => inferCanonicalEntityKey(i) === 'select');
  const hasWorkforce =
    ctx?.hasWorkforceEntity ?? (entityItems ?? []).some((i) => inferCanonicalEntityKey(i) === 'workforce');
  if (hasSelect && !w2EmployeeOnboardingComplete(user)) {
    return 'I-9 or payroll setup incomplete (Select)';
  }
  if (hasWorkforce && !w2EmployeeOnboardingComplete(user)) {
    return 'I-9 or payroll setup incomplete (Workforce)';
  }

  const hasEvents =
    ctx?.hasEventsEntity ?? (entityItems ?? []).some((i) => inferCanonicalEntityKey(i) === 'events');
  if (hasEvents && !eventsContractorReady(user)) {
    return 'Contractor or 1099 onboarding incomplete (Events)';
  }

  if (hasSelect && evCase === 'none' && Array.isArray(user.eVerifyOrders) && user.eVerifyOrders.length === 0) {
    return 'E-Verify not started (Select)';
  }

  if (hasSelect && evCase === 'pending') return 'E-Verify in progress';

  const bg = ctx?.latestAccusourceBackground;
  if (bg && backgroundPending(bg)) {
    const lines = accusourceScreeningLineItems(bg);
    const stuck = lines.find((l) => /pending|review|submitted/i.test(l.status));
    if (stuck) return `Background pending: ${stuck.name}`;
    return 'Background screening pending';
  }

  for (const item of entityItems ?? []) {
    if (item.tone !== 'needs_attention') continue;
    const blob = `${item.statusLabel} ${item.entityLabel}`;
    if (/drug|substance/i.test(blob)) return 'Drug screening attention';
    if (/background|criminal|screen/i.test(blob)) return 'Background check attention';
  }

  if (auth === 'skipped' || evComfort === 'skipped') return 'Missing work authorization or E-Verify docs';

  if (sec === '2' || sec === '3') {
    if (!hasRecruiterInterviewCompletionEvidence(user.scoreSummary, user)) return 'Interview not completed';
  }

  const cats = ctx?.categoryScores;
  if (cats) {
    if (cats.punctuality < 45) return 'Punctuality concern (category score)';
    if (cats.reliability < 40) return 'Reliability concern (category score)';
    if (cats.stability < 40) return 'Stability concern (category score)';
  }

  const rel = user.scoreSummary?.components?.reliability;
  if (rel != null && rel < 40) return 'Low reliability score (AI component)';

  return 'None';
}

export type RecordHeaderEntitySlot = {
  entityKey: 'select' | 'workforce' | 'events';
  title: string;
  /** Short status for header chips */
  statusLabel: string;
  displayState: WorkReadinessDisplayState | null;
};

/**
 * One slot per entity that has employment/onboarding data. Omits entities with no chip (no "—" placeholders).
 */
export function getRecordHeaderEntitySlots(entityItems: UserListEntityOnboardingItem[] | undefined): RecordHeaderEntitySlot[] {
  const chips = getWorkReadinessEntityChipsDisplay(entityItems);
  const out: RecordHeaderEntitySlot[] = [];
  for (const k of ENTITY_ORDER) {
    const chip = chips.find((c) => c.key.startsWith(`${k}-`));
    if (!chip) continue;
    const title = ENTITY_LABEL[k];
    const statusLabel =
      chip.displayState === 'active' ? 'Active' : chip.displayState === 'onboarding' ? 'Onboarding' : 'Inactive';
    out.push({ entityKey: k, title, statusLabel, displayState: chip.displayState });
  }
  return out;
}
