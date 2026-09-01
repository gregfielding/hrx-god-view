/**
 * Grounding context for the worker support assistant (2026-08-30, Greg:
 * "could you handle 90% of the support requests directly?").
 *
 * The assistant used to answer from a small policy knowledge base only, so
 * "where's my shift tomorrow?" got generic guidance plus "contact your
 * recruiter". This builds a compact, worker-scoped snapshot of the data the
 * app already shows them — assignments, the job order's staff instructions,
 * and payroll setup state — so answers can be specific.
 *
 * ☠️ PII discipline (same rule as the payroll diagnosis): never put SSN /
 * last-4 / bank or routing numbers in the prompt. Booleans and counts only.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const MAX_UPCOMING = 5;
const MAX_RECENT = 3;

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** "Tue, Sep 2 · 7:00 AM–3:30 PM" — the shape a worker recognizes. */
function describeWhen(data: Record<string, unknown>): string {
  const start = toDate(data.startDate);
  if (!start) return 'date to be confirmed';
  const day = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const startTime = trim(data.startTime);
  const endTime = trim(data.endTime);
  if (!startTime) return day;
  return `${day} · ${startTime}${endTime ? `–${endTime}` : ''}`;
}

function describeWhere(data: Record<string, unknown>): string {
  const parts = [
    trim(data.worksiteName) || trim(data.locationName),
    trim(data.addressLine1),
    trim(data.city),
    trim(data.state),
  ].filter(Boolean);
  return parts.join(', ') || 'location to be confirmed';
}

export type WorkerSupportContext = {
  text: string;
  hasUpcomingShift: boolean;
  jobOrderIds: string[];
};

/**
 * Builds the grounding block. Fail-open: any read error degrades to a
 * smaller context rather than failing the worker's question.
 */
export async function buildWorkerSupportContext(args: {
  uid: string;
  tenantId: string;
}): Promise<WorkerSupportContext> {
  const { uid, tenantId } = args;
  const lines: string[] = [];
  const jobOrderIds: string[] = [];
  let hasUpcomingShift = false;

  // ---- Assignments (the "where do I work" half of support volume)
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('userId', '==', uid)
      .get();

    const now = Date.now();
    const rows = snap.docs
      .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
      .filter((row) => {
        const status = trim(row.data.status).toLowerCase();
        return status !== 'declined' && status !== 'worker-cancelled';
      });

    const upcoming = rows
      .filter((row) => {
        const start = toDate(row.data.startDate);
        return start != null && start.getTime() >= now - 12 * 3600 * 1000;
      })
      .sort((a, b) => {
        const at = toDate(a.data.startDate)?.getTime() ?? 0;
        const bt = toDate(b.data.startDate)?.getTime() ?? 0;
        return at - bt;
      })
      .slice(0, MAX_UPCOMING);

    const recent = rows
      .filter((row) => {
        const start = toDate(row.data.startDate);
        return start != null && start.getTime() < now - 12 * 3600 * 1000;
      })
      .sort((a, b) => {
        const at = toDate(a.data.startDate)?.getTime() ?? 0;
        const bt = toDate(b.data.startDate)?.getTime() ?? 0;
        return bt - at;
      })
      .slice(0, MAX_RECENT);

    hasUpcomingShift = upcoming.length > 0;

    if (upcoming.length > 0) {
      lines.push('UPCOMING SHIFTS:');
      for (const row of upcoming) {
        const d = row.data;
        const confirmation = d.cortConfirmation as Record<string, unknown> | undefined;
        const confirmState = trim(confirmation?.state) || 'not asked';
        const jobOrderId = trim(d.jobOrderId);
        if (jobOrderId) jobOrderIds.push(jobOrderId);
        lines.push(
          `- ${trim(d.jobTitle) || 'Shift'} | ${describeWhen(d)} | ${describeWhere(d)} | status: ${
            trim(d.status) || 'unknown'
          } | shift confirmation: ${confirmState}`,
        );
      }
    } else {
      lines.push('UPCOMING SHIFTS: none scheduled.');
    }

    if (recent.length > 0) {
      lines.push('RECENT SHIFTS:');
      for (const row of recent) {
        const d = row.data;
        lines.push(
          `- ${trim(d.jobTitle) || 'Shift'} | ${describeWhen(d)} | status: ${trim(d.status) || 'unknown'}`,
        );
      }
    }
  } catch (error) {
    logger.warn('workerSupportContext.assignments_failed', {
      uid,
      tenantId,
      message: (error as Error)?.message,
    });
  }

  // ---- Staff instructions for the next shift's job order (parking, uniform,
  // check-in — the questions workers actually text about).
  const nextJobOrderId = jobOrderIds[0];
  if (nextJobOrderId) {
    try {
      const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${nextJobOrderId}`).get();
      const instructions = joSnap.data()?.staffInstructions as
        | Record<string, { text?: unknown; notes?: unknown }>
        | undefined;
      if (instructions && typeof instructions === 'object') {
        const labels: Record<string, string> = {
          firstDay: 'First day',
          parking: 'Parking',
          checkIn: 'Check-in',
          uniform: 'Uniform',
          credentials: 'Credentials',
          other: 'Other',
        };
        const parts: string[] = [];
        for (const [key, section] of Object.entries(instructions)) {
          const body = trim(section?.text) || trim(section?.notes);
          if (!body) continue;
          parts.push(`- ${labels[key] ?? key}: ${body.slice(0, 400)}`);
        }
        if (parts.length > 0) {
          lines.push('SHIFT INSTRUCTIONS (from the job order, authoritative):');
          lines.push(...parts);
        }
      }
    } catch (error) {
      logger.warn('workerSupportContext.job_order_failed', {
        uid,
        tenantId,
        nextJobOrderId,
        message: (error as Error)?.message,
      });
    }
  }

  // ---- Payroll setup state (booleans only — never identifiers).
  try {
    const linkages = await db
      .collection(`tenants/${tenantId}/everee_workers`)
      .where('firebaseUid', '==', uid)
      .get();
    if (linkages.empty) {
      lines.push('PAYROLL: no payroll profile linked yet.');
    } else {
      const states = linkages.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const mirror = (d.readinessMirror ?? {}) as Record<string, unknown>;
        return [
          `entity ${trim(d.entityId) || 'unknown'}`,
          `onboarding complete: ${mirror.onboardingComplete === true ? 'yes' : 'no'}`,
          `bank on file: ${mirror.hasBankAccount === true ? 'yes' : 'no'}`,
          `tax ID on file: ${mirror.taxpayerIdentifierLast4 ? 'yes' : 'no'}`,
        ].join(', ');
      });
      lines.push(`PAYROLL: ${states.join(' | ')}`);
    }
  } catch (error) {
    logger.warn('workerSupportContext.payroll_failed', {
      uid,
      tenantId,
      message: (error as Error)?.message,
    });
  }

  return {
    text: lines.join('\n'),
    hasUpcomingShift,
    jobOrderIds,
  };
}
