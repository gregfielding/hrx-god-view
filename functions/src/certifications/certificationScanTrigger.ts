/**
 * Firestore trigger: a worker certification record with an evidence file and
 * `review.status == 'submitted'` gets read by Claude, judged by the pure
 * verdict rules, and either auto-decided or queued for a human.
 *
 * Path: users/{userId}/certification_records/{recordId} (canonical rows —
 * see src/utils/certifications/createOrUpdateCertificationRecord.ts; the
 * web dual-write is on by default since 2026-09-08).
 *
 * Loop prevention: we write back to the same doc. Echoes are short-circuited
 * by (a) `review.status` no longer `submitted` after an auto decision, and
 * (b) `aiVerification.evidenceKey` + `promptVersion` already matching the
 * current evidence with a terminal status. A `pending` scan younger than
 * ten minutes is treated as in flight.
 *
 * Whatever writer moves the record out of `submitted` (this trigger, the
 * decision callable, an L5 edit in the profile tab), the queue mirror is
 * deleted here so the review page never shows a stale row.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { toTenantIdSet } from '../avatar/avatarAdminPerms';
import catalogManifestJson from '../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1, CatalogManifestEntryV1 } from '../shared/certifications/certificationCatalogManifest';
import type { CertificationRecordV1 } from '../shared/certifications/certificationRecord';
import {
  CERTIFICATION_SCAN_PROMPT_VERSION,
  type CertificationAiVerificationV1,
} from '../shared/certifications/certificationAiVerification';
import { decideCertificationVerdict, type VerdictResult } from './certificationVerdict';
import { CERT_SCAN_MODEL, evidenceKeyOf, loadEvidenceForModel, scanCertificationWithClaude } from './certificationScanClaude';
import { deleteQueueDocs, primaryTenantOf, upsertQueueDoc, workerDisplayName } from './certificationReviewQueue';
import { notifyWorkerCertification } from './certificationWorkerNotify';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const manifest = catalogManifestJson as unknown as CertificationCatalogManifestV1;
const IN_FLIGHT_MS = 10 * 60 * 1000;

function catalogEntry(id: string): CatalogManifestEntryV1 | null {
  return manifest.entries.find((e) => e.catalogEntryId === id) ?? null;
}

function tsMillis(v: unknown): number | null {
  if (v instanceof admin.firestore.Timestamp) return v.toMillis();
  const m = (v as { toMillis?: () => number } | null)?.toMillis;
  return typeof m === 'function' ? m.call(v) : null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const onCertificationRecordWrittenScan = onDocumentWritten(
  {
    document: 'users/{userId}/certification_records/{recordId}',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 120,
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const userId = event.params.userId as string;
    const recordId = event.params.recordId as string;
    const afterSnap = event.data?.after;
    const beforeSnap = event.data?.before;
    const before = beforeSnap?.exists ? (beforeSnap.data() as CertificationRecordV1) : null;

    if (!afterSnap?.exists) {
      // Record deleted (worker removed the cert, or a dedupe) — drop any queue row.
      await cleanupQueue(userId, recordId);
      return;
    }
    const record = afterSnap.data() as CertificationRecordV1;
    const reviewStatus = record.review?.status;

    if (reviewStatus !== 'submitted') {
      if (before?.review?.status === 'submitted') await cleanupQueue(userId, recordId);
      return;
    }

    const evidence = (record.evidenceFileRefs ?? []).find((r) => evidenceKeyOf(r));
    const evidenceKey = evidenceKeyOf(evidence);
    if (!evidence || !evidenceKey) return; // attestation-only: nothing to read

    const ai = record.aiVerification ?? null;
    const sameEvidence = !!ai && ai.evidenceKey === evidenceKey && ai.promptVersion === CERTIFICATION_SCAN_PROMPT_VERSION;
    if (sameEvidence && (ai!.status === 'complete' || ai!.status === 'unsupported')) {
      // Echo of our own write, or a re-save of an already-scanned record: make sure the queue row exists.
      if (ai!.verdict === 'needs_review') await ensureQueued(userId, recordId, record, ai!);
      return;
    }
    if (sameEvidence && ai!.status === 'pending') {
      const requested = tsMillis(ai!.requestedAt);
      if (requested != null && Date.now() - requested < IN_FLIGHT_MS) return;
    }

    const recordRef = afterSnap.ref;
    const pending: CertificationAiVerificationV1 = {
      status: 'pending',
      verdict: null,
      reasonCode: null,
      extracted: null,
      evidenceKey,
      model: CERT_SCAN_MODEL,
      promptVersion: CERTIFICATION_SCAN_PROMPT_VERSION,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      error: null,
      tokens: null,
    };
    await recordRef.set({ aiVerification: pending, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const userSnap = await db.doc(`users/${userId}`).get();
    const user = (userSnap.data() ?? {}) as Record<string, unknown>;
    const workerName = workerDisplayName(user);
    const entry = catalogEntry(record.catalogEntryId);
    const catalogCtx = {
      displayName: entry?.displayName ?? record.catalogEntryId,
      category: entry?.category ?? 'Unknown',
      type: entry?.type ?? 'Certification',
      issuerHint: entry?.issuerHint ?? null,
      aliases: entry?.aliases ?? [],
      hasExpiration: entry?.hasExpiration ?? false,
      validityPeriodYears: (entry as { validityPeriodYears?: number | null } | null)?.validityPeriodYears ?? null,
    };
    const claimed = { issuer: record.issuer ?? null, expirationDate: record.expirationDate ?? null };

    let verdict: VerdictResult;
    let final: CertificationAiVerificationV1;
    let mediaType: string | null = null;
    try {
      const loaded = await loadEvidenceForModel(evidence);
      if (loaded.ok === false) {
        const code = loaded.code === 'file_unsupported' ? 'file_unsupported' : 'scan_error';
        verdict = decideCertificationVerdict({ extraction: null, scanFailed: { code }, catalog: catalogCtx, claimed, workerName, todayISO: todayISO() });
        final = {
          ...pending,
          status: loaded.code === 'file_unsupported' ? 'unsupported' : 'error',
          verdict: verdict.verdict,
          reasonCode: verdict.reasonCode,
          error: { code: loaded.code, message: loaded.message.slice(0, 300) },
          scannedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      } else {
        mediaType = loaded.mediaType;
        const scan = await scanCertificationWithClaude({ fileBlock: loaded.block, catalog: catalogCtx, claimed, workerName, todayISO: todayISO() });
        verdict = decideCertificationVerdict({ extraction: scan.extraction, catalog: catalogCtx, claimed, workerName, todayISO: todayISO() });
        final = {
          ...pending,
          status: 'complete',
          verdict: verdict.verdict,
          reasonCode: verdict.reasonCode,
          extracted: scan.extraction,
          model: scan.model,
          tokens: scan.tokens,
          error: null,
          scannedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('certification_scan.failed', { userId, recordId, evidenceKey, error: message.slice(0, 400) });
      verdict = decideCertificationVerdict({ extraction: null, scanFailed: { code: 'scan_error' }, catalog: catalogCtx, claimed, workerName, todayISO: todayISO() });
      final = {
        ...pending,
        status: 'error',
        verdict: verdict.verdict,
        reasonCode: verdict.reasonCode,
        error: { code: 'scan_error', message: message.slice(0, 300) },
        scannedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = { aiVerification: final, updatedAt: now };
    const note = verdict.notes.join(' ').slice(0, 500) || null;
    if (verdict.verdict === 'auto_approve') {
      patch.review = { status: 'approved', rejectionReason: null, decidedBy: 'system', decidedAt: now, note };
      patch.recordStatus = 'active';
      if (verdict.fill.issuer && !record.issuer) patch.issuer = verdict.fill.issuer;
      if (verdict.fill.expirationDate) patch.expirationDate = verdict.fill.expirationDate;
    } else if (verdict.verdict === 'auto_reject') {
      patch.review = { status: 'rejected', rejectionReason: verdict.reasonCode, decidedBy: 'system', decidedAt: now, note };
      patch.recordStatus = 'rejected';
    }
    await recordRef.update(patch);

    logger.info('certification_scan.decided', {
      userId,
      recordId,
      catalogEntryId: record.catalogEntryId,
      verdict: verdict.verdict,
      reasonCode: verdict.reasonCode,
      confidence: final.extracted?.confidence ?? null,
      model: final.model,
      status: final.status,
    });

    if (verdict.verdict === 'needs_review') {
      await ensureQueued(userId, recordId, { ...record, aiVerification: final }, final, { user, mediaType });
      return;
    }
    await cleanupQueue(userId, recordId, user);
    try {
      await notifyWorkerCertification({
        userId,
        userData: user,
        kind: verdict.verdict === 'auto_approve' ? 'verified' : 'reupload',
        credentialName: catalogCtx.displayName,
        reasonCode: verdict.reasonCode,
        certificationRecordId: recordId,
        requestedByUid: 'system',
      });
    } catch (err) {
      logger.warn('certification_scan.notify_failed', { userId, recordId, error: (err as { message?: string })?.message });
    }
  },
);

async function ensureQueued(
  userId: string,
  recordId: string,
  record: CertificationRecordV1,
  ai: CertificationAiVerificationV1,
  ctx?: { user?: Record<string, unknown>; mediaType?: string | null },
): Promise<void> {
  const user = ctx?.user ?? (((await db.doc(`users/${userId}`).get()).data() ?? {}) as Record<string, unknown>);
  const tenants = toTenantIdSet(user);
  const tenantId = primaryTenantOf(user, tenants);
  if (!tenantId) {
    logger.warn('certification_scan.no_tenant_for_queue', { userId, recordId });
    return;
  }
  const entry = catalogEntry(record.catalogEntryId);
  const evidence = (record.evidenceFileRefs ?? []).find((r) => evidenceKeyOf(r)) ?? null;
  const submittedAt = (record.updatedAt instanceof admin.firestore.Timestamp ? record.updatedAt : null) ?? admin.firestore.FieldValue.serverTimestamp();
  await upsertQueueDoc(db, {
    tenantId,
    userId,
    certificationRecordId: recordId,
    workerName: workerDisplayName(user),
    workerPhoneE164: String(user.phoneE164 || '').trim() || null,
    catalogEntryId: record.catalogEntryId,
    displayName: entry?.displayName ?? record.catalogEntryId,
    claimed: { issuer: record.issuer ?? null, expirationDate: record.expirationDate ?? null },
    evidence: {
      storageUrl: evidence?.storageUrl ?? null,
      storagePath: evidence?.storagePath ?? null,
      fileName: evidence?.fileName ?? null,
      mediaType: ctx?.mediaType ?? null,
    },
    ai: {
      verdict: ai.verdict,
      reasonCode: ai.reasonCode,
      confidence: ai.extracted?.confidence ?? null,
      notes: [ai.extracted?.reviewerNotes ?? '', ai.error ? `${ai.error.code}: ${ai.error.message}` : ''].filter(Boolean).join(' ').slice(0, 800),
      extracted: ai.extracted ?? null,
      model: ai.model ?? null,
    },
    submittedAt,
  });
}

async function cleanupQueue(userId: string, recordId: string, userData?: Record<string, unknown>): Promise<void> {
  const user = userData ?? (((await db.doc(`users/${userId}`).get()).data() ?? {}) as Record<string, unknown>);
  const tenants = toTenantIdSet(user);
  const primary = primaryTenantOf(user, tenants);
  if (primary) tenants.add(primary);
  if (tenants.size === 0) return;
  const n = await deleteQueueDocs(db, userId, recordId, tenants);
  if (n > 0) logger.info('certification_scan.queue_cleared', { userId, recordId, removed: n });
}
