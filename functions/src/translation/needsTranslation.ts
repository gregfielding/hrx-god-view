/**
 * Determine which fields need translation (EN changed or ES missing, and not manual-locked).
 * Supports legacy Phase 1 field list or auto-discovery of any *_i18n key (vNext).
 * Job orders: also worker-facing staffInstructions.*.text → staffInstructions_i18n.*.es.
 */

import { PHASE1_TRANSLATABLE_FIELDS } from './fields';
import type { DocumentData } from './isTranslationOnlyWrite';
import { discoverI18nFields } from './discoverI18nFields';
import {
  discoverWorkerFacingJobOrderFields,
  discoverJobOrderScalarI18nCandidates,
  staffInstructionPathToSection,
} from './discoverWorkerFacingJobOrderFields';
import { discoverShiftScalarI18nCandidates } from './discoverWorkerFacingShiftFields';
import { discoverCrmCompanyDescriptionI18nCandidates } from './discoverCrmCompanyDescriptionFields';
import { computeHash } from './hash';

export interface FieldToTranslate {
  fieldPath: string;
  sourceText: string;
}

type MetaEs = { status?: string; manualFields?: string[]; fieldHashes?: Record<string, string> } | undefined;

export interface GetFieldsNeedingTranslationOptions {
  /** When true, discover all *_i18n keys with non-empty .en instead of using Phase 1 list. Default true (vNext). */
  autoDiscover?: boolean;
}

/**
 * Returns fields that need translation: EN changed or ES missing, respecting doc-level and per-field manual lock.
 */
export function getFieldsNeedingTranslation(
  before: DocumentData | undefined,
  after: DocumentData,
  options: GetFieldsNeedingTranslationOptions = {}
): FieldToTranslate[] {
  const { autoDiscover = true } = options;
  const out: FieldToTranslate[] = [];
  const metaEs = (after?.translationMeta as { es?: MetaEs } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualFields = metaEs?.manualFields ?? [];
  const manualFieldsSet = new Set(manualFields);

  const candidateFields = autoDiscover
    ? discoverI18nFields(after ?? {}, manualFields)
    : (PHASE1_TRANSLATABLE_FIELDS as readonly string[]);

  for (const field of candidateFields) {
    if (manualFieldsSet.has(field)) continue;
    const afterField = after?.[field] as { en?: string; es?: string } | undefined;
    if (!afterField?.en) continue;

    const beforeField = before?.[field] as { en?: string; es?: string } | undefined;
    const enChanged = !beforeField || beforeField.en !== afterField.en;
    const esMissing = !afterField.es;

    if ((enChanged || esMissing) && !isDocManual) {
      out.push({ fieldPath: field, sourceText: afterField.en });
    }
  }

  return out;
}

/**
 * Returns fields that need translation for job-order worker-facing staff instructions.
 * Source: staffInstructions_i18n.<section>.en ?? staffInstructions.<section>.text.
 * Writes to staffInstructions_i18n.<section>.es (handled in worker).
 */
export function getWorkerFacingJobOrderFieldsNeedingTranslation(
  before: DocumentData | undefined,
  after: DocumentData
): FieldToTranslate[] {
  const out: FieldToTranslate[] = [];
  const metaEs = (after?.translationMeta as { es?: MetaEs } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualFields = metaEs?.manualFields ?? [];
  const fieldHashes = metaEs?.fieldHashes ?? {};
  const manualFieldsSet = new Set(manualFields);

  const staffI18n = after?.staffInstructions_i18n as Record<string, { en?: string; es?: string }> | undefined;
  const staff = after?.staffInstructions as Record<string, { text?: string }> | undefined;

  const candidatePaths = discoverWorkerFacingJobOrderFields(after ?? {}, manualFields);

  for (const fieldPath of candidatePaths) {
    if (manualFieldsSet.has(fieldPath)) continue;
    const section = staffInstructionPathToSection(fieldPath);
    if (section == null) continue;

    const sourceText = (
      (staffI18n?.[section]?.en ?? staff?.[section]?.text) as string | undefined
    )?.trim();
    if (!sourceText) continue;

    const currentEs = staffI18n?.[section]?.es;
    const hash = computeHash(sourceText);
    const prevHash = fieldHashes[fieldPath];
    const esMissing = !currentEs;
    const hashChanged = prevHash !== hash;

    if ((esMissing || hashChanged) && !isDocManual) {
      out.push({ fieldPath, sourceText });
    }
  }

  return out;
}

/**
 * Returns fields that need translation for job-order scalar worker-facing fields
 * (jobTitle, jobOrderName, customUniformRequirements, policies, etc.).
 * Source: <field>_i18n.en ?? <field> (legacy). Writes to <field>_i18n.es (normal _i18n in worker).
 */
export function getJobOrderScalarWorkerFacingFieldsNeedingTranslation(
  before: DocumentData | undefined,
  after: DocumentData
): FieldToTranslate[] {
  const out: FieldToTranslate[] = [];
  const metaEs = (after?.translationMeta as { es?: MetaEs } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualFields = metaEs?.manualFields ?? [];
  const fieldHashes = metaEs?.fieldHashes ?? {};
  const manualFieldsSet = new Set(manualFields);

  const candidateI18nKeys = discoverJobOrderScalarI18nCandidates(after ?? {}, manualFields);

  for (const i18nKey of candidateI18nKeys) {
    if (manualFieldsSet.has(i18nKey)) continue;

    const legacyField = i18nKey.replace(/_i18n$/, '');
    const i18nObj = after?.[i18nKey] as { en?: string; es?: string } | undefined;
    const legacyValue = after?.[legacyField];
    const sourceText = (
      (i18nObj?.en ?? (typeof legacyValue === 'string' ? legacyValue : undefined)) as string | undefined
    )?.trim();
    if (!sourceText) continue;

    const currentEs = i18nObj?.es;
    const hash = computeHash(sourceText);
    const prevHash = fieldHashes[i18nKey];
    const esMissing = !currentEs;
    const hashChanged = prevHash !== hash;

    if ((esMissing || hashChanged) && !isDocManual) {
      out.push({ fieldPath: i18nKey, sourceText });
    }
  }

  return out;
}

/**
 * Returns fields that need translation for shift scalar worker-facing fields
 * (shiftTitle, defaultJobTitle, shiftDescription, emailIntro).
 * Source: <field>_i18n.en ?? <field> (legacy). Writes to <field>_i18n.es (normal _i18n in worker).
 */
export function getShiftScalarWorkerFacingFieldsNeedingTranslation(
  before: DocumentData | undefined,
  after: DocumentData
): FieldToTranslate[] {
  const out: FieldToTranslate[] = [];
  const metaEs = (after?.translationMeta as { es?: MetaEs } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualFields = metaEs?.manualFields ?? [];
  const fieldHashes = metaEs?.fieldHashes ?? {};
  const manualFieldsSet = new Set(manualFields);

  const candidateI18nKeys = discoverShiftScalarI18nCandidates(after ?? {}, manualFields);

  for (const i18nKey of candidateI18nKeys) {
    if (manualFieldsSet.has(i18nKey)) continue;

    const legacyField = i18nKey.replace(/_i18n$/, '');
    const i18nObj = after?.[i18nKey] as { en?: string; es?: string } | undefined;
    const legacyValue = after?.[legacyField];
    const sourceText = (
      (i18nObj?.en ?? (typeof legacyValue === 'string' ? legacyValue : undefined)) as string | undefined
    )?.trim();
    if (!sourceText) continue;

    const currentEs = i18nObj?.es;
    const hash = computeHash(sourceText);
    const prevHash = fieldHashes[i18nKey];
    const esMissing = !currentEs;
    const hashChanged = prevHash !== hash;

    if ((esMissing || hashChanged) && !isDocManual) {
      out.push({ fieldPath: i18nKey, sourceText });
    }
  }

  return out;
}

/**
 * Returns fields that need translation for CRM company description only.
 * Company name and other identifiers are never translated.
 * Source: description_i18n.en ?? description (legacy). Writes to description_i18n.es.
 */
export function getCrmCompanyDescriptionFieldsNeedingTranslation(
  before: DocumentData | undefined,
  after: DocumentData
): FieldToTranslate[] {
  const out: FieldToTranslate[] = [];
  const metaEs = (after?.translationMeta as { es?: MetaEs } | undefined)?.es;
  const isDocManual = metaEs?.status === 'manual';
  const manualFields = metaEs?.manualFields ?? [];
  const fieldHashes = metaEs?.fieldHashes ?? {};
  const manualFieldsSet = new Set(manualFields);

  const candidateI18nKeys = discoverCrmCompanyDescriptionI18nCandidates(after ?? {}, manualFields);

  for (const i18nKey of candidateI18nKeys) {
    if (manualFieldsSet.has(i18nKey)) continue;

    const legacyField = i18nKey.replace(/_i18n$/, '');
    const i18nObj = after?.[i18nKey] as { en?: string; es?: string } | undefined;
    const legacyValue = after?.[legacyField];
    const sourceText = (
      (i18nObj?.en ?? (typeof legacyValue === 'string' ? legacyValue : undefined)) as string | undefined
    )?.trim();
    if (!sourceText) continue;

    const currentEs = i18nObj?.es;
    const hash = computeHash(sourceText);
    const prevHash = fieldHashes[i18nKey];
    const esMissing = !currentEs;
    const hashChanged = prevHash !== hash;

    if ((esMissing || hashChanged) && !isDocManual) {
      out.push({ fieldPath: i18nKey, sourceText });
    }
  }

  return out;
}
