/**
 * Payroll help desk — Slice 1 (Greg approved 2026-08-24).
 *
 * One queue (`payroll_tickets` + `messages` subcollection) fed by the worker
 * app (SMS/email intakes come later and call these same helpers). Every write
 * goes through the `workerSupportAssistant` callable (Cloud Run cap — NO new
 * functions); Firestore rules make the collection read-only from clients.
 *
 * On creation the ticket gets an AI diagnosis: Claude reads the worker's
 * Everee linkages (readinessMirror), recent timesheet entries, and
 * assignments, then writes { category, severity, summary, suggested
 * EN/ES replies } for the staff console. PII discipline: no SSN/last-4, no
 * bank numbers in the prompt — only booleans/counts from the mirror.
 *
 * Slice 2 (approved actions: resend onboarding link, re-run reconcile, …)
 * builds on this doc shape — keep `diagnosis` additive, never breaking.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import twilio from 'twilio';
import { getClaudeChat } from '../utils/claudeChat';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
} from '../messaging/twilioSecrets';
import { reconcileWorkerInternal } from '../integrations/everee/evereeReconcileWorker';
import { getPayHistory } from '../integrations/everee/evereeService';

/** Typed errors so the callable can map to proper HttpsError codes. */
export class TicketNotFoundError extends Error {}
export class TicketForbiddenError extends Error {}
export class TicketRateLimitedError extends Error {}

/** Max open/waiting tickets per worker — each creation runs a Claude call. */
const MAX_ACTIVE_TICKETS_PER_WORKER = 3;

const db = admin.firestore();

export type PayrollTicketStatus = 'open' | 'waiting_worker' | 'resolved';

export interface PayrollTicketDiagnosis {
  category: string;
  severity: 'low' | 'normal' | 'urgent';
  summary: string;
  suggestedReplyEn: string;
  suggestedReplyEs: string;
  confidence: number;
  generatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

const CATEGORIES = [
  'missing_pay',
  'wrong_amount',
  'onboarding_stuck',
  'direct_deposit',
  'tax_docs',
  'other',
] as const;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

/** Pure: does this user doc belong to the tenant? (tested in mocha) */
export function isTenantMemberData(u: Record<string, unknown>, tenantId: string): boolean {
  if (!tenantId) return false;
  if (String(u.activeTenantId ?? '') === tenantId) return true;
  if (String(u.tenantId ?? '') === tenantId) return true;
  const tenantIds = (u.tenantIds ?? null) as Record<string, unknown> | null;
  if (tenantIds && typeof tenantIds === 'object' && tenantId in tenantIds) return true;
  return false;
}

async function isStaff(uid: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  const u = snap.data() as Record<string, unknown>;
  if (u.role === 'HRX') return true;
  const top = parseInt(String(u.securityLevel ?? '0'), 10);
  if (Number.isFinite(top) && top >= 5) return true;
  const tenantIds = (u.tenantIds ?? null) as Record<string, { securityLevel?: unknown }> | null;
  if (tenantIds && typeof tenantIds === 'object') {
    for (const entry of Object.values(tenantIds)) {
      const lvl = parseInt(String(entry?.securityLevel ?? '0'), 10);
      if (Number.isFinite(lvl) && lvl >= 5) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Diagnosis context — Firestore only (no Everee API calls in Slice 1).
// ---------------------------------------------------------------------------

function timesheetDate(x: Record<string, unknown>): string {
  return trim(x.workDate) || trim(x.date);
}

/** Pure: one prompt line per timesheet entry (tested in mocha). */
export function formatTimesheetLine(x: Record<string, unknown>): string {
  const dt = Number(x.totalDoubleTimeHours ?? 0);
  return (
    `- ${timesheetDate(x) || 'undated'}: status=${trim(x.status)}, ` +
    `reg=${Number(x.totalRegularHours ?? 0)}h, ot=${Number(x.totalOTHours ?? 0)}h` +
    (dt ? `, dt=${dt}h` : '')
  );
}

export async function gatherWorkerPayrollContext(tenantId: string, uid: string): Promise<string> {
  const parts: string[] = [];

  const userSnap = await db.collection('users').doc(uid).get();
  const u = (userSnap.data() ?? {}) as Record<string, unknown>;
  parts.push(
    `Worker: ${trim(u.firstName)} ${trim(u.lastName)} · preferred language: ${trim(u.preferredLanguage) || 'en'}`,
  );

  try {
    const ew = await db
      .collection(`tenants/${tenantId}/everee_workers`)
      .where('firebaseUid', '==', uid)
      .get();
    const lines: string[] = [];
    for (const d of ew.docs) {
      const x = d.data() as Record<string, unknown>;
      if (x.smokeData === true || String(x.evereeTenantId ?? '') === '2320') continue; // sandbox
      const m = (x.readinessMirror ?? {}) as Record<string, unknown>;
      const entity = d.id.split('__')[0];
      lines.push(
        `- ${entity}: linkStatus=${trim(x.status)}, onboarding=${trim(m.onboardingStatus) || 'unknown'}, ` +
          `lifecycle=${trim(m.lifecycleStatus) || 'unknown'}, directDepositReady=${m.directDepositReady === true}, ` +
          `bankAccounts=${Number(m.bankAccountCount ?? 0)}, paymentTypes=${JSON.stringify(m.supportedPaymentTypes ?? [])}, ` +
          `w4Signed=${Boolean(m.w4SignedAt)}, w9Signed=${Boolean(m.w9SignedAt)}, i9Signed=${Boolean(m.i9SignedAt)}, ` +
          `lastEvereeSync=${(m.lastEvereeSyncAt as admin.firestore.Timestamp | undefined)?.toDate?.()?.toISOString?.() ?? 'never'}`,
      );
    }
    parts.push(lines.length ? `Everee payroll linkages:\n${lines.join('\n')}` : 'Everee payroll linkages: NONE (worker not provisioned)');
  } catch (e) {
    parts.push(`Everee payroll linkages: lookup failed (${String(e)})`);
  }

  try {
    const ts = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workerId', '==', uid)
      .limit(15)
      .get();
    const rows = ts.docs
      .map((d) => d.data() as Record<string, unknown>)
      // Field is `workDate` (audit 2026-08-24 — `date` doesn't exist on
      // timesheet_entries and made every entry read as undated).
      .sort((a, b) => timesheetDate(b).localeCompare(timesheetDate(a)))
      .slice(0, 8)
      .map(formatTimesheetLine);
    parts.push(rows.length ? `Recent timesheet entries:\n${rows.join('\n')}` : 'Recent timesheet entries: none');
  } catch (e) {
    parts.push(`Recent timesheet entries: lookup failed (${String(e)})`);
  }

  // Actual payment truth from Everee (Earnings v1 companion, 2026-08-24):
  // settled pay runs per entity, so the diagnosis can say "you WERE paid
  // $X on <date>" / "no payment exists for that period" instead of
  // inferring from the mirror. Tolerated on failure — the rest of the
  // context still stands.
  try {
    const linkages = await loadProdLinkages(tenantId, uid);
    const lines: string[] = [];
    await Promise.all(
      linkages.map(async (l) => {
        if (!l.entityId) return;
        try {
          const hist = await getPayHistory(tenantId, l.entityId, uid);
          for (const it of (hist.items ?? []).slice(0, 5)) {
            lines.push(
              `- [${l.entityId}] payDate=${it.payDate ?? 'pending'}: $${it.gross ?? '?'} (${it.status ?? 'unknown'})` +
                (it.periodStart || it.periodEnd ? ` period ${it.periodStart ?? '?'}..${it.periodEnd ?? '?'}` : ''),
            );
          }
        } catch (e) {
          lines.push(`- [${l.entityId}] payment lookup failed (${String(e).slice(0, 80)})`);
        }
      }),
    );
    lines.sort((a, b) => b.localeCompare(a));
    parts.push(
      lines.length
        ? ['Recent Everee payments (settled truth):', ...lines].join('\n')
        : 'Recent Everee payments: NONE on record for any entity',
    );
  } catch (e) {
    parts.push(`Recent Everee payments: lookup failed (${String(e)})`);
  }

  try {
    const asg = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('userId', '==', uid)
      .limit(10)
      .get();
    const rows = asg.docs
      .map((d) => d.data() as Record<string, unknown>)
      .sort((a, b) => trim(b.startDate).localeCompare(trim(a.startDate)))
      .slice(0, 5)
      .map((x) => `- ${trim(x.startDate)}: ${trim(x.jobTitle) || 'assignment'} @ ${trim(x.worksiteName) || trim(x.location)} (${trim(x.status)})`);
    parts.push(rows.length ? `Recent assignments:\n${rows.join('\n')}` : 'Recent assignments: none');
  } catch (e) {
    parts.push(`Recent assignments: lookup failed (${String(e)})`);
  }

  return parts.join('\n\n');
}

export async function runPayrollTicketDiagnosis(input: {
  tenantId: string;
  uid: string;
  ticketText: string;
}): Promise<Omit<PayrollTicketDiagnosis, 'generatedAt'> | null> {
  const context = await gatherWorkerPayrollContext(input.tenantId, input.uid);

  const systemPrompt = [
    'You are the payroll help-desk triage assistant for C1 Staffing (staffing agency; payroll runs on Everee).',
    'Given a worker\'s payroll question and their actual payroll/timesheet state, diagnose the most likely issue for the STAFF member who will handle the ticket, and draft a reply to the worker.',
    'Rules:',
    '- The summary is for staff: name the likely root cause and point at the evidence (e.g. "onboarding stopped before direct deposit; 2 timesheets still in draft").',
    '- The suggested replies are for the worker: warm, plain-language, 2-4 sentences, no jargon, no promises of specific amounts or dates you cannot verify.',
    '- NEVER invent pay amounts, dates, or policy. If the state does not explain the complaint, say what staff should check.',
    "- 'Recent Everee payments' is the settled truth. If NO payment exists for the period the worker is asking about, the root cause is that no payment was ever issued (hours not submitted/processed) — say that plainly. Never speculate about returned or misdirected deposits for payments that do not exist. Conversely, if a payment DOES exist, cite its date, amount, and status.",
    `- category must be one of: ${CATEGORIES.join(', ')}.`,
    '- severity: urgent = worker says they were not paid or money is wrong; normal = setup/onboarding friction; low = general question.',
    'Return strict JSON only: {"category":string,"severity":"low"|"normal"|"urgent","summary":string,"suggestedReplyEn":string,"suggestedReplyEs":string,"confidence":number}',
  ].join('\n');

  const userPrompt = [
    `Worker's message: "${input.ticketText}"`,
    'Worker payroll state (from our systems, may be incomplete):',
    context,
  ].join('\n\n');

  try {
    const claude = getClaudeChat();
    const completion = await claude.chat.completions.create({
      model: 'claude-opus-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 900,
    });
    const text = trim(completion.choices?.[0]?.message?.content);
    if (!text) return null;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const category = CATEGORIES.includes(trim(parsed.category) as (typeof CATEGORIES)[number])
      ? trim(parsed.category)
      : 'other';
    const severity = ['low', 'normal', 'urgent'].includes(trim(parsed.severity))
      ? (trim(parsed.severity) as 'low' | 'normal' | 'urgent')
      : 'normal';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
    return {
      category,
      severity,
      summary: trim(parsed.summary),
      suggestedReplyEn: trim(parsed.suggestedReplyEn),
      suggestedReplyEs: trim(parsed.suggestedReplyEs),
      confidence,
    };
  } catch (e) {
    logger.warn('payrollTickets: diagnosis failed', { uid: input.uid, error: String(e) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ticket operations (all invoked from the workerSupportAssistant callable).
// ---------------------------------------------------------------------------

export async function createPayrollTicket(input: {
  uid: string;
  tenantId: string;
  text: string;
  channel?: 'app' | 'sms' | 'email';
}): Promise<{ ticketId: string; diagnosis: { category: string; severity: string } | null }> {
  const userSnap = await db.collection('users').doc(input.uid).get();
  const u = (userSnap.data() ?? {}) as Record<string, unknown>;
  // The caller chooses tenantId — verify they actually belong to it
  // (audit 2026-08-24: previously unvalidated).
  if (!isTenantMemberData(u, input.tenantId)) {
    throw new TicketForbiddenError('You are not a member of this workspace.');
  }
  // Rate limit: each creation runs a Claude call; cap active tickets.
  const active = await db
    .collection('payroll_tickets')
    .where('uid', '==', input.uid)
    .where('status', 'in', ['open', 'waiting_worker'])
    .limit(MAX_ACTIVE_TICKETS_PER_WORKER)
    .get();
  if (active.size >= MAX_ACTIVE_TICKETS_PER_WORKER) {
    throw new TicketRateLimitedError(
      'You already have open payroll requests — please reply on one of those instead of opening a new one.',
    );
  }
  const workerName = `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(u.displayName) || input.uid;

  const ref = db.collection('payroll_tickets').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({
    uid: input.uid,
    tenantId: input.tenantId,
    status: 'open' satisfies PayrollTicketStatus,
    channel: input.channel ?? 'app',
    subject: input.text.slice(0, 120),
    workerName,
    workerEmail: trim(u.email) || null,
    workerPhone: trim(u.phone) || null,
    preferredLanguage: trim(u.preferredLanguage) || 'en',
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessageBy: 'worker',
  });
  await ref.collection('messages').add({
    at: now,
    by: 'worker',
    authorUid: input.uid,
    text: input.text,
    createdAt: now,
  });

  const diagnosis = await runPayrollTicketDiagnosis({
    tenantId: input.tenantId,
    uid: input.uid,
    ticketText: input.text,
  });
  if (diagnosis) {
    // Category/severity/confidence live on the ticket (queue chips; fine for
    // the worker to see about their own issue). The staff-facing summary and
    // unsent draft replies go in a staff-only subcollection — the worker can
    // read their ticket doc, and internal triage notes must not ride along
    // (audit 2026-08-24).
    await ref.update({
      diagnosis: {
        category: diagnosis.category,
        severity: diagnosis.severity,
        confidence: diagnosis.confidence,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.collection('private').doc('diagnosis').set({
      ...diagnosis,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (diagnosis.severity === 'urgent') {
      await sendUrgentTicketAlert({
        ticketId: ref.id,
        workerName,
        subject: input.text.slice(0, 100),
        category: diagnosis.category,
      });
    }
    // AI first reply (Greg approved 2026-08-24): when confidence clears the
    // bar, the drafted reply goes to the worker immediately — clearly
    // labeled as the assistant — and staff follow up. The ticket STAYS
    // 'open' (lastMessageBy 'ai') so the queue still shows it needs a
    // human. Kill switch + threshold in app_config/payroll_help_desk.
    try {
      const cfg = await db.doc('app_config/payroll_help_desk').get();
      const enabled = cfg.get('aiFirstReplyEnabled') !== false;
      const minConfidence = Number(cfg.get('aiFirstReplyMinConfidence') ?? 0.7);
      const es = (trim(u.preferredLanguage) || 'en') === 'es';
      const replyText = es ? diagnosis.suggestedReplyEs : diagnosis.suggestedReplyEn;
      if (enabled && replyText && diagnosis.confidence >= minConfidence) {
        const aiNow = admin.firestore.FieldValue.serverTimestamp();
        await ref.collection('messages').add({
          at: aiNow,
          by: 'ai',
          authorName: es ? 'Asistente C1 (IA)' : 'C1 Assistant (AI)',
          text: replyText,
          createdAt: aiNow,
        });
        await ref.update({ lastMessageAt: aiNow, lastMessageBy: 'ai', updatedAt: aiNow });
        await ref.collection('private').doc('audit').set(
          {
            entries: admin.firestore.FieldValue.arrayUnion({
              at: admin.firestore.Timestamp.now(),
              action: 'ai_first_reply',
              byUid: 'ai',
              byName: 'C1 Assistant',
              confidence: diagnosis.confidence,
            }),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        logger.info('payrollTickets: ai first reply sent', {
          ticketId: ref.id,
          confidence: diagnosis.confidence,
        });
      }
    } catch (e) {
      logger.warn('payrollTickets: ai first reply failed', { ticketId: ref.id, error: String(e) });
    }
  }

  logger.info('payrollTickets: created', {
    ticketId: ref.id,
    uid: input.uid,
    tenantId: input.tenantId,
    channel: input.channel ?? 'app',
    category: diagnosis?.category ?? null,
    severity: diagnosis?.severity ?? null,
  });
  return { ticketId: ref.id, diagnosis };
}

export async function replyPayrollTicket(input: {
  actorUid: string;
  ticketId: string;
  text: string;
}): Promise<{ ok: true }> {
  const ref = db.collection('payroll_tickets').doc(input.ticketId);
  const snap = await ref.get();
  if (!snap.exists) throw new TicketNotFoundError('Ticket not found.');
  const t = snap.data() as Record<string, unknown>;
  const staff = await isStaff(input.actorUid);
  const isOwner = t.uid === input.actorUid;
  if (!staff && !isOwner) throw new TicketForbiddenError('Not allowed.');

  const by = staff && !isOwner ? 'staff' : 'worker';
  const now = admin.firestore.FieldValue.serverTimestamp();
  const actorSnap = await db.collection('users').doc(input.actorUid).get();
  const a = (actorSnap.data() ?? {}) as Record<string, unknown>;
  await ref.collection('messages').add({
    at: now,
    by,
    authorUid: input.actorUid,
    authorName: `${trim(a.firstName)} ${trim(a.lastName)}`.trim() || null,
    text: input.text,
    createdAt: now,
  });
  // Status machine: worker reply always (re)opens; a staff reply moves an
  // active ticket to waiting_worker but does NOT silently reopen a resolved
  // one (follow-up info on a closed ticket stays closed — audit 2026-08-24).
  const currentStatus = String(t.status || 'open') as PayrollTicketStatus;
  const nextStatus: PayrollTicketStatus =
    by === 'worker' ? 'open' : currentStatus === 'resolved' ? 'resolved' : 'waiting_worker';
  await ref.update({
    status: nextStatus,
    lastMessageAt: now,
    lastMessageBy: by,
    updatedAt: now,
  });

  if (by === 'staff') {
    try {
      // Notification in the worker's language (audit 2026-08-24 — was EN-only).
      const es = trim(t.preferredLanguage) === 'es';
      await sendNotificationAndPush({
        uid: String(t.uid),
        tenantId: String(t.tenantId),
        title: es ? 'El equipo de nómina respondió' : 'Payroll support replied',
        body: input.text.slice(0, 140),
        type: 'support',
        category: 'system',
        deepLink: `/c1/workers/payroll-help/${input.ticketId}`,
        source: 'automation',
      });
    } catch (e) {
      logger.warn('payrollTickets: notify failed', { ticketId: input.ticketId, error: String(e) });
    }
  }
  return { ok: true };
}

export async function setPayrollTicketStatus(input: {
  actorUid: string;
  ticketId: string;
  status: PayrollTicketStatus;
}): Promise<{ ok: true }> {
  if (!(await isStaff(input.actorUid))) throw new TicketForbiddenError('Not allowed.');
  if (!['open', 'waiting_worker', 'resolved'].includes(input.status)) throw new Error('Bad status.');
  await db.collection('payroll_tickets').doc(input.ticketId).update({
    status: input.status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(input.status === 'resolved'
      ? { resolvedAt: admin.firestore.FieldValue.serverTimestamp(), resolvedBy: input.actorUid }
      : {}),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Urgent-ticket alerting — SMS to the numbers in
// `app_config/payroll_help_desk.urgentAlertPhones` (audit 2026-08-24:
// urgent "I wasn't paid" tickets must not wait for the morning brief).
// Never throws: alerting failure must not fail ticket creation.
// ---------------------------------------------------------------------------

async function sendUrgentTicketAlert(input: {
  ticketId: string;
  workerName: string;
  subject: string;
  category: string;
}): Promise<void> {
  try {
    const cfg = await db.doc('app_config/payroll_help_desk').get();
    const phones = ((cfg.get('urgentAlertPhones') as unknown) ?? []) as unknown[];
    const targets = phones.map((v) => trim(v)).filter((v) => /^\+?1?\d{10,}$/.test(v));
    if (!targets.length) return;
    const from = TWILIO_MESSAGING_PHONE_NUMBER.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
    if (!from) return;
    const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
    const body =
      `URGENT payroll ticket (${input.category}) from ${input.workerName}: ` +
      `"${input.subject}" — review at hrxone.com/payroll-tickets`;
    await Promise.all(
      targets.map((to) =>
        client.messages.create({ to: to.startsWith('+') ? to : `+1${to}`, from, body }),
      ),
    );
    logger.info('payrollTickets: urgent alert sent', { ticketId: input.ticketId, count: targets.length });
  } catch (e) {
    logger.warn('payrollTickets: urgent alert failed', { ticketId: input.ticketId, error: String(e) });
  }
}

// ---------------------------------------------------------------------------
// Slice 2 — one-click staff-approved actions (Greg approved 2026-08-24).
// Safe, non-money-moving only: send the worker their payroll link, or
// refresh the Everee mirror and re-run the diagnosis. Every action writes an
// audit entry to private/audit (staff-only) and, when worker-visible, a
// system message into the thread in the worker's language. Money-moving
// actions (payments, backpay, rate fixes) are deliberately NOT here.
// ---------------------------------------------------------------------------

interface TicketActionContext {
  ref: FirebaseFirestore.DocumentReference;
  ticket: Record<string, unknown>;
  actorUid: string;
  actorName: string;
}

async function loadTicketForStaffAction(actorUid: string, ticketId: string): Promise<TicketActionContext> {
  if (!(await isStaff(actorUid))) throw new TicketForbiddenError('Not allowed.');
  const ref = db.collection('payroll_tickets').doc(ticketId);
  const snap = await ref.get();
  if (!snap.exists) throw new TicketNotFoundError('Ticket not found.');
  const actorSnap = await db.collection('users').doc(actorUid).get();
  const a = (actorSnap.data() ?? {}) as Record<string, unknown>;
  const actorName = `${trim(a.firstName)} ${trim(a.lastName)}`.trim() || actorUid;
  return { ref, ticket: snap.data() as Record<string, unknown>, actorUid, actorName };
}

async function appendAudit(
  ctx: TicketActionContext,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await ctx.ref.collection('private').doc('audit').set(
    {
      entries: admin.firestore.FieldValue.arrayUnion({
        at: admin.firestore.Timestamp.now(),
        action,
        byUid: ctx.actorUid,
        byName: ctx.actorName,
        ...detail,
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

async function appendSystemThreadMessage(ctx: TicketActionContext, text: string): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ctx.ref.collection('messages').add({ at: now, by: 'system', text, createdAt: now });
  await ctx.ref.update({ updatedAt: now });
}

/** Prod (non-sandbox) Everee linkages for the ticket's worker. */
async function loadProdLinkages(
  tenantId: string,
  uid: string,
): Promise<Array<{ entityId: string; evereeTenantId: string; evereeWorkerId: string; complete: boolean }>> {
  const snap = await db
    .collection(`tenants/${tenantId}/everee_workers`)
    .where('firebaseUid', '==', uid)
    .get();
  const out: Array<{ entityId: string; evereeTenantId: string; evereeWorkerId: string; complete: boolean }> = [];
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (x.smokeData === true || String(x.evereeTenantId ?? '') === '2320') continue;
    const m = (x.readinessMirror ?? {}) as Record<string, unknown>;
    out.push({
      entityId: trim(x.entityId) || d.id.split('__')[0],
      evereeTenantId: trim(x.evereeTenantId),
      evereeWorkerId: trim(x.evereeWorkerId),
      complete:
        String(x.status || '').toLowerCase() === 'onboarding_complete' ||
        m.onboardingComplete === true ||
        String(m.onboardingStatus || '').toUpperCase() === 'COMPLETE',
    });
  }
  return out;
}

function workerSms(to: string, body: string): Promise<unknown> {
  const from = TWILIO_MESSAGING_PHONE_NUMBER.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
  if (!from) throw new Error('No messaging number configured.');
  const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
  const normalized = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
  return client.messages.create({ to: normalized, from, body });
}

/**
 * Send the worker their payroll link (SMS + in-app), for finishing
 * onboarding or updating bank info. Both land on our in-app Everee embed —
 * /c1/workers/earnings/{evereeTenantId} serves onboarding OR the worker
 * portal depending on their state.
 */
export async function sendPayrollLinkAction(input: {
  actorUid: string;
  ticketId: string;
  kind: 'onboarding' | 'bank_update';
}): Promise<{ ok: true; sentSms: boolean; entityId: string }> {
  const ctx = await loadTicketForStaffAction(input.actorUid, input.ticketId);
  const uid = String(ctx.ticket.uid);
  const tenantId = String(ctx.ticket.tenantId);
  const es = trim(ctx.ticket.preferredLanguage) === 'es';

  const linkages = await loadProdLinkages(tenantId, uid);
  if (!linkages.length) throw new Error('Worker has no production payroll linkage.');
  const target =
    input.kind === 'onboarding'
      ? linkages.find((l) => !l.complete) ?? linkages[0]
      : linkages.find((l) => l.complete) ?? linkages[0];
  const path = `/c1/workers/earnings/${encodeURIComponent(target.evereeTenantId)}`;
  const url = `https://hrxone.com${path}`;

  const smsBody =
    input.kind === 'onboarding'
      ? es
        ? `C1 Staffing: termina tu configuración de nómina aquí: ${url}`
        : `C1 Staffing: finish your payroll setup here: ${url}`
      : es
        ? `C1 Staffing: actualiza tu cuenta bancaria para depósito directo aquí: ${url}`
        : `C1 Staffing: update your bank account for direct deposit here: ${url}`;

  let sentSms = false;
  const phone = trim(ctx.ticket.workerPhone);
  if (phone) {
    try {
      await workerSms(phone, smsBody);
      sentSms = true;
    } catch (e) {
      logger.warn('payrollTickets: action SMS failed', { ticketId: input.ticketId, error: String(e) });
    }
  }
  try {
    await sendNotificationAndPush({
      uid,
      tenantId,
      title: es ? 'Tu enlace de nómina' : 'Your payroll link',
      body:
        input.kind === 'onboarding'
          ? es
            ? 'Toca para terminar tu configuración de nómina.'
            : 'Tap to finish your payroll setup.'
          : es
            ? 'Toca para actualizar tu cuenta bancaria.'
            : 'Tap to update your bank account.',
      type: 'support',
      category: 'system',
      deepLink: path,
      source: 'automation',
    });
  } catch (e) {
    logger.warn('payrollTickets: action notification failed', { ticketId: input.ticketId, error: String(e) });
  }

  await appendSystemThreadMessage(
    ctx,
    input.kind === 'onboarding'
      ? es
        ? 'Te enviamos un enlace por mensaje de texto para terminar tu configuración de nómina.'
        : 'We sent you a text with a link to finish your payroll setup.'
      : es
        ? 'Te enviamos un enlace por mensaje de texto para actualizar tu cuenta bancaria.'
        : 'We sent you a text with a link to update your bank account.',
  );
  await appendAudit(ctx, `send_link_${input.kind}`, { entityId: target.entityId, sentSms });
  logger.info('payrollTickets: link action', {
    ticketId: input.ticketId,
    kind: input.kind,
    entityId: target.entityId,
    sentSms,
  });
  return { ok: true, sentSms, entityId: target.entityId };
}

/**
 * Refresh the worker's Everee mirror (all prod linkages) and re-run the
 * diagnosis on fresh data. The console's diagnosis panel updates live.
 */
export async function refreshEvereeAction(input: {
  actorUid: string;
  ticketId: string;
}): Promise<{ ok: true; refreshed: number; category: string | null; severity: string | null }> {
  const ctx = await loadTicketForStaffAction(input.actorUid, input.ticketId);
  const uid = String(ctx.ticket.uid);
  const tenantId = String(ctx.ticket.tenantId);

  const linkages = await loadProdLinkages(tenantId, uid);
  let refreshed = 0;
  for (const l of linkages) {
    if (!l.entityId || !l.evereeWorkerId) continue;
    try {
      const res = await reconcileWorkerInternal({
        tenantId,
        entityId: l.entityId,
        userId: uid,
        evereeWorkerId: l.evereeWorkerId,
        syncSource: 'manual',
      });
      if (res.ok) refreshed += 1;
    } catch (e) {
      logger.warn('payrollTickets: reconcile failed', { ticketId: input.ticketId, entityId: l.entityId, error: String(e) });
    }
  }

  // Re-diagnose against the refreshed mirror using the worker's first message.
  const firstMsg = await ctx.ref.collection('messages').orderBy('createdAt', 'asc').limit(1).get();
  const ticketText = trim(firstMsg.docs[0]?.get('text')) || trim(ctx.ticket.subject);
  const diagnosis = await runPayrollTicketDiagnosis({ tenantId, uid, ticketText });
  if (diagnosis) {
    await ctx.ref.update({
      diagnosis: {
        category: diagnosis.category,
        severity: diagnosis.severity,
        confidence: diagnosis.confidence,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ctx.ref.collection('private').doc('diagnosis').set(
      {
        ...diagnosis,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        refreshedBy: ctx.actorUid,
      },
      { merge: true },
    );
  }
  await appendAudit(ctx, 'refresh_everee', {
    refreshed,
    newCategory: diagnosis?.category ?? null,
    newSeverity: diagnosis?.severity ?? null,
  });
  logger.info('payrollTickets: refresh action', { ticketId: input.ticketId, refreshed });
  return {
    ok: true,
    refreshed,
    category: diagnosis?.category ?? null,
    severity: diagnosis?.severity ?? null,
  };
}

