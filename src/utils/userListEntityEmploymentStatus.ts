/**
 * Maps `entity_employments` rows to compact recruiter table chips (per-entity onboarding).
 * Does not run full `buildEmploymentEntityOverview` — path blockers are not reflected until a batch overview exists.
 */

export type UserListEntityOnboardingTone = 'ready' | 'onboarding' | 'needs_attention' | 'inactive';

export interface UserListEntityOnboardingItem {
  /** Short label, e.g. C1 entity tab name */
  entityLabel: string;
  /** Recruiter-facing status phrase (not raw Firestore status). */
  statusLabel: string;
  tone: UserListEntityOnboardingTone;
  /** Raw employment status for tooltips / debugging */
  rawStatus?: string;
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

/** Derive chip tone + label from `entity_employments.status`. */
export function entityEmploymentRowToChipItem(
  entityLabel: string,
  rawStatus: string | null | undefined
): UserListEntityOnboardingItem | null {
  const label = entityLabel.trim() || 'Entity';
  const s = String(rawStatus || '')
    .trim()
    .toLowerCase();

  if (!s || s === 'not_started' || s === 'none') {
    return null;
  }

  if (s === 'blocked') {
    return { entityLabel: label, statusLabel: 'Needs attention', tone: 'needs_attention', rawStatus: s };
  }
  if (s === 'onboarding') {
    return { entityLabel: label, statusLabel: 'Onboarding', tone: 'onboarding', rawStatus: s };
  }
  if (s === 'active' || s === 'ready') {
    return { entityLabel: label, statusLabel: 'Ready', tone: 'ready', rawStatus: s };
  }
  if (s === 'inactive' || s === 'terminated') {
    return null;
  }

  return { entityLabel: label, statusLabel: 'Onboarding', tone: 'onboarding', rawStatus: s };
}

export function mergeEntityEmploymentItems(existing: UserListEntityOnboardingItem, incoming: UserListEntityOnboardingItem): UserListEntityOnboardingItem {
  if (STATUS_PRIORITY[incoming.tone] < STATUS_PRIORITY[existing.tone]) return incoming;
  return existing;
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
  docSnap: EntityEmploymentDocSnap
): void {
  const d = docSnap.data();
  const uid = String(d.userId || '').trim();
  if (!uid) return;
  const entityKeyRaw = String(d.entityKey || '').trim();
  const entityName = String(d.entityName || '').trim();
  const displayLabel = displayEntityLabelForOnboardingChip(entityKeyRaw, entityName);
  const item = entityEmploymentRowToChipItem(displayLabel, d.status as string | undefined);
  if (!item) return;
  const entityId = String(d.entityId || '').trim();
  const idPrefix = `${uid}__`;
  const fromDocId = docSnap.id.startsWith(idPrefix) ? docSnap.id.slice(idPrefix.length) : docSnap.id;
  const dedupeKey = entityKeyRaw.toLowerCase() || entityId || fromDocId;
  const existing = target.get(dedupeKey);
  target.set(dedupeKey, existing ? mergeEntityEmploymentItems(existing, item) : item);
}

export function chipItemsFromDedupeMap(map: Map<string, UserListEntityOnboardingItem>): UserListEntityOnboardingItem[] {
  return sortEntityOnboardingItemsForDisplay(Array.from(map.values()));
}
