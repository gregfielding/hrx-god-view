#!/usr/bin/env ts-node

/**
 * One-off: set Mark's custom claims for tenant BCiP2bQ9CgVOCTfV6MhD so he can
 * read assignments and use recruiter job order pages. Firestore rules use
 * request.auth.token.roles[tenantId], not the user document.
 *
 * Usage (from repo root):
 *   npx ts-node scripts/set-mark-tenant-claims.ts
 *
 * Requires: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_PATH in .env.local
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as path from 'path';
import { config } from 'dotenv';

config({ path: path.join(__dirname, '..', '.env.local') });

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!projectId || !serviceAccountPath) {
  console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_PATH in .env.local');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require(serviceAccountPath);
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId,
});
const auth = getAuth(app);

const MARK_UID = 'kf63Uari54MU1t2ZxEkDsIE6BDx2';
const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

async function main() {
  const user = await auth.getUser(MARK_UID);
  const current = (user.customClaims || {}) as {
    roles?: Record<string, { role: string; securityLevel: string }>;
    ver?: number;
    [k: string]: unknown;
  };

  const newClaims = {
    ...current,
    roles: {
      ...(current.roles || {}),
      [TENANT_ID]: {
        role: 'Recruiter',
        securityLevel: '7',
      },
    },
    ver: (current.ver || 1) + 1,
  };

  await auth.setCustomUserClaims(MARK_UID, newClaims);
  console.log('✅ Set custom claims for Mark (uid:', MARK_UID, ')');
  console.log('   roles[' + TENANT_ID + '] = Recruiter (securityLevel 7)');
  console.log('   Mark should sign out and sign back in (or refresh ID token) for changes to take effect.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
