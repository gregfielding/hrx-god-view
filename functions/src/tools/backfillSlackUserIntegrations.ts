// functions/src/tools/backfillSlackUserIntegrations.ts

import * as admin from 'firebase-admin';

// Only initialize if not already initialized (when run as a standalone script)
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

// TEMP: single-tenant focus for C1 Staffing
const DEFAULT_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

interface SlackUserLinkDoc {
  slackUserId: string;
  teamId?: string;
  email?: string;
  displayName?: string;
  realName?: string;
  username?: string; // slack handle if you store it
  hrxUserId?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

async function backfillSlackUserIntegrations(
  tenantId: string = DEFAULT_TENANT_ID
) {
  const slackUsersCol = db
    .collection('tenants')
    .doc(tenantId)
    .collection('slackUsers');

  console.log(
    `[backfillSlackUserIntegrations] Starting for tenant ${tenantId}...`
  );

  const snapshot = await slackUsersCol.get();

  if (snapshot.empty) {
    console.log(
      `[backfillSlackUserIntegrations] No slackUsers docs found for tenant ${tenantId}.`
    );
    return;
  }

  console.log(
    `[backfillSlackUserIntegrations] Found ${snapshot.size} slackUsers docs. Processing...`
  );

  let processed = 0;
  let updatedUsers = 0;
  let skippedNoHrxUser = 0;
  let skippedNoUserDoc = 0;
  let alreadyHasIntegration = 0;

  for (const doc of snapshot.docs) {
    processed++;
    const data = doc.data() as SlackUserLinkDoc;

    const slackUserId = data.slackUserId || doc.id;
    const hrxUserId = data.hrxUserId;

    if (!hrxUserId) {
      skippedNoHrxUser++;
      console.log(
        `[backfill] Skipping Slack user ${slackUserId} — no hrxUserId mapping.`
      );
      continue;
    }

    const userRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(hrxUserId);

    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      skippedNoUserDoc++;
      console.warn(
        `[backfill] Slack user ${slackUserId} mapped to missing HRX user ${hrxUserId}.`
      );
      continue;
    }

    const userData = userSnap.data() || {};

    // If the user already has a Slack integration and it's the same slackUserId, just skip
    const existingIntegration = (userData.integrations as any)?.slack;
    if (
      existingIntegration &&
      existingIntegration.slackUserId === slackUserId
    ) {
      alreadyHasIntegration++;
      continue;
    }

    const integrationUpdate = {
      integrations: {
        slack: {
          ...(existingIntegration || {}),
          teamId: data.teamId || existingIntegration?.teamId || null,
          slackUserId,
          slackEmail: data.email || existingIntegration?.slackEmail || null,
          displayName:
            data.displayName ||
            data.realName ||
            existingIntegration?.displayName ||
            null,
          username: data.username || existingIntegration?.username || null,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    };

    await userRef.set(integrationUpdate, { merge: true });
    updatedUsers++;

    if (processed % 20 === 0) {
      console.log(`[backfill] Processed ${processed} slackUsers docs...`);
    }
  }

  console.log('[backfillSlackUserIntegrations] DONE.');
  console.log({
    tenantId,
    processed,
    updatedUsers,
    skippedNoHrxUser,
    skippedNoUserDoc,
    alreadyHasIntegration,
  });
}

// Allow running directly via `ts-node` or `node` after compilation
if (require.main === module) {
  backfillSlackUserIntegrations()
    .then(() => {
      console.log('[backfillSlackUserIntegrations] Complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[backfillSlackUserIntegrations] ERROR', err);
      process.exit(1);
    });
}

export { backfillSlackUserIntegrations };



