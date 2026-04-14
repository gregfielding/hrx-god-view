/**
 * User groups: bulk profile update SMS (preview-first), for “Needs profile update first” bucket.
 * Retriggers workers who missed automated prescreen nudges or need a fresh profile prompt.
 */
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { sendWorkerMessageInternal } from '../twilio';
import { evaluateAiPrescreenEligibility } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { buildWorkerProfileUrl } from '../utils/workerUrls';
import { runUserGroupMemberNextStepEvaluation } from './userGroupMemberNextStepEvaluationCore';
import {
  firstNameFromUser,
  phoneE164FromUser,
  resolveC1SelectEntityId,
  tenantEligOpts,
  workerInterviewInviteLang,
} from './userGroupInterviewInviteValidation';
import {
  buildProfileReminderSmsBody,
  buildProfileReminderSmsBodyBilingualTemplate,
  hardValidateProfileReminderCandidate,
  mapEligibilityMissingFieldsToDisplay,
  mapEligibilityMissingFieldsToLabels,
  profileCooldownWarnings,
} from './userGroupProfileReminderValidation';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 20;
const HARD_CAP = 25;

function profileReminderLastSentIso(userData: Record<string, unknown> | undefined): string | null {
  if (!userData) return null;
  const v = userData.profileUpdateReminderLastSentAt;
  if (v == null) return null;
  if (typeof (v as admin.firestore.Timestamp).toDate === 'function') {
    return (v as admin.firestore.Timestamp).toDate().toISOString();
  }
  return null;
}

export type ProfileReminderRecipientPreview = {
  userId: string;
  applicationId: string | null;
  displayName: string;
  firstName: string;
  /** Recruiter-facing labels (e.g. phone number, experience). */
  missingFields: string[];
  profileUrlNote: string;
  smsLanguage: 'en' | 'es';
  cooldownWarnings: string[];
  /** ISO timestamp from `users.profileUpdateReminderLastSentAt`, if any. */
  lastProfileReminderSentAt: string | null;
};

export type SkippedRecipientRow = {
  userId: string;
  applicationId: string | null;
  displayName?: string;
  missingFields?: string[];
  lastProfileReminderSentAt?: string | null;
  smsLanguage?: 'en' | 'es';
  reasons: string[];
};

export type PerSendResult = {
  userId: string;
  applicationId: string | null;
  outcome: 'sent' | 'skipped' | 'failed';
  detail?: string;
  twilioMessageId?: string | null;
};

export type ProfileReminderPrepareResult = {
  action: 'prepare';
  flow: 'profile_reminder';
  tenantId: string;
  groupId: string;
  previewToken: string;
  previewExpiresAt: admin.firestore.Timestamp;
  templateKey: 'user_group_profile_reminder_v1';
  messageTemplate: string;
  confirmationRequired: string;
  selectedRecipients: ProfileReminderRecipientPreview[];
  skippedRecipients: SkippedRecipientRow[];
  evalCounts: Record<string, number>;
  /** Bucket-sized counts for this prepare. */
  counts: { selected: number; skipped: number; total: number };
  note: string;
};

export type ProfileReminderSendResult = {
  action: 'send';
  flow: 'profile_reminder';
  tenantId: string;
  groupId: string;
  previewToken: string;
  idempotencyKey: string;
  auditId: string;
  confirmationMatched: boolean;
  results: PerSendResult[];
  sent: number;
  skipped: number;
  failed: number;
  auditPayload: Record<string, unknown>;
};

async function loadEmploymentsForUsers(tenantId: string, userIds: string[]): Promise<Map<string, Array<Record<string, unknown>>>> {
  const employmentByUser = new Map<string, Array<Record<string, unknown>>>();
  for (let i = 0; i < userIds.length; i += 10) {
    const chunk = userIds.slice(i, i + 10);
    if (chunk.length === 0) continue;
    const emSnap = await db.collection(`tenants/${tenantId}/entity_employments`).where('userId', 'in', chunk).get();
    for (const ed of emSnap.docs) {
      const u = String((ed.data() as { userId?: string }).userId || '').trim();
      if (!u) continue;
      const arr = employmentByUser.get(u) ?? [];
      arr.push({ id: ed.id, ...(ed.data() as Record<string, unknown>) });
      employmentByUser.set(u, arr);
    }
  }
  return employmentByUser;
}

async function runPrepare(
  authUid: string,
  tenantId: string,
  groupId: string,
  maxRecipients: number,
  includeCooldownWarnings: boolean,
): Promise<ProfileReminderPrepareResult> {
  const groupSnap = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'User group not found');
  }
  const groupData = groupSnap.data() as { memberIds?: string[] };
  const memberIds = Array.isArray(groupData.memberIds) ? groupData.memberIds.map((x) => String(x).trim()).filter(Boolean) : [];

  const [tenantSnap, entitiesSnap, evalResult] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection(`tenants/${tenantId}/entities`).get(),
    runUserGroupMemberNextStepEvaluation(tenantId, groupId),
  ]);

  const entities = entitiesSnap.docs.map((d) => ({
    id: d.id,
    name: String((d.data() as { name?: string }).name || ''),
    entityCode: (d.data() as { entityCode?: string }).entityCode,
  }));
  const c1SelectEntityId = resolveC1SelectEntityId(entities);
  const eligOpts = tenantEligOpts((tenantSnap.data() || {}) as Record<string, unknown>);

  const profileRows = evalResult.rows
    .filter((r) => r.bucket === 'needs_profile_update')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const userIds = profileRows.map((r) => r.userId);
  const employmentByUser = await loadEmploymentsForUsers(tenantId, userIds);

  const skippedRecipients: SkippedRecipientRow[] = [];
  const passedWithMeta: Array<{
    row: (typeof profileRows)[0];
    userData: Record<string, unknown>;
    appData: Record<string, unknown> | undefined;
    cooldownWarnings: string[];
  }> = [];

  for (const row of profileRows) {
    const applicationId = row.applicationId;
    const [userSnap, appSnap] = await Promise.all([
      db.doc(`users/${row.userId}`).get(),
      applicationId ? db.doc(`tenants/${tenantId}/applications/${applicationId}`).get() : Promise.resolve(null as admin.firestore.DocumentSnapshot | null),
    ]);
    const userData = userSnap.data() as Record<string, unknown> | undefined;
    const appData = appSnap?.exists ? (appSnap.data() as Record<string, unknown>) : undefined;
    const employments = employmentByUser.get(row.userId) ?? [];

    const hard = hardValidateProfileReminderCandidate({
      tenantId,
      groupMemberIds: memberIds,
      userId: row.userId,
      userData,
      applicationData: appData,
      applicationId,
      groupId,
      allowNonGroupApplication: true,
      employments,
      c1SelectEntityId,
      eligOpts,
    });

    if (!hard.ok) {
      skippedRecipients.push({
        userId: row.userId,
        applicationId,
        displayName: row.displayName,
        missingFields: mapEligibilityMissingFieldsToLabels(row.missingFields),
        lastProfileReminderSentAt: profileReminderLastSentIso(userData as Record<string, unknown> | undefined),
        smsLanguage: workerInterviewInviteLang(userData as Record<string, unknown> | undefined),
        reasons: hard.blockReasons,
      });
      continue;
    }

    const cd = profileCooldownWarnings(userData as Record<string, unknown>, appData);
    passedWithMeta.push({
      row,
      userData: userData as Record<string, unknown>,
      appData,
      cooldownWarnings: cd,
    });
  }

  let pool = passedWithMeta;
  if (!includeCooldownWarnings) {
    for (const p of pool) {
      if (p.cooldownWarnings.length > 0) {
        skippedRecipients.push({
          userId: p.row.userId,
          applicationId: p.row.applicationId,
          displayName: p.row.displayName,
          missingFields: mapEligibilityMissingFieldsToLabels(p.row.missingFields),
          lastProfileReminderSentAt: profileReminderLastSentIso(p.userData),
          smsLanguage: workerInterviewInviteLang(p.userData),
          reasons: [...p.cooldownWarnings, '(skipped by default — enable “Override cooldown” to allow)'],
        });
      }
    }
    pool = pool.filter((p) => p.cooldownWarnings.length === 0);
  }

  const cap = Math.min(maxRecipients, HARD_CAP);
  const overflow = pool.slice(cap);
  for (const o of overflow) {
    skippedRecipients.push({
      userId: o.row.userId,
      applicationId: o.row.applicationId,
      displayName: o.row.displayName,
      missingFields: mapEligibilityMissingFieldsToLabels(o.row.missingFields),
      lastProfileReminderSentAt: profileReminderLastSentIso(o.userData),
      smsLanguage: workerInterviewInviteLang(o.userData),
      reasons: [`Not included in this batch (limit ${cap} per send; hard cap ${HARD_CAP})`],
    });
  }

  const selected = pool.slice(0, cap);

  const previewToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PREVIEW_TTL_MS);

  const selectedRecipients: ProfileReminderRecipientPreview[] = selected.map((p) => {
    const fn = firstNameFromUser(p.userData);
    return {
      userId: p.row.userId,
      applicationId: p.row.applicationId,
      displayName: p.row.displayName,
      firstName: fn,
      missingFields: mapEligibilityMissingFieldsToLabels(p.row.missingFields),
      profileUrlNote: 'SMS includes a short list of what is missing and your profile link.',
      smsLanguage: workerInterviewInviteLang(p.userData),
      cooldownWarnings: p.cooldownWarnings,
      lastProfileReminderSentAt: profileReminderLastSentIso(p.userData),
    };
  });

  const messageTemplate = buildProfileReminderSmsBodyBilingualTemplate();

  await db.doc(`tenants/${tenantId}/user_group_profile_reminder_previews/${previewToken}`).set({
    tenantId,
    groupId,
    createdByUid: authUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    recipients: selectedRecipients.map((r) => ({
      userId: r.userId,
      applicationId: r.applicationId,
      missingFields: r.missingFields,
    })),
    includeCooldownWarnings,
    requestedMax: maxRecipients,
    templateKey: 'user_group_profile_reminder_v1',
    evalCounts: evalResult.counts,
  });

  const n = selectedRecipients.length;
  const confirmationRequired = `SEND ${n}`;

  return {
    action: 'prepare',
    flow: 'profile_reminder',
    tenantId,
    groupId,
    previewToken,
    previewExpiresAt: expiresAt,
    templateKey: 'user_group_profile_reminder_v1',
    messageTemplate,
    confirmationRequired,
    selectedRecipients,
    skippedRecipients,
    evalCounts: evalResult.counts,
    counts: {
      selected: n,
      skipped: skippedRecipients.length,
      total: profileRows.length,
    },
    note:
      n === 0
        ? 'No recipients selected. Adjust filters or resolve skipped rows.'
        : `Type exactly “${confirmationRequired}” to confirm. Preview expires in ${Math.round(PREVIEW_TTL_MS / 60000)} minutes. Workers who already meet profile eligibility should receive interview invites instead.`,
  };
}

async function runSend(
  authUid: string,
  tenantId: string,
  groupId: string,
  previewToken: string,
  idempotencyKey: string,
  typedConfirmation: string,
): Promise<ProfileReminderSendResult> {
  if (!previewToken || !idempotencyKey) {
    throw new HttpsError('invalid-argument', 'previewToken and idempotencyKey are required');
  }

  const idemRef = db.doc(`tenants/${tenantId}/user_group_profile_reminder_idempotency/${idempotencyKey}`);
  const idemSnap = await idemRef.get();
  if (idemSnap.exists) {
    const d = idemSnap.data() as { result?: ProfileReminderSendResult; processing?: boolean; startedAt?: admin.firestore.Timestamp };
    if (d?.result) {
      return d.result;
    }
    if (d?.processing && d.startedAt && Date.now() - d.startedAt.toMillis() < 8 * 60 * 1000) {
      throw new HttpsError('resource-exhausted', 'A send with this idempotency key is already in progress. Wait and retry.');
    }
  }

  const previewRef = db.doc(`tenants/${tenantId}/user_group_profile_reminder_previews/${previewToken}`);
  const previewSnap = await previewRef.get();
  if (!previewSnap.exists) {
    throw new HttpsError('failed-precondition', 'Invalid or expired preview. Run Prepare send again.');
  }
  const preview = previewSnap.data() as {
    tenantId?: string;
    groupId?: string;
    createdByUid?: string;
    expiresAt?: admin.firestore.Timestamp;
    recipients?: Array<{ userId?: string; applicationId?: string | null; missingFields?: string[] }>;
    includeCooldownWarnings?: boolean;
  };

  if (preview.tenantId !== tenantId || preview.groupId !== groupId) {
    throw new HttpsError('invalid-argument', 'Preview does not match tenant/group');
  }
  if (preview.createdByUid !== authUid) {
    throw new HttpsError('permission-denied', 'Preview was created by a different user');
  }
  if (preview.expiresAt && preview.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', 'Preview expired. Run Prepare send again.');
  }

  const recipients = Array.isArray(preview.recipients) ? preview.recipients : [];
  const n = recipients.length;
  const expected = `SEND ${n}`;
  if (typedConfirmation.trim() !== expected) {
    throw new HttpsError('invalid-argument', `Confirmation must be exactly “${expected}”.`);
  }

  if (n === 0) {
    throw new HttpsError('failed-precondition', 'Preview has zero recipients; nothing to send.');
  }

  if (n > HARD_CAP) {
    throw new HttpsError('failed-precondition', `Recipient count exceeds hard cap (${HARD_CAP}).`);
  }

  await db.runTransaction(async (tx) => {
    const s = await tx.get(idemRef);
    if (s.exists && (s.data() as { result?: unknown }).result) {
      return;
    }
    tx.set(
      idemRef,
      {
        processing: true,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        tenantId,
        groupId,
        previewToken,
        actorUid: authUid,
      },
      { merge: true },
    );
  });

  const idemRecheck = await idemRef.get();
  const existingResult = idemRecheck.data() as { result?: ProfileReminderSendResult } | undefined;
  if (existingResult?.result) {
    return existingResult.result;
  }

  try {
    const groupSnap = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
    if (!groupSnap.exists) {
      await idemRef.set(
        { processing: false, error: 'group_not_found', completedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      throw new HttpsError('not-found', 'User group not found');
    }
    const groupData = groupSnap.data() as { memberIds?: string[] };
    const memberIds = Array.isArray(groupData.memberIds) ? groupData.memberIds.map((x) => String(x).trim()).filter(Boolean) : [];

    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
    const entities = entitiesSnap.docs.map((d) => ({
      id: d.id,
      name: String((d.data() as { name?: string }).name || ''),
      entityCode: (d.data() as { entityCode?: string }).entityCode,
    }));
    const c1SelectEntityId = resolveC1SelectEntityId(entities);
    const eligOpts = tenantEligOpts((tenantSnap.data() || {}) as Record<string, unknown>);

    const userIds = recipients.map((r) => String(r.userId || '').trim()).filter(Boolean);
    const employmentByUser = await loadEmploymentsForUsers(tenantId, userIds);

    const results: PerSendResult[] = [];
    const auditDeliveries: Array<{
      userId: string;
      applicationId: string | null;
      missingFields: string[];
      messageBody: string;
      twilioMessageId?: string | null;
    }> = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    const includeCooldownWarnings = preview.includeCooldownWarnings === true;
    const profileUrl = buildWorkerProfileUrl();

    for (const rec of recipients) {
      const userId = String(rec.userId || '').trim();
      const applicationIdRaw = rec.applicationId;
      const applicationId = applicationIdRaw != null && String(applicationIdRaw).trim() ? String(applicationIdRaw).trim() : null;

      if (!userId) {
        results.push({ userId: '—', applicationId: null, outcome: 'skipped', detail: 'Invalid preview row' });
        skipped += 1;
        continue;
      }

      const appRef = applicationId ? db.doc(`tenants/${tenantId}/applications/${applicationId}`) : null;
      const [userSnap, appSnap] = await Promise.all([
        db.doc(`users/${userId}`).get(),
        appRef ? appRef.get() : Promise.resolve(null as admin.firestore.DocumentSnapshot | null),
      ]);
      const userData = userSnap.data() as Record<string, unknown> | undefined;
      const appData = appSnap?.exists ? (appSnap.data() as Record<string, unknown>) : undefined;

      const employments = employmentByUser.get(userId) ?? [];

      const hard = hardValidateProfileReminderCandidate({
        tenantId,
        groupMemberIds: memberIds,
        userId,
        userData,
        applicationData: appData,
        applicationId,
        groupId,
        allowNonGroupApplication: true,
        employments,
        c1SelectEntityId,
        eligOpts,
      });

      if (!hard.ok) {
        results.push({ userId, applicationId, outcome: 'skipped', detail: hard.blockReasons.join('; ') });
        skipped += 1;
        continue;
      }

      if (userData) {
        const cd = profileCooldownWarnings(userData, appData);
        if (cd.length && !includeCooldownWarnings) {
          results.push({ userId, applicationId, outcome: 'skipped', detail: cd.join('; ') });
          skipped += 1;
          continue;
        }
      }

      const priorIdem = userData ? String(userData.profileUpdateReminderLastIdempotencyKey || '').trim() : '';
      if (priorIdem && priorIdem === idempotencyKey) {
        results.push({ userId, applicationId, outcome: 'skipped', detail: 'Already sent for this idempotency key' });
        skipped += 1;
        continue;
      }

      const fn = firstNameFromUser(userData as Record<string, unknown>);
      const lang = workerInterviewInviteLang(userData as Record<string, unknown>);
      const eligFresh = evaluateAiPrescreenEligibility(userData as Record<string, unknown>, eligOpts);
      const missingDisplay = mapEligibilityMissingFieldsToDisplay(eligFresh.missingFields);
      const body = buildProfileReminderSmsBody(fn, profileUrl, missingDisplay, lang);
      const phone = phoneE164FromUser(userData as Record<string, unknown>);

      const sms = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId,
        source: 'recruiter',
        sourceId: authUid,
        messageTypeId: 'user_group_profile_reminder',
      });

      const sentAt = admin.firestore.Timestamp.now();

      if (sms.success) {
        sent += 1;
        auditDeliveries.push({
          userId,
          applicationId,
          missingFields: mapEligibilityMissingFieldsToLabels(eligFresh.missingFields),
          messageBody: body,
          twilioMessageId: sms.messageId,
        });
        await db.doc(`users/${userId}`).set(
          {
            profileUpdateReminderLastSentAt: sentAt,
            profileUpdateReminderLastSentBy: authUid,
            profileUpdateReminderLastPreviewToken: previewToken,
            profileUpdateReminderLastIdempotencyKey: idempotencyKey,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        await db.doc(`users/${userId}`).collection('activityLogs').add({
          action: 'Profile Update Reminder (user group)',
          actionType: 'sms_sent',
          description: `User group profile reminder (${groupId})`,
          severity: 'medium',
          source: 'system',
          metadata: {
            reminderType: 'profile_update_user_group',
            sentByUserId: authUid,
            tenantId,
            groupId,
            applicationId: applicationId ?? null,
            preferredLanguage: lang,
          },
          timestamp: sentAt,
          createdAt: sentAt,
        });
        results.push({
          userId,
          applicationId,
          outcome: 'sent',
          twilioMessageId: sms.messageId,
        });
      } else if (sms.status === 'skipped' || (sms.error && /opt/i.test(sms.error))) {
        skipped += 1;
        results.push({ userId, applicationId, outcome: 'skipped', detail: sms.error || 'skipped' });
      } else {
        failed += 1;
        results.push({ userId, applicationId, outcome: 'failed', detail: sms.error || 'send_failed' });
      }
    }

    const auditId = db.collection(`tenants/${tenantId}/user_group_profile_reminder_audit`).doc().id;
    const performedAt = admin.firestore.Timestamp.now();
    const auditPayloadFirestore: Record<string, unknown> = {
      type: 'user_group_profile_reminder_send',
      tenantId,
      groupId,
      previewToken,
      idempotencyKey,
      actorUid: authUid,
      performedAt,
      templateKey: 'user_group_profile_reminder_v1',
      recipientCount: n,
      sent,
      skipped,
      failed,
      results,
      deliveries: auditDeliveries,
      messageTemplateSample: buildProfileReminderSmsBodyBilingualTemplate(),
    };

    await db.doc(`tenants/${tenantId}/user_group_profile_reminder_audit/${auditId}`).set(auditPayloadFirestore);

    const auditPayloadClient: Record<string, unknown> = {
      ...auditPayloadFirestore,
      performedAt,
    };

    const sendResult: ProfileReminderSendResult = {
      action: 'send',
      flow: 'profile_reminder',
      tenantId,
      groupId,
      previewToken,
      idempotencyKey,
      auditId,
      confirmationMatched: true,
      results,
      sent,
      skipped,
      failed,
      auditPayload: auditPayloadClient,
    };

    await idemRef.set(
      {
        processing: false,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: sendResult,
        auditId,
      },
      { merge: true },
    );

    logger.info('user_group_profile_reminder_send', { tenantId, groupId, auditId, sent, skipped, failed, actor: authUid });

    return sendResult;
  } catch (err: unknown) {
    await idemRef
      .set(
        {
          processing: false,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastError: err instanceof Error ? err.message : 'unknown_error',
        },
        { merge: true },
      )
      .catch(() => undefined);
    throw err;
  }
}

export const userGroupProfileReminderSend = onCall(
  /**
   * `cors: true` — allow browser preflight from any origin. Twilio secrets match other SMS callables.
   */
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<ProfileReminderPrepareResult | ProfileReminderSendResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const raw = (request.data || {}) as {
      action?: unknown;
      tenantId?: unknown;
      groupId?: unknown;
      maxRecipients?: unknown;
      includeCooldownWarnings?: unknown;
      previewToken?: unknown;
      idempotencyKey?: unknown;
      typedConfirmation?: unknown;
    };

    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';
    const action = raw.action === 'send' ? 'send' : 'prepare';

    if (!tenantId || !groupId) {
      throw new HttpsError('invalid-argument', 'tenantId and groupId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    if (action === 'prepare') {
      let maxRecipients = DEFAULT_MAX;
      if (typeof raw.maxRecipients === 'number' && Number.isFinite(raw.maxRecipients)) {
        maxRecipients = Math.floor(raw.maxRecipients);
      }
      if (maxRecipients < 1) {
        throw new HttpsError('invalid-argument', 'maxRecipients must be at least 1');
      }
      if (maxRecipients > HARD_CAP) {
        throw new HttpsError('invalid-argument', `maxRecipients cannot exceed hard cap (${HARD_CAP})`);
      }

      const includeCooldownWarnings = raw.includeCooldownWarnings === true;

      return runPrepare(request.auth.uid, tenantId, groupId, maxRecipients, includeCooldownWarnings);
    }

    return runSend(
      request.auth.uid,
      tenantId,
      groupId,
      typeof raw.previewToken === 'string' ? raw.previewToken.trim() : '',
      typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey.trim() : '',
      typeof raw.typedConfirmation === 'string' ? raw.typedConfirmation : '',
    );
  },
);
