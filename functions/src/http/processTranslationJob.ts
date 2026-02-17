/**
 * HTTP worker for translation-es queue. Runs OpenAI batch EN→ES, writes *_i18n.es and
 * translationMeta.es. Uses per-field hashes so unchanged fields are not re-translated.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import OpenAI from 'openai';

import {
  computeHash,
  placeholdersMatch,
  loadTranslationSettings,
  translateBatchEnToEs,
  writeTranslationLog,
  isWorkerFacingStaffInstructionPath,
  staffInstructionPathToI18nWriteKey,
  staffInstructionPathToSection,
  CHIP_ARRAY_FIELDS,
  translateTaxonomyArray,
} from '../translation';
import type { TranslationTaskPayload } from '../translation';
import type { UnknownTaxonomyTermEntry } from '../translation/logs';
import { getOpenAIKey } from '../utils/secrets';

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function isRetryable(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? '');
  return (
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('rate limit') ||
    msg.includes('temporarily')
  );
}

const DEFAULT_MODEL = 'gpt-4o-mini';
/** Soft budget guard: skip fields whose source text exceeds this (chars). */
const MAX_SOURCE_LENGTH = 8000;

/** normal = summary only; verbose = + payload metadata (keys + sizes, no raw text) */
function getLogLevel(): 'normal' | 'verbose' {
  const v = process.env.TRANSLATION_LOG_LEVEL;
  return v === 'verbose' ? 'verbose' : 'normal';
}

export const processTranslationJob = onRequest(
  {
    cors: false,
    timeoutSeconds: 120,
    memory: '256MiB',
    maxInstances: 10,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    let payload: TranslationTaskPayload;
    try {
      payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch {
      res.status(400).send('Invalid JSON');
      return;
    }

    const { tenantId, docPath, fields, sourceLang, targetLang, docType } = payload;
    if (
      !tenantId ||
      !docPath ||
      !Array.isArray(fields) ||
      sourceLang !== 'en' ||
      targetLang !== 'es'
    ) {
      res.status(400).send('Invalid payload');
      return;
    }

    const db = getFirestore();
    const docRef = db.doc(docPath);
    const t0 = Date.now();
    const logLevel = getLogLevel();

    try {
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(200).send('Doc missing (noop)');
        return;
      }

      const data = snap.data() ?? {};
      const settings = await loadTranslationSettings(db, tenantId);

      const metaEs = data.translationMeta?.es as {
        status?: string;
        fieldHashes?: Record<string, string>;
        manualFields?: string[];
      } | undefined;
      const isDocManual = metaEs?.status === 'manual';
      if (isDocManual) {
        res.status(200).send('Manual lock (noop)');
        return;
      }

      const manualFieldsSet = new Set(metaEs?.manualFields ?? []);
      const fieldHashes = metaEs?.fieldHashes ?? {};
      const work: Array<{ key: string; text: string; hash: string }> = [];
      const skippedDueToLength: string[] = [];
      const skippedDueToLengthMeta: Array<{ fieldPath: string; sourceLength: number }> = [];
      const unknownTaxonomyTerms: UnknownTaxonomyTermEntry[] = [];
      const update: Record<string, unknown> = {};
      const newFieldHashes: Record<string, string> = { ...fieldHashes };

      // Chip array fields: translate via tenant taxonomy (no OpenAI)
      const taxonomyEs = settings.taxonomy?.es;
      for (const fieldName of CHIP_ARRAY_FIELDS) {
        const i18nKey = `${fieldName}_i18n`;
        if (manualFieldsSet.has(i18nKey)) continue;

        const raw = data[fieldName];
        const legacyArray = Array.isArray(raw)
          ? (raw as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
          : [];
        if (legacyArray.length === 0) continue;

        const existingI18n = data[i18nKey] as { en?: string[]; es?: string[] } | undefined;
        const arrayHash = computeHash(JSON.stringify(legacyArray.slice().sort()));
        const prevHash = fieldHashes[i18nKey];
        const hasEs = Array.isArray(existingI18n?.es) && existingI18n.es.length > 0;
        if (hasEs && prevHash === arrayHash) continue;

        const { translated, missingTerms } = translateTaxonomyArray(legacyArray, taxonomyEs);
        for (const term of missingTerms) {
          unknownTaxonomyTerms.push({ term, docPath, fieldName });
        }
        update[`${i18nKey}.en`] = legacyArray;
        update[`${i18nKey}.es`] = translated;
        newFieldHashes[i18nKey] = arrayHash;
      }

      for (const f of fields) {
        if (manualFieldsSet.has(f.fieldPath)) continue;

        const isWorkerPath = docType === 'job_order' && isWorkerFacingStaffInstructionPath(f.fieldPath);
        let sourceText: string;
        let hasEs: boolean;

        if (isWorkerPath) {
          sourceText = (f.sourceText ?? String(getNested(data, f.fieldPath) ?? '')).trim();
          const section = staffInstructionPathToSection(f.fieldPath);
          const staffI18n = data.staffInstructions_i18n as Record<string, { es?: string }> | undefined;
          hasEs = Boolean(section && staffI18n?.[section]?.es);
        } else {
          const fieldObj = data[f.fieldPath] as { en?: string; es?: string } | undefined;
          sourceText = (fieldObj?.en ?? f.sourceText ?? '').trim();
          hasEs = Boolean(fieldObj?.es);
        }

        if (!sourceText) continue;

        if (sourceText.length > MAX_SOURCE_LENGTH) {
          skippedDueToLength.push(f.fieldPath);
          skippedDueToLengthMeta.push({ fieldPath: f.fieldPath, sourceLength: sourceText.length });
          continue;
        }

        const hash = computeHash(sourceText);
        const prevHash = fieldHashes[f.fieldPath];
        if (hasEs && prevHash === hash) continue;

        work.push({ key: f.fieldPath, text: sourceText, hash });
      }

      if (work.length > 0) {
        let apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
        if (!apiKey) apiKey = await getOpenAIKey(tenantId);
        if (!apiKey) {
          res.status(500).send('OPENAI_API_KEY not configured');
          return;
        }
        const client = new OpenAI({ apiKey });
        const result = await translateBatchEnToEs({
          client,
          items: work.map((w) => ({ key: w.key, text: w.text })),
          settings,
          model: DEFAULT_MODEL,
        });
        for (const item of result.items) {
          const w = work.find((x) => x.key === item.key);
          if (!w) continue;

          const translated = String(item.translated ?? '').trim();
          if (!translated) continue;

          if (!placeholdersMatch(w.text, translated)) {
            throw new Error(`Placeholder mismatch for ${item.key}`);
          }

          const writeKey =
            docType === 'job_order' && isWorkerFacingStaffInstructionPath(item.key)
              ? staffInstructionPathToI18nWriteKey(item.key, 'es')
              : `${item.key}.es`;
          if (writeKey) {
            update[writeKey] = translated;
          }
          newFieldHashes[item.key] = w.hash;
        }
      }

      if (Object.keys(update).length === 0) {
        if (skippedDueToLength.length > 0 || unknownTaxonomyTerms.length > 0) {
          await writeTranslationLog(db, {
            tenantId,
            docPath,
            durationMs: Date.now() - t0,
            status: 'success',
            ...(skippedDueToLength.length > 0 && { skippedDueToLength }),
            ...(unknownTaxonomyTerms.length > 0 && { unknownTaxonomyTerms }),
            ...(logLevel === 'verbose' && skippedDueToLengthMeta.length > 0 && { skippedDueToLengthMeta }),
          });
        }
        res.status(200).send('Nothing to do (noop)');
        return;
      }

      update['translationMeta.es'] = {
        sourceHash: work.length > 0 ? work[work.length - 1]?.hash ?? '' : '',
        fieldHashes: newFieldHashes,
        status: 'auto',
        manualFields: metaEs?.manualFields ?? [],
        updatedAt: FieldValue.serverTimestamp(),
        model: DEFAULT_MODEL,
      };

      await docRef.update(update);

      await writeTranslationLog(db, {
        tenantId,
        docPath,
        fieldCount: Object.keys(update).filter((k) => typeof k === 'string' && (k.endsWith('.es') || k.includes('_i18n.'))).length,
        durationMs: Date.now() - t0,
        status: 'success',
        model: work.length > 0 ? DEFAULT_MODEL : undefined,
        ...(skippedDueToLength.length > 0 && { skippedDueToLength }),
        ...(unknownTaxonomyTerms.length > 0 && { unknownTaxonomyTerms }),
        ...(logLevel === 'verbose' && {
          fieldMeta: work.map((w) => ({ fieldPath: w.key, sourceLength: w.text.length })),
          ...(skippedDueToLengthMeta.length > 0 && { skippedDueToLengthMeta }),
        }),
      });

      res.status(200).send('OK');
    } catch (e: unknown) {
      await writeTranslationLog(db, {
        tenantId,
        docPath,
        durationMs: Date.now() - t0,
        status: 'error',
        error: String((e as Error)?.message ?? e),
      });

      if (isRetryable(e)) {
        res.status(503).send('Retryable error');
        return;
      }
      res.status(200).send('Non-retryable error (logged)');
    }
  }
);
