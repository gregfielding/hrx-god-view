/**
 * E-Verify secrets (Firebase Secret Manager).
 * NEVER log or expose these values.
 * ICA v31: username/password (WS credentials).
 */

import { defineSecret } from 'firebase-functions/params';

export const EVERIFY_WS_USERNAME = defineSecret('EVERIFY_WS_USERNAME');
export const EVERIFY_WS_PASSWORD = defineSecret('EVERIFY_WS_PASSWORD');
