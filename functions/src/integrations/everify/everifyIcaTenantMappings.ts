/**
 * Tenant-scoped ICA enum mapping for E-Verify List B document_sub_type_code.
 * Stored at tenants/{tenantId}/settings/everify_ica_document_mappings
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { internalDocumentSubTypeCodeForListB } from './everifyIcaDefaultSubtypes';
import { isTenantEligibleForInternalEverifySubtypeDefault } from './everifyInternalSubtypeTenants';

export const EVERIFY_ICA_MAPPINGS_SETTINGS_ID = 'everify_ica_document_mappings';

export type EverifyListBVariant = 'REAL_ID' | 'NON_REAL_ID';

export type EverifyListBSubtypeRow = Partial<Record<EverifyListBVariant, string>>;

/** v1: human variants (REAL_ID / NON_REAL_ID) → exact ICA strings from the tenant's signed agreement. */
export type EverifyIcaDocumentMappingsDoc = {
  schemaVersion: 1;
  listBDriversLicense?: EverifyListBSubtypeRow;
  listBGovernmentIdCard?: EverifyListBSubtypeRow;
};

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

function configuredVariants(row: EverifyListBSubtypeRow | null): EverifyListBVariant[] {
  if (!row) return [];
  const out: EverifyListBVariant[] = [];
  if (row.REAL_ID?.trim()) out.push('REAL_ID');
  if (row.NON_REAL_ID?.trim()) out.push('NON_REAL_ID');
  return out;
}

export async function loadEverifyIcaDocumentMappings(tenantId: string): Promise<EverifyIcaDocumentMappingsDoc | null> {
  const tid = String(tenantId || '').trim();
  if (!tid) return null;
  const snap = await admin.firestore().doc(`tenants/${tid}/settings/${EVERIFY_ICA_MAPPINGS_SETTINGS_ID}`).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  if (d.schemaVersion != null && d.schemaVersion !== 1) return null;
  return d as unknown as EverifyIcaDocumentMappingsDoc;
}

/**
 * Fills document_sub_type_code when not already set (advanced raw override wins).
 * 1) Tenant Company Defaults mapping (REAL_ID / NON_REAL_ID slots → ICA strings).
 * 2) Else internal C1: doc-class enum (DRIVERS_LICENSE / STATE_ID_CARD) from List B type.
 */
export function applyTenantListBDocumentSubtype(
  merged: Record<string, unknown>,
  mappings: EverifyIcaDocumentMappingsDoc | null,
  tenantId?: string,
): void {
  const existing =
    typeof merged.document_sub_type_code === 'string' ? merged.document_sub_type_code.trim() : '';
  if (existing) {
    delete merged.everify_list_b_variant;
    return;
  }

  const bCode = typeof merged.document_b_type_code === 'string' ? merged.document_b_type_code.trim() : '';
  const cCode = typeof merged.document_c_type_code === 'string' ? merged.document_c_type_code.trim() : '';
  if (!bCode || !cCode) {
    delete merged.everify_list_b_variant;
    return;
  }
  if (bCode !== 'DRIVERS_LICENSE' && bCode !== 'GOVERNMENT_ID_CARD') {
    delete merged.everify_list_b_variant;
    return;
  }

  const tenantRow = rowForListBCode(bCode, mappings);
  const vars = tenantRow ? configuredVariants(tenantRow) : [];

  if (tenantRow && vars.length > 0) {
    if (vars.length === 1) {
      merged.document_sub_type_code = String(tenantRow[vars[0]]!).trim();
      delete merged.everify_list_b_variant;
      return;
    }
    const want = merged.everify_list_b_variant;
    if ((want === 'REAL_ID' || want === 'NON_REAL_ID') && tenantRow[want]?.trim()) {
      merged.document_sub_type_code = tenantRow[want]!.trim();
    }
    delete merged.everify_list_b_variant;
    return;
  }

  if (isTenantEligibleForInternalEverifySubtypeDefault(tenantId)) {
    const sub = internalDocumentSubTypeCodeForListB(bCode);
    if (sub) {
      merged.document_sub_type_code = sub;
      delete merged.everify_list_b_variant;
      logger.info('everify.list_b_document_sub_type_from_internal_doc_class_default', {
        tenantId: tenantId ?? null,
        document_b_type_code: bCode,
        document_sub_type_code: sub,
      });
    }
    return;
  }

  delete merged.everify_list_b_variant;
}
