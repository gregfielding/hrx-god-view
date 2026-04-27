/**
 * Application SMS Triggers
 * Sends SMS notifications when applications are created or status changes
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { sendLegacyApplicationStatusMessage } from './messaging/legacyMessageHelpers';
import { shouldSendNotification } from './utils/notificationSettings';
import { resolveTemplateVariables, TemplateVariableContext, ResolvedVariables } from './utils/templateVariableResolver';
import { sendApplicationStatusChangedNotification } from './messaging/unifiedWorkerNotifications';
import { markLifecycleEventIfFirst } from './messaging/lifecycleDedupe';
import { maybeScheduleWorkerAiPrescreenReminder } from './workerAiPrescreen/scheduleWorkerAiPrescreenReminder';
import { sendCombinedApplicationInterviewFirstTouch } from './workerAiPrescreen/combinedApplicationInterviewFirstTouch';
import { shouldSkipStaleApplicationReceivedSms } from './messaging/applicationReceivedSmsGuards';
import { normalizeApplicationStatus } from './utils/applicationStatusNormalize';
import { DEFAULT_FIRESTORE_TRIGGER_MEMORY } from './utils/functionRuntimeDefaults';
import { sendGridFromEmail, sendGridFromName } from './messaging/emailProviderFactory';
import { maybeEmitJobAppliedCategoryScore } from './categoryScoreEvolution/activityCategoryScoreEmit';
import {
  isApplicationStatusWaitlisted,
  logWaitlistNotificationsSuppressed,
  shouldSendApplicationWaitlistNotifications,
} from './messaging/applicationWaitlistNotificationsGate';

/** Replace mis-saved placeholders like {Gregory} or {{Gregory}} with actual value when they match a resolved variable (fixes templates saved with example values). */
function cleanupMisSavedPlaceholders(
  text: string,
  variables: ResolvedVariables
): string {
  let out = text;
  const pairs: (string | number)[][] = [
    ['firstName', variables.firstName],
    ['jobTitle', variables.jobTitle],
    ['locationCity', variables.locationCity],
  ];
  for (const [key, value] of pairs) {
    if (value == null || value === '') continue;
    const s = String(value);
    // Replace {Value} and {{Value}} so wrong template syntax still renders
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(s)}\\s*\\}\\}`, 'gi'), s);
    out = out.replace(new RegExp(`\\{\\s*${escapeRegExp(s)}\\s*\\}`, 'g'), s);
  }
  return out;
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStringToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/** Milliseconds from Firestore Timestamp / admin.Timestamp-like / plain {_seconds}. */
function firestoreTsMillis(value: unknown): number {
  if (value == null) return 0;
  const v = value as { toMillis?: () => number; _seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

/**
 * Suffix for **re-apply only** (withdrawn → submitted): new thank-you per resubmission wave.
 */
function applicationReceivedThanksDedupeSuffix(data: Record<string, any>): string {
  const m =
    firestoreTsMillis(data.submittedAt) ||
    firestoreTsMillis(data.appliedAt) ||
    firestoreTsMillis(data.updatedAt);
  return m > 0 ? String(m) : '0';
}

/**
 * One application_received SMS per application doc for a given submission generation.
 * Root-cause fix: onCreate + onUpdate both used time-based suffixes that could differ by ms → duplicate SMS.
 * - First submit: single key `application_received_thanks__{applicationId}` (onCreate and in_progress→submitted share it).
 * - Re-apply after withdraw: `application_received_thanks__{applicationId}__reapply__{suffix}`.
 */
function applicationReceivedThanksDedupeKey(
  applicationId: string,
  after: Record<string, any>,
  opts: { mode: 'create' | 'update'; oldStatus?: unknown },
): string {
  if (opts.mode === 'update' && String(opts.oldStatus || '').trim().toLowerCase() === 'withdrawn') {
    return `application_received_thanks__${applicationId}__reapply__${applicationReceivedThanksDedupeSuffix(after)}`;
  }
  return `application_received_thanks__${applicationId}`;
}

function isSubmittedApplicationStatus(status: unknown): boolean {
  return normalizeApplicationStatus(String(status ?? '')) === 'submitted';
}

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Define secrets for Twilio (required for SMS sending)
// SendGrid uses process.env (SENDGRID_API_KEY, etc.) - set in .env or Firebase config to avoid secret/env conflict
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioMessagingPhoneNumber = defineSecret('TWILIO_MESSAGING_PHONE_NUMBER');
const twilioA2PCampaign = defineSecret('TWILIO_A2P_CAMPAIGN');

/**
 * Gen2 Firestore triggers: same codebase as full index bundle — default memory + cold start can fail Cloud Run
 * health checks during deploy. Match other high-traffic triggers (e.g. region + 512MiB).
 */
const APPLICATION_SMS_TRIGGER_OPTS = {
  document: 'tenants/{tenantId}/applications/{applicationId}',
  region: 'us-central1' as const,
  memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  timeoutSeconds: 300,
  secrets: [
    twilioAccountSid,
    twilioAuthToken,
    twilioMessagingPhoneNumber,
    twilioA2PCampaign,
    sendGridFromEmail,
    sendGridFromName,
  ],
};

/**
 * Firestore trigger: Send SMS when a new application is created
 */
export const onApplicationCreated = onDocumentCreated(
  APPLICATION_SMS_TRIGGER_OPTS,
  async (event) => {
    const applicationId = event.params.applicationId;
    const tenantId = event.params.tenantId;
    const applicationData = event.data?.data();

    logger.info(`onApplicationCreated invoked`, {
      applicationId,
      tenantId,
      hasData: !!applicationData,
      status: applicationData?.status,
    });

    if (!applicationData) {
      logger.error(`onApplicationCreated: Missing data for ${applicationId}`);
      return { success: false };
    }

    // Application created with status 'accepted' = created by assignment flow (e.g. placementsCreateAssignments), not worker submit. Skip "thank you for applying" — assignment_created trigger will send the correct message.
    if (normalizeApplicationStatus(String(applicationData.status ?? '')) === 'accepted') {
      logger.info(`Application ${applicationId} created with status accepted (assignment-driven), skipping application_received notification`);
      return { success: true };
    }

    // Mirror drafts (e.g. apply wizard) create `in_progress` first; thank-you must run only when they submit — handled by onApplicationStatusChanged.
    if (!isSubmittedApplicationStatus(applicationData.status)) {
      logger.info(
        `Application ${applicationId} created with status ${JSON.stringify(applicationData.status ?? '(none)')} — skipping application_received onCreate (only \`submitted\` sends thank-you here; in_progress/draft wait for status transition)`
      );
      return { success: true };
    }

    try {
      await maybeEmitJobAppliedCategoryScore(db, {
        tenantId,
        applicationId,
        applicationData: applicationData as Record<string, unknown>,
      });
    } catch (e) {
      logger.warn('categoryScore.job_applied_emit_failed', {
        applicationId,
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      logger.info(`New application created: ${applicationId} in tenant ${tenantId}`);

      // Get user ID from application (userId or candidateId)
      // Also try to extract from applicationId if it follows pattern: {userId}_{jobId}
      let userId = applicationData.userId || applicationData.candidateId;
      
      // If no userId in document, try to extract from applicationId (common pattern: {userId}_{jobId})
      if (!userId && applicationId.includes('_')) {
        const parts = applicationId.split('_');
        // First part is usually the userId, but check if it's a valid user ID format
        const potentialUserId = parts[0];
        if (potentialUserId && potentialUserId.length > 10) {
          // Verify this looks like a Firebase user ID (typically 28 characters)
          // Try to fetch user to verify
          try {
            const userCheck = await admin.firestore().doc(`users/${potentialUserId}`).get();
            if (userCheck.exists) {
              userId = potentialUserId;
              logger.info(`Extracted userId ${userId} from applicationId ${applicationId}`);
            }
          } catch (err: any) {
            // If lookup fails, continue without this userId
            logger.info(`Could not verify userId from applicationId: ${err?.message || err}`);
          }
        }
      }
      
      if (!userId) {
        logger.warn(`Application ${applicationId} has no userId or candidateId, and could not extract from applicationId, skipping SMS`);
        return { success: true };
      }

      // Fetch user data to get phone number
      try {
        const userDoc = await admin.firestore().doc(`users/${userId}`).get();
        const userData = userDoc.data();

        if (!userData) {
          logger.warn(`User ${userId} not found for application ${applicationId}`);
          return { success: true };
        }

        // Require at least one phone number (attempt send even if not verified)
        const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
        if (!phoneE164) {
          logger.info(`User ${userId} has no phone number, skipping SMS for application ${applicationId}`);
          return { success: true };
        }
        if (shouldSkipStaleApplicationReceivedSms(applicationId, applicationData)) {
          return { success: true, skipped: 'stale_application_received' };
        }
        const canProcessCreateEvent = await markLifecycleEventIfFirst({
          tenantId,
          dedupeKey: `application_created__${applicationId}`,
          eventType: 'application_created',
          context: { applicationId, userId },
        });
        if (!canProcessCreateEvent) {
          return { success: true, deduped: true };
        }

        const shouldSendSms = await shouldSendNotification(userId, 'applicationUpdates', 'sms');
        if (!shouldSendSms) {
          await maybeScheduleWorkerAiPrescreenReminder({
            tenantId,
            applicationId,
            after: applicationData as Record<string, unknown>,
          });
          logger.info(`SMS disabled for user ${userId} - skipping application created notification`);
          return { success: true };
        }

        const thanksKeyCreate = applicationReceivedThanksDedupeKey(applicationId, applicationData, { mode: 'create' });
        const combinedResult = await sendCombinedApplicationInterviewFirstTouch({
          tenantId,
          applicationId,
          applicationData: applicationData as Record<string, unknown>,
          userId,
          userData: userData as Record<string, unknown>,
          phoneE164,
          thanksDedupeKey: thanksKeyCreate,
          source: 'application_created',
        });
        if (combinedResult === 'sent' || combinedResult === 'failed' || combinedResult === 'deduped_thanks') {
          return { success: true };
        }

        await maybeScheduleWorkerAiPrescreenReminder({
          tenantId,
          applicationId,
          after: applicationData as Record<string, unknown>,
        });

        // Try to find matching template
        let message = '';
        let templateFound = false;
        const appContext: TemplateVariableContext = {
          userId: userId,
          userData: userData,
          applicationId: applicationId,
          applicationData: applicationData,
          jobOrderId: applicationData.jobOrderId,
          jobPostId: applicationData.jobId || applicationData.postId,
          tenantId: tenantId,
          status: applicationData.status || 'submitted',
        };
        let variables: ResolvedVariables = await resolveTemplateVariables(appContext);

        try {
          // PHASE 2.1: Use new template engine with legacy fallback
          const { getTemplateWithLegacyFallback } = await import('./messaging/templateMigration');
          const { renderTemplate } = await import('./messaging/templateEngine');
          
          const templateResult = await getTemplateWithLegacyFallback(
            tenantId,
            'application_received',
            'sms',
            (userData.preferredLanguage || 'en') as 'en' | 'es',
            'application',
            'applicationCreated'
          );

          if (templateResult) {
            message = await renderTemplate(templateResult.template, variables, tenantId);
            message = cleanupMisSavedPlaceholders(message, variables);
            templateFound = true;
            logger.info(`Using ${templateResult.source} template for application ${applicationId}`);
          }
        } catch (templateError: any) {
          logger.warn(`Failed to fetch template for application ${applicationId}:`, templateError);
          // Fall back to default message
        }

        if (!templateFound) {
          const firstName = variables.firstName;
          const jobTitle = variables.jobTitle;
          const locationCity = variables.locationCity;
          message = `Hi ${firstName}. Thank you for applying to be a ${jobTitle}${locationCity ? ` in ${locationCity}` : ''}. We are currently reviewing applicants and will be in touch soon.`;
        }

        if (message) {
          const thanksDedupeKey = applicationReceivedThanksDedupeKey(applicationId, applicationData, { mode: 'create' });
          const claimedThanks = await markLifecycleEventIfFirst({
            tenantId,
            dedupeKey: thanksDedupeKey,
            eventType: 'application_received_thanks',
            context: { applicationId, userId, source: 'onCreate' },
          });
          if (!claimedThanks) {
            logger.info(
              `Application ${applicationId}: application_received dedupe hit (duplicate_create_or_status_path) key=${thanksDedupeKey}`
            );
            return { success: true, deduped: true };
          }

          const emailSubject = `${variables.firstName}, Your Application Was Received`;

          // PHASE 3: Route through orchestrator instead of direct Twilio call
          const result = await sendLegacyApplicationStatusMessage({
            tenantId,
            userId,
            phoneE164,
            message,
            emailSubject,
            source: 'application_created',
            sourceId: applicationId,
            applicationId,
            status: applicationData.status || 'submitted',
            applicationData,
            jobOrderId: applicationData.jobOrderId,
            jobPostId: applicationData.jobId || applicationData.postId,
          });

          if (result.success) {
            logger.info(`SMS sent for new application ${applicationId} to ${phoneE164}. Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
          } else {
            logger.warn(`Failed to send SMS for application ${applicationId}: ${result.error}`);
          }
        }

        return { success: true };
      } catch (userError: any) {
        logger.error(`Error fetching user data for application ${applicationId}:`, userError);
        // Don't throw - allow application creation to succeed even if SMS fails
        return { success: true };
      }
    } catch (error: any) {
      logger.error(`Error in onApplicationCreated for ${applicationId}:`, error);
      // Don't throw - trigger should not fail application creation
      return { success: false, error: error.message };
    }
  }
);

/**
 * Firestore trigger: Send SMS when application status changes
 */
export const onApplicationStatusChanged = onDocumentUpdated(
  APPLICATION_SMS_TRIGGER_OPTS,
  async (event) => {
    const applicationId = event.params.applicationId;
    const tenantId = event.params.tenantId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    logger.info(`onApplicationStatusChanged invoked`, {
      applicationId,
      tenantId,
      hasBefore: !!before,
      hasAfter: !!after,
      oldStatus: before?.status,
      newStatus: after?.status,
    });

    if (!before || !after) {
      logger.error(`onApplicationStatusChanged: Missing before/after data for ${applicationId}`);
      return { success: false };
    }

    try {
      // Check for status changes
      const statusChanged = before.status !== after.status;

      if (!statusChanged) {
        logger.info(`Application ${applicationId}: no status change (${after.status}), skipping SMS`);
        return { success: true };
      }

      const oldStatus = before.status;
      const newStatus = after.status;

      if (
        isSubmittedApplicationStatus(newStatus) &&
        !isSubmittedApplicationStatus(oldStatus) &&
        !(after.statusChangeReason === 'assignment_cancelled' || after.revertedFromAssignmentCancel === true)
      ) {
        try {
          await maybeEmitJobAppliedCategoryScore(db, {
            tenantId,
            applicationId,
            applicationData: after as Record<string, unknown>,
          });
        } catch (e) {
          logger.warn('categoryScore.job_applied_emit_failed', {
            applicationId,
            tenantId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Do not send any notifications when the candidate withdraws
      if (newStatus === 'withdrawn') {
        logger.info(`Application ${applicationId} status changed to withdrawn - skipping all notifications`);
        return { success: true };
      }

      // Do not send any notifications when recruiter removes application (Remove Application sets status to deleted)
      if (newStatus === 'deleted') {
        logger.info(`Application ${applicationId} status changed to deleted - skipping all notifications`);
        return { success: true };
      }

      // When recruiter cancels assignment (Red X), application is reverted to submitted. Skip "Thank you for applying" — assignment_status_cancelled already sent the correct message.
      if (newStatus === 'submitted' && (after.statusChangeReason === 'assignment_cancelled' || after.revertedFromAssignmentCancel === true)) {
        logger.info(`Application ${applicationId} reverted to submitted due to assignment cancel - skipping application_received`);
        return { success: true };
      }

      if (isApplicationStatusWaitlisted(newStatus) && !shouldSendApplicationWaitlistNotifications()) {
        logWaitlistNotificationsSuppressed('onApplicationStatusChanged', {
          applicationId,
          tenantId,
          newStatus: String(newStatus ?? ''),
        });
        return { success: true };
      }

      await maybeScheduleWorkerAiPrescreenReminder({
        tenantId,
        applicationId,
        before: before as Record<string, unknown>,
        after: after as Record<string, unknown>,
      });

      logger.info(`Application ${applicationId} status changed from ${oldStatus} to ${newStatus}`);

      // Do not send rejection or waitlisted when this application has an assignment in good standing (proposed/confirmed/active).
      // Prevents the worker from getting "Application Rejected" or "You've been waitlisted" when they were actually placed and/or accepted.
      const skipStatusNotificationWhenAssigned = async (reason: string) => {
        const assignmentId = after.assignmentId;
        if (assignmentId) {
          try {
            const assignmentSnap = await admin.firestore()
              .doc(`tenants/${tenantId}/assignments/${assignmentId}`)
              .get();
            const assignment = assignmentSnap.data();
            const assignmentStatus = (assignment?.status || '').toLowerCase();
            if (['proposed', 'confirmed', 'active'].includes(assignmentStatus)) {
              logger.info(`Application ${applicationId} status=${newStatus} but assignment ${assignmentId} is ${assignmentStatus}; ${reason}`);
              return true;
            }
          } catch (err) {
            logger.warn(`Could not check assignment for application ${applicationId}:`, err);
          }
        }
        return false;
      };

      // Also skip waitlisted/rejected if this user has ANY assignment for this job order in good standing (covers multiple application docs or race where status=waitlisted is written before assignmentId is set).
      const skipWaitlistedOrRejectedWhenUserHasAssignmentForJob = async () => {
        const userId = after.userId || after.candidateId;
        const jobOrderId = after.jobOrderId;
        if (!userId || !jobOrderId) return false;
        try {
          const assignSnap = await admin.firestore()
            .collection(`tenants/${tenantId}/assignments`)
            .where('userId', '==', userId)
            .where('jobOrderId', '==', jobOrderId)
            .limit(5)
            .get();
          const hasGoodStanding = assignSnap.docs.some((d) => {
            const s = (d.data()?.status || '').toLowerCase();
            return ['proposed', 'confirmed', 'active'].includes(s);
          });
          if (hasGoodStanding) {
            logger.info(`Application ${applicationId} status=${newStatus} but user ${userId} has an assignment for job ${jobOrderId}; skipping waitlisted/rejected notification`);
            return true;
          }
        } catch (err) {
          logger.warn(`Could not check assignments for job order ${jobOrderId}:`, err);
        }
        return false;
      };

      // Skip waitlisted when this user has another application for the same job with status 'accepted' or 'confirmed'.
      // Covers: (1) two application docs — one set accepted in placement flow, the other set waitlisted; (2) worker just
      // confirmed in UI so their application is 'confirmed' (not 'accepted') — we must not send waitlist SMS.
      const IN_GOOD_STANDING_STATUSES = ['accepted', 'confirmed'];
      const skipWaitlistedWhenOtherApplicationAcceptedForSameJob = async () => {
        const userId = after.userId || after.candidateId;
        const jobOrderId = after.jobOrderId;
        if (!userId || !jobOrderId) return false;
        try {
          const appSnap = await admin.firestore()
            .collection(`tenants/${tenantId}/applications`)
            .where('userId', '==', userId)
            .where('jobOrderId', '==', jobOrderId)
            .limit(10)
            .get();
          const otherInGoodStanding = appSnap.docs.some((d) => {
            if (d.id === applicationId) return false;
            const s = (d.data()?.status || '').toLowerCase();
            return IN_GOOD_STANDING_STATUSES.includes(s);
          });
          if (otherInGoodStanding) {
            logger.info(`Application ${applicationId} status=waitlisted but user ${userId} has another application for job ${jobOrderId} with status accepted/confirmed; skipping waitlisted notification`);
            return true;
          }
        } catch (err) {
          logger.warn(`Could not check other applications for job order ${jobOrderId}:`, err);
        }
        return false;
      };

      // Skip waitlisted when this user has an assignment in good standing for this application's shift (placement flow: assignment is created before application is updated to accepted, so status=waitlisted can fire before assignmentId is set).
      const skipWaitlistedWhenUserHasAssignmentForThisShift = async () => {
        const userId = after.userId || after.candidateId;
        const shiftId = (after.shiftId || '').trim();
        const shiftIds = Array.isArray(after.shiftIds) ? after.shiftIds.map((s: unknown) => String(s || '').trim()).filter(Boolean) : [];
        const shiftsToCheck = shiftId ? [shiftId, ...shiftIds].filter((s, i, a) => a.indexOf(s) === i) : shiftIds;
        if (!userId || shiftsToCheck.length === 0) return false;
        try {
          const assignSnap = await admin.firestore()
            .collection(`tenants/${tenantId}/assignments`)
            .where('userId', '==', userId)
            .where('shiftId', 'in', shiftsToCheck.length > 10 ? shiftsToCheck.slice(0, 10) : shiftsToCheck)
            .limit(5)
            .get();
          const hasGoodStanding = assignSnap.docs.some((d) => {
            const s = (d.data()?.status || '').toLowerCase();
            return ['proposed', 'confirmed', 'active'].includes(s);
          });
          if (hasGoodStanding) {
            logger.info(`Application ${applicationId} status=waitlisted but user ${userId} has an assignment for this shift; skipping waitlisted notification`);
            return true;
          }
        } catch (err) {
          logger.warn(`Could not check assignments for shift(s) for application ${applicationId}:`, err);
        }
        return false;
      };

      // Final safety net for messy/legacy application shapes:
      // if user already has a good-standing assignment that clearly matches this application by
      // jobOrderId, shiftId, jobPostId, or (jobTitle + companyName), do not send waitlist SMS.
      const skipWaitlistedWhenUserHasMatchingGoodStandingAssignment = async () => {
        const userId = after.userId || after.candidateId;
        if (!userId) return false;

        const appJobOrderId = normalizeStringToken(after.jobOrderId);
        const appShiftIds = new Set<string>();
        const appShiftId = normalizeStringToken(after.shiftId);
        if (appShiftId) appShiftIds.add(appShiftId);
        if (Array.isArray(after.shiftIds)) {
          after.shiftIds
            .map((shift: unknown) => normalizeStringToken(shift))
            .filter(Boolean)
            .forEach((shift: string) => appShiftIds.add(shift));
        }
        const appPostIds = new Set<string>();
        const appJobId = normalizeStringToken(after.jobId);
        const appPostId = normalizeStringToken(after.postId);
        const appJobPostId = normalizeStringToken((after as any).jobPostId);
        if (appJobId) appPostIds.add(appJobId);
        if (appPostId) appPostIds.add(appPostId);
        if (appJobPostId) appPostIds.add(appJobPostId);
        const appJobTitle = normalizeStringToken(after.jobTitle || after.postTitle);
        const appCompanyName = normalizeStringToken(after.companyName || after.companyTitle);

        try {
          const assignSnap = await admin.firestore()
            .collection(`tenants/${tenantId}/assignments`)
            .where('userId', '==', userId)
            .where('status', 'in', ['proposed', 'confirmed', 'active'])
            .limit(20)
            .get();

          const hasMatchingAssignment = assignSnap.docs.some((docSnap) => {
            const assignment = docSnap.data() || {};
            const assignmentJobOrderId = normalizeStringToken(assignment.jobOrderId);
            const assignmentShiftId = normalizeStringToken(assignment.shiftId);
            const assignmentPostId = normalizeStringToken(assignment.jobPostId);
            const assignmentJobTitle = normalizeStringToken(assignment.jobTitle);
            const assignmentCompanyName = normalizeStringToken(assignment.companyName || assignment.companyTitle);

            if (appJobOrderId && assignmentJobOrderId && appJobOrderId === assignmentJobOrderId) return true;
            if (appShiftIds.size > 0 && assignmentShiftId && appShiftIds.has(assignmentShiftId)) return true;
            if (appPostIds.size > 0 && assignmentPostId && appPostIds.has(assignmentPostId)) return true;
            if (appJobTitle && appCompanyName && assignmentJobTitle && assignmentCompanyName) {
              return appJobTitle === assignmentJobTitle && appCompanyName === assignmentCompanyName;
            }
            if (appJobTitle && assignmentJobTitle) return appJobTitle === assignmentJobTitle;
            return false;
          });

          if (hasMatchingAssignment) {
            logger.info(`Application ${applicationId} status=waitlisted but user ${userId} has a matching good-standing assignment; skipping waitlisted notification`);
            return true;
          }
        } catch (err) {
          logger.warn(`Could not run matching-assignment waitlist guard for application ${applicationId}:`, err);
        }

        return false;
      };

      // Placement-level guard: placement can exist before assignment status settles.
      // If worker is currently placed for this job/shift, do not send waitlist SMS.
      const skipWaitlistedWhenUserHasPlacementForJobOrShift = async () => {
        const userId = after.userId || after.candidateId;
        if (!userId) return false;
        const appJobOrderId = normalizeStringToken(after.jobOrderId);
        const appShiftIds = new Set<string>();
        const appShiftId = normalizeStringToken(after.shiftId);
        if (appShiftId) appShiftIds.add(appShiftId);
        if (Array.isArray(after.shiftIds)) {
          after.shiftIds
            .map((shift: unknown) => normalizeStringToken(shift))
            .filter(Boolean)
            .forEach((shift: string) => appShiftIds.add(shift));
        }
        try {
          const placementSnap = await admin.firestore()
            .collection(`tenants/${tenantId}/placements`)
            .where('userId', '==', userId)
            .limit(20)
            .get();
          const hasMatchingPlacement = placementSnap.docs.some((docSnap) => {
            const placement = docSnap.data() || {};
            const placementJobOrderId = normalizeStringToken(placement.jobOrderId);
            const placementShiftId = normalizeStringToken(placement.shiftId);
            if (appJobOrderId && placementJobOrderId && appJobOrderId === placementJobOrderId) return true;
            if (appShiftIds.size > 0 && placementShiftId && appShiftIds.has(placementShiftId)) return true;
            return false;
          });
          if (hasMatchingPlacement) {
            logger.info(`Application ${applicationId} status=waitlisted but user ${userId} has a matching placement; skipping waitlisted notification`);
            return true;
          }
        } catch (err) {
          logger.warn(`Could not run placement waitlist guard for application ${applicationId}:`, err);
        }
        return false;
      };

      if (newStatus === 'rejected' && (await skipStatusNotificationWhenAssigned('skipping rejection notification'))) {
        return { success: true };
      }
      if (newStatus === 'rejected' && (await skipWaitlistedOrRejectedWhenUserHasAssignmentForJob())) {
        return { success: true };
      }
      // Do not send waitlisted SMS when the user is already in good standing (assigned or accepted/confirmed for this job).
      if (newStatus === 'waitlisted') {
        const waitlistDedupeScopeKey = [
          normalizeStringToken(after.userId || after.candidateId),
          normalizeStringToken(after.jobOrderId || after.jobId || after.postId || (after as any).jobPostId || applicationId),
        ].join('__');
        const canProcessWaitlistScopeEvent = await markLifecycleEventIfFirst({
          tenantId,
          dedupeKey: `application_waitlisted_scope__${waitlistDedupeScopeKey}`,
          eventType: 'application_waitlisted_scope',
          context: { applicationId, userId: after.userId || after.candidateId, jobOrderId: after.jobOrderId, jobId: after.jobId, postId: after.postId },
        });
        if (!canProcessWaitlistScopeEvent) {
          logger.info(`Application ${applicationId} waitlisted scope dedupe hit; skipping duplicate waitlisted SMS`);
          return { success: true, deduped: true };
        }
        if ((oldStatus || '').toLowerCase() === 'accepted' || (oldStatus || '').toLowerCase() === 'confirmed') {
          logger.info(`Application ${applicationId} status changed to waitlisted but previous status was ${oldStatus}; skipping (user was already accepted/confirmed)`);
          return { success: true };
        }
        if (await skipStatusNotificationWhenAssigned('skipping waitlisted notification')) return { success: true };
        if (await skipWaitlistedOrRejectedWhenUserHasAssignmentForJob()) return { success: true };
        if (await skipWaitlistedWhenOtherApplicationAcceptedForSameJob()) return { success: true };
        if (await skipWaitlistedWhenUserHasAssignmentForThisShift()) return { success: true };
        if (await skipWaitlistedWhenUserHasMatchingGoodStandingAssignment()) return { success: true };
        if (await skipWaitlistedWhenUserHasPlacementForJobOrShift()) return { success: true };
        // Final hardening: re-read application and assignments right before we'd send (handles race where waitlist write fired before placement write was visible).
        const reReadAppSnap = await admin.firestore().doc(`tenants/${tenantId}/applications/${applicationId}`).get();
        const reReadApp = reReadAppSnap.data();
        const currentStatus = (reReadApp?.status || '').toLowerCase();
        if (currentStatus !== 'waitlisted') {
          logger.info(`Application ${applicationId} final re-read status=${currentStatus || 'unknown'}; skipping stale waitlisted SMS`);
          return { success: true };
        }
        if (currentStatus === 'accepted' || currentStatus === 'confirmed') {
          logger.info(`Application ${applicationId} re-read shows status=${currentStatus}; skipping waitlisted SMS (placement won race)`);
          return { success: true };
        }
        const reReadAssignmentId = reReadApp?.assignmentId;
        if (reReadAssignmentId) {
          const reReadAssignSnap = await admin.firestore().doc(`tenants/${tenantId}/assignments/${reReadAssignmentId}`).get();
          const assignStatus = (reReadAssignSnap.data()?.status || '').toLowerCase();
          if (['proposed', 'confirmed', 'active'].includes(assignStatus)) {
            logger.info(`Application ${applicationId} re-read has assignment ${reReadAssignmentId} status=${assignStatus}; skipping waitlisted SMS`);
            return { success: true };
          }
        }
        // One more time: user might have an assignment for this job even if this application doc was overwritten (e.g. bulk waitlist cleared assignmentId).
        if (await skipWaitlistedOrRejectedWhenUserHasAssignmentForJob()) {
          logger.info(`Application ${applicationId} final check: user has assignment for job; skipping waitlisted SMS`);
          return { success: true };
        }
      }

      // Get user ID from application (userId or candidateId)
      const userId = after.userId || after.candidateId;
      if (!userId) {
        logger.warn(`Application ${applicationId} has no userId or candidateId, skipping SMS`);
        return { success: true };
      }
      const updatedAtToken =
        typeof (after.updatedAt as any)?.toMillis === 'function'
          ? String((after.updatedAt as any).toMillis())
          : typeof (after.updatedAt as any)?._seconds === 'number'
            ? String((after.updatedAt as any)._seconds)
            : 'na';
      const canProcessStatusEvent = await markLifecycleEventIfFirst({
        tenantId,
        dedupeKey: `application_status__${applicationId}__${String(oldStatus || '').toLowerCase()}__${String(newStatus || '').toLowerCase()}__${updatedAtToken}`,
        eventType: 'application_status_changed',
        context: { applicationId, userId, oldStatus, newStatus },
      });
      if (!canProcessStatusEvent) {
        return { success: true, deduped: true };
      }

      // Fetch user data to get phone number
      try {
        const userDoc = await admin.firestore().doc(`users/${userId}`).get();
        const userData = userDoc.data();

        if (!userData) {
          logger.warn(`User ${userId} not found for application ${applicationId}`);
          return { success: true };
        }

        // Require at least one phone number (attempt send even if not verified)
        const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
        if (!phoneE164) {
          logger.info(`User ${userId} has no phone number, skipping SMS for application ${applicationId}`);
          return { success: true };
        }

        if (newStatus === 'submitted' && shouldSkipStaleApplicationReceivedSms(applicationId, after)) {
          logger.info(
            `Application ${applicationId}: skipping status→submitted notifications (stale submit anchor)`
          );
          return { success: true };
        }

        // Try to find matching template
        let message = '';
        let templateFound = false;

        try {
          // PHASE 2.1: Use new template engine with legacy fallback
          // When status becomes 'submitted' (e.g. re-apply after withdraw), use same template as new application
          let messageTypeId = 'application_status_change';
          if (newStatus === 'submitted') messageTypeId = 'application_received';
          else if (newStatus === 'screened') messageTypeId = 'application_screened';
          else if (newStatus === 'advanced') messageTypeId = 'application_advanced';
          else if (newStatus === 'offer') messageTypeId = 'application_offered';
          else if (newStatus === 'hired') messageTypeId = 'application_hired';
          // 'accepted' and 'confirmed' are the "selected / offer accepted" terminal
          // states — they must NEVER fall through to the generic
          // application_status_change template, because many tenants have that slot
          // configured with waitlist / generic-update copy. Route them to the
          // application_hired template explicitly.
          else if (newStatus === 'accepted') messageTypeId = 'application_hired';
          else if (newStatus === 'confirmed') messageTypeId = 'application_hired';
          else if (newStatus === 'rejected') messageTypeId = 'application_rejected';
          else if (newStatus === 'waitlisted') messageTypeId = 'application_waitlisted';

          const { getTemplateWithLegacyFallback } = await import('./messaging/templateMigration');
          const { renderTemplate } = await import('./messaging/templateEngine');
          
          const templateResult = await getTemplateWithLegacyFallback(
            tenantId,
            messageTypeId,
            'sms',
            (userData.preferredLanguage || 'en') as 'en' | 'es',
            'application',
            newStatus === 'submitted' ? 'applicationCreated' : 'applicationStatusChange',
            newStatus === 'submitted' ? 'applicationCreated' : newStatus
          );

          if (templateResult) {
            // Build context for variable resolution
            const context: TemplateVariableContext = {
              userId: userId,
              userData: userData,
              applicationId: applicationId,
              applicationData: after,
              jobOrderId: after.jobOrderId,
              jobPostId: after.jobId || after.postId,
              tenantId: tenantId,
              status: newStatus,
            };

            // Resolve all variables using standardized resolver
            const variables = await resolveTemplateVariables(context);

            // Render template (new engine handles STOP footer automatically)
            message = await renderTemplate(templateResult.template, variables, tenantId);
            message = cleanupMisSavedPlaceholders(message, variables);
            templateFound = true;
            logger.info(`Using ${templateResult.source} template for application ${applicationId} status change to ${newStatus}`);
          }
        } catch (templateError: any) {
          logger.warn(`Failed to fetch template for application ${applicationId}:`, templateError);
          // Fall back to default messages
        }

        // Fallback to default messages if no template found
        if (!templateFound) {
          // Use resolver for fallback too (for consistency)
          const context: TemplateVariableContext = {
            userId: userId,
            userData: userData,
            applicationId: applicationId,
            applicationData: after,
            jobOrderId: after.jobOrderId,
            jobPostId: after.jobId || after.postId,
            tenantId: tenantId,
            status: newStatus,
          };
          const variables = await resolveTemplateVariables(context);
          
          const firstName = variables.firstName;
          const jobTitle = variables.jobTitle;

          switch (newStatus) {
            case 'submitted':
              // Re-apply (withdrawn → submitted) or first-time; same message as application_received
              message = `Thanks for submitting your application for ${jobTitle}, ${firstName}. We'll review it and get back to you soon.`;
              logger.info(`Application ${applicationId}: using fallback message for status=submitted (re-apply or status change)`);
              break;
            case 'screened':
              message = `Hi ${firstName}, your application for ${jobTitle} has been screened. We'll contact you soon.`;
              break;
            case 'advanced':
            case 'interview':
              message = `Hi ${firstName}, your application for ${jobTitle} has advanced to the next stage. Check your account for details.`;
              break;
            case 'offer':
              message = `Hi ${firstName}, you've received an offer for ${jobTitle}. Please check your account for details.`;
              break;
            case 'hired':
            case 'accepted':
            case 'confirmed':
              message = `Welcome to the team ${firstName}! Your application for ${jobTitle} has been accepted.`;
              break;
            case 'waitlisted':
              message = `Hi ${firstName}, you've been waitlisted for ${jobTitle}. We'll contact you if a spot opens up.`;
              break;
            case 'rejected':
            case 'withdrawn':
              if (newStatus === 'rejected') {
                message = `Thank you for your interest, ${firstName}. Unfortunately we won't need you for this role at this time.`;
              } else {
                logger.info(`Application ${applicationId} withdrawn - skipping SMS`);
                return { success: true };
              }
              break;
            default:
              // Unknown status, skip SMS
              logger.info(`Unknown status ${newStatus} for application ${applicationId}, skipping SMS`);
              return { success: true };
          }
        }

        // Inbox + push for application_status_changed (every status change gets notification; SMS is separate)
        const jobPostId = after.jobId || after.postId;
        const statusTitle =
          newStatus === 'accepted' || newStatus === 'hired' || newStatus === 'confirmed'
            ? "You've been selected"
            : newStatus === 'offer'
              ? "You've received an offer"
            : newStatus === 'rejected'
              ? 'Application declined'
              : newStatus === 'waitlisted'
                ? "You've been waitlisted"
                : newStatus === 'screened' || newStatus === 'advanced' || newStatus === 'interview' || newStatus === 'offer' || newStatus === 'submitted'
                  ? 'Application under review'
                  : 'Application status updated';
        try {
          // `submitted` thank-you is delivered by sendLegacyApplicationStatusMessage → routingOrchestrator (SMS, email, push, inbox).
          // Avoid duplicate FCM + inbox rows from sendApplicationStatusChangedNotification.
          if (newStatus !== 'submitted') {
            await sendApplicationStatusChangedNotification({
              uid: userId,
              tenantId,
              jobPostId,
              title: statusTitle,
              body: message || statusTitle,
            });
          } else {
            logger.info(
              `Application ${applicationId}: skipping worker push/inbox duplicate for status=submitted (orchestrator handles application_received)`
            );
          }
        } catch (pushErr: any) {
          logger.warn(`Application status push/inbox failed for ${applicationId}: ${pushErr?.message || pushErr}`);
        }

        if (message) {
          // Check notification settings
          const shouldSend = await shouldSendNotification(userId, 'applicationUpdates', 'sms');

          if (!shouldSend) {
            logger.info(`SMS disabled for user ${userId} - skipping application status change notification`);
            return { success: true };
          }

          if (newStatus === 'submitted') {
            const thanksDedupeKey = applicationReceivedThanksDedupeKey(applicationId, after, {
              mode: 'update',
              oldStatus,
            });
            const combinedResult = await sendCombinedApplicationInterviewFirstTouch({
              tenantId,
              applicationId,
              applicationData: after as Record<string, unknown>,
              userId,
              userData: userData as Record<string, unknown>,
              phoneE164,
              thanksDedupeKey: thanksDedupeKey,
              source: 'application_status_changed',
            });
            if (combinedResult === 'sent' || combinedResult === 'failed' || combinedResult === 'deduped_thanks') {
              return { success: true };
            }

            const claimedThanks = await markLifecycleEventIfFirst({
              tenantId,
              dedupeKey: thanksDedupeKey,
              eventType: 'application_received_thanks',
              context: { applicationId, userId, source: 'onUpdate' },
            });
            if (!claimedThanks) {
              logger.info(
                `Application ${applicationId}: application_received dedupe hit key=${thanksDedupeKey} (onCreate already sent or duplicate)`
              );
              return { success: true, deduped: true };
            }
          }

          logger.info(`Sending application status SMS for ${applicationId} (${oldStatus} → ${newStatus}) to ${phoneE164}`);
          // PHASE 3: Route through orchestrator instead of direct Twilio call
          const result = await sendLegacyApplicationStatusMessage({
            tenantId,
            userId,
            phoneE164,
            message,
            source: 'application_status_changed',
            sourceId: applicationId,
            applicationId,
            status: newStatus,
            applicationData: after,
            jobOrderId: after.jobOrderId,
            jobPostId: after.jobId || after.postId,
          });

          if (result.status === 'skipped_waitlist') {
            logger.info(
              `Application ${applicationId}: waitlist SMS suppressed (global gate; set ENABLE_APPLICATION_WAITLIST_NOTIFICATIONS=true to allow)`
            );
          } else if (result.success) {
            logger.info(`SMS sent for application status change ${applicationId} (${oldStatus} → ${newStatus}) to ${phoneE164}`);
          } else {
            logger.warn(`Failed to send SMS for application ${applicationId}: ${result.error}`);
          }
        }

        return { success: true };
      } catch (userError: any) {
        logger.error(`Error fetching user data for application ${applicationId}:`, userError);
        // Don't throw - allow application update to succeed even if SMS fails
        return { success: true };
      }
    } catch (error: any) {
      logger.error(`Error in onApplicationStatusChanged for ${applicationId}:`, error);
      // Don't throw - trigger should not fail application update
      return { success: false, error: error.message };
    }
  }
);

