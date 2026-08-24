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
import { getClaudeChat } from '../utils/claudeChat';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';

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

async function gatherWorkerPayrollContext(tenantId: string, uid: string): Promise<string> {
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
      .sort((a, b) => trim(b.date).localeCompare(trim(a.date)))
      .slice(0, 8)
      .map(
        (x) =>
          `- ${trim(x.date)}: status=${trim(x.status)}, reg=${Number(x.totalRegularHours ?? 0)}h, ot=${Number(x.totalOTHours ?? 0)}h`,
      );
    parts.push(rows.length ? `Recent timesheet entries:\n${rows.join('\n')}` : 'Recent timesheet entries: none');
  } catch (e) {
    parts.push(`Recent timesheet entries: lookup failed (${String(e)})`);
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
}): Promise<{ ticketId: string; diagnosis: Omit<PayrollTicketDiagnosis, 'generatedAt'> | null }> {
  const userSnap = await db.collection('users').doc(input.uid).get();
  const u = (userSnap.data() ?? {}) as Record<string, unknown>;
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
    await ref.update({
      diagnosis: { ...diagnosis, generatedAt: admin.firestore.FieldValue.serverTimestamp() },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
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
  if (!snap.exists) throw new Error('Ticket not found.');
  const t = snap.data() as Record<string, unknown>;
  const staff = await isStaff(input.actorUid);
  const isOwner = t.uid === input.actorUid;
  if (!staff && !isOwner) throw new Error('Not allowed.');

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
  await ref.update({
    status: (by === 'staff' ? 'waiting_worker' : 'open') satisfies PayrollTicketStatus,
    lastMessageAt: now,
    lastMessageBy: by,
    updatedAt: now,
  });

  if (by === 'staff') {
    try {
      await sendNotificationAndPush({
        uid: String(t.uid),
        tenantId: String(t.tenantId),
        title: 'Payroll support replied',
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
  if (!(await isStaff(input.actorUid))) throw new Error('Not allowed.');
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
