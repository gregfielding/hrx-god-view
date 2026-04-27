import { HttpsError } from "firebase-functions/v2/https";
import type { DocumentData, Firestore } from "firebase-admin/firestore";

/**
 * Whether the user document is associated with the tenant (worker / applicant / staff in that tenant).
 * Does not treat super_admin as implicitly in-tenant — target users for on-call onboarding should have explicit tenant data.
 */
export function workerHasTenantAssociation(userData: DocumentData | undefined, tenantId: string): boolean {
  if (!userData || !tenantId) return false;
  if (userData.activeTenantId === tenantId) return true;
  if (userData.tenantId === tenantId) return true;
  const tids = userData.tenantIds;
  if (Array.isArray(tids) && tids.includes(tenantId)) return true;
  if (tids && typeof tids === "object" && !Array.isArray(tids)) {
    if (Object.prototype.hasOwnProperty.call(tids, tenantId)) return true;
  }
  return false;
}

export async function assertWorkerTenantMembership(
  db: Firestore,
  tenantId: string,
  workerUid: string
): Promise<void> {
  const snap = await db.doc(`users/${workerUid}`).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Worker user not found");
  }
  if (!workerHasTenantAssociation(snap.data(), tenantId)) {
    throw new HttpsError("permission-denied", "Worker is not a member of this tenant");
  }
}

/**
 * Optional entity flags (see tenant entity doc). When absent, on-call pool hires are allowed.
 */
export function assertEntityAllowsOnCallPool(entityDoc: DocumentData, _entityId: string): void {
  if (entityDoc.isActive === false) {
    throw new HttpsError("failed-precondition", "This hiring entity is inactive");
  }
  if (entityDoc.allowsOnCallPoolHires === false) {
    throw new HttpsError("failed-precondition", "On-call pool hiring is disabled for this hiring entity");
  }
}
