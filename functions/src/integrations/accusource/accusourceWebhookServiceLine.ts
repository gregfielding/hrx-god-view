/**
 * Extract and merge AccuSource webhook fields into `providerServiceOrderStatus.{serviceKey}` lines.
 * Field names are permissive (snake_case + camelCase) because SourceDirect payloads vary by topic/version.
 */
import * as admin from 'firebase-admin';
import {
  applyAutoVerdictToAdjudication,
  classifyAutoVerdict,
  type AccusourceLineAdjudication,
} from './accusourceAdjudication';

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** True when the payload is a lab (drug-screen) registration/status ping rather than a catalog service. */
export function isDrugLabPayload(rec: Record<string, unknown>): boolean {
  const hasLab = typeof rec.lab === 'string' && String(rec.lab).trim() !== '';
  const hasRegId = rec.reg_id != null || rec.regId != null || rec.registrationId != null;
  const hasOrderId = rec.orderId != null || rec.order_id != null;
  return (hasLab && hasRegId) || (hasLab && hasOrderId);
}

/** True when the payload has an order-level identifier (but no service identifier). */
export function hasOrderIdOnly(rec: Record<string, unknown>): boolean {
  const orderIdish = rec.order_id ?? rec.orderId;
  const serviceIdish = rec.service_id ?? rec.serviceId ?? rec.service_name ?? rec.serviceName;
  return orderIdish != null && serviceIdish == null;
}

/** Parse webhook date values into Firestore Timestamps (ISO strings, unix seconds/ms, or nested _seconds). */
export function coerceWebhookTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (value == null || value === '') return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    const s = (value as { _seconds?: number })._seconds;
    const ns = (value as { _nanoseconds?: number })._nanoseconds ?? 0;
    if (typeof s === 'number' && Number.isFinite(s)) {
      return new admin.firestore.Timestamp(s, typeof ns === 'number' && ns >= 0 ? ns : 0);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 2e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
  }
  if (typeof value === 'string') {
    const t = Date.parse(value.trim());
    if (!Number.isNaN(t)) return admin.firestore.Timestamp.fromMillis(t);
  }
  return null;
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}

function pickNumber(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = rec[k];
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickTimestamp(rec: Record<string, unknown>, keys: string[]): admin.firestore.Timestamp | null {
  for (const k of keys) {
    const ts = coerceWebhookTimestamp(rec[k]);
    if (ts) return ts;
  }
  return null;
}

/** County / venue / search scope text (vendor dashboard “Orange, US-FL”). */
function extractJurisdiction(rec: Record<string, unknown>): string | null {
  const direct = pickString(rec, [
    'jurisdiction',
    'search_jurisdiction',
    'county_jurisdiction',
    'county_state',
    'countyState',
    'venue',
    'service_location',
    'serviceLocation',
    'location_description',
    'locationDescription',
    'search_location',
    'searchLocation',
    'criminal_jurisdiction',
    'criminalJurisdiction',
    'crim_location',
    'additional_information',
    'additionalInformation',
  ]);
  if (direct) return direct;

  const loc = rec.location ?? rec.serviceLocationDetail ?? rec.service_location_detail;
  if (loc && typeof loc === 'object') {
    const o = loc as Record<string, unknown>;
    const county = pickString(o, ['county', 'County']);
    const state = pickString(o, ['state', 'state_code', 'stateCode', 'region']);
    const country = pickString(o, ['country', 'country_code', 'countryCode']);
    const parts = [county, state, country].filter(Boolean) as string[];
    if (parts.length > 0) return parts.join(', ');
  }
  return null;
}

/**
 * Report artifact URL for a service/order. Hunts across common field names
 * vendors use (direct fields, nested `report`/`document` objects).
 */
function extractReportUrl(rec: Record<string, unknown>): string | null {
  const direct = pickString(rec, [
    'report_url',
    'reportUrl',
    'report_link',
    'reportLink',
    'report_href',
    'reportHref',
    'report_pdf_url',
    'reportPdfUrl',
    'pdf_url',
    'pdfUrl',
    'document_url',
    'documentUrl',
    'artifact_url',
    'artifactUrl',
    'download_url',
    'downloadUrl',
    'results_url',
    'resultsUrl',
    'final_report_url',
    'finalReportUrl',
    'view_report_url',
    'viewReportUrl',
  ]);
  if (direct) return direct;

  const nested = [rec.report, rec.Report, rec.document, rec.final_report, rec.finalReport];
  for (const n of nested) {
    if (n && typeof n === 'object') {
      const s = pickString(n as Record<string, unknown>, [
        'url',
        'link',
        'href',
        'pdfUrl',
        'pdf_url',
        'downloadUrl',
        'download_url',
      ]);
      if (s) return s;
    }
  }
  return null;
}

/**
 * Adjudication / decision value when the vendor has made a call.
 * Returns null when the webhook only carries status, not an outcome.
 */
function extractDecision(rec: Record<string, unknown>): string | null {
  const v = pickString(rec, [
    'decision',
    'decision_source',
    'decisionSource',
    'disposition',
    'adjudication',
    'adjudication_status',
    'adjudicationStatus',
    'outcome',
    'result',
    'final_result',
    'finalResult',
    'eligibility',
    'eligibility_status',
    'eligibilityStatus',
    'candidate_status',
    'candidateStatus',
  ]);
  if (v) return v;

  const nested = [rec.decision, rec.adjudication, rec.result];
  for (const n of nested) {
    if (n && typeof n === 'object') {
      const s = pickString(n as Record<string, unknown>, ['value', 'status', 'label', 'source']);
      if (s) return s;
    }
  }
  return null;
}

/** Optional formatted price from vendor (“$4.73”). */
function extractPriceFormatted(rec: Record<string, unknown>): string | null {
  return pickString(rec, ['price_formatted', 'priceFormatted', 'formatted_price', 'formattedPrice', 'display_price']);
}

/**
 * Numeric price when vendor sends a number (or parseable string without destroying formatted display).
 */
function extractPriceAmount(rec: Record<string, unknown>): number | null {
  const n = pickNumber(rec, [
    'price',
    'amount',
    'cost',
    'fee',
    'service_price',
    'servicePrice',
    'line_price',
    'linePrice',
    'line_amount',
    'lineAmount',
    'total_price',
    'totalPrice',
    'client_price',
    'clientPrice',
    'billing_amount',
    'billingAmount',
  ]);
  return n;
}

function extractAssignment(rec: Record<string, unknown>): string | null {
  return pickString(rec, [
    'assignment',
    'assignment_name',
    'assignmentName',
    'researcher',
    'researcher_name',
    'researcherName',
    'assigned_to',
    'assignedTo',
    'vendor_assignment',
    'vendorAssignment',
  ]);
}

export type ServiceLinePatch = {
  serviceId?: unknown;
  serviceName: string | null;
  status: string | null;
  statusId?: unknown;
  /** Drug-screen / lab registration extras (optional). */
  providerOrderId?: unknown;
  providerRegistrationId?: unknown;
  labName?: string | null;
  labCode?: number | null;
  labShortDescription?: string | null;
  labLongDescription?: string | null;
  /** Link to the completed report artifact (PDF/HTML) if the webhook provides one. */
  reportUrl?: string | null;
  /** Adjudication decision / disposition when the vendor has called it. */
  decision?: string | null;
  /** When the decision was set (best-effort from webhook). */
  decisionAt?: admin.firestore.Timestamp | null;
  providerPrice?: number | null;
  providerPriceFormatted?: string | null;
  jurisdiction?: string | null;
  assignmentLabel?: string | null;
  orderedAt?: admin.firestore.Timestamp | null;
  submittedAt?: admin.firestore.Timestamp | null;
  startedAt?: admin.firestore.Timestamp | null;
  completedAt?: admin.firestore.Timestamp | null;
  receivedAt?: admin.firestore.Timestamp | null;
  reviewedAt?: admin.firestore.Timestamp | null;
  /** Vendor-provided “updated” time when present (else we keep server `updatedAt`). */
  providerReportedAt?: admin.firestore.Timestamp | null;
};

export function extractServiceLinePatch(payload: Record<string, unknown>): ServiceLinePatch {
  const jurisdiction = extractJurisdiction(payload);
  const providerPrice = extractPriceAmount(payload);
  const providerPriceFormatted = extractPriceFormatted(payload);
  const assignmentLabel = extractAssignment(payload);

  const explicitName = pickString(payload, [
    'service_name',
    'serviceName',
    'name',
    'service_title',
    'serviceTitle',
  ]);
  const labName = pickString(payload, ['lab', 'lab_name', 'labName']);
  const orderIdForLabel = payload.order_id ?? payload.orderId;
  const serviceName =
    explicitName ??
    (labName ? `${labName} Drug Screen` : null) ??
    (orderIdForLabel != null ? `Order ${String(orderIdForLabel).trim()}` : null);

  const explicitStatus = pickString(payload, ['status', 'service_status', 'serviceStatus', 'state']);
  const labShort = pickString(payload, ['short', 'short_description', 'shortDescription']);
  const looksLikeLabPing =
    typeof payload.lab === 'string' &&
    typeof payload.status === 'string' &&
    String(payload.status).toLowerCase() === 'success' &&
    typeof payload.short === 'string';
  const status = looksLikeLabPing ? (labShort ?? explicitStatus) : (explicitStatus ?? labShort);

  const reportUrl = extractReportUrl(payload);
  const decision = extractDecision(payload);
  const decisionAt = pickTimestamp(payload, [
    'decision_at',
    'decisionAt',
    'adjudicated_at',
    'adjudicatedAt',
    'decision_date',
    'decisionDate',
  ]);

  return {
    serviceId: payload.service_id ?? payload.serviceId,
    serviceName,
    status,
    statusId: payload.status_id ?? payload.statusId,
    providerOrderId: (payload.order_id ?? payload.orderId) ?? null,
    providerRegistrationId: (payload.reg_id ?? payload.regId ?? payload.registrationId) ?? null,
    labName: pickString(payload, ['lab', 'lab_name', 'labName']),
    labCode: pickNumber(payload, ['code']),
    labShortDescription: pickString(payload, ['short', 'short_description', 'shortDescription']),
    labLongDescription: pickString(payload, ['long', 'long_description', 'longDescription']),
    reportUrl,
    decision,
    decisionAt,
    providerPrice: providerPrice != null ? providerPrice : null,
    providerPriceFormatted: providerPriceFormatted != null ? providerPriceFormatted : null,
    jurisdiction: jurisdiction ?? null,
    assignmentLabel: assignmentLabel ?? null,
    orderedAt: pickTimestamp(payload, ['ordered_at', 'orderedAt', 'order_date', 'orderDate', 'date_ordered', 'dateOrdered', 'created_at', 'createdAt']),
    submittedAt: pickTimestamp(payload, ['submitted_at', 'submittedAt', 'date_submitted', 'dateSubmitted']),
    startedAt: pickTimestamp(payload, ['started_at', 'startedAt', 'date_started', 'dateStarted', 'initiated_at', 'initiatedAt']),
    completedAt: pickTimestamp(payload, [
      'completed_at',
      'completedAt',
      'completion_date',
      'completionDate',
      'date_completed',
      'dateCompleted',
      'finished_at',
      'finishedAt',
    ]),
    receivedAt: pickTimestamp(payload, ['received_at', 'receivedAt', 'date_received', 'dateReceived']),
    reviewedAt: pickTimestamp(payload, ['reviewed_at', 'reviewedAt', 'review_date', 'reviewDate', 'in_review_at', 'inReviewAt']),
    providerReportedAt: pickTimestamp(payload, ['updated_at', 'updatedAt', 'last_updated', 'lastUpdated', 'modified_at', 'modifiedAt']),
  };
}

/**
 * Merge prior Firestore line + new webhook patch. New non-null fields win; we never erase with undefined.
 */
export function mergeServiceLineDocument(
  previous: Record<string, unknown> | null | undefined,
  patch: ServiceLinePatch,
  receiveNow: admin.firestore.FieldValue,
): Record<string, unknown> {
  const prev = previous && typeof previous === 'object' ? { ...previous } : {};
  const out: Record<string, unknown> = { ...prev };

  if (patch.serviceId !== undefined) out.serviceId = patch.serviceId;
  if (patch.serviceName != null) out.serviceName = patch.serviceName;
  if (patch.status != null) out.status = patch.status;
  if (patch.statusId !== undefined) out.statusId = patch.statusId;
  if (patch.providerOrderId !== undefined) out.providerOrderId = patch.providerOrderId;
  if (patch.providerRegistrationId !== undefined) out.providerRegistrationId = patch.providerRegistrationId;
  if (patch.labName != null) out.labName = patch.labName;
  if (patch.labCode != null) out.labCode = patch.labCode;
  if (patch.labShortDescription != null) out.labShortDescription = patch.labShortDescription;
  if (patch.labLongDescription != null) out.labLongDescription = patch.labLongDescription;
  if (patch.reportUrl != null) out.reportUrl = patch.reportUrl;
  if (patch.decision != null) out.decision = patch.decision;
  if (patch.providerPrice != null) out.providerPrice = patch.providerPrice;
  if (patch.providerPriceFormatted != null) out.providerPriceFormatted = patch.providerPriceFormatted;
  if (patch.jurisdiction != null) out.jurisdiction = patch.jurisdiction;
  if (patch.assignmentLabel != null) out.assignmentLabel = patch.assignmentLabel;

  const tsKeys: Array<[keyof ServiceLinePatch, string]> = [
    ['orderedAt', 'orderedAt'],
    ['submittedAt', 'submittedAt'],
    ['startedAt', 'startedAt'],
    ['completedAt', 'completedAt'],
    ['receivedAt', 'receivedAt'],
    ['reviewedAt', 'reviewedAt'],
    ['decisionAt', 'decisionAt'],
    ['providerReportedAt', 'providerReportedAt'],
  ];
  for (const [pk, fk] of tsKeys) {
    const v = patch[pk];
    if (v instanceof admin.firestore.Timestamp) out[fk] = v;
  }

  const reported = patch.providerReportedAt;
  out.updatedAt = reported instanceof admin.firestore.Timestamp ? reported : receiveNow;

  // Re-classify autoVerdict after every merge. We pass status/decision from the
  // merged doc (not the raw patch) so lab rows that inherit fields from a prior
  // webhook still get a stable verdict.
  const mergedStatus = typeof out.status === 'string' ? out.status : null;
  const mergedDecision = typeof out.decision === 'string' ? out.decision : null;
  const serviceNameLower =
    typeof out.serviceName === 'string' ? out.serviceName.toLowerCase() : '';
  const isLabLine =
    out.labName != null ||
    out.providerRegistrationId != null ||
    serviceNameLower.includes('drug');
  // SSN Locator detection — match vendor variants (Social Security Number Trace,
  // SSN Locator, Social Security Locator, etc.). AccuSource's report boilerplate
  // says "The list of possible names and addresses … have been reviewed", which
  // means any real hits spawn separate downstream orders that carry their own
  // verdicts. Bare Completed on this line is a clean pass by design.
  const isSsnLocator =
    !isLabLine &&
    (serviceNameLower.includes('social security locator') ||
      serviceNameLower.includes('ssn locator') ||
      serviceNameLower.includes('social security number trace') ||
      serviceNameLower.includes('ssn trace'));
  const kind: 'lab' | 'ssn_locator' | 'background' = isLabLine
    ? 'lab'
    : isSsnLocator
      ? 'ssn_locator'
      : 'background';
  const autoVerdict = classifyAutoVerdict({ status: mergedStatus, decision: mergedDecision, kind });
  const historyNow = admin.firestore.Timestamp.now();
  const prevAdjudication = out.adjudication as AccusourceLineAdjudication | null | undefined;
  out.adjudication = applyAutoVerdictToAdjudication(prevAdjudication, autoVerdict, historyNow);
  return out;
}

export function computeServiceLineKey(payload: Record<string, unknown>): string {
  const serviceIdRaw = payload.service_id ?? payload.serviceId;
  const sid = serviceIdRaw != null && String(serviceIdRaw).trim() !== '' ? String(serviceIdRaw).trim() : '';
  if (sid) return sid;

  const orderIdRaw = payload.order_id ?? payload.orderId;
  const oid = orderIdRaw != null && String(orderIdRaw).trim() !== '' ? String(orderIdRaw).trim() : '';
  if (oid) return `order:${oid}`;

  const regIdRaw = payload.reg_id ?? payload.regId ?? payload.registrationId;
  const rid = regIdRaw != null && String(regIdRaw).trim() !== '' ? String(regIdRaw).trim() : '';
  if (rid) return `reg:${rid}`;

  const name = String(payload.service_name ?? payload.serviceName ?? '').trim();
  if (name) return `name:${name}`;
  return 'unknown';
}

/**
 * One or more service-level payloads (flat `service_status_change` or batched `order_status_change` with services[]).
 */
export function extractServiceLinePayloads(mergedTopLevel: Record<string, unknown>): Record<string, unknown>[] {
  const data = toRecord(mergedTopLevel.data);
  const arrays = [
    mergedTopLevel.services,
    mergedTopLevel.service_orders,
    mergedTopLevel.serviceOrders,
    mergedTopLevel.order_services,
    mergedTopLevel.orderServices,
    mergedTopLevel.components,
    data.services,
    data.service_orders,
    data.order_services,
    data.components,
  ];

  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      const objs = arr.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
      if (objs.length === arr.length) {
        return objs.map((row) => {
          const base = { ...mergedTopLevel, ...data };
          return { ...base, ...row };
        });
      }
    }
  }

  if (
    mergedTopLevel.service_id ??
    mergedTopLevel.serviceId ??
    mergedTopLevel.service_name ??
    mergedTopLevel.serviceName
  ) {
    return [mergedTopLevel];
  }

  if (data.service_id ?? data.serviceId ?? data.service_name ?? data.serviceName) {
    return [{ ...mergedTopLevel, ...data }];
  }

  if (isDrugLabPayload(mergedTopLevel) || hasOrderIdOnly(mergedTopLevel)) {
    return [mergedTopLevel];
  }

  if (isDrugLabPayload(data) || hasOrderIdOnly(data)) {
    return [{ ...mergedTopLevel, ...data }];
  }

  return [];
}
