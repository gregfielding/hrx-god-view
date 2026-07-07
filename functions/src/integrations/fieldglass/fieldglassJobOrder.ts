/**
 * **Fieldglass → HRX job order orchestrator (FG Slice 7).**
 *
 * Turns an enriched/parsed Fieldglass order into the full HRX stack, per
 * Greg's 2026-07-07 decisions:
 *
 *   - ONE job order per SDXOJP posting, the posting id stored as
 *     `poNumber` (also the idempotency key — re-runs can never duplicate).
 *   - Gig vs career by date span: < 7 days = gig, >= 7 days (or unknown
 *     dates) = career.
 *   - Fully automatic: JO status 'open', public jobs-board posting with
 *     the pay rate shown, one open shift (date-range/no-fixed-times).
 *   - 'Sodexo Basic' background package stamped on every JO.
 *   - `notes` carries the composed Fieldglass detail block
 *     (composeFieldglassOrderNotes) — rendered on the JO overview tab.
 *   - 30-mile smart-radius blast, cap 200 — via the JO's
 *     `autoMessagingSmartRadius` + `worksiteCoordinates`, consumed by the
 *     existing `jobOrderAutoMessagingOnShiftCreated` trigger. Sequencing
 *     enforces Greg's gate ("live link back to an active jobs board
 *     posting with a live shift before the messages are sent") by
 *     creating JO → POSTING → SHIFT in that order: when the shift-created
 *     trigger fires, the live posting already resolves for the SMS link.
 *   - Candidate-in-mind orders: everything is still created, but NO
 *     radius config is stamped → the trigger sends nothing. Deborah
 *     decides from the flagged card/JO.
 *
 * Close cascade (`closeFieldglassOrder`): Fieldglass Closed → JO
 * 'completed' (no 'closed' in the enum), postings 'expired', shifts
 * 'closed', review row 'superseded'.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { getNextJobOrderSeq } from '../../jobOrders/gigJobOrderFromChildAccount';
import { composeFieldglassOrderNotes, type FieldglassEnrichmentStamp } from './enrichment';
import { serverGeocodeSite } from './serverGeocode';

const FieldValue = admin.firestore.FieldValue;

export const FIELDGLASS_JO_MARKER = 'fieldglass';
const SYSTEM_ACTOR = 'system_fieldglass_auto';
const CAREER_SPAN_DAYS = 7;
const SMART_RADIUS_MILES = 30;
const SMART_RADIUS_MAX_RECIPIENTS = 200;
const SODEXO_BILL_MARKUP = 1.56;
/** AccuSource "Sodexo Basic Package" — verified in integrations_accusource/catalog
 *  (2026-07-07): id '23923', SS locator + CrimNet + County/Federal Criminal.
 *  Greg: this exact package on every Fieldglass JO, not a new catalog entry. */
const SODEXO_BASIC_SCREENING_PACKAGE_ID = '23923';
const SODEXO_BASIC_SCREENING_PACKAGE_NAME = 'Sodexo Basic Package';

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────

/** "07/20/2026" → "2026-07-20" (null when unparseable). */
export function fgDateToIso(raw: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function spanDays(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const s = Date.parse(`${startIso}T00:00:00Z`);
  const e = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.round((e - s) / 86400000);
}

/** Gig when the engagement is shorter than a week; career otherwise —
 *  including unknown dates (long-running is the safer default). */
export function jobTypeForSpan(days: number | null): 'gig' | 'career' {
  if (days === null) return 'career';
  return days < CAREER_SPAN_DAYS ? 'gig' : 'career';
}

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

// ─────────────────────────────────────────────────────────────────────
// ensureJobOrderForFieldglassRequest
// ─────────────────────────────────────────────────────────────────────

export interface EnsureFieldglassJobOrderResult {
  status:
    | 'created'
    | 'exists'
    | 'skipped_no_site'
    | 'skipped_closed'
    | 'skipped_disabled'
    | 'skipped_no_request';
  jobOrderId?: string;
  jobPostDocId?: string;
  shiftId?: string;
  jobType?: 'gig' | 'career';
  blastConfigured?: boolean;
  candidateInMind?: boolean;
}

export async function ensureJobOrderForFieldglassRequest(
  db: admin.firestore.Firestore,
  params: { tenantId: string; requestId: string },
): Promise<EnsureFieldglassJobOrderResult> {
  const { tenantId, requestId } = params;

  // Kill switch — flip `autoCreateJobOrders: false` on the config doc to
  // pause the whole JO layer without redeploying.
  const configSnap = await db.doc(`tenants/${tenantId}/integrations/fieldglass`).get();
  const config = (configSnap.data() ?? {}) as Record<string, unknown>;
  if (config.autoCreateJobOrders === false) return { status: 'skipped_disabled' };

  const requestRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) return { status: 'skipped_no_request' };
  const request = requestSnap.data() as Record<string, unknown>;

  const event = (request.event ?? {}) as Record<string, unknown>;
  const enrichment = (request.enrichment ?? {}) as FieldglassEnrichmentStamp;
  const siteResolution = (request.siteResolution ?? {}) as Record<string, unknown>;
  const postingId = trim(event.jobPostingId) || requestId.replace(/^fieldglass__/, '');

  // Closed orders never get a JO (backlog syncs see plenty of these).
  const postingStatus = trim(enrichment.postingStatus).toLowerCase();
  if (postingStatus.includes('closed')) return { status: 'skipped_closed' };

  const childAccountId = trim(siteResolution.childAccountId);
  const locationId = trim(siteResolution.locationId);
  const companyId = trim(siteResolution.companyId);
  if (!childAccountId || !locationId) return { status: 'skipped_no_site' };

  // ── Idempotency: request stamp first, then poNumber lookup. An
  // existing JO still gets an enrichment backfill — the email-first
  // creation path runs before the detail page has been synced, so
  // rates/positions/notes arrive on a later pass.
  const priorJoId = trim(request.jobOrderId);
  if (priorJoId) {
    const prior = await db.doc(`tenants/${tenantId}/job_orders/${priorJoId}`).get();
    if (prior.exists) {
      await backfillJobOrderFromEnrichment(prior.ref, prior.data()!, enrichment, postingId);
      return { status: 'exists', jobOrderId: priorJoId };
    }
  }
  const byPo = await db
    .collection(`tenants/${tenantId}/job_orders`)
    .where('poNumber', '==', postingId)
    .limit(1)
    .get();
  if (!byPo.empty) {
    const joDoc = byPo.docs[0];
    await requestRef.set(
      { jobOrderId: joDoc.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await backfillJobOrderFromEnrichment(joDoc.ref, joDoc.data(), enrichment, postingId);
    return { status: 'exists', jobOrderId: joDoc.id };
  }

  // ── Load the resolved account chain + location.
  const childSnap = await db.doc(`tenants/${tenantId}/accounts/${childAccountId}`).get();
  if (!childSnap.exists) return { status: 'skipped_no_site' };
  const child = childSnap.data() as Record<string, unknown>;
  const parentId = trim(child.parentAccountId);
  const parent = parentId
    ? ((await db.doc(`tenants/${tenantId}/accounts/${parentId}`).get()).data() as
        | Record<string, unknown>
        | undefined) ?? {}
    : {};

  const locSnap = await db
    .doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`)
    .get();
  const loc = (locSnap.data() ?? {}) as Record<string, unknown>;
  const worksiteName = trim(loc.nickname) || trim(loc.name) || trim(event.siteName);
  const worksiteAddress = {
    street: trim(loc.address),
    city: trim(loc.city),
    state: trim(loc.state),
    zipCode: trim(loc.zipCode ?? (loc as Record<string, unknown>).zip),
    country: trim(loc.country) || 'US',
  };
  const locCoords = loc.coordinates as { lat?: unknown; lng?: unknown } | null | undefined;
  let worksiteCoordinates =
    locCoords && Number.isFinite(locCoords.lat as number) && Number.isFinite(locCoords.lng as number)
      ? { lat: locCoords.lat as number, lng: locCoords.lng as number }
      : null;
  // Coordinate fallback: locations created before geocoding existed (or
  // through paths that only carried a street) have none — and without
  // coordinates the radius blast silently never fires. Geocode here and
  // patch the location so every later JO gets them for free.
  if (!worksiteCoordinates && (worksiteAddress.street || worksiteName)) {
    const hit = await serverGeocodeSite({
      siteName: worksiteAddress.street || worksiteName,
      city: worksiteAddress.city || undefined,
      state: worksiteAddress.state || undefined,
      zip: worksiteAddress.zipCode || undefined,
      expectedState: worksiteAddress.state || undefined,
    });
    if (hit) {
      worksiteCoordinates = { lat: hit.lat, lng: hit.lng };
      await locSnap.ref.set(
        { coordinates: worksiteCoordinates, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
  }

  // ── Field derivation.
  const title = trim(enrichment.title) || trim(event.title) || 'Fieldglass Order';
  const startIso = fgDateToIso(enrichment.startDate ?? (event.startDate as string));
  const endIso = fgDateToIso(enrichment.endDate ?? (event.endDate as string));
  const jobType = jobTypeForSpan(spanDays(startIso, endIso));
  const payRate =
    (Number.isFinite(enrichment.payRateSt as number) ? (enrichment.payRateSt as number) : undefined) ??
    (Number.isFinite(event.payRate as number) ? (event.payRate as number) : undefined) ??
    0;
  const billRate =
    (Number.isFinite(enrichment.billRateSt as number) ? (enrichment.billRateSt as number) : undefined) ??
    (payRate > 0 ? Math.round(payRate * SODEXO_BILL_MARKUP * 100) / 100 : 0);
  const positions = Number.isFinite(enrichment.positionsRequested as number)
    ? Math.max(1, Math.round(enrichment.positionsRequested as number))
    : 1;
  const candidateInMind = enrichment.candidateInMind === true;
  const notes = composeFieldglassOrderNotes(enrichment, postingId);
  const description =
    trim(enrichment.description) || trim(event.commentsToSupplier) || '';

  const childRecruiters = Array.isArray(
    (child.associations as Record<string, unknown> | undefined)?.recruiterIds,
  )
    ? ((child.associations as Record<string, unknown>).recruiterIds as string[]).filter(Boolean)
    : [];
  const parentRecruiters = Array.isArray(
    (parent.associations as Record<string, unknown> | undefined)?.recruiterIds,
  )
    ? ((parent.associations as Record<string, unknown>).recruiterIds as string[]).filter(Boolean)
    : [];
  const assignedRecruiters = childRecruiters.length > 0 ? childRecruiters : parentRecruiters;

  const { seq: jobOrderSeq, formatted: jobOrderNumber } = await getNextJobOrderSeq(db, tenantId);
  const now = FieldValue.serverTimestamp();

  // ── 1. Job order (status 'open' from birth — the posting's liveness
  // rule requires it, and full-auto means no human flips it later).
  const jobOrderData: Record<string, unknown> = {
    jobOrderSeq,
    jobOrderNumber,
    jobOrderName: `${title} - ${worksiteName}`.replace(/\s+/g, ' ').trim(),
    status: 'open',
    jobType,
    tenantId,
    createdAt: now,
    updatedAt: now,
    createdBy: SYSTEM_ACTOR,
    updatedBy: SYSTEM_ACTOR,

    // Account / lookup denorm — same conventions as the auto-gig builder.
    recruiterAccountId: childAccountId,
    accountId: childAccountId,
    accountName: trim(child.name) || childAccountId,
    parentAccountId: parentId || null,
    parentAccountName: trim(parent.name) || null,
    companyId: companyId || '',
    companyName: trim(parent.name) || 'Sodexo',

    // Worksite
    worksiteId: locationId,
    worksiteName,
    worksiteAddress,
    locationId,
    locationName: worksiteName,
    ...(worksiteCoordinates ? { worksiteCoordinates } : {}),

    // Job details
    jobTitle: title,
    jobDescription: description,
    jobDescriptionFromClient: description,
    assignedRecruiters,
    payRate,
    billRate,
    workersNeeded: positions,
    headcountRequested: positions,
    headcountFilled: 0,
    ...(startIso ? { startDate: admin.firestore.Timestamp.fromDate(new Date(`${startIso}T12:00:00Z`)) } : {}),
    ...(endIso ? { endDate: admin.firestore.Timestamp.fromDate(new Date(`${endIso}T12:00:00Z`)) } : {}),
    poNumber: postingId,
    poRequired: false,
    timesheetCollectionMethod: 'app_clock_in_out' as const,

    // Jobs board — public with pay, per Greg.
    jobsBoardVisibility: 'public' as const,
    visibility: 'public' as const,
    showPayRate: true,
    showStartDate: true,
    showShiftTimes: false,

    // Compliance — the AccuSource screening package drives the
    // background-check readiness item (assignmentReadinessItemV1 matches
    // the JO's screeningPackageId against the worker's records).
    hiringEntityId: trim(child.hiringEntityId) || trim(parent.hiringEntityId) || null,
    screeningPackageId: SODEXO_BASIC_SCREENING_PACKAGE_ID,
    screeningPackageName: SODEXO_BASIC_SCREENING_PACKAGE_NAME,
    backgroundCheckRequired: true,
    backgroundCheckPackages: [],
    drugScreenRequired: false,

    // Everything the Fieldglass details column carries (Greg, 2026-07-07).
    notes,

    // Smart-radius blast config — consumed by jobOrderAutoMessagingOnShiftCreated.
    // Candidate-in-mind orders get NO radius → nothing sends automatically.
    ...(worksiteCoordinates && !candidateInMind
      ? {
          autoMessagingSmartRadius: {
            miles: SMART_RADIUS_MILES,
            maxRecipients: SMART_RADIUS_MAX_RECIPIENTS,
          },
        }
      : {}),

    // Traceability
    autoCreatedFrom: FIELDGLASS_JO_MARKER,
    fieldglass: {
      postingId,
      requestId,
      candidateInMind,
      ...(enrichment.candidateInMindNote ? { candidateInMindNote: enrichment.candidateInMindNote } : {}),
      ...(enrichment.respondByDate ? { respondByDate: enrichment.respondByDate } : {}),
      ...(enrichment.maxSubmissions != null ? { maxSubmissions: enrichment.maxSubmissions } : {}),
    },
  };

  const joRef = db.collection(`tenants/${tenantId}/job_orders`).doc();
  await joRef.set(jobOrderData);

  // ── 2. Public jobs-board posting (BEFORE the shift, so the
  // shift-created messaging trigger resolves a live link — Greg's gate).
  const jobPostDocId = await createFieldglassJobPosting(db, {
    tenantId,
    jobOrderId: joRef.id,
    title,
    jobType,
    jobDescription: description || notes,
    worksiteName,
    worksiteAddress,
    payRate,
    startIso,
  });

  // ── 3. Open shift — date-range engagement, no fixed times (FG
  // schedules are free text). Creating this LAST fires the auto-messaging
  // trigger, which now finds JO(open) + posting(active) + this shift.
  const shiftRef = db.collection(`tenants/${tenantId}/job_orders/${joRef.id}/shifts`).doc();
  await shiftRef.set({
    shiftTitle: `${title} — Open Shift`,
    status: 'open',
    defaultJobTitle: title,
    totalStaffRequested: positions,
    overstaffCount: 0,
    showStaffNeeded: false,
    poNumber: postingId,
    shiftDate: startIso ?? new Date().toISOString().slice(0, 10),
    defaultStartTime: '',
    defaultEndTime: '',
    shiftDescription: trim(enrichment.scheduleText),
    emailIntro: '',
    clockInUrl: '',
    sendNotification: false,
    tenantId,
    jobOrderId: joRef.id,
    payRate,
    billRate,
    shiftType: 'open',
    noFixedTimes: true,
    hideFromJobsBoard: false,
    shiftMode: 'single',
    autoCreatedOpenShift: true,
    createdAt: now,
    updatedAt: now,
    createdBy: SYSTEM_ACTOR,
  });

  // ── 4. Stamp the review row — auto-created rows leave the queue.
  await requestRef.set(
    {
      jobOrderId: joRef.id,
      jobPostDocId,
      status: 'applied',
      decidedBy: SYSTEM_ACTOR,
      decidedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('[fieldglassJobOrder] created', {
    tenantId,
    requestId,
    postingId,
    jobOrderId: joRef.id,
    jobOrderNumber,
    jobType,
    positions,
    payRate,
    jobPostDocId,
    shiftId: shiftRef.id,
    candidateInMind,
    blastConfigured: Boolean(worksiteCoordinates && !candidateInMind),
  });

  return {
    status: 'created',
    jobOrderId: joRef.id,
    jobPostDocId,
    shiftId: shiftRef.id,
    jobType,
    blastConfigured: Boolean(worksiteCoordinates && !candidateInMind),
    candidateInMind,
  };
}

/**
 * Enrichment backfill for a JO created email-first (before the detail
 * page was synced). Only fills gaps — a recruiter's manual edits to pay
 * or headcount are never overwritten. `notes` IS refreshed every time:
 * it's a deterministic composition of Fieldglass data, not human text.
 */
async function backfillJobOrderFromEnrichment(
  joRef: FirebaseFirestore.DocumentReference,
  jo: Record<string, unknown>,
  enrichment: FieldglassEnrichmentStamp,
  postingId: string,
): Promise<void> {
  if (Object.keys(enrichment).length === 0) return;
  const patch: Record<string, unknown> = {};

  const currentPay = Number(jo.payRate ?? 0);
  if (currentPay <= 0 && Number.isFinite(enrichment.payRateSt as number)) {
    patch.payRate = enrichment.payRateSt;
  }
  const currentBill = Number(jo.billRate ?? 0);
  if (currentBill <= 0) {
    if (Number.isFinite(enrichment.billRateSt as number)) patch.billRate = enrichment.billRateSt;
    else if (patch.payRate != null) {
      patch.billRate = Math.round((patch.payRate as number) * SODEXO_BILL_MARKUP * 100) / 100;
    }
  }
  const currentHeadcount = Number(jo.headcountRequested ?? 0);
  if (
    currentHeadcount <= 1 &&
    Number.isFinite(enrichment.positionsRequested as number) &&
    (enrichment.positionsRequested as number) > currentHeadcount
  ) {
    patch.headcountRequested = enrichment.positionsRequested;
    patch.workersNeeded = enrichment.positionsRequested;
  }
  const notes = composeFieldglassOrderNotes(enrichment, postingId);
  if (notes !== String(jo.notes ?? '')) patch.notes = notes;
  if (enrichment.candidateInMind === true) {
    patch['fieldglass.candidateInMind'] = true;
    if (enrichment.candidateInMindNote) {
      patch['fieldglass.candidateInMindNote'] = enrichment.candidateInMindNote;
    }
  }

  if (Object.keys(patch).length === 0) return;
  patch.updatedAt = FieldValue.serverTimestamp();
  patch.updatedBy = SYSTEM_ACTOR;
  await joRef.update(patch);
  logger.info('[fieldglassJobOrder] enrichment backfill', {
    jobOrderId: joRef.id,
    patched: Object.keys(patch),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Posting creation (server-side — jobsBoardService is client-only)
// ─────────────────────────────────────────────────────────────────────

async function createFieldglassJobPosting(
  db: admin.firestore.Firestore,
  params: {
    tenantId: string;
    jobOrderId: string;
    title: string;
    jobType: 'gig' | 'career';
    jobDescription: string;
    worksiteName: string;
    worksiteAddress: Record<string, string>;
    payRate: number;
    startIso: string | null;
  },
): Promise<string> {
  const { tenantId, jobOrderId } = params;

  // Sequential jobPostId — same counter doc the client allocator uses
  // (`tenants/{tid}/counters/jobPosts`, `current`), but transactional so
  // concurrent auto-creates can't collide.
  const counterRef = db.doc(`tenants/${tenantId}/counters/jobPosts`);
  const nextSeq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.current ?? 2000) : 2000;
    const next = current + 1;
    tx.set(
      counterRef,
      { current: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return next;
  });

  const postRef = db.collection(`tenants/${tenantId}/job_postings`).doc();
  await postRef.set({
    jobPostId: String(nextSeq),
    tenantId,
    jobOrderId,
    postTitle: params.title,
    jobType: params.jobType,
    jobTitle: params.title,
    jobDescription: params.jobDescription,
    companyName: 'Sodexo',
    worksiteName: params.worksiteName,
    worksiteAddress: params.worksiteAddress,
    visibility: 'public',
    status: 'active',
    payRate: params.payRate,
    showPayRate: true,
    ...(params.startIso ? { startDate: params.startIso } : {}),
    applicationCount: 0,
    restrictedGroups: [],
    createdBy: SYSTEM_ACTOR,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    postedAt: FieldValue.serverTimestamp(),
  });
  return postRef.id;
}

// ─────────────────────────────────────────────────────────────────────
// Close cascade
// ─────────────────────────────────────────────────────────────────────

export interface CloseFieldglassOrderResult {
  status: 'closed' | 'no_job_order' | 'already_terminal';
  jobOrderId?: string;
  postingsExpired: number;
  shiftsClosed: number;
}

/** Fieldglass Closed → JO 'completed' + postings 'expired' + shifts
 *  'closed' + review row 'superseded'. Safe to re-run. */
export async function closeFieldglassOrder(
  db: admin.firestore.Firestore,
  params: { tenantId: string; requestId: string; reason: string },
): Promise<CloseFieldglassOrderResult> {
  const { tenantId, requestId, reason } = params;
  const requestRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
  const requestSnap = await requestRef.get();
  const request = (requestSnap.data() ?? {}) as Record<string, unknown>;
  const postingId =
    trim((request.event as Record<string, unknown> | undefined)?.jobPostingId) ||
    requestId.replace(/^fieldglass__/, '');

  // Locate the JO: stamped id first, poNumber fallback.
  let joRef: FirebaseFirestore.DocumentReference | null = null;
  let joData: Record<string, unknown> | null = null;
  const stampedId = trim(request.jobOrderId);
  if (stampedId) {
    const snap = await db.doc(`tenants/${tenantId}/job_orders/${stampedId}`).get();
    if (snap.exists) {
      joRef = snap.ref;
      joData = snap.data() as Record<string, unknown>;
    }
  }
  if (!joRef) {
    const byPo = await db
      .collection(`tenants/${tenantId}/job_orders`)
      .where('poNumber', '==', postingId)
      .limit(1)
      .get();
    if (!byPo.empty) {
      joRef = byPo.docs[0].ref;
      joData = byPo.docs[0].data() as Record<string, unknown>;
    }
  }

  // Review row leaves the queue either way.
  if (requestSnap.exists) {
    await requestRef.set(
      {
        status: 'superseded',
        fieldglassClosed: { reason, closedAt: new Date().toISOString() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (!joRef || !joData) {
    return { status: 'no_job_order', postingsExpired: 0, shiftsClosed: 0 };
  }

  const terminal = new Set(['cancelled', 'canceled', 'completed', 'filled']);
  const alreadyTerminal = terminal.has(trim(joData.status).toLowerCase());
  if (!alreadyTerminal) {
    await joRef.set(
      {
        status: 'completed',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
        fieldglassClosedReason: reason,
      },
      { merge: true },
    );
  }

  // Expire linked postings.
  const postings = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', joRef.id)
    .get();
  let postingsExpired = 0;
  for (const p of postings.docs) {
    const status = trim((p.data() as Record<string, unknown>).status).toLowerCase();
    if (status === 'expired' || status === 'cancelled') continue;
    await p.ref.set(
      { status: 'expired', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    postingsExpired++;
  }

  // Close shifts.
  const shifts = await db.collection(`tenants/${tenantId}/job_orders/${joRef.id}/shifts`).get();
  let shiftsClosed = 0;
  for (const s of shifts.docs) {
    const status = trim((s.data() as Record<string, unknown>).status).toLowerCase();
    if (status === 'closed' || status === 'cancelled') continue;
    await s.ref.set(
      { status: 'closed', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    shiftsClosed++;
  }

  logger.info('[fieldglassJobOrder] closed', {
    tenantId,
    requestId,
    jobOrderId: joRef.id,
    reason,
    alreadyTerminal,
    postingsExpired,
    shiftsClosed,
  });
  return {
    status: alreadyTerminal ? 'already_terminal' : 'closed',
    jobOrderId: joRef.id,
    postingsExpired,
    shiftsClosed,
  };
}
