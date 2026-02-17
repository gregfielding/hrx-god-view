/**
 * Firestore trigger: on write to job_orders, enqueue translation when *_i18n or
 * worker-facing staffInstructions.*.text need ES. Uses auto-discovery plus
 * discoverWorkerFacingJobOrderFields (writes to staffInstructions_i18n.*.es).
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  isTranslationOnlyWrite,
  getFieldsNeedingTranslation,
  getWorkerFacingJobOrderFieldsNeedingTranslation,
  getJobOrderScalarWorkerFacingFieldsNeedingTranslation,
} from '../translation';
import { enqueueTranslationTask } from '../tasks/enqueueTranslationTask';
import type { DocumentData } from '../translation';

export const onJobOrderWrite = onDocumentWritten(
  'tenants/{tenantId}/job_orders/{jobOrderId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;

    const before = event.data?.before?.data() as DocumentData | undefined;
    const after = event.data?.after?.data() as DocumentData | undefined;

    if (!after) return;
    if (process.env.TRANSLATION_ENABLED !== 'true') return;
    if (isTranslationOnlyWrite(before, after)) return;

    const i18nFields = getFieldsNeedingTranslation(before, after, { autoDiscover: true });
    const workerFields = getWorkerFacingJobOrderFieldsNeedingTranslation(before, after);
    const scalarFields = getJobOrderScalarWorkerFacingFieldsNeedingTranslation(before, after);
    const fields = [...i18nFields, ...workerFields, ...scalarFields];
    if (fields.length === 0) return;

    const docPath = `tenants/${tenantId}/job_orders/${jobOrderId}`;
    await enqueueTranslationTask({
      tenantId,
      docPath,
      fields: fields.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: 'en',
      targetLang: 'es',
      docType: 'job_order',
    });
  }
);
