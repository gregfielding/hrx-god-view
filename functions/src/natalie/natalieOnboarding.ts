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
const SIGN = '— Natalie, C1 Staffing';

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

export async function buildOnboardingSnapshot(tenantId: string, userId: string, assignmentId: string | null): Promise<OnboardingSnapshot> {
  const asg = assignmentId ? (await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get()).data() ?? null : null;
  const hiringEntityId = s(asg?.hiringEntityId) || s(asg?.entityId);
  const rs = (asg?.readinessSnapshotV1 ?? {}) as { requirements?: Array<{ key: string; label: string; status: string }> };
  const steps: OnboardingStep[] = [];
  for (const r of rs.requirements ?? []) {
    if (r.key === 'background_check') continue;
    steps.push({ key: r.key, label: STEP_LABELS[r.key] || r.label, status: r.status, actor: r.key === 'payroll_setup' && r.status === 'missing' ? 'recruiter' : 'worker' });
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
  recruiterUid: string | null; recruiterName: string; source: 'onboarding_instance' | 'background_check';
  startedAt: admin.firestore.Timestamp; tz: string; status: 'active' | 'done' | 'declined' | 'parked' | 'removed' | 'no_phone';
  nextCheckpoint: 'h24' | 'h72' | 'd7' | null; checkpoints: Record<string, unknown>;
  slack: SlackRef | null; transcript: Array<{ at: string; dir: 'out' | 'in'; text: string }>;
  lastIntent: string | null; createdAt: admin.firestore.FieldValue; updatedAt: admin.firestore.FieldValue;
}

/** Enrolling late (e.g. first deploy, or an instance created days ago): start at the checkpoint that is still meaningful. */
function firstCheckpointFor(startedAt: Date): 'h24' | 'h72' | 'd7' {
  const ageH = (Date.now() - startedAt.getTime()) / H;
  return ageH < 36 ? 'h24' : ageH < 24 * 6 ? 'h72' : 'd7';
}

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
async function threadFor(token: string, channel: string, key: { jobOrderId: string | null; jobTitle: string; site: string; recruiterName: string; entity: string; source: FollowupDoc['source'] }): Promise<SlackRef> {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const id = `${key.jobOrderId || 'no-order'}__${day}`;
  const ref = db.collection('natalie_onboarding_threads').doc(id);
  const cur = (await ref.get()).data() as { channel?: string; ts?: string } | undefined;
  if (cur?.ts) return { channel: cur.channel || channel, ts: cur.ts };
  const what = key.source === 'onboarding_instance' ? 'onboarding' : 'screening';
  const opener = `${what === 'onboarding' ? 'Onboarding' : 'Screening'} follow-ups — *${key.jobTitle}*${key.site ? ` at ${key.site}` : ''}${key.recruiterName ? ` (started by ${key.recruiterName})` : ''}. I check each worker's steps at 24h and 72h (tax forms, Everee payroll/direct deposit, I-9, handbook, background form, drug screen${key.entity === 'c1_select_llc' ? ', E-Verify on our side' : ''}), text them from my number about anything open, and post their replies here.`;
  const res = await postAsNatalie(token, { channel, text: opener });
  const slack: SlackRef = res.ok && res.ts ? { channel, ts: res.ts } : { channel };
  await ref.set({ ...slack, jobOrderId: key.jobOrderId, jobTitle: key.jobTitle, day, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return slack;
}

async function createFollowup(token: string, channel: string, base: { userId: string; assignmentId: string | null; jobOrderId: string | null; recruiterUid: string | null; startedAt: Date; source: FollowupDoc['source']; packageName?: string }): Promise<boolean> {
  const tenantId = TENANT;
  const u = (await db.doc(`users/${base.userId}`).get()).data() ?? {};
  const workerName = `${s(u.firstName)} ${s(u.lastName)}`.trim() || base.userId;
  const asg = base.assignmentId ? (await db.doc(`tenants/${tenantId}/assignments/${base.assignmentId}`).get()).data() ?? {} : {};
  const addr = (asg.worksiteAddress ?? {}) as Record<string, unknown>;
  const state = s(addr.state) || s(u.state) || s((u.address as Record<string, unknown> | undefined)?.state);
  const phone = phoneOf(u);
  const rName = await recruiterName(s(base.recruiterUid));
  const jobTitle = s(asg.jobTitle) || s(asg.title) || s(asg.jobOrderName) || (base.packageName ? `${base.packageName} screening` : 'your assignment');
  const site = s(asg.locationName) || s(asg.worksiteName) || s(asg.companyName);
  const who = `<https://hrxone.com/users/${base.userId}|${workerName}>`;
  const thread = await threadFor(token, channel, { jobOrderId: base.jobOrderId || s(asg.jobOrderId) || null, jobTitle, site, recruiterName: rName, entity: s(asg.hiringEntityId) || s(asg.entityId), source: base.source });
  const first = firstCheckpointFor(base.startedAt);
  const line = base.source === 'onboarding_instance'
    ? `• ${who} — onboarding started ${base.startedAt.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MT; first check at ${first === 'h24' ? '24h' : first === 'h72' ? '72h' : '7d'}.`
    : `• ${who} — ${base.packageName || 'background check'} ordered; I'll make sure the form gets done and that they know the drug screen (if any) is a separate step.`;
  await postAsNatalie(token, { channel: thread.channel, text: phone ? line : `${line}\n:warning: no usable phone on file — I can't text them: https://hrxone.com/users/${base.userId}`, threadTs: thread.ts });
  const doc: FollowupDoc = {
    tenantId, userId: base.userId, workerName, firstName: s(u.firstName) || workerName.split(' ')[0], phoneE164: phone,
    assignmentId: base.assignmentId, jobOrderId: base.jobOrderId || s(asg.jobOrderId) || null, jobTitle, site, hiringEntityId: s(asg.hiringEntityId) || s(asg.entityId),
    recruiterUid: base.recruiterUid, recruiterName: rName, source: base.source,
    startedAt: admin.firestore.Timestamp.fromDate(base.startedAt), tz: stateTz(state), status: phone ? 'active' : 'no_phone',
    nextCheckpoint: first, checkpoints: {}, slack: thread,
    transcript: [], lastIntent: null, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection(FOLLOWUPS).doc(base.userId).set(doc);
  await recordNatalieAction({ tenantId, kind: 'onboarding_followup_armed', summary: `Following up on ${workerName}'s onboarding${jobTitle ? ` for ${jobTitle}` : ''} (24h / 72h checks)`, userId: base.userId, jobOrderId: doc.jobOrderId, assignmentId: base.assignmentId, slack: doc.slack ?? undefined });
  return true;
}

/** Enroll one specific worker (scripts / tests / "follow up with X" asks). Returns false if they already have an active follow-up. */
export async function enrollWorkerFollowup(token: string, base: { userId: string; assignmentId: string | null; jobOrderId: string | null; recruiterUid: string | null; startedAt: Date; source: FollowupDoc['source']; packageName?: string }): Promise<boolean> {
  const cfg = await natalieConfig();
  const channel = s(cfg.onboardingChannelId) || s(cfg.recruitingChannelId) || DEFAULT_CHANNEL;
  const existing = (await db.collection(FOLLOWUPS).doc(base.userId).get()).data() as FollowupDoc | undefined;
  if (existing && existing.status === 'active') return false;
  return createFollowup(token, channel, base);
}

export async function enrollOnboardingFollowups(token: string): Promise<number> {
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
    const ok = await createFollowup(token, channel, { userId, assignmentId: s(x.assignmentId) || d.id, jobOrderId: s(x.jobOrderId) || null, recruiterUid: s((x.createdBy as Record<string, unknown> | undefined)?.userId) || null, startedAt, source: 'onboarding_instance' });
    if (ok) created += 1;
    if (created >= 10) break; // spread Slack posts across ticks
  }
  // 2) Screenings ordered by a human (Natalie's own orders already carry bgFollowup on the SMS watch).
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
    const ok = await createFollowup(token, channel, { userId, assignmentId: asg?.id ?? null, jobOrderId: s(asg?.data.jobOrderId) || s(x.jobOrderId) || null, recruiterUid: s(x.createdBy) || s(x.requestedBy) || null, startedAt, source: 'background_check', packageName: s(x.requestedPackageName) });
    if (ok) created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Checkpoints: 24h, 72h, 7d after onboarding started.
// ---------------------------------------------------------------------------------------------

const CHECKPOINT_HOURS: Record<string, number> = { h24: 24, h72: 72, d7: 24 * 7 };
const NEXT: Record<string, FollowupDoc['nextCheckpoint']> = { h24: 'h72', h72: 'd7', d7: null };

function listify(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function composeCheckpointText(f: Pick<FollowupDoc, 'firstName' | 'jobTitle'>, snap: OnboardingSnapshot, checkpoint: string): string {
  const name = f.firstName || 'there';
  const parts: string[] = [];
  const forJob = f.jobTitle && f.jobTitle !== 'your assignment' ? ` for ${f.jobTitle}` : ' with C1';
  const intro = checkpoint === 'h24'
    ? `Hi ${name}, it's Natalie with C1 Staffing. Quick check on your onboarding${forJob}.`
    : checkpoint === 'h72'
      ? `Hi ${name}, Natalie with C1 Staffing again — a few onboarding items are still open${forJob} and we can't schedule you until they're done.`
      : `Hi ${name}, it's Natalie with C1 Staffing. Last check on your onboarding${forJob} — is there something in the way?`;
  parts.push(intro);
  const bgOpen = snap.background && !snap.background.formDone;
  const drugOpen = snap.drug.ordered && snap.drug.status === 'pending' && snap.background?.formDone;
  const other = snap.workerTodo.filter((x) => !/AccuSource|drug screen/.test(x));
  // Everything except the profile declaration lives in the worker's Everee onboarding — say it once.
  const evereeBits = other.filter((x) => /I-9|Everee|tax|handbook|policies/.test(x)).map((x) => x.replace(/^I-9 \(your section\)$/, 'I-9').replace(/^Everee payroll setup \(direct deposit\)$/, 'direct deposit').replace(/^tax forms \(W-4\)$/, 'tax forms').replace(/^handbook signature$/, 'handbook').replace(/^policies acknowledgment$/, 'policies'));
  const rest = other.filter((x) => !/I-9|Everee|tax|handbook|policies/.test(x));
  const items: string[] = [];
  if (evereeBits.length) items.push(`your Everee onboarding (${listify(evereeBits)})${snap.everee.inviteSent ? ' — the link is in your texts/email; I can resend it' : ''}`);
  if (rest.length) items.push(listify(rest));
  if (items.length) parts.push(`Still open with us: ${items.join('; ')}.`);
  if (bgOpen) parts.push(`Your background check form hasn't been started: ${snap.background!.portalLink || 'check your texts for the AccuSource link'} (about 5 min).`);
  if (drugOpen) parts.push(`Heads up: your background form is done but the drug screen is a separate second step — look for the ${snap.drug.lab || 'lab'} registration email from AccuSource and get it done in the next couple of days.`);
  parts.push('Reply here if you need a link or have questions.');
  return `${parts.join(' ')} ${SIGN}`;
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
    tenantId: f.tenantId, userId: f.userId, phoneE164: f.phoneE164, workerName: f.workerName,
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

export async function runOnboardingCheckpoints(token: string): Promise<number> {
  const snap = await db.collection(FOLLOWUPS).where('status', '==', 'active').limit(80).get();
  let touched = 0;
  let sentThisTick = 0;
  for (const d of snap.docs) {
    const f = d.data() as FollowupDoc;
    const cp = f.nextCheckpoint;
    if (!cp) continue;
    const due = (tsToDate(f.startedAt)?.getTime() ?? 0) + CHECKPOINT_HOURS[cp] * H;
    if (Date.now() < due) continue;
    if (!inTextingHours(f.tz || 'America/Denver')) continue; // wait for the worker's daytime
    const lastText = tsToDate((f as unknown as { lastTextAt?: unknown }).lastTextAt)?.getTime() ?? 0;
    if (Date.now() - lastText < 20 * H) continue; // never two follow-up texts in one day
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
    const say = async (text: string) => { if (slack?.channel) await postAsNatalie(token, { channel: slack.channel, text, threadTs: slack.ts }); };
    try {
      const snapshot = await buildOnboardingSnapshot(f.tenantId, f.userId, f.assignmentId);
      const stamp = { at: admin.firestore.FieldValue.serverTimestamp(), workerTodo: snapshot.workerTodo, recruiterTodo: snapshot.recruiterTodo, sent: false };
      if (snapshot.background?.failed) {
        await d.ref.set({ status: 'parked', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await say(`:x: ${f.workerName}'s background check came back FAILED — I'm not texting them about onboarding. Recruiter decision needed: https://hrxone.com/users/${f.userId}`);
        await disarmWatch(f.userId);
        touched += 1; continue;
      }
      if (snapshot.allWorkerDone) {
        const closing = snapshot.recruiterTodo.length
          ? `:white_check_mark: ${f.workerName} has finished everything on their side.\n${slackSummary(snapshot)}\nOnly recruiter steps remain.`
          : `:white_check_mark: ${f.workerName} is fully onboarded — nothing left on either side.\n${slackSummary(snapshot)}`;
        await d.ref.set({ status: 'done', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await say(closing);
        if (cp !== 'h24' || f.transcript.length) await sendSms(f, `Hi ${f.firstName}, Natalie with C1 Staffing — you're all set on your onboarding paperwork for ${f.jobTitle}. Thank you! ${SIGN}`, 'natalie_onboarding_done').catch(() => undefined);
        await disarmWatch(f.userId);
        await recordNatalieAction({ tenantId: f.tenantId, kind: 'onboarding_followup_done', summary: `${f.workerName} finished their onboarding steps`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack });
        touched += 1; continue;
      }
      if (cp === 'd7') {
        await d.ref.set({ status: 'parked', nextCheckpoint: null, checkpoints: { [cp]: stamp }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await say(`:hourglass: 7 days in and ${f.workerName} still hasn't finished: ${snapshot.workerTodo.join(', ')}. I've texted them ${f.transcript.filter((t) => t.dir === 'out').length} time(s)${f.lastIntent ? ` (last read as: ${f.lastIntent})` : ' with no reply'}. Parking this — say "remove ${f.firstName} from ${f.jobTitle}" if we should move on, or "keep following up with ${f.firstName}".`);
        await disarmWatch(f.userId);
        touched += 1; continue;
      }
      // Text the worker about what's open; on the 72h pass also re-send the Everee invite if payroll is still open.
      const text = composeCheckpointText(f, snapshot, cp);
      const sent = await sendSms(f, text, cp === 'h24' ? 'natalie_onboarding_24h' : 'natalie_onboarding_72h');
      if (sent.success) sentThisTick += 1;
      let resent = '';
      if (cp === 'h72' && snapshot.everee.inviteSent && !snapshot.everee.complete && f.hiringEntityId) {
        try {
          const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
          const r = await runPayrollOnboardingInviteResend({ tenantId: f.tenantId, userId: f.userId, hiringEntityId: f.hiringEntityId, initiatedByUid: 'natalie', assignmentId: f.assignmentId });
          resent = r.ok ? ' I also re-sent their Everee onboarding link.' : ` (Everee link resend skipped: ${s((r as { skipReason?: string }).skipReason) || 'not ok'})`;
        } catch (e) { resent = ` (Everee link resend failed: ${String(e).slice(0, 120)})`; }
      }
      const transcript = [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'out' as const, text }].slice(-30);
      let next = NEXT[cp];
      while (next && (tsToDate(f.startedAt)?.getTime() ?? 0) + CHECKPOINT_HOURS[next] * H < Date.now() && next !== 'd7') next = NEXT[next];
      await d.ref.set({ nextCheckpoint: next, checkpoints: { [cp]: { ...stamp, sent: sent.success, error: sent.error ?? null } }, transcript, lastTextAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (sent.success) await armWatch(f);
      const label = cp === 'h24' ? '24h' : '72h';
      await say(sent.success
        ? `${label} check on ${f.workerName}:\n${slackSummary(snapshot)}\nTexted them about the open items.${resent} Replies will show up here.`
        : `:warning: ${label} check on ${f.workerName}: text failed (${sent.error || 'unknown'}).\n${slackSummary(snapshot)}`);
      await recordNatalieAction({ tenantId: f.tenantId, kind: `onboarding_followup_${cp}`, summary: sent.success ? `Texted ${f.workerName} about open onboarding items: ${snapshot.workerTodo.join(', ')}` : `Could not text ${f.workerName} (${sent.error})`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack, result: { workerTodo: snapshot.workerTodo, recruiterTodo: snapshot.recruiterTodo } });
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

async function decideReply(f: FollowupDoc, snap: OnboardingSnapshot, inbound: string): Promise<ConvoDecision> {
  const ctx = [
    `Worker: ${f.workerName} (first name ${f.firstName}). Job: ${f.jobTitle}${f.site ? ` at ${f.site}` : ''}. Employer entity: ${snap.entityLabel}. Recruiter: ${f.recruiterName || 'the recruiter'}.`,
    `Open items the worker owes: ${snap.workerTodo.length ? snap.workerTodo.join('; ') : 'none — everything on their side is done'}.`,
    snap.background ? `Background check: ${snap.background.packageName}, form ${snap.background.formDone ? 'DONE' : 'NOT started'}${snap.background.portalLink ? ` (link available to resend)` : ' (no link on file)'}.` : 'Background check: none ordered.',
    snap.drug.ordered ? `Drug screen: ${snap.drug.name || 'panel'} at ${snap.drug.lab || 'the lab'} — ${snap.drug.status}. Instructions come by email from AccuSource / the lab after the form; we cannot text that link, only a recruiter can resend it from AccuSource.` : 'Drug screen: none ordered.',
    `Everee (tax forms, direct deposit): ${snap.everee.complete ? 'complete' : snap.everee.inviteSent ? 'invite sent, not finished (link can be resent)' : 'not started (recruiter must send the invite)'}.`,
    `Recent texts (oldest first):\n${(f.transcript ?? []).slice(-10).map((t) => `${t.dir === 'out' ? 'Natalie' : f.firstName}: ${t.text}`).join('\n')}`,
  ].join('\n');
  const res = await client().messages.create({
    model: NATALIE_MODEL,
    max_tokens: 600,
    system: SMS_SYSTEM,
    messages: [{ role: 'user', content: `CONTEXT:\n${ctx}\n\nNEW TEXT FROM ${f.firstName.toUpperCase()}: "${inbound}"` }],
  });
  const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: Partial<ConvoDecision> = {};
  try { parsed = JSON.parse(m ? m[0] : raw) as Partial<ConvoDecision>; } catch { parsed = {}; }
  const reply = s(parsed.reply).slice(0, 320) || `Thanks ${f.firstName} — got it. I'll pass this to your recruiter and they'll follow up. ${SIGN}`;
  return { reply: /natalie/i.test(reply) ? reply : `${reply} ${SIGN}`, intent: s(parsed.intent) || 'unclear', actions: Array.isArray(parsed.actions) ? parsed.actions.map(String) : [], note: s(parsed.note) };
}

export async function drainSmsConversations(token: string): Promise<number> {
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
    const say = async (text: string) => { if (slack?.channel) await postAsNatalie(token, { channel: slack.channel, text, threadTs: slack.ts }); };
    try {
      const snap = await buildOnboardingSnapshot(f.tenantId, f.userId, f.assignmentId);
      const decision = await decideReply({ ...f, transcript: [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'in', text: inbound }] }, snap, inbound);
      const notes: string[] = [];
      const sent = await sendSms(f, decision.reply, 'natalie_onboarding_reply');
      const transcript = [...(f.transcript ?? []), { at: new Date().toISOString(), dir: 'in' as const, text: inbound }, { at: new Date().toISOString(), dir: 'out' as const, text: decision.reply }].slice(-30);
      for (const a of decision.actions) {
        if (a === 'resend_background_link' && snap.background?.portalLink && !snap.background.formDone) {
          const { portalLinkText } = await import('./natalieFill');
          const r = await sendSms(f, portalLinkText(f.firstName, snap.background.portalLink, snap.background.packageName), 'natalie_bg_portal_link');
          notes.push(r.success ? 'resent the AccuSource form link' : 'AccuSource link resend failed');
        } else if (a === 'resend_everee_invite' && f.hiringEntityId) {
          try {
            const { runPayrollOnboardingInviteResend } = await import('../messaging/payrollInviteResend');
            const r = await runPayrollOnboardingInviteResend({ tenantId: f.tenantId, userId: f.userId, hiringEntityId: f.hiringEntityId, initiatedByUid: 'natalie', assignmentId: f.assignmentId });
            notes.push(r.ok ? 'resent the Everee onboarding invite' : `Everee resend skipped (${s((r as { skipReason?: string }).skipReason) || 'not ok'})`);
          } catch (e) { notes.push(`Everee resend failed: ${String(e).slice(0, 100)}`); }
        } else if (a === 'escalate') {
          notes.push(`needs a recruiter: ${decision.note || 'see their text'}`);
        }
      }
      const cfg = await natalieConfig();
      let status: FollowupDoc['status'] = f.status;
      if (decision.intent === 'declined') {
        status = 'declined';
        if (cfg.autoRemoveOnDecline === true && f.jobOrderId) {
          const r = await removeWorkerFromJob({ tenantId: f.tenantId, userId: f.userId, jobOrderId: f.jobOrderId, reason: `declined onboarding/screening by text: "${inbound.slice(0, 80)}"`, slack, askedByName: 'auto (declined by text)' });
          notes.push(`removed from ${f.jobTitle} (${r.cancelled} assignment${r.cancelled === 1 ? '' : 's'} cancelled); next candidates: ${r.nextCandidates.map((x) => x.name).join(', ') || 'none nearby'}`);
          status = 'removed';
        } else {
          notes.push(`:x: ${f.firstName} is declining — tell me "remove ${f.firstName} from ${f.jobTitle}" and I'll cancel their assignment and line up someone else`);
        }
      } else if (decision.intent === 'says_done') {
        notes.push(`says it's done — I'll confirm at the next check${snap.workerTodo.length ? ` (HRX still shows: ${snap.workerTodo.join(', ')})` : ''}`);
      }
      await fRef.set({ transcript, lastIntent: decision.intent, lastInboundAt: admin.firestore.FieldValue.serverTimestamp(), status, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await d.ref.update({ status: 'handled', intent: decision.intent, reply: decision.reply, actions: decision.actions, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await say(`Me → ${f.firstName}: "${decision.reply}"${sent.success ? '' : ` (send failed: ${sent.error})`}\n_read as: ${decision.intent.replace(/_/g, ' ')}_${notes.length ? `\n${notes.map((n) => `• ${n}`).join('\n')}` : ''}`);
      await recordNatalieAction({ tenantId: f.tenantId, kind: 'onboarding_sms_reply', summary: `Replied to ${f.workerName} (${decision.intent}): "${decision.reply.slice(0, 100)}"`, userId: f.userId, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, slack, input: { inbound }, result: { intent: decision.intent, actions: decision.actions } });
      handled += 1;
    } catch (err) {
      logger.warn('[natalie] sms conversation failed', { userId, err: String(err) });
      await d.ref.update({ status: 'failed', lastError: String(err).slice(0, 300), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
  return handled;
}

// ---------------------------------------------------------------------------------------------
// Removal: cancel the worker's assignments on the order and hand back the next candidates.
// ---------------------------------------------------------------------------------------------

export async function removeWorkerFromJob(input: { tenantId: string; userId: string; jobOrderId: string; reason: string; slack?: SlackRef; askedByName?: string; askedBySlackUserId?: string }): Promise<{ cancelled: number; assignmentIds: string[]; nextCandidates: Array<{ userId: string; name: string; city: string; background: string; score: number; reasons: string[] }>; note: string }> {
  const { tenantId, userId, jobOrderId } = input;
  const q = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).where('jobOrderId', '==', jobOrderId).limit(50).get();
  const live = q.docs.filter((d) => !['cancelled', 'canceled', 'declined', 'ended', 'completed'].includes(s(d.get('status')).toLowerCase()));
  const batch = db.batch();
  for (const d of live) {
    batch.set(d.ref, { status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp(), canceledBy: 'natalie', cancelReason: input.reason.slice(0, 200), cancelSource: 'natalie_onboarding_followup', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  if (live.length) await batch.commit();
  const u = (await db.doc(`users/${userId}`).get()).data() ?? {};
  const name = `${s(u.firstName)} ${s(u.lastName)}`.trim() || userId;
  await db.collection('users').doc(userId).collection('notes').add({ content: `Removed from job order ${jobOrderId} by Natalie: ${input.reason}`, authorName: 'Natalie Brooks', authorId: 'natalie', createdAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => undefined);
  await db.collection(FOLLOWUPS).doc(userId).set({ status: 'removed', nextCheckpoint: null, removedAt: admin.firestore.FieldValue.serverTimestamp(), removedReason: input.reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
  await disarmWatch(userId);
  let nextCandidates: Array<{ userId: string; name: string; city: string; background: string; score: number; reasons: string[] }> = [];
  try {
    const { candidatesForJobOrder } = await import('./natalieFill');
    const c = await candidatesForJobOrder(tenantId, jobOrderId, { limit: 5 });
    nextCandidates = [...c.applicants, ...c.nearby].filter((x) => x.userId !== userId).slice(0, 5).map((x) => ({ userId: x.userId, name: x.name, city: x.city, background: x.background, score: x.score, reasons: x.reasons.slice(0, 3) }));
  } catch (e) { logger.warn('[natalie] next candidates lookup failed', { err: String(e) }); }
  const note = live.length ? `Cancelled ${live.length} assignment${live.length === 1 ? '' : 's'} for ${name} on this order (they get the standard cancellation text).` : `${name} had no live assignment on this order — nothing to cancel.`;
  await recordNatalieAction({ tenantId, kind: 'remove_from_job', askedByName: input.askedByName, askedBySlackUserId: input.askedBySlackUserId, slack: input.slack, summary: `${note} Reason: ${input.reason}`, userId, jobOrderId, input: { reason: input.reason }, result: { cancelled: live.length, nextCandidates: nextCandidates.map((x) => x.name) } });
  return { cancelled: live.length, assignmentIds: live.map((d) => d.id), nextCandidates, note };
}

/** Natalie tool: what she's following up on right now. */
export async function listOnboardingFollowups(tenantId: string, opts: { includeClosed?: boolean } = {}): Promise<unknown> {
  const q = opts.includeClosed
    ? await db.collection(FOLLOWUPS).where('tenantId', '==', tenantId).orderBy('updatedAt', 'desc').limit(40).get()
    : await db.collection(FOLLOWUPS).where('tenantId', '==', tenantId).where('status', 'in', ['active', 'parked', 'declined', 'no_phone']).limit(60).get();
  return q.docs.map((d) => {
    const f = d.data() as FollowupDoc;
    const last = (f.checkpoints ?? {}) as Record<string, { workerTodo?: string[]; recruiterTodo?: string[] }>;
    const latest = last.d7 ?? last.h72 ?? last.h24 ?? null;
    return { userId: f.userId, worker: f.workerName, job: f.jobTitle, site: f.site, jobOrderId: f.jobOrderId, assignmentId: f.assignmentId, recruiter: f.recruiterName, source: f.source, status: f.status, startedAt: tsToDate(f.startedAt)?.toISOString() ?? null, nextCheckpoint: f.nextCheckpoint, workerStillOwes: latest?.workerTodo ?? null, recruiterOwes: latest?.recruiterTodo ?? null, lastIntent: f.lastIntent, textsSent: (f.transcript ?? []).filter((t) => t.dir === 'out').length, lastReply: [...(f.transcript ?? [])].reverse().find((t) => t.dir === 'in')?.text ?? null, hrxLink: `https://hrxone.com/users/${f.userId}` };
  });
}
