/**
 * C1 hiring UX: work authorization and E-Verify presentation by entity.
 * Mirrors backend `deriveEntityKeyFromName` in workerOnboardingPipeline.ts (keep in sync).
 */

export type C1EntityKey = 'select' | 'events' | 'workforce';

export function deriveC1EntityKeyFromEntityName(rawName: string): C1EntityKey {
  const v = String(rawName || '').toLowerCase();
  if (v.includes('select')) return 'select';
  if (v.includes('event')) return 'events';
  return 'workforce';
}

/** USCIS E-Verify belongs in onboarding/compliance UI only for C1 Select. */
export function everifyUiAppliesToEntityKey(entityKey: string | undefined | null): boolean {
  return String(entityKey || '').toLowerCase() === 'select';
}

export type WorkAuthUiMode = 'select_i9_everify' | 'workforce_i9_only' | 'hidden';

export function workAuthUiModeFromEntityKey(entityKey: string | undefined | null): WorkAuthUiMode {
  const k = String(entityKey || '').toLowerCase();
  if (k === 'select') return 'select_i9_everify';
  if (k === 'workforce') return 'workforce_i9_only';
  return 'hidden';
}

/** Resolve C1 Select LLC entity doc id from tenant entities (same rules as BackgroundsComplianceTab). */
export function resolveC1SelectEntityId(
  entities: Array<{ id: string; name: string; entityCode?: string }>
): string | null {
  const byCode = entities.find((e) => (e.entityCode || '').trim().toUpperCase() === 'C1SL');
  if (byCode) return byCode.id;
  const found =
    entities.find((e) => {
      const n = e.name.trim().toLowerCase();
      return n === 'c1 select llc' || /^c1\s+select\b/i.test(e.name.trim());
    }) ?? null;
  return found?.id ?? null;
}

export function filterEverifyCasesForSelectUi(
  rows: Array<{ id: string; data: Record<string, unknown> }>,
  entityIdToEntityName: Map<string, string>
): Array<{ id: string; data: Record<string, unknown> }> {
  return rows.filter((r) => {
    const eid = r.data.entityId as string | undefined;
    if (!eid || !entityIdToEntityName.has(eid)) return false;
    const name = entityIdToEntityName.get(eid) || '';
    return deriveC1EntityKeyFromEntityName(name) === 'select';
  });
}
