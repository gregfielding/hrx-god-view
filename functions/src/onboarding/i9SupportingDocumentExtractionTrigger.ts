/**
 * Firestore trigger: when a worker uploads an I-9 supporting document (storagePath set),
 * run Google Document AI and persist namespaced documentExtraction (assistive only; no auto-approval).
 */
import * as admin from 'firebase-admin';
import { DocumentProcessorServiceClient, protos } from '@google-cloud/documentai';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getStorage } from 'firebase-admin/storage';

import { getStorageBucketName } from '../utils/storageBucket';
import {
  mapDocumentAiToExtractedFields,
  resolveProcessorKindForDocumentType,
  resolveProcessorResourceName,
} from './i9SupportingDocumentExtractionMapper';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type ExtractionStatus = 'extraction_pending' | 'extraction_complete' | 'extraction_failed' | 'extraction_unsupported';

const TERMINAL: ExtractionStatus[] = ['extraction_complete', 'extraction_failed', 'extraction_unsupported'];

const KEYS_STABLE: Array<keyof admin.firestore.DocumentData> = [
  'tenantId',
  'userId',
  'documentType',
  'storagePath',
  'status',
  'uploadedAt',
  'reviewedAt',
  'reviewedBy',
  'rejectionReason',
  'uploadedFileName',
  'uploadedContentType',
  'requestedForEntityId',
  'requestedFromAssignmentId',
  'createdByUid',
  'createdAt',
  'retainUntil',
  'lastUsedForEntityId',
  'lastUsedAt',
];

function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof admin.firestore.Timestamp) return v.toMillis();
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    try {
      return (v as admin.firestore.Timestamp).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const ma = tsMillis(a);
  const mb = tsMillis(b);
  if (ma != null && mb != null) return ma === mb;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Second invocation after we write documentExtraction — avoid re-processing and infinite loops.
 */
function isOnlyDocumentExtractionEcho(
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): boolean {
  if (!before || !after) return false;
  for (const k of KEYS_STABLE) {
    if (!fieldEqual(before[k], after[k])) return false;
  }
  return !fieldEqual(before.documentExtraction, after.documentExtraction);
}

function terminalExtractionForPath(
  ext: Record<string, unknown> | undefined,
  storagePath: string,
): boolean {
  if (!ext || String(ext.sourceStoragePath || '').trim() !== storagePath) return false;
  const st = String(ext.status || '') as ExtractionStatus;
  return TERMINAL.includes(st);
}

function mimeForUpload(contentType: unknown, storagePath: string): string {
  const c = String(contentType || '').trim().toLowerCase();
  if (c && c !== 'application/octet-stream') return c;
  const lower = storagePath.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}

export const onWorkerI9SupportingDocumentExtract = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/worker_i9_supporting_documents/{documentId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 10,
  },
  async (event) => {
    const { tenantId, documentId } = event.params as { tenantId: string; documentId: string };
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;

    if (!afterSnap?.exists) {
      return;
    }

    const beforeData = beforeSnap?.exists ? beforeSnap.data() : undefined;
    const afterData = afterSnap.data() as Record<string, unknown>;

    if (isOnlyDocumentExtractionEcho(beforeData, afterData)) {
      return;
    }

    const storagePath = String(afterData.storagePath || '').trim();
    const userId = String(afterData.userId || '').trim();
    const metaTenant = String(afterData.tenantId || '').trim();

    if (beforeData) {
      const pathSame = String(beforeData.storagePath || '').trim() === storagePath;
      const uploadSame = fieldEqual(beforeData.uploadedAt, afterData.uploadedAt);
      if (pathSame && uploadSame && storagePath) {
        // Staff review / retention / last-used updates — not a new upload.
        return;
      }
    }

    if (!storagePath || metaTenant !== tenantId || !userId) {
      return;
    }

    const expectedPrefix = `i9_docs/${tenantId}/${userId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      logger.warn('i9_supporting_extraction.bad_path_prefix', { tenantId, documentId, storagePath });
      return;
    }

    if (terminalExtractionForPath(afterData.documentExtraction as Record<string, unknown> | undefined, storagePath)) {
      return;
    }

    const documentType = String(afterData.documentType || '').trim();
    const processorKind = resolveProcessorKindForDocumentType(documentType);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = db.doc(`tenants/${tenantId}/worker_i9_supporting_documents/${documentId}`);

    if (!processorKind) {
      await docRef.set(
        {
          documentExtraction: {
            status: 'extraction_unsupported' as ExtractionStatus,
            requestedAt: now,
            completedAt: now,
            error: null,
            processorType: null,
            processorResourceName: null,
            sourceStoragePath: storagePath,
            extractedFields: null,
            extractedRawEntities: [],
            extractionWarnings: [
              'No automated extraction for this document type in v1 (only List B driver license uses Document AI; passport parser unavailable).',
            ],
            confidenceSummary: null,
            documentAiProcessorVersion: null,
            updatedAt: now,
          },
          updatedAt: now,
        },
        { merge: true },
      );
      logger.info('i9_supporting_extraction.unsupported', { tenantId, documentId, documentType });
      return;
    }

    const processorName = resolveProcessorResourceName(processorKind, process.env);
    if (!processorName) {
      await docRef.set(
        {
          documentExtraction: {
            status: 'extraction_failed' as ExtractionStatus,
            requestedAt: now,
            completedAt: now,
            error: {
              code: 'missing_processor_config',
              message: 'DOCUMENT_AI_PROCESSOR_* or DOCUMENT_AI_PROJECT_ID not configured for this environment.',
            },
            processorType: processorKind,
            processorResourceName: null,
            sourceStoragePath: storagePath,
            extractedFields: null,
            extractedRawEntities: [],
            extractionWarnings: [],
            confidenceSummary: null,
            documentAiProcessorVersion: null,
            updatedAt: now,
          },
          updatedAt: now,
        },
        { merge: true },
      );
      logger.error('i9_supporting_extraction.missing_config', { tenantId, documentId, processorKind });
      return;
    }

    const pendingPayload = {
      status: 'extraction_pending' as ExtractionStatus,
      requestedAt: now,
      completedAt: null,
      error: null,
      processorType: processorKind,
      processorResourceName: processorName,
      sourceStoragePath: storagePath,
      extractedFields: null,
      extractedRawEntities: [],
      extractionWarnings: [],
      confidenceSummary: null,
      documentAiProcessorVersion: null,
      updatedAt: now,
    };

    await docRef.set({ documentExtraction: pendingPayload, updatedAt: now }, { merge: true });

    try {
      const bucket = getStorage().bucket(getStorageBucketName());
      const [buf] = await bucket.file(storagePath).download();
      const mimeType = mimeForUpload(afterData.uploadedContentType, storagePath);

      const client = new DocumentProcessorServiceClient();
      const request: protos.google.cloud.documentai.v1.IProcessRequest = {
        name: processorName,
        rawDocument: {
          content: buf,
          mimeType,
        },
      };

      const [result] = await client.processDocument(request);

      const mapped = mapDocumentAiToExtractedFields(result.document);
      const doneAt = admin.firestore.FieldValue.serverTimestamp();

      await docRef.set(
        {
          documentExtraction: {
            status: 'extraction_complete' as ExtractionStatus,
            requestedAt: pendingPayload.requestedAt,
            completedAt: doneAt,
            error: null,
            processorType: processorKind,
            processorResourceName: processorName,
            sourceStoragePath: storagePath,
            extractedFields: mapped.extractedFields,
            extractedRawEntities: mapped.extractedRawEntities,
            extractionWarnings: mapped.extractionWarnings,
            confidenceSummary: mapped.confidenceSummary,
            documentAiProcessorVersion: null,
            updatedAt: doneAt,
          },
          updatedAt: doneAt,
        },
        { merge: true },
      );

      logger.info('i9_supporting_extraction.complete', {
        tenantId,
        documentId,
        documentType,
        processorKind,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failAt = admin.firestore.FieldValue.serverTimestamp();
      await docRef.set(
        {
          documentExtraction: {
            status: 'extraction_failed' as ExtractionStatus,
            requestedAt: pendingPayload.requestedAt,
            completedAt: failAt,
            error: {
              code: 'documentai_or_storage',
              message: msg.slice(0, 500),
            },
            processorType: processorKind,
            processorResourceName: processorName,
            sourceStoragePath: storagePath,
            extractedFields: null,
            extractedRawEntities: [],
            extractionWarnings: [],
            confidenceSummary: null,
            documentAiProcessorVersion: null,
            updatedAt: failAt,
          },
          updatedAt: failAt,
        },
        { merge: true },
      );
      logger.error('i9_supporting_extraction.failed', {
        tenantId,
        documentId,
        error: msg.slice(0, 300),
      });
    }
  },
);
