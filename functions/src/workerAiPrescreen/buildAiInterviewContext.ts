/**
 * Builds `AiInterviewContext` from Firestore: **application + job posting** (first-class), optional **job order** merge,
 * **tenant aiPrescreen** rules, and **worker profile** only. Does not use assignment readiness snapshots or entity employment
 * for prescreen dynamic requirements.
 */
import type * as admin from 'firebase-admin';
import type { AiInterviewContext } from './aiInterviewContextTypes';
import {
  userDocHasUsablePhone,
  userDocHasBasicLocation,
  userDocHasStoredResume,
  evaluateAiPrescreenEligibility,
} from './evaluateAiPrescreenEligibility';
import {
  extractJobSliceFromJobOrder,
  extractJobSliceFromPosting,
  mergePostingAndOrderSlices,
  resolveMergedAiPrescreenPolicy,
  resolveAllowGigPath,
} from './aiPrescreenJobSlice';
import { resolveAiHiringPolicyBundle } from './aiHiringPolicyResolution';

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function workHistoryCount(userDoc: Record<string, unknown>): number {
  const rows = (userDoc.workHistory || userDoc.workExperience) as unknown;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r && typeof r === 'object').length;
}

function zipFromUser(userDoc: Record<string, unknown>): string | undefined {
  const addr = (userDoc.addressInfo as Record<string, unknown>) || {};
  const z = norm(addr.zip ?? addr.zipCode ?? userDoc.zip).replace(/\D/g, '');
  return z.length >= 5 ? z.slice(0, 5) : norm(addr.zip ?? addr.zipCode ?? userDoc.zip) || undefined;
}

/** Tenant IDs from user profile (map, array, or legacy fields). */
export function tenantIdCandidatesFromUserDoc(userDoc: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = norm(v);
    if (s) out.push(s);
  };
  push(userDoc.tenantId);
  push(userDoc.activeTenantId);
  const tids = userDoc.tenantIds;
  if (Array.isArray(tids)) {
    for (const x of tids) push(x);
  } else if (tids && typeof tids === 'object') {
    for (const k of Object.keys(tids as Record<string, unknown>)) push(k);
  }
  const seen = new Set<string>();
  return out.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Resolve `tenants/{tenantId}/applications/{applicationId}` by direct reads only (no collectionGroup).
 * Tries `tenantIdHintsInOrder` first, then tenant IDs on the user document.
 */
export async function resolveApplicationDoc(
  db: admin.firestore.Firestore,
  userId: string,
  applicationId: string,
  tenantIdHintsInOrder: string[],
  userDoc: Record<string, unknown>,
): Promise<{ tenantId: string; data: Record<string, unknown> } | null> {
  const tryTenant = async (tenantId: string) => {
    const t = norm(tenantId);
    if (!t) return null;
    const ref = db.doc(`tenants/${t}/applications/${applicationId}`);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    if (norm(data.userId || data.candidateId) !== userId) return null;
    return { tenantId: t, data };
  };

  const seen = new Set<string>();
  for (const h of tenantIdHintsInOrder) {
    const t = norm(h);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const r = await tryTenant(t);
    if (r) return r;
  }

  for (const t of tenantIdCandidatesFromUserDoc(userDoc)) {
    if (seen.has(t)) continue;
    seen.add(t);
    const r = await tryTenant(t);
    if (r) return r;
  }

  return null;
}

function syntheticPostingFromApplication(app: Record<string, unknown>): Record<string, unknown> {
  const loc = norm(app.location);
  return {
    jobTitle: norm(app.jobTitle) || norm(app.positionTitle),
    postTitle: norm(app.jobTitle) || norm(app.postTitle),
    companyName: norm(app.companyName),
    worksiteName: loc || undefined,
    location: loc || undefined,
    jobOrderId: app.jobOrderId,
  };
}

/**
 * Load structured interview context for a worker application (returns null if application missing or not owned by user).
 *
 * When `userDoc` is passed (e.g. submit-time enriched snapshot), it is used instead of a fresh read so eligibility
 * and `worker` fields stay consistent with the same document used for scoring.
 */
export async function buildAiInterviewContext(
  db: admin.firestore.Firestore,
  args: {
    userId: string;
    applicationId: string;
    tenantId?: string | null;
    /** Submit-time enriched profile; omit to read `users/{userId}` from Firestore. */
    userDoc?: Record<string, unknown> | null;
  },
): Promise<AiInterviewContext | null> {
  const { userId, applicationId, tenantId: tenantIdHint } = args;
  let userDoc: Record<string, unknown>;
  if (args.userDoc && typeof args.userDoc === 'object') {
    userDoc = args.userDoc;
  } else {
    const userSnap = await db.doc(`users/${userId}`).get();
    userDoc = (userSnap.data() || {}) as Record<string, unknown>;
  }
  const hints: string[] = [];
  if (tenantIdHint) hints.push(norm(tenantIdHint));
  const resolved = await resolveApplicationDoc(db, userId, applicationId, hints, userDoc);
  if (!resolved) return null;

  const { tenantId, data: app } = resolved;

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;

  const addr = (userDoc.addressInfo as Record<string, unknown>) || {};
  const worker: AiInterviewContext['worker'] = {
    userId,
    hasResume: userDocHasStoredResume(userDoc),
    workHistoryCount: workHistoryCount(userDoc),
    phone: userDocHasUsablePhone(userDoc),
    location: {},
  };
  if (userDocHasBasicLocation(userDoc)) {
    worker.location.city = norm(addr.city ?? userDoc.city) || undefined;
    worker.location.state = norm(addr.state ?? userDoc.state) || undefined;
    worker.location.zip = zipFromUser(userDoc);
  }

  const jobPostingId = norm(app.jobId) || norm(app.job_id);

  if (!jobPostingId) {
    const hiringPolicyEarly = await resolveAiHiringPolicyBundle(db, tenantId, tenantData, app, {});
    const prescreenEarly = resolveMergedAiPrescreenPolicy(tenantData, null);
    const eligibility = evaluateAiPrescreenEligibility(userDoc, {
      requireResumeOrSkill: prescreenEarly.eligibility.requireResumeOrSkill,
      requirePhone: prescreenEarly.eligibility.requirePhone,
      requireLocation: prescreenEarly.eligibility.requireLocation,
      requireWorkAuthorization: prescreenEarly.eligibility.requireWorkAuthorization,
    });
    return {
      worker,
      entity: {
        entityId: norm(app.companyId) || 'unknown',
        entityName: norm(app.companyName) || 'Employer',
        workerType: 'W2',
        requiresDrugScreen: false,
        requiresBackgroundCheck: false,
        requiresEVerify: false,
      },
      readiness: {
        missingRequirements: [...eligibility.missingFields],
        hasOpenScreening: false,
      },
      businessRules: {
        allowGigPath: resolveAllowGigPath({ tenant: tenantData, posting: {} }),
        tenant: tenantId,
        aiPrescreen: prescreenEarly,
      },
      hiringPolicy: hiringPolicyEarly,
      sources: { jobOrderId: null },
    };
  }

  const postingRef = db.doc(`tenants/${tenantId}/job_postings/${jobPostingId}`);
  const postingSnap = await postingRef.get();
  const postingData: Record<string, unknown> = postingSnap.exists
    ? (postingSnap.data() as Record<string, unknown>)
    : syntheticPostingFromApplication(app);

  const prescreenMerged = resolveMergedAiPrescreenPolicy(tenantData, postingData);
  const hiringPolicy = await resolveAiHiringPolicyBundle(db, tenantId, tenantData, app, postingData);

  const eligibilityMerged = evaluateAiPrescreenEligibility(userDoc, {
    requireResumeOrSkill: prescreenMerged.eligibility.requireResumeOrSkill,
    requirePhone: prescreenMerged.eligibility.requirePhone,
    requireLocation: prescreenMerged.eligibility.requireLocation,
    requireWorkAuthorization: prescreenMerged.eligibility.requireWorkAuthorization,
  });
  const profileGapsMerged = [...eligibilityMerged.missingFields];

  const resolvedOrderId = norm(app.jobOrderId) || norm(postingData.jobOrderId);

  let orderSlice = null as ReturnType<typeof extractJobSliceFromJobOrder> | null;
  if (resolvedOrderId) {
    const jobSnap = await db.doc(`tenants/${tenantId}/job_orders/${resolvedOrderId}`).get();
    if (jobSnap.exists) {
      orderSlice = extractJobSliceFromJobOrder((jobSnap.data() || {}) as Record<string, unknown>);
    }
  }

  const postingSlice = extractJobSliceFromPosting(postingData);
  const merged = mergePostingAndOrderSlices(postingSlice, orderSlice);

  const allowGigPath = resolveAllowGigPath({ tenant: tenantData, posting: postingData });

  const entity: AiInterviewContext['entity'] = {
    entityId: norm(postingData.hiringEntityId) || norm(app.companyId) || merged.hiringEntityId || 'unknown',
    entityName: merged.companyName || norm(app.companyName) || 'Employer',
    workerType: 'W2',
    requiresDrugScreen: merged.requiresDrugScreen,
    requiresBackgroundCheck: merged.requiresBackgroundCheck,
    requiresEVerify: merged.requiresEVerify,
  };

  const assignment: NonNullable<AiInterviewContext['assignment']> = {
    jobId: jobPostingId,
    jobOrderId: resolvedOrderId || null,
    title: merged.title,
    startTime: merged.startTime,
    location: merged.locationLine,
    requiresDrugScreen: merged.requiresDrugScreen,
    requiresBackgroundCheck: merged.requiresBackgroundCheck,
    physicalRequirements: merged.physicalRequirements,
    certificationsRequired: merged.certificationsRequired,
    uniformRequirements: merged.uniformRequirements,
  };

  return {
    worker,
    entity,
    assignment,
    readiness: {
      missingRequirements: profileGapsMerged,
      hasOpenScreening: false,
    },
    businessRules: {
      allowGigPath,
      tenant: tenantId,
      aiPrescreen: prescreenMerged,
    },
    hiringPolicy,
    sources: {
      jobPostingId,
      jobOrderId: resolvedOrderId || null,
    },
  };
}
