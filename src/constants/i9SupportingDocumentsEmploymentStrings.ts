/**
 * Employment-tab I-9 supporting docs + worker messaging (EN).
 * Spanish: mirror keys in i9SupportingDocumentsEmploymentStringsEs export for translators.
 */

export const I9_EMPLOYMENT_PURPOSE =
  'Upload and review List A or List B + C documents needed to complete the employer portion of the I-9.';

export const I9_WORKER_UPLOAD_HEADING = 'Upload your I-9 documents';

export const I9_WORKER_PATH_CHOICE_TITLE = 'What are you uploading?';
export const I9_WORKER_PATH_LIST_A = 'One List A document (identity and work authorization)';
export const I9_WORKER_PATH_LIST_BC = 'List B + List C (one identity document and one work authorization document)';

export const I9_WORKER_PATH_HINT_A =
  'Upload the file for your List A document when your employer has requested it. You need either one approved List A, or one approved List B and one approved List C.';

export const I9_WORKER_PATH_HINT_BC =
  'You will upload two files: one List B and one List C, when your employer has requested them.';

/** Shown on worker entity employment page (examples only). */
export const I9_WORKER_ENTITY_EXAMPLES = `Examples:
• List A: U.S. passport or passport card, Permanent Resident Card (Form I-551), Employment Authorization (Form I-766)
• List B: Driver’s license or state-issued ID
• List C: Social Security card, birth certificate`;

/** Worker SMS / push — profile hub (no entity link). */
export const I9_MESSAGE_REQUEST_UPLOAD_SMS = `Please upload your I-9 documents to move forward. Open My Profile → Employment, choose your employer, then follow I-9 steps. Upload either one List A document, or one List B and one List C document.`;

/** When you have an absolute URL to the worker’s entity employment page. */
export const I9_MESSAGE_REQUEST_UPLOAD_SMS_DEEPLINK = (absoluteUrl: string, entityName?: string) =>
  `Please upload your I-9 documents to move forward.${
    entityName ? ` Open your employment with ${entityName}:` : ' Open this link:'
  } ${absoluteUrl} — upload either one List A document, or one List B and one List C document.`;

export const I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY_DEEPLINK = (absoluteUrl: string, entityName?: string) =>
  `Please upload your I-9 documents to move forward.

${entityName ? `Open your employment with ${entityName}:` : 'Open your employment page:'}
${absoluteUrl}

Upload either:
• one List A document, or
• one List B and one List C document.`;

export const I9_MESSAGE_REUPLOAD_SMS_DEEPLINK = (reason: string, absoluteUrl: string) =>
  `Please re-upload your I-9 documents. Reason: ${reason}\nUse this link to replace your file(s): ${absoluteUrl}`;

export const I9_MESSAGE_REUPLOAD_EMAIL_BODY_DEEPLINK = (reason: string, absoluteUrl: string) =>
  `Please re-upload your I-9 documents.

Reason: ${reason}

Use this link to replace your file(s):
${absoluteUrl}`;

export const I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT = 'Action needed: Upload your I-9 documents';

export const I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY = `Please upload your I-9 documents to move forward.

Open My Profile → Employment, choose your employer, then follow I-9 steps. Upload either:
• one List A document, or
• one List B and one List C document.`;

export const I9_MESSAGE_REUPLOAD_SMS = (reason: string) =>
  `Please re-upload your I-9 documents. Reason: ${reason}\nOpen My Profile → Employment, open your employer, and replace the file(s).`;

export const I9_MESSAGE_REUPLOAD_EMAIL_SUBJECT = 'Please re-upload your I-9 documents';

export const I9_MESSAGE_REUPLOAD_EMAIL_BODY = (reason: string) =>
  `Please re-upload your I-9 documents.

Reason: ${reason}

Open My Profile → Employment, open your employer, and replace the file(s).`;

export const I9_MESSAGE_APPROVED_SMS =
  'Your I-9 documents have been approved. You’re all set.';

export const I9_MESSAGE_APPROVED_EMAIL_SUBJECT = 'Your I-9 documents are approved';

export const I9_MESSAGE_APPROVED_EMAIL_BODY =
  'Your I-9 documents have been approved. No further action is needed for this step.';

/** After staff creates request — in-app alert (not SMS). */
export const I9_REQUEST_CREATED_STAFF_HINT =
  'Request created — tell the worker: My Profile → Employment → their employer → I-9 documents (or send a link to their employment page if you have it).';

export const I9_APPROVE_CONFIRM_BODY =
  'Approve this document? It counts toward the I-9 document requirement when the full set (List A or List B + C) is approved.';

/** Spanish-ready (draft) — same structure for i18n files. */
export const i9SupportingDocumentsEmploymentStringsEs = {
  purpose: I9_EMPLOYMENT_PURPOSE,
  workerUploadHeading: 'Sube tus documentos del I-9',
  pathChoiceTitle: '¿Qué vas a subir?',
  pathListA: 'Un documento de la Lista A (identidad y autorización de trabajo)',
  pathListBC: 'Lista B + Lista C (un documento de identidad y uno de autorización de trabajo)',
  requestUploadSms: I9_MESSAGE_REQUEST_UPLOAD_SMS,
} as const;
