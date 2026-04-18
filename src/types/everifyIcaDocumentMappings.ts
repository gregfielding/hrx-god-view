/**
 * Client-side mirror of E-Verify List B subtype helpers (functions bundle cannot import src/).
 * tenants/{tenantId}/settings/everify_ica_document_mappings
 */

import { C1_TENANT_ID_CANONICAL, normalizeC1TenantIdTypo } from '../utils/c1TenantIdNormalize';

export type EverifyListBVariant = 'REAL_ID' | 'NON_REAL_ID';

export type EverifyListBSubtypeRow = Partial<Record<EverifyListBVariant, string>>;

export type EverifyIcaDocumentMappingsDoc = {
  schemaVersion: 1;
  listBDriversLicense?: EverifyListBSubtypeRow;
  listBGovernmentIdCard?: EverifyListBSubtypeRow;
};

export const EVERIFY_ICA_MAPPINGS_SETTINGS_ID = 'everify_ica_document_mappings';

/** C1 internal tenants that may use doc-class `document_sub_type_code` fallback (matches server allowlist). */
export const INTERNAL_EVERIFY_DEFAULT_SUBTYPE_TENANT_IDS: readonly string[] = [C1_TENANT_ID_CANONICAL];

/** True when internal List B subtype fallback applies in the Start E-Verify dialog (matches server allowlist). */
export function isInternalEverifySubtypeDefaultTenant(tenantId: string | null | undefined): boolean {
  const raw = String(tenantId || '').trim();
  if (!raw) return false;
  const n = normalizeC1TenantIdTypo(raw) ?? raw;
  return INTERNAL_EVERIFY_DEFAULT_SUBTYPE_TENANT_IDS.includes(n);
}

/**
 * Internal C1 ICA: `document_sub_type_code` is the document class (mirrors functions `everifyIcaDefaultSubtypes.ts`).
 */
export const INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE: Record<'DRIVERS_LICENSE' | 'GOVERNMENT_ID_CARD', string> = {
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  GOVERNMENT_ID_CARD: 'STATE_ID_CARD',
};

export function internalListBDocumentSubTypeCodeForListBType(bCode: string): string | null {
  const c = String(bCode || '').trim();
  if (c === 'DRIVERS_LICENSE') return INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE.DRIVERS_LICENSE;
  if (c === 'GOVERNMENT_ID_CARD') return INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE.GOVERNMENT_ID_CARD;
  return null;
}

export function rowForListBCode(
  bCode: string,
  doc: EverifyIcaDocumentMappingsDoc | null,
): EverifyListBSubtypeRow | null {
  if (!doc) return null;
  const c = String(bCode || '').trim();
  if (c === 'DRIVERS_LICENSE') return doc.listBDriversLicense ?? null;
  if (c === 'GOVERNMENT_ID_CARD') return doc.listBGovernmentIdCard ?? null;
  return null;
}

export function configuredVariantKeys(row: EverifyListBSubtypeRow | null): EverifyListBVariant[] {
  if (!row) return [];
  const out: EverifyListBVariant[] = [];
  if (row.REAL_ID?.trim()) out.push('REAL_ID');
  if (row.NON_REAL_ID?.trim()) out.push('NON_REAL_ID');
  return out;
}

export function getSingleAutoVariant(row: EverifyListBSubtypeRow | null): EverifyListBVariant | null {
  const keys = configuredVariantKeys(row);
  return keys.length === 1 ? keys[0] : null;
}
