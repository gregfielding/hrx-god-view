/**
 * E-Verify HTTP worker (Cloud Task target).
 * Creates E-Verify case from user_employments trigger.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD } from './everifySecrets';
import { processEverifyCaseFromEmploymentPayload } from './everifyEmploymentProcessor';

export const processEverifyCaseFromEmployment = onRequest(
  { cors: false, invoker: 'private', secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD] },
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
      const result = await processEverifyCaseFromEmploymentPayload({ tenantId, userEmploymentId });
      if (result.ok === false) {
        res.status(200).json({ ok: false, reason: result.reason });
        return;
      }
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
