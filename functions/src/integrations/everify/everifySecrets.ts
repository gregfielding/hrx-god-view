/**
 * E-Verify secrets (Firebase Secret Manager).
 * NEVER log or expose these values.
 * ICA v31: username/password (WS credentials).
 */

import { defineSecret } from 'firebase-functions/params';

export const EVERIFY_WS_USERNAME = defineSecret('EVERIFY_WS_USERNAME');
export const EVERIFY_WS_PASSWORD = defineSecret('EVERIFY_WS_PASSWORD');

/** @deprecated ICA v31 uses username/password. Kept for rollback only. */
export const EVERIFY_CLIENT_ID = defineSecret('EVERIFY_CLIENT_ID');
export const EVERIFY_CLIENT_SECRET = defineSecret('EVERIFY_CLIENT_SECRET');
