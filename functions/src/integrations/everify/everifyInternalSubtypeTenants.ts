/**
 * Which tenants may use `INTERNAL_EVERIFY_DEFAULT_SUBTYPE_MAP` (C1 / internal testing).
 * Other tenants must configure tenants/{id}/settings/everify_ica_document_mappings.
 */

const C1_TENANT_ID_CANONICAL = 'BCiP2bQ9CgVOCTfV6MhD';
/** Legacy typo (0 vs O) — same as src/utils/c1TenantIdNormalize.ts */
const C1_TENANT_ID_TYPO = 'BCiP2bQ9CgV0CTfV6MhD';

function normalizeC1TenantId(tenantId: string): string {
  return tenantId === C1_TENANT_ID_TYPO ? C1_TENANT_ID_CANONICAL : tenantId;
}

/**
 * Comma-separated tenant Firestore IDs (optional). For staging / extra internal tenants.
 * Example: EVERIFY_INTERNAL_SUBTYPE_EXTRA_TENANT_IDS=abc,def
 */
function extraInternalSubtypeTenantIds(): string[] {
  return String(process.env.EVERIFY_INTERNAL_SUBTYPE_EXTRA_TENANT_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** True when this tenant may apply internal List B subtype ICA defaults without tenant mapping. */
export function isTenantEligibleForInternalEverifySubtypeDefault(tenantId: string | undefined | null): boolean {
  const raw = String(tenantId || '').trim();
  if (!raw) return false;
  const n = normalizeC1TenantId(raw);
  if (n === C1_TENANT_ID_CANONICAL) return true;
  return extraInternalSubtypeTenantIds().includes(n);
}
