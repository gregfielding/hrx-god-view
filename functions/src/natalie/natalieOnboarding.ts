/**
 * Natalie's onboarding + screening follow-ups (Greg 2026-09-09).
 *
 * "If Deborah starts onboarding a worker on Monday, Natalie should look on Tuesday (24 hours later)
 * to see if they have completed their key onboarding steps with us — tax forms, payroll, direct
 * deposit, and E-Verify (C1 Select only). Also, if a background check and/or drug screening was
 * ordered and she can see it has not been started yet, she can text the worker … It's also common
 * for users to get the background link and complete it without realizing there is a second part —
 * drug screening instructions. She can do a 24 hour and 72 hour follow up, engage them in text
 * convos, help them where she can, and report back any issues in Slack. If the worker is now
 * declining to do them, she can remove them from the job and start someone else instead."
 *
 * Sources of truth (nothing here re-derives readiness):
 *   - `tenants/{T}/onboarding_instances/{assignmentId}` — created when a recruiter starts onboarding
 *     (createdBy.userId = the recruiter). Its createdAt is the clock for the 24h / 72h / 7d checks.
 *   - `assignments/{id}.readinessSnapshotV1.requirements[]` — work_authorization, i9, payroll_setup
 *     (in_progress = Everee invite sent, incomplete; complete = direct deposit done), tax_form,
 *     handbook, policies (+ hiringEntityId for the C1 Select E-Verify rule).
 *   - `entity_employments` (C1 Select): everifyStatus / i9Section2CompletedAt — E-Verify is an
 *     employer step, so it is reported to the recruiter in Slack, never texted to the worker.
 *   - `backgroundChecks` (top level, candidateId): hrxStatus + profileCompleted (form),
 *     providerServiceOrderStatus lines whose name looks like a drug panel (Quest / Abbott / "4 Panel")
 *     with status "Collection is pending" / "In Progress" (not collected) vs "Collection is complete"
 *     / "Completed".
 *
 * Runs inside the natalieSlackInbox tick:
 *   enrollOnboardingFollowups → runOnboardingCheckpoints → drainSmsConversations.
 * Worker replies arrive through handleInboundSms, which drops a `natalie_sms_convos` row when the
 * sender's `natalie_sms_watches` doc carries `onboardingFollowup.active`.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import Anthropic from '@anthropic-ai/sdk';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction, type SlackRef } from './natalieAudit';
import { NATALIE_MODEL } from './natalieAgent';
import { latestBackgroundCheckDoc } from './natalieFill';
import { C1_EVENTS_ENTITY_ID, loadEventsSetupSteps, eventsSetupDone, placeApplicantOnAppliedShift } from './eventsApplicantSetup';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';
import { PERSONAS, effectivePersona, loadPersonaRuntime, scopePersona, smsSignature, tokenFor, workerLanguage, type PersonaId, type PersonaRuntime, type PersonaTokens } from './personas';

const db = admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
export const FOLLOWUPS = 'natalie_onboarding_followups';
export const CONVOS = 'natalie_sms_convos';
const DEFAULT_CHANNEL = 'C0BF02MEKUP'; // #recruiting
const ENROLL_WINDOW_DAYS = 2; // how far back enrollment scans (bounded by the cutoff below)
/**
 * Only onboarding starts / screening orders AFTER this moment are followed up — going forward, per
 * Greg's framing ("if Deborah starts onboarding a worker on Monday…"). At deploy time (2026-09-09)
 * the previous 48h alone held 55 onboarding instances + 27 open screenings, mostly one bulk
 * placement; texting all of them at once was not the ask. Override with
 * `app_config/natalie.onboardingFollowupsSince` (ISO string) to pull the backlog in.
 */
const DEFAULT_SINCE_MS = Date.parse('2026-09-09T21:30:00Z');
const H = 3600_000;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const tsToDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const phoneOf = (u: Record<string, unknown>): string => {
  const e = s(u.phoneE164);
  if (/^\+1[2-9]\d{9}$/.test(e)) return e;
  const d = s(u.phone).replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : '';
};

function stateTz(state: string): string {
  const st = (state || '').toUpperCase();
  if (['CA', 'WA', 'OR', 'NV'].includes(st)) return 'America/Los_Angeles';
  if (['CO', 'UT', 'AZ', 'NM', 'MT', 'WY', 'ID'].includes(st)) return 'America/Denver';
  if (['NY', 'NJ', 'PA', 'MA', 'CT', 'FL', 'GA', 'NC', 'SC', 'VA', 'MD', 'DC', 'OH', 'MI', 'IN', 'KY', 'TN', 'ME', 'NH', 'VT', 'RI', 'DE', 'WV'].includes(st)) return 'America/New_York';
  return 'America/Chicago';
}
function localHour(tz: string): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
}
const inTextingHours = (tz: string): boolean => { const h = localHour(tz); return h >= 9 && h <= 19; };

async function natalieConfig(): Promise<Record<string, unknown>> {
  return ((await db.doc(`tenants/${TENANT}/app_config/natalie`).get()).data() ?? {}) as Record<string, unknown>;
}

/** Scripts pass Natalie's token alone; the tick passes every persona's. */
const asTokens = (t: string | PersonaTokens): PersonaTokens => (typeof t === 'string' ? { natalie: t } : t);
async function runtimeOf(tokens: PersonaTokens): Promise<PersonaRuntime> {
  if (!tokens.runtime) tokens.runtime = await loadPersonaRuntime(TENANT, Boolean(tokens.marco));
  return tokens.runtime;
}

// ---------------------------------------------------------------------------------------------
// Snapshot: what is still open for this worker, split by who can act on it.
// ---------------------------------------------------------------------------------------------

export interface OnboardingStep { key: string; label: string; status: string; actor: 'worker' | 'recruiter' }
export interface DrugScreen { ordered: boolean; name: string; lab: string; status: 'none' | 'pending' | 'collected' | 'completed' | 'canceled' }
export interface OnboardingSnapshot {
  assignmentId: string | null;
  hiringEntityId: string;
  entityLabel: string;
  steps: OnboardingStep[];
  /** Labels the WORKER still has to do (texted). */
  workerTodo: string[];
  /** Labels a RECRUITER still has to do (Slack only). */
  recruiterTodo: string[];
  background: { ordered: boolean; checkId: string | null; packageName: string; formDone: boolean; portalLink: string; hrxStatus: string; failed: boolean } | null;
  drug: DrugScreen;
  everee: { inviteSent: boolean; complete: boolean };
  allWorkerDone: boolean;
}

const STEP_LABELS: Record<string, string> = {
  work_authorization: 'work authorization declaration',
  i9: 'I-9 (your section)',
  payroll_setup: 'Everee payroll setup (direct deposit)',
  tax_form: 'tax forms (W-4)',
  handbook: 'handbook signature',
  policies: 'policies acknowledgment',
};

const ENTITY_LABELS: Record<string, string> = { c1_select_llc: 'C1 Select', c1_events_llc: 'C1 Events', c1_workforce_llc: 'C1 Workforce' };

function isDrugLine(l: Record<string, unknown>): boolean {
  const name = s(l.serviceName);
  if (/tb\b|ppd|quantiferon|titer|physical/i.test(name)) return false;
  return /drug|panel|urine|quest|abbott|crl|lab/i.test(name) || Boolean(s(l.labName));
}

export function drugFromCheck(bg: Record<string, unknown> | null): DrugScreen {
  if (!bg) return { ordered: false, name: '', lab: '', status: 'none' };
  const lines = Object.values((bg.providerServiceOrderStatus ?? {}) as Record<string, Record<string, unknown>>).filter(isDrugLine);
  if (!lines.length) return { ordered: false, name: '', lab: '', status: bg.drugReportReady === true ? 'completed' : 'none' };
  const l = lines[0];
  const st = s(l.status).toLowerCase();
  let status: DrugScreen['status'] = 'pending';
  if (/cancel/.test(st)) status = 'canceled';
  else if (/collection is complete|collected|received|in review/.test(st)) status = 'collected';
  else if (bg.drugReportReady === true || /^completed$|report/.test(st)) status = 'completed';
  return { ordered: true, name: s(l.serviceName), lab: s(l.labName), status };
}

const ENTITY_KEYS: Record<string, string> = { c1_select_llc: 'select', c1_events_llc: 'events', c1_workforce_llc: 'workforce' };

/**
 * Pure: the worker's onboarding steps for a hire with NO assignment (job-order hiring plan / on-call
 * pool). Same inputs as assignment readiness — src/utils/employmentMinimalChecklistModel.ts
 * `assignmentReadinessEmploymentFromPipeline` (payroll account + Everee readiness mirror, OR'd so a
 * signal can only turn a step green) plus the employment row. That module sits outside functions'
 * tsc root, so the rules are restated here; keep them in step.
 */
export function stepsWithoutAssignment(args: {
  user: Record<string, unknown>;
  payrollAccount: Record<string, unknown> | null;
  evereeMirror: Record<string, unknown> | null;
  employment: Record<string, unknown> | null;
}): OnboardingStep[] {
  const pa = args.payrollAccount ?? {};
  const m = args.evereeMirror;
  const ee = args.employment ?? {};
  const payrollStatus = s(pa.payrollStatus);
  const inviteSent = ['invite_sent', 'account_created', 'in_progress', 'complete'].includes(payrollStatus) || s(pa.inviteStatus) === 'sent' || Boolean(pa.inviteSentAt || pa.payrollInviteSentAt) || m != null;
  const directDeposit = payrollStatus === 'complete' || ['complete', 'verified'].includes(s(pa.directDepositStatus).toLowerCase()) || m?.directDepositReady === true;
  const taxForm = ['complete', 'submitted', 'verified'].includes(s(pa.taxFormStatus).toLowerCase()) || Boolean(m?.w4SignedAt || m?.w9SignedAt) || s(ee.taxIdentityStatus) === 'complete';
  const i9Worker = Boolean(m?.i9SignedAt || ee.i9Section1CompletedAt);
  const attestation = (args.user.workEligibilityAttestation ?? null) as { authorizedToWorkUS?: unknown } | null;
  const payroll = directDeposit ? 'complete' : inviteSent ? 'in_progress' : 'missing';
  return [
    { key: 'work_authorization', label: STEP_LABELS.work_authorization, status: attestation?.authorizedToWorkUS === true ? 'complete' : 'missing', actor: 'worker' },
    { key: 'i9', label: STEP_LABELS.i9, status: i9Worker ? 'complete' : 'missing', actor: 'worker' },
    { key: 'payroll_setup', label: STEP_LABELS.payroll_setup, status: payroll, actor: payroll === 'missing' ? 'recruiter' : 'worker' },
    { key: 'tax_form', label: STEP_LABELS.tax_form, status: taxForm ? 'complete' : 'missing', actor: 'worker' },
  ];
}

export async function buildOnboardingSnapshot(tenantId: string, userId: string, assignmentId: string | null, opts: { hiringEntityId?: string | null } = {}): Promise<OnboardingSnapshot> {
  const asg = assignmentId ? (await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get()).data() ?? null : null;
  const hiringEntityId = s(asg?.hiringEntityId) || s(asg?.entityId) || s(opts.hiringEntityId);
  const steps: OnboardingStep[] = [];
  if (asg) {
    const rs = (asg.readinessSnapshotV1 ?? {}) as { requirements?: Array<{ key: string; label: string; status: string }> };
    for (const r of rs.requirements ?? []) {
      if (r.key === 'background_check') continue;
      steps.push({ key: r.key, label: STEP_LABELS[r.key] || r.label, status: r.status, actor: r.key === 'payroll_setup' && r.status === 'missing' ? 'recruiter' : 'worker' });
    }
  } else if (hiringEntityId === C1_EVENTS_ENTITY_ID) {
    // C1 Events (1099) with no assignment: profile photo · direct deposit · W-9 — no I-9 / W-4 (2026-09-11).
    steps.push(...(await loadEventsSetupSteps(db, tenantId, userId)));
  } else if (hiringEntityId) {
    // Hiring-plan / on-call pool hire: no assignment, so no readinessSnapshotV1 to read.
    const entityKey = ENTITY_KEYS[hiringEntityId];
    const [userSnap, payrollSnap, evereeSnap, employmentSnap] = await Promise.all([
      db.doc(`users/${userId}`).get(),
      entityKey ? db.doc(`tenants/${tenantId}/worker_payroll_accounts/${userId}__${entityKey}`).get() : Promise.resolve(null),
      db.doc(`tenants/${tenantId}/everee_workers/${hiringEntityId}__${userId}`).get(),
      entityKey ? db.doc(`tenants/${tenantId}/entity_employments/${userId}__${entityKey}`).get() : Promise.resolve(null),
    ]);
    steps.push(...stepsWithoutAssignment({
      user: (userSnap.data() ?? {}) as Record<string, unknown>,
      payrollAccount: (payrollSnap?.data() ?? null) as Record<string, unknown> | null,
      evereeMirror: (evereeSnap.get('readinessMirror') ?? null) as Record<string, unknown> | null,
      employment: (employmentSnap?.data() ?? null) as Record<string, unknown> | null,
    }));
  }
  const everee = { inviteSent: steps.some((x) => x.key === 'payroll_setup' && x.status !== 'missing'), complete: steps.some((x) => x.key === 'payroll_setup' && x.status === 'complete') };
  // C1 Select only: E-Verify is the employer's step after I-9 Section 2.
  if (hiringEntityId === 'c1_select_llc') {
    const ee = await db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', userId).where('entityId', '==', 'c1_select_llc').limit(1).get().catch(() => null);
    const e = ee?.docs[0]?.data() ?? {};
    const everifyDone = ['manual_outside_hrx', 'authorized', 'employment_authorized', 'complete', 'completed'].includes(s(e.everifyStatus).toLowerCase());
    const sec2Done = Boolean(e.i9Section2CompletedAt);
    if (!sec2Done) steps.push({ key: 'i9_section_2', label: 'I-9 Section 2 (employer)', status: 'missing', actor: 'recruiter' });
    steps.push({ key: 'e_verify', label: 'E-Verify (C1 Select)', status: everifyDone ? 'complete' : 'missing', actor: 'recruiter' });
  }
  const bgDoc = await latestBackgroundCheckDoc(tenantId, userId);
  const bg = bgDoc ? (bgDoc.data() as Record<string, unknown>) : null;
  const hrxStatus = s(bg?.hrxStatus);
  const formDone = Boolean(bg) && (bg?.profileCompleted === true || ['submitted', 'in_progress', 'report_ready', 'drug_report_ready', 'completed'].includes(hrxStatus));
  const background = bg
    ? { ordered: true, checkId: bgDoc!.id, packageName: s(bg.requestedPackageName) || 'background check', formDone, portalLink: s(bg.applicantPortalLink) || s(bg.applicantPortalUrl), hrxStatus, failed: s(bg.providerFinalDecision).toUpperCase() === 'FAILED' }
    : null;
  const drug = drugFromCheck(bg);
  const workerTodo = steps.filter((x) => x.actor === 'worker' && x.status !== 'complete' && x.status !== 'not_applicable').map((x) => x.label);
  if (background && !background.formDone && !['canceled', 'error'].includes(hrxStatus)) workerTodo.push(`AccuSource background form (${background.packageName})`);
  if (drug.ordered && drug.status === 'pending' && formDone) workerTodo.push(`drug screen at ${drug.lab || 'the lab'} (separate step after the form)`);
  const recruiterTodo = steps.filter((x) => x.actor === 'recruiter' && x.status !== 'complete').map((x) => x.label);
  return { assignmentId, hiringEntityId, entityLabel: ENTITY_LABELS[hiringEntityId] || hiringEntityId || 'C1', steps, workerTodo, recruiterTodo, background, drug, everee, allWorkerDone: workerTodo.length === 0 };
}

// ---------------------------------------------------------------------------------------------
// Enrollment: every onboarding start (and every recruiter-ordered screening) gets a follow-up.
// ---------------------------------------------------------------------------------------------

interface FollowupDoc {
  tenantId: string; userId: string; workerName: string; firstName: string; phoneE164: string;
  assignmentId: string | null; jobOrderId: string | null; jobTitle: string; site: string; hiringEntityId: string;
  recruiterUid: string | null; recruiterName: string; source: 'onboarding_instance' | 'background_check' | 'hiring_plan' | 'job_application';
  /** job_application: the shift they applied for — placed there once their C1 Events setup is done. */
  shiftId?: string | null; shiftDate?: string | null;
  startedAt: admin.firestore.Timestamp; tz: string; status: 'active' | 'done' | 'declined' | 'parked' | 'removed' | 'no_phone';
  nextCheckpoint: 'h1' | 'h24' | 'h72' | 'd7' | null; checkpoints: Record<string, unknown>;
  slack: SlackRef | null; transcript: Array<{ at: string; dir: 'out' | 'in'; text: string }>;
  lastIntent: string | null; createdAt: admin.firestore.FieldValue; updatedAt: admin.firestore.FieldValue;
  /** Owner (personas.ts: Marco = C1 Events minus Oakland Arena) and the worker's language, stamped at enrollment. Older docs: natalie / en. */
  persona?: PersonaId; lang?: 'en' | 'es';
  /** "I already did it" re-check (Greg 2026-09-11): when to look again, and what they claimed. */
  verifyAt?: admin.firestore.Timestamp | null;
  verifyClaim?: { at: string; items: string[]; text: string } | null;
}

/** Enrolling late (e.g. first deploy, or an instance created days ago): start at the checkpoint that is still meaningful. */
export function firstCheckpointFor(startedAt: Date, nowMs = Date.now()): 'h1' | 'h24' | 'h72' | 'd7' {
  const ageH = (nowMs - startedAt.getTime()) / H;
  return ageH < 6 ? 'h1' : ageH < 36 ? 'h24' : ageH < 24 * 6 ? 'h72' : 'd7';
}

const CHECKPOINT_LABEL: Record<string, string> = { h1: '1h', h24: '24h', h72: '72h', d7: '7d' };

async function recruiterName(uid: string): Promise<string> {
  if (!uid) return '';
  const u = (await db.doc(`users/${uid}`).get()).data() ?? {};
  return `${s(u.firstName)} ${s(u.lastName)}`.trim();
}

async function latestActiveAssignment(tenantId: string, userId: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const q = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).limit(50).get();
  const live = q.docs.filter((d) => !['cancelled', 'canceled', 'declined', 'ended', 'completed'].includes(s(d.get('status')).toLowerCase()));
  live.sort((a, b) => (tsToDate(b.get('createdAt'))?.getTime() ?? 0) - (tsToDate(a.get('createdAt'))?.getTime() ?? 0));
  return live[0] ? { id: live[0].id, data: live[0].data() as Record<string, unknown> } : null;
}

/** One Slack thread per job order per day (bulk placements would otherwise open a thread per worker). */
async function threadFor(token: string, channel: string, key: { jobOrderId: string | null; jobTitle: string; site: string; recruiterName: string; entity: string; source: FollowupDoc['source']; persona: PersonaId }): Promise<SlackRef> {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const id = `${key.persona === 'marco' ? 'marco__' : ''}${key.jobOrderId || 'no-order'}__${day}`;
  const ref = db.collection('natalie_onboarding_threads').doc(id);
  const cur = (await ref.get()).data() as { channel?: string; ts?: string } | undefined;
  if (cur?.ts) return { channel: cur.channel || channel, ts: cur.ts };
  const what = key.source === 'background_check' ? 'screening' : 'onboarding';
  const startedBy = key.recruiterName ? ` (started by ${key.recruiterName})` : key.source === 'hiring_plan' ? ' (hired by the job order hiring plan)' : '';
  const opener = `${what === 'onboarding' ? 'Onboarding' : 'Screening'} follow-ups — *${key.jobTitle}*${key.site ? ` at ${key.site}` : ''}${startedBy}. I check each worker's steps at 1h, 24h and 72h (tax forms, Everee payroll/direct deposit, I-9, handbook, background form, drug screen${key.entity === 'c1_select_llc' ? ', E-Verify on our side' : ''}), text them from my number about anything open, and post their replies here.`;
  const res = await postAsNatalie(token, { channel, text: opener });
  const slack: SlackRef = res.ok && res.ts ? { channel, ts: res.ts } : { channel };
  await ref.set({ ...slack, jobOrderId: key.jobOrderId, jobTitle: key.jobTitle, day, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return slack;
}

type FollowupBase = { userId: string; assignmentId: string | null; jobOrderId: string | null; recruiterUid: string | null; startedAt: Date; source: FollowupDoc['source']; packageName?: string; hiringEntityId?: string | null; shiftId?: string | null; shiftDate?: string | null };

/** Job title / site / state / hiring entity for a follow-up: the assignment when there is one, else the job order (hiring-plan hires). */
async function followupContext(tenantId: string, base: FollowupBase): Promise<{ asg: Record<string, unknown>; jobTitle: string; site: string; state: string; entity: string; jobOrderId: string | null; scope: PersonaId }> {
  const asg = base.assignmentId ? (await db.doc(`tenants/${tenantId}/assignments/${base.assignmentId}`).get()).data() ?? {} : {};
  const jo = !base.assignmentId && base.jobOrderId ? (await db.doc(`tenants/${tenantId}/job_orders/${base.jobOrderId}`).get()).data() ?? {} : {};
  const addr = (asg.worksiteAddress ?? jo.worksiteAddress ?? {}) as Record<string, unknown>;
  return {
    asg,
    jobTitle: s(asg.jobTitle) || s(asg.title) || s(asg.jobOrderName) || s(jo.jobTitle) || s(jo.jobOrderName) || (base.packageName ? `${base.packageName} screening` : 'your assignment'),
    site: s(asg.locationName) || s(asg.worksiteName) || s(asg.companyName) || [s(jo.companyName), s(jo.worksiteName) || s(jo.locationName)].filter(Boolean).join(' '),
    state: s(addr.state),
    entity: s(asg.hiringEntityId) || s(asg.entityId) || s(base.hiringEntityId) || s(jo.hiringEntityId),
    jobOrderId: base.jobOrderId || s(asg.jobOrderId) || null,
    scope: scopePersona(Object.keys(asg).length ? asg : { ...jo, hiringEntityId: s(jo.hiringEntityId) || s(base.hiringEntityId), locationId: jo.worksiteId }),
  };
}

async function createFollowup(tokens: PersonaTokens, runtime: PersonaRuntime, natalieChannel: string, base: FollowupBase): Promise<boolean> {
  const tenantId = TENANT;
  const u = (await db.doc(`users/${base.userId}`).get()).data() ?? {};
  const workerName = `${s(u.firstName)} ${s(u.lastName)}`.trim() || base.userId;
  const { asg, jobTitle, site, state: siteState, entity, jobOrderId, scope } = await followupContext(tenantId, base);
  const { persona, token } = tokenFor(tokens, effectivePersona(scope, runtime));
  const channel = persona === 'marco' ? runtime.marcoChannel : natalieChannel;
  const state = siteState || s(u.state) || s((u.address as Record<string, unknown> | undefined)?.state);
  const phone = phoneOf(u);
  const rName = await recruiterName(s(base.recruiterUid));
  const who = `<${PUBLIC_APP_ORIGIN}/users/${base.userId}|${workerName}>`;
  const thread = await threadFor(token, channel, { jobOrderId, jobTitle, site, recruiterName: rName, entity, source: base.source, persona });
  const first = firstCheckpointFor(base.startedAt);
  const firstLabel = CHECKPOINT_LABEL[first];
  const startedLabel = base.startedAt.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const line = base.source === 'onboarding_instance'
    ? `• ${who} — onboarding started ${startedLabel} MT; first check at ${firstLabel}.`
    : base.source === 'hiring_plan'
      ? `• ${who} — hired into the pool by the hiring plan ${startedLabel} MT${base.packageName ? ` (${base.packageName} ordered)` : ''}; first check at ${firstLabel}.`
      : base.source === 'job_application'
        ? `• ${who} — applied for ${jobTitle}${base.shiftDate ? ` on ${base.shiftDate}` : ''} but hasn't finished C1 Events setup (photo · direct deposit · W-9); first check at ${firstLabel}. When they're done I'll put them on that shift.`
        : `• ${who} — ${base.packageName || 'background check'} ordered; I'll make sure the form gets done and that they know the drug screen (if any) is a separate step.`;
  await postAsNatalie(token, { channel: thread.channel, text: phone ? line : `${line}\n:warning: no usable phone on file — I can't text them: ${PUBLIC_APP_ORIGIN}/users/${base.userId}`, threadTs: thread.ts });
  const doc: FollowupDoc = {
    tenantId, userId: base.userId, workerName, firstName: s(u.firstName) || workerName.split(' ')[0], phoneE164: phone,
    assignmentId: base.assignmentId, jobOrderId, jobTitle, site, hiringEntityId: entity,
    recruiterUid: base.recruiterUid, recruiterName: rName, source: base.source,
    ...(base.source === 'job_application' ? { shiftId: base.shiftId ?? null, shiftDate: base.shiftDate ?? null } : {}),
    startedAt: admin.firestore.Timestamp.fromDate(base.startedAt), tz: stateTz(state), status: phone ? 'active' : 'no_phone',
    nextCheckpoint: first, checkpoints: {}, slack: thread,
    transcript: [], lastIntent: null, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    persona, lang: workerLanguage(u),
  };
  await db.collection(FOLLOWUPS).doc(base.userId).set(doc);
  await recordNatalieAction({ tenantId, persona, kind: 'onboarding_followup_armed', summary: `Following up on ${workerName}'s onboarding${jobTitle ? ` for ${jobTitle}` : ''} (24h / 72h checks)`, userId: base.userId, jobOrderId: doc.jobOrderId, assignmentId: base.assignmentId, slack: doc.slack ?? undefined });
  return true;
}

/** Enroll one specific worker (scripts / tests / "follow up with X" asks). Returns false if they already have an active follow-up. */
export async function enrollWorkerFollowup(tokensIn: string | PersonaTokens, base: FollowupBase): Promise<boolean> {
  const tokens = asTokens(tokensIn);
  const runtime = await runtimeOf(tokens);
  const cfg = await natalieConfig();
  const channel = s(cfg.onboardingChannelId) || s(cfg.recruitingChannelId) || DEFAULT_CHANNEL;
  const existing = (await db.collection(FOLLOWUPS).doc(base.userId).get()).data() as FollowupDoc | undefined;
  if (existing && existing.status === 'active') return false;
  return createFollowup(tokens, runtime, channel, base);
}

export async function enrollOnboardingFollowups(tokensIn: string | PersonaTokens): Promise<number> {
  const tokens = asTokens(tokensIn);
  const runtime = await runtimeOf(tokens);
  const cfg = await natalieConfig();
  if (cfg.onboardingFollowups === false) return 0;
  const channel = s(cfg.onboardingChannelId) || s(cfg.recruitingChannelId) || DEFAULT_CHANNEL;
  const cutoff = Number.isFinite(Date.parse(s(cfg.onboardingFollowupsSince))) ? Date.parse(s(cfg.onboardingFollowupsSince)) : DEFAULT_SINCE_MS;
  const since = admin.firestore.Timestamp.fromMillis(Math.max(cutoff, Date.now() - ENROLL_WINDOW_DAYS * 86400_000));
  let created = 0;
  // 1) Onboarding instances started by a recruiter.
  const inst = await db.collection(`tenants/${TENANT}/onboarding_instances`).where('createdAt', '>=', since).limit(150).get();
  for (const d of inst.docs) {
    const x = d.data() as Record<string, unknown>;
    const userId = s(x.userId);
    if (!userId || s(x.status).toLowerCase() === 'complete') continue;
    const startedAt = tsToDate(x.createdAt) ?? new Date();
    const existing = (await db.collection(FOLLOWUPS).doc(userId).get()).data() as FollowupDoc | undefined;
    if (existing && (existing.status === 'active' || (tsToDate(existing.startedAt)?.getTime() ?? 0) >= startedAt.getTime() - 60_000)) continue;
    const ok = await createFollowup(tokens, runtime, channel, { userId, assignmentId: s(x.assignmentId) || d.id, jobOrderId: s(x.jobOrderId) || null, recruiterUid: s((x.createdBy as Record<string, unknown> | undefined)?.userId) || null, startedAt, source: 'onboarding_instance' });
    if (ok) created += 1;
    if (created >= 10) break; // spread Slack posts across ticks
  }
  // 2) Job-order hiring-plan hires (Greg 2026-09-11): onboarded into the on-call pool with no assignment
  // and no onboarding instance, so path 1 never sees them. Read each plan's attempt log. A follow-up the
  // screening path (3) armed first for the same hire gets the job order context attached instead.
  const plans = await db.collection(`tenants/${TENANT}/job_orders`).where('hiringPlan.enabled', '==', true).limit(50).get();
  for (const jo of plans.docs) {
    if (created >= 10) break;
    const hires = await jo.ref.collection('hiring_plan_hires').where('completedAt', '>=', since).limit(50).get();
    for (const h of hires.docs) {
      if (created >= 10) break;
      const x = h.data() as Record<string, unknown>;
      if (s(x.status) !== 'ok') continue;
      const startedAt = tsToDate(x.onboardedAt) ?? tsToDate(x.completedAt) ?? new Date();
      const base: FollowupBase = { userId: h.id, assignmentId: null, jobOrderId: jo.id, recruiterUid: null, startedAt, source: 'hiring_plan', packageName: x.screeningRequested === true || x.backgroundCheckId ? s(jo.get('screeningPackageName')) || undefined : undefined, hiringEntityId: s(jo.get('hiringEntityId')) || null };
      const ref = db.collection(FOLLOWUPS).doc(h.id);
      const existing = (await ref.get()).data() as FollowupDoc | undefined;
      if (existing?.status === 'active') {
        if (existing.source === 'background_check' && !existing.assignmentId && !existing.jobOrderId) {
          const ctx = await followupContext(TENANT, base);
          await ref.set({ source: 'hiring_plan', jobOrderId: jo.id, jobTitle: ctx.jobTitle, site: ctx.site, hiringEntityId: ctx.entity, ...(ctx.state ? { tz: stateTz(ctx.state) } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        continue;
      }
      if (existing && (tsToDate(existing.startedAt)?.getTime() ?? 0) >= startedAt.getTime() - 60_000) continue;
      if (await createFollowup(tokens, runtime, channel, base)) created += 1;
    }
  }
  // 3) Screenings ordered by a human (Natalie's own orders already carry bgFollowup on the SMS watch).
  // Single-field range (auto-indexed) + in-memory tenant filter — the tenantId+createdAt composite doesn't exist.
  const checks = await db.collection('backgroundChecks').where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(200).get().catch(() => null);
  for (const d of (checks?.docs ?? []).filter((x) => !x.get('tenantId') || s(x.get('tenantId')) === TENANT)) {
    if (created >= 10) break;
    const x = d.data() as Record<string, unknown>;
    const userId = s(x.candidateId) || s(x.userId);
    if (!userId || !['awaiting_applicant', 'submitted', 'in_progress', 'report_ready'].includes(s(x.hrxStatus))) continue;
    const existing = (await db.collection(FOLLOWUPS).doc(userId).get()).data() as FollowupDoc | undefined;
    if (existing && existing.status === 'active') continue;
    const startedAt = tsToDate(x.createdAt) ?? new Date();
    if (existing && (tsToDate(existing.startedAt)?.getTime() ?? 0) >= startedAt.getTime() - 60_000) continue;
    const asg = await latestActiveAssignment(TENANT, userId);
    const ok = await createFollowup(tokens, runtime, channel, { userId, assignmentId: asg?.id ?? null, jobOrderId: s(asg?.data.jobOrderId) || s(x.jobOrderId) || null, recruiterUid: s(x.createdBy) || s(x.requestedBy) || null, startedAt, source: 'background_check', packageName: s(x.requestedPackageName) });
    if (ok) created += 1;
  }
  // 4) C1 Events applicants who haven't finished setup (Greg 2026-09-11: "Can Marco reach out to each of
  // them to help them get their onboarding complete? Then he can assign them."). Applying hires them at
  // C1 Events (eventsEntityAutoHire) with no onboarding instance or plan row, so paths 1–3 never see it.
  // Setup = profile photo · direct deposit · W-9; once it's done the checkpoint loop places them on the
  // shift they applied for. Single-field range (auto-indexed) + in-memory entity filter.
  const apps = await db.collection(`tenants/${TENANT}/applications`).where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(400).get().catch(() => null);
  const seenApplicants = new Set<string>();
  for (const d of apps?.docs ?? []) {
    if (created >= 10) break;
    const x = d.data() as Record<string, unknown>;
    const userId = s(x.userId);
    const jobOrderId = s(x.jobOrderId);
    if (!userId || !jobOrderId || seenApplicants.has(userId)) continue;
    if (s(x.hiringEntityId) !== C1_EVENTS_ENTITY_ID || !['submitted', 'waitlisted'].includes(s(x.status).toLowerCase())) continue;
    seenApplicants.add(userId); // newest live application per worker
    const startedAt = tsToDate(x.appliedAt) ?? tsToDate(x.createdAt) ?? new Date();
    const existing = (await db.collection(FOLLOWUPS).doc(userId).get()).data() as FollowupDoc | undefined;
    if (existing && (existing.status === 'active' || (tsToDate(existing.startedAt)?.getTime() ?? 0) >= startedAt.getTime() - 60_000)) continue;
    const theirs = await db.collection(`tenants/${TENANT}/assignments`).where('userId', '==', userId).limit(100).get();
    if (theirs.docs.some((a) => s(a.get('jobOrderId')) === jobOrderId && !['cancelled', 'canceled', 'declined', 'ended', 'completed'].includes(s(a.get('status')).toLowerCase()))) continue;
    if (eventsSetupDone(await loadEventsSetupSteps(db, TENANT, userId))) continue;
    if (await createFollowup(tokens, runtime, channel, { userId, assignmentId: null, jobOrderId, recruiterUid: null, startedAt, source: 'job_application', hiringEntityId: C1_EVENTS_ENTITY_ID, shiftId: s(x.shiftId) || null, shiftDate: s(x.shiftDate) || null })) created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Checkpoints: 1h, 24h, 72h, 7d after onboarding started (1h added by Greg 2026-09-11: catch the
// worker while the hire is fresh — most skip the background form's second step).
// ---------------------------------------------------------------------------------------------

const CHECKPOINT_HOURS: Record<string, number> = { h1: 1, h24: 24, h72: 72, d7: 24 * 7 };
const NEXT: Record<string, FollowupDoc['nextCheckpoint']> = { h1: 'h24', h24: 'h72', h72: 'd7', d7: null };
/** Appended to the persona's SMS prefix: natalie_onboarding_24h, marco_onboarding_24h … */
const CHECKPOINT_MESSAGE_SUFFIX: Record<string, string> = { h1: 'onboarding_1h', h24: 'onboarding_24h', h72: 'onboarding_72h' };

function listify(items: string[], and = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

const ES_ITEM: Record<string, string> = {
  'I-9': 'I-9', 'direct deposit': 'depósito directo', 'tax forms': 'formularios de impuestos', handbook: 'manual', policies: 'políticas',
  'work authorization declaration': 'declaración de autorización para trabajar',
  // C1 Events checklist (eventsApplicantSetup.ts EVENTS_STEP_LABELS — keep in step).
  '1099 tax form (W-9)': 'formulario de impuestos 1099 (W-9)',
  [`profile photo (${PUBLIC_APP_ORIGIN}/c1/workers/profile)`]: `foto de perfil (${PUBLIC_APP_ORIGIN}/c1/workers/profile)`,
};

export function composeCheckpointText(f: Pick<FollowupDoc, 'firstName' | 'jobTitle'>, snap: OnboardingSnapshot, checkpoint: string, opts: { persona?: PersonaId; lang?: 'en' | 'es' } = {}): string {
  const persona = opts.persona ?? 'natalie';
  if (opts.lang === 'es') return composeCheckpointTextEs(f, snap, checkpoint, persona);
  const me = PERSONAS[persona].firstName;
  const name = f.firstName || 'there';
  const parts: string[] = [];
  const forJob = f.jobTitle && f.jobTitle !== 'your assignment' ? ` for ${f.jobTitle}` : ' with C1';
  const intro = checkpoint === 'h1'
    ? `Hi ${name}, it's ${me} with C1 Staffing — welcome aboard${forJob}! Here's what's left to get you ready to work.`
    : checkpoint === 'h24'
    ? `Hi ${name}, it's ${me} with C1 Staffing. Quick check on your onboarding${forJob}.`
    : checkpoint === 'h72'
      ? `Hi ${name}, ${me} with C1 Staffing again — a few onboarding items are still open${forJob} and we can't schedule you until they're done.`
      : `Hi ${name}, it's ${me} with C1 Staffing. Last check on your onboarding${forJob} — is there something in the way?`;
  parts.push(intro);
  const bgOpen = snap.background && !snap.background.formDone;
  const drugOpen = snap.drug.ordered && snap.drug.status === 'pending' && snap.background?.formDone;
  const other = snap.workerTodo.filter((x) => !/AccuSource|drug screen/.test(x));
  // Everything except the profile declaration lives in the worker's Everee onboarding — say it once.
  const evereeBits = other.filter((x) => /I-9|Everee|tax|handbook|policies/.test(x)).map((x) => x.replace(/^I-9 \(your section\)$/, 'I-9').replace(/^Everee payroll setup \(direct deposit\)$/, 'direct deposit').replace(/^tax forms \(W-4\)$/, 'tax forms').replace(/^handbook signature$/, 'handbook').replace(/^policies acknowledgment$/, 'policies'));
  const rest = other.filter((x) => !/I-9|Everee|tax|handbook|policies/.test(x));
  const items: string[] = [];
  // C1 Events workers finish payroll themselves on the web (Greg 2026-09-11); everyone else waits
  // on the emailed/texted Everee invite.
  const evereeWhere = snap.hiringEntityId === C1_EVENTS_ENTITY_ID
    ? ` — finish it at ${PUBLIC_APP_ORIGIN}/c1/workers/earnings`
    : snap.everee.inviteSent
      ? ' — the link is in your texts/email; I can resend it'
      : '';
  if (evereeBits.length) items.push(`your Everee onboarding (${listify(evereeBits)})${evereeWhere}`);
  if (rest.length) items.push(listify(rest));
  if (items.length) parts.push(`Still open with us: ${items.join('; ')}.`);
  if (bgOpen) parts.push(`Your background check form hasn't been started: ${snap.background!.portalLink || 'check your texts for the AccuSource link'} (about 5 min).`);
  if (drugOpen) parts.push(`Heads up: your background form is done but the drug screen is a separate second step — look for the ${snap.drug.lab || 'lab'} registration email from AccuSource and get it done in the next couple of days.`);
  parts.push('Reply here if you need a link or have questions.');
  return `${parts.join(' ')} ${smsSignature(persona)}`;
}

/** Spanish checkpoint text (workers whose preferredLanguage is es). Same content as the English one. */
function composeCheckpointTextEs(f: Pick<FollowupDoc, 'firstName' | 'jobTitle'>, snap: OnboardingSnapshot, checkpoint: string, persona: PersonaId): string {
  const me = PERSONAS[persona].firstName;
  const hola = f.firstName ? `Hola ${f.firstName}` : 'Hola';
  const forJob = f.jobTitle && f.jobTitle !== 'your assignment' ? ` (${f.jobTitle})` : '';
  const parts: string[] = [];
  parts.push(checkpoint === 'h1'
    ? `${hola}, soy ${me} de C1 Staffing — ¡te damos la bienvenida${forJob}! Esto es lo que falta para que puedas empezar a trabajar.`
    : checkpoint === 'h24'
      ? `${hola}, soy ${me} de C1 Staffing. Una revisión rápida de tu registro${forJob}.`
      : checkpoint === 'h72'
        ? `${hola}, ${me} de C1 Staffing otra vez — todavía faltan algunos pasos de tu registro${forJob} y no podemos programarte hasta completarlos.`
        : `${hola}, soy ${me} de C1 Staffing. Última revisión de tu registro${forJob} — ¿hay algo que te lo impida?`);
  const bgOpen = snap.background && !snap.background.formDone;
  const drugOpen = snap.drug.ordered && snap.drug.status === 'pending' && snap.background?.formDone;
  const other = snap.workerTodo.filter((x) => !/AccuSource|drug screen/.test(x));
  const evereeBits = other.filter((x) => /I-9|Everee|tax|handbook|policies/.test(x)).map((x) => x.replace(/^I-9 \(your section\)$/, 'I-9').replace(/^Everee payroll setup \(direct deposit\)$/, 'direct deposit').replace(/^tax forms \(W-4\)$/, 'tax forms').replace(/^handbook signature$/, 'handbook').replace(/^policies acknowledgment$/, 'policies')).map((x) => ES_ITEM[x] ?? x);
  const rest = other.filter((x) => !/I-9|Everee|tax|handbook|policies/.test(x)).map((x) => ES_ITEM[x] ?? x);
  const items: string[] = [];
  const dondeEveree = snap.hiringEntityId === C1_EVENTS_ENTITY_ID
    ? ` — complétalo en ${PUBLIC_APP_ORIGIN}/c1/workers/earnings`
    : snap.everee.inviteSent
      ? ' — el enlace está en tus mensajes o correo; te lo puedo reenviar'
      : '';
  if (evereeBits.length) items.push(`tu registro en Everee (${listify(evereeBits, 'y')})${dondeEveree}`);
  if (rest.length) items.push(listify(rest, 'y'));
  if (items.length) parts.push(`Pendiente con nosotros: ${items.join('; ')}.`);
  if (bgOpen) parts.push(`No has empezado tu formulario de verificación de antecedentes: ${snap.background!.portalLink || 'busca el enlace de AccuSource en tus mensajes'} (unos 5 min).`);
  if (drugOpen) parts.push(`Importante: tu formulario de antecedentes ya está listo, pero la prueba de drogas es un segundo paso aparte — busca el correo de registro de ${snap.drug.lab || 'el laboratorio'} que manda AccuSource y hazla en los próximos días.`);
  parts.push('Responde aquí si necesitas un enlace o tienes preguntas.');
  return `${parts.join(' ')} ${smsSignature(persona, 'es')}`;
}

/** Pure: the "you're all set" text when the worker's side is done. */
export function composeDoneText(f: Pick<FollowupDoc, 'firstName' | 'jobTitle'>, opts: { persona?: PersonaId; lang?: 'en' | 'es' } = {}): string {
  const persona = opts.persona ?? 'natalie';
  const me = PERSONAS[persona].firstName;
  return opts.lang === 'es'
    ? `Hola ${f.firstName}, ${me} de C1 Staffing — ya completaste tu papeleo de registro para ${f.jobTitle}. ¡Gracias! ${smsSignature(persona, 'es')}`
    : `Hi ${f.firstName}, ${me} with C1 Staffing — you're all set on your onboarding paperwork for ${f.jobTitle}. Thank you! ${smsSignature(persona)}`;
}

/**
 * How long after "I already did it" she looks again. Long enough for an AccuSource/Everee webhook to
 * land, short enough that the worker still has the thread open (Greg 2026-09-11: Michelle D. replied
 * "Ok I filled it out" while her background form still showed not started).
 */
const VERIFY_DELAY_MS = 25 * 60_000;

/** Pure: the re-check text when HRX still shows the item the worker said they finished. */
export function composeClaimRecheckText(
  f: Pick<FollowupDoc, 'firstName'>,
  stillOpen: string[],
  opts: { persona?: PersonaId; lang?: 'en' | 'es' } = {},
): string {
  const persona = opts.persona ?? 'natalie';
  const me = PERSONAS[persona].firstName;
  const name = f.firstName || '';
  if (opts.lang === 'es') {
    const items = listify(stillOpen.map((x) => ES_ITEM[x] ?? x), 'y');
    return `${name ? `Hola ${name}` : 'Hola'}, soy ${me} de C1 Staffing. Gracias por avisarme — pero en nuestro sistema todavía aparece pendiente: ${items}. A veces se completa otra parte del registro por error. ¿Puedes revisarlo? Respóndeme si algo no te funciona. ${smsSignature(persona, 'es')}`;
  }
  return `${name ? `Hi ${name}` : 'Hi'} — ${me} with C1 Staffing. Thanks for letting me know! On our side this still shows as not done: ${listify(stillOpen)}. Sometimes a different part of the setup gets finished by mistake. Could you take one more look? Reply here if something isn't working. ${smsSignature(persona)}`;
}

async function sendSms(f: FollowupDoc, text: string, messageTypeId: string): Promise<{ success: boolean; error?: string }> {
  const { sendWorkerMessageInternal } = await import('../twilio');
  const r = await sendWorkerMessageInternal(f.phoneE164, text, { tenantId: f.tenantId, userId: f.userId, source: 'system', messageTypeId, systemContext: true } as never);
  return { success: Boolean(r.success), error: r.error ?? (r.errorCode ? String(r.errorCode) : undefined) };
}

async function armWatch(f: FollowupDoc): Promise<void> {
  const ref = db.collection('natalie_sms_watches').doc(f.userId);
  const cur = (await ref.get()).data() ?? {};
  const hasLiveOffer = Boolean(cur.offer) && s(cur.status) === 'active';
  await ref.set({
    tenantId: f.tenantId, userId: f.userId, phoneE164: f.phoneE164, workerName: f.workerName, persona: f.persona ?? 'natalie',
    ...(hasLiveOffer ? {} : { status: 'active', slack: f.slack ?? null, context: `onboarding follow-up ${f.jobTitle}`.trim() }),
    onboardingFollowup: { active: true, since: admin.firestore.FieldValue.serverTimestamp() },
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 86400_000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  // Don't double-text: if Natalie's daily background nudge is armed for this worker, count today's text as the nudge.
  const bgf = (cur.bgFollowup ?? null) as Record<string, unknown> | null;
  if (bgf?.active) await ref.set({ bgFollowup: { ...bgf, lastNudgeAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
}

async function disarmWatch(userId: string): Promise<void> {
  await db.collection('natalie_sms_watches').doc(userId).set({ onboardingFollowup: { active: false, endedAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true }).catch(() => undefined);
}

function slackSummary(snap: OnboardingSnapshot): string {
  const lines: string[] = [];
  const done = snap.steps.filter((x) => x.status === 'complete').map((x) => x.label);
  if (done.length) lines.push(`• done: ${done.join(', ')}`);
  if (snap.workerTodo.length) lines.push(`• worker still owes: ${snap.workerTodo.join(', ')}`);
  if (snap.recruiterTodo.length) lines.push(`• :warning: recruiter side: ${snap.recruiterTodo.join(', ')}`);
  if (snap.background) lines.push(`• background: ${snap.background.packageName} — ${snap.background.failed ? ':x: FAILED' : snap.background.formDone ? `form done, ${snap.background.hrxStatus.replace(/_/g, ' ')}` : 'form NOT started'}${snap.drug.ordered ? ` · drug screen (${snap.drug.name || snap.drug.lab}): ${snap.drug.status}` : ''}`);
  else lines.push('• background: none ordered');
  return lines.join('\n');
}

export async function runOnboardingCheckpoints(tokensIn: string | PersonaTokens): Promise<number> {
  const tokens = asTokens(tokensIn);
  await runtimeOf(tokens);
  const snap = await db.collection(FOLLOWUPS).where('status', '==', 'active').limit(80).get();
  let touched = 0;
  let sentThisTick = 0;
  for (const d of snap.docs) {
    const f = d.data() as FollowupDoc;
    const cp = f.nextCheckpoint;
    if (!cp) continue;
    const due = (tsToDate(f.startedAt)?.getTime() ?? 0) + CHECKPOINT_HOURS[cp] * H;
    // Applicants waiting on a shift (job_application) are re-checked every 10 min between checkpoints so
    // they get placed soon after they finish — no extra texts on those passes.
    const isApplicant = f.source === 'job_application';
    const probeDue = isApplicant && Date.now() - (tsToDate((f as unknown as { doneProbeAt?: unknown }).doneProbeAt)?.getTime() ?? 0) >= 10 * 60_000;
    if (Date.now() < due && !probeDue) continue;
    if (!inTextingHours(f.tz || 'America/Denver')) continue; // wait for the worker's daytime (placing sends a text too)
    const lastText = tsToDate((f as unknown as { lastTextAt?: unknown }).lastTextAt)?.getTime() ?? 0;
    const textingPass = Date.now() >= due && Date.now() - lastText >= 20 * H; // never two follow-up texts in one day
    if (!textingPass && !probeDue) continue;
    if (sentThisTick >= 15) break;
    const claimed = await db.runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      const claimAt = tsToDate(cur.get('checkpointClaimAt'))?.getTime() ?? 0;
      if (cur.get('nextCheckpoint') !== cp || cur.get('status') !== 'active' || Date.now() - claimAt < 10 * 60_000) return false;
      tx.update(d.ref, { checkpointClaimAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    }).catch(() => false);
    if (!claimed) continue;
    const slack = f.slack ?? undefined;
    const who = tokenFor(tokens, f.persona);
    const P = PERSONAS[who.persona];
    const lang = f.lang === 'es' ? 'es' : 'en';
    const say = async (text: string) => { if (slack?.channel) await postAsNatalie(who.token, { channel: slack.channel, text, threadTs: slack.ts }); };
    try {
      const snapshot = await buildOnboardingSnapshot(f.tenantId, f.userId, f.assignmentId, { hiringEntityId: f.hiringEntityId });
      const stamp = { at: admin.firestore.FieldValue.serverTimestamp(), workerTodo: snapshot.workerTodo, recruiterTodo: snapshot.recruiterTodo, sent: false };
      if (snapshot.background?.failed) {
        await d.ref.set({ status: 'parked', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await say(`:x: ${f.workerName}'s background check came back FAILED — I'm not texting them about onboarding. Recruiter decision needed: ${PUBLIC_APP_ORIGIN}/users/${f.userId}`);
        await disarmWatch(f.userId);
        touched += 1; continue;
      }
      if (cp === 'h1' && snapshot.allWorkerDone && !isApplicant) {
        // Nothing open (or readiness not populated yet) an hour in: no text, no close — the 24h check decides.
        await d.ref.set({ nextCheckpoint: 'h24', checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        touched += 1; continue;
      }
      if (snapshot.allWorkerDone) {
        const closing = snapshot.recruiterTodo.length
          ? `:white_check_mark: ${f.workerName} has finished everything on their side.\n${slackSummary(snapshot)}\nOnly recruiter steps remain.`
          : `:white_check_mark: ${f.workerName} is fully onboarded — nothing left on either side.\n${slackSummary(snapshot)}`;
        await d.ref.set({ status: 'done', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        // Applicants: put them on the shift they applied for — pending, so the standard offer text goes out.
        let placement: { placed: boolean; assignmentId?: string; reason?: string; title?: string; date?: string } | null = null;
        if (isApplicant && f.jobOrderId && f.shiftId) {
          placement = await placeApplicantOnAppliedShift({ db, tenantId: f.tenantId, userId: f.userId, jobOrderId: f.jobOrderId, shiftId: f.shiftId, tz: f.tz || 'America/Chicago', persona: who.persona })
            .catch((e: unknown) => ({ placed: false, reason: String(e).slice(0, 160) }));
          await d.ref.set({ placement: { placed: placement.placed, assignmentId: placement.assignmentId ?? null, reason: placement.reason ?? null, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
        }
        const placedLine = !placement
          ? ''
          : placement.placed
            ? `\n:calendar: Put them on ${placement.title} on ${placement.date} as pending — the offer text went out: ${PUBLIC_APP_ORIGIN}/assignments/${placement.assignmentId}`
            : `\n:warning: Didn't put them on the shift they applied for (${placement.reason || 'unknown'}) — a recruiter can place them from the job order.`;
        await say(`${closing}${placedLine}`);
        // A placed applicant's offer text is their "you're set" — no separate done text.
        if (!placement?.placed && (cp !== 'h24' || f.transcript.length || isApplicant)) await sendSms(f, composeDoneText(f, { persona: who.persona, lang }), `${P.smsPrefix}onboarding_done`).catch(() => undefined);
        await disarmWatch(f.userId);
        await recordNatalieAction({ tenantId: f.tenantId, persona: who.persona, kind: 'onboarding_followup_done', summary: `${f.workerName} finished their onboarding steps${placement?.placed ? ` — placed on ${placement.title} ${placement.date}` : ''}`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack });
        touched += 1; continue;
      }
      if (!textingPass) {
        // Applicant re-check between checkpoints: still open, nothing to text yet.
        await d.ref.set({ doneProbeAt: admin.firestore.FieldValue.serverTimestamp(), checkpointClaimAt: admin.firestore.FieldValue.delete() }, { merge: true });
        continue;
      }
      if (cp === 'd7') {
        await d.ref.set({ status: 'parked', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await say(`:hourglass: 7 days in and ${f.workerName} still hasn't finished: ${snapshot.workerTodo.join(', ')}. I've texted them ${f.transcript.filter((t) => t.dir === 'out').length} time(s)${f.lastIntent ? ` (last read as: ${f.lastIntent})` : ' with no reply'}. Parking this — say "remove ${f.firstName} from ${f.jobTitle}" if we should move on, or "keep following up with ${f.firstName}".`);
        await disarmWatch(f.userId);
        touched += 1; continue;
      }
      // Text the worker about what's open; on the 72h pass also re-send the Everee invite if payroll is still open.
      const text = composeCheckpointText(f, snapshot, cp, { persona: who.persona, lang });
      const sent = await sendSms(f, text, `${P.smsPrefix}${CHECKPOINT_MESSAGE_SUFFIX[cp] ?? 'onboarding_72h'}`);
      if (sent.success) sentThisTick += 1;
      let resent = '';
      if (cp === 'h72' && snapshot.everee.inviteSent && !snapshot.everee.complete && f.hiringEntityId) {
        try {
          const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
          const r = await runPayrollOnboardingInviteResend({ tenantId: f.tenantId, userId: f.userId, hiringEntityId: f.hiringEntityId, initiatedByUid: who.persona, assignmentId: f.assignmentId });
          resent = r.ok ? ' I also re-sent their Everee onboarding link.' : ` (Everee link resend skipped: ${s((r as { skipReason?: string }).skipReason) || 'not ok'})`;
        } catch (e) { resent = ` (Everee link resend failed: ${String(e).slice(0, 120)})`; }
      }
      const transcript = [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'out' as const, text }].slice(-30);
      let next = NEXT[cp];
      while (next && (tsToDate(f.startedAt)?.getTime() ?? 0) + CHECKPOINT_HOURS[next] * H < Date.now() && next !== 'd7') next = NEXT[next];
      await d.ref.set({ nextCheckpoint: next, checkpoints: { [cp]: { ...stamp, sent: sent.success, error: sent.error ?? null } }, transcript, lastTextAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (sent.success) await armWatch(f);
      const label = CHECKPOINT_LABEL[cp] ?? cp;
      await say(sent.success
        ? `${label} check on ${f.workerName}:\n${slackSummary(snapshot)}\nTexted them about the open items.${resent} Replies will show up here.`
        : `:warning: ${label} check on ${f.workerName}: text failed (${sent.error || 'unknown'}).\n${slackSummary(snapshot)}`);
      await recordNatalieAction({ tenantId: f.tenantId, persona: who.persona, kind: `onboarding_followup_${cp}`, summary: sent.success ? `Texted ${f.workerName} about open onboarding items: ${snapshot.workerTodo.join(', ')}` : `Could not text ${f.workerName} (${sent.error})`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack, result: { workerTodo: snapshot.workerTodo, recruiterTodo: snapshot.recruiterTodo } });
      touched += 1;
    } catch (err) {
      logger.warn('[natalie] onboarding checkpoint failed', { userId: f.userId, err: String(err) });
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------------------------
// Conversations: the worker texts back → Natalie answers, helps, escalates.
// ---------------------------------------------------------------------------------------------

const SMS_SYSTEM = `You are Natalie Brooks, recruiting assistant at C1 Staffing, texting a worker who is mid-onboarding. You are helping them finish paperwork so they can start work. You only know what is in the CONTEXT block; never invent links, dates, pay, or policy.

Reply rules: one SMS, plain text, under 300 characters, warm and direct, first name only, end with "— Natalie, C1 Staffing". Answer their question or acknowledge what they said; if they need a link you can resend, say you're sending it now. If they say they already finished something, thank them and say you'll confirm on our side (do not argue). If they are declining or refusing (won't do the background check, drug screen, or paperwork), be kind, don't pressure, say you'll let the recruiter know. If they ask about pay, schedule, or something outside onboarding, say a recruiter will follow up and do not guess. Never mention that you are an AI.

Return ONLY JSON: {"reply": string, "intent": "will_do" | "needs_link" | "says_done" | "question" | "declined" | "unclear" | "off_topic", "actions": string[], "note": string}
actions may include: "resend_background_link" (they need the AccuSource form link), "resend_everee_invite" (they need the Everee / tax / direct deposit link), "escalate" (a recruiter must act — put why in note). note = one line for the recruiter, or "".`;

/** Marco's version: same rules, his name, the worker's language, and he doesn't deny being automated when sincerely asked. */
const MARCO_SMS_SYSTEM = `You are Marco Gomez, recruiting assistant at C1 Staffing, texting an event worker (a 1099 independent contractor for C1 Events) who is mid-onboarding. You are helping them finish their setup so they can work events. You only know what is in the CONTEXT block; never invent links, dates, pay, or policy.

Reply rules: one SMS, plain text, under 300 characters, warm and direct, first name only, end with "— Marco, C1 Staffing". Write in the language the worker wrote in; if unclear, use their preferred language from CONTEXT (natural, friendly Spanish when it is Spanish). Answer their question or acknowledge what they said; if they need a link you can resend, say you're sending it now. If they say they already finished something, thank them and say you'll confirm on our side (do not argue). If they are declining or refusing (won't do the background check, drug screen, or paperwork), be kind, don't pressure, say you'll let Rosa's team know. If they ask about pay, schedule, or something outside onboarding, say someone on Rosa's team will follow up and do not guess. Don't bring up that you are an automated assistant, but if the worker sincerely asks whether they are texting a real person, don't deny it — say you're C1's automated recruiting assistant and someone on Rosa's team can call them.

Return ONLY JSON: {"reply": string, "intent": "will_do" | "needs_link" | "says_done" | "question" | "declined" | "unclear" | "off_topic", "actions": string[], "note": string}
actions may include: "resend_background_link" (they need the AccuSource form link), "resend_everee_invite" (they need the Everee / tax / direct deposit link), "escalate" (a recruiter must act — put why in note). note = one line for the recruiter, or "".`;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY unset');
    cachedClient = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }
  return cachedClient;
}

interface ConvoDecision { reply: string; intent: string; actions: string[]; note: string }

async function decideReply(f: FollowupDoc, snap: OnboardingSnapshot, inbound: string, persona: PersonaId = 'natalie'): Promise<ConvoDecision> {
  const me = PERSONAS[persona].firstName;
  const es = f.lang === 'es';
  const sign = smsSignature(persona, es ? 'es' : 'en');
  const ctx = [
    `Worker's preferred language: ${es ? 'Spanish' : 'English'}.`,
    `Worker: ${f.workerName} (first name ${f.firstName}). Job: ${f.jobTitle}${f.site ? ` at ${f.site}` : ''}. Employer entity: ${snap.entityLabel}. Recruiter: ${f.recruiterName || 'the recruiter'}.`,
    `Open items the worker owes: ${snap.workerTodo.length ? snap.workerTodo.join('; ') : 'none — everything on their side is done'}.`,
    snap.background ? `Background check: ${snap.background.packageName}, form ${snap.background.formDone ? 'DONE' : 'NOT started'}${snap.background.portalLink ? ` (link available to resend)` : ' (no link on file)'}.` : 'Background check: none ordered.',
    snap.drug.ordered ? `Drug screen: ${snap.drug.name || 'panel'} at ${snap.drug.lab || 'the lab'} — ${snap.drug.status}. Instructions come by email from AccuSource / the lab after the form; we cannot text that link, only a recruiter can resend it from AccuSource.` : 'Drug screen: none ordered.',
    `Everee (tax forms, direct deposit): ${snap.everee.complete ? 'complete' : snap.everee.inviteSent ? 'invite sent, not finished (link can be resent)' : 'not started (recruiter must send the invite)'}.`,
    `Recent texts (oldest first):\n${(f.transcript ?? []).slice(-10).map((t) => `${t.dir === 'out' ? me : f.firstName}: ${t.text}`).join('\n')}`,
  ].join('\n');
  const res = await client().messages.create({
    model: NATALIE_MODEL,
    max_tokens: 600,
    system: persona === 'marco' ? MARCO_SMS_SYSTEM : SMS_SYSTEM,
    messages: [{ role: 'user', content: `CONTEXT:\n${ctx}\n\nNEW TEXT FROM ${f.firstName.toUpperCase()}: "${inbound}"` }],
  });
  const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: Partial<ConvoDecision> = {};
  try { parsed = JSON.parse(m ? m[0] : raw) as Partial<ConvoDecision>; } catch { parsed = {}; }
  const fallback = es ? `Gracias ${f.firstName} — entendido. Le paso esto a tu reclutador y te contactará. ${sign}` : `Thanks ${f.firstName} — got it. I'll pass this to your recruiter and they'll follow up. ${sign}`;
  const reply = s(parsed.reply).slice(0, 320) || fallback;
  return { reply: new RegExp(me, 'i').test(reply) ? reply : `${reply} ${sign}`, intent: s(parsed.intent) || 'unclear', actions: Array.isArray(parsed.actions) ? parsed.actions.map(String) : [], note: s(parsed.note) };
}

export async function drainSmsConversations(tokensIn: string | PersonaTokens): Promise<number> {
  const tokens = asTokens(tokensIn);
  await runtimeOf(tokens);
  const pending = await db.collection(CONVOS).where('status', '==', 'pending').limit(15).get();
  let handled = 0;
  for (const d of pending.docs) {
    const c = d.data() as Record<string, unknown>;
    const userId = s(c.userId);
    const fRef = db.collection(FOLLOWUPS).doc(userId);
    const f = (await fRef.get()).data() as FollowupDoc | undefined;
    if (!f || !['active', 'parked'].includes(f.status)) { await d.ref.update({ status: 'ignored', updatedAt: admin.firestore.FieldValue.serverTimestamp() }); continue; }
    const inbound = s(c.text).slice(0, 500);
    const slack = f.slack ?? undefined;
    const who = tokenFor(tokens, f.persona);
    const P = PERSONAS[who.persona];
    const lang = f.lang === 'es' ? 'es' : 'en';
    const say = async (text: string) => { if (slack?.channel) await postAsNatalie(who.token, { channel: slack.channel, text, threadTs: slack.ts }); };
    try {
      const snap = await buildOnboardingSnapshot(f.tenantId, f.userId, f.assignmentId, { hiringEntityId: f.hiringEntityId });
      const decision = await decideReply({ ...f, transcript: [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'in', text: inbound }] }, snap, inbound, who.persona);
      const notes: string[] = [];
      const sent = await sendSms(f, decision.reply, `${P.smsPrefix}onboarding_reply`);
      const transcript = [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'in' as const, text: inbound }, { at: new Date().toISOString(), dir: 'out' as const, text: decision.reply }].slice(-30);
      for (const a of decision.actions) {
        if (a === 'resend_background_link' && snap.background?.portalLink && !snap.background.formDone) {
          const { portalLinkText } = await import('./natalieFill');
          const r = await sendSms(f, portalLinkText(f.firstName, snap.background.portalLink, snap.background.packageName, false, { persona: who.persona, lang }), `${P.smsPrefix}bg_portal_link`);
          notes.push(r.success ? 'resent the AccuSource form link' : 'AccuSource link resend failed');
        } else if (a === 'resend_everee_invite' && f.hiringEntityId) {
          try {
            const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
            const r = await runPayrollOnboardingInviteResend({ tenantId: f.tenantId, userId: f.userId, hiringEntityId: f.hiringEntityId, initiatedByUid: who.persona, assignmentId: f.assignmentId });
            notes.push(r.ok ? 'resent the Everee onboarding invite' : `Everee resend skipped (${s((r as { skipReason?: string }).skipReason) || 'not ok'})`);
          } catch (e) { notes.push(`Everee resend failed: ${String(e).slice(0, 100)}`); }
        } else if (a === 'escalate') {
          notes.push(`needs a recruiter: ${decision.note || 'see their text'}`);
        }
      }
      const cfg = await natalieConfig();
      let status: FollowupDoc['status'] = f.status;
      let verify: FollowupDoc['verifyClaim'] = null;
      if (decision.intent === 'declined') {
        status = 'declined';
        if (cfg.autoRemoveOnDecline === true && f.jobOrderId) {
          const r = await removeWorkerFromJob({ tenantId: f.tenantId, userId: f.userId, jobOrderId: f.jobOrderId, reason: `declined onboarding/screening by text: "${inbound.slice(0, 80)}"`, slack, askedByName: 'auto (declined by text)', persona: who.persona });
          notes.push(`removed from ${f.jobTitle} (${r.cancelled} assignment${r.cancelled === 1 ? '' : 's'} cancelled); next candidates: ${r.nextCandidates.map((x) => x.name).join(', ') || 'none nearby'}`);
          status = 'removed';
        } else {
          notes.push(`:x: ${f.firstName} is declining — tell me "remove ${f.firstName} from ${f.jobTitle}" and I'll cancel their assignment and line up someone else`);
        }
      } else if (decision.intent === 'says_done') {
        if (snap.workerTodo.length) {
          // Never argue in the reply (the prompt thanks them); look again once the webhooks have had time.
          verify = { at: new Date().toISOString(), items: snap.workerTodo, text: inbound.slice(0, 200) };
          notes.push(`says it's done, but HRX still shows: ${snap.workerTodo.join(', ')} — re-checking in ${Math.round(VERIFY_DELAY_MS / 60_000)} min and re-sending the link if it still hasn't landed`);
        } else {
          notes.push("says it's done and HRX agrees — nothing open on their side");
        }
      }
      await fRef.set({
        transcript, lastIntent: decision.intent, lastInboundAt: admin.firestore.FieldValue.serverTimestamp(), status,
        ...(verify ? { verifyAt: admin.firestore.Timestamp.fromMillis(Date.now() + VERIFY_DELAY_MS), verifyClaim: verify } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await d.ref.update({ status: 'handled', intent: decision.intent, reply: decision.reply, actions: decision.actions, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await say(`Me → ${f.firstName}: "${decision.reply}"${sent.success ? '' : ` (send failed: ${sent.error})`}\n_read as: ${decision.intent.replace(/_/g, ' ')}_${notes.length ? `\n${notes.map((n) => `• ${n}`).join('\n')}` : ''}`);
      await recordNatalieAction({ tenantId: f.tenantId, persona: who.persona, kind: 'onboarding_sms_reply', summary: `Replied to ${f.workerName} (${decision.intent}): "${decision.reply.slice(0, 100)}"`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack, input: { inbound }, result: { intent: decision.intent, actions: decision.actions } });
      handled += 1;
    } catch (err) {
      logger.warn('[natalie] sms conversation failed', { userId, err: String(err) });
      await d.ref.update({ status: 'failed', lastError: String(err).slice(0, 300), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
  return handled;
}

// ---------------------------------------------------------------------------------------------
// "I already did it" re-check: trust the worker in the reply, verify against HRX ~25 min later.
// ---------------------------------------------------------------------------------------------

/**
 * Greg 2026-09-11: "this is a perfect example of when Natalie needs to reach out — maybe she needs to
 * give her the link again". A worker who says they finished is never argued with on the spot; this
 * pass looks again once the AccuSource / Everee webhooks have had time. Still open → she re-sends the
 * exact link once (the background form link, and the Everee invite when that is what they claimed).
 * Cleared → a :white_check_mark: in the thread and no text. One re-check per claim either way.
 */
export async function runClaimVerifications(tokensIn: string | PersonaTokens): Promise<number> {
  const tokens = asTokens(tokensIn);
  await runtimeOf(tokens);
  const due = await db.collection(FOLLOWUPS).where('verifyAt', '<=', admin.firestore.Timestamp.now()).limit(20).get();
  const clear = { verifyAt: admin.firestore.FieldValue.delete(), verifyClaim: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  let handled = 0;
  for (const d of due.docs) {
    const f = d.data() as FollowupDoc;
    if (!['active', 'parked'].includes(f.status)) { await d.ref.set(clear, { merge: true }); continue; }
    if (!inTextingHours(f.tz || 'America/Denver')) continue; // keep the claim armed until their daytime
    const who = tokenFor(tokens, f.persona ?? 'natalie');
    const P = PERSONAS[who.persona];
    const lang = f.lang === 'es' ? 'es' : 'en';
    const slack = f.slack ?? undefined;
    const say = async (text: string) => { if (slack?.channel) await postAsNatalie(who.token, { channel: slack.channel, text, threadTs: slack.ts }); };
    try {
      const snap = await buildOnboardingSnapshot(f.tenantId, f.userId, f.assignmentId, { hiringEntityId: f.hiringEntityId });
      const claimed = f.verifyClaim?.items ?? [];
      const stillOpen = claimed.length ? snap.workerTodo.filter((x) => claimed.includes(x)) : snap.workerTodo;
      if (!stillOpen.length) {
        await d.ref.set(clear, { merge: true });
        await say(`:white_check_mark: ${f.firstName} said they finished and HRX now agrees${claimed.length ? ` (${claimed.join(', ')})` : ''} — nothing re-sent.`);
        handled += 1;
        continue;
      }
      const bgOpen = snap.background && !snap.background.formDone && snap.background.portalLink;
      const notes: string[] = [];
      let text: string;
      let messageTypeId: string;
      if (bgOpen) {
        const { portalLinkText } = await import('./natalieFill');
        text = portalLinkText(f.firstName, snap.background!.portalLink, snap.background!.packageName, true, { persona: who.persona, lang });
        messageTypeId = `${P.smsPrefix}bg_portal_link`;
      } else {
        text = composeClaimRecheckText(f, stillOpen, { persona: who.persona, lang });
        messageTypeId = `${P.smsPrefix}onboarding_reply`;
      }
      const sent = await sendSms(f, text, messageTypeId);
      if (stillOpen.some((x) => /I-9|Everee|tax|handbook|policies/.test(x)) && f.hiringEntityId) {
        try {
          const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
          const r = await runPayrollOnboardingInviteResend({ tenantId: f.tenantId, userId: f.userId, hiringEntityId: f.hiringEntityId, initiatedByUid: who.persona, assignmentId: f.assignmentId });
          notes.push(r.ok ? 'also re-sent their Everee onboarding invite' : `Everee resend skipped (${s((r as { skipReason?: string }).skipReason) || 'not ok'})`);
        } catch (e) { notes.push(`Everee resend failed: ${String(e).slice(0, 100)}`); }
      }
      const transcript = [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'out' as const, text }].slice(-30);
      await d.ref.set({ ...clear, transcript, ...(sent.success ? { lastTextAt: admin.firestore.FieldValue.serverTimestamp() } : {}) }, { merge: true });
      if (sent.success) await armWatch(f);
      await say(sent.success
        ? `:repeat: ${f.firstName} said they finished, but HRX still shows: ${stillOpen.join(', ')}. I re-sent ${bgOpen ? 'the AccuSource form link' : 'the details'}.${notes.length ? ` ${notes.join('; ')}.` : ''}\n${slackSummary(snap)}`
        : `:warning: ${f.firstName} said they finished but HRX still shows: ${stillOpen.join(', ')} — my re-send failed (${sent.error || 'unknown'}).\n${slackSummary(snap)}`);
      await recordNatalieAction({ tenantId: f.tenantId, persona: who.persona, kind: 'onboarding_claim_recheck', summary: sent.success ? `Re-sent ${bgOpen ? 'the AccuSource link' : 'the open items'} to ${f.workerName} — still open: ${stillOpen.join(', ')}` : `Could not re-send to ${f.workerName} (${sent.error})`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack, result: { stillOpen, claimed } });
      handled += 1;
    } catch (err) {
      logger.warn('[natalie] claim verification failed', { userId: f.userId, err: String(err) });
      await d.ref.set(clear, { merge: true }).catch(() => undefined);
    }
  }
  return handled;
}

// ---------------------------------------------------------------------------------------------
// Removal: cancel the worker's assignments on the order and hand back the next candidates.
// ---------------------------------------------------------------------------------------------

export async function removeWorkerFromJob(input: { tenantId: string; userId: string; jobOrderId: string; reason: string; slack?: SlackRef; askedByName?: string; askedBySlackUserId?: string; persona?: PersonaId }): Promise<{ cancelled: number; assignmentIds: string[]; nextCandidates: Array<{ userId: string; name: string; city: string; background: string; score: number; reasons: string[] }>; note: string }> {
  const { tenantId, userId, jobOrderId } = input;
  const persona: PersonaId = input.persona ?? 'natalie';
  const q = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).where('jobOrderId', '==', jobOrderId).limit(50).get();
  const live = q.docs.filter((d) => !['cancelled', 'canceled', 'declined', 'ended', 'completed'].includes(s(d.get('status')).toLowerCase()));
  const batch = db.batch();
  for (const d of live) {
    batch.set(d.ref, { status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp(), canceledBy: persona, cancelReason: input.reason.slice(0, 200), cancelSource: `${persona}_onboarding_followup`, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  if (live.length) await batch.commit();
  const u = (await db.doc(`users/${userId}`).get()).data() ?? {};
  const name = `${s(u.firstName)} ${s(u.lastName)}`.trim() || userId;
  await db.collection('users').doc(userId).collection('notes').add({ content: `Removed from job order ${jobOrderId} by ${PERSONAS[persona].firstName}: ${input.reason}`, authorName: PERSONAS[persona].displayName, authorId: PERSONAS[persona].hrxUid ?? persona, createdAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => undefined);
  await db.collection(FOLLOWUPS).doc(userId).set({ status: 'removed', nextCheckpoint: null, removedAt: admin.firestore.FieldValue.serverTimestamp(), removedReason: input.reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
  await disarmWatch(userId);
  let nextCandidates: Array<{ userId: string; name: string; city: string; background: string; score: number; reasons: string[] }> = [];
  try {
    const { candidatesForJobOrder } = await import('./natalieFill');
    const c = await candidatesForJobOrder(tenantId, jobOrderId, { limit: 5 });
    nextCandidates = [...c.applicants, ...c.nearby].filter((x) => x.userId !== userId).slice(0, 5).map((x) => ({ userId: x.userId, name: x.name, city: x.city, background: x.background, score: x.score, reasons: x.reasons.slice(0, 3) }));
  } catch (e) { logger.warn('[natalie] next candidates lookup failed', { err: String(e) }); }
  const note = live.length ? `Cancelled ${live.length} assignment${live.length === 1 ? '' : 's'} for ${name} on this order (they get the standard cancellation text).` : `${name} had no live assignment on this order — nothing to cancel.`;
  await recordNatalieAction({ tenantId, persona, kind: 'remove_from_job', askedByName: input.askedByName, askedBySlackUserId: input.askedBySlackUserId, slack: input.slack, summary: `${note} Reason: ${input.reason}`, userId, jobOrderId, input: { reason: input.reason }, result: { cancelled: live.length, nextCandidates: nextCandidates.map((x) => x.name) } });
  return { cancelled: live.length, assignmentIds: live.map((d) => d.id), nextCandidates, note };
}

/** Natalie tool: what she's following up on right now. */
export async function listOnboardingFollowups(tenantId: string, opts: { includeClosed?: boolean; persona?: PersonaId } = {}): Promise<unknown> {
  const q = opts.includeClosed
    ? await db.collection(FOLLOWUPS).where('tenantId', '==', tenantId).orderBy('updatedAt', 'desc').limit(40).get()
    : await db.collection(FOLLOWUPS).where('tenantId', '==', tenantId).where('status', 'in', ['active', 'parked', 'declined', 'no_phone']).limit(60).get();
  return q.docs.filter((d) => !opts.persona || (s(d.get('persona')) || 'natalie') === opts.persona).map((d) => {
    const f = d.data() as FollowupDoc;
    const last = (f.checkpoints ?? {}) as Record<string, { workerTodo?: string[]; recruiterTodo?: string[] }>;
    const latest = last.d7 ?? last.h72 ?? last.h24 ?? null;
    return { userId: f.userId, worker: f.workerName, job: f.jobTitle, site: f.site, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, recruiter: f.recruiterName, source: f.source, status: f.status, startedAt: tsToDate(f.startedAt)?.toISOString() ?? null, nextCheckpoint: f.nextCheckpoint, workerStillOwes: latest?.workerTodo ?? null, recruiterOwes: latest?.recruiterTodo ?? null, lastIntent: f.lastIntent, textsSent: (f.transcript ?? []).filter((t) => t.dir === 'out').length, lastReply: [...(f.transcript ?? [])].reverse().find((t) => t.dir === 'in')?.text ?? null, hrxLink: `${PUBLIC_APP_ORIGIN}/users/${f.userId}` };
  });
}
