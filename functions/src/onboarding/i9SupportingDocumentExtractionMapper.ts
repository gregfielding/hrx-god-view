/**
 * Document AI processor choice + response mapping for I-9 supporting documents.
 * - Pretrained US driver license parser + custom extractors (env-routed).
 * Custom extractors: entity types are normalized (snake_case); see mapCustomExtractorDocument().
 */
import { protos } from '@google-cloud/documentai';

type IEntity = protos.google.cloud.documentai.v1.Document.IEntity;
type IDocument = protos.google.cloud.documentai.v1.IDocument;

/** Stored on Firestore documentExtraction.processorType */
export type ExtractionProcessorKind =
  | 'us_driver_license'
  | 'custom_dl'
  | 'custom_ssn_card'
  | 'custom_green_card'
  | 'custom_ead'
  | 'custom_passport'
  | 'custom_state_id'
  | 'custom_birth_certificate';

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

const PROCESSOR_ENV_KEY: Record<ExtractionProcessorKind, string> = {
  us_driver_license: 'DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE',
  custom_dl: 'DOCUMENT_AI_PROCESSOR_DL_CUSTOM',
  custom_ssn_card: 'DOCUMENT_AI_PROCESSOR_SSN_CARD',
  custom_green_card: 'DOCUMENT_AI_PROCESSOR_GREEN_CARD',
  custom_ead: 'DOCUMENT_AI_PROCESSOR_EAD',
  custom_passport: 'DOCUMENT_AI_PROCESSOR_PASSPORT',
  custom_state_id: 'DOCUMENT_AI_PROCESSOR_STATE_ID',
  custom_birth_certificate: 'DOCUMENT_AI_PROCESSOR_BIRTH_CERTIFICATE',
};

export type ExtractionRoutingResult =
  | { type: 'unsupported' }
  | { type: 'missing_env'; message: string; processorType: ExtractionProcessorKind }
  | { type: 'ready'; kind: ExtractionProcessorKind; resourceName: string };

function buildProcessorResourceName(envVarValue: string, env: NodeJS.ProcessEnv): string | null {
  const raw = String(envVarValue || '').trim();
  if (!raw) return null;
  if (raw.includes('/processors/')) return raw;
  const projectId =
    String(env.DOCUMENT_AI_PROJECT_ID || env.GCLOUD_PROJECT || env.GCP_PROJECT || '').trim() || null;
  if (!projectId) return null;
  const location = String(env.DOCUMENT_AI_LOCATION || 'us').trim() || 'us';
  return `projects/${projectId}/locations/${location}/processors/${raw}`;
}

export function resolveProcessorResourceForKind(kind: ExtractionProcessorKind, env: NodeJS.ProcessEnv): string | null {
  const key = PROCESSOR_ENV_KEY[kind];
  return buildProcessorResourceName(String(env[key] || '').trim(), env);
}

/**
 * Driver's license: **prebuilt US parser primary** if `DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE` is set;
 * otherwise **custom dl_extractor** via `DOCUMENT_AI_PROCESSOR_DL_CUSTOM`.
 */
export function resolveExtractionRouting(documentType: string, env: NodeJS.ProcessEnv): ExtractionRoutingResult {
  const dt = String(documentType || '').trim();

  if (dt === 'list_b_drivers_license') {
    const pre = resolveProcessorResourceForKind('us_driver_license', env);
    if (pre) return { type: 'ready', kind: 'us_driver_license', resourceName: pre };
    const custom = resolveProcessorResourceForKind('custom_dl', env);
    if (custom) return { type: 'ready', kind: 'custom_dl', resourceName: custom };
    return {
      type: 'missing_env',
      message:
        'Set DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE (Google US Driver License parser, preferred) or DOCUMENT_AI_PROCESSOR_DL_CUSTOM (custom dl_extractor).',
      processorType: 'us_driver_license',
    };
  }

  const single: Record<string, ExtractionProcessorKind> = {
    list_c_ssn_card: 'custom_ssn_card',
    list_a_pr_card: 'custom_green_card',
    list_a_ead: 'custom_ead',
    list_a_us_passport: 'custom_passport',
    list_b_gov_id: 'custom_state_id',
    list_c_birth_certificate: 'custom_birth_certificate',
  };

  const kind = single[dt];
  if (!kind) return { type: 'unsupported' };

  const resource = resolveProcessorResourceForKind(kind, env);
  if (!resource) {
    return {
      type: 'missing_env',
      message: `${PROCESSOR_ENV_KEY[kind]} (and DOCUMENT_AI_PROJECT_ID / location if using raw processor id) is not configured.`,
      processorType: kind,
    };
  }
  return { type: 'ready', kind, resourceName: resource };
}

/** @deprecated Use resolveExtractionRouting — kept for tests / grep compatibility */
export function resolveProcessorKindForDocumentType(documentType: string): ExtractionProcessorKind | null {
  const r = resolveExtractionRouting(documentType, process.env);
  return r.type === 'ready' ? r.kind : null;
}

/** @deprecated Use resolveExtractionRouting + resolveProcessorResourceForKind */
export function resolveProcessorResourceName(processorKind: ExtractionProcessorKind, env: NodeJS.ProcessEnv): string | null {
  return resolveProcessorResourceForKind(processorKind, env);
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

function splitFullNameConservative(full: string): {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  needsSplitWarning: boolean;
} {
  const t = full.trim();
  if (!t) return { fullName: full, needsSplitWarning: false };
  if (t.includes(',')) {
    const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        fullName: t,
        lastName: parts[0],
        firstName: parts.slice(1).join(' '),
        needsSplitWarning: false,
      };
    }
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return { fullName: t, needsSplitWarning: true };
  }
  return {
    fullName: t,
    firstName: words[0],
    lastName: words.slice(1).join(' '),
    needsSplitWarning: false,
  };
}

const CUSTOM_KIND_META: Record<
  Exclude<ExtractionProcessorKind, 'us_driver_license'>,
  { documentCategory: 'passport' | 'driver_license' | 'other'; label: string }
> = {
  custom_dl: { documentCategory: 'driver_license', label: "Driver's license (custom extractor)" },
  custom_ssn_card: { documentCategory: 'other', label: 'Social Security card (custom extractor)' },
  custom_green_card: { documentCategory: 'other', label: 'Permanent Resident Card (custom extractor)' },
  custom_ead: { documentCategory: 'other', label: 'Employment Authorization Document (custom extractor)' },
  custom_passport: { documentCategory: 'passport', label: 'Passport (custom extractor)' },
  custom_state_id: { documentCategory: 'driver_license', label: 'State-issued ID (custom extractor)' },
  custom_birth_certificate: { documentCategory: 'other', label: 'Birth certificate (custom extractor)' },
};

function applyEntityToDriverLicenseFields(
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

function mapUsDriverLicenseDocument(document: IDocument | null | undefined): {
  extractedFields: I9ExtractedFieldsNormalized;
  confidenceSummary: { overall?: number; byField?: Record<string, number> };
  extractedRawEntities: RawEntitySnippet[];
  extractionWarnings: string[];
} {
  const warnings: string[] = [];
  const fields: I9ExtractedFieldsNormalized = {
    extractionWarnings: [],
    documentCategory: 'driver_license',
    extractedDocumentTypeLabel: "US Driver's license (Google pretrained parser)",
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
    applyEntityToDriverLicenseFields(nt, text, c, fields, warnings);
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

function mapCustomExtractorDocument(
  kind: Exclude<ExtractionProcessorKind, 'us_driver_license'>,
  document: IDocument | null | undefined,
): {
  extractedFields: I9ExtractedFieldsNormalized;
  confidenceSummary: { overall?: number; byField?: Record<string, number> };
  extractedRawEntities: RawEntitySnippet[];
  extractionWarnings: string[];
} {
  const meta = CUSTOM_KIND_META[kind];
  const warnings: string[] = [];
  const fields: I9ExtractedFieldsNormalized = {
    extractionWarnings: [],
    documentCategory: meta.documentCategory,
    extractedDocumentTypeLabel: meta.label,
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

    if (nt === 'given_name' || nt === 'first_name' || nt.includes('first_name')) {
      if (!fields.firstName) fields.firstName = text;
      continue;
    }
    if (nt === 'family_name' || nt === 'last_name' || nt.includes('last_name') || nt === 'surname') {
      if (!fields.lastName) fields.lastName = text;
      continue;
    }

    if (nt === 'full_name' || nt.includes('full_name')) {
      const sp = splitFullNameConservative(text);
      fields.fullName = sp.fullName;
      if (sp.firstName) fields.firstName = sp.firstName;
      if (sp.lastName) fields.lastName = sp.lastName;
      if (sp.needsSplitWarning) warnings.push('fullName extracted without split first/last');
      continue;
    }

    if (
      nt === 'document_number' ||
      nt.includes('document_number') ||
      (nt === 'document_id' && !fields.documentNumber)
    ) {
      if (!fields.documentNumber) fields.documentNumber = text;
      continue;
    }

    if (nt === 'card_number' || nt.includes('card_number')) {
      if (!fields.documentNumber) {
        fields.documentNumber = text;
        warnings.push('documentNumber taken from card_number — verify against document');
      } else if (text.trim() && text.trim() !== String(fields.documentNumber).trim()) {
        warnings.push('Secondary card_number present — primary document_number used for documentNumber');
      }
      continue;
    }

    if (nt === 'date_of_birth' || nt === 'dob' || nt.includes('date_of_birth') || nt === 'birth_date') {
      const d = normalizeDateish(text);
      if (d) fields.dateOfBirth = d;
      continue;
    }

    if (
      nt === 'expiration_date' ||
      nt.includes('expiration_date') ||
      (nt.includes('expiration') && nt.includes('date'))
    ) {
      const d = normalizeDateish(text);
      if (d) fields.expirationDate = d;
      continue;
    }

    if (nt === 'issue_date' || nt.includes('issue_date') || nt === 'date_of_issue') {
      const d = normalizeDateish(text);
      if (d) fields.issueDate = d;
      continue;
    }

    if (nt === 'issuing_state' || nt.includes('issuing_state')) {
      if (!fields.issuingState) fields.issuingState = text.slice(0, 32);
      continue;
    }
    if (
      (kind === 'custom_dl' || kind === 'custom_state_id') &&
      !fields.issuingState &&
      (nt === 'state' || nt === 'address_state')
    ) {
      fields.issuingState = text.slice(0, 32);
      continue;
    }

    if (nt === 'issuing_country' || nt.includes('issuing_country')) {
      if (!fields.issuingCountry) fields.issuingCountry = text.slice(0, 64);
      continue;
    }
    if (kind === 'custom_passport' && (nt === 'nationality' || nt.includes('nationality'))) {
      if (!fields.issuingCountry) fields.issuingCountry = text.slice(0, 64);
      continue;
    }

    if (nt === 'country_of_birth' || nt.includes('country_of_birth')) {
      warnings.push('Country of birth extracted — verify on document (not mapped to issuing country)');
      continue;
    }

    if (nt === 'category_code' || nt.includes('category_code')) {
      warnings.push(`USCIS category code: ${text.slice(0, 32)}`);
      continue;
    }

    if (nt === 'sex' || nt === 'gender') {
      continue;
    }

    if (nt.includes('mrz') || nt.includes('machine_readable')) {
      if (!fields.mrzCode) fields.mrzCode = text.slice(0, 200);
      continue;
    }

    // Pretrained-style entity names sometimes appear on custom DL / state ID models
    if (kind === 'custom_dl' || kind === 'custom_state_id') {
      applyEntityToDriverLicenseFields(nt, text, c, fields, warnings);
    }
  }

  if (!fields.documentNumber) warnings.push('documentNumber missing');
  if (!fields.expirationDate && kind !== 'custom_ssn_card' && kind !== 'custom_birth_certificate') {
    warnings.push('expirationDate missing');
  }
  if (!fields.dateOfBirth && kind !== 'custom_ssn_card') {
    warnings.push('dateOfBirth missing');
  }

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

export function mapDocumentAiToExtractedFields(
  document: IDocument | null | undefined,
  processorKind: ExtractionProcessorKind,
): {
  extractedFields: I9ExtractedFieldsNormalized;
  confidenceSummary: { overall?: number; byField?: Record<string, number> };
  extractedRawEntities: RawEntitySnippet[];
  extractionWarnings: string[];
} {
  if (processorKind === 'us_driver_license') {
    return mapUsDriverLicenseDocument(document);
  }
  return mapCustomExtractorDocument(processorKind, document);
}
