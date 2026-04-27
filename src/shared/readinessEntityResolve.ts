/**
 * Pure assignment ↔ entity ↔ compliance resolution for HRX Readiness V1.
 * Shared by web (`readinessEntityContext`) and Cloud Functions snapshot loader.
 */

export type EmploymentEntityKey = 'select' | 'workforce' | 'events';

export type ReadinessJobOrderHiringBrief = {
  hiringEntityId?: string | null;
  effectiveHiringEntityId?: string | null;
};

/** Minimal shapes — Firestore docs satisfy these structurally. */
export type EntityEmploymentLike = {
  id: string;
  entityKey?: string;
  entityId?: string | null;
  handbookStatus?: string | null;
  updatedAt?: unknown;
};

export type WorkerOnboardingLike = {
  id: string;
  entityKey?: string;
  externalOnboardingSteps?: unknown;
};

export type ReadinessEntityBundle = {
  entityIdToKey: Map<string, EmploymentEntityKey>;
  employmentsByKey: Record<EmploymentEntityKey, EntityEmploymentLike | null>;
  pipelinesByKey: Record<EmploymentEntityKey, WorkerOnboardingLike | null>;
  jobOrderById: Map<string, ReadinessJobOrderHiringBrief>;
};

export function deriveC1EntityKeyFromEntityName(rawName: string): EmploymentEntityKey {
  const v = String(rawName || '').toLowerCase();
  if (v.includes('select')) return 'select';
  if (v.includes('event')) return 'events';
  return 'workforce';
}

export function pipelineEntityKey(pipe: WorkerOnboardingLike, userId: string): EmploymentEntityKey | null {
  const fromField = String(pipe.entityKey || '').toLowerCase();
  if (fromField === 'select' || fromField === 'workforce' || fromField === 'events') return fromField;
  const prefix = `${userId}__`;
  if (pipe.id.startsWith(prefix)) {
    const tail = pipe.id.slice(prefix.length).toLowerCase();
    if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail as EmploymentEntityKey;
  }
  return null;
}

export function employmentRecordEntityKey(rec: EntityEmploymentLike, userId: string): EmploymentEntityKey | null {
  const k = String(rec.entityKey || '').toLowerCase();
  if (k === 'select' || k === 'workforce' || k === 'events') return k as EmploymentEntityKey;
  const prefix = `${userId}__`;
  if (rec.id.startsWith(prefix)) {
    const tail = rec.id.slice(prefix.length).toLowerCase();
    if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail as EmploymentEntityKey;
  }
  return null;
}

export function resolveAssignmentEntityKey(
  assignmentData: Record<string, unknown>,
  bundle: ReadinessEntityBundle
): EmploymentEntityKey | null {
  const docEkRaw = String((assignmentData as { entityKey?: string }).entityKey || '').toLowerCase();
  if (docEkRaw === 'select' || docEkRaw === 'workforce' || docEkRaw === 'events') {
    return docEkRaw as EmploymentEntityKey;
  }
  const jobOrderId = assignmentData.jobOrderId as string | undefined;
  if (!jobOrderId?.trim()) return null;
  const jo = bundle.jobOrderById.get(jobOrderId.trim());
  const hid = String(jo?.effectiveHiringEntityId || jo?.hiringEntityId || '').trim() || null;
  if (!hid) return null;
  return bundle.entityIdToKey.get(hid) ?? null;
}

export function hiringEntityIdForAssignment(
  assignmentData: Record<string, unknown>,
  bundle: ReadinessEntityBundle
): string | null {
  const joId = String(assignmentData.jobOrderId || '').trim() || null;
  if (!joId) return null;
  const jo = bundle.jobOrderById.get(joId);
  const hid = String(jo?.effectiveHiringEntityId || jo?.hiringEntityId || '').trim() || null;
  return hid || null;
}

export type AssignmentComplianceContext = {
  assignmentId: string;
  jobOrderId: string | null;
  entityEmploymentId: string | null;
  hiringEntityId: string | null;
};

export type ComplianceItemLike = {
  id: string;
  employmentId?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function complianceItemRelevantToAssignment(item: ComplianceItemLike, ctx: AssignmentComplianceContext): boolean {
  const md = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const mdJo = String((md as { jobOrderId?: string; job_order_id?: string }).jobOrderId ?? (md as { job_order_id?: string }).job_order_id ?? '').trim();
  const mdAid = String((md as { assignmentId?: string; assignment_id?: string }).assignmentId ?? (md as { assignment_id?: string }).assignment_id ?? '').trim();
  if (mdAid && mdAid === ctx.assignmentId) return true;
  if (mdJo && ctx.jobOrderId && mdJo === ctx.jobOrderId) return true;
  const eid = String(item.employmentId ?? '').trim();
  if (eid && ctx.entityEmploymentId && eid === ctx.entityEmploymentId) return true;
  const ent = String(item.entityId ?? '').trim();
  if (ent && ctx.hiringEntityId && ent === ctx.hiringEntityId) return true;
  return false;
}
