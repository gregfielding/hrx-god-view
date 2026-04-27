/**
 * Enrich the reminder payload with shift-level fields (clock-in URL, shift
 * description, email intro, etc.).
 *
 * Assignments point at their shift via `shiftId` (+ `jobOrderId`). Shift docs
 * live at `tenants/{tid}/job_orders/{joid}/shifts/{sid}` and carry
 * worker-facing fields that the stock assignment-level reminders don't surface.
 *
 * We read those fields here so the new cadence reminder types can render
 * richer bodies ("parking is at Gate B, ask for Mike at the loading dock")
 * without every caller having to re-do the lookup.
 *
 * Fail-open: if the shift doc is missing or unreadable we return an empty
 * enrichment object — the caller uses whatever was already on the payload.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export interface ShiftPayloadExtras {
  /** Clock-in URL (e.g. Indeed Flex link) for this shift. */
  clockInUrl?: string;
  /** Shift title (often more specific than jobTitle). */
  shiftTitle?: string;
  /** Free-text, worker-facing detail block — parking, site entry, what to bring. */
  shiftDescription?: string;
  /** Short welcome / intro shown in worker-facing email / SMS. */
  emailIntro?: string;
  /** Canonical shift id (echoed back for debugging). */
  shiftId?: string;
  /** Canonical job-order id. */
  jobOrderId?: string;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Fetch and return the worker-relevant subset of a shift doc. Never throws.
 */
export async function fetchShiftPayloadExtras(args: {
  tenantId: string;
  jobOrderId?: string;
  shiftId?: string;
}): Promise<ShiftPayloadExtras> {
  const tenantId = normalize(args.tenantId);
  const jobOrderId = normalize(args.jobOrderId);
  const shiftId = normalize(args.shiftId);
  if (!tenantId || !jobOrderId || !shiftId) return {};

  try {
    const snap = await db
      .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`)
      .get();
    if (!snap.exists) return { shiftId, jobOrderId };
    const data = snap.data() as Record<string, unknown>;
    const extras: ShiftPayloadExtras = {
      shiftId,
      jobOrderId,
    };
    const clockInUrl = normalize(data.clockInUrl);
    if (clockInUrl) extras.clockInUrl = clockInUrl;
    const shiftTitle = normalize(data.shiftTitle);
    if (shiftTitle) extras.shiftTitle = shiftTitle;
    const shiftDescription = normalize(data.shiftDescription);
    if (shiftDescription) extras.shiftDescription = shiftDescription;
    const emailIntro = normalize(data.emailIntro);
    if (emailIntro) extras.emailIntro = emailIntro;
    return extras;
  } catch (err) {
    logger.warn('enrichShiftPayload.fetch_failed', {
      tenantId,
      jobOrderId,
      shiftId,
      error: (err as Error)?.message || String(err),
    });
    return { shiftId, jobOrderId };
  }
}

/**
 * Resolve the best shift pointer from an assignment doc — handles both the
 * singular `shiftId` (new shape) and the legacy `shiftIds[]` array.
 */
export function resolveShiftIdFromAssignment(assignment: Record<string, unknown>): string {
  const direct = normalize(assignment.shiftId);
  if (direct) return direct;
  const arr = assignment.shiftIds;
  if (Array.isArray(arr) && arr.length > 0) {
    for (const item of arr) {
      const s = normalize(item);
      if (s) return s;
    }
  }
  return '';
}
