/**
 * Builds the same evaluation context as `useEntityEmploymentOverview` → `buildEmploymentEntityOverview`
 * for one entity tab, using the Admin SDK. Intended for `syncEntityEmploymentOnboardingFromWorkerOnboarding`.
 *
 * **Maintenance:** When changing employment overview data loading, update this file and the hook together
 * (see comment in `useEntityEmploymentOverview`).
 */
import type * as FirebaseFirestore from 'firebase-admin/firestore';

type EmploymentEntityKey = 'select' | 'workforce' | 'events';

function deriveC1EntityKeyFromEntityName(rawName: string): EmploymentEntityKey {
  const v = String(rawName || '').toLowerCase();
  if (v.includes('select')) return 'select';
  if (v.includes('event')) return 'events';
  return 'workforce';
}

function resolveC1SelectEntityId(
  entities: Array<{ id: string; name: string; entityCode?: string }>
): string | null {
  const byCode = entities.find((e) => (e.entityCode || '').trim().toUpperCase() === 'C1SL');
  if (byCode) return byCode.id;
  const found =
    entities.find((e) => {
      const n = e.name.trim().toLowerCase();
      return n === 'c1 select llc' || /^c1\s+select\b/i.test(e.name.trim());
    }) ?? null;
  return found?.id ?? null;
}

function employmentRecordEntityKey(
  rec: { id: string; entityKey?: string },
  userId: string
): EmploymentEntityKey | null {
  const k = String(rec.entityKey || '').toLowerCase();
  if (k === 'select' || k === 'workforce' || k === 'events') return k;
  const prefix = `${userId}__`;
  if (rec.id.startsWith(prefix)) {
    const tail = rec.id.slice(prefix.length).toLowerCase();
    if (tail === 'select' || tail === 'workforce' || tail === 'events') return tail as EmploymentEntityKey;
  }
  return null;
}

function resolveEntityFirestoreIdForTab(
  entityKey: EmploymentEntityKey,
  entityBrief: Array<{ id: string; name: string; entityCode?: string }>,
  employmentForTab: { entityId?: string | null } | null
): string | null {
  if (employmentForTab?.entityId) {
    const row = entityBrief.find((e) => e.id === employmentForTab.entityId);
    const name = row?.name || '';
    if (deriveC1EntityKeyFromEntityName(name) === entityKey) {
      return employmentForTab.entityId;
    }
  }
  if (entityKey === 'select') {
    return resolveC1SelectEntityId(entityBrief);
  }
  const found = entityBrief.find((e) => deriveC1EntityKeyFromEntityName(e.name) === entityKey);
  return found?.id ?? null;
}

function buildEverifySummary(
  caseDocs: Array<{ id: string; data: () => Record<string, unknown> }>,
  selectEntityId: string | null
): Record<string, unknown> | null {
  if (!selectEntityId) {
    return { applicable: false, statusDisplay: 'No C1 Select entity', caseCount: 0 };
  }
  const selectCases = caseDocs.filter((d) => {
    const raw = d.data();
    return String(raw.entityId || '') === selectEntityId;
  });
  if (selectCases.length === 0) {
    return {
      applicable: true,
      statusDisplay: 'No cases',
      caseCount: 0,
      actionNeeded: false,
    };
  }
  const sorted = [...selectCases].sort((a, b) => {
    const ta = (a.data().updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
    const tb = (b.data().updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
    return tb - ta;
  });
  const latest = sorted[0];
  const data = latest.data();
  const pub = data.public as { status?: string } | undefined;
  const statusDisplay = String(pub?.status ?? data.status ?? '—');
  const closed = ['closed', 'closure_duplicate', 'completed', 'authorized', 'final_nonconfirmation'].some((x) =>
    statusDisplay.toLowerCase().includes(x)
  );
  return {
    applicable: true,
    statusDisplay,
    caseCount: selectCases.length,
    latestCaseId: latest.id,
    actionNeeded: !closed && !statusDisplay.includes('—'),
  };
}

function onboardingAutomationDispatchBriefFromRaw(id: string, raw: Record<string, unknown>): Record<string, unknown> {
  const det = raw.details;
  return {
    id,
    createdAt: raw.createdAt ?? null,
    eventType: String(raw.eventType ?? ''),
    messageTypeId: raw.messageTypeId != null ? String(raw.messageTypeId) : null,
    outcome: String(raw.outcome ?? ''),
    hiringEntityId: raw.hiringEntityId != null ? String(raw.hiringEntityId) : null,
    assignmentId: raw.assignmentId != null ? String(raw.assignmentId) : null,
    correlationKey: raw.correlationKey != null ? String(raw.correlationKey) : null,
    skipReason: raw.skipReason != null ? String(raw.skipReason) : null,
    details: det != null && typeof det === 'object' && !Array.isArray(det) ? (det as Record<string, unknown>) : null,
  };
}

function automationDispatchBriefMatchesEntityTab(opts: {
  brief: Record<string, unknown>;
  entityFirestoreId: string | null | undefined;
  assignmentIdsForTab: readonly string[];
}): boolean {
  const idSet = new Set(opts.assignmentIdsForTab.map((x) => String(x || '').trim()).filter(Boolean));
  const aid = String(opts.brief.assignmentId || '').trim();
  return Boolean(aid && idSet.has(aid));
}

function filterAutomationDispatchBriefsForEntityTab(
  all: Record<string, unknown>[] | undefined,
  entityFirestoreId: string | null | undefined,
  assignmentIdsForTab: readonly string[]
): Record<string, unknown>[] {
  if (!all?.length) return [];
  return all.filter((b) =>
    automationDispatchBriefMatchesEntityTab({ brief: b, entityFirestoreId, assignmentIdsForTab })
  );
}

const EMPLOYMENT_ENTITY_KEYS: EmploymentEntityKey[] = ['select', 'workforce', 'events'];

/**
 * Serializable context for `computeEntityOnboardingEngineFromBuildContext` (esbuild bundle).
 * `Maps` are reconstructed in the sync caller.
 */
export interface SerializedEngineBuildContext {
  entityKey: EmploymentEntityKey;
  entityEmployment: Record<string, unknown> | null;
  workerOnboarding: Record<string, unknown> | null;
  entitySettings: Record<string, unknown> | null;
  assignmentsRows: Array<Record<string, unknown>>;
  onboardingByInstanceId: Array<[string, Record<string, unknown>]>;
  envelopesByAssignmentId: Array<[string, Array<[string, string]>]>;
  everifySummary: Record<string, unknown> | null;
  payrollAccount: Record<string, unknown> | null;
  backgroundChecksForEntity: Record<string, unknown>[];
  allTenantWorkerBackgroundChecks: Record<string, unknown>[];
  everifyCaseBriefs: Record<string, unknown>[] | undefined;
  automationDispatchBriefs: Record<string, unknown>[] | undefined;
}

export async function loadSerializedEntityOnboardingEngineBuildContextAdmin(
  db: FirebaseFirestore.Firestore,
  options: {
    tenantId: string;
    userId: string;
    entityKey: EmploymentEntityKey;
    pipelineId: string;
    pipelineData: Record<string, unknown>;
  }
): Promise<SerializedEngineBuildContext> {
  const { tenantId, userId, entityKey, pipelineId, pipelineData } = options;

  const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
  const entityBrief = entitiesSnap.docs.map((d) => {
    const data = d.data() as { name?: string; entityCode?: string };
    return { id: d.id, name: String(data.name || d.id), entityCode: String(data.entityCode || '') };
  });
  const entityIdToKey = new Map<string, EmploymentEntityKey>();
  entityBrief.forEach((e) => {
    entityIdToKey.set(e.id, deriveC1EntityKeyFromEntityName(e.name));
  });
  const selectEntityId = resolveC1SelectEntityId(entityBrief);

  const [
    eeSnap,
    woSnap,
    assignUserSnap,
    assignCandSnap,
    casesSnap,
    bgSnap,
    dispatchSnap,
  ] = await Promise.all([
    db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', userId).get(),
    db.collection(`tenants/${tenantId}/worker_onboarding`).where('userId', '==', userId).get(),
    db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).get(),
    db.collection(`tenants/${tenantId}/assignments`).where('candidateId', '==', userId).get(),
    db.collection(`tenants/${tenantId}/everify_cases`).where('userId', '==', userId).limit(80).get(),
    db.collection('backgroundChecks').where('candidateId', '==', userId).where('tenantId', '==', tenantId).limit(120).get(),
    db.collection(`tenants/${tenantId}/onboarding_automation_dispatch`).where('userId', '==', userId).limit(120).get(),
  ]);

  const automationDispatchAll = dispatchSnap.docs.map((d) =>
    onboardingAutomationDispatchBriefFromRaw(d.id, d.data() as Record<string, unknown>)
  );

  const assignmentsMap = new Map<string, Record<string, unknown>>();
  assignUserSnap.docs.forEach((d) => assignmentsMap.set(d.id, d.data() as Record<string, unknown>));
  assignCandSnap.docs.forEach((d) => {
    if (!assignmentsMap.has(d.id)) assignmentsMap.set(d.id, d.data() as Record<string, unknown>);
  });

  const jobOrderIds = new Set<string>();
  assignmentsMap.forEach((data) => {
    const jo = data.jobOrderId as string | undefined;
    if (jo) jobOrderIds.add(jo);
  });

  const jobOrderById = new Map<
    string,
    {
      hiringEntityId?: string | null;
      effectiveHiringEntityId?: string | null;
      jobTitle?: string;
      jobOrderName?: string;
    }
  >();
  const accountHiringCache: Record<string, string | null> = {};
  const hiringEntityFromRecruiterAccount = async (recruiterAccountId: string): Promise<string | null> => {
    if (Object.prototype.hasOwnProperty.call(accountHiringCache, recruiterAccountId)) {
      return accountHiringCache[recruiterAccountId];
    }
    try {
      const accSnap = await db.doc(`tenants/${tenantId}/accounts/${recruiterAccountId}`).get();
      const hid = accSnap.exists
        ? String((accSnap.data() as { hiringEntityId?: string }).hiringEntityId || '').trim() || null
        : null;
      accountHiringCache[recruiterAccountId] = hid;
      return hid;
    } catch {
      accountHiringCache[recruiterAccountId] = null;
      return null;
    }
  };

  await Promise.all(
    Array.from(jobOrderIds).map(async (jid) => {
      try {
        let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jid}`).get();
        if (!joSnap.exists) {
          joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jid}`).get();
        }
        if (joSnap.exists) {
          const jd = joSnap.data() as Record<string, unknown>;
          const joHiring = (jd.hiringEntityId as string | null | undefined) ?? null;
          const recAcc = String(jd.recruiterAccountId || '').trim() || null;
          let effective = joHiring;
          if (!effective && recAcc) {
            effective = await hiringEntityFromRecruiterAccount(recAcc);
          }
          jobOrderById.set(jid, {
            hiringEntityId: joHiring,
            effectiveHiringEntityId: effective,
            jobTitle: jd.jobTitle as string | undefined,
            jobOrderName: (jd.jobOrderName || jd.title) as string | undefined,
          });
        }
      } catch {
        /* ignore */
      }
    })
  );

  const assignmentEntityKey = (jobOrderId: string | undefined | null): EmploymentEntityKey | null => {
    if (!jobOrderId) return null;
    const jo = jobOrderById.get(jobOrderId);
    const hid = String(jo?.effectiveHiringEntityId || jo?.hiringEntityId || '').trim() || null;
    if (!hid) return null;
    return entityIdToKey.get(hid) ?? null;
  };

  const assignmentsByKey: Record<EmploymentEntityKey, Array<Record<string, unknown>>> = {
    select: [],
    workforce: [],
    events: [],
  };

  const onboardingInstanceIds: string[] = [];
  assignmentsMap.forEach((data, aid) => {
    const jobOrderId = data.jobOrderId as string | undefined;
    const docEkRaw = String((data as { entityKey?: string }).entityKey || '').toLowerCase();
    const docEk: EmploymentEntityKey | null =
      docEkRaw === 'select' || docEkRaw === 'workforce' || docEkRaw === 'events'
        ? (docEkRaw as EmploymentEntityKey)
        : null;
    const ek = docEk ?? assignmentEntityKey(jobOrderId ?? null);
    if (!ek) return;
    const row = {
      assignmentId: aid,
      jobOrderId: jobOrderId ?? null,
      status: (data.status as string) ?? null,
      startDate: (data.startDate as string) ?? null,
      onboardingInstanceId: (data.onboardingInstanceId as string | null | undefined) ?? null,
      onboardingStatus: (data.onboardingStatus as string | undefined) ?? null,
      onboardingPercent: (data.onboardingPercent as number | undefined) ?? null,
      jobTitle: jobOrderId
        ? jobOrderById.get(jobOrderId)?.jobTitle ?? jobOrderById.get(jobOrderId)?.jobOrderName ?? null
        : null,
    };
    assignmentsByKey[ek].push(row);
    if (row.onboardingInstanceId) onboardingInstanceIds.push(row.onboardingInstanceId);
  });

  const onboardingByInstanceId = new Map<string, Record<string, unknown>>();
  await Promise.all(
    [...new Set(onboardingInstanceIds)].map(async (instanceId) => {
      try {
        const instSnap = await db.doc(`tenants/${tenantId}/onboarding_instances/${instanceId}`).get();
        if (instSnap.exists) {
          const d = instSnap.data() as Record<string, unknown>;
          onboardingByInstanceId.set(instanceId, {
            status: (d.status as string) || 'unknown',
            percentComplete: (d.percentComplete as number) ?? 0,
            resolvedDocuments: Array.isArray(d.resolvedDocuments) ? d.resolvedDocuments : [],
            resolvedSteps: Array.isArray(d.resolvedSteps) ? d.resolvedSteps : [],
            resolvedChecks: Array.isArray(d.resolvedChecks) ? d.resolvedChecks : [],
            blockedReason: (d.blockedReason as string | null) ?? null,
          });
        }
      } catch {
        /* ignore */
      }
    })
  );

  const envelopesByAssignmentId = new Map<string, Map<string, string>>();
  await Promise.all(
    Array.from(assignmentsMap.keys()).map(async (assignmentId) => {
      try {
        const snap = await db
          .collection(`tenants/${tenantId}/signature_envelopes`)
          .where('assignmentId', '==', assignmentId)
          .get();
        const byDocKey = new Map<string, string>();
        snap.docs.forEach((d) => {
          const data = d.data() as { docKey?: string; status?: string };
          if (data.docKey && data.status) byDocKey.set(data.docKey, data.status);
        });
        envelopesByAssignmentId.set(assignmentId, byDocKey);
      } catch {
        envelopesByAssignmentId.set(assignmentId, new Map());
      }
    })
  );

  const employmentsByKey: Record<EmploymentEntityKey, Record<string, unknown> | null> = {
    select: null,
    workforce: null,
    events: null,
  };
  eeSnap.docs.forEach((d) => {
    const rec = { id: d.id, ...d.data() };
    const ek = employmentRecordEntityKey(rec as { id: string; entityKey?: string }, userId);
    if (ek) employmentsByKey[ek] = rec as Record<string, unknown>;
  });

  const everifyCaseDocRefs = casesSnap.docs.map((d) => ({
    id: d.id,
    data: () => d.data() as Record<string, unknown>,
  }));
  const everifySummary = buildEverifySummary(everifyCaseDocRefs, selectEntityId);

  const payrollDocId = `${userId}__${entityKey}`;
  const payrollSnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payrollDocId}`).get();
  const payrollAccount = payrollSnap.exists ? { id: payrollSnap.id, ...payrollSnap.data() } : null;

  const bgList = bgSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => String((r as { tenantId?: string }).tenantId || '') === tenantId);

  const jobOrdersByEntity: Record<EmploymentEntityKey, Set<string>> = {
    select: new Set(),
    workforce: new Set(),
    events: new Set(),
  };
  EMPLOYMENT_ENTITY_KEYS.forEach((ek) => {
    assignmentsByKey[ek].forEach((a) => {
      const j = a.jobOrderId as string | null | undefined;
      if (j) jobOrdersByEntity[ek].add(j);
    });
  });

  const backgroundByKey: Record<EmploymentEntityKey, Record<string, unknown>[]> = {
    select: [],
    workforce: [],
    events: [],
  };
  EMPLOYMENT_ENTITY_KEYS.forEach((ek) => {
    const jset = jobOrdersByEntity[ek];
    const assignmentIdsForEk = new Set(
      assignmentsByKey[ek].map((a) => String((a as { assignmentId?: string }).assignmentId || ''))
    );
    backgroundByKey[ek] = bgList.filter((b) => {
      const r = b as { jobOrderId?: string; automationAssignmentId?: string };
      const autoAid = String(r.automationAssignmentId || '').trim();
      if (autoAid && assignmentIdsForEk.has(autoAid)) return true;
      const jo = String(r.jobOrderId || '').trim();
      if (jo && jset.has(jo)) return true;
      return false;
    }) as Record<string, unknown>[];
  });

  let entitySettings: Record<string, unknown> | null = null;
  const eid = resolveEntityFirestoreIdForTab(entityKey, entityBrief, employmentsByKey[entityKey]);
  if (eid) {
    try {
      const es = await db.doc(`tenants/${tenantId}/entities/${eid}`).get();
      if (es.exists) {
        const d = es.data() as {
          name?: string;
          workerType?: string;
          onboardingWorkflowSteps?: Record<string, boolean>;
          payrollSettings?: { onboardingUrl?: string | null; portalUrl?: string | null };
        };
        const ps = d.payrollSettings;
        entitySettings = {
          entityFirestoreId: eid,
          entityName: String(d.name || eid),
          onboardingWorkflowSteps:
            d.onboardingWorkflowSteps && typeof d.onboardingWorkflowSteps === 'object'
              ? d.onboardingWorkflowSteps
              : {},
          workerType: String(d.workerType || 'W2'),
          payrollOnboardingUrl: String(ps?.onboardingUrl || '').trim() || null,
          payrollPortalUrl: String(ps?.portalUrl || '').trim() || null,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (!entitySettings) {
    const ee = employmentsByKey[entityKey];
    entitySettings = {
      entityFirestoreId: eid || '',
      entityName: String((ee?.entityName as string) || ''),
      onboardingWorkflowSteps: {},
      workerType: String((ee?.workerType as string) || 'W2'),
      payrollOnboardingUrl: null,
      payrollPortalUrl: null,
    };
  }

  const assignmentIdsForTab = assignmentsByKey[entityKey].map((a) => String(a.assignmentId || ''));
  const automationDispatchBriefs = filterAutomationDispatchBriefsForEntityTab(
    automationDispatchAll,
    eid,
    assignmentIdsForTab
  );

  const everifyCaseBriefs =
    entityKey === 'select' && selectEntityId
      ? everifyCaseDocRefs
          .filter((d) => String(d.data().entityId || '') === selectEntityId)
          .map((d) => {
            const raw = d.data();
            const pub = raw.public as { status?: string } | undefined;
            return {
              caseId: d.id,
              entityId: String(raw.entityId || ''),
              createdAt: raw.createdAt ?? null,
              updatedAt: raw.updatedAt ?? null,
              statusDisplay: String(pub?.status ?? raw.status ?? ''),
            };
          })
      : undefined;

  const workerOnboarding = {
    id: pipelineId,
    userId,
    entityKey,
    ...pipelineData,
  };

  return {
    entityKey,
    entityEmployment: employmentsByKey[entityKey],
    workerOnboarding,
    entitySettings,
    assignmentsRows: assignmentsByKey[entityKey],
    onboardingByInstanceId: [...onboardingByInstanceId.entries()],
    envelopesByAssignmentId: [...envelopesByAssignmentId.entries()].map(([aid, m]) => [aid, [...m.entries()]] as [
      string,
      Array<[string, string]>,
    ]),
    everifySummary: everifySummary as Record<string, unknown> | null,
    payrollAccount: payrollAccount as Record<string, unknown> | null,
    backgroundChecksForEntity: backgroundByKey[entityKey],
    allTenantWorkerBackgroundChecks: bgList as Record<string, unknown>[],
    everifyCaseBriefs,
    automationDispatchBriefs,
  };
}

export function deserializeEngineBuildContext(ser: SerializedEngineBuildContext): Record<string, unknown> {
  const onboardingByInstanceId = new Map<string, unknown>(ser.onboardingByInstanceId);
  const envelopesByAssignmentId = new Map<string, Map<string, string>>();
  for (const [aid, pairs] of ser.envelopesByAssignmentId) {
    envelopesByAssignmentId.set(aid, new Map(pairs));
  }
  return {
    entityKey: ser.entityKey,
    entityEmployment: ser.entityEmployment,
    workerOnboarding: ser.workerOnboarding,
    entitySettings: ser.entitySettings,
    assignmentsRows: ser.assignmentsRows,
    onboardingByInstanceId,
    envelopesByAssignmentId,
    everifySummary: ser.everifySummary,
    payrollAccount: ser.payrollAccount,
    backgroundChecksForEntity: ser.backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks: ser.allTenantWorkerBackgroundChecks,
    everifyCaseBriefs: ser.everifyCaseBriefs,
    automationDispatchBriefs: ser.automationDispatchBriefs,
  };
}
