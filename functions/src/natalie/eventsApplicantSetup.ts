/**
 * C1 Events applicants who haven't finished setup (Greg 2026-09-11: "There are a bunch of applicants
 * before we activated claiming. Can Marco reach out to each of them to help them get their onboarding
 * complete? Then he can assign them.").
 *
 *   - `eventsSetupSteps` — the C1 Events (1099) checklist for a worker with no assignment: profile
 *     photo (the server headshot gate), direct deposit, 1099 tax form (W-9). No I-9 / W-4. Finished
 *     payroll (`isPayrollReadyForClaim`, the Claim Shift gate's rule) marks both payroll steps done —
 *     the readiness mirror's `w9SignedAt` was missing on 969 of 2,255 Everee-complete C1 Events
 *     workers that day. Web twin: src/utils/claimShift/claimReadiness.ts `eventsSetupSteps`.
 *   - `placeApplicantOnAppliedShift` — once the follow-up sees everything done, put the worker on the
 *     shift they applied for as a PENDING assignment (logAssignmentCreated sends the standard offer
 *     text), unless they're already on the order, the application is gone, the shift started or is full.
 */
import * as admin from 'firebase-admin';
import { evaluateHeadshotGate } from '../avatar/headshotAcceptGate';
import { isPayrollReadyForClaim } from '../claims/claimShiftPolicy';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';
import { PERSONAS, type PersonaId } from './personas';
import type { OnboardingStep } from './natalieOnboarding';

export const C1_EVENTS_ENTITY_ID = 'c1_events_llc';

/** Labels double as the worker text items (natalieOnboarding ES_ITEM carries their Spanish). */
export const EVENTS_STEP_LABELS = {
  profile_photo: `profile photo (${PUBLIC_APP_ORIGIN}/c1/workers/profile)`,
  payroll_setup: 'Everee payroll setup (direct deposit)',
  tax_form: '1099 tax form (W-9)',
} as const;

type Row = Record<string, unknown>;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const NOT_LIVE = ['cancelled', 'canceled', 'declined', 'ended', 'completed'];
const DEAD_APPLICATION = ['withdrawn', 'rejected', 'declined', 'archived'];

/** Pure. `employments` = the worker's rows AT C1 Events; `link` = `everee_workers/c1_events_llc__{uid}`. */
export function eventsSetupSteps(args: { user: Row; employments: Row[]; link: Row | null }): OnboardingStep[] {
  const payrollReady = isPayrollReadyForClaim(args.employments, args.link);
  const mirror = (args.link?.readinessMirror ?? null) as Row | null;
  const directDeposit =
    payrollReady ||
    mirror?.directDepositReady === true ||
    Boolean(mirror?.directDepositVerifiedAt) ||
    Number(mirror?.bankAccountCount ?? 0) > 0;
  const taxForm = payrollReady || Boolean(mirror?.w9SignedAt);
  // A hire (employment row or Everee link) means the invite went out and the worker can finish it.
  const hired = Boolean(args.link) || args.employments.length > 0;
  const photo = evaluateHeadshotGate(args.user as Parameters<typeof evaluateHeadshotGate>[0]).allow;
  const payroll = directDeposit ? 'complete' : hired ? 'in_progress' : 'missing';
  return [
    { key: 'profile_photo', label: EVENTS_STEP_LABELS.profile_photo, status: photo ? 'complete' : 'missing', actor: 'worker' },
    { key: 'payroll_setup', label: EVENTS_STEP_LABELS.payroll_setup, status: payroll, actor: payroll === 'missing' ? 'recruiter' : 'worker' },
    { key: 'tax_form', label: EVENTS_STEP_LABELS.tax_form, status: taxForm ? 'complete' : 'missing', actor: 'worker' },
  ];
}

export async function loadEventsSetupSteps(db: admin.firestore.Firestore, tenantId: string, userId: string): Promise<OnboardingStep[]> {
  const [userSnap, employments, linkSnap] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', userId).get(),
    db.doc(`tenants/${tenantId}/everee_workers/${C1_EVENTS_ENTITY_ID}__${userId}`).get(),
  ]);
  return eventsSetupSteps({
    user: (userSnap.data() ?? {}) as Row,
    employments: employments.docs.map((d) => d.data() as Row).filter((e) => s(e.entityId) === C1_EVENTS_ENTITY_ID),
    link: linkSnap.exists ? ((linkSnap.data() ?? {}) as Row) : null,
  });
}

export const eventsSetupDone = (steps: OnboardingStep[]): boolean =>
  steps.every((x) => x.status === 'complete' || x.status === 'not_applicable');

/** Pure: the shift's local start ("YYYY-MM-DD" + "HH:MM") has passed in `tz`. */
export function shiftStarted(date: string, startTime: string, tz: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(startTime);
  const start = `${date} ${m ? `${m[1].padStart(2, '0')}:${m[2]}` : '00:00'}`;
  const local = now.toLocaleString('sv-SE', { timeZone: tz, hour12: false }).slice(0, 16);
  return local >= start;
}

export async function placeApplicantOnAppliedShift(input: {
  db: admin.firestore.Firestore;
  tenantId: string;
  userId: string;
  jobOrderId: string;
  shiftId: string;
  tz: string;
  persona: PersonaId;
}): Promise<{ placed: boolean; assignmentId?: string; reason?: string; title?: string; date?: string; startTime?: string; site?: string }> {
  const { db, tenantId, userId, jobOrderId, shiftId } = input;
  const assignments = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).limit(100).get();
  if (assignments.docs.some((d) => s(d.get('jobOrderId')) === jobOrderId && !NOT_LIVE.includes(s(d.get('status')).toLowerCase()))) {
    return { placed: false, reason: 'already on this order' };
  }
  const applications = await db.collection(`tenants/${tenantId}/applications`).where('userId', '==', userId).limit(100).get();
  const onOrder = applications.docs.filter((d) => s(d.get('jobOrderId')) === jobOrderId);
  if (onOrder.length && onOrder.every((d) => DEAD_APPLICATION.includes(s(d.get('status')).toLowerCase()))) {
    return { placed: false, reason: 'application withdrawn' };
  }
  const { loadShift, placeWorkerOnShift } = await import('./natalieFill');
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { placed: false, reason: 'shift not found' };
  const { ref, shift } = loaded;
  const base = { title: ref.title, date: ref.date, startTime: ref.startTime, site: ref.site };
  if (['cancelled', 'canceled'].includes(s(shift.status).toLowerCase())) return { ...base, placed: false, reason: 'shift cancelled' };
  if (shiftStarted(ref.date, ref.startTime, input.tz)) return { ...base, placed: false, reason: 'shift already started' };
  const liveFill = (shift.liveFill ?? {}) as { remaining?: unknown; remainingByDay?: Record<string, unknown> };
  const dayRemaining = liveFill.remainingByDay?.[ref.date];
  const remaining = typeof dayRemaining === 'number' ? dayRemaining : typeof liveFill.remaining === 'number' ? liveFill.remaining : null;
  if (remaining != null && remaining <= 0) return { ...base, placed: false, reason: 'shift is full' };
  const P = PERSONAS[input.persona];
  const r = await placeWorkerOnShift(tenantId, jobOrderId, shiftId, userId, {
    source: `${input.persona}_onboarding_done`,
    note: `Placed by ${P.firstName} after they finished C1 Events setup`,
    actor: P.hrxUid ?? undefined,
    status: 'pending',
  });
  return { ...base, placed: r.placed, assignmentId: r.assignmentId || undefined, reason: r.placed ? undefined : r.already ? 'already on this shift' : r.error };
}
