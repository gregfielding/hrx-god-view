import type { TenantRole } from '../contexts/AuthContext';
import type { Role, SecurityLevel } from './AccessRoles';

function parseSec(raw: unknown): number {
  const sec = parseInt(String(raw ?? '0'), 10);
  return Number.isNaN(sec) ? 0 : sec;
}

function isPrivilegedStaffRole(raw: unknown): boolean {
  const r = String(raw ?? '').trim().toLowerCase();
  return r === 'admin' || r === 'recruiter' || r === 'manager';
}

/**
 * Mirrors `canManageOnboarding` in `workerOnboardingPipeline.ts`:
 * - JWT grants staff only via Admin / Recruiter / Manager (not numeric security in the first hop).
 * - Otherwise Firestore `users/{uid}.tenantIds[tenantId]` and legacy `role` / `securityLevel`.
 *
 * Client-side gate for staff-only UI (create request, approve/reject). Server callables enforce the same rules.
 */
export function viewerCanStaffManageI9SupportingDocuments(
  tenantId: string | null | undefined,
  workerUserId: string,
  viewerUid: string | undefined,
  isHRX: boolean,
  claimsRoles: { [k: string]: TenantRole },
  tenantRolesFromProfile?: { [k: string]: { role: Role; securityLevel: SecurityLevel } } | null,
  legacyUserSecurityLevel?: SecurityLevel | null,
  legacyUserRole?: string | null,
): boolean {
  if (!tenantId || !viewerUid || viewerUid === workerUserId) return false;
  if (isHRX) return true;

  const tr = claimsRoles[tenantId];
  if (tr && (tr.role === 'Admin' || tr.role === 'Recruiter' || tr.role === 'Manager')) {
    return true;
  }

  const fr = tenantRolesFromProfile?.[tenantId];
  const roleStr = String(fr?.role ?? legacyUserRole ?? '').trim().toLowerCase();
  if (isPrivilegedStaffRole(roleStr)) return true;

  const secRaw = fr != null ? (fr.securityLevel ?? legacyUserSecurityLevel) : legacyUserSecurityLevel;
  return parseSec(secRaw) >= 4;
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
