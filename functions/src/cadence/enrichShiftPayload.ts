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

export interface DayOfLogistics {
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  onsiteContactRole?: string;
  /** Short worker-facing snippets from the staffInstructions chain. */
  parkingText?: string;
  checkInText?: string;
}

/**
 * staffInstructions values are strings or i18n-ish maps ({ text | en |
 * instructions | text: { en } }) — same tolerant read as the web's
 * StaffInstructionCard.instructionTextToString.
 */
function instructionText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const inner = o.text ?? o.en ?? o.instructions;
    if (typeof inner === 'string') return inner.trim();
    if (inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>).en === 'string') {
      return String((inner as Record<string, unknown>).en).trim();
    }
  }
  return '';
}

/**
 * Day-of logistics for the T-2h instructions message (Greg 2026-09-03,
 * day-of completeness layer): the structured on-site contact (assignment →
 * shift → JO chain — recruiters set it on the JO's Day-of logistics card)
 * plus parking / check-in snippets from the staffInstructions chain
 * (assignment → shift → JO → location). Called at DISPATCH time, not
 * scheduling time, so a contact added the morning of the shift still makes
 * the message. Never throws — missing docs just mean fewer fields.
 */
export async function fetchDayOfLogistics(args: {
  tenantId: string;
  assignment: Record<string, unknown>;
  jobOrderId?: string;
  shiftId?: string;
}): Promise<DayOfLogistics> {
  const tenantId = normalize(args.tenantId);
  const assignment = args.assignment ?? {};
  // Payload pointers exist only when a shift doc resolved at scheduling —
  // the assignment doc is the fallback source of both ids.
  const jobOrderId = normalize(args.jobOrderId) || normalize(assignment.jobOrderId);
  const shiftId = normalize(args.shiftId) || resolveShiftIdFromAssignment(assignment);
  const out: DayOfLogistics = {};
  try {
    let jobOrder: Record<string, unknown> | null = null;
    let shift: Record<string, unknown> | null = null;
    if (jobOrderId) {
      const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
      jobOrder = joSnap.exists ? (joSnap.data() as Record<string, unknown>) : null;
      if (shiftId) {
        const shiftSnap = await db
          .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`)
          .get();
        shift = shiftSnap.exists ? (shiftSnap.data() as Record<string, unknown>) : null;
      }
    }
    // Venue-level defaults: location docs live under the company or at the
    // tenant root (same two paths the worker app resolves).
    let location: Record<string, unknown> | null = null;
    const worksiteId = normalize(assignment.worksiteId || jobOrder?.worksiteId);
    const companyId = normalize(assignment.companyId || jobOrder?.companyId);
    if (worksiteId) {
      if (companyId) {
        const snap = await db
          .doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${worksiteId}`)
          .get();
        if (snap.exists) location = snap.data() as Record<string, unknown>;
      }
      if (!location) {
        const snap = await db.doc(`tenants/${tenantId}/locations/${worksiteId}`).get();
        if (snap.exists) location = snap.data() as Record<string, unknown>;
      }
    }

    const first = (key: string): string => {
      for (const src of [assignment, shift, jobOrder]) {
        const v = normalize(src?.[key]);
        if (v) return v;
      }
      return '';
    };
    const name = first('onsiteContactName');
    const phone = first('onsiteContactPhone');
    const role = first('onsiteContactRole');
    if (name) out.onsiteContactName = name;
    if (phone) out.onsiteContactPhone = phone;
    if (role) out.onsiteContactRole = role;

    const instructionFor = (key: string): string => {
      for (const src of [assignment, shift, jobOrder, location]) {
        const si = src?.staffInstructions as Record<string, unknown> | undefined;
        const text = instructionText(si?.[key]);
        if (text) return text;
      }
      return '';
    };
    const parking = instructionFor('parking');
    const checkIn = instructionFor('checkIn');
    if (parking) out.parkingText = parking;
    if (checkIn) out.checkInText = checkIn;
  } catch (err) {
    logger.warn('enrichShiftPayload.fetchDayOfLogistics_failed', {
      tenantId,
      jobOrderId,
      shiftId,
      error: (err as Error)?.message || String(err),
    });
  }
  return out;
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
