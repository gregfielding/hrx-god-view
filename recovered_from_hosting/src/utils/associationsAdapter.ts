/*
  Associations Adapter
  - Safe, flag-guarded accessors for reading deal associations during migration
  - Prefers new deal.associations structure; falls back to legacy fields
*/

export type AssociationEntry<TSnapshot = Record<string, unknown>> = {
  id: string;
  tenantId?: string;
  type?: 'company' | 'contact' | 'salesperson' | 'location';
  snapshot?: TSnapshot;
  isPrimary?: boolean;
  relationship?: 'owner' | 'member' | 'stakeholder';
  addedBy?: string;
  addedAt?: any;
  updatedAt?: any;
};

export type DealAssociationsShape = {
  companies?: AssociationEntry[];
  contacts?: AssociationEntry[];
  salespeople?: AssociationEntry[];
  locations?: AssociationEntry[];
};

export function isNewAssociationsReadEnabled(): boolean {
  try {
    const v = localStorage.getItem('feature.newAssociationsRead');
    // default to enabled unless explicitly set to 'false'
    return v !== 'false';
  } catch {
    return true;
  }
}

// Safely extract the associations map from a deal document
export function getDealAssociations(deal: any): DealAssociationsShape {
  if (!deal) return {};
  const useNew = isNewAssociationsReadEnabled();
  const assoc: DealAssociationsShape = useNew ? (deal.associations || {}) : {};
  return assoc || {};
}

export function getDealCompanyIds(deal: any): string[] {
  if (!deal) return [];
  const assoc = getDealAssociations(deal);
  const idsFromNew = (assoc.companies || [])
    .filter(Boolean)
    .map((c: any) => (typeof c === 'string' ? c : c.id))
    .filter(Boolean);

  return idsFromNew;
}

export function getDealPrimaryCompanyId(deal: any): string | null {
  const assoc = getDealAssociations(deal);
  const companies = assoc.companies || [];
  const primary = companies.find((c: any) => c && typeof c === 'object' && c.isPrimary);
  if (primary && primary.id) return primary.id;

  const ids = getDealCompanyIds(deal);
  return ids.length > 0 ? ids[0] : null;
}


