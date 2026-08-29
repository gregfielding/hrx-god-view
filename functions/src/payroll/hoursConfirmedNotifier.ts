/**
 * Post-shift earnings confirmation (2026-08-29, Greg: activate
 * "Saturday at Oakland Arena: $126.40 — arrives Friday" with the honest
 * caveat that client timesheets land days after the shift, so the text
 * goes out when the HOURS ARE CONFIRMED, not when the shift ends).
 *
 * Sweep (scheduledOrchestrator subtask, self-gated to every 6h): find
 * timesheet entries newly sent to Everee since the last run, group per
 * worker, and send ONE bilingual SMS summarizing the confirmed hours,
 * the estimated gross, and the Friday it's scheduled to arrive. This is
 * the loop-closer that converts payroll from a black box into a receipt —
 * and preempts the "was I paid right?" ticket class.
 *
 * Guardrails: one text per worker per sweep + registered 1/day type cap;
 * migration/suppressed users skipped; per-run send cap; estimates labeled
 * as estimates (the authoritative number is the Everee statement).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { claimTypeDailySlot } from '../messaging/rateLimiter';
import { userIsInActiveMigration } from '../messaging/migrationSuppress';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const MIN_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_SENDS_PER_RUN = 300;

interface SweepResult {
  success: boolean;
  durationMs: number;
  itemsProcessed?: number;
  errors?: number;
  message?: string;
}

/** Friday on/after the given date's pay-week end (Select Sun-Sat, Events Mon-Sun). */
function paydayForWorkDate(workDate: string, entityId: string): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  // Days until the pay week ends (Sat=6 for Select; Sun=0 for Events).
  const weekEndDow = entityId === 'c1_events_llc' ? 0 : 6;
  const toWeekEnd = (weekEndDow - dow + 7) % 7;
  dt.setDate(dt.getDate() + toWeekEnd);
  // Next Friday strictly AFTER the week ends.
  const toFriday = ((5 - dt.getDay() + 7) % 7) || 7;
  dt.setDate(dt.getDate() + toFriday);
  return dt;
}

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export async function runHoursConfirmedNotifier(): Promise<SweepResult> {
  const start = Date.now();
  const gateRef = db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/_hours_notifier_meta`);
  const gateSnap = await gateRef.get().catch(() => null);
  const lastRunAtMs = Number(gateSnap?.get('lastRunAtMs') ?? 0);
  if (Date.now() - lastRunAtMs < MIN_RUN_INTERVAL_MS) {
    return { success: true, durationMs: Date.now() - start, message: 'gated (ran recently)' };
  }
  // First-ever run: look back 24h, not to the beginning of time.
  const scanFromMs = lastRunAtMs || Date.now() - 24 * 60 * 60 * 1000;
  await gateRef.set({ lastRunAtMs: Date.now() }, { merge: true });

  const snap = await db
    .collection(`tenants/${TENANT_ID}/timesheet_entries`)
    .where('sentToEvereeAt', '>=', admin.firestore.Timestamp.fromMillis(scanFromMs))
    .get();

  interface Line {
    workDate: string;
    hours: number;
    gross: number;
    entityId: string;
    label: string;
  }
  const byWorker = new Map<string, Line[]>();
  snap.forEach((doc) => {
    const e = doc.data() as Record<string, any>;
    const uid = String(e.workerId ?? '').trim();
    if (!uid) return;
    const reg = Number(e.totalRegularHours ?? e.regularHours ?? 0) || 0;
    const ot = Number(e.totalOTHours ?? 0) || 0;
    const dt = Number(e.totalDoubleTimeHours ?? 0) || 0;
    const hours = reg + ot + dt;
    if (hours <= 0) return;
    const rate = Number(e.payRate ?? e.rate ?? 0) || 0;
    const gross = reg * rate + ot * rate * 1.5 + dt * rate * 2;
    const lines = byWorker.get(uid) ?? [];
    lines.push({
      workDate: String(e.workDate ?? ''),
      hours,
      gross,
      entityId: String(e.entityId ?? e.hiringEntityId ?? 'c1_select_llc'),
      label: String(e.accountName ?? e.jobOrderName ?? '').slice(0, 40),
    });
    byWorker.set(uid, lines);
  });

  let sent = 0;
  let errors = 0;
  for (const [uid, lines] of byWorker) {
    if (sent >= MAX_SENDS_PER_RUN) {
      logger.warn('[hoursConfirmed] per-run send cap reached; remainder next sweep', {
        remaining: byWorker.size - sent,
      });
      break;
    }
    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) continue;
      const userData = userSnap.data() as Record<string, unknown>;
      if (userIsInActiveMigration(userData)) continue;
      const phone = phoneE164FromUser(userData);
      if (!phone) continue;
      if (!(await claimTypeDailySlot(TENANT_ID, uid, 'payroll_hours_confirmed', 1))) continue;

      const totalHours = lines.reduce((a, l) => a + l.hours, 0);
      const totalGross = lines.reduce((a, l) => a + l.gross, 0);
      const latest = lines.reduce((a, b) => (a.workDate > b.workDate ? a : b));
      const payday = paydayForWorkDate(latest.workDate, latest.entityId);
      const lang = String(userData.preferredLanguage ?? '').toLowerCase() === 'es' ? 'es' : 'en';
      const paydayStr = new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).format(payday);
      const shiftWord =
        lines.length === 1
          ? lang === 'es'
            ? `tu turno del ${latest.workDate.slice(5)}`
            : `your ${latest.workDate.slice(5)} shift`
          : lang === 'es'
            ? `tus ${lines.length} turnos`
            : `your ${lines.length} shifts`;
      const where = latest.label ? ` (${latest.label})` : '';
      const grossStr = `$${totalGross.toFixed(2)}`;
      const body =
        lang === 'es'
          ? `C1 Staffing: registramos ${shiftWord}${where} — ${totalHours.toFixed(2)} hrs, aprox. ${grossStr} bruto. Programado para llegar el ${paydayStr}. Detalles: https://hrxone.com/c1/workers/earnings`
          : `C1 Staffing: ${shiftWord}${where} is in — ${totalHours.toFixed(2)} hrs, est. ${grossStr} gross. Scheduled to arrive ${paydayStr}. Details: https://hrxone.com/c1/workers/earnings`;

      const result = await sendWorkerMessageInternal(phone, body, {
        systemContext: true,
        tenantId: TENANT_ID,
        userId: uid,
        messageTypeId: 'payroll_hours_confirmed',
        source: 'hours_confirmed_notifier',
        sourceId: `${uid}__${latest.workDate}`,
      });
      if (result.success) sent += 1;
      else errors += 1;
    } catch (e: unknown) {
      errors += 1;
      logger.warn('[hoursConfirmed] notify failed', {
        uid,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 160),
      });
    }
  }

  logger.info('[hoursConfirmed] done', { workers: byWorker.size, sent, errors, durationMs: Date.now() - start });
  return {
    success: errors === 0,
    durationMs: Date.now() - start,
    itemsProcessed: byWorker.size,
    errors,
    message: `${byWorker.size} workers with new hours, ${sent} texted`,
  };
}
