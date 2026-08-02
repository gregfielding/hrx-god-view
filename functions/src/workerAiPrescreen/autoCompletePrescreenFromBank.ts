/**
 * Zero-delta auto-complete: when a worker's answer bank freshly covers every question a new
 * application's interview would ask, complete the interview server-side (same scoring + writes as
 * a typed submission) so the interview-SMS cadence never starts.
 * See docs/prescreen-cumulative-interview.md.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { buildAiInterviewContext } from './buildAiInterviewContext';
import { buildDynamicPrescreenSteps } from './buildDynamicPrescreenQuestions';
import { applyPrescreenDynamicDedupe } from './prescreenDynamicDedupe';
import { readPrescreenAnswerBank } from './prescreenAnswerBankStore';
import {
  computePrescreenBankDelta,
  freshPrescreenBankAnswers,
  type FreshPrescreenBankAnswers,
} from '../shared/prescreenAnswerBank';
import { userDocNeedsLegalFirstNameConfirm } from './legalFirstNameConfirm';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import { PRESCREEN_MIN_SUBSTANTIVE_WORDS } from './prescreenTextAnswerQuality';
import {
  performPrescreenSubmission,
  validateComplianceDisclosureFollowUps,
} from './submitWorkerAiPrescreenInterview';
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';

export const AUTO_CARRYOVER_ENTRY_SOURCE = 'auto_carryover_zero_delta';

export type AutoCompletePrescreenResult =
  | 'completed'
  | 'delta_nonzero'
  | 'not_applicable'
  | 'error';

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function emptyAnswers(): WorkerAiPrescreenAnswers {
  return {
    opening_target_work_types: [],
    opening_schedule_preferences: [],
    opening_experience_industrial: [],
    opening_experience_hospitality: [],
    opening_experience_events: [],
    opening_experience_clerical: [],
    opening_experience_healthcare: [],
    opening_gig_types: [],
    motivation: '',
    experience_details: '',
    work_confidence: [],
    pressure_situation: '',
    attendance_issues: '',
    attendance_explanation: '',
    transportation_plan: '',
    backup_transportation: '',
    physical_comfort: '',
    drug_screen: '',
    drug_screen_detail: '',
    background_check: '',
    background_check_detail: '',
    background_offense_class: '',
    background_offense_when: '',
    supervisor_feedback: '',
    additional_notes: '',
  } as WorkerAiPrescreenAnswers;
}

function dedupeCoreShape(fresh: FreshPrescreenBankAnswers): {
  attendance_issues: string;
  transportation_plan: string;
  backup_transportation: string;
  physical_comfort: string;
} {
  return {
    attendance_issues: String(fresh.coreAnswers.attendance_issues ?? ''),
    transportation_plan: String(fresh.coreAnswers.transportation_plan ?? ''),
    backup_transportation: String(fresh.coreAnswers.backup_transportation ?? ''),
    physical_comfort: String(fresh.coreAnswers.physical_comfort ?? ''),
  };
}

/**
 * Full answer set from fresh bank answers — mirrors the client's `buildAnswersForSubmit` +
 * `ensureFastPathNarrativePadding` (strong-experience interviews store padded narratives, so
 * padding here only fires when the bank predates that behavior).
 */
function buildAnswersFromBank(
  fresh: FreshPrescreenBankAnswers,
  dynamicStepIds: Set<string>,
): WorkerAiPrescreenAnswers {
  const out = emptyAnswers() as unknown as Record<string, unknown>;
  for (const [id, v] of Object.entries(fresh.coreAnswers)) {
    out[id] = Array.isArray(v) ? v.map((x) => String(x)) : String(v);
  }

  const attendanceYes = String(out.attendance_issues ?? '').trim().toLowerCase() === 'yes';
  if (!attendanceYes) out.attendance_explanation = '';

  const dynTok = (id: string): string =>
    String(fresh.dynamicAnswers[id] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (dynamicStepIds.has('dyn_job_drug_screen')) {
    const v = dynTok('dyn_job_drug_screen');
    out.drug_screen = v === 'yes' || v === 'no' || v === 'not_sure' ? v : 'not_sure';
  }
  if (dynamicStepIds.has('dyn_job_background_check')) {
    const v = dynTok('dyn_job_background_check');
    out.background_check = v === 'yes' || v === 'no' || v === 'not_sure' ? v : 'not_sure';
  }
  if (String(out.background_check ?? '').trim().toLowerCase() !== 'yes') {
    out.background_offense_class = '';
    out.background_offense_when = '';
  }

  const exp = String(out.experience_details ?? '').trim();
  const snippet = exp.length > 40 ? `${exp.slice(0, 200)}…` : exp || 'my recent work history and availability.';
  const pad = (existing: string, lead: string): string => {
    if (wordCount(existing) >= PRESCREEN_MIN_SUBSTANTIVE_WORDS) return existing;
    return `${lead} ${snippet} I can share more in a follow-up conversation with the team.`.trim();
  };
  out.motivation = pad(String(out.motivation ?? ''), 'My goals align with roles that fit');
  out.pressure_situation = pad(
    String(out.pressure_situation ?? ''),
    'I stay calm under pressure. Context from my background:',
  );

  return out as unknown as WorkerAiPrescreenAnswers;
}

/**
 * Auto-complete this application's prescreen from the worker's answer bank when the delta is zero.
 * Safe to call from any trigger — every non-applicable/edge path is a quiet no-op.
 */
export async function maybeAutoCompletePrescreenFromBank(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  applicationId: string;
  userId: string;
  /** Pass when the caller already has them (avoids re-reads); fetched otherwise. */
  applicationData?: Record<string, unknown> | null;
  userData?: Record<string, unknown> | null;
  source: string;
}): Promise<AutoCompletePrescreenResult> {
  const { db, tenantId, applicationId, userId, source } = args;
  try {
    let appData = args.applicationData ?? null;
    if (!appData) {
      const snap = await db.doc(`tenants/${tenantId}/applications/${applicationId}`).get();
      appData = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    }
    if (!appData) return 'not_applicable';
    if (appData.workerAiPrescreenInterviewCompletedAt) return 'not_applicable';
    if (normalizeApplicationStatus(String(appData.status ?? '')) !== 'submitted') {
      return 'not_applicable';
    }

    const bank = await readPrescreenAnswerBank(db, userId);
    if (Object.keys(bank).length === 0) return 'delta_nonzero';

    let userData = args.userData ?? null;
    if (!userData) {
      const uSnap = await db.collection('users').doc(userId).get();
      userData = (uSnap.data() || {}) as Record<string, unknown>;
    }
    if (userDocNeedsLegalFirstNameConfirm(userData)) return 'delta_nonzero';

    const ctx = await buildAiInterviewContext(db, {
      userId,
      applicationId,
      tenantId,
      userDoc: userData,
    });
    if (!ctx) return 'not_applicable';
    if (ctx.hiringPolicy?.resolvedInterview?.workerAiPrescreenRequired === false) {
      return 'not_applicable';
    }

    const dynamicSteps = buildDynamicPrescreenSteps(ctx);
    const dynamicStepIds = new Set(dynamicSteps.map((s) => s.id));
    const fresh = freshPrescreenBankAnswers(bank, Date.now());
    const dedupe = applyPrescreenDynamicDedupe(dynamicSteps, dedupeCoreShape(fresh), fresh.dynamicAnswers);
    const delta = computePrescreenBankDelta({
      fresh,
      dynamicStepIds: dynamicSteps.map((s) => s.id),
      dedupeCoveredDynamicIds: dedupe.skipped.map((s) => s.id),
      needsLegalNameConfirm: false,
    });
    if (!delta.zeroDelta) return 'delta_nonzero';

    const answers = buildAnswersFromBank(fresh, dynamicStepIds);
    const dynamicAnswers: Record<string, string> = {};
    for (const step of dynamicSteps) {
      const v = String(dedupe.mergedDynamicAnswers[step.id] ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (v === 'yes' || v === 'no' || v === 'not_sure') dynamicAnswers[step.id] = v;
    }

    try {
      validateComplianceDisclosureFollowUps(answers, dynamicStepIds);
    } catch {
      // Bank says zero-delta but compliance detail rules disagree — fall back to a live interview.
      return 'delta_nonzero';
    }

    const result = await performPrescreenSubmission({
      db,
      uid: userId,
      answers,
      dynamicAnswers,
      dynamicSteps,
      dynamicStepIds,
      interviewContext: ctx,
      applicationId,
      tenantIdHint: tenantId,
      enrichedUd: userData,
      entrySource: AUTO_CARRYOVER_ENTRY_SOURCE,
      askedStepIds: new Set<string>(),
      legalFirstNameToPersist: null,
      needsLegalFirstNameConfirm: false,
      autoCompletedFromBank: true,
    });

    logger.info('prescreen.auto_completed_from_bank', {
      tenantId,
      applicationId,
      userId,
      source,
      interviewId: result.interviewId,
      overallScore: result.overallScore,
      coveredCoreCount: delta.coveredCoreStepIds.length,
      coveredDynamicCount: delta.coveredDynamicStepIds.length,
    });
    return 'completed';
  } catch (e) {
    logger.warn('prescreen.auto_complete_from_bank_failed', {
      tenantId,
      applicationId,
      userId,
      source,
      message: e instanceof Error ? e.message : String(e),
    });
    return 'error';
  }
}
