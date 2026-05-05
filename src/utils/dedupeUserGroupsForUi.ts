export type UserGroupRow = {
  id: string;
  name: string;
  /**
   * AG.0 — true when the group was created by the auto-cascade (`type: 'auto'` on the
   * Firestore doc OR an `autoCreatedFrom` audit object is present). Carried through the
   * dedup helpers so downstream pickers can render an "Auto-attached" badge without
   * re-fetching the group docs.
   */
  isAuto?: boolean;
};

/**
 * One row per Firestore doc id, then one row per normalized display name.
 * Stops duplicate labels when multiple userGroups documents share the same title.
 */
export function dedupeUserGroupsForUi(userGroups: UserGroupRow[]): UserGroupRow[] {
  const byId = new Map<string, UserGroupRow>();
  for (const g of userGroups) {
    if (g?.id && !byId.has(g.id)) byId.set(g.id, g);
  }
  const idSorted = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  const byLabel = new Map<string, UserGroupRow>();
  for (const g of idSorted) {
    const key = (g.name || '').trim().toLowerCase() || g.id;
    if (!byLabel.has(key)) byLabel.set(key, g);
  }
  return Array.from(byLabel.values()).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
}

/** Map stored group ids to canonical picker rows (one per display name). */
export function autoAddGroupsPickerValue(
  storedIds: string[],
  rawGroups: UserGroupRow[],
  uiGroups: UserGroupRow[]
): UserGroupRow[] {
  const nameToUi = new Map<string, UserGroupRow>();
  for (const g of uiGroups) {
    nameToUi.set((g.name || '').trim().toLowerCase() || g.id, g);
  }
  const seen = new Set<string>();
  const out: UserGroupRow[] = [];
  for (const id of storedIds) {
    const raw = rawGroups.find((x) => x.id === id);
    if (!raw) continue;
    const k = (raw.name || '').trim().toLowerCase() || raw.id;
    const ui = nameToUi.get(k);
    if (!ui || seen.has(ui.id)) continue;
    seen.add(ui.id);
    out.push(ui);
  }
  return out;
}
