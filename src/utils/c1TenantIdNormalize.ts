/** Some legacy user docs / claims use `0` instead of `O` in the C1 Firestore tenant id. */
const C1_TENANT_ID_TYPO = 'BCiP2bQ9CgV0CTfV6MhD';
const C1_TENANT_ID_CANONICAL = 'BCiP2bQ9CgVOCTfV6MhD';

/** Normalize to the canonical C1 tenant document id (single Firestore `tenants/{id}`). */
export function normalizeC1TenantIdTypo(tenantId: string | null | undefined): string | null | undefined {
  if (tenantId == null || tenantId === '') return tenantId;
  return tenantId === C1_TENANT_ID_TYPO ? C1_TENANT_ID_CANONICAL : tenantId;
}

export { C1_TENANT_ID_CANONICAL, C1_TENANT_ID_TYPO };
