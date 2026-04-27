/**
 * Loads Firestore inputs for HRX V1 assignment readiness (aligned with Profile Readiness tab),
 * then returns `BuildAssignmentReadinessArgs` for `buildAssignmentReadiness` (shared engine).
 *
 * **R.4 (2026-04-26):** loader was extended to also read the two readiness
 * item collections — `tenants/{tid}/assignmentReadinessItems` filtered to
 * the assignment, and `tenants/{tid}/employeeReadinessItems` filtered to
 * the worker × hiring entity — so the bridge in `buildAssignmentReadiness`
 * can compute the Job Readiness chip as part of the same snapshot write.
 * The cross-collection read is the load-bearing piece per Greg's R.4
 * greenlight: AccuSource and E-Verify land on the employee side, so a
 * chip that only read assignment items would miss background-check
 * status entirely.
 */

import type * as admin from 'firebase-admin';
import type {
  AssignmentReadinessScreeningInput,
  AssignmentReadinessAssignmentInput,
  BuildAssignmentReadinessArgs,
} from '../../../src/shared/buildAssignmentReadiness';
import type { AssignmentReadinessItem } from '../../../src/shared/assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../../../src/shared/employeeReadinessItemV1';
import type { EmploymentEntityKey } from '../../../src/shared/readinessEntityResolve';
import {
  deriveC1EntityKeyFromEntityName,
  employmentRecordEntityKey,
  pipelineEntityKey,
  complianceItemRelevantToAssignment,
  hiringEntityIdForAssignment,
  resolveAssignmentEntityKey,
  type ReadinessEntityBundle,
  type ReadinessJobOrderHiringBrief,
  type EntityEmploymentLike,
  type WorkerOnboardingLike,
} from '../../../src/shared/readinessEntityResolve';
import { assignmentReadinessEmploymentFromPipeline } from '../../../src/utils/employmentMinimalChecklistModel';
import { resolveEntityFirestoreIdForTab } from '../../../src/utils/employmentEntityPresentation';
import type {
  EmploymentEntityKey as C1EmploymentEntityKey,
  EntityEmploymentRecord,
} from '../../../src/pages/UserProfile/components/employment-v2/employmentV2Types';
import { workerPayrollAccountId, type WorkerPayrollAccount } from '../../../src/types/payroll';
import { getWorkAuthorizedStatus } from '../../../src/utils/workAuthorizedDisplay';
import { getComplianceTypeLabel } from '../../../src/types/compliance';
import { mergeAssignmentScreeningFromJobOrder } from '../../../src/shared/assignmentScreeningSignals';
import { mergeJobOrderSyntheticCertificationDemands } from '../../../src/shared/jobOrderSyntheticCertificationDemands';

function screeningForAssignment(
  assignmentId: string,
  records: Array<Record<string, unknown> & { id?: string }>,
): AssignmentReadinessScreeningInput {
  const linked = records.filter((r) => String(r.automationAssignmentId || '') === assignmentId);
  if (!linked.length) return {};

  const bgComplete = linked.some(
    (r) =>
      r.hrxStatus === 'completed' ||
      r.orderCompleted === true ||
      r.finalReportReady === true,
  );
  const bgOrdered = linked.some((r) => {
    const st = String(r.hrxStatus || '');
    return st && !['draft', 'completed', 'canceled'].includes(st);
  });

  const drugComplete = linked.some(
    (r) => r.drugReportReady === true || r.hrxStatus === 'drug_report_ready',
  );
  const drugOrdered = linked.some((r) => {
    const pkg = String(r.requestedPackageName || '').toLowerCase();
    if (pkg.includes('drug')) return r.hrxStatus !== 'completed' && r.hrxStatus !== 'canceled';
    return r.drugReportReady === false && r.hrxStatus && !['draft', 'completed', 'canceled'].includes(String(r.hrxStatus));
  });

  return {
    backgroundComplete: bgComplete,
    backgroundOrdered: bgOrdered || bgComplete,
    drugScreenComplete: drugComplete,
    drugScreenOrdered: drugOrdered || drugComplete,
  };
}

async function fetchJobOrderBrief(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  accountHiringCache: Record<string, string | null>
): Promise<ReadinessJobOrderHiringBrief | null> {
  try {
    let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) {
      joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`).get();
    }
    if (!joSnap.exists) return null;
    const jd = joSnap.data() as Record<string, unknown>;
    const joHiring = (jd.hiringEntityId as string | null | undefined) ?? null;
    const recAcc = String(jd.recruiterAccountId || '').trim() || null;
    let effective = joHiring;
    if (!effective && recAcc) {
      if (Object.prototype.hasOwnProperty.call(accountHiringCache, recAcc)) {
        effective = accountHiringCache[recAcc];
      } else {
        try {
          const accSnap = await db.doc(`tenants/${tenantId}/accounts/${recAcc}`).get();
          const hid = accSnap.exists
            ? String((accSnap.data() as { hiringEntityId?: string }).hiringEntityId || '').trim() || null
            : null;
          accountHiringCache[recAcc] = hid;
          effective = hid;
        } catch {
          accountHiringCache[recAcc] = null;
          effective = null;
        }
      }
    }
    return { hiringEntityId: joHiring, effectiveHiringEntityId: effective };
  } catch {
    return null;
  }
}

async function buildEntityBundleForAssignment(
  db: admin.firestore.Firestore,
  tenantId: string,
  workerUserId: string,
  assignmentData: Record<string, unknown>
): Promise<{ bundle: ReadinessEntityBundle; entityBrief: Array<{ id: string; name: string; entityCode?: string }> }> {
  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const entityBrief = entitiesSnap.docs.map((d) => {
    const data = d.data() as { name?: string; entityCode?: string };
    return { id: d.id, name: String(data.name || d.id), entityCode: String(data.entityCode || '') };
  });
  const entityIdToKey = new Map<string, EmploymentEntityKey>();
  entityBrief.forEach((e) => {
    entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
  });

  const [eeSnap, woSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', workerUserId).get(),
    db.collection(`tenants/${tenantId}/worker_onboarding`).where('userId', '==', workerUserId).get(),
  ]);

  const employmentsByKey: Record<string, EntityEmploymentLike | null> = {
    select: null,
    workforce: null,
    events: null,
  };
  eeSnap.docs.forEach((d) => {
    const rec = { id: d.id, ...(d.data() as Record<string, unknown>) } as EntityEmploymentLike;
    const ek = employmentRecordEntityKey(rec, workerUserId);
    if (ek) employmentsByKey[ek] = rec;
  });

  const pipelinesByKey: Record<string, WorkerOnboardingLike | null> = {
    select: null,
    workforce: null,
    events: null,
  };
  woSnap.docs.forEach((d) => {
    const pipe = { id: d.id, ...(d.data() as Record<string, unknown>) } as WorkerOnboardingLike;
    const ek = pipelineEntityKey(pipe, workerUserId);
    if (ek) pipelinesByKey[ek] = pipe;
  });

  const jobOrderById = new Map<string, ReadinessJobOrderHiringBrief>();
  const joId = String(assignmentData.jobOrderId || '').trim();
  const accountHiringCache: Record<string, string | null> = {};
  if (joId) {
    const brief = await fetchJobOrderBrief(db, tenantId, joId, accountHiringCache);
    if (brief) jobOrderById.set(joId, brief);
  }

  return {
    bundle: {
      entityIdToKey,
      employmentsByKey: employmentsByKey as ReadinessEntityBundle['employmentsByKey'],
      pipelinesByKey: pipelinesByKey as ReadinessEntityBundle['pipelinesByKey'],
      jobOrderById,
    },
    entityBrief,
  };
}

async function fetchJobOrderDataForReadiness(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string
): Promise<Record<string, unknown> | null> {
  try {
    let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!joSnap.exists) {
      joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`).get();
    }
    if (!joSnap.exists) return null;
    return joSnap.data() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assignmentInputFromDoc(
  id: string,
  data: Record<string, unknown>,
  jobOrder: Record<string, unknown> | null | undefined
): AssignmentReadinessAssignmentInput {
  const parts = [
    data.shiftTitle,
    data.jobTitle,
    data.roleTitle,
    data.companyDisplayName,
    data.companyName,
    data.customerName,
  ]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
  const name = (parts[0] as string) || 'Assignment';
  const screening = mergeAssignmentScreeningFromJobOrder(data, jobOrder ?? null);
  return {
    id,
    name,
    status: String(data.status || data.assignmentStatus || data.confirmationStatus || '—'),
    requiresBackgroundCheck: screening.showBackgroundChecks,
    requiresDrugScreen: screening.drugScreenRequired,
  };
}

/**
 * Returns null if assignment missing or worker user id cannot be resolved.
 */
export async function loadHrxReadinessBuildArgsAdmin(
  db: admin.firestore.Firestore,
  params: { tenantId: string; assignmentId: string }
): Promise<BuildAssignmentReadinessArgs | null> {
  const { tenantId, assignmentId } = params;
  const assignRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const assignSnap = await assignRef.get();
  if (!assignSnap.exists) return null;
  const a = assignSnap.data() as Record<string, unknown>;
  const workerUserId = String(a.userId || a.candidateId || '').trim();
  if (!workerUserId) return null;

  const joId = String(a.jobOrderId || '').trim();
  const jobOrderData = joId ? await fetchJobOrderDataForReadiness(db, tenantId, joId) : null;
  const assignmentInput = assignmentInputFromDoc(assignmentId, a, jobOrderData);

  const [userSnap, complianceSnap, bgSnap] = await Promise.all([
    db.doc(`users/${workerUserId}`).get(),
    db.collection(`tenants/${tenantId}/worker_compliance_items`).where('userId', '==', workerUserId).limit(80).get(),
    db
      .collection('backgroundChecks')
      .where('candidateId', '==', workerUserId)
      .where('tenantId', '==', tenantId)
      .limit(120)
      .get(),
  ]);

  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
  const userInput = { workAuthorization: getWorkAuthorizedStatus(userData) === 'yes' };

  const { bundle: entityBundle, entityBrief } = await buildEntityBundleForAssignment(db, tenantId, workerUserId, a);
  const ek = resolveAssignmentEntityKey(a, entityBundle);
  const ee = ek ? entityBundle.employmentsByKey[ek] : null;
  const pipe = ek ? entityBundle.pipelinesByKey[ek] : null;

  let entityWorkerTypeRaw: string | null = null;
  let payrollAccount: (Record<string, unknown> & { id?: string }) | null = null;

  if (ek) {
    const eid = resolveEntityFirestoreIdForTab(ek as C1EmploymentEntityKey, entityBrief, (ee as EntityEmploymentRecord | null) ?? null);
    if (eid) {
      const es = await db.doc(`tenants/${tenantId}/entities/${eid}`).get();
      if (es.exists) {
        const w = String((es.data() as { workerType?: string }).workerType || '').trim();
        entityWorkerTypeRaw = w || null;
      }
    }
    const payId = workerPayrollAccountId(workerUserId, ek);
    const paySnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payId}`).get();
    if (paySnap.exists) {
      payrollAccount = { id: paySnap.id, ...(paySnap.data() as Record<string, unknown>) };
    }
  }

  const employmentInput =
    ek != null
      ? assignmentReadinessEmploymentFromPipeline({
          entityKey: ek,
          entityEmployment: ee,
          workerOnboarding: pipe,
          entityWorkerTypeRaw,
          workerPayrollAccount: payrollAccount as WorkerPayrollAccount & { id: string },
        })
      : {};

  const hiringEntityId = hiringEntityIdForAssignment(a, entityBundle);
  const jobOrderId = String(a.jobOrderId || '').trim() || null;
  const ctx = {
    assignmentId,
    jobOrderId,
    entityEmploymentId: ee?.id ?? null,
    hiringEntityId,
  };

  const certificationsFromCompliance = complianceSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    .filter((row) => complianceItemRelevantToAssignment(row, ctx))
    .map((row) => {
      const st = String(row.status || '').toLowerCase();
      const legacyDone = Boolean((row as { completed?: boolean }).completed);
      const done = st === 'complete' || st === 'approved' || legacyDone;
      const title = String(row.title || '').trim();
      const label = title || getComplianceTypeLabel(String(row.type || ''));
      return { key: row.id, label, complete: done };
    });

  const certifications = mergeJobOrderSyntheticCertificationDemands(jobOrderData, certificationsFromCompliance);

  const bgRecords = bgSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const screening = screeningForAssignment(assignmentId, bgRecords);

  // R.4 — cross-collection load for the Job Readiness chip. Both queries are
  // tenant-scoped indexed lookups (no fan-out). When `hiringEntityId` cannot
  // be resolved the employee-side query is skipped; the chip degrades to
  // assignment-only inputs and the Background Check / E-Verify rows will
  // show as missing in the popover (correct given we couldn't tie them).
  const [assignmentReadinessItemsSnap, employeeReadinessItemsSnap] = await Promise.all([
    db
      .collection(`tenants/${tenantId}/assignmentReadinessItems`)
      .where('assignmentId', '==', assignmentId)
      .get(),
    hiringEntityId
      ? db
          .collection(`tenants/${tenantId}/employeeReadinessItems`)
          .where('workerUid', '==', workerUserId)
          .where('hiringEntityId', '==', hiringEntityId)
          .get()
      : Promise.resolve(null),
  ]);
  const assignmentReadinessItems = assignmentReadinessItemsSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as AssignmentReadinessItem,
  );
  const employeeReadinessItems = employeeReadinessItemsSnap
    ? employeeReadinessItemsSnap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as EmployeeReadinessItem,
      )
    : [];

  // `readinessSeededAt` is stamped by the seeder runner (see
  // `seedAssignmentReadinessItemsRunner.ts`). Pre-existing assignments
  // without the field but with items already seeded are treated as seeded
  // (`assignmentReadinessItems.length > 0`) so legacy chips don't degrade
  // to `'computing'` after the R.4 deploy.
  const readinessSeededAt = a.readinessSeededAt;
  const readinessSeeded =
    Boolean(readinessSeededAt) || assignmentReadinessItems.length > 0;

  return {
    user: userInput,
    employment: employmentInput,
    assignment: assignmentInput,
    screening,
    certifications,
    assignmentReadinessItems,
    employeeReadinessItems,
    readinessSeeded,
  };
}
