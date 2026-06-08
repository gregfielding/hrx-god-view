import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export type FirestoreGmailStatus = {
  connected: boolean;
  email?: string;
};

/**
 * Cheap Firestore-only "is Gmail connected" check. Replaces page-mount calls
 * to the `getGmailStatusOptimized` Cloud Function, which were costing ~30k
 * invocations/month while only returning the answer this check returns directly.
 *
 * Token validity is intentionally NOT verified here — that's an expensive Gmail
 * API hit, and if the token is expired the actual send call will fail and
 * surface the error to the user at the moment they care. Mount-time UI
 * (badges, sender chips, "Compose" enable/disable) only needs to know whether
 * tokens *exist*, which Firestore already knows.
 *
 * Checks all three source-of-truth fields written by the various OAuth flows:
 *   users/{uid}.gmailTokens.access_token
 *   users/{uid}.integrations.google.accessToken
 *   users/{uid}.tenantIds.{tenantId}.integrations.google.accessToken
 */
export async function getGmailConnectionFromFirestore(
  uid: string,
  tenantId?: string | null,
): Promise<FirestoreGmailStatus> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return { connected: false };
    const data = snap.data() as any;
    const tenantIntegration = tenantId
      ? data?.tenantIds?.[tenantId]?.integrations?.google
      : null;
    const topLevelIntegration = data?.integrations?.google;
    const gmailTokens = data?.gmailTokens;
    const connected = !!(
      gmailTokens?.access_token ||
      tenantIntegration?.accessToken ||
      topLevelIntegration?.accessToken
    );
    const email =
      tenantIntegration?.email ||
      topLevelIntegration?.email ||
      data?.email;
    return { connected, email };
  } catch {
    return { connected: false };
  }
}
