/**
 * E-Verify HTTP worker (Cloud Task target).
 * Creates E-Verify case from user_employments trigger.
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { resolveEligibility } from './everifyEligibility';
import { createAndSubmitCase } from './everifyService';
import { EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD, EVERIFY_CLIENT_ID, EVERIFY_CLIENT_SECRET } from './everifySecrets';

const db = admin.firestore();

function getIcaCredentials(): { username: string; password: string } | null {
  try {
    const u = EVERIFY_WS_USERNAME.value();
    const p = EVERIFY_WS_PASSWORD.value();
    if (u && p) return { username: u, password: p };
  } catch {
    // secrets not configured
  }
  return null;
}

/** Legacy OAuth credentials (EAAT stub / rollback only) */
function getLegacyCredentials(): { clientId: string; clientSecret: string } | null {
  try {
    const id = EVERIFY_CLIENT_ID.value();
    const secret = EVERIFY_CLIENT_SECRET.value();
    if (id && secret) return { clientId: id, clientSecret: secret };
  } catch {
    // secrets not configured
  }
  return null;
}

const OPEN_STATUSES = [
  'draft',
  'ready',
  'submitted',
  'pending',
  'tnc',
  'dhs_verification_in_process',
  'further_action_required',
];

export const processEverifyCaseFromEmployment = onRequest(
  { cors: false, invoker: 'private', secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD, EVERIFY_CLIENT_ID, EVERIFY_CLIENT_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const body = req.body as { tenantId?: string; userEmploymentId?: string };
    const tenantId = body?.tenantId;
    const userEmploymentId = body?.userEmploymentId;

    if (!tenantId || !userEmploymentId) {
      res.status(400).send('Missing tenantId or userEmploymentId');
      return;
    }

    try {
      const eligibility = await resolveEligibility({
        tenantId,
        userEmploymentId,
      });

      if (!eligibility.eligible) {
        logger.info(`E-Verify not eligible for employment ${userEmploymentId}: ${eligibility.errorMessage}`);
        res.status(200).json({ ok: false, reason: eligibility.errorMessage });
        return;
      }

      const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');

      if (eligibility.userEmploymentId) {
        const openByEmployment = await casesRef
          .where('userEmploymentId', '==', eligibility.userEmploymentId)
          .where('status', 'in', OPEN_STATUSES)
          .limit(1)
          .get();
        if (!openByEmployment.empty) {
          logger.info(`E-Verify case already exists for employment ${userEmploymentId}`);
          res.status(200).json({ ok: false, reason: 'Open case already exists' });
          return;
        }
      }

      const dupHash = await casesRef
        .where('requestHash', '==', eligibility.requestHash)
        .limit(1)
        .get();
      if (!dupHash.empty) {
        logger.info(`E-Verify duplicate requestHash for employment ${userEmploymentId}`);
        res.status(200).json({ ok: false, reason: 'Duplicate case' });
        return;
      }

      const result = await createAndSubmitCase({
        tenantId,
        entityId: eligibility.entityId!,
        userId: eligibility.userId!,
        jobOrderId: eligibility.jobOrderId,
        shiftId: eligibility.shiftId,
        assignmentId: eligibility.assignmentId,
        userEmploymentId: eligibility.userEmploymentId,
        startDate: eligibility.startDate,
        everifyCompanyId: eligibility.everifyCompanyId,
        requestHash: eligibility.requestHash,
        icaCredentials: getIcaCredentials(),
        legacyCredentials: getLegacyCredentials(),
      });

      logger.info(`Created E-Verify case ${result.caseId} for employment ${userEmploymentId}`);
      res.status(200).json({
        ok: true,
        caseId: result.caseId,
        everifyCaseNumber: result.everifyCaseNumber,
        status: result.status,
      });
    } catch (err) {
      logger.error(`Error creating E-Verify case for ${userEmploymentId}:`, err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);
