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

/** Worker SMS / push — short path per product (no deep nested nav). */
export const I9_MESSAGE_REQUEST_UPLOAD_SMS = `Please upload your I-9 documents to move forward. Open your profile → Employment. Upload either one List A document, or one List B and one List C document.`;

export const I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT = 'Action needed: Upload your I-9 documents';

export const I9_MESSAGE_REQUEST_UPLOAD_EMAIL_BODY = `Please upload your I-9 documents to move forward.

Open your profile → Employment. Upload either:
• one List A document, or
• one List B and one List C document.`;

export const I9_MESSAGE_REUPLOAD_SMS = (reason: string) =>
  `Please re-upload your I-9 documents. Reason: ${reason}\nOpen your profile → Employment and replace the file(s).`;

export const I9_MESSAGE_REUPLOAD_EMAIL_SUBJECT = 'Please re-upload your I-9 documents';

export const I9_MESSAGE_REUPLOAD_EMAIL_BODY = (reason: string) =>
  `Please re-upload your I-9 documents.

Reason: ${reason}

Open your profile → Employment and replace the file(s).`;

export const I9_MESSAGE_APPROVED_SMS =
  'Your I-9 documents have been approved. You’re all set.';

export const I9_MESSAGE_APPROVED_EMAIL_SUBJECT = 'Your I-9 documents are approved';

export const I9_MESSAGE_APPROVED_EMAIL_BODY =
  'Your I-9 documents have been approved. No further action is needed for this step.';

/** After staff creates request — in-app alert (not SMS). */
export const I9_REQUEST_CREATED_STAFF_HINT =
  'Request created — tell the worker: Open your profile → Employment';

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
