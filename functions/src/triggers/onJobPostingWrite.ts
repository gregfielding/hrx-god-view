/**
 * Firestore trigger: on write to job_postings, enqueue translation task when EN content
 * (or missing ES) requires translation. Skips translation-only writes to avoid loops.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isTranslationOnlyWrite, getFieldsNeedingTranslation } from '../translation';
import { enqueueTranslationTask } from '../tasks/enqueueTranslationTask';
import type { DocumentData } from '../translation';

export const onJobPostingWrite = onDocumentWritten(
  'tenants/{tenantId}/job_postings/{jobId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobId = event.params.jobId as string;

    const before = event.data?.before?.data() as DocumentData | undefined;
    const after = event.data?.after?.data() as DocumentData | undefined;

    if (!after) return;

    if (process.env.TRANSLATION_ENABLED !== 'true') return;

    if (isTranslationOnlyWrite(before, after)) return;

    const fields = getFieldsNeedingTranslation(before, after);
    if (fields.length === 0) return;

    const docPath = `tenants/${tenantId}/job_postings/${jobId}`;
    await enqueueTranslationTask({
      tenantId,
      docPath,
      fields: fields.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: 'en',
      targetLang: 'es',
    });
  }
);
