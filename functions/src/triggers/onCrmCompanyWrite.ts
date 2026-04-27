/**
 * Firestore trigger: on write to crm_companies, enqueue translation for worker-visible *_i18n fields.
 * Path: tenants/{tenantId}/crm_companies/{companyId}
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isTranslationOnlyWrite, getCrmCompanyDescriptionFieldsNeedingTranslation } from '../translation';
import { enqueueTranslationTask } from '../tasks/enqueueTranslationTask';
import type { DocumentData } from '../translation';

/**
 * Only the company description is translated (description_i18n.es).
 * Company name, address, contacts, and other identifiers are never translated.
 */
export const onCrmCompanyWrite = onDocumentWritten(
  'tenants/{tenantId}/crm_companies/{companyId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const companyId = event.params.companyId as string;

    const before = event.data?.before?.data() as DocumentData | undefined;
    const after = event.data?.after?.data() as DocumentData | undefined;

    if (!after) return;
    if (process.env.TRANSLATION_ENABLED !== 'true') return;
    if (isTranslationOnlyWrite(before, after)) return;

    const fields = getCrmCompanyDescriptionFieldsNeedingTranslation(before, after);
    if (fields.length === 0) return;

    const docPath = `tenants/${tenantId}/crm_companies/${companyId}`;
    await enqueueTranslationTask({
      tenantId,
      docPath,
      fields: fields.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: 'en',
      targetLang: 'es',
    });
  }
);
