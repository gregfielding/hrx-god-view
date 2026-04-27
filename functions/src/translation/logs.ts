/**
 * Write translation event to translation_logs for auditing and cost tracking.
 */

import type { Firestore } from 'firebase-admin/firestore';

/** TRANSLATION_LOG_LEVEL: normal = summary only; verbose = + payload metadata (keys + sizes, no raw text) */
export type TranslationLogLevel = 'normal' | 'verbose';

export interface UnknownTaxonomyTermEntry {
  term: string;
  docPath?: string;
  fieldName?: string;
}

export interface TranslationLogEntry {
  tenantId?: string;
  docPath?: string;
  fieldCount?: number;
  durationMs?: number;
  status: 'success' | 'error';
  error?: string;
  model?: string;
  tokenUsage?: number;
  /** Fields skipped due to source text exceeding max length (budget guard) */
  skippedDueToLength?: string[];
  /** Verbose only: translated fields with source character length */
  fieldMeta?: Array<{ fieldPath: string; sourceLength: number }>;
  /** Verbose only: skipped-by-length fields with source character length */
  skippedDueToLengthMeta?: Array<{ fieldPath: string; sourceLength: number }>;
  /** Taxonomy array fields: terms not found in tenant taxonomy.es (for monitoring and adding to dictionary) */
  unknownTaxonomyTerms?: UnknownTaxonomyTermEntry[];
}

export async function writeTranslationLog(
  db: Firestore,
  log: TranslationLogEntry
): Promise<void> {
  const ref = db.collection('translation_logs').doc();
  await ref.set({
    ...log,
    createdAt: new Date(),
  });
}
