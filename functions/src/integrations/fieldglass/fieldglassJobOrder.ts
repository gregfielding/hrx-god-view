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
import { ensureAutoUserGroup } from '../../userGroups/ensureAutoUserGroup';
import {
  composeFieldglassOrderNotes,
  generateFieldglassPostingCopy,
  type FieldglassEnrichmentStamp,
} from './enrichment';
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

/**
 * Ensure the order's job title exists in the tenant's master job-titles
 * catalog (`modules/hrx-flex/jobTitles` — feeds every title picker,
 * including the Workers Comp repo's auto-apply chips). Greg, 2026-07-07:
 * "if the job title isn't in our job titles list, can you add it?"
 * Case-insensitive dedupe; Fieldglass's uniform text seeds the catalog's
 * uniform field on create. Fail-open.
 */
async function ensureJobTitleInCatalog(
  db: admin.firestore.Firestore,
  params: { tenantId: string; title: string; uniform?: string },
): Promise<void> {
  const title = params.title.trim();
  if (!title) return;
  try {
    const col = db.collection(`tenants/${params.tenantId}/modules/hrx-flex/jobTitles`);
    const snap = await col.select('title').get();
    const wanted = title.toLowerCase();
    for (const d of snap.docs) {
      if (String((d.data() as Record<string, unknown>).title ?? '').trim().toLowerCase() === wanted) {
        return; // already in the catalog
      }
    }
    await col.add({
      title,
      description: '',
      uniform: String(params.uniform ?? '').trim(),
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info('[fieldglassJobOrder] job title added to catalog', {
      tenantId: params.tenantId,
      title,
    });
  } catch (err) {
    logger.warn('[fieldglassJobOrder] job title catalog ensure failed (non-fatal)', {
      tenantId: params.tenantId,
      title,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Assemble the full generateFieldglassPostingCopy input from everything
 * the pipeline knows (2026-07-08: "the AI generated posting is weak" —
 * previously only 7 of ~15 available fields were passed). Shared by the
 * create path and the backfill's regeneration.
 */
function buildPostingCopyInput(args: {
  title: string;
  worksiteAddress: Record<string, string>;
  payRate: number;
  jobType: 'gig' | 'career';
  enrichment: FieldglassEnrichmentStamp;
  description?: string;
  commentsToSupplier?: string;
  startIso: string | null;
  endIso: string | null;
}) {
  const e = args.enrichment;
  const num = (v: unknown): number | undefined =>
    Number.isFinite(v as number) && (v as number) > 0 ? (v as number) : undefined;
  return {
    title: args.title,
    city: args.worksiteAddress.city || undefined,
    state: args.worksiteAddress.state || undefined,
    zipCode: args.worksiteAddress.zipCode || undefined,
    payRate: args.payRate > 0 ? args.payRate : undefined,
    payRateOt: num(e.payRateOt),
    scheduleText: trim(e.scheduleText) || undefined,
    hoursPerWeek: num(e.hoursPerWeek) ? String(e.hoursPerWeek) : undefined,
    uniform: trim(e.uniform) || undefined,
    description: args.description,
    commentsToSupplier: args.commentsToSupplier,
    contractType: trim(e.contractType) || undefined,
    positionsRequested: num(e.positionsRequested),
    startDate: args.startIso ?? undefined,
    endDate: args.endIso ?? undefined,
    jobType: args.jobType,
  };
}

/**
 * Workers-comp resolution from the central repo (Greg, 2026-07-07:
 * "will pull from our central repo, if a code exists").
 * `tenants/{tid}/workers_comp_rates` docs: {state, code, rate,
 * jobTitles[], modifierAccountId?}. Account-scoped rules (modifier =
 * the national parent) beat generic ones — mirrors the client's
 * pickWorkersCompJobTitleLookup. Title match is normalized-exact
 * against the auto-apply chips; no match → null (JO stays blank, the
 * existing WC chain resolves it before payroll).
 */
async function resolveWorkersCompForOrder(
  db: admin.firestore.Firestore,
  params: {
    tenantId: string;
    state: string;
    jobTitle: string;
    modifierAccountId: string | null;
  },
): Promise<{ code: string; rate: number } | null> {
  const state = params.state.trim().toUpperCase();
  const title = params.jobTitle.trim().toLowerCase();
  if (!state || !title) return null;
  try {
    const snap = await db
      .collection(`tenants/${params.tenantId}/workers_comp_rates`)
      .where('state', '==', state)
      .get();
    let generic: { code: string; rate: number } | null = null;
    for (const d of snap.docs) {
      const r = d.data() as Record<string, unknown>;
      const code = trim(r.code);
      const rate = Number(r.rate);
      if (!code || !Number.isFinite(rate)) continue;
      const titles = Array.isArray(r.jobTitles) ? (r.jobTitles as string[]) : [];
      if (!titles.some((t) => String(t ?? '').trim().toLowerCase() === title)) continue;
      const modifier = trim(r.modifierAccountId);
      if (modifier && params.modifierAccountId && modifier === params.modifierAccountId) {
        return { code, rate }; // scoped match wins immediately
      }
      if (!modifier && !generic) generic = { code, rate };
    }
    return generic;
  } catch (err) {
    logger.warn('[fieldglassJobOrder] WC lookup failed (non-fatal)', {
      tenantId: params.tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Parse the "First Day Schedule Start and End Time" free text into a
 * clock window (Greg, 2026-07-07: when we have real times, make a
 * STANDARD shift; open shift is the fallback for unparseable text).
 * Handles "08:00am 2:30pm", "8am-4:30pm", "8:00 AM to 2:30 PM". Text
 * with fewer than two times ("Friday at 8am for Orientation") returns
 * null — that's a note, not a schedule.
 */
export function parseScheduleWindow(
  raw: string | null | undefined,
): { start: string; end: string } | null {
  const text = String(raw ?? '');
  const times: string[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? '0');
    const ampm = m[3].toLowerCase();
    if (h < 1 || h > 12 || min > 59) continue;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    times.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  if (times.length < 2) return null;
  const [start, end] = [times[0], times[times.length - 1]];
  if (start === end) return null;
  return { start, end };
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
  // Stale order guard (bulk-sync lesson, 2026-07-07: SDXOJP00183851 ended
  // June 23 but Sodexo left the posting open — we blasted 198 workers whose
  // link then died when the gig status cron instantly held the JO). An
  // order whose END date is already past still gets its JO/posting for the
  // record, but no radius blast — same silent treatment as candidate-in-mind.
  const todayIso = new Date().toISOString().slice(0, 10);
  const endedInPast = Boolean(endIso && endIso < todayIso);
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

  // ── Auto user group (Greg, 2026-07-07: "automatically create user
  // groups that applicants would be added to — same logic as the
  // account-level toggle"). AG.0's ensureAutoUserGroup: deterministic
  // `auto_{childId}_{titleSlug}` group per (child × title) — repeat
  // orders for the same site+title share one group. The AG.1 attach
  // trigger sees autoCreatedUserGroupId already set and stands down.
  let autoUserGroupId: string | null = null;
  try {
    const g = await ensureAutoUserGroup({
      tenantId,
      childAccountId,
      childAccountName: trim(child.name) || childAccountId,
      jobTitleId: title.toLowerCase(),
      jobTitleName: title,
      nationalAccountId: parentId || null,
      recruiterIds: assignedRecruiters,
      createdBy: SYSTEM_ACTOR,
      db,
    });
    autoUserGroupId = g.groupId;
  } catch (err) {
    logger.warn('[fieldglassJobOrder] auto user group failed (non-fatal)', {
      tenantId,
      requestId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Master job-titles catalog learns every Fieldglass title — so the WC
  // repo's chip picker (and every title dropdown) can offer it.
  await ensureJobTitleInCatalog(db, {
    tenantId,
    title,
    uniform: trim(enrichment.uniform) || undefined,
  });

  // Workers comp from the central repo — matched by worksite state +
  // job title, Sodexo-scoped rules first. Null when no chip matches
  // (Greg: "if a code exists").
  const wc = await resolveWorkersCompForOrder(db, {
    tenantId,
    state: worksiteAddress.state,
    jobTitle: title,
    modifierAccountId: parentId || childAccountId,
  });

  // AI posting copy (Greg, 2026-07-07; widened 2026-07-08 — "the AI
  // generated posting is weak... fires without all of the fieldglass
  // data"). Everything the enrichment knows goes in; email-born orders
  // still generate from email data here, then the enrichment backfill
  // REGENERATES once the detail page arrives (see
  // regeneratePostingCopyIfMachineOwned).
  const postingCopy = await generateFieldglassPostingCopy(
    buildPostingCopyInput({
      title,
      worksiteAddress,
      payRate,
      jobType,
      enrichment,
      description,
      commentsToSupplier: trim(event.commentsToSupplier) || undefined,
      startIso,
      endIso,
    }),
  );

  const { seq: jobOrderSeq, formatted: jobOrderNumberFormatted } = await getNextJobOrderSeq(db, tenantId);
  const now = FieldValue.serverTimestamp();

  // ── 1. Job order (status 'open' from birth — the posting's liveness
  // rule requires it, and full-auto means no human flips it later).
  // 🔥 Hot inheritance: one returned phone call marks the child account
  // hot; every future order at that site is born hot and triaged first.
  const accountIsHot = (child as Record<string, unknown>).hot === true;

  const jobOrderData: Record<string, unknown> = {
    jobOrderSeq,
    // NUMBER on the doc (2026-07-08 normalization; mixed types broke
    // Firestore orderBy) — the padded string stays in logs/alerts only.
    jobOrderNumber: jobOrderSeq,
    ...(accountIsHot ? { hot: true, hotUpdatedBy: SYSTEM_ACTOR } : {}),
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

    // Job details — jobDescription is the AI-written public copy (house
    // rule: never name the client/worksite; "C1 is hiring");
    // jobDescriptionFromClient keeps the raw Fieldglass text.
    jobTitle: title,
    jobDescription: postingCopy ?? description,
    jobDescriptionFromClient: description,
    assignedRecruiters,
    payRate,
    billRate,
    ...(wc ? { workersCompCode: wc.code, workersCompRate: wc.rate } : {}),
    workersNeeded: positions,
    headcountRequested: positions,
    headcountFilled: 0,
    // Plain YYYY-MM-DD strings — the JobOrderForm binds these straight to
    // <input type="date"> (Timestamps render as empty; found in the first
    // live JO review, 2026-07-07).
    ...(startIso ? { startDate: startIso } : {}),
    ...(endIso ? { endDate: endIso } : {}),
    poNumber: postingId,
    poRequired: false,
    timesheetCollectionMethod: 'app_clock_in_out' as const,

    // Jobs board — public with pay, per Greg.
    jobsBoardVisibility: 'public' as const,
    visibility: 'public' as const,
    showPayRate: true,
    showStartDate: true,
    showShiftTimes: false,

    // Auto user group (AG.0) — applicants/hires from this JO feed the
    // group; group members are also messaged on future shifts. The AG.1
    // attach trigger sees autoCreatedUserGroupId set and stands down.
    ...(autoUserGroupId
      ? {
          autoCreatedUserGroupId: autoUserGroupId,
          autoMessagingUserGroupIds: [autoUserGroupId],
          autoAddToUserGroups: [autoUserGroupId],
        }
      : {}),

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
    // Candidate-in-mind, already-ended, and UNPRICED orders get NO radius →
    // nothing sends automatically (never SMS-blast a job whose posting is a
    // $0 draft; once the rate arrives the recruiter can blast via Worker
    // Reach).
    ...(worksiteCoordinates && !candidateInMind && !endedInPast && payRate > 0
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
      // AI-copy bookkeeping: `aiJobDescription` is the exact machine copy
      // (backfill only regenerates when jobDescription still matches it —
      // human edits are never clobbered); `aiCopyEnriched` marks whether
      // the copy was written WITH detail-page enrichment, so email-born
      // orders get exactly one upgrade regeneration when it arrives.
      ...(postingCopy ? { aiJobDescription: postingCopy } : {}),
      aiCopyEnriched: Object.keys(enrichment).length > 0,
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
    jobDescription: postingCopy ?? (description || notes),
    worksiteName,
    worksiteAddress,
    payRate,
    startIso,
    autoUserGroupId,
  });

  // ── 3. Shift — STANDARD with real times when the "First Day Schedule"
  // text parses to a clock window (Greg, 2026-07-07); open shift
  // (date-range, no fixed times) otherwise. Creating this LAST fires the
  // auto-messaging trigger, which now finds JO(open) + posting(active) +
  // this shift.
  const window = parseScheduleWindow(enrichment.scheduleText);
  const shiftRef = db.collection(`tenants/${tenantId}/job_orders/${joRef.id}/shifts`).doc();
  await shiftRef.set({
    shiftTitle: window ? title : `${title} — Open Shift`,
    status: 'open',
    defaultJobTitle: title,
    totalStaffRequested: positions,
    overstaffCount: 0,
    showStaffNeeded: false,
    poNumber: postingId,
    shiftDate: startIso ?? new Date().toISOString().slice(0, 10),
    defaultStartTime: window?.start ?? '',
    defaultEndTime: window?.end ?? '',
    shiftDescription: trim(enrichment.scheduleText),
    emailIntro: '',
    clockInUrl: '',
    sendNotification: false,
    tenantId,
    jobOrderId: joRef.id,
    payRate,
    billRate,
    ...(wc ? { workersCompCode: wc.code, workersCompRate: wc.rate } : {}),
    ...(window
      ? {}
      : { shiftType: 'open', noFixedTimes: true, autoCreatedOpenShift: true }),
    hideFromJobsBoard: false,
    shiftMode: 'single',
    createdAt: now,
    updatedAt: now,
    createdBy: SYSTEM_ACTOR,
  });

  // ── 4. Hiring manager → CRM contact + Deal Contacts card (FG Slice 8).
  await ensureHiringManagerDealContact(db, {
    tenantId,
    joRef,
    jo: jobOrderData,
    enrichment,
  });

  // ── 5. Stamp the review row — auto-created rows leave the queue.
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
    jobOrderNumber: jobOrderNumberFormatted,
    jobType,
    positions,
    payRate,
    jobPostDocId,
    shiftId: shiftRef.id,
    candidateInMind,
    blastConfigured: Boolean(worksiteCoordinates && !candidateInMind && !endedInPast),
  });

  return {
    status: 'created',
    jobOrderId: joRef.id,
    jobPostDocId,
    shiftId: shiftRef.id,
    jobType,
    blastConfigured: Boolean(worksiteCoordinates && !candidateInMind && !endedInPast),
    candidateInMind,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Hiring manager → CRM contact + JO deal contact (FG Slice 8)
// ─────────────────────────────────────────────────────────────────────

/** Fieldglass hiring-manager names arrive as prose fragments — observed
 *  live: "to Sarah Plamondon." Strip leading connectives and trailing
 *  punctuation so the CRM contact reads like a name. */
export function sanitizeContactName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/^\s*(?:to|attn:?|attention:?|contact:?)\s+/i, '')
    .replace(/[\s.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ensure the order's hiring manager exists as a CRM contact on the
 * company and appears in the JO's Deal Contacts card
 * (`deal.associations.contacts` embedded on the JO — the card's read
 * path; no crm_deals doc needed). Email is the dedupe key (matched
 * case-insensitively against the company's contacts — no global email
 * index exists). Fail-open: never blocks JO creation.
 */
async function ensureHiringManagerDealContact(
  db: admin.firestore.Firestore,
  params: {
    tenantId: string;
    joRef: FirebaseFirestore.DocumentReference;
    jo: Record<string, unknown>;
    enrichment: FieldglassEnrichmentStamp;
  },
): Promise<void> {
  const { tenantId, joRef, jo, enrichment } = params;
  const email = String(enrichment.hiringManagerEmail ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return; // email is the identity — no email, no contact
  const name = sanitizeContactName(enrichment.hiringManagerName) || email.split('@')[0];
  const companyId = trim(jo.companyId);
  if (!companyId) return;

  try {
    // Dedupe against the company's contacts (small set; compare lowercased).
    const existing = await db
      .collection(`tenants/${tenantId}/crm_contacts`)
      .where('companyId', '==', companyId)
      .get();
    let contactId: string | null = null;
    let contact: Record<string, unknown> | null = null;
    for (const d of existing.docs) {
      const c = d.data() as Record<string, unknown>;
      if (String(c.email ?? '').trim().toLowerCase() === email) {
        contactId = d.id;
        contact = c;
        break;
      }
    }

    if (!contactId) {
      const parts = name.split(' ');
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
      contact = {
        fullName: name,
        firstName,
        lastName,
        email,
        phone: String(enrichment.hiringManagerPhone ?? '').trim(),
        title: 'Hiring Manager',
        companyId,
        role: 'decision_maker',
        status: 'active',
        tags: ['fieldglass'],
        notes: `Auto-created from Fieldglass order ${trim(jo.poNumber)} (hiring manager on the posting).`,
        ...(trim(jo.locationId) ? { locationId: trim(jo.locationId) } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR,
      };
      const ref = await db.collection(`tenants/${tenantId}/crm_contacts`).add(contact);
      contactId = ref.id;
      logger.info('[fieldglassJobOrder] crm contact created', {
        tenantId,
        contactId,
        email,
        name,
        companyId,
      });
    }

    // Append to the JO's embedded deal contacts unless already present.
    const dealAssoc = (jo.deal as Record<string, unknown> | undefined)?.associations as
      | Record<string, unknown>
      | undefined;
    const current = Array.isArray(dealAssoc?.contacts)
      ? (dealAssoc!.contacts as Array<Record<string, unknown>>)
      : [];
    if (current.some((c) => c.id === contactId)) return;
    const entry = {
      id: contactId,
      snapshot: {
        fullName: String(contact!.fullName ?? name),
        firstName: String(contact!.firstName ?? ''),
        lastName: String(contact!.lastName ?? ''),
        email,
        phone: String(contact!.phone ?? ''),
        title: String(contact!.title ?? 'Hiring Manager'),
      },
    };
    await joRef.update({
      'deal.associations.contacts': [...current, entry],
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info('[fieldglassJobOrder] deal contact attached', {
      tenantId,
      jobOrderId: joRef.id,
      contactId,
    });
  } catch (err) {
    logger.warn('[fieldglassJobOrder] hiring-manager contact failed (non-fatal)', {
      tenantId,
      jobOrderId: joRef.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
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

  // Hiring manager contact — idempotent, so every backfill pass may try.
  const tenantId = joRef.path.split('/')[1];
  await ensureHiringManagerDealContact(admin.firestore(), { tenantId, joRef, jo, enrichment });

  const patch: Record<string, unknown> = {};

  // Catalog the title on backfill too — covers JOs created before the
  // auto-add shipped. Dedupe makes repeat passes free.
  if (trim(jo.jobTitle)) {
    await ensureJobTitleInCatalog(admin.firestore(), {
      tenantId,
      title: trim(jo.jobTitle),
      uniform: trim(enrichment.uniform) || undefined,
    });
  }

  // Auto user group backfill (FG Slice 9) — FG JOs created before the
  // group feature (or where the ensure hiccupped) get theirs here.
  if (!trim(jo.autoCreatedUserGroupId)) {
    try {
      const title = trim(jo.jobTitle) || 'Fieldglass Order';
      const g = await ensureAutoUserGroup({
        tenantId,
        childAccountId: trim(jo.accountId),
        childAccountName: trim(jo.accountName) || trim(jo.accountId),
        jobTitleId: title.toLowerCase(),
        jobTitleName: title,
        nationalAccountId: trim(jo.parentAccountId) || null,
        recruiterIds: Array.isArray(jo.assignedRecruiters)
          ? (jo.assignedRecruiters as string[])
          : [],
        createdBy: SYSTEM_ACTOR,
        db: admin.firestore(),
      });
      patch.autoCreatedUserGroupId = g.groupId;
      patch.autoMessagingUserGroupIds = admin.firestore.FieldValue.arrayUnion(g.groupId);
      patch.autoAddToUserGroups = admin.firestore.FieldValue.arrayUnion(g.groupId);
      // Feed the linked postings too — the applicant-adder reads the posting.
      const postings = await admin
        .firestore()
        .collection(`tenants/${tenantId}/job_postings`)
        .where('jobOrderId', '==', joRef.id)
        .get();
      for (const p of postings.docs) {
        await p.ref.set(
          {
            autoAddToUserGroups: admin.firestore.FieldValue.arrayUnion(g.groupId),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    } catch (err) {
      logger.warn('[fieldglassJobOrder] auto user group backfill failed (non-fatal)', {
        jobOrderId: joRef.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
  // Pay rate reached the JO → push it to the linked postings too, and flip
  // any awaiting-pay DRAFT posting live (postings born unpriced stay drafts
  // until this moment — a public $0.00/hr card is worse than no card).
  if (patch.payRate != null && Number(patch.payRate) > 0) {
    const posts = await admin
      .firestore()
      .collection(`tenants/${tenantId}/job_postings`)
      .where('jobOrderId', '==', joRef.id)
      .get();
    for (const p of posts.docs) {
      const cur = p.data() as Record<string, unknown>;
      const postPatch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (Number(cur.payRate ?? 0) <= 0) postPatch.payRate = patch.payRate;
      if (cur.awaitingPayRate === true && String(cur.status) === 'draft') {
        postPatch.status = 'active';
        postPatch.awaitingPayRate = FieldValue.delete();
        postPatch.postedAt = FieldValue.serverTimestamp();
      }
      if (Object.keys(postPatch).length > 1) await p.ref.set(postPatch, { merge: true });
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
  // WC backfill — repo chips can be added after the JO existed; fill the
  // gap on any later pass, never overwrite a value already set.
  if (!trim(jo.workersCompCode)) {
    const wc = await resolveWorkersCompForOrder(admin.firestore(), {
      tenantId,
      state: trim((jo.worksiteAddress as Record<string, unknown> | undefined)?.state),
      jobTitle: trim(jo.jobTitle),
      modifierAccountId: trim(jo.parentAccountId) || trim(jo.accountId) || null,
    });
    if (wc) {
      patch.workersCompCode = wc.code;
      patch.workersCompRate = wc.rate;
    }
  }

  const notes = composeFieldglassOrderNotes(enrichment, postingId);
  if (notes !== String(jo.notes ?? '')) patch.notes = notes;
  if (enrichment.candidateInMind === true) {
    patch['fieldglass.candidateInMind'] = true;
    if (enrichment.candidateInMindNote) {
      patch['fieldglass.candidateInMindNote'] = enrichment.candidateInMindNote;
    }
  }

  // ── AI copy upgrade (2026-07-08): email-born orders generated their
  // posting copy from email data alone; regenerate ONCE with the full
  // detail-page enrichment. Guards: only when the current description is
  // still machine-owned (matches the stamped AI copy, the raw client
  // text, or is empty — a recruiter's hand-edit is never clobbered) and
  // only when this order hasn't had its enriched regeneration yet.
  const fg = (jo.fieldglass ?? {}) as Record<string, unknown>;
  const currentDesc = trim(jo.jobDescription);
  const stampedAi = trim(fg.aiJobDescription);
  const machineOwned =
    !currentDesc || currentDesc === stampedAi || currentDesc === trim(jo.jobDescriptionFromClient);
  if (machineOwned && fg.aiCopyEnriched !== true && Object.keys(enrichment).length > 0) {
    try {
      const regenerated = await generateFieldglassPostingCopy(
        buildPostingCopyInput({
          title: trim(jo.jobTitle) || 'Fieldglass Order',
          worksiteAddress: (jo.worksiteAddress ?? {}) as Record<string, string>,
          payRate: Number(patch.payRate ?? jo.payRate ?? 0),
          jobType: jo.jobType === 'gig' ? 'gig' : 'career',
          enrichment,
          description: trim(enrichment.description) || undefined,
          // The raw client text captured at create (email comments or FG
          // description) — richest requirements source we still hold.
          commentsToSupplier: trim(jo.jobDescriptionFromClient) || undefined,
          startIso: trim(jo.startDate) || null,
          endIso: trim(jo.endDate) || null,
        }),
      );
      if (regenerated && regenerated !== currentDesc) {
        patch.jobDescription = regenerated;
        patch['fieldglass.aiJobDescription'] = regenerated;
        patch['fieldglass.aiCopyEnriched'] = true;
        // Linked postings get the upgrade too — same machine-owned guard.
        const posts = await admin
          .firestore()
          .collection(`tenants/${tenantId}/job_postings`)
          .where('jobOrderId', '==', joRef.id)
          .get();
        for (const p of posts.docs) {
          const pDesc = trim((p.data() as Record<string, unknown>).jobDescription);
          if (!pDesc || pDesc === currentDesc || pDesc === stampedAi) {
            await p.ref.set(
              { jobDescription: regenerated, updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            );
          }
        }
        logger.info('[fieldglassJobOrder] AI copy regenerated with enrichment', {
          jobOrderId: joRef.id,
          oldLength: currentDesc.length,
          newLength: regenerated.length,
        });
      } else if (fg.aiCopyEnriched !== true) {
        // Generation failed or produced identical text — don't retry on
        // every re-sync forever; one attempt per enrichment arrival.
        patch['fieldglass.aiCopyEnriched'] = true;
      }
    } catch (err) {
      logger.warn('[fieldglassJobOrder] AI copy regeneration failed (non-fatal)', {
        jobOrderId: joRef.id,
        err: err instanceof Error ? err.message : String(err),
      });
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
    autoUserGroupId?: string | null;
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
    // The JO detail's Jobs Board tab pairs gig postings to positions by
    // positionJobTitle — without it the tab can't see this posting and
    // renders a phantom "Draft" form for the position (and saving that
    // form would duplicate the live posting).
    positionJobTitle: params.title,
    jobDescription: params.jobDescription,
    companyName: 'Sodexo',
    worksiteName: params.worksiteName,
    worksiteAddress: params.worksiteAddress,
    visibility: 'public',
    // A public posting at $0.00/hr is worse than no posting (Greg,
    // 2026-07-10 — FG wages often live in comments prose and miss the
    // parse). No rate → draft, flipped to active automatically by the
    // enrichment pass when the rate arrives.
    status: params.payRate > 0 ? 'active' : 'draft',
    ...(params.payRate > 0 ? {} : { awaitingPayRate: true }),
    payRate: params.payRate,
    showPayRate: true,
    ...(params.startIso ? { startDate: params.startIso } : {}),
    applicationCount: 0,
    restrictedGroups: [],
    // Applicant-feeder field — mirrors createPostFromJobOrder's
    // union-merge of the JO's auto groups onto the posting.
    ...(params.autoUserGroupId ? { autoAddToUserGroups: [params.autoUserGroupId] } : {}),
    createdBy: SYSTEM_ACTOR,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    postedAt: FieldValue.serverTimestamp(),
  });
  return postRef.id;
}

// ─────────────────────────────────────────────────────────────────────
// Halt / resume (FG "Halted" = temporarily suspended, NOT closed)
// ─────────────────────────────────────────────────────────────────────

export interface HaltFieldglassOrderResult {
  status: 'halted' | 'no_job_order' | 'already_terminal';
  jobOrderId?: string;
  postingsPaused: number;
}

/** FG Halted → JO 'on_hold' + postings 'paused'. Reversible — see
 *  resumeFieldglassOrderIfHalted. `fieldglassHalted` marks the JO so the
 *  gig status cron won't flip it back open and resume knows the hold was
 *  ours. Found via the 2026-07-08 audit: SDXOJP00179396 sat Halted in FG
 *  while its HRX posting stayed live. */
export async function haltFieldglassOrder(
  db: admin.firestore.Firestore,
  params: { tenantId: string; requestId: string; reason: string },
): Promise<HaltFieldglassOrderResult> {
  const { tenantId, requestId, reason } = params;
  const joRef = await locateJobOrderForRequest(db, tenantId, requestId);
  if (!joRef) return { status: 'no_job_order', postingsPaused: 0 };
  const joSnap = await joRef.get();
  const joStatus = trim((joSnap.data() as Record<string, unknown>)?.status).toLowerCase();
  if (['cancelled', 'canceled', 'completed', 'filled'].includes(joStatus)) {
    return { status: 'already_terminal', jobOrderId: joRef.id, postingsPaused: 0 };
  }
  await joRef.set(
    {
      status: 'on_hold',
      fieldglassHalted: true,
      fieldglassHaltedReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM_ACTOR,
    },
    { merge: true },
  );
  const postings = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', joRef.id)
    .get();
  let postingsPaused = 0;
  for (const p of postings.docs) {
    if (trim((p.data() as Record<string, unknown>).status).toLowerCase() !== 'active') continue;
    await p.ref.set(
      {
        status: 'paused',
        fieldglassPausedByHalt: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    postingsPaused++;
  }
  logger.info('[fieldglassJobOrder] halted', { tenantId, requestId, jobOrderId: joRef.id, postingsPaused });
  return { status: 'halted', jobOrderId: joRef.id, postingsPaused };
}

/** Undo haltFieldglassOrder once FG shows the posting live again. Only
 *  touches state the halt created (fieldglassHalted / fieldglassPausedByHalt),
 *  so a recruiter's own hold or pause is never overridden. */
export async function resumeFieldglassOrderIfHalted(
  db: admin.firestore.Firestore,
  params: { tenantId: string; requestId: string },
): Promise<boolean> {
  const { tenantId, requestId } = params;
  const joRef = await locateJobOrderForRequest(db, tenantId, requestId);
  if (!joRef) return false;
  const joSnap = await joRef.get();
  const jo = (joSnap.data() ?? {}) as Record<string, unknown>;
  if (jo.fieldglassHalted !== true) return false;
  await joRef.set(
    {
      ...(trim(jo.status).toLowerCase() === 'on_hold' ? { status: 'open' } : {}),
      fieldglassHalted: FieldValue.delete(),
      fieldglassHaltedReason: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM_ACTOR,
    },
    { merge: true },
  );
  const postings = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', joRef.id)
    .get();
  for (const p of postings.docs) {
    const d = p.data() as Record<string, unknown>;
    if (d.fieldglassPausedByHalt !== true) continue;
    await p.ref.set(
      {
        ...(trim(d.status).toLowerCase() === 'paused' ? { status: 'active' } : {}),
        fieldglassPausedByHalt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  logger.info('[fieldglassJobOrder] resumed from halt', { tenantId, requestId, jobOrderId: joRef.id });
  return true;
}

/** Shared JO locator: stamped request.jobOrderId first, poNumber fallback. */
async function locateJobOrderForRequest(
  db: admin.firestore.Firestore,
  tenantId: string,
  requestId: string,
): Promise<FirebaseFirestore.DocumentReference | null> {
  const requestSnap = await db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`).get();
  const request = (requestSnap.data() ?? {}) as Record<string, unknown>;
  const stampedId = trim(request.jobOrderId);
  if (stampedId) {
    const snap = await db.doc(`tenants/${tenantId}/job_orders/${stampedId}`).get();
    if (snap.exists) return snap.ref;
  }
  const postingId =
    trim((request.event as Record<string, unknown> | undefined)?.jobPostingId) ||
    requestId.replace(/^fieldglass__/, '');
  const byPo = await db
    .collection(`tenants/${tenantId}/job_orders`)
    .where('poNumber', '==', postingId)
    .limit(1)
    .get();
  return byPo.empty ? null : byPo.docs[0].ref;
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
