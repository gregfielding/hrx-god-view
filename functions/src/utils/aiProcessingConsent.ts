/**
 * Worker AI-processing consent (Greg 2026-09-10; App Store guideline 5.1.2(i):
 * disclose and get explicit permission before sending personal data to a
 * third-party AI).
 *
 * users/{uid}.userAgreements.aiProcessing = { agreed, version, timestamp, source }
 * - captured at sign-up (app + web checkbox, unchecked by default, optional)
 * - captured by a one-time prompt for existing app accounts
 * - changeable in the app's Profile → About & Legal
 *
 * Only an explicit decline turns the AI-backed features off. Accounts that
 * predate the choice (existing web workers) keep the behavior disclosed in
 * the privacy policy; the app never reaches an AI feature before the worker
 * has chosen.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

export const AI_PROCESSING_CONSENT_VERSION = '2026-09-10';

export function aiProcessingDeclined(userDoc: Record<string, unknown> | null | undefined): boolean {
  const agreements = (userDoc?.userAgreements ?? null) as Record<string, unknown> | null;
  const ai = (agreements?.aiProcessing ?? null) as Record<string, unknown> | null;
  return ai?.agreed === false;
}

/** Fail closed: if the users doc can't be read, don't send data to the AI. */
export async function loadAiProcessingDeclined(uid: string): Promise<boolean> {
  if (!uid) return true;
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    return aiProcessingDeclined(snap.data());
  } catch (error) {
    logger.warn('aiProcessingConsent.read_failed', { uid, message: (error as Error)?.message });
    return true;
  }
}
