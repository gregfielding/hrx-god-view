/**
 * Document AI processor choice + response mapping for I-9 supporting documents.
 * v1: only list_b_drivers_license uses the public US Driver License parser.
 * list_a_us_passport (and all other types) → extraction_unsupported — Google’s US Passport
 * parser is restricted/private and is being discontinued; no replacement wired here yet.
 */
import { protos } from '@google-cloud/documentai';

type IEntity = protos.google.cloud.documentai.v1.Document.IEntity;
type IDocument = protos.google.cloud.documentai.v1.IDocument;

export type ExtractionProcessorKind = 'us_driver_license';

/** Normalized fields written to Firestore documentExtraction.extractedFields */
export type I9ExtractedFieldsNormalized = {
  documentCategory?: 'passport' | 'driver_license' | 'other';
  documentNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  expirationDate?: string | null;
  issueDate?: string | null;
  issuingState?: string | null;
  issuingCountry?: string | null;
  mrzCode?: string | null;
  extractedDocumentTypeLabel?: string | null;
  extractionWarnings?: string[];
};

const MAX_RAW_ENTITIES = 36;
const MAX_MENTION_CHARS = 160;

export function resolveProcessorKindForDocumentType(documentType: string): ExtractionProcessorKind | null {
  const v = String(documentType || '').trim();
  if (v === 'list_b_drivers_license') return 'us_driver_license';
  return null;
}

/** Env value may be full resource name or raw processor id (combined with project + location). */
export function resolveProcessorResourceName(processorKind: ExtractionProcessorKind, env: NodeJS.ProcessEnv): string | null {
  if (processorKind !== 'us_driver_license') return null;
  const projectId =
    String(env.DOCUMENT_AI_PROJECT_ID || env.GCLOUD_PROJECT || env.GCP_PROJECT || '').trim() || null;
  const location = String(env.DOCUMENT_AI_LOCATION || 'us').trim() || 'us';
  const raw = String(env.DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE || '').trim();
  if (!raw) return null;
  if (raw.includes('/processors/')) return raw;
  if (!projectId) return null;
  return `projects/${projectId}/locations/${location}/processors/${raw}`;
}

export type RawEntitySnippet = { type: string; mentionText?: string; confidence?: number };

function normType(t: string | null | undefined): string {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function pickText(e: IEntity): string {
  const mt = String(e.mentionText || '').trim();
  if (mt) return mt;
  const nv = e.normalizedValue;
  if (nv?.text) return String(nv.text).trim();
  if (nv?.addressValue) return String(nv.addressValue || '').trim();
  if (nv?.dateValue?.year != null) {
    const y = nv.dateValue!.year!;
    const m = nv.dateValue!.month || 1;
    const d = nv.dateValue!.day || 1;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

function flattenEntities(entities: IEntity[] | null | undefined): IEntity[] {
  const out: IEntity[] = [];
  function walk(list: IEntity[] | null | undefined) {
    if (!list) return;
    for (const e of list) {
      out.push(e);
      walk(e.properties || null);
    }
  }
  walk(entities || null);
  return out;
}

/** Best-effort ISO date YYYY-MM-DD from mention or normalized value. */
function normalizeDateish(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    let yyyy = mdy[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  return t.length <= 32 ? t : t.slice(0, 32);
}

function applyEntityToFields(
  nt: string,
  text: string,
  confidence: number | null | undefined,
  fields: I9ExtractedFieldsNormalized,
  warnings: string[],
) {
  const low = nt;
  const pushLowConf = (label: string) => {
    if (confidence != null && confidence < 0.75) warnings.push(`${label} (low confidence)`);
  };

  if (
    low.includes('document_id') ||
    low === 'id' ||
    low.includes('license_number') ||
    low.includes('license_id') ||
    low.includes('passport_number') ||
    low.includes('document_number')
  ) {
    if (!fields.documentNumber) fields.documentNumber = text;
    pushLowConf('documentNumber');
    return;
  }
  if (low.includes('family_name') || low === 'surname' || low.includes('last_name')) {
    if (!fields.lastName) fields.lastName = text;
    return;
  }
  if (
    low.includes('given_name') ||
    low.includes('given_names') ||
    low === 'first_name' ||
    low.includes('first_name')
  ) {
    if (!fields.firstName) fields.firstName = text;
    return;
  }
  if (low.includes('date_of_birth') || low.includes('dob') || low === 'birth_date') {
    const d = normalizeDateish(text);
    if (d) fields.dateOfBirth = d;
    return;
  }
  if (low.includes('expiration') && (low.includes('date') || low.includes('_date'))) {
    const d = normalizeDateish(text);
    if (d) fields.expirationDate = d;
    return;
  }
  if (low.includes('issue_date') || low === 'date_of_issue') {
    const d = normalizeDateish(text);
    if (d) fields.issueDate = d;
    return;
  }
  if (low.includes('issuing_state') || low === 'state' || low.includes('address_state')) {
    if (!fields.issuingState) fields.issuingState = text.slice(0, 8);
    return;
  }
  if (low.includes('country') || low.includes('nationality')) {
    if (!fields.issuingCountry) fields.issuingCountry = text.slice(0, 64);
    return;
  }
  if (low.includes('mrz') || low.includes('machine_readable')) {
    if (!fields.mrzCode) fields.mrzCode = text.slice(0, 200);
    return;
  }
}

export function mapDocumentAiToExtractedFields(document: IDocument | null | undefined): {
  extractedFields: I9ExtractedFieldsNormalized;
  confidenceSummary: { overall?: number; byField?: Record<string, number> };
  extractedRawEntities: RawEntitySnippet[];
  extractionWarnings: string[];
} {
  const warnings: string[] = [];
  const fields: I9ExtractedFieldsNormalized = {
    extractionWarnings: [],
    documentCategory: 'driver_license',
    extractedDocumentTypeLabel: "US Driver's license (parser)",
  };

  const flat = flattenEntities(document?.entities || null);
  const byField: Record<string, number> = {};
  let confSum = 0;
  let confN = 0;

  for (const e of flat) {
    const nt = normType(e.type);
    const text = pickText(e);
    if (!nt || !text) continue;
    const c = e.confidence != null ? Number(e.confidence) : null;
    if (c != null && !Number.isNaN(c)) {
      confSum += c;
      confN += 1;
      byField[nt] = c;
    }
    applyEntityToFields(nt, text, c, fields, warnings);
  }

  if (!fields.documentNumber) warnings.push('Document number not detected or ambiguous.');
  if (!fields.expirationDate) warnings.push('Expiration date not detected or ambiguous.');

  const raw: RawEntitySnippet[] = [];
  for (let i = 0; i < flat.length && raw.length < MAX_RAW_ENTITIES; i++) {
    const e = flat[i];
    const mt = pickText(e);
    raw.push({
      type: String(e.type || '').slice(0, 120),
      mentionText: mt.slice(0, MAX_MENTION_CHARS),
      confidence: e.confidence != null ? Number(e.confidence) : undefined,
    });
  }

  fields.extractionWarnings = [...warnings, ...(fields.extractionWarnings || [])];

  const overall = confN > 0 ? confSum / confN : undefined;
  return {
    extractedFields: fields,
    confidenceSummary: { overall, byField: Object.keys(byField).length ? byField : undefined },
    extractedRawEntities: raw,
    extractionWarnings: fields.extractionWarnings || warnings,
  };
}
