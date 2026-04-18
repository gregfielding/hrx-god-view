/**
 * Internal (C1) fallback for List B `document_sub_type_code` when tenant Firestore mapping is absent.
 * For our current ICA account, USCIS expects **document class** enums (e.g. DRIVERS_LICENSE, STATE_ID_CARD),
 * not REAL ID / Non–REAL ID strings. Applied only for allowlisted tenants — see `everifyInternalSubtypeTenants.ts`.
 */

/** document_b_type_code → valid `document_sub_type_code` for our internal E-Verify ICA. */
export const INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE: Record<
  'DRIVERS_LICENSE' | 'GOVERNMENT_ID_CARD',
  string
> = {
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  GOVERNMENT_ID_CARD: 'STATE_ID_CARD',
};

/** ICA `document_sub_type_code` for internal fallback, or null if List B type does not use this path. */
export function internalDocumentSubTypeCodeForListB(bCode: string): string | null {
  const c = String(bCode || '').trim();
  if (c === 'DRIVERS_LICENSE') return INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE.DRIVERS_LICENSE;
  if (c === 'GOVERNMENT_ID_CARD') return INTERNAL_LIST_B_DOCUMENT_SUB_TYPE_CODE.GOVERNMENT_ID_CARD;
  return null;
}
