import type { TenantRole } from '../contexts/AuthContext';

/**
 * Client-side gate for staff-only UI (create request, approve/reject). Server callables enforce `canManageOnboarding`.
 */
export function viewerCanStaffManageI9SupportingDocuments(
  tenantId: string | null | undefined,
  workerUserId: string,
  viewerUid: string | undefined,
  isHRX: boolean,
  claimsRoles: { [k: string]: TenantRole },
): boolean {
  if (!tenantId || !viewerUid || viewerUid === workerUserId) return false;
  if (isHRX) return true;
  const tr = claimsRoles[tenantId];
  if (!tr) return false;
  const role = tr.role;
  if (role === 'Admin' || role === 'Recruiter' || role === 'Manager') return true;
  const sec = parseInt(String(tr.securityLevel ?? '0'), 10);
  return !Number.isNaN(sec) && sec >= 4;
}

const SAFE_NAME_RE = /[^a-zA-Z0-9._-]+/g;

export function sanitizeI9SupportingUploadFileName(raw: string): string {
  const base = String(raw || 'upload').split(/[/\\]/).pop() || 'upload';
  const cleaned = base.replace(SAFE_NAME_RE, '_').replace(/_+/g, '_').slice(0, 180);
  return cleaned || 'upload';
}

/** Canonical Storage object path; `documentId` is the stable Firestore doc id. */
export function buildI9SupportingStorageObjectPath(
  tenantId: string,
  workerUserId: string,
  documentId: string,
  fileName: string,
): string {
  const safe = sanitizeI9SupportingUploadFileName(fileName);
  return `i9_docs/${tenantId}/${workerUserId}/${documentId}/${safe}`;
}
