/**
 * Maps `entity_employments` rows to compact recruiter table chips (per-entity employment).
 * Prefers persisted `employmentState`; when absent, falls back to legacy `status` and `computeHasOpenOnboardingDemand`
 * so stale `onboarding` rows without live assignment demand do not read as active onboarding.
 */

import type { EmploymentAssignmentSummary } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { computeHasOpenOnboardingDemand } from './deriveEmploymentHeaderState';

export type UserListEntityOnboardingTone = 'ready' | 'onboarding' | 'needs_attention' | 'inactive';

export interface UserListEntityOnboardingItem {
  /** Short label, e.g. C1 entity tab name */
  entityLabel: string;
  /** Recruiter-facing status phrase (not raw Firestore status). */
  statusLabel: string;
  tone: UserListEntityOnboardingTone;
  /** Raw employment status for tooltips / debugging */
  rawStatus?: string;
  /** Lowercase `entityKey` from `entity_employments` (e.g. select, workforce, events). */
  entityKey?: string;
}

const STATUS_PRIORITY: Record<UserListEntityOnboardingTone, number> = {
  needs_attention: 0,
  onboarding: 1,
  ready: 2,
  inactive: 3,
};

const C1_ENTITY_KEY_DISPLAY: Record<string, string> = {
  select: 'C1 Select',
  workforce: 'C1 Workforce',
  events: 'C1 Events',
};

/** Human-facing employer line for chips/tooltips; prefers canonical C1 names when `entityKey` matches. */
export function displayEntityLabelForOnboardingChip(entityKeyRaw: string, entityName: string): string {
  const k = entityKeyRaw.trim().toLowerCase();
  if (k && C1_ENTITY_KEY_DISPLAY[k]) return C1_ENTITY_KEY_DISPLAY[k];
  const name = entityName.trim();
  if (name) return name;
  return 'Entity';
}

/**
 * Derive chip tone + label from canonical `entity_employments.employmentState` (preferred) or legacy `status`,
 * plus open onboarding demand when `employmentState` is absent (stale onboarding rows).
 */
export function entityEmploymentRowToChipItem(
  entityLabel: string,
  opts: {
    employmentState?: string | null;
    legacyStatus?: string | null;
    hasOpenOnboardingDemand: boolean;
    /**
     * `entity_employments.onboardingComplete` and/or `active` from engine sync — overrides stale `employmentState`
     * / `status` in chips when the doc was not fully denormalized yet.
     */
    onboardingComplete?: boolean;
  }
): UserListEntityOnboardingItem | null {
  const label = entityLabel.trim() || 'Entity';
  const es = String(opts.employmentState || '')
    .trim()
    .toLowerCase();
  const leg = String(opts.legacyStatus || '')
    .trim()
    .toLowerCase();
  const hasCanon = Boolean(es);
  const s = hasCanon ? es : leg;
  const demand = opts.hasOpenOnboardingDemand;

  if (!s || s === 'not_started' || s === 'none') {
    return null;
  }

  if (s === 'blocked') {
    return { entityLabel: label, statusLabel: 'Needs attention', tone: 'needs_attention', rawStatus: s };
  }
  if (opts.onboardingComplete === true && s !== 'inactive' && s !== 'terminated') {
    return { entityLabel: label, statusLabel: 'Active', tone: 'ready', rawStatus: es || leg || 'active' };
  }
  if (s === 'onboarding') {
    if (hasCanon) {
      return { entityLabel: label, statusLabel: 'Onboarding', tone: 'onboarding', rawStatus: es || leg };
    }
    if (!demand) return null;
    return { entityLabel: label, statusLabel: 'Onboarding', tone: 'onboarding', rawStatus: leg };
  }
  if (s === 'active' || (!hasCanon && leg === 'ready')) {
    return { entityLabel: label, statusLabel: 'Active', tone: 'ready', rawStatus: es || leg };
  }
  if (s === 'inactive') {
    return { entityLabel: label, statusLabel: 'Inactive', tone: 'inactive', rawStatus: s };
  }
  if (s === 'terminated') {
    return { entityLabel: label, statusLabel: 'Terminated', tone: 'inactive', rawStatus: s };
  }

  if (!demand) return null;
  return { entityLabel: label, statusLabel: 'Onboarding', tone: 'onboarding', rawStatus: leg };
}

export function mergeEntityEmploymentItems(existing: UserListEntityOnboardingItem, incoming: UserListEntityOnboardingItem): UserListEntityOnboardingItem {
  if (STATUS_PRIORITY[incoming.tone] < STATUS_PRIORITY[existing.tone]) {
    return { ...incoming, entityKey: incoming.entityKey || existing.entityKey };
  }
  return { ...existing, entityKey: existing.entityKey || incoming.entityKey };
}

export function sortEntityOnboardingItemsForDisplay(items: UserListEntityOnboardingItem[]): UserListEntityOnboardingItem[] {
  return [...items].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.tone];
    const pb = STATUS_PRIORITY[b.tone];
    if (pa !== pb) return pa - pb;
    return a.entityLabel.localeCompare(b.entityLabel);
  });
}

export const USER_LIST_ENTITY_ONBOARDING_MAX_CHIPS = 2;

export function formatEntityOnboardingChipLine(item: UserListEntityOnboardingItem): string {
  return `${item.entityLabel}: ${item.statusLabel}`;
}

/** Firestore doc shape for folding `entity_employments` into chip maps. */
export type EntityEmploymentDocSnap = { id: string; data: () => Record<string, unknown> };

/** Fold one `entity_employments` document into a per-entity dedupe map (single user or multi-user caller supplies the map). */
export function mergeEntityEmploymentDocIntoChipMap(
  target: Map<string, UserListEntityOnboardingItem>,
  docSnap: EntityEmploymentDocSnap,
  opts?: { assignmentsForEntity?: EmploymentAssignmentSummary[] | undefined }
): void {
  const d = docSnap.data();
  const uid = String(d.userId || '').trim();
  if (!uid) return;
  const entityKeyRaw = String(d.entityKey || '').trim();
  const entityName = String(d.entityName || '').trim();
  const displayLabel = displayEntityLabelForOnboardingChip(entityKeyRaw, entityName);
  const legacyStatus = String(d.status || '').trim();
  const employmentState = String(d.employmentState || '').trim();
  const hasOpenOnboardingDemand = computeHasOpenOnboardingDemand({
    assignments: opts?.assignmentsForEntity,
    entityEmploymentStatus: legacyStatus || employmentState,
    employmentEntryMode: d.employmentEntryMode as string,
  });
  let item = entityEmploymentRowToChipItem(displayLabel, {
    employmentState: employmentState || undefined,
    legacyStatus: legacyStatus || undefined,
    hasOpenOnboardingDemand,
    onboardingComplete: d.onboardingComplete === true || d.active === true,
  });
  if (!item) return;
  /** Terminal / DNR-style rows → inactive chip (red in Work Readiness column). */
  const terminatedAt = (d as { terminatedAt?: unknown }).terminatedAt;
  if (terminatedAt != null && terminatedAt !== '') {
    item = { ...item, tone: 'inactive', statusLabel: 'Terminated', rawStatus: 'terminated' };
  } else if ((d as { doNotReturn?: unknown }).doNotReturn === true) {
    item = { ...item, tone: 'inactive', statusLabel: 'Do not return', rawStatus: 'dnr' };
  }
  const withKey: UserListEntityOnboardingItem = {
    ...item,
    entityKey: entityKeyRaw.toLowerCase() || undefined,
  };
  const entityId = String(d.entityId || '').trim();
  const idPrefix = `${uid}__`;
  const fromDocId = docSnap.id.startsWith(idPrefix) ? docSnap.id.slice(idPrefix.length) : docSnap.id;
  const dedupeKey = entityKeyRaw.toLowerCase() || entityId || fromDocId;
  const existing = target.get(dedupeKey);
  target.set(dedupeKey, existing ? mergeEntityEmploymentItems(existing, withKey) : withKey);
}

export function chipItemsFromDedupeMap(map: Map<string, UserListEntityOnboardingItem>): UserListEntityOnboardingItem[] {
  return sortEntityOnboardingItemsForDisplay(Array.from(map.values()));
}
