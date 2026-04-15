/**
 * Callable: after a recruiter updates shift times/dates/instructions, optionally notify assigned workers (SMS, email, push).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendMessage } from '../messaging/routingOrchestrator';
import { canManageAssignments } from '../placementsApi';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PUBLIC_ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://hrxone.com';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Active-ish assignment rows that should receive shift updates */
const NOTIFY_STATUSES = new Set([
  'proposed',
  'pending',
  'confirmed',
  'active',
  'accepted',
  'assigned',
  'placed',
]);

export const notifyShiftWorkersUpdated = onCall(
  {
    cors: true,
    region: process.env.FUNCTIONS_REGION || 'us-central1',
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    const data = request.data as {
      tenantId?: string;
      jobOrderId?: string;
      shiftId?: string;
      jobTitle?: string;
      scheduleSection?: string;
      instructionsSection?: string;
    };

    const tenantId = String(data.tenantId || '').trim();
    const jobOrderId = String(data.jobOrderId || '').trim();
    const shiftId = String(data.shiftId || '').trim();
    if (!tenantId || !jobOrderId || !shiftId) {
      throw new HttpsError('invalid-argument', 'tenantId, jobOrderId, and shiftId are required');
    }

    const allowed = await canManageAssignments(request.auth, tenantId, request.auth.uid);
    if (!allowed) {
      throw new HttpsError('permission-denied', 'You do not have permission to notify workers for this tenant');
    }

    const jobTitle = String(data.jobTitle || 'your role').trim() || 'your role';
    const scheduleSection = String(data.scheduleSection || '').trim();
    const instructionsSection = String(data.instructionsSection || '').trim();

    const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);
    const snap = await assignmentsRef
      .where('jobOrderId', '==', jobOrderId)
      .where('shiftId', '==', shiftId)
      .get();

    let notified = 0;
    for (const docSnap of snap.docs) {
      const a = docSnap.data() as Record<string, unknown>;
      const rawStatus = String(a.status || '').trim().toLowerCase();
      if (rawStatus && !NOTIFY_STATUSES.has(rawStatus)) continue;

      const uid = String(a.userId || a.candidateId || '').trim();
      if (!uid) continue;

      const assignmentId = docSnap.id;
      const detailUrl = `${PUBLIC_ORIGIN}/c1/workers/assignments/${assignmentId}`;

      const htmlParts: string[] = [];
      htmlParts.push(
        `<p>Your shift to work as a <strong>${escapeHtml(jobTitle)}</strong> has been updated.</p>`
      );
      if (scheduleSection) {
        htmlParts.push(
          `<p><strong>Schedule</strong></p><p>${escapeHtml(scheduleSection).replace(/\n/g, '<br/>')}</p>`
        );
      }
      if (instructionsSection) {
        htmlParts.push(
          `<p><strong>Instructions</strong></p><p>${escapeHtml(instructionsSection).replace(/\n/g, '<br/>')}</p>`
        );
      }
      htmlParts.push(
        `<p><a href="${escapeHtml(detailUrl)}">Click here for details</a></p>`
      );
      const emailHtml = `<div>${htmlParts.join('')}</div>`;

      const smsChunks: string[] = [
        `Your shift to work as a ${jobTitle} has been updated.`,
      ];
      if (scheduleSection) {
        smsChunks.push(`Schedule: ${scheduleSection.replace(/\s+/g, ' ').trim()}`);
      }
      if (instructionsSection) {
        const ins = instructionsSection.replace(/\s+/g, ' ').trim();
        smsChunks.push(ins.length > 280 ? `${ins.slice(0, 277)}...` : ins);
      }
      smsChunks.push(`Details: ${detailUrl}`);
      const smsBody = smsChunks.join(' ').slice(0, 1600);

      try {
        await sendMessage({
          tenantId,
          userId: uid,
          messageTypeId: 'shift_details_updated',
          variables: {
            _directMessage: true,
            _message: emailHtml,
            _rawMessage: smsBody,
            _subject: 'Your scheduled shift has been updated',
          },
          metadata: {
            ctaUrl: `/c1/workers/assignments/${assignmentId}`,
            shiftId,
            jobOrderId,
            assignmentId,
          },
          source: 'system',
          sourceId: shiftId,
        });
        notified += 1;
      } catch (err: any) {
        logger.error('notifyShiftWorkersUpdated: sendMessage failed', {
          assignmentId,
          uid,
          error: err?.message || String(err),
        });
      }
    }

    return { success: true, notified, scanned: snap.docs.length };
  }
);
