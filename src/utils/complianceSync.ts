/**
 * Phase 2A: Sync existing onboarding/employment outcomes into worker_compliance_items.
 * Additive only; does not remove or change existing pipeline or entity_employments data.
 */
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  type ComplianceStatus,
  type WorkerComplianceItem,
  complianceItemIdForEmployment,
  getComplianceTypeConfig,
  COMPLIANCE_ITEM_TYPES,
} from '../types/compliance';

export interface EmploymentForSync {
  id: string;
  entityId: string | null;
  entityKey: string;
  entityName: string;
  workerType?: string;
  everifyStatus?: string;
  backgroundStatus?: string;
  drugScreenStatus?: string;
  onboardingPipelineId?: string;
}

export interface PipelineStepForSync {
  id: string;
  status?: string;
  /** Milestone id → completed (e.g. handbook_signed: true). */
  milestones?: { id: string; completed?: boolean }[];
}

/** Map employment/pipeline status strings to ComplianceStatus. */
function toComplianceStatus(raw: string | undefined): ComplianceStatus {
  if (!raw) return 'not_started';
  const v = raw.toLowerCase();
  if (v === 'complete' || v === 'completed' || v === 'done') return 'complete';
  if (v === 'employment_authorized' || v === 'manual_outside_hrx') return 'complete';
  if (v === 'failed') return 'failed';
  if (v === 'not_started' || v === 'not started') return 'not_started';
  if (v === 'in_progress' || v === 'in progress' || v === 'in_review') return 'in_review';
  if (v === 'blocked') return 'pending';
  return 'pending';
}

function milestoneCompleted(milestones: { id: string; completed?: boolean }[] | undefined, milestoneId: string): boolean {
  return milestones?.some((m) => m.id === milestoneId && m.completed) ?? false;
}

/** Create or update a single compliance item (merge). */
export async function upsertComplianceItem(
  tenantId: string,
  item: Omit<WorkerComplianceItem, 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const employmentIdForId = item.employmentId ?? item.userId;
  const itemId = item.id ?? complianceItemIdForEmployment(item.userId, employmentIdForId, item.type);
  const ref = doc(db, p.workerComplianceItem(tenantId, itemId));
  const config = getComplianceTypeConfig(item.type);
  const payload: Record<string, unknown> = {
    tenantId: item.tenantId,
    userId: item.userId,
    entityId: item.entityId ?? null,
    employmentId: item.employmentId ?? null,
    category: item.category,
    type: item.type,
    title: item.title ?? config?.label ?? item.type,
    required: item.required ?? false,
    status: item.status,
    source: item.source ?? 'onboarding_package',
    documentIds: item.documentIds ?? null,
    issuedAt: item.issuedAt ?? null,
    expiresAt: item.expiresAt ?? null,
    renewalDueAt: item.renewalDueAt ?? null,
    verifiedAt: item.verifiedAt ?? null,
    verifiedBy: item.verifiedBy ?? null,
    notes: item.notes ?? null,
    metadata: item.metadata ?? null,
    updatedAt: serverTimestamp(),
  };
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: true });
}

/** Sync compliance items from entity employments and optional pipeline step data. */
export async function syncComplianceItemsFromEmployments(
  tenantId: string,
  userId: string,
  employments: EmploymentForSync[],
  pipelineByEmploymentId?: Record<string, { steps?: PipelineStepForSync[] }>
): Promise<{ createdOrUpdated: number }> {
  let createdOrUpdated = 0;
  for (const emp of employments) {
    const employmentId = emp.id;
    const steps = pipelineByEmploymentId?.[employmentId]?.steps ?? [];
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    // E-Verify: from employment.everifyStatus
    const everifyStatus = toComplianceStatus(emp.everifyStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'eligibility',
      type: 'everify',
      title: 'E-Verify',
      required: !!emp.everifyStatus || everifyStatus !== 'not_started',
      status: everifyStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    // I-9: from pipeline step i9
    const i9Step = stepMap.get('i9');
    const i9Status = i9Step ? toComplianceStatus(i9Step.status) : 'not_started';
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'eligibility',
      type: 'i9',
      title: 'I-9',
      required: true,
      status: i9Status,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    // Background check: from employment.backgroundStatus
    const bgStatus = toComplianceStatus(emp.backgroundStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'screening',
      type: 'background_check',
      title: 'Background check',
      required: !!emp.backgroundStatus || bgStatus !== 'not_started',
      status: bgStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    // Drug screen: from employment.drugScreenStatus
    const drugStatus = toComplianceStatus(emp.drugScreenStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'screening',
      type: 'drug_screen',
      title: 'Drug screen',
      required: !!emp.drugScreenStatus || drugStatus !== 'not_started',
      status: drugStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    // Onboarding-forms milestones → handbook_acknowledgment, policy_acknowledgment, contractor_agreement, w4, w9
    const onboardingFormsStep = steps.find((s) => s.id === 'onboarding_forms');
    const milestones = onboardingFormsStep?.milestones ?? [];
    const stepStatus = onboardingFormsStep?.status;
    const workerType = String(emp.workerType || '').toUpperCase();

    const handbookDone = milestoneCompleted(milestones, 'handbook_signed') || milestoneCompleted(milestones, 'handbook_sent');
    const handbookStatus = handbookDone ? 'complete' : toComplianceStatus(stepStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'acknowledgment',
      type: 'handbook_acknowledgment',
      title: 'Handbook acknowledgment',
      required: true,
      status: handbookStatus as ComplianceStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    const policyDone = milestoneCompleted(milestones, 'policy_acknowledgment') || milestoneCompleted(milestones, 'policy_acknowledgments');
    const policyStatus = policyDone ? 'complete' : toComplianceStatus(stepStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'acknowledgment',
      type: 'policy_acknowledgment',
      title: 'Policy acknowledgment',
      required: true,
      status: policyStatus as ComplianceStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    const contractorDone = milestoneCompleted(milestones, 'contractor_agreement_signed') || milestoneCompleted(milestones, 'contractor_agreement_sent');
    const contractorStatus = contractorDone ? 'complete' : toComplianceStatus(stepStatus);
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'acknowledgment',
      type: 'contractor_agreement',
      title: 'Contractor agreement',
      required: workerType === '1099',
      status: contractorStatus as ComplianceStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;

    const taxDone = milestoneCompleted(milestones, 'tax_forms');
    const taxStatus = taxDone ? 'complete' : toComplianceStatus(stepStatus);
    const taxType = workerType === '1099' ? 'w9' : 'w4';
    const taxTitle = workerType === '1099' ? 'W-9' : 'W-4';
    await upsertComplianceItem(tenantId, {
      tenantId,
      userId,
      entityId: emp.entityId,
      employmentId,
      category: 'eligibility',
      type: taxType as WorkerComplianceItem['type'],
      title: taxTitle,
      required: true,
      status: taxStatus as ComplianceStatus,
      source: 'onboarding_package',
    });
    createdOrUpdated += 1;
  }
  return { createdOrUpdated };
}

export { COMPLIANCE_ITEM_TYPES };
