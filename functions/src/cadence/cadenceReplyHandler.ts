/**
 * Cadence Reply Handler
 *
 * Phase 2A + 2B of the Shift Cadence Engine.
 *
 * The inbound SMS webhook calls `handleCadenceReply` BEFORE the generic
 * STOP/HELP/START keyword matcher. When the sender has an active CORT-style
 * cadence, we:
 *
 *   - Resolve the relevant assignment (different lookup per intent)
 *   - Classify the reply via the pure classifier
 *   - Mutate assignment.cortConfirmation.state (confirm / cancel / check-in)
 *     OR attach a walkOffRisk flag (walk-off warning — does NOT mutate state)
 *   - Cancel reminders that are now irrelevant
 *   - Send a short SMS receipt (or the walk-off warning template)
 *   - For cancellation / walk-off / no-show, alert recruiters via
 *     `notifyRecruitersOnWorkerEvent` → dashboardFeed
 *   - Return { handled: true } so the webhook short-circuits
 *
 * When no active cadence exists, we return `{ handled: false }` untouched —
 * so bare "YES" still routes to the START keyword handler (SMS compliance
 * opt-in), bare "CANCEL" still routes to STOP, etc. That's the whole reason
 * this runs in-front-of the generic matcher.
 *
 * Intent → lookup matrix:
 *   confirmation / cancellation  → findPendingCadence (future-start only)
 *   check_in / walk_off_warning  → findActiveOrRecentCadence (start ±12h)
 *
 * Scope limits (Phase 2B):
 *   - Keyword classifier only; LLM classifier is Phase 3.
 *   - Walk-off warning does NOT currently upgrade state — it's a passive flag
 *     + recruiter alert + worker-facing reassurance. Upgrading to a true
 *     "walked_off" state would require post-shift clock-out reconciliation
 *     which lives outside the reply pipeline.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { sendWorkerMessageInternal } from '../twilio';
import { notifyRecruitersOnWorkerEvent } from '../messaging/notifyRecruitersOnWorkerEvent';
import { classifyCadenceReply, type CadenceReplyIntent } from './replyClassifier';
import { ALL_SHIFT_REMINDER_TYPES, type ShiftReminderType } from './shiftReminderProfile';
import { getTenantSmsBrand } from './sequenceCopyOverrides';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REMINDER_SUBCOLLECTION = 'scheduled_notifications';
const REMINDER_KIND = 'worker_shift_reminder';

const ESCALATION_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
];

/**
 * Reminders to drop once the worker has checked in — the T+0 reminder is
 * redundant and the T+30 no-show check would false-positive if it ran.
 */
const CHECKIN_REDUNDANT_REMINDER_TYPES: ReadonlyArray<ShiftReminderType> = [
  'assignment_checkin_0h',
  'assignment_noshow_check',
];

const ACTIVE_CADENCE_WINDOW_MS = 12 * 60 * 60 * 1000; // ±12h from start

export interface HandleCadenceReplyArgs {
  phoneE164: string;
  messageBody: string;
  twilioMessageSid?: string;
}

export interface HandleCadenceReplyResult {
  handled: boolean;
  intent?: CadenceReplyIntent;
  assignmentId?: string;
  tenantId?: string;
  reason?: string;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function toTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return admin.firestore.Timestamp.fromDate(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }
  if (typeof value === 'object' && value !== null) {
    const maybe = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toDate === 'function') {
      const d = maybe.toDate();
      return Number.isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
    }
    if (typeof maybe.seconds === 'number') {
      try {
        return new admin.firestore.Timestamp(maybe.seconds, maybe.nanoseconds ?? 0);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Mirror of workerShiftRemindersV2.resolveAssignmentStart — duplicated here
 * to avoid a circular import. Do not let them drift.
 */
function resolveAssignmentStart(assignment: Record<string, unknown>): admin.firestore.Timestamp | null {
  const direct = toTimestamp(assignment.startDateTime);
  if (direct) return direct;
  const dateTs = toTimestamp(assignment.startDate);
  const time = assignment.startTime;
  if (dateTs && typeof time === 'string') {
    const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const hh = Math.max(0, Math.min(23, Number(m[1])));
      const mm = Math.max(0, Math.min(59, Number(m[2])));
      const d = dateTs.toDate();
      return admin.firestore.Timestamp.fromDate(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm, 0, 0)),
      );
    }
  }
  return dateTs;
}

/**
 * Resolve the user record for this phone number.
 *
 * NOTE: The `users` collection can (rarely) contain duplicates for a shared
 * phone. The existing STOP handler takes `.limit(1)` and moves on, and we
 * mirror that here for consistency. If ambiguity becomes a real problem the
 * correct fix is at the thread layer, not here.
 */
async function findUserByPhone(
  phoneE164: string,
): Promise<{ userId: string; lang: 'en' | 'es' } | null> {
  const snap = await db
    .collection('users')
    .where('phoneE164', '==', phoneE164)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const lang =
    String(snap.docs[0].get('preferredLanguage') ?? '').toLowerCase() === 'es' ? 'es' : 'en';
  return { userId: snap.docs[0].id, lang };
}

export interface ActiveCadence {
  tenantId: string;
  assignmentId: string;
  assignment: Record<string, unknown>;
  startMs: number;
  state: string;
  /** When we last ASKED this worker to confirm this shift (0 = never). */
  lastAskedAtMs: number;
}

/**
 * Order two candidate shifts by "which one is this reply about?".
 *
 * The worker is answering the message they just received, so the shift we most
 * recently asked about wins. Only when neither has been asked (or both were
 * asked at the same instant) do we fall back to the earliest start, which was
 * the sole rule before 2026-08-31 — and which mis-routed every reply from any
 * worker holding two pending shifts on one day.
 */
export function compareByAskThenStart(a: ActiveCadence, b: ActiveCadence): number {
  if (a.lastAskedAtMs !== b.lastAskedAtMs) return b.lastAskedAtMs - a.lastAskedAtMs;
  return a.startMs - b.startMs;
}

/**
 * Load every assignment for this worker that is currently carrying a
 * cortConfirmation object. In-memory filter then picks out the ones matching
 * the caller's intent. Worker assignment counts per tenant are low
 * (typically <20 active at a time), so this fan-out is cheap.
 */
async function loadWorkerCadenceAssignments(workerId: string): Promise<ActiveCadence[]> {
  const snap = await db
    .collectionGroup('assignments')
    .where('userId', '==', workerId)
    .get();
  if (snap.empty) return [];

  const out: ActiveCadence[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const cort = data.cortConfirmation as Record<string, unknown> | undefined;
    const state = normalizeLower(cort?.state);
    if (!state) continue;

    const start = resolveAssignmentStart(data);
    if (!start) continue;

    const tenantId = docSnap.ref.parent.parent?.id;
    if (!tenantId) continue;

    const lastAsked = cort?.lastAskedAt as admin.firestore.Timestamp | undefined;

    out.push({
      tenantId,
      assignmentId: docSnap.id,
      assignment: data,
      startMs: start.toMillis(),
      state,
      lastAskedAtMs: typeof lastAsked?.toMillis === 'function' ? lastAsked.toMillis() : 0,
    });
  }
  return out;
}

/**
 * Pre-shift confirmation lookup — used for YES / CANCEL intents. Only
 * matches assignments whose state is still `pending` and whose start is in
 * the future. Returns the earliest one.
 */
export function pickPendingCadence(cadences: ActiveCadence[]): ActiveCadence | null {
  const now = Date.now();
  const candidates = cadences.filter(
    (c) => c.state === 'pending' && c.startMs > now,
  );
  if (candidates.length === 0) return null;
  candidates.sort(compareByAskThenStart);
  return candidates[0];
}

/**
 * Cancellation lookup — like pickPendingCadence but ALSO matches `confirmed`
 * future shifts. A worker who replied YES yesterday and texts CANCEL today
 * is cancelling that confirmed shift; before 2026-08-29 the pending-only
 * filter dropped this reply, it fell through to the compliance STOP handler
 * (CANCEL is a STOP synonym), and the worker was silently unsubscribed from
 * ALL SMS while the shift stayed marked confirmed.
 */
function pickCancellableCadence(cadences: ActiveCadence[]): ActiveCadence | null {
  const now = Date.now();
  const candidates = cadences.filter(
    (c) => (c.state === 'pending' || c.state === 'confirmed') && c.startMs > now,
  );
  if (candidates.length === 0) return null;
  candidates.sort(compareByAskThenStart);
  return candidates[0];
}

/**
 * Around-the-shift lookup — used for HERE / walk-off intents. Matches any
 * assignment whose start is within ±12h of "now" AND whose state is
 * pending/confirmed/checked_in. Picks the one closest to now.
 */
function pickActiveOrRecentCadence(cadences: ActiveCadence[]): ActiveCadence | null {
  const now = Date.now();
  const candidates = cadences.filter(
    (c) => {
      if (c.state !== 'pending' && c.state !== 'confirmed' && c.state !== 'checked_in') return false;
      return Math.abs(c.startMs - now) <= ACTIVE_CADENCE_WINDOW_MS;
    },
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.startMs - now) - Math.abs(b.startMs - now));
  return candidates[0];
}

/**
 * Cancel all non-terminal reminders matching `reminderTypes` on a given
 * assignment. Used to drop escalations after YES, drop everything after
 * CANCEL, drop the redundant T+0 / T+30 after HERE.
 */
async function cancelRemindersByType(args: {
  tenantId: string;
  assignmentId: string;
  reminderTypes: ReadonlyArray<ShiftReminderType>;
  reason: string;
}): Promise<number> {
  const { tenantId, assignmentId, reminderTypes, reason } = args;
  if (reminderTypes.length === 0) return 0;
  const subRef = db.collection(
    `tenants/${tenantId}/assignments/${assignmentId}/${REMINDER_SUBCOLLECTION}`,
  );
  const snap = await subRef.where('type', '==', REMINDER_KIND).get();
  if (snap.empty) return 0;

  const targets = new Set<string>(reminderTypes);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let cancelled = 0;
  for (const docSnap of snap.docs) {
    const reminderType = normalize(docSnap.get('reminderType'));
    if (!targets.has(reminderType as ShiftReminderType)) continue;
    const status = normalizeLower(docSnap.get('status'));
    if (status === 'sent' || status === 'failed' || status === 'cancelled') continue;
    batch.set(
      docSnap.ref,
      {
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelReason: reason,
        lastError: reason,
        claimedAt: admin.firestore.FieldValue.delete(),
        claimedBy: admin.firestore.FieldValue.delete(),
        claimExpiresAt: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
    cancelled += 1;
  }
  if (cancelled > 0) await batch.commit();
  return cancelled;
}

/**
 * Apply YES. Flips confirmation state to `confirmed`, nukes the 23h / 22h
 * escalations so they don't fire needlessly, but leaves the T-2h_instructions
 * / T-15m_clockin / T+0_checkin operational reminders intact — worker still
 * needs those even after confirming.
 */
async function applyConfirmation(active: ActiveCadence, context: {
  phoneE164: string;
  matchedToken: string | null;
  messageSid?: string;
}): Promise<void> {
  const { tenantId, assignmentId } = active;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
        confirmedVia: {
          channel: 'sms',
          matchedToken: context.matchedToken,
          twilioMessageSid: context.messageSid || null,
          phoneE164: context.phoneE164,
        },
      },
    },
    { merge: true },
  );

  const cancelled = await cancelRemindersByType({
    tenantId,
    assignmentId,
    reminderTypes: ESCALATION_REMINDER_TYPES,
    reason: 'cadence_confirmed_by_worker',
  });

  logger.info('[cadence_reply] confirmation applied', {
    tenantId,
    assignmentId,
    cancelledEscalations: cancelled,
    matchedToken: context.matchedToken,
  });
}

/**
 * Apply CANCEL / NO. Flips confirmation state to `cancelled` and drops every
 * remaining (non-terminal) reminder on this assignment so we stop texting the
 * worker about a shift they already declined.
 *
 * Intentionally does NOT mutate the assignment's own `status` field — we
 * want a recruiter to make that call, partly because a worker "cancelling"
 * here is really an assignment-decline intent and needs human triage to
 * decide whether to reassign or re-offer.
 */
async function applyCancellation(active: ActiveCadence, context: {
  phoneE164: string;
  matchedToken: string | null;
  messageSid?: string;
  messageBody: string;
}): Promise<void> {
  const { tenantId, assignmentId, assignment } = active;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelledVia: {
          channel: 'sms',
          matchedToken: context.matchedToken,
          twilioMessageSid: context.messageSid || null,
          phoneE164: context.phoneE164,
        },
      },
      needsRecruiterAttention: true,
    },
    { merge: true },
  );

  const cancelled = await cancelRemindersByType({
    tenantId,
    assignmentId,
    reminderTypes: ALL_SHIFT_REMINDER_TYPES,
    reason: 'cadence_cancelled_by_worker',
  });

  // Alert recruiters via dashboardFeed — best-effort, don't block caller.
  const jobTitle = normalize(assignment.jobTitle || assignment.jobOrderName || assignment.title) || 'Shift';
  await notifyRecruitersOnWorkerEvent({
    tenantId,
    assignmentId,
    assignment,
    event: {
      kind: 'cadence_worker_cancelled',
      title: `Worker cancelled ${jobTitle}`,
      snippet: `Inbound SMS "${context.matchedToken || '—'}": "${truncateSnippet(context.messageBody)}"`,
      dedupeKey: `cadence_worker_cancelled__${assignmentId}`,
      extra: {
        matchedToken: context.matchedToken,
        twilioMessageSid: context.messageSid || null,
        phoneE164: context.phoneE164,
      },
    },
  });

  logger.info('[cadence_reply] cancellation applied', {
    tenantId,
    assignmentId,
    cancelledReminders: cancelled,
    matchedToken: context.matchedToken,
  });
}

/**
 * Apply HERE / on-site check-in. Flips state to `checked_in`, cancels the
 * now-redundant T+0 / T+30 reminders. Leaves escalations alone (they'd
 * already have self-suppressed since state is no longer 'pending', but
 * belt-and-suspenders — check-in is a stronger signal than confirm).
 */
async function applyCheckIn(active: ActiveCadence, context: {
  phoneE164: string;
  matchedToken: string | null;
  messageSid?: string;
}): Promise<void> {
  const { tenantId, assignmentId } = active;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      cortConfirmation: {
        state: 'checked_in',
        checkedInAt: now,
        updatedAt: now,
        checkedInVia: {
          channel: 'sms',
          matchedToken: context.matchedToken,
          twilioMessageSid: context.messageSid || null,
          phoneE164: context.phoneE164,
        },
      },
    },
    { merge: true },
  );

  const cancelled = await cancelRemindersByType({
    tenantId,
    assignmentId,
    reminderTypes: [...ESCALATION_REMINDER_TYPES, ...CHECKIN_REDUNDANT_REMINDER_TYPES],
    reason: 'cadence_checked_in_by_worker',
  });

  logger.info('[cadence_reply] check-in applied', {
    tenantId,
    assignmentId,
    cancelledReminders: cancelled,
    matchedToken: context.matchedToken,
  });
}

/**
 * Apply a walk-off distress signal. Does NOT mutate `cortConfirmation.state`
 * (the worker may still be confirmed and actively on site — they just said
 * something concerning). Instead:
 *
 *   - Stamps `assignment.walkOffRisk` with timestamp + matched phrase so UI
 *     can badge the assignment
 *   - Fires a recruiter dashboardFeed alert so someone checks in
 *
 * The recruiter is the owner of the next action (call the worker, contact
 * the site, reassign). The worker receives the walk-off-warning SMS reply
 * separately (see `sendWalkOffTemplate`).
 */
async function applyWalkOffWarning(active: ActiveCadence, context: {
  phoneE164: string;
  matchedToken: string | null;
  messageSid?: string;
  messageBody: string;
}): Promise<void> {
  const { tenantId, assignmentId, assignment } = active;
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Stamp the risk flag. We keep the last 3 triggers in an array so repeat
  // distress signals over a shift build context for the recruiter.
  await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).set(
    {
      walkOffRisk: {
        isAtRisk: true,
        lastTriggeredAt: now,
        lastMatchedPhrase: context.matchedToken,
        lastMessageBody: truncateSnippet(context.messageBody, 500),
        lastTwilioMessageSid: context.messageSid || null,
        updatedAt: now,
      },
      needsRecruiterAttention: true,
    },
    { merge: true },
  );

  const jobTitle = normalize(assignment.jobTitle || assignment.jobOrderName || assignment.title) || 'Shift';
  await notifyRecruitersOnWorkerEvent({
    tenantId,
    assignmentId,
    assignment,
    event: {
      kind: 'cadence_walk_off_warning',
      title: `Possible walk-off — ${jobTitle}`,
      snippet: `"${truncateSnippet(context.messageBody)}" (matched: ${context.matchedToken || '—'})`,
      dedupeKey: `cadence_walk_off_warning__${assignmentId}__${Date.now()}`, // allow multiple alerts per assignment
      extra: {
        matchedPhrase: context.matchedToken,
        twilioMessageSid: context.messageSid || null,
        phoneE164: context.phoneE164,
      },
    },
  });

  logger.info('[cadence_reply] walk-off warning applied', {
    tenantId,
    assignmentId,
    matchedPhrase: context.matchedToken,
  });
}

function truncateSnippet(body: string, limit = 160): string {
  const s = normalize(body).replace(/\s+/g, ' ');
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1)}…`;
}

/**
 * SMS receipt back to the worker. Copy varies by intent; message-type id is
 * always on the cadence registry so logging + quiet-hours treat these as
 * operational.
 */
/**
 * Human label for the shift this receipt is about, e.g. "Aug 30, 6:00 PM".
 *
 * Built from the raw `startDate` / `startTime` strings rather than the
 * resolved Timestamp: assignments carry no `timezone` field, so any real
 * timezone conversion would relabel the shift (an 18:00 gig reading back as
 * 1:00 AM). These strings are what the worker was quoted in the ask, so
 * echoing them is both correct and consistent. Returns '' when unavailable —
 * callers must degrade to the unqualified copy rather than print a partial.
 */
export function shiftWhenLabel(assignment: Record<string, unknown>, es: boolean): string {
  const rawDate = normalize(assignment.startDate);
  const m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';

  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return '';
  const day = Number(m[3]);
  const datePart = es
    ? `${day} ${MONTHS_ES[monthIdx]}`
    : `${MONTHS_EN[monthIdx]} ${day}`;

  const rawTime = normalize(assignment.startTime);
  const t = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!t) return datePart;
  const hh24 = Number(t[1]);
  const mm = t[2];
  if (hh24 > 23 || Number(mm) > 59) return datePart;
  const suffix = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${datePart}, ${hh12}:${mm} ${suffix}`;
}

async function sendReceipt(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  assignmentId: string;
  intent: 'confirmation' | 'cancellation' | 'check_in' | 'walk_off_warning';
  assignment: Record<string, unknown>;
  lang?: 'en' | 'es';
  /**
   * True when the worker was ALREADY confirmed for this shift before this
   * reply (the T-4h re-confirm ask, or a worker replying YES twice). Sends a
   * distinct acknowledgement instead of repeating the first receipt verbatim.
   */
  alreadyConfirmed?: boolean;
}): Promise<void> {
  const { tenantId, userId, phoneE164, assignmentId, intent, assignment } = args;
  const es = args.lang === 'es';
  const brand = await getTenantSmsBrand(tenantId);

  const job = normalize(assignment.jobTitle || assignment.jobOrderName || assignment.title) ||
    (es ? 'tu turno' : 'your shift');

  // Name the specific shift. A worker holding two shifts the same day gets one
  // receipt per shift; without the date/time they read as the bot repeating
  // itself, which is exactly how three legitimate receipts landed as noise.
  const when = shiftWhenLabel(assignment, es);
  const jobWhen = when ? `${job} (${when})` : job;

  let body = '';
  let messageTypeId = '';

  if (intent === 'confirmation') {
    body = args.alreadyConfirmed
      ? (es
        ? `${brand}: Ya te teníamos confirmado para ${jobWhen} — todo listo, no necesitas hacer nada más.`
        : `${brand}: You were already confirmed for ${jobWhen} — you're all set, nothing else needed.`)
      : (es
        ? `${brand}: Gracias — estás confirmado para ${jobWhen}. Te enviaremos los detalles del lugar antes de empezar.`
        : `${brand}: Thanks — you're confirmed for ${jobWhen}. We'll send worksite details closer to start time.`);
    messageTypeId = 'assignment_confirmation_receipt';
  } else if (intent === 'cancellation') {
    body = es
      ? `${brand}: Entendido — cancelamos ${jobWhen} y avisamos a tu reclutador.`
      : `${brand}: Got it — we've cancelled ${jobWhen} and alerted your recruiter.`;
    messageTypeId = 'assignment_cancellation_receipt';
  } else if (intent === 'check_in') {
    body = es
      ? `${brand}: Listo — registramos tu llegada a ${job}. ¡Buen turno! Responde HELP si algo sale mal.`
      : `${brand}: Got it — you're checked in for ${job}. Have a great shift. Reply HELP if anything goes wrong.`;
    messageTypeId = 'assignment_checked_in_receipt';
  } else {
    // walk_off_warning — this is the "don't walk off, you're being paid" copy.
    // Copy is intentionally reassuring. If the tenant has a driver-meeting
    // variant this is where we'd branch on assignment / jobOrder metadata;
    // for now the default covers the CORT use case.
    body = es
      ? `${brand}: Gracias por avisar. Tu pago cuenta desde tu hora de inicio programada — ` +
        `por favor quédate en el lugar y espera al menos 30 minutos a tu supervisor. ` +
        `Ya avisamos a tu reclutador y te contactará pronto. Responde AQUÍ cuando lo veas, ` +
        `o HELP si necesitas ayuda.`
      : `${brand}: Thanks for reaching out. You're paid from your scheduled start time — ` +
        `please stay on site and wait at least 30 minutes for your supervisor or driver lead. ` +
        `We've alerted your recruiter, who will reach out shortly. Reply HERE when you see them, ` +
        `or reply HELP if you need support.`;
    messageTypeId = 'assignment_walk_off_warning';
  }

  try {
    await sendWorkerMessageInternal(phoneE164, body, {
      source: 'automation',
      sourceId: assignmentId,
      tenantId,
      messageTypeId,
      userId,
      systemContext: true,
    });
  } catch (err: any) {
    logger.warn('[cadence_reply] receipt send failed', {
      tenantId,
      assignmentId,
      intent,
      error: err?.message || String(err),
    });
  }
}

/**
 * Webhook entrypoint. Returns `{ handled: true }` if the inbound message was
 * claimed by the cadence flow. Otherwise the caller continues down the
 * normal STOP/HELP/START → thread pipeline.
 */
export async function handleCadenceReply(
  args: HandleCadenceReplyArgs,
): Promise<HandleCadenceReplyResult> {
  const { phoneE164, messageBody, twilioMessageSid } = args;

  const classification = classifyCadenceReply(messageBody);
  if (classification.intent === 'none') {
    return { handled: false, reason: 'intent_none' };
  }

  const user = await findUserByPhone(phoneE164);
  if (!user) {
    return { handled: false, reason: 'user_not_found' };
  }

  const allCadences = await loadWorkerCadenceAssignments(user.userId);
  if (allCadences.length === 0) {
    return { handled: false, reason: 'no_cadence_assignments' };
  }

  // Route to the right cadence depending on intent. YES matches a
  // future-start pending cadence first, falling back to an
  // around-the-shift pending cadence (a worker replying YES after start
  // still means "I'm coming" — before 2026-08-29 that reply fell through
  // to the compliance START handler and produced a bogus "you have been
  // opted in" text). CANCEL matches pending OR confirmed future shifts.
  // HERE / walk-off look for an active-or-very-recent cadence.
  let active: ActiveCadence | null = null;
  if (classification.intent === 'confirmation') {
    active = pickPendingCadence(allCadences);
    if (!active) {
      // Re-confirm: the T-4h second opt-in goes to already-confirmed
      // workers, so their YES must land here (idempotent) instead of
      // falling through to the compliance START handler.
      active = pickCancellableCadence(allCadences);
    }
    if (!active) {
      const nearShift = pickActiveOrRecentCadence(allCadences);
      if (nearShift && (nearShift.state === 'pending' || nearShift.state === 'confirmed')) {
        active = nearShift;
      }
    }
  } else if (classification.intent === 'cancellation') {
    active = pickCancellableCadence(allCadences);
  } else {
    active = pickActiveOrRecentCadence(allCadences);
  }
  if (!active) {
    return {
      handled: false,
      intent: classification.intent,
      reason: 'no_active_cadence_for_intent',
    };
  }

  const context = {
    phoneE164,
    matchedToken: classification.matchedToken,
    messageSid: twilioMessageSid,
    messageBody,
  };

  try {
    switch (classification.intent) {
      case 'confirmation': {
        // Captured BEFORE applyConfirmation flips the state.
        const wasAlreadyConfirmed = active.state === 'confirmed';
        await applyConfirmation(active, context);
        await sendReceipt({
          tenantId: active.tenantId,
          userId: user.userId,
          phoneE164,
          assignmentId: active.assignmentId,
          intent: 'confirmation',
          assignment: active.assignment,
          lang: user.lang,
          alreadyConfirmed: wasAlreadyConfirmed,
        });
        break;
      }
      case 'cancellation':
        await applyCancellation(active, context);
        await sendReceipt({
          tenantId: active.tenantId,
          userId: user.userId,
          phoneE164,
          assignmentId: active.assignmentId,
          intent: 'cancellation',
          assignment: active.assignment,
          lang: user.lang,
        });
        break;
      case 'check_in':
        await applyCheckIn(active, context);
        await sendReceipt({
          tenantId: active.tenantId,
          userId: user.userId,
          phoneE164,
          assignmentId: active.assignmentId,
          intent: 'check_in',
          assignment: active.assignment,
          lang: user.lang,
        });
        break;
      case 'walk_off_warning':
        await applyWalkOffWarning(active, context);
        await sendReceipt({
          tenantId: active.tenantId,
          userId: user.userId,
          phoneE164,
          assignmentId: active.assignmentId,
          intent: 'walk_off_warning',
          assignment: active.assignment,
          lang: user.lang,
        });
        break;
      default:
        // Exhaustiveness — new intents must be added to the switch.
        return { handled: false, reason: 'intent_unhandled' };
    }
  } catch (err: any) {
    logger.error('[cadence_reply] apply failed', {
      tenantId: active.tenantId,
      assignmentId: active.assignmentId,
      intent: classification.intent,
      error: err?.message || String(err),
    });
    return {
      handled: false,
      intent: classification.intent,
      tenantId: active.tenantId,
      assignmentId: active.assignmentId,
      reason: 'apply_failed',
    };
  }

  return {
    handled: true,
    intent: classification.intent,
    tenantId: active.tenantId,
    assignmentId: active.assignmentId,
  };
}
