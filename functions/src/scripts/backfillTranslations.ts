#!/usr/bin/env node
/**
 * Backfill translations: ensure EN _i18n exists (copy legacy → *_i18n.en), then enqueue
 * one translation task per doc when ES is missing or stale. Uses same production logic
 * (hash checks, manual lock, skip rules). Rate-limited enqueue; idempotent task names.
 *
 * Run from repo root after build:
 *   cd functions && npm run build && node lib/scripts/backfillTranslations.js --dryRun=false --collection=job_postings --limit=10
 *
 * Or with ts-node (from functions dir):
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillTranslations.ts --dryRun=false --collection=all --limit=100
 *
 * Options:
 *   --tenantId=...       Optional. If omitted, run all tenants.
 *   --collection=...     job_postings | job_orders | shifts | crm_companies | crm_locations | all  (default: all)
 *   --limit=100         Max docs to process per collection (optional).
 *   --dryRun=true|false Default true. If false, write EN and enqueue tasks.
 *   --ratePerSec=5      Max enqueues per second (default 5; use 3–5 for safety).
 *   --since=YYYY-MM-DD  Only docs updated on or after this date (optional).
 *   --force=true        Allow enqueue when TRANSLATION_ENABLED !== "true".
 *   --verbose           Per-doc output: discovered i18n fields, missing ES, action; logs enqueue config.
 *   --holdSeconds=N     Schedule each task for now + N seconds (default 0). Use e.g. 120 so tasks show in gcloud tasks list.
 *
 * Only worker-facing fields and taxonomy chips are translated; company names, addresses,
 * and IDs are never translated. Uses existing enqueueTranslationTask and translation discovery.
 * For job_postings: same discovery as triggers/worker; taxonomy arrays (CHIP_ARRAY_FIELDS) are
 * dictionary-based; one task per doc; excludes address/company/worksite/IDs.
 */

import 'dotenv/config';
import { loadEnvForScripts } from './loadEnv';
loadEnvForScripts();

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  getFieldsNeedingTranslation,
  getWorkerFacingJobOrderFieldsNeedingTranslation,
  getJobOrderScalarWorkerFacingFieldsNeedingTranslation,
  getShiftScalarWorkerFacingFieldsNeedingTranslation,
  getCrmCompanyDescriptionFieldsNeedingTranslation,
  discoverI18nFields,
  computeHash,
  CHIP_ARRAY_FIELDS,
  JOB_ORDER_SCALAR_WORKER_FACING_FIELDS,
  SHIFT_SCALAR_WORKER_FACING_FIELDS,
  translateTaxonomyArray,
} from '../translation';
import type { DocumentData, TranslationTaskPayload } from '../translation';
import type { FieldToTranslate } from '../translation/needsTranslation';
import { enqueueTranslationTask, getEnqueueConfig } from '../tasks/enqueueTranslationTask';
import { parseArgs as parseArgsFromModule, getCollectionsToRun, shouldRunJobOrdersEnBackfill } from './backfillTranslationsArgs';

const STAFF_SECTIONS_SOURCE = 'staffInstructions';

const MAX_SOURCE_LENGTH = 8000;

/** job_postings: do NOT translate address, company/worksite names, IDs (worker-facing text and taxonomy only). */
const JOB_POSTING_EXCLUDED_I18N = new Set([
  'worksiteName_i18n',
  'companyName_i18n',
  'worksiteAddress_i18n',
  'location_i18n',
  'address_i18n',
  'id_i18n',
  'postId_i18n',
  'jobId_i18n',
]);

/** Scalar _i18n fields we always consider for job_postings (ensure they are in discovery). */
const JOB_POSTING_PRIORITY_SCALAR_FIELDS = [
  'postTitle_i18n',
  'jobTitle_i18n',
  'jobDescription_i18n',
  'requirements_i18n',
  'payDetails_i18n',
] as const;

function parseArgs() {
  return parseArgsFromModule();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- job_postings: legacy → *_i18n.en
function jobPostingsEnBackfill(data: DocumentData): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const legacyToI18n: Record<string, string> = {
    postTitle: 'postTitle_i18n',
    jobTitle: 'jobTitle_i18n',
    jobDescription: 'jobDescription_i18n',
    requirements: 'requirements_i18n',
    payDetails: 'payDetails_i18n',
  };
  for (const [legacy, i18nKey] of Object.entries(legacyToI18n)) {
    const i18n = data[i18nKey] as { en?: string; es?: string } | undefined;
    if (i18n?.en != null) continue;
    const val = data[legacy];
    if (typeof val !== 'string' || !val.trim()) continue;
    updates[`${i18nKey}.en`] = val.trim();
  }
  return updates;
}

// --- job_orders: staffInstructions.*.text → staffInstructions_i18n.*.en; scalar legacy → field_i18n.en
function jobOrdersEnBackfill(data: DocumentData): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const staff = data[STAFF_SECTIONS_SOURCE] as Record<string, { text?: string }> | undefined;
  const i18n = (data.staffInstructions_i18n ?? {}) as Record<string, { en?: string; es?: string }>;
  if (staff && typeof staff === 'object') {
    for (const section of Object.keys(staff)) {
      const text = staff[section]?.text?.trim();
      if (!text || i18n[section]?.en != null) continue;
      updates[`staffInstructions_i18n.${section}.en`] = text;
    }
  }
  for (const field of JOB_ORDER_SCALAR_WORKER_FACING_FIELDS) {
    const i18nKey = `${field}_i18n`;
    const i18nObj = data[i18nKey] as { en?: string } | undefined;
    if (i18nObj?.en != null) continue;
    const legacy = data[field];
    if (typeof legacy !== 'string' || !legacy.trim()) continue;
    updates[`${i18nKey}.en`] = legacy.trim();
  }
  return updates;
}

// --- shifts: scalar legacy → field_i18n.en
function shiftsEnBackfill(data: DocumentData): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of SHIFT_SCALAR_WORKER_FACING_FIELDS) {
    const i18nKey = `${field}_i18n`;
    const i18nObj = data[i18nKey] as { en?: string } | undefined;
    if (i18nObj?.en != null) continue;
    const legacy = data[field];
    if (typeof legacy !== 'string' || !legacy.trim()) continue;
    updates[`${i18nKey}.en`] = legacy.trim();
  }
  return updates;
}

// --- crm_companies: description → description_i18n.en
function crmCompaniesEnBackfill(data: DocumentData): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const i18n = data.description_i18n as { en?: string } | undefined;
  if (i18n?.en != null) return updates;
  const desc = data.description;
  if (typeof desc !== 'string' || !desc.trim()) return updates;
  updates['description_i18n.en'] = desc.trim();
  return updates;
}

// --- locations: no legacy mapping in spec; only ensure existing _i18n have .en (none to copy)
function locationsEnBackfill(_data: DocumentData): Record<string, unknown> {
  return {};
}

/**
 * Job postings: discover scalar *_i18n with .en and (.es missing or stale).
 * Excludes address/company/worksite/IDs. Same logic as triggers/worker (autoDiscover + hash).
 */
function getJobPostingScalarFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  const manualFields: string[] = (data.translationMeta as { es?: { manualFields?: string[] } } | undefined)?.es?.manualFields ?? [];
  const fieldHashes = (data.translationMeta as { es?: { fieldHashes?: Record<string, string> } } | undefined)?.es?.fieldHashes ?? {};
  const manualSet = new Set(manualFields);
  const discovered = discoverI18nFields(data as Record<string, unknown>, manualFields);
  const allowed = discovered.filter((key) => !JOB_POSTING_EXCLUDED_I18N.has(key));
  const out: FieldToTranslate[] = [];
  for (const field of allowed) {
    const obj = data[field] as { en?: string; es?: string } | undefined;
    const enVal = (obj?.en ?? '').trim();
    if (!enVal) continue;
    const esVal = (obj?.es ?? '').trim();
    const hash = computeHash(enVal);
    const prevHash = fieldHashes[field];
    const esMissing = !esVal;
    const hashChanged = prevHash !== hash;
    if ((esMissing || hashChanged) && !manualSet.has(field)) {
      out.push({ fieldPath: field, sourceText: enVal });
    }
  }
  return out;
}

/**
 * Job postings: taxonomy array fields that have content and need ES (missing or stale).
 * Worker will translate these via tenant taxonomy when the task runs; we only need to enqueue.
 */
function jobPostingTaxonomyArraysNeedingTranslation(data: DocumentData): string[] {
  const fieldHashes = (data.translationMeta as { es?: { fieldHashes?: Record<string, string> } } | undefined)?.es?.fieldHashes ?? {};
  const manualFields = new Set((data.translationMeta as { es?: { manualFields?: string[] } } | undefined)?.es?.manualFields ?? []);
  const out: string[] = [];
  for (const fieldName of CHIP_ARRAY_FIELDS) {
    const i18nKey = `${fieldName}_i18n`;
    if (manualFields.has(i18nKey)) continue;
    const raw = data[fieldName];
    const legacyArray = Array.isArray(raw)
      ? (raw as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => String(s).trim()).filter(Boolean)
      : [];
    const existingI18n = data[i18nKey] as { en?: string[]; es?: string[] } | undefined;
    const enArray = Array.isArray(existingI18n?.en) ? existingI18n.en : legacyArray;
    if (enArray.length === 0) continue;
    const arrayHash = computeHash(JSON.stringify([...enArray].sort()));
    const prevHash = fieldHashes[i18nKey];
    const hasEs = Array.isArray(existingI18n?.es) && existingI18n.es.length > 0;
    if (hasEs && prevHash === arrayHash) continue;
    out.push(fieldName);
  }
  return out;
}

/**
 * Job postings: taxonomy terms that are on the doc but missing ES in the tenant's taxonomy.
 * Used to decide if we should enqueue (only when there is actual missing taxonomy work).
 */
function jobPostingTaxonomyTermsMissingES(
  data: DocumentData,
  taxonomyEs: Record<string, string>
): string[] {
  const manualFields = new Set((data.translationMeta as { es?: { manualFields?: string[] } } | undefined)?.es?.manualFields ?? []);
  const out: string[] = [];
  for (const fieldName of CHIP_ARRAY_FIELDS) {
    const i18nKey = `${fieldName}_i18n`;
    if (manualFields.has(i18nKey)) continue;
    const raw = data[fieldName];
    const legacyArray = Array.isArray(raw)
      ? (raw as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => String(s).trim()).filter(Boolean)
      : [];
    const existingI18n = data[i18nKey] as { en?: string[]; es?: string[] } | undefined;
    const enArray = Array.isArray(existingI18n?.en) ? existingI18n.en : legacyArray;
    if (enArray.length === 0) continue;
    const { missingTerms } = translateTaxonomyArray(enArray, taxonomyEs);
    for (const term of missingTerms) {
      out.push(`${fieldName}:${term}`);
    }
  }
  return out;
}

/** Get fields needing translation for job_postings (legacy path for non–job_postings or fallback). */
function getJobPostingFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  return getFieldsNeedingTranslation(undefined, data, { autoDiscover: true });
}

/** Get fields needing translation for job_orders (staff + scalar + any _i18n). */
function getJobOrderFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  const i18n = getFieldsNeedingTranslation(undefined, data, { autoDiscover: true });
  const staff = getWorkerFacingJobOrderFieldsNeedingTranslation(undefined, data);
  const scalar = getJobOrderScalarWorkerFacingFieldsNeedingTranslation(undefined, data);
  return [...i18n, ...staff, ...scalar];
}

/** Get fields needing translation for shifts. */
function getShiftFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  const i18n = getFieldsNeedingTranslation(undefined, data, { autoDiscover: true });
  const scalar = getShiftScalarWorkerFacingFieldsNeedingTranslation(undefined, data);
  return [...i18n, ...scalar];
}

/** Get fields needing translation for crm_companies. */
function getCrmCompanyFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  return getCrmCompanyDescriptionFieldsNeedingTranslation(undefined, data);
}

/** Get fields needing translation for locations (discover _i18n only). */
function getLocationFieldsNeedingTranslation(data: DocumentData): FieldToTranslate[] {
  const manualFields: string[] = (data.translationMeta as { es?: { manualFields?: string[] } } | undefined)?.es?.manualFields ?? [];
  const keys = discoverI18nFields(data as Record<string, unknown>, manualFields);
  const out: FieldToTranslate[] = [];
  const metaEs = (data.translationMeta as { es?: { status?: string; manualFields?: string[] } } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualSet = new Set(metaEs?.manualFields ?? []);
  for (const field of keys) {
    if (manualSet.has(field) || isDocManual) continue;
    const afterField = data[field] as { en?: string; es?: string } | undefined;
    if (!afterField?.en) continue;
    const esMissing = !afterField.es;
    if (esMissing) out.push({ fieldPath: field, sourceText: afterField.en });
  }
  return out;
}

/** Filter out fields that exceed MAX_SOURCE_LENGTH (worker will skip them too). */
function filterByLength(fields: FieldToTranslate[]): { toTranslate: FieldToTranslate[]; skippedLength: string[] } {
  const toTranslate: FieldToTranslate[] = [];
  const skippedLength: string[] = [];
  for (const f of fields) {
    if ((f.sourceText?.length ?? 0) > MAX_SOURCE_LENGTH) skippedLength.push(f.fieldPath);
    else toTranslate.push(f);
  }
  return { toTranslate, skippedLength };
}

/**
 * Process a single job_posting doc: same discovery as triggers/worker, taxonomy arrays, blocklist,
 * one task per doc, verbose output, and counters (skippedAlreadyTranslated, skippedNoDiscoverableFields, skippedNoTranslationNeeded).
 */
async function processJobPostingDoc(
  db: admin.firestore.Firestore,
  tenantId: string,
  docPath: string,
  data: DocumentData,
  dryRun: boolean,
  ratePerSec: number,
  lastEnqueueTime: { last: number },
  summary: BackfillSummary,
  force: boolean,
  verbose: boolean,
  holdSeconds: number
): Promise<void> {
  summary.docsScanned += 1;
  const docId = docPath.split('/').pop() ?? '';

  const metaEs = (data.translationMeta as { es?: { status?: string } } | undefined)?.es;
  if (metaEs?.status === 'manual') {
    summary.skippedManualLock += 1;
    if (verbose) console.log(`[${docId}] action=skippedManualLock (manual lock)`);
    return;
  }

  const enBackfill = jobPostingsEnBackfill(data);
  const dataWithEn = { ...data } as DocumentData;
  for (const [k, v] of Object.entries(enBackfill)) {
    const parts = k.split('.');
    if (parts.length === 2 && parts[1] === 'en') {
      (dataWithEn as Record<string, unknown>)[parts[0]] = {
        ...((dataWithEn[parts[0]] as object) || {}),
        en: v,
      };
    }
  }

  if (Object.keys(enBackfill).length > 0 && !dryRun) {
    await db.doc(docPath).update({ ...enBackfill, updatedAt: FieldValue.serverTimestamp() });
    summary.docsUpdatedWithEn += 1;
  }

  const scalarNeeding = getJobPostingScalarFieldsNeedingTranslation(dataWithEn);
  const taxonomyNeeding = jobPostingTaxonomyArraysNeedingTranslation(dataWithEn);
  const settingsSnap = await db.doc(`tenants/${tenantId}/translation_settings/default`).get();
  const taxonomyEs = (settingsSnap.data()?.taxonomy as { es?: Record<string, string> })?.es ?? {};
  const taxonomyMissingES = jobPostingTaxonomyTermsMissingES(dataWithEn, taxonomyEs);

  const discoveredScalar = discoverI18nFields(dataWithEn as Record<string, unknown>, []);
  const allowedScalar = discoveredScalar.filter((k) => !JOB_POSTING_EXCLUDED_I18N.has(k));
  const missingEsScalar = allowedScalar.filter((key) => {
    const obj = dataWithEn[key] as { es?: string } | undefined;
    return !(obj?.es ?? '').trim();
  });

  const hasTaxonomyContent = CHIP_ARRAY_FIELDS.some((f) => {
    const raw = dataWithEn[f];
    const i18n = dataWithEn[`${f}_i18n`] as { en?: unknown[] } | undefined;
    const arr = Array.isArray(raw) ? raw : i18n?.en;
    return Array.isArray(arr) && arr.length > 0;
  });
  const hasAnyDiscoverable = allowedScalar.length > 0 || hasTaxonomyContent;

  const { toTranslate, skippedLength } = filterByLength(scalarNeeding);
  summary.skippedLength += skippedLength.length;

  const needsScalar = toTranslate.length > 0;
  const needsTaxonomy = taxonomyMissingES.length > 0;
  const shouldEnqueue = needsScalar || needsTaxonomy;

  if (shouldEnqueue && (process.env.TRANSLATION_ENABLED === 'true' || force) && !dryRun) {
    const payload: TranslationTaskPayload = {
      tenantId,
      docPath,
      fields: toTranslate.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: 'en',
      targetLang: 'es',
      docType: 'job_posting',
    };

    const now = Date.now();
    const elapsed = (now - lastEnqueueTime.last) / 1000;
    const minGap = 1 / ratePerSec;
    if (elapsed < minGap) await sleep((minGap - elapsed) * 1000);

    if (verbose) {
      const config = getEnqueueConfig();
      const scheduleTime = holdSeconds > 0 ? new Date(Date.now() + holdSeconds * 1000).toISOString() : 'immediate';
      console.log(`enqueue config: project=${config.project} location=${config.location} queue=${config.queue} workerUrl=${config.workerUrl} serviceAccountEmail=${config.serviceAccountEmail} scheduleTime=${scheduleTime}`);
    }

    try {
      const taskName = await enqueueTranslationTask(payload, { scheduleDelaySeconds: holdSeconds > 0 ? holdSeconds : undefined });
      if (taskName) {
        summary.tasksEnqueued += 1;
        lastEnqueueTime.last = Date.now();
        if (verbose) {
          console.log(`[${docId}] discoveredI18n=[${allowedScalar.join(',')}] taxonomyNeeding=[${taxonomyNeeding.join(',')}] taxonomyMissingES=[${taxonomyMissingES.join(',')}] missingES=[${missingEsScalar.join(',')}] scalarToTranslate=${toTranslate.length} action=enqueued`);
        }
      }
    } catch (e) {
      summary.tasksFailed += 1;
      if (verbose) console.error(`[${docId}] enqueue failed`, e);
    }
  } else if (shouldEnqueue && dryRun && verbose) {
    console.log(`[${docId}] discoveredI18n=[${allowedScalar.join(',')}] taxonomyNeeding=[${taxonomyNeeding.join(',')}] taxonomyMissingES=[${taxonomyMissingES.join(',')}] missingES=[${missingEsScalar.join(',')}] scalarToTranslate=${toTranslate.length} action=dryRun (would enqueue)`);
  } else if (shouldEnqueue && process.env.TRANSLATION_ENABLED !== 'true' && !force && verbose) {
    console.log(`[${docId}] action=skipped (TRANSLATION_ENABLED not set, use --force)`);
  } else {
    // !shouldEnqueue: exactly one skip reason per doc
    let action: string;
    if (!hasAnyDiscoverable) {
      summary.skippedNoFields += 1;
      action = 'skippedNoFields';
    } else if (!needsScalar && !needsTaxonomy) {
      summary.skippedAlreadyTranslated += 1;
      action = 'skippedAlreadyTranslated';
    } else {
      summary.skippedNoTranslationNeeded += 1;
      action = 'skippedNoWork';
    }
    if (verbose) {
      console.log(`[${docId}] discoveredI18n=[${allowedScalar.join(',')}] taxonomyNeeding=[${taxonomyNeeding.join(',')}] taxonomyMissingES=[${taxonomyMissingES.join(',')}] missingES=[${missingEsScalar.join(',')}] scalarToTranslate=${toTranslate.length} action=${action}`);
    }
  }
}

interface BackfillSummary {
  docsScanned: number;
  docsUpdatedWithEn: number;
  tasksEnqueued: number;
  tasksFailed: number;
  skippedManualLock: number;
  skippedLength: number;
  skippedNoFields: number;
  skippedAlreadyTranslated: number;
  skippedNoDiscoverableFields: number;
  skippedNoTranslationNeeded: number;
}

async function processDoc(
  db: admin.firestore.Firestore,
  tenantId: string,
  collectionKind: 'job_postings' | 'job_orders' | 'shifts' | 'crm_companies' | 'crm_locations',
  docPath: string,
  data: DocumentData,
  dryRun: boolean,
  ratePerSec: number,
  lastEnqueueTime: { last: number },
  summary: BackfillSummary,
  force: boolean,
  requestedCollection: string,
  verbose: boolean,
  holdSeconds: number
): Promise<void> {
  summary.docsScanned += 1;

  const metaEs = (data.translationMeta as { es?: { status?: string } } | undefined)?.es;
  if (metaEs?.status === 'manual') {
    summary.skippedManualLock += 1;
    return;
  }

  let enBackfill: Record<string, unknown>;
  let getFieldsNeeding: (d: DocumentData) => FieldToTranslate[];
  let docType: TranslationTaskPayload['docType'];

  switch (collectionKind) {
    case 'job_postings':
      enBackfill = jobPostingsEnBackfill(data);
      getFieldsNeeding = getJobPostingFieldsNeedingTranslation;
      docType = 'job_posting';
      break;
    case 'job_orders':
      if (!shouldRunJobOrdersEnBackfill(requestedCollection)) {
        return;
      }
      enBackfill = jobOrdersEnBackfill(data);
      getFieldsNeeding = getJobOrderFieldsNeedingTranslation;
      docType = 'job_order';
      break;
    case 'shifts':
      enBackfill = shiftsEnBackfill(data);
      getFieldsNeeding = getShiftFieldsNeedingTranslation;
      docType = 'shift';
      break;
    case 'crm_companies':
      enBackfill = crmCompaniesEnBackfill(data);
      getFieldsNeeding = getCrmCompanyFieldsNeedingTranslation;
      docType = undefined;
      break;
    case 'crm_locations':
      enBackfill = locationsEnBackfill(data);
      getFieldsNeeding = getLocationFieldsNeedingTranslation;
      docType = undefined;
      break;
    default:
      return;
  }

  const dataWithEn = { ...data } as DocumentData;
  for (const [k, v] of Object.entries(enBackfill)) {
    const parts = k.split('.');
    if (parts.length === 2 && parts[1] === 'en') {
      (dataWithEn as Record<string, unknown>)[parts[0]] = {
        ...((dataWithEn[parts[0]] as object) || {}),
        en: v,
      };
    } else if (parts.length === 3 && parts[2] === 'en') {
      const [objKey, section] = parts;
      const obj = (dataWithEn as Record<string, unknown>)[objKey] as Record<string, unknown> | undefined;
      (dataWithEn as Record<string, unknown>)[objKey] = {
        ...(obj || {}),
        [section]: { ...((obj?.[section] as object) || {}), en: v },
      };
    }
  }

  if (Object.keys(enBackfill).length > 0 && !dryRun) {
    const update = { ...enBackfill, updatedAt: FieldValue.serverTimestamp() };
    await db.doc(docPath).update(update);
    summary.docsUpdatedWithEn += 1;
  }

  const fieldsNeeding = getFieldsNeeding(dataWithEn);
  const { toTranslate, skippedLength } = filterByLength(fieldsNeeding);
  summary.skippedLength += skippedLength.length;

  if (toTranslate.length === 0) {
    if (fieldsNeeding.length === 0) summary.skippedNoFields += 1;
    return;
  }

  if (process.env.TRANSLATION_ENABLED !== 'true' && !force) {
    return;
  }

  if (dryRun) {
    return;
  }

  const payload: TranslationTaskPayload = {
    tenantId,
    docPath,
    fields: toTranslate.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
    sourceLang: 'en',
    targetLang: 'es',
    docType,
  };

  const now = Date.now();
  const elapsed = (now - lastEnqueueTime.last) / 1000;
  const minGap = 1 / ratePerSec;
  if (elapsed < minGap) await sleep((minGap - elapsed) * 1000);

  if (verbose) {
    const config = getEnqueueConfig();
    const scheduleTime = holdSeconds > 0 ? new Date(Date.now() + holdSeconds * 1000).toISOString() : 'immediate';
    console.log(`enqueue config: project=${config.project} location=${config.location} queue=${config.queue} workerUrl=${config.workerUrl} serviceAccountEmail=${config.serviceAccountEmail} scheduleTime=${scheduleTime}`);
  }

  try {
    const taskName = await enqueueTranslationTask(payload, { scheduleDelaySeconds: holdSeconds > 0 ? holdSeconds : undefined });
    if (taskName) {
      summary.tasksEnqueued += 1;
      lastEnqueueTime.last = Date.now();
    }
  } catch (e) {
    summary.tasksFailed += 1;
    if (verbose) console.error(`[${collectionKind}] ${docPath} enqueue failed`, e);
  }
}

async function run(): Promise<void> {
  const { tenantId, collection, limit, dryRun, ratePerSec, since, force, verbose, holdSeconds } = parseArgs();

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  const collectionsToRun = getCollectionsToRun(collection);

  if (collectionsToRun.length === 0) {
    console.error('Invalid --collection. Use job_postings|job_orders|shifts|crm_companies|crm_locations|all');
    process.exit(1);
  }

  const sinceTimestamp = since ? admin.firestore.Timestamp.fromDate(new Date(since + 'T00:00:00Z')) : null;

  const tenantIds: string[] = tenantId ? [tenantId] : (await db.collection('tenants').get()).docs.map((d) => d.id);

  const summary: BackfillSummary = {
    docsScanned: 0,
    docsUpdatedWithEn: 0,
    tasksEnqueued: 0,
    tasksFailed: 0,
    skippedManualLock: 0,
    skippedLength: 0,
    skippedNoFields: 0,
    skippedAlreadyTranslated: 0,
    skippedNoDiscoverableFields: 0,
    skippedNoTranslationNeeded: 0,
  };

  const lastEnqueueTime = { last: 0 };

  for (const tid of tenantIds) {
    for (const coll of collectionsToRun) {
      if (coll === 'job_postings') {
        let ref = db.collection('tenants').doc(tid).collection('job_postings') as admin.firestore.Query;
        if (sinceTimestamp) ref = ref.where('updatedAt', '>=', sinceTimestamp);
        const snap = limit > 0 ? await ref.limit(limit).get() : await ref.get();
        for (const d of snap.docs) {
          const docPath = `tenants/${tid}/job_postings/${d.id}`;
          await processJobPostingDoc(db, tid, docPath, d.data() as DocumentData, dryRun, ratePerSec, lastEnqueueTime, summary, force, verbose, holdSeconds);
        }
      } else if (coll === 'job_orders') {
        let ref = db.collection('tenants').doc(tid).collection('job_orders') as admin.firestore.Query;
        if (sinceTimestamp) ref = ref.where('updatedAt', '>=', sinceTimestamp);
        const snap = limit > 0 ? await ref.limit(limit).get() : await ref.get();
        for (const d of snap.docs) {
          const docPath = `tenants/${tid}/job_orders/${d.id}`;
          await processDoc(db, tid, 'job_orders', docPath, d.data() as DocumentData, dryRun, ratePerSec, lastEnqueueTime, summary, force, collection, verbose, holdSeconds);
        }
      } else if (coll === 'shifts') {
        const jobOrdersSnap = await db.collection('tenants').doc(tid).collection('job_orders').get();
        let count = 0;
        for (const jo of jobOrdersSnap.docs) {
          if (limit > 0 && count >= limit) break;
          let ref = jo.ref.collection('shifts') as admin.firestore.Query;
          if (sinceTimestamp) ref = ref.where('updatedAt', '>=', sinceTimestamp);
          const shiftSnap = limit > 0 ? await ref.limit(limit - count).get() : await ref.get();
          for (const s of shiftSnap.docs) {
            if (limit > 0 && count >= limit) break;
            const docPath = `tenants/${tid}/job_orders/${jo.id}/shifts/${s.id}`;
            await processDoc(db, tid, 'shifts', docPath, s.data() as DocumentData, dryRun, ratePerSec, lastEnqueueTime, summary, force, collection, verbose, holdSeconds);
            count += 1;
          }
        }
      } else if (coll === 'crm_companies') {
        let ref = db.collection('tenants').doc(tid).collection('crm_companies') as admin.firestore.Query;
        if (sinceTimestamp) ref = ref.where('updatedAt', '>=', sinceTimestamp);
        const snap = limit > 0 ? await ref.limit(limit).get() : await ref.get();
        for (const d of snap.docs) {
          const docPath = `tenants/${tid}/crm_companies/${d.id}`;
          await processDoc(db, tid, 'crm_companies', docPath, d.data() as DocumentData, dryRun, ratePerSec, lastEnqueueTime, summary, force, collection, verbose, holdSeconds);
        }
      } else if (coll === 'crm_locations') {
        // Top-level collection: tenants/{tenantId}/crm_locations
        let ref = db.collection('tenants').doc(tid).collection('crm_locations') as admin.firestore.Query;
        if (sinceTimestamp) ref = ref.where('updatedAt', '>=', sinceTimestamp);
        const snap = limit > 0 ? await ref.limit(limit).get() : await ref.get();
        for (const d of snap.docs) {
          const docPath = `tenants/${tid}/crm_locations/${d.id}`;
          await processDoc(db, tid, 'crm_locations', docPath, d.data() as DocumentData, dryRun, ratePerSec, lastEnqueueTime, summary, force, collection, verbose, holdSeconds);
        }
      }
    }
  }

  console.log(JSON.stringify({
    dryRun,
    verbose,
    holdSeconds,
    collection: collection === 'all' ? 'all' : collection,
    limit: limit || 'none',
    since: since ?? 'none',
    docsScanned: summary.docsScanned,
    docsUpdatedWithEn: summary.docsUpdatedWithEn,
    tasksEnqueued: summary.tasksEnqueued,
    tasksFailed: summary.tasksFailed,
    skippedManualLock: summary.skippedManualLock,
    skippedLength: summary.skippedLength,
    skippedNoFields: summary.skippedNoFields,
    skippedAlreadyTranslated: summary.skippedAlreadyTranslated,
    skippedNoDiscoverableFields: summary.skippedNoDiscoverableFields,
    skippedNoTranslationNeeded: summary.skippedNoTranslationNeeded,
    unknownTaxonomyTerms: '(reported by translation worker per run)',
  }, null, 2));
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
