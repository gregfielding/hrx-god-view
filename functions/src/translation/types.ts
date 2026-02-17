/**
 * HRX Translation Engine — shared types.
 * Phase 1: job_postings only (worker + jobs board).
 */

import type { Timestamp } from 'firebase-admin/firestore';

export type SupportedLanguage = 'en' | 'es';

export interface I18nField {
  en: string;
  es?: string;
}

export interface TranslationMetaLang {
  sourceHash: string;
  /** Per-field hashes to avoid re-translating unchanged fields when only one field changes */
  fieldHashes?: Record<string, string>;
  status: 'auto' | 'manual' | 'draft';
  /** Per-field manual lock: auto-translation skips these field paths (e.g. ["jobDescription_i18n"]) */
  manualFields?: string[];
  updatedAt: Timestamp;
  model: string;
}

export interface TranslationMeta {
  es?: TranslationMetaLang;
}

export interface TranslationSettings {
  glossary?: Record<string, string>;
  doNotTranslate?: string[];
  tone?: string;
  /** Tenant-owned EN→ES map for chip values (PPE, education, experience, etc.). */
  taxonomy?: { es?: Record<string, string> };
}

export interface TranslationTaskPayload {
  tenantId: string;
  /** Full path e.g. "tenants/{tenantId}/job_postings/{jobId}" */
  docPath: string;
  fields: Array<{ fieldPath: string; sourceText: string }>;
  sourceLang: 'en';
  targetLang: 'es';
  /** When "job_order", worker may write to staffInstructions_i18n.*.es for path-like fields; "shift" uses normal _i18n.es */
  docType?: 'job_posting' | 'job_order' | 'shift';
}
