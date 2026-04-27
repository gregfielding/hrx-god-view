import type { EmploymentEntityKey, EntityEmploymentRecord } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { deriveC1EntityKeyFromEntityName, resolveC1SelectEntityId } from './c1EntityWorkAuthorizationUi';

export const EMPLOYMENT_ENTITY_KEYS: EmploymentEntityKey[] = ['select', 'workforce', 'events'];

export function entityLabelForKey(entityKey: EmploymentEntityKey): string {
  switch (entityKey) {
    case 'select':
      return 'C1 Select';
    case 'workforce':
      return 'C1 Workforce';
    case 'events':
      return 'C1 Events';
    default:
      return entityKey;
  }
}

export function defaultWorkerTypeForEntity(entityKey: EmploymentEntityKey): 'w2' | '1099' {
  return entityKey === 'events' ? '1099' : 'w2';
}

export function normalizeEntityKey(raw: string | undefined | null): EmploymentEntityKey | null {
  const k = String(raw || '').toLowerCase();
  if (k === 'select' || k === 'workforce' || k === 'events') return k;
  return null;
}

/**
 * Resolve tenants/{tid}/entities/{id} for an Employment V2 tab (Select / Workforce / Events).
 * Prefers entity_employments.entityId when it matches the tab key; else first tenant entity by name.
 */
export function resolveEntityFirestoreIdForTab(
  entityKey: EmploymentEntityKey,
  entityBrief: Array<{ id: string; name: string; entityCode?: string }>,
  employmentForTab: EntityEmploymentRecord | null
): string | null {
  if (employmentForTab?.entityId) {
    const row = entityBrief.find((e) => e.id === employmentForTab.entityId);
    const name = row?.name || '';
    if (deriveC1EntityKeyFromEntityName(name) === entityKey) {
      return employmentForTab.entityId;
    }
  }
  if (entityKey === 'select') {
    return resolveC1SelectEntityId(
      entityBrief.map((e) => ({ id: e.id, name: e.name, entityCode: e.entityCode }))
    );
  }
  const found = entityBrief.find((e) => deriveC1EntityKeyFromEntityName(e.name) === entityKey);
  return found?.id ?? null;
}
