/**
 * Adjudication cases (Migration Plan P2, 2026-07-13) — the structured record
 * behind policy v1.1 §5–§7: one case per YELLOW/RED background-check review,
 * carrying the tier, the 11-factor individualized-assessment worksheet,
 * candidate response/dispute state, §6 approvals, notice log, and an
 * append-only event trail. Cases are written ONLY through these callables
 * (Firestore rules deny client writes); every mutation appends a
 * server-stamped event, so the case reconstructs the §5.2 timeline years
 * later.
 *
 * P2 records what Compliance does (the P0 runbook drives the letters by
 * hand); P3 automates notice sending + deadline timers, P4 the dispute
 * reinvestigation flow — both on top of this model.
 *
 * Path: tenants/{tenantId}/adjudication_cases/{caseId} (+ events subcoll).
 * Gates: open = AccuSource admin (recruiters route cases); every later
 * mutation = compliance reviewer (tenants/{tid}/integrations/accusource
 * .complianceReviewerUids, hrx:true exempt); approvals are role-checked
 * per §6 with distinct-signer enforcement; 'executive' approvals check
 * .executiveUids on the same config doc.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  ensureAccusourceAdmin,
  assertCallerBelongsToTenant,
  ensureAccusourceComplianceReviewer,
} from '../integrations/accusource/accusourceAdminGate';
import { accusourceLog } from '../integrations/accusource/accusourceLogger';
import { writeWorkerActivityLog } from './workerActivityLog';
import { ensureCaseDriveFolder } from './driveCaseFolders';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────

export type AdjudicationTier = 'yellow' | 'red';
export type AdjudicationCaseStatus =
  | 'open'
  | 'awaiting_candidate'
  | 'candidate_responded'
  | 'disputed'
  | 'window_expired'
  | 'closed';
export type AdjudicationDecision = 'approve' | 'deny';
export type ApprovalRole = 'compliance' | 'ops_manager' | 'executive';
export type NoticeKind = 'pre_adverse' | 'final_adverse' | 'dispute_ack';

const FACTOR_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11'] as const;

/** §6 approval matrix: which roles must have signed with this decision. */
const REQUIRED_APPROVALS: Record<AdjudicationTier, Record<AdjudicationDecision, ApprovalRole[]>> = {
  yellow: { approve: ['compliance'], deny: ['compliance', 'ops_manager'] },
  red: { approve: ['compliance', 'executive'], deny: ['compliance'] },
};

const RESPONSE_WINDOW_BUSINESS_DAYS = 5;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

/** End of the Nth business day (weekends skipped; public holidays are not —
 *  Compliance may extend manually) after `fromMs`, as epoch millis (UTC EOD). */
export function computeBusinessDayDeadlineMs(fromMs: number, businessDays: number): number {
  const d = new Date(fromMs);
  let remaining = businessDays;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  d.setUTCHours(23, 59, 59, 0);
  return d.getTime();
}

interface CaseCtx {
  tenantId: string;
  caseId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, unknown>;
  uid: string;
  token: Record<string, unknown> | undefined;
}

async function loadCase(request: CallableRequest, needCompliance: boolean): Promise<CaseCtx> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const uid = request.auth.uid;
  const token = request.auth.token as Record<string, unknown> | undefined;
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  const caseId = trim((request.data as Record<string, unknown>)?.caseId);
  if (!tenantId || !caseId) {
    throw new HttpsError('invalid-argument', 'tenantId and caseId are required.');
  }
  await ensureAccusourceAdmin(uid, tenantId);
  await assertCallerBelongsToTenant(uid, token, tenantId, 'adjudication_case');
  if (needCompliance) {
    await ensureAccusourceComplianceReviewer(uid, token, tenantId, 'adjudication_case_mutation');
  }
  const ref = db.doc(`tenants/${tenantId}/adjudication_cases/${caseId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Adjudication case not found.');
  }
  return { tenantId, caseId, ref, data: snap.data() as Record<string, unknown>, uid, token };
}

/** Append-only audit event — every mutation calls this inside its flow. */
async function appendCaseEvent(
  ref: FirebaseFirestore.DocumentReference,
  by: string,
  kind: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await ref.collection('events').add({
    at: admin.firestore.FieldValue.serverTimestamp(),
    by,
    kind,
    detail,
  });
}

async function callerDisplayName(uid: string): Promise<string> {
  try {
    const u = (await db.collection('users').doc(uid).get()).data() ?? {};
    const name = `${trim(u.firstName)} ${trim(u.lastName)}`.trim();
    return name || trim(u.email) || uid;
  } catch {
    return uid;
  }
}

async function ensureExecutive(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const cfg = (await db.doc(`tenants/${tenantId}/integrations/accusource`).get()).data() ?? {};
  const uids = cfg.executiveUids as unknown;
  if (Array.isArray(uids) && uids.map(String).includes(uid)) return;
  throw new HttpsError(
    'permission-denied',
    'Executive approval requires membership in executiveUids on the AccuSource integration settings.',
  );
}

// ─────────────────────────────────────────────────────────────────────
// openAdjudicationCase
// ─────────────────────────────────────────────────────────────────────

export const openAdjudicationCase = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  const token = request.auth.token as Record<string, unknown> | undefined;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const tenantId = trim(data.tenantId);
  const backgroundCheckId = trim(data.backgroundCheckId);
  const tier = trim(data.tier).toLowerCase() as AdjudicationTier;
  const worksiteState = trim(data.worksiteState).toUpperCase() || null;
  if (!tenantId || !backgroundCheckId) {
    throw new HttpsError('invalid-argument', 'tenantId and backgroundCheckId are required.');
  }
  if (tier !== 'yellow' && tier !== 'red') {
    throw new HttpsError('invalid-argument', "tier must be 'yellow' or 'red'.");
  }
  await ensureAccusourceAdmin(uid, tenantId);
  await assertCallerBelongsToTenant(uid, token, tenantId, 'open_adjudication_case');

  const bgcRef = db.collection('backgroundChecks').doc(backgroundCheckId);
  const bgcSnap = await bgcRef.get();
  if (!bgcSnap.exists) throw new HttpsError('not-found', 'Background check not found.');
  const bgc = bgcSnap.data() as Record<string, unknown>;
  if (trim(bgc.tenantId) && trim(bgc.tenantId) !== tenantId) {
    throw new HttpsError('permission-denied', 'Background check belongs to a different tenant.');
  }

  // Idempotency: one live case per check.
  const existingId = trim(bgc.adjudicationCaseId);
  if (existingId) {
    const existing = await db.doc(`tenants/${tenantId}/adjudication_cases/${existingId}`).get();
    if (existing.exists && trim((existing.data() ?? {}).status) !== 'closed') {
      return { ok: true, alreadyOpen: true, caseId: existingId };
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const caseRef = db.collection(`tenants/${tenantId}/adjudication_cases`).doc();
  await caseRef.set({
    tenantId,
    backgroundCheckId,
    candidateId: trim(bgc.candidateId) || null,
    candidateName: trim(bgc.candidateName) || null,
    jobOrderId: trim(bgc.jobOrderId) || null,
    accountId: trim(bgc.accountId) || null,
    accountName: trim(bgc.accountName) || null,
    packageName: trim(bgc.requestedPackageName) || null,
    worksiteState,
    tier,
    tierSetBy: uid,
    tierSetAt: now,
    status: 'open' satisfies AdjudicationCaseStatus,
    decision: null,
    convictionsSummary: '',
    factors: {},
    candidateResponse: null,
    dispute: null,
    approvals: [],
    notices: [],
    responseDeadlineAt: null,
    openedBy: uid,
    openedAt: now,
    closedBy: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await bgcRef.set(
    { adjudicationCaseId: caseRef.id, tier, updatedAt: now },
    { merge: true },
  );
  await appendCaseEvent(caseRef, uid, 'case_opened', { tier, backgroundCheckId });

  // P2.5: Drive case folder ({Shared Drive}/Background Checks/{year}/
  // {Last, First — uid}) — best-effort; the case never fails on Drive.
  const folder = await ensureCaseDriveFolder({
    tenantId,
    candidateId: trim(bgc.candidateId) || 'unknown',
    candidateName: trim(bgc.candidateName) || 'Unknown',
  });
  if (folder) {
    await caseRef.update({ driveFolderId: folder.folderId, driveFolderUrl: folder.folderUrl });
    await appendCaseEvent(caseRef, uid, 'drive_folder_ready', { folderId: folder.folderId });
  }

  const workerId = trim(bgc.candidateId);
  if (workerId) {
    await writeWorkerActivityLog({
      userId: workerId,
      action: 'adjudication_case_opened',
      description: `Background check compliance review opened (${tier.toUpperCase()} tier)`,
      severity: 'medium',
      metadata: { backgroundCheckId, caseId: caseRef.id, tier, openedBy: uid },
    }).catch(() => undefined);
  }
  accusourceLog('info', 'adjudication', 'Adjudication case opened', {
    tenantId,
    caseId: caseRef.id,
    backgroundCheckId,
    tier,
    by: uid,
  });
  return { ok: true, alreadyOpen: false, caseId: caseRef.id };
});

// ─────────────────────────────────────────────────────────────────────
// updateAdjudicationWorksheet — factors, convictions, candidate response
// ─────────────────────────────────────────────────────────────────────

export const updateAdjudicationWorksheet = onCall({ cors: true }, async (request) => {
  const ctx = await loadCase(request, true);
  if (trim(ctx.data.status) === 'closed') {
    throw new HttpsError('failed-precondition', 'Case is closed.');
  }
  const data = (request.data ?? {}) as Record<string, unknown>;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch: Record<string, unknown> = { updatedAt: now };
  const changed: string[] = [];

  if (typeof data.convictionsSummary === 'string') {
    patch.convictionsSummary = data.convictionsSummary.trim();
    changed.push('convictionsSummary');
  }
  const factors = data.factors as Record<string, unknown> | undefined;
  if (factors && typeof factors === 'object') {
    for (const key of FACTOR_KEYS) {
      if (typeof factors[key] === 'string') {
        patch[`factors.${key}`] = {
          finding: (factors[key] as string).trim(),
          enteredBy: ctx.uid,
          enteredAt: admin.firestore.Timestamp.now(),
        };
        changed.push(key);
      }
    }
  }
  const resp = data.candidateResponse as Record<string, unknown> | undefined;
  if (resp && typeof resp === 'object') {
    patch.candidateResponse = {
      receivedAt: trim(resp.receivedAtIso)
        ? admin.firestore.Timestamp.fromDate(new Date(trim(resp.receivedAtIso)))
        : admin.firestore.Timestamp.now(),
      channel: trim(resp.channel) || 'email',
      summary: trim(resp.summary),
      attachments: Array.isArray(resp.attachments) ? resp.attachments.map(String) : [],
      recordedBy: ctx.uid,
    };
    changed.push('candidateResponse');
  }
  if (changed.length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to update.');
  }
  await ctx.ref.update(patch);
  await appendCaseEvent(ctx.ref, ctx.uid, 'worksheet_updated', { fields: changed });
  return { ok: true, updated: changed };
});

// ─────────────────────────────────────────────────────────────────────
// recordAdjudicationNotice — Donna logs each letter she sends (P0/P3)
// ─────────────────────────────────────────────────────────────────────

export const recordAdjudicationNotice = onCall({ cors: true }, async (request) => {
  const ctx = await loadCase(request, true);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const kind = trim(data.kind) as NoticeKind;
  const channel = trim(data.channel) || 'email';
  const stateVariant = trim(data.stateVariant) || 'default';
  if (!['pre_adverse', 'final_adverse', 'dispute_ack'].includes(kind)) {
    throw new HttpsError('invalid-argument', "kind must be pre_adverse | final_adverse | dispute_ack.");
  }
  const status = trim(ctx.data.status) as AdjudicationCaseStatus;
  const decision = (ctx.data.decision as AdjudicationDecision | null) ?? null;
  if (kind === 'final_adverse' && decision !== 'deny') {
    throw new HttpsError(
      'failed-precondition',
      'Final adverse notice requires the case to be closed with a deny decision first (policy §5.2 step 6).',
    );
  }
  if (kind === 'dispute_ack' && status !== 'disputed') {
    throw new HttpsError('failed-precondition', 'Dispute acknowledgment requires an open dispute.');
  }
  if (kind === 'pre_adverse' && status === 'closed') {
    throw new HttpsError('failed-precondition', 'Case is closed.');
  }

  const sentAtMs = trim(data.sentAtIso) ? new Date(trim(data.sentAtIso)).getTime() : Date.now();
  const notice = {
    kind,
    channel,
    stateVariant,
    sentAt: admin.firestore.Timestamp.fromMillis(sentAtMs),
    recordedBy: ctx.uid,
    templateVersion: trim(data.templateVersion) || 'v1-draft',
  };
  const patch: Record<string, unknown> = {
    notices: admin.firestore.FieldValue.arrayUnion(notice),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  let deadlineMs: number | null = null;
  if (kind === 'pre_adverse') {
    deadlineMs = computeBusinessDayDeadlineMs(sentAtMs, RESPONSE_WINDOW_BUSINESS_DAYS);
    patch.responseDeadlineAt = admin.firestore.Timestamp.fromMillis(deadlineMs);
    patch.status = 'awaiting_candidate' satisfies AdjudicationCaseStatus;
  }
  await ctx.ref.update(patch);
  await appendCaseEvent(ctx.ref, ctx.uid, `notice_${kind}`, {
    channel,
    stateVariant,
    sentAtMs,
    ...(deadlineMs ? { responseDeadlineMs: deadlineMs } : {}),
  });

  const workerId = trim(ctx.data.candidateId);
  if (workerId) {
    await writeWorkerActivityLog({
      userId: workerId,
      action: `adjudication_notice_${kind}`,
      description: `Adverse-action notice recorded (${kind.replace('_', '-')}, ${channel})`,
      severity: 'medium',
      metadata: { caseId: ctx.caseId, kind, channel, stateVariant },
    }).catch(() => undefined);
  }
  return { ok: true, responseDeadlineMs: deadlineMs };
});

// ─────────────────────────────────────────────────────────────────────
// setAdjudicationCaseStatus — response / dispute / window transitions
// ─────────────────────────────────────────────────────────────────────

export const setAdjudicationCaseStatus = onCall({ cors: true }, async (request) => {
  const ctx = await loadCase(request, true);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = trim(data.action);
  const status = trim(ctx.data.status) as AdjudicationCaseStatus;
  if (status === 'closed') throw new HttpsError('failed-precondition', 'Case is closed.');

  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch: Record<string, unknown> = { updatedAt: now };
  const detail: Record<string, unknown> = {};

  switch (action) {
    case 'candidate_responded': {
      if (!['awaiting_candidate', 'window_expired'].includes(status)) {
        throw new HttpsError('failed-precondition', `Cannot mark responded from status '${status}'.`);
      }
      patch.status = 'candidate_responded' satisfies AdjudicationCaseStatus;
      break;
    }
    case 'dispute_opened': {
      patch.status = 'disputed' satisfies AdjudicationCaseStatus;
      patch.dispute = {
        openedAt: admin.firestore.Timestamp.now(),
        openedBy: ctx.uid,
        craTicketRef: trim(data.craTicketRef) || null,
        resolvedAt: null,
        outcome: null,
        reportCorrected: null,
      };
      break;
    }
    case 'dispute_resolved': {
      if (status !== 'disputed') {
        throw new HttpsError('failed-precondition', 'No open dispute on this case.');
      }
      const existing = (ctx.data.dispute as Record<string, unknown>) ?? {};
      const reportCorrected = data.reportCorrected === true;
      patch.dispute = {
        ...existing,
        resolvedAt: admin.firestore.Timestamp.now(),
        outcome: trim(data.outcome) || (reportCorrected ? 'report_corrected' : 'report_confirmed'),
        reportCorrected,
      };
      // Policy §5.2 step 4: corrected report restarts the clock with a fresh window.
      const deadlineMs = computeBusinessDayDeadlineMs(Date.now(), RESPONSE_WINDOW_BUSINESS_DAYS);
      patch.responseDeadlineAt = admin.firestore.Timestamp.fromMillis(deadlineMs);
      patch.status = 'awaiting_candidate' satisfies AdjudicationCaseStatus;
      detail.responseDeadlineMs = deadlineMs;
      break;
    }
    case 'window_expired': {
      if (status !== 'awaiting_candidate') {
        throw new HttpsError('failed-precondition', `Cannot expire window from status '${status}'.`);
      }
      patch.status = 'window_expired' satisfies AdjudicationCaseStatus;
      break;
    }
    case 'extend_window': {
      const days = Number(data.businessDays ?? RESPONSE_WINDOW_BUSINESS_DAYS);
      if (!Number.isFinite(days) || days <= 0 || days > 30) {
        throw new HttpsError('invalid-argument', 'businessDays must be 1-30.');
      }
      const currentDeadline = ctx.data.responseDeadlineAt as admin.firestore.Timestamp | null;
      const fromMs = currentDeadline ? currentDeadline.toMillis() : Date.now();
      const deadlineMs = computeBusinessDayDeadlineMs(fromMs, days);
      patch.responseDeadlineAt = admin.firestore.Timestamp.fromMillis(deadlineMs);
      patch.responseWindowExtended = true;
      if (status === 'window_expired') patch.status = 'awaiting_candidate';
      detail.businessDays = days;
      detail.responseDeadlineMs = deadlineMs;
      break;
    }
    default:
      throw new HttpsError(
        'invalid-argument',
        "action must be candidate_responded | dispute_opened | dispute_resolved | window_expired | extend_window.",
      );
  }

  await ctx.ref.update(patch);
  await appendCaseEvent(ctx.ref, ctx.uid, `status_${action}`, detail);
  return { ok: true, status: (patch.status as string) ?? status };
});

// ─────────────────────────────────────────────────────────────────────
// recordAdjudicationApproval — §6 signatures
// ─────────────────────────────────────────────────────────────────────

export const recordAdjudicationApproval = onCall({ cors: true }, async (request) => {
  const ctx = await loadCase(request, false); // role-specific gates below
  if (trim(ctx.data.status) === 'closed') {
    throw new HttpsError('failed-precondition', 'Case is closed.');
  }
  const data = (request.data ?? {}) as Record<string, unknown>;
  const role = trim(data.role) as ApprovalRole;
  const decision = trim(data.decision) as AdjudicationDecision;
  const rationale = trim(data.rationale);
  if (!['compliance', 'ops_manager', 'executive'].includes(role)) {
    throw new HttpsError('invalid-argument', "role must be compliance | ops_manager | executive.");
  }
  if (!['approve', 'deny'].includes(decision)) {
    throw new HttpsError('invalid-argument', "decision must be approve | deny.");
  }
  const tier = trim(ctx.data.tier) as AdjudicationTier;
  if (role === 'executive' && !(tier === 'red' && decision === 'approve')) {
    throw new HttpsError('failed-precondition', 'Executive sign-off applies to RED-tier hire overrides.');
  }
  if (role === 'executive' && !rationale) {
    throw new HttpsError('invalid-argument', 'Executive RED override requires a written rationale (policy §6).');
  }

  // Role gates
  if (role === 'compliance') {
    await ensureAccusourceComplianceReviewer(ctx.uid, ctx.token, ctx.tenantId, 'approval_compliance');
  } else if (role === 'executive') {
    await ensureExecutive(ctx.uid, ctx.token, ctx.tenantId);
  } // ops_manager: the admin/L5 gate in loadCase suffices

  // Distinct-signer rule (§6): the same person cannot sign two roles.
  const approvals = Array.isArray(ctx.data.approvals)
    ? (ctx.data.approvals as Array<Record<string, unknown>>)
    : [];
  if (approvals.some((a) => trim(a.role) !== role && trim(a.uid) === ctx.uid)) {
    throw new HttpsError(
      'failed-precondition',
      'The same person cannot sign more than one approval role on a case (policy §6).',
    );
  }
  if (approvals.some((a) => trim(a.role) === role)) {
    throw new HttpsError('failed-precondition', `A ${role} approval is already recorded.`);
  }

  const entry = {
    role,
    decision,
    rationale: rationale || null,
    uid: ctx.uid,
    name: await callerDisplayName(ctx.uid),
    at: admin.firestore.Timestamp.now(),
  };
  await ctx.ref.update({
    approvals: admin.firestore.FieldValue.arrayUnion(entry),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await appendCaseEvent(ctx.ref, ctx.uid, 'approval_recorded', { role, decision });
  return { ok: true, role, decision };
});

// ─────────────────────────────────────────────────────────────────────
// closeAdjudicationCase — validates the §5/§6 process before a decision
// ─────────────────────────────────────────────────────────────────────

export const closeAdjudicationCase = onCall({ cors: true }, async (request) => {
  const ctx = await loadCase(request, true);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const decision = trim(data.decision) as AdjudicationDecision;
  if (!['approve', 'deny'].includes(decision)) {
    throw new HttpsError('invalid-argument', "decision must be approve | deny.");
  }
  const status = trim(ctx.data.status) as AdjudicationCaseStatus;
  const tier = trim(ctx.data.tier) as AdjudicationTier;
  if (status === 'closed') throw new HttpsError('failed-precondition', 'Case is already closed.');
  if (status === 'disputed') {
    throw new HttpsError('failed-precondition', 'Cannot decide while a dispute is open (policy §5.2 step 4).');
  }

  if (decision === 'deny') {
    // §5.2: a denial requires the pre-adverse notice + an elapsed/answered window.
    const notices = Array.isArray(ctx.data.notices)
      ? (ctx.data.notices as Array<Record<string, unknown>>)
      : [];
    if (!notices.some((n) => trim(n.kind) === 'pre_adverse')) {
      throw new HttpsError(
        'failed-precondition',
        'Denial requires a recorded pre-adverse notice (policy §5.2 step 2).',
      );
    }
    if (!['candidate_responded', 'window_expired'].includes(status)) {
      const deadline = ctx.data.responseDeadlineAt as admin.firestore.Timestamp | null;
      const elapsed = deadline != null && deadline.toMillis() < Date.now();
      if (!elapsed) {
        throw new HttpsError(
          'failed-precondition',
          'Denial requires the candidate response window to have elapsed or a recorded response (policy §5.2 step 3).',
        );
      }
    }
  }

  // §6 approval matrix
  const required = REQUIRED_APPROVALS[tier]?.[decision] ?? ['compliance'];
  const approvals = Array.isArray(ctx.data.approvals)
    ? (ctx.data.approvals as Array<Record<string, unknown>>)
    : [];
  const missing = required.filter(
    (r) => !approvals.some((a) => trim(a.role) === r && trim(a.decision) === decision),
  );
  if (missing.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Missing ${missing.join(' + ')} approval(s) for a ${tier.toUpperCase()} ${decision} (policy §6).`,
    );
  }

  // Worksheet completeness: all 11 factors must carry an entry before a denial.
  if (decision === 'deny') {
    const factors = (ctx.data.factors as Record<string, unknown>) ?? {};
    const empty = FACTOR_KEYS.filter((k) => {
      const f = factors[k] as Record<string, unknown> | undefined;
      return !f || trim(f.finding) === '';
    });
    if (empty.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Worksheet incomplete: factors ${empty.join(', ')} need an entry (write "N/A" where a factor does not apply).`,
      );
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await ctx.ref.update({
    status: 'closed' satisfies AdjudicationCaseStatus,
    decision,
    closedBy: ctx.uid,
    closedAt: now,
    updatedAt: now,
  });
  await db.collection('backgroundChecks').doc(trim(ctx.data.backgroundCheckId)).set(
    { adjudicationCaseDecision: decision, adjudicationCaseClosedAt: now, updatedAt: now },
    { merge: true },
  );
  await appendCaseEvent(ctx.ref, ctx.uid, 'case_closed', { decision, tier });

  const workerId = trim(ctx.data.candidateId);
  if (workerId) {
    await writeWorkerActivityLog({
      userId: workerId,
      action: 'adjudication_case_closed',
      description: `Background check compliance review closed: ${decision}`,
      severity: 'medium',
      metadata: { caseId: ctx.caseId, decision, tier },
    }).catch(() => undefined);
  }
  accusourceLog('info', 'adjudication', 'Adjudication case closed', {
    tenantId: ctx.tenantId,
    caseId: ctx.caseId,
    decision,
    tier,
    by: ctx.uid,
  });
  return { ok: true, decision };
});
