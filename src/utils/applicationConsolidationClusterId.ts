/**
 * Sprint 4 PR2: deterministic bounded cluster id for duplicate application groups.
 * Node/script/test only (uses crypto); not imported by browser bundles.
 *
 * Input fingerprints MUST be `storage:docId` (e.g. `tenant:abc`, `nested:def`).
 * They are sorted lexicographically before hashing so order of docs does not matter.
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

import { createHash } from 'crypto';

export type ConsolidationStorageKind = 'tenant' | 'nested';

export function fingerprintForConsolidationDoc(
  storage: ConsolidationStorageKind,
  docId: string
): string {
  return `${storage}:${String(docId ?? '').trim()}`;
}

/**
 * Bounded id (32 hex chars) for Firestore doc id: application_consolidation_review/{clusterId}.
 */
export function makeConsolidationClusterId(
  tenantId: string,
  jobOrderId: string,
  storageDocFingerprints: string[]
): string {
  const tid = String(tenantId ?? '').trim();
  const jo = String(jobOrderId ?? '').trim();
  const sorted = [...storageDocFingerprints]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .sort((x, y) => x.localeCompare(y));
  const payload = `${tid}\n${jo}\n${sorted.join('\n')}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
