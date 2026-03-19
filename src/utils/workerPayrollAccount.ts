/**
 * Phase 2B: Worker payroll account — get or create, update. TempWorks-first.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { WorkerPayrollAccount } from '../types/payroll';
import { workerPayrollAccountId } from '../types/payroll';

export function getWorkerPayrollAccountDocId(userId: string, entityKey: string): string {
  return workerPayrollAccountId(userId, entityKey);
}

/** Fetch worker payroll account; returns null if not found. */
export async function getWorkerPayrollAccount(
  tenantId: string,
  userId: string,
  entityKey: string
): Promise<(WorkerPayrollAccount & { id: string }) | null> {
  const id = getWorkerPayrollAccountDocId(userId, entityKey);
  const ref = doc(db, p.workerPayrollAccount(tenantId, id));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as WorkerPayrollAccount) };
}

/** Create or get worker payroll account. Creates with defaults if missing. */
export async function getOrCreateWorkerPayrollAccount(
  tenantId: string,
  userId: string,
  entityId: string,
  entityKey: string,
  entityName: string,
  workerType: 'w2' | '1099',
  payrollProvider: WorkerPayrollAccount['payrollProvider'],
  payrollMode: WorkerPayrollAccount['payrollMode'],
  employmentId?: string | null
): Promise<WorkerPayrollAccount & { id: string }> {
  const id = getWorkerPayrollAccountDocId(userId, entityKey);
  const ref = doc(db, p.workerPayrollAccount(tenantId, id));
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { id: snap.id, ...(snap.data() as WorkerPayrollAccount) };
  }
  const now = serverTimestamp();
  const newDoc: WorkerPayrollAccount & { createdAt: unknown; updatedAt: unknown } = {
    tenantId,
    userId,
    entityId,
    entityKey,
    entityName,
    employmentId: employmentId ?? null,
    workerType,
    payrollProvider,
    payrollMode,
    payrollStatus: 'not_started',
    payrollAccountLink: null,
    externalWorkerId: null,
    completionSource: null,
    directDepositStatus: null,
    taxFormStatus: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, newDoc);
  return { id, ...newDoc };
}

/** Update worker payroll account (merge). */
export async function updateWorkerPayrollAccount(
  tenantId: string,
  docId: string,
  updates: Partial<WorkerPayrollAccount> & { lastAdminVerifiedBy?: string }
): Promise<void> {
  const ref = doc(db, p.workerPayrollAccount(tenantId, docId));
  const payload: Record<string, unknown> = {
    ...updates,
    updatedAt: serverTimestamp(),
  };
  if (updates.lastAdminVerifiedBy) {
    payload.lastAdminVerifiedAt = serverTimestamp();
    payload.lastAdminVerifiedBy = updates.lastAdminVerifiedBy;
  }
  await setDoc(ref, payload, { merge: true });
}
