/**
 * v2 User Groups: controlled "Send interview invites" (prepare preview + send with revalidation, caps, cooldowns, audit, idempotency).
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
import { buildWorkerAiPrescreenInviteUrl } from '../utils/workerUrls';
import { runUserGroupMemberNextStepEvaluation } from './userGroupMemberNextStepEvaluationCore';
import {
  buildInterviewInviteSmsBody,
  buildInterviewInviteSmsBodyBilingualTemplate,
  firstNameFromUser,
  hardValidateInterviewInviteCandidate,
  interviewInviteCooldownReason,
  phoneE164FromUser,
  prescreenAutomatedSmsCooldownReasons,
  resolveC1SelectEntityId,
  tenantEligOpts,
  workerInterviewInviteLang,
} from './userGroupInterviewInviteValidation';
import { userInInterviewReinviteCooldown } from '../workerAiPrescreen/interviewInviteCooldown';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PREVIEW_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_RECIPIENTS = 20;
export const HARD_CAP_RECIPIENTS = 25;

export type InterviewInviteRecipientPreview = {
  userId: string;
  applicationId: string;
  displayName: string;
  firstName: string;
  prescreenLink: string;
  /** SMS language for this worker (`users.preferredLanguage`). */
  smsLanguage: 'en' | 'es';
  cooldownWarnings: string[];
};

export type SkippedRecipientRow = {
  userId: string;
  applicationId: string | null;
  displayName?: string;
  reasons: string[];
};

export type PerSendResult = {
  userId: string;
  applicationId: string;
  outcome: 'sent' | 'skipped' | 'failed';
  detail?: string;
  twilioMessageId?: string | null;
};

export type InterviewInvitePrepareResult = {
  action: 'prepare';
  tenantId: string;
  groupId: string;
  previewToken: string;
  previewExpiresAt: admin.firestore.Timestamp;
  templateKey: 'user_group_interview_invite_v1';
  messageTemplate: string;
  confirmationRequired: string;
  selectedRecipients: InterviewInviteRecipientPreview[];
  skippedRecipients: SkippedRecipientRow[];
  evalCounts: Record<string, number>;
  note: string;
};

export type InterviewInviteSendResult = {
  action: 'send';
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

function cooldownWarningsForApplication(app: Record<string, unknown>): string[] {
  const w: string[] = [];
  const iv = interviewInviteCooldownReason(app);
  if (iv) w.push(iv);
  w.push(...prescreenAutomatedSmsCooldownReasons(app));
  return w;
}

async function runPrepare(
  authUid: string,
  tenantId: string,
  groupId: string,
  maxRecipients: number,
  includeCooldownWarnings: boolean,
): Promise<InterviewInvitePrepareResult> {
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
  const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;
  const eligOpts = tenantEligOpts(tenantData);

  const readyRows = evalResult.rows
    .filter((r) => r.bucket === 'ready_for_interview' && r.applicationId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const userIds = readyRows.map((r) => r.userId);
  const employmentByUser = await loadEmploymentsForUsers(tenantId, userIds);

  const skippedRecipients: SkippedRecipientRow[] = [];
  const passedWithMeta: Array<{
    row: (typeof readyRows)[0];
    userData: Record<string, unknown>;
    appData: Record<string, unknown>;
    cooldownWarnings: string[];
  }> = [];

  for (const row of readyRows) {
    const applicationId = row.applicationId as string;
    const [userSnap, appSnap] = await Promise.all([
      db.doc(`users/${row.userId}`).get(),
      db.doc(`tenants/${tenantId}/applications/${applicationId}`).get(),
    ]);
    const userData = userSnap.data() as Record<string, unknown> | undefined;
    const appData = appSnap.data() as Record<string, unknown> | undefined;
    const employments = employmentByUser.get(row.userId) ?? [];

    const hard = hardValidateInterviewInviteCandidate({
      tenantId,
      groupMemberIds: memberIds,
      userId: row.userId,
      userData,
      applicationData: appData,
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
        reasons: hard.blockReasons,
      });
      continue;
    }

    const cd = appData ? cooldownWarningsForApplication(appData) : [];
    passedWithMeta.push({ row, userData: userData as Record<string, unknown>, appData: appData as Record<string, unknown>, cooldownWarnings: cd });
  }

  let pool = passedWithMeta;
  if (!includeCooldownWarnings) {
    for (const p of pool) {
      if (p.cooldownWarnings.length > 0) {
        skippedRecipients.push({
          userId: p.row.userId,
          applicationId: p.row.applicationId,
          displayName: p.row.displayName,
          reasons: [...p.cooldownWarnings, '(skipped by default — enable “include cooldown overrides” to allow)'],
        });
      }
    }
    pool = pool.filter((p) => p.cooldownWarnings.length === 0);
  }

  const cap = Math.min(maxRecipients, HARD_CAP_RECIPIENTS);
  const overflow = pool.slice(cap);
  for (const o of overflow) {
    skippedRecipients.push({
      userId: o.row.userId,
      applicationId: o.row.applicationId,
      displayName: o.row.displayName,
      reasons: [`Not included in this batch (limit ${cap} per send; hard cap ${HARD_CAP_RECIPIENTS})`],
    });
  }

  const selected = pool.slice(0, cap);

  const previewToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PREVIEW_TTL_MS);

  const selectedRecipients: InterviewInviteRecipientPreview[] = selected.map((p) => {
    const applicationId = p.row.applicationId as string;
    const link = buildWorkerAiPrescreenInviteUrl({ applicationId, entry: 'user_group_invite' });
    const fn = firstNameFromUser(p.userData);
    return {
      userId: p.row.userId,
      applicationId,
      displayName: p.row.displayName,
      firstName: fn,
      prescreenLink: link,
      smsLanguage: workerInterviewInviteLang(p.userData),
      cooldownWarnings: p.cooldownWarnings,
    };
  });

  const messageTemplate = buildInterviewInviteSmsBodyBilingualTemplate();

  await db.doc(`tenants/${tenantId}/user_group_interview_invite_previews/${previewToken}`).set({
    tenantId,
    groupId,
    createdByUid: authUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    recipients: selectedRecipients.map((r) => ({ userId: r.userId, applicationId: r.applicationId })),
    includeCooldownWarnings,
    requestedMax: maxRecipients,
    templateKey: 'user_group_interview_invite_v1',
    evalCounts: evalResult.counts,
  });

  const n = selectedRecipients.length;
  const confirmationRequired = `SEND ${n}`;

  return {
    action: 'prepare',
    tenantId,
    groupId,
    previewToken,
    previewExpiresAt: expiresAt,
    templateKey: 'user_group_interview_invite_v1',
    messageTemplate,
    confirmationRequired,
    selectedRecipients,
    skippedRecipients,
    evalCounts: evalResult.counts,
    note:
      n === 0
        ? 'No recipients selected. Adjust filters or resolve skipped rows. Sending is blocked until a prepare returns at least one recipient.'
        : `Type exactly “${confirmationRequired}” to confirm. Preview expires in ${Math.round(PREVIEW_TTL_MS / 60000)} minutes.`,
  };
}

async function runSend(
  authUid: string,
  tenantId: string,
  groupId: string,
  previewToken: string,
  idempotencyKey: string,
  typedConfirmation: string,
): Promise<InterviewInviteSendResult> {
  if (!previewToken || !idempotencyKey) {
    throw new HttpsError('invalid-argument', 'previewToken and idempotencyKey are required');
  }

  const idemRef = db.doc(`tenants/${tenantId}/user_group_interview_invite_idempotency/${idempotencyKey}`);
  const idemSnap = await idemRef.get();
  if (idemSnap.exists) {
    const d = idemSnap.data() as { result?: InterviewInviteSendResult; processing?: boolean; startedAt?: admin.firestore.Timestamp };
    if (d?.result) {
      return d.result;
    }
    if (d?.processing && d.startedAt && Date.now() - d.startedAt.toMillis() < 8 * 60 * 1000) {
      throw new HttpsError('resource-exhausted', 'A send with this idempotency key is already in progress. Wait and retry.');
    }
  }

  const previewRef = db.doc(`tenants/${tenantId}/user_group_interview_invite_previews/${previewToken}`);
  const previewSnap = await previewRef.get();
  if (!previewSnap.exists) {
    throw new HttpsError('failed-precondition', 'Invalid or expired preview. Run Prepare send again.');
  }
  const preview = previewSnap.data() as {
    tenantId?: string;
    groupId?: string;
    createdByUid?: string;
    expiresAt?: admin.firestore.Timestamp;
    recipients?: Array<{ userId?: string; applicationId?: string }>;
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
    throw new HttpsError('invalid-argument', `Confirmation must be exactly “${expected}” (including the number of recipients).`);
  }

  if (n === 0) {
    throw new HttpsError('failed-precondition', 'Preview has zero recipients; nothing to send.');
  }

  if (n > HARD_CAP_RECIPIENTS) {
    throw new HttpsError('failed-precondition', `Recipient count exceeds hard cap (${HARD_CAP_RECIPIENTS}).`);
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
  const existingResult = idemRecheck.data() as { result?: InterviewInviteSendResult } | undefined;
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
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    const includeCooldownWarnings = preview.includeCooldownWarnings === true;

    for (const rec of recipients) {
      const userId = String(rec.userId || '').trim();
      const applicationId = String(rec.applicationId || '').trim();
      if (!userId || !applicationId) {
        results.push({ userId: userId || '—', applicationId: applicationId || '—', outcome: 'skipped', detail: 'Invalid preview row' });
        skipped += 1;
        continue;
      }

      const [userSnap, appSnap] = await Promise.all([
        db.doc(`users/${userId}`).get(),
        db.doc(`tenants/${tenantId}/applications/${applicationId}`).get(),
      ]);
      const userData = userSnap.data() as Record<string, unknown> | undefined;
      const appData = appSnap.data() as Record<string, unknown> | undefined;
      const employments = employmentByUser.get(userId) ?? [];

      const hard = hardValidateInterviewInviteCandidate({
        tenantId,
        groupMemberIds: memberIds,
        userId,
        userData,
        applicationData: appData,
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

      if (appData) {
        const cd = cooldownWarningsForApplication(appData);
        if (cd.length && !includeCooldownWarnings) {
          results.push({ userId, applicationId, outcome: 'skipped', detail: cd.join('; ') });
          skipped += 1;
          continue;
        }
      }

      const appSnap2 = await db.doc(`tenants/${tenantId}/applications/${applicationId}`).get();
      const latestApp = appSnap2.data() as Record<string, unknown> | undefined;
      const priorKey = latestApp ? String(latestApp.userGroupInterviewInviteLastIdempotencyKey || '').trim() : '';
      if (priorKey && priorKey === idempotencyKey) {
        results.push({ userId, applicationId, outcome: 'skipped', detail: 'Already sent for this idempotency key' });
        skipped += 1;
        continue;
      }

      if (userData && userInInterviewReinviteCooldown(userData)) {
        results.push({
          userId,
          applicationId,
          outcome: 'skipped',
          detail: 'Interview re-invite cooldown (lastInterviewInvitedAt / lastInterviewCompletedAt)',
        });
        skipped += 1;
        continue;
      }

    const fn = firstNameFromUser(userData as Record<string, unknown>);
    const link = buildWorkerAiPrescreenInviteUrl({ applicationId, entry: 'user_group_invite' });
    const body = buildInterviewInviteSmsBody(fn, applicationId, link, workerInterviewInviteLang(userData as Record<string, unknown>));
      const phone = phoneE164FromUser(userData as Record<string, unknown>);

      const sms = await sendWorkerMessageInternal(phone, body, {
        tenantId,
        userId,
        source: 'recruiter',
        sourceId: authUid,
        messageTypeId: 'user_group_interview_invite',
      });

      if (sms.success) {
        sent += 1;
        const sentAt = admin.firestore.Timestamp.now();
        await db.doc(`users/${userId}`).set(
          {
            lastInterviewInvitedAt: sentAt,
            interviewInviteSentAt: sentAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
          {
            userGroupInterviewInviteLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
            userGroupInterviewInviteLastPreviewToken: previewToken,
            userGroupInterviewInviteLastIdempotencyKey: idempotencyKey,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
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

    const auditId = db.collection(`tenants/${tenantId}/user_group_interview_invite_audit`).doc().id;
    const performedAt = admin.firestore.Timestamp.now();
    const auditPayloadFirestore: Record<string, unknown> = {
      type: 'user_group_interview_invite_send',
      tenantId,
      groupId,
      previewToken,
      idempotencyKey,
      actorUid: authUid,
      performedAt,
      templateKey: 'user_group_interview_invite_v1',
      recipientCount: n,
      sent,
      skipped,
      failed,
      results,
      messageTemplateSample: buildInterviewInviteSmsBodyBilingualTemplate(),
    };

    await db.doc(`tenants/${tenantId}/user_group_interview_invite_audit/${auditId}`).set(auditPayloadFirestore);

    const auditPayloadClient: Record<string, unknown> = {
      ...auditPayloadFirestore,
      performedAt,
    };

    const sendResult: InterviewInviteSendResult = {
      action: 'send',
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

    logger.info('user_group_interview_invite_send', { tenantId, groupId, auditId, sent, skipped, failed, actor: authUid });

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

export const userGroupInterviewInviteSend = onCall(
  /** Same Twilio secret wiring as `startOnCallEmployment`, `onCallI9SupportingReminder`, `processWorkerAiPrescreenReminders`. */
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (
    request,
  ): Promise<InterviewInvitePrepareResult | InterviewInviteSendResult> => {
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
      let maxRecipients = DEFAULT_MAX_RECIPIENTS;
      if (typeof raw.maxRecipients === 'number' && Number.isFinite(raw.maxRecipients)) {
        maxRecipients = Math.floor(raw.maxRecipients);
      }
      if (maxRecipients < 1) {
        throw new HttpsError('invalid-argument', 'maxRecipients must be at least 1');
      }
      if (maxRecipients > HARD_CAP_RECIPIENTS) {
        throw new HttpsError('invalid-argument', `maxRecipients cannot exceed hard cap (${HARD_CAP_RECIPIENTS})`);
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
