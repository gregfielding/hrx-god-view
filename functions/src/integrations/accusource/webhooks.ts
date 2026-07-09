import { createHash } from 'crypto';
import type { Request } from 'express';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { buildAccusourceApplicantPortalLink, getAccusourceConfig } from './config';
import { accusourceLog, serializeErrorForLog } from './accusourceLogger';
import type { BackgroundCheckDocument, BackgroundCheckEventDocument, HrxBackgroundCheckStatus } from './types';
import {
  computeServiceLineKey,
  extractServiceLinePatch,
  extractServiceLinePayloads,
  mergeServiceLineDocument,
} from './accusourceWebhookServiceLine';

/** True when a stored `order:*` line was created for a drug / Lab workflow. */
function isExistingDrugOrderLineRow(
  row: Record<string, unknown> | undefined,
): boolean {
  if (!row) return false;
  return (
    row.labName != null ||
    row.providerRegistrationId != null ||
    (typeof row.serviceName === 'string' && row.serviceName.toLowerCase().includes('drug'))
  );
}

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Raw webhook bodies persisted before processing (dead-letter / replay safety). */
const ACCUSOURCE_WEBHOOK_RAW_INTAKE = 'integrations_accusource_webhook_raw_intake';

type WebhookStatusProjection = {
  hrxStatus?: HrxBackgroundCheckStatus;
  finalReportReady?: boolean;
  drugReportReady?: boolean;
  profileCompleted?: boolean;
  orderCompleted?: boolean;
  providerStatus: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickStringLocal(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}

function extractTopLevelReportUrl(payload: Record<string, unknown>): string | null {
  const here = pickStringLocal(payload, [
    'report_url',
    'reportUrl',
    'report_link',
    'reportLink',
    'report_pdf_url',
    'reportPdfUrl',
    'final_report_url',
    'finalReportUrl',
    'profile_report_url',
    'profileReportUrl',
    'download_url',
    'downloadUrl',
  ]);
  if (here) return here;
  const data = payload.data;
  if (data && typeof data === 'object') {
    return pickStringLocal(data as Record<string, unknown>, [
      'report_url',
      'reportUrl',
      'report_link',
      'reportLink',
      'report_pdf_url',
      'reportPdfUrl',
      'final_report_url',
      'finalReportUrl',
    ]);
  }
  return null;
}

function extractTopLevelDecision(payload: Record<string, unknown>): string | null {
  const here = pickStringLocal(payload, [
    'decision',
    'decisionSource',
    'decision_source',
    'disposition',
    'adjudication',
    'adjudication_status',
    'adjudicationStatus',
    'outcome',
    'final_result',
    'finalResult',
    'eligibility',
    'eligibility_status',
  ]);
  if (here) return here;
  const data = payload.data;
  if (data && typeof data === 'object') {
    return pickStringLocal(data as Record<string, unknown>, [
      'decision',
      'disposition',
      'adjudication',
      'outcome',
      'final_result',
      'finalResult',
    ]);
  }
  return null;
}

/**
 * SourceDirect webhooks often send `{ type, payload: { profile_id, client_id, ... } }`.
 * Merge nested `payload` / `data` so extractors see profile_id at top level.
 */
function mergeWebhookPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const inner = toRecord(raw.payload);
  const data = toRecord(raw.data);
  return { ...inner, ...data, ...raw };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',');
  return `{${body}}`;
}

function extractEventType(payload: Record<string, unknown>): string {
  const data = toRecord(payload.data);
  const candidate =
    payload.eventType ||
    payload.event ||
    payload.type ||
    data.eventType ||
    data.event ||
    data.type;
  let normalized = String(candidate || 'unknown').trim() || 'unknown';
  if (normalized.toLowerCase() === 'unknown') {
    const lab =
      (typeof payload.lab === 'string' && String(payload.lab).trim() !== '') ||
      (typeof data.lab === 'string' && String(data.lab).trim() !== '');
    const reg =
      payload.reg_id != null ||
      payload.regId != null ||
      payload.registrationId != null ||
      data.reg_id != null ||
      data.regId != null ||
      data.registrationId != null;
    if (lab && reg) {
      return 'drug_collection_update';
    }
  }
  if (normalized.toLowerCase() === PARTIAL_PROFILE_LINK_TYPE) {
    return PARTIAL_PROFILE_LINK_TYPE;
  }
  return normalized;
}

function extractProviderProfileId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const profile =
    payload.providerProfileId ||
    payload.profileId ||
    payload.profile_id ||
    payload.applicantId ||
    data.providerProfileId ||
    data.profileId ||
    data.profile_id ||
    data.applicantId;
  const value = profile != null && profile !== '' ? String(profile).trim() : '';
  return value || null;
}

function extractClientId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const clientId = payload.clientId || payload.client_id || payload.referenceId || data.clientId || data.client_id || data.referenceId;
  const value = String(clientId || '').trim();
  return value || null;
}

function extractProviderEventId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const eventId = payload.eventId || payload.id || payload.webhookId || payload.webhook_id || data.eventId || data.id || data.webhookId || data.webhook_id;
  const value = String(eventId || '').trim();
  return value || null;
}

/** AccuSource event type for partial-profile invite link webhooks. */
const PARTIAL_PROFILE_LINK_TYPE = 'partial_profile_link';

function isPartialProfileLinkEventType(eventType: string): boolean {
  const e = eventType.toLowerCase();
  return e === PARTIAL_PROFILE_LINK_TYPE || e.includes(PARTIAL_PROFILE_LINK_TYPE);
}

function extractPartialProfileToken(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const raw =
    payload.partial_profile_link ??
    payload.partialProfileLink ??
    data.partial_profile_link ??
    data.partialProfileLink;
  const value = raw != null && raw !== '' ? String(raw).trim() : '';
  return value || null;
}

function extractOrderId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const order =
    payload.orderId ||
    payload.order_id ||
    payload.providerOrderId ||
    payload.provider_order_id ||
    data.orderId ||
    data.order_id ||
    data.providerOrderId ||
    data.provider_order_id;
  const value = order != null && order !== '' ? String(order).trim() : '';
  return value || null;
}

function buildDeterministicEventId(payload: Record<string, unknown>): string {
  const eventType = extractEventType(payload);
  const providerProfileId = extractProviderProfileId(payload) || '';
  const clientId = extractClientId(payload) || '';
  const providerEventId = extractProviderEventId(payload) || '';
  const fingerprint = `${eventType}|${providerProfileId}|${clientId}|${providerEventId}|${stableStringify(payload)}`;
  return createHash('sha256').update(fingerprint).digest('hex');
}

function stripUndefinedForFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripUndefinedForFirestore(v));
  // Only rebuild plain objects: recursing into class instances (Timestamp,
  // FieldValue sentinels, Date…) collapses them to {} / plain maps.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) o[k] = stripUndefinedForFirestore(v);
  }
  return o;
}

type WebhookBatchItemSummary = {
  eventType: string;
  normalizedPayloadKeys: string[];
  providerProfileId: string | null;
  providerClientId: string | null;
  providerEventId: string | null;
  orderId: string | null;
  partialProfileTokenPresent: boolean;
};

function summarizeWebhookPayloadItem(payloadInput: unknown): WebhookBatchItemSummary {
  const raw = toRecord(payloadInput);
  const merged = mergeWebhookPayload(raw);
  return {
    eventType: extractEventType(merged),
    normalizedPayloadKeys: Object.keys(merged).sort(),
    providerProfileId: extractProviderProfileId(merged),
    providerClientId: extractClientId(merged),
    providerEventId: extractProviderEventId(merged),
    orderId: extractOrderId(merged),
    partialProfileTokenPresent: Boolean(extractPartialProfileToken(merged)),
  };
}

async function persistPreBatchRawIntake(payloads: unknown[]): Promise<void> {
  for (let i = 0; i < payloads.length; i++) {
    const rawInput = payloads[i];
    const raw = toRecord(rawInput);
    const merged = mergeWebhookPayload(raw);
    const eventId = buildDeterministicEventId(merged);
    const ref = db.collection(ACCUSOURCE_WEBHOOK_RAW_INTAKE).doc(eventId);
    const rawPayload = stripUndefinedForFirestore(
      rawInput !== null && typeof rawInput === 'object' ? rawInput : { _scalar: rawInput },
    );
    await ref.set(
      {
        eventId,
        batchIndex: i,
        batchSize: payloads.length,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        intakeKind: 'pre_batch',
        rawPayload,
      },
      { merge: true },
    );
  }
}

function mapWebhookToStatusProjection(eventType: string, payload: Record<string, unknown>): WebhookStatusProjection {
  const event = eventType.toLowerCase();
  const data = toRecord(payload.data);
  const providerStatusRaw = payload.status || data.status || eventType;
  const providerStatus = String(providerStatusRaw || eventType || 'unknown');
  const status: WebhookStatusProjection = { providerStatus };

  if (event === PARTIAL_PROFILE_LINK_TYPE || event.includes(PARTIAL_PROFILE_LINK_TYPE)) {
    status.hrxStatus = 'awaiting_applicant';
    return status;
  }

  // Per-service updates: do not promote to overall hrxStatus from inner "Completed" alone.
  if (event === 'service_status_change' || event.includes('service_status_change')) {
    return status;
  }

  if (event.includes('awaiting') || event.includes('applicant') || event.includes('invite')) {
    status.hrxStatus = 'awaiting_applicant';
  } else if (event.includes('submitted') || event.includes('created')) {
    status.hrxStatus = 'submitted';
  } else if (event.includes('in_progress') || event.includes('processing') || event.includes('review')) {
    status.hrxStatus = 'in_progress';
  } else if (event.includes('drug_report_ready')) {
    status.hrxStatus = 'drug_report_ready';
    status.drugReportReady = true;
  } else if (event.includes('final_report_ready') || event.includes('report_ready')) {
    status.hrxStatus = 'report_ready';
    status.finalReportReady = true;
  } else if (event.includes('completed') || event.includes('clear') || event.includes('closed')) {
    status.hrxStatus = 'completed';
    status.orderCompleted = true;
  } else if (event.includes('cancel') || event.includes('void')) {
    status.hrxStatus = 'canceled';
  } else if (event.includes('error') || event.includes('fail') || event.includes('reject')) {
    status.hrxStatus = 'error';
  }

  const profileCompleted = payload.profileCompleted ?? data.profileCompleted;
  if (typeof profileCompleted === 'boolean') {
    status.profileCompleted = profileCompleted;
  } else if (event.includes('profile_completed')) {
    status.profileCompleted = true;
  }

  return status;
}

async function findBackgroundCheckMatch(
  providerProfileId: string | null,
  clientId: string | null,
): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  try {
    if (providerProfileId) {
      const byProfile = await db
        .collectionGroup('backgroundChecks')
        .where('providerProfileId', '==', providerProfileId)
        .limit(1)
        .get();
      if (!byProfile.empty) return byProfile.docs[0];
    }

    if (clientId) {
      const byProviderClientId = await db
        .collectionGroup('backgroundChecks')
        .where('providerClientId', '==', clientId)
        .limit(1)
        .get();
      if (!byProviderClientId.empty) return byProviderClientId.docs[0];

      const byClientId = await db
        .collectionGroup('backgroundChecks')
        .where('clientId', '==', clientId)
        .limit(1)
        .get();
      if (!byClientId.empty) return byClientId.docs[0];
    }

    return null;
  } catch (err: unknown) {
    const meta = serializeErrorForLog(err);
    accusourceLog('error', 'webhook', 'findBackgroundCheckMatch failed (collectionGroup backgroundChecks)', {
      ...meta,
      providerProfileId,
      clientId,
      collectionGroupHint:
        'Deploy firestore indexes with queryScope COLLECTION_GROUP on providerProfileId, providerClientId, clientId.',
    });
    throw err;
  }
}

/**
 * Merge per-service webhook payloads into `providerServiceOrderStatus` + `lastServiceComponent`.
 * Handles `service_status_change` (flat) and `order_status_change` when payload includes `services[]` (or aliases).
 */
function applyServiceLineUpdatesFromPayload(
  mergedPayload: Record<string, unknown>,
  eventType: string,
  parentUpdate: Record<string, unknown>,
  matched: admin.firestore.QueryDocumentSnapshot,
): void {
  const et = eventType.toLowerCase();
  const payloadLooksLikeDrugPing =
    typeof mergedPayload.lab === 'string' &&
    (mergedPayload.reg_id != null ||
      mergedPayload.regId != null ||
      mergedPayload.orderId != null ||
      mergedPayload.order_id != null);

  const isServiceTopic =
    et === 'service_status_change' ||
    et.includes('service_status') ||
    et === 'order_status_change' ||
    et.includes('order_status') ||
    et === 'drug_collection_update' ||
    et === 'report_ready' ||
    et === 'final_report_ready' ||
    et === 'profile_completed' ||
    et === 'adjudication_complete' ||
    et.includes('report_ready') ||
    et.includes('final_report') ||
    et.includes('profile_completed') ||
    et.includes('adjudication') ||
    payloadLooksLikeDrugPing;

  if (!isServiceTopic) return;

  const linePayloads = extractServiceLinePayloads(mergedPayload);
  if (linePayloads.length === 0) return;

  const existingRoot = matched.data() as Record<string, unknown>;
  const existingMap =
    (existingRoot.providerServiceOrderStatus as Record<string, Record<string, unknown>> | undefined) ?? {};
  const receiveNow = admin.firestore.FieldValue.serverTimestamp();

  const lineAcc: Record<string, Record<string, unknown>> = { ...existingMap };
  const touchedKeys = new Set<string>();

  for (const linePayload of linePayloads) {
    const key = computeServiceLineKey(linePayload);

    // Persist ALL order-level events (including bare `order_status_change` without a
    // matching `service_status_change`). Services like per-county criminal searches only
    // report via order_status_change — we were previously dropping them here. Named services
    // still get their canonical `<service_id>` row; duplicate `order:<id>` rows are collapsed
    // at display time by `accusourceScreeningLineItems` via status + timestamp proximity.
    //
    // The old filter was:
    //   if (key.startsWith('order:')) {
    //     const isDrugLab = ...; const followUpDrug = ...;
    //     if (!isDrugLab && !followUpDrug) continue;
    //   }
    // Drug-lab rows still flow through this same path; the dedup in the UI preserves them
    // because they have labName / labCode fields that the named service rows don't.

    const patch = extractServiceLinePatch(linePayload);
    const prev = lineAcc[key] ?? null;
    lineAcc[key] = mergeServiceLineDocument(prev, patch, receiveNow);
    touchedKeys.add(key);
  }

  // Firebase Admin SDK's set({ merge: true }) does NOT interpret dot-notation keys as nested
  // paths — it stores them as literal field names with dots. Assign a nested object so
  // deep-merge works correctly. If nothing changed, skip so we don't needlessly re-write the map.
  if (touchedKeys.size > 0) {
    parentUpdate.providerServiceOrderStatus = lineAcc;
  }

  const lastPayload = linePayloads[linePayloads.length - 1]!;
  const lastKey = computeServiceLineKey(lastPayload);
  const lastDoc = lineAcc[lastKey];
  if (lastDoc) {
    parentUpdate.lastServiceComponent = {
      serviceId: lastKey,
      serviceName: lastDoc.serviceName ?? null,
      status: lastDoc.status ?? null,
      statusId: lastDoc.statusId ?? null,
      updatedAt: lastDoc.updatedAt ?? receiveNow,
      jurisdiction: lastDoc.jurisdiction ?? null,
    };
    const name = String(lastDoc.serviceName ?? '');
    const st = String(lastDoc.status ?? '');
    const line = name && st ? `${name}: ${st}` : st || name;
    if (line) parentUpdate.providerStatus = line;
  }
}

async function processWebhookPayload(payloadInput: unknown): Promise<{ id: string; duplicate: boolean; matched: boolean }> {
  const raw = toRecord(payloadInput);
  const payload = mergeWebhookPayload(raw);
  const eventType = extractEventType(payload);
  const providerProfileId = extractProviderProfileId(payload);
  const clientId = extractClientId(payload);
  const eventId = buildDeterministicEventId(payload);

  const intakeRef = db.collection('integrations_accusource_webhook_events').doc(eventId);
  const intakeBase: BackgroundCheckEventDocument & Record<string, unknown> = {
    id: eventId,
    type: eventType,
    source: 'accusource_webhook',
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: 'received',
    providerProfileId,
    providerClientId: clientId,
    payload,
    processingError: null,
  };

  try {
    await intakeRef.create(intakeBase);
  } catch (error: any) {
    const code = error?.code;
    if (code === 6 || code === 'already-exists') {
      accusourceLog('info', 'webhook', 'duplicate event skipped', { eventId, eventType, providerProfileId, clientId });
      return { id: eventId, duplicate: true, matched: false };
    }
    throw error;
  }

  const matchedBackgroundCheck = await findBackgroundCheckMatch(providerProfileId, clientId);
  if (!matchedBackgroundCheck) {
    const processingErr = isPartialProfileLinkEventType(eventType)
      ? 'no_background_check_match_for_partial_profile_link'
      : 'no_background_check_match';
    await intakeRef.set({
      processingStatus: 'ignored',
      processingError: processingErr,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (isPartialProfileLinkEventType(eventType)) {
      accusourceLog('warn', 'webhook', 'no_background_check_match_for_partial_profile_link', {
        eventId,
        eventType,
        extractedProfileId: providerProfileId,
        clientId,
        tokenPresent: Boolean(extractPartialProfileToken(payload)),
      });
    } else {
      accusourceLog('warn', 'webhook', 'unmatched event (no backgroundChecks doc)', {
        eventId,
        eventType,
        providerProfileId,
        clientId,
      });
    }
    return { id: eventId, duplicate: false, matched: false };
  }

  const statusProjection = mapWebhookToStatusProjection(eventType, payload);
  const parentUpdate: Record<string, unknown> = {
    lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
    lastWebhookType: eventType,
    providerStatus: statusProjection.providerStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  applyServiceLineUpdatesFromPayload(payload, eventType, parentUpdate, matchedBackgroundCheck);

  const topLevelReportUrl = extractTopLevelReportUrl(payload);
  if (topLevelReportUrl) {
    parentUpdate.providerFinalReportUrl = topLevelReportUrl;
    parentUpdate.providerFinalReportAt = admin.firestore.FieldValue.serverTimestamp();
  }
  const topLevelDecision = extractTopLevelDecision(payload);
  if (topLevelDecision) {
    parentUpdate.providerFinalDecision = topLevelDecision;
    parentUpdate.providerFinalDecisionAt = admin.firestore.FieldValue.serverTimestamp();
  }

  if (isPartialProfileLinkEventType(eventType)) {
    const token = extractPartialProfileToken(payload);
    const bcSnap = matchedBackgroundCheck.data() as BackgroundCheckDocument & Record<string, unknown>;
    const portalEnv = bcSnap.providerEnvironment || getAccusourceConfig().environment;
    if (token) {
      parentUpdate.providerPartialProfileToken = token;
    }
    const portalUrl = buildAccusourceApplicantPortalLink(portalEnv, token ?? '');
    if (portalUrl) {
      parentUpdate.applicantPortalLink = portalUrl;
      parentUpdate.applicantPortalUrl = portalUrl;
    }
    const data = toRecord(payload.data);
    const sid = payload.status_id ?? payload.statusId ?? data.status_id ?? data.statusId;
    if (sid !== undefined && sid !== null && String(sid).trim() !== '') {
      parentUpdate.providerStatusId =
        typeof sid === 'number' ? sid : Number.isFinite(Number(sid)) ? Number(sid) : String(sid);
    }
    const ps = payload.status ?? data.status;
    if (ps != null && String(ps).trim() !== '') {
      parentUpdate.providerStatus = String(ps);
    }
    if (!token) {
      accusourceLog('warn', 'webhook', 'partial_profile_link webhook missing token', {
        eventId,
        profileIdForMatch: providerProfileId,
        matchedPath: matchedBackgroundCheck.ref.path,
      });
    }
  }

  if (statusProjection.hrxStatus) parentUpdate.hrxStatus = statusProjection.hrxStatus;
  if (statusProjection.finalReportReady !== undefined) parentUpdate.finalReportReady = statusProjection.finalReportReady;
  if (statusProjection.drugReportReady !== undefined) parentUpdate.drugReportReady = statusProjection.drugReportReady;
  if (statusProjection.profileCompleted !== undefined) parentUpdate.profileCompleted = statusProjection.profileCompleted;
  if (statusProjection.orderCompleted !== undefined) parentUpdate.orderCompleted = statusProjection.orderCompleted;
  if (providerProfileId) parentUpdate.providerProfileId = providerProfileId;
  if (clientId) parentUpdate.providerClientId = clientId;

  await matchedBackgroundCheck.ref.set(parentUpdate, { merge: true });
  await matchedBackgroundCheck.ref.collection('events').doc(eventId).set({
    ...intakeBase,
    processingStatus: 'processed',
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await intakeRef.set({
    processingStatus: 'processed',
    processingError: null,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    matchedBackgroundCheckPath: matchedBackgroundCheck.ref.path,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  accusourceLog(
    'info',
    'webhook',
    isPartialProfileLinkEventType(eventType)
      ? 'partial_profile_link matched and persisted'
      : 'event matched and applied to backgroundChecks doc',
    {
      eventId,
      eventType,
      providerProfileId,
      clientId,
      backgroundCheckPath: matchedBackgroundCheck.ref.path,
      hrxStatus: statusProjection.hrxStatus || null,
      ...(isPartialProfileLinkEventType(eventType)
        ? {
            tokenPresent: Boolean(extractPartialProfileToken(payload)),
          }
        : {}),
    },
  );

  return { id: eventId, duplicate: false, matched: true };
}

type WebhookHttpRequestKind = 'validation_get' | 'webhook_post' | 'cors_preflight' | 'unsupported_method';

function logWebhookHttpRequest(request: Request, requestKind: WebhookHttpRequestKind): void {
  accusourceLog('info', 'webhook', 'HTTP request', {
    requestKind,
    httpMethod: request.method,
    path: request.path ?? '',
    url: request.url ?? '',
    query: request.query as Record<string, unknown>,
  });
}

/**
 * Phase 1 webhook intake endpoint.
 * POST /api/integrations/accusource/webhooks — webhook payloads.
 * GET — 200 JSON for dashboard URL validation (AccuSource "Test").
 */
export const apiIntegrationsAccusourceWebhooks = onRequest(
  {
    cors: true,
    invoker: 'public',
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      logWebhookHttpRequest(request, 'cors_preflight');
      response.status(204).send('');
      return;
    }

    if (request.method === 'GET') {
      logWebhookHttpRequest(request, 'validation_get');
      const config = getAccusourceConfig();
      response.status(200).json({
        ok: true,
        service: 'accusource-webhooks',
        purpose: 'validation',
        integrationEnabled: config.enabled,
      });
      return;
    }

    if (request.method !== 'POST') {
      logWebhookHttpRequest(request, 'unsupported_method');
      response.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    logWebhookHttpRequest(request, 'webhook_post');

    const config = getAccusourceConfig();
    if (!config.enabled) {
      response.status(503).json({ error: 'AccuSource integration disabled' });
      return;
    }

    try {
      const payloads = Array.isArray(request.body) ? request.body : [request.body];
      const batchPreview = payloads.map(summarizeWebhookPayloadItem);
      accusourceLog('info', 'webhook', 'HTTP webhook batch preview', {
        batchSize: payloads.length,
        items: batchPreview,
      });

      await persistPreBatchRawIntake(payloads);
      accusourceLog('info', 'webhook', 'HTTP webhook pre-batch raw intake persisted', {
        payloadCount: payloads.length,
      });
      accusourceLog('info', 'webhook', 'HTTP webhook batch received', { payloadCount: payloads.length });

      const results: Array<{ id: string; duplicate: boolean; matched: boolean }> = [];

      for (const payload of payloads) {
        const result = await processWebhookPayload(payload);
        results.push(result);
      }

      response.status(200).json({
        ok: true,
        received: payloads.length,
        processed: results.filter((r) => !r.duplicate).length,
        duplicates: results.filter((r) => r.duplicate).length,
        matched: results.filter((r) => r.matched).length,
      });
    } catch (error: unknown) {
      const safeMeta = serializeErrorForLog(error);
      try {
        accusourceLog('error', 'webhook', 'fatal error processing batch', safeMeta);
      } catch {
        // accusourceLog should not throw; extra guard
      }
      console.error('[AccuSource][webhook] fatal error processing batch (raw)', error);
      response.status(500).json({ ok: false, error: 'internal_error' });
    }
  },
);

/** Exposed for unit tests (payload merge, partial_profile_link extractors). */
export const accusourceWebhookForTests = {
  mergeWebhookPayload,
  extractEventType,
  extractPartialProfileToken,
  isPartialProfileLinkEventType,
  PARTIAL_PROFILE_LINK_TYPE,
};

