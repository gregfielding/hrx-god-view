/**
 * Firestore trigger: on write to shifts subcollection, enqueue translation when *_i18n or
 * worker-facing scalar fields (shiftTitle, defaultJobTitle, shiftDescription, emailIntro) need ES.
 * Path: tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  isTranslationOnlyWrite,
  getFieldsNeedingTranslation,
  getShiftScalarWorkerFacingFieldsNeedingTranslation,
} from '../translation';
import { enqueueTranslationTask } from '../tasks/enqueueTranslationTask';
import type { DocumentData } from '../translation';

export const onShiftWrite = onDocumentWritten(
  'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const shiftId = event.params.shiftId as string;

    const before = event.data?.before?.data() as DocumentData | undefined;
    const after = event.data?.after?.data() as DocumentData | undefined;

    if (!after) return;
    if (process.env.TRANSLATION_ENABLED !== 'true') return;
    if (isTranslationOnlyWrite(before, after)) return;

    const i18nFields = getFieldsNeedingTranslation(before, after, { autoDiscover: true });
    const scalarFields = getShiftScalarWorkerFacingFieldsNeedingTranslation(before, after);
    const fields = [...i18nFields, ...scalarFields];
    if (fields.length === 0) return;

    const docPath = `tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`;
    await enqueueTranslationTask({
      tenantId,
      docPath,
      fields: fields.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: 'en',
      targetLang: 'es',
      docType: 'shift',
    });
  }
);
