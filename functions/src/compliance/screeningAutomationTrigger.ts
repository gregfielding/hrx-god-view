/**
 * When an assignment transitions to status "confirmed", optionally auto-order AccuSource screening
 * using Job Order → Location defaults → Account package resolution.
 *
 * Safety: env + tenant config, dry-run mode, audit logs, idempotency per assignment run doc.
 */

import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { createBackgroundCheckInternal } from '../integrations/accusource/createBackgroundCheck';
import type { CreateBackgroundCheckInput } from '../integrations/accusource/mapper';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';
import { resolveScreeningAutomationConfig } from './screeningAutomationConfig';
import type { BgLike } from './screeningAutomationShared';
import {
  evaluateScreeningSatisfiedServer,
  mergeScreeningPackageFromLayers,
  packageFingerprint,
  requestedEquivalencyKey,
  screeningLocationKeyCandidates,
} from './screeningAutomationShared';
import { writeWorkerActivityLog } from './workerActivityLog';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const AUTOMATION_ACTOR_UID = 'hrx_screening_automation';

function isAlreadyExistsError(e: unknown): boolean {
  const code = (e as { code?: string | number })?.code;
  return code === 'already-exists' || code === 6;
}

async function writeAudit(tenantId: string, payload: Record<string, unknown>): Promise<void> {
  await db.collection('tenants').doc(tenantId).collection('screening_automation_audit').add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export const onAssignmentConfirmedScreeningAutomation = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: 'us-central1',
  },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    const tenantId = event.params.tenantId as string;
    const assignmentId = event.params.assignmentId as string;

    if (!after || !before) return;

    const prevStatus = String(before.status || '').toLowerCase();
    const nextStatus = String(after.status || '').toLowerCase();
    if (nextStatus !== 'confirmed' || prevStatus === 'confirmed') {
      return;
    }

    const cfg = await resolveScreeningAutomationConfig(tenantId);
    if (!cfg.enabled) {
      logger.info('[screeningAutomation] disabled', { tenantId, assignmentId });
      return;
    }

    const runRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('screening_automation_runs')
      .doc(assignmentId);

    const existing = await runRef.get();
    if (existing.exists) {
      const st = String(existing.data()?.status || '');
      if (['completed', 'dry_run_completed', 'skipped_satisfied', 'skipped_no_package'].includes(st)) {
        logger.info('[screeningAutomation] idempotent skip — run already finalized', {
          tenantId,
          assignmentId,
          status: st,
        });
        return;
      }
      if (st === 'processing') {
        logger.warn('[screeningAutomation] concurrent run in progress; skipping', { tenantId, assignmentId });
        return;
      }
      if (st === 'failed') {
        await runRef.delete();
      }
    }

    const candidateId = String(after.candidateId || after.userId || '').trim();
    const jobOrderId = String(after.jobOrderId || '').trim();
    if (!candidateId || !jobOrderId) {
      logger.info('[screeningAutomation] missing candidate or job order', { tenantId, assignmentId });
      await writeAudit(tenantId, {
        assignmentId,
        candidateId: candidateId || null,
        jobOrderId: jobOrderId || null,
        outcome: 'skipped_missing_refs',
        reasonSummary: 'Assignment confirmed but candidateId/userId or jobOrderId is missing; automation cannot resolve packages or order.',
        dryRun: cfg.dryRun,
      });
      return;
    }

    const joRef = db.collection('tenants').doc(tenantId).collection('job_orders').doc(jobOrderId);
    const joSnap = await joRef.get();
    const jobOrder = joSnap.exists ? (joSnap.data() as Record<string, unknown>) : undefined;

    const accountIdForPath =
      String(
        jobOrder?.entityId ||
          jobOrder?.accountId ||
          after.accountId ||
          after.companyId ||
          jobOrder?.companyId ||
          ''
      ).trim() || '';
    const locationId = String(
      after.worksiteId || after.locationId || jobOrder?.locationId || jobOrder?.worksiteId || ''
    ).trim();
    const companyId = String(jobOrder?.companyId || jobOrder?.crmCompanyId || after.companyId || '').trim();

    let locationDefaults: Record<string, unknown> | undefined;
    if (jobOrder && accountIdForPath) {
      const keys = screeningLocationKeyCandidates(jobOrder, accountIdForPath, locationId, companyId);
      for (const key of keys) {
        const locSnap = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('accounts')
          .doc(accountIdForPath)
          .collection('location_defaults')
          .doc(key)
          .get();
        if (locSnap.exists) {
          locationDefaults = locSnap.data() as Record<string, unknown>;
          break;
        }
      }
    }

    let accountDoc: Record<string, unknown> | undefined;
    if (accountIdForPath) {
      const accSnap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('accounts')
        .doc(accountIdForPath)
        .get();
      if (accSnap.exists) accountDoc = accSnap.data() as Record<string, unknown>;
    }

    const merged = mergeScreeningPackageFromLayers(jobOrder, locationDefaults, accountDoc);
    const fp = packageFingerprint(merged.packageName, merged.packageId);
    const requestedKey = requestedEquivalencyKey(merged.packageId, merged.packageName);

    if (!merged.packageName && !merged.packageId) {
      logger.info('[screeningAutomation] no package resolved from layers', { tenantId, assignmentId });
      await writeAudit(tenantId, {
        assignmentId,
        candidateId,
        jobOrderId,
        outcome: 'skipped_no_package',
        reasonSummary:
          'No screening package name or id could be resolved from job order, location_defaults, or account.',
        resolvedPackageKey: requestedKey,
        packageFingerprint: fp,
        resolvedPackageLayers: merged,
        dryRun: cfg.dryRun,
      });
      await runRef.set(
        {
          status: 'skipped_no_package',
          fingerprint: fp,
          resolvedPackage: merged,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    const bgSnap = await db
      .collection('backgroundChecks')
      .where('candidateId', '==', candidateId)
      .where('tenantId', '==', tenantId)
      .limit(25)
      .get();

    const priorScreeningEvaluations: Array<{
      backgroundCheckId: string;
      equivalencyKey: string;
      satisfied: boolean;
      decisionDetail: string;
      hrxStatus?: string | null;
    }> = [];

    let satisfiedDocId: string | null = null;
    let satisfiedEv: ReturnType<typeof evaluateScreeningSatisfiedServer> | null = null;

    for (const doc of bgSnap.docs) {
      const row = doc.data() as BgLike;
      const ev = evaluateScreeningSatisfiedServer(row, {
        requestedEquivalencyKey: requestedKey,
        enforceEquivalency: true,
        enforceValidityWindow: false,
      });
      priorScreeningEvaluations.push({
        backgroundCheckId: doc.id,
        equivalencyKey: ev.equivalencyKey,
        satisfied: ev.satisfied,
        decisionDetail: ev.decisionDetail,
        hrxStatus: row.hrxStatus,
      });
      if (ev.satisfied && !satisfiedDocId) {
        satisfiedDocId = doc.id;
        satisfiedEv = ev;
      }
    }

    if (satisfiedDocId && satisfiedEv) {
      logger.info('[screeningAutomation] satisfied by existing order', {
        tenantId,
        assignmentId,
        backgroundCheckId: satisfiedDocId,
        equivalencyKey: satisfiedEv.equivalencyKey,
      });
      await writeAudit(tenantId, {
        assignmentId,
        candidateId,
        jobOrderId,
        outcome: 'skipped_already_satisfied',
        reasonSummary:
          'No new order: an existing background check satisfies the resolved package key and completion rules.',
        resolvedPackageKey: requestedKey,
        packageFingerprint: fp,
        resolvedPackageLayers: merged,
        matchedBackgroundCheckIds: [satisfiedDocId],
        priorScreeningEvaluations,
        matchedEquivalencyKey: satisfiedEv.equivalencyKey,
        dryRun: cfg.dryRun,
      });
      await runRef.set(
        {
          status: 'skipped_satisfied',
          fingerprint: fp,
          matchedBackgroundCheckId: satisfiedDocId,
          resolvedPackageKey: requestedKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await writeWorkerActivityLog({
        userId: candidateId,
        action: 'Screening automation',
        description: `Assignment confirmed: existing screening already satisfies required package key ${requestedKey} (matched backgroundChecks/${satisfiedDocId}).`,
        severity: 'low',
        metadata: {
          assignmentId,
          jobOrderId,
          tenantId,
          automation: true,
          resolvedPackageKey: requestedKey,
          matchedBackgroundCheckId: satisfiedDocId,
        },
      });
      return;
    }

    const userSnap = await db.collection('users').doc(candidateId).get();
    const u = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;

    const orderPayload: CreateBackgroundCheckInput = {
      tenantId,
      accountId: accountIdForPath || undefined,
      accountName: String(jobOrder?.accountName || jobOrder?.entityName || accountDoc?.name || '') || undefined,
      candidateId,
      candidateName:
        [u.firstName, u.lastName].filter(Boolean).join(' ') || String(u.email || candidateId),
      jobOrderId,
      worksiteId: locationId || undefined,
      requestedPackageId: merged.packageId || undefined,
      requestedPackageName: merged.packageName || undefined,
      requestedServices: [],
      candidate: {
        firstName: String(u.firstName || ''),
        lastName: String(u.lastName || ''),
        email: String(u.email || ''),
        phone: String(u.phone || u.phoneE164 || ''),
        dateOfBirth: String(u.dateOfBirth || u.dob || ''),
      },
    };

    const wouldLog = {
      tenantId,
      assignmentId,
      candidateId,
      jobOrderId,
      dryRun: cfg.dryRun,
      resolvedPackage: merged,
      fingerprint: fp,
      resolvedPackageKey: requestedKey,
      reasonSummary:
        priorScreeningEvaluations.length === 0
          ? 'No prior backgroundChecks rows for this candidate+tenant; ordering required package.'
          : 'No prior order satisfied both completion status and package equivalency; see priorScreeningEvaluations.',
      priorScreeningEvaluations,
      requestedEquivalencyKey: requestedKey,
      orderPayloadPreview: {
        ...orderPayload,
        candidate: orderPayload.candidate,
      },
    };

    logger.info('[screeningAutomation] evaluation', wouldLog);

    try {
      await runRef.create({
        status: 'processing',
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        fingerprint: fp,
        dryRun: cfg.dryRun,
        candidateId,
        jobOrderId,
      });
    } catch (e: unknown) {
      if (isAlreadyExistsError(e)) {
        logger.info('[screeningAutomation] idempotent skip — run doc already created', {
          tenantId,
          assignmentId,
        });
        return;
      }
      throw e;
    }

    await writeAudit(tenantId, {
      ...wouldLog,
      outcome: cfg.dryRun ? 'dry_run' : 'order_attempt',
    });

    if (cfg.dryRun) {
      await runRef.set(
        {
          status: 'dry_run_completed',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          wouldOrderPayload: orderPayload,
          resolvedPackage: merged,
        },
        { merge: true }
      );
      await writeWorkerActivityLog({
        userId: candidateId,
        action: 'Screening automation (dry run)',
        description: `DRY RUN: would order AccuSource screening for package ${merged.packageName || merged.packageId || '—'} (assignment ${assignmentId}).`,
        severity: 'low',
        metadata: {
          tenantId,
          assignmentId,
          jobOrderId,
          dryRun: true,
          fingerprint: fp,
          nameSource: merged.nameSource,
          idSource: merged.idSource,
        },
      });
      logger.info('[screeningAutomation] dry run complete — no provider call', { tenantId, assignmentId });
      return;
    }

    try {
      const result = await createBackgroundCheckInternal(
        { ...orderPayload, candidate: orderPayload.candidate },
        AUTOMATION_ACTOR_UID
      );

      await db
        .collection('backgroundChecks')
        .doc(result.backgroundCheckId)
        .set(
          {
            automationSource: 'assignment_confirmed',
            automationAssignmentId: assignmentId,
            automationTenantId: tenantId,
            automationFingerprint: fp,
            automationOrderedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      await runRef.set(
        {
          status: 'completed',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          backgroundCheckId: result.backgroundCheckId,
          fingerprint: fp,
          dryRun: false,
        },
        { merge: true }
      );

      await writeWorkerActivityLog({
        userId: candidateId,
        action: 'Screening ordered',
        description: `A background screening was ordered automatically when your assignment was confirmed (package: ${merged.packageName || merged.packageId || 'see order'}).`,
        severity: 'medium',
        metadata: {
          tenantId,
          assignmentId,
          jobOrderId,
          backgroundCheckId: result.backgroundCheckId,
          automation: true,
        },
      });

      await sendNotificationAndPush({
        uid: candidateId,
        tenantId,
        title: 'Background screening started',
        body: 'Your assignment is confirmed and a background screening order has been placed. Complete any applicant steps from your profile.',
        type: 'document',
        category: 'profile',
        deepLink: '/c1/workers/profile',
        source: 'automation',
        metadata: {
          assignmentId,
          jobOrderId,
          backgroundCheckId: result.backgroundCheckId,
          kind: 'screening_auto_ordered',
        },
      });

      logger.info('[screeningAutomation] order placed', {
        tenantId,
        assignmentId,
        backgroundCheckId: result.backgroundCheckId,
      });

      await writeAudit(tenantId, {
        ...wouldLog,
        outcome: 'ordered_live',
        reasonSummary: 'AccuSource order created via automation; worker notified.',
        newBackgroundCheckId: result.backgroundCheckId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[screeningAutomation] order failed', { tenantId, assignmentId, message });
      await runRef.set(
        {
          status: 'failed',
          error: message,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await writeAudit(tenantId, {
        assignmentId,
        candidateId,
        jobOrderId,
        outcome: 'order_failed',
        reasonSummary: 'Provider or internal error while creating AccuSource order.',
        resolvedPackageKey: requestedKey,
        packageFingerprint: fp,
        priorScreeningEvaluations,
        error: message,
        dryRun: false,
      });
    }
  }
);
