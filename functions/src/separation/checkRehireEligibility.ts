/**
 * Signup-time rehire-ineligibility check (Bluecrew pattern — a terminated
 * worker flagged rehireEligible:false must not slip back in with a fresh
 * account). Called UNAUTHENTICATED from account-creation flows BEFORE the
 * Auth user is minted, so the response is a bare boolean — no reason, no
 * matched identity, nothing an outsider can mine.
 *
 * Matching: exact normalized email OR exact E.164 phone against existing
 * users with rehireEligible === false. Deliberately exact — fuzzy matching
 * here risks blocking legitimate applicants (shared family phones get a
 * pass unless the phone itself is on a flagged account).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const checkRehireEligibility = onCall({ memory: '512MiB' }, async (request) => {
  const { email, phone } = (request.data || {}) as { email?: string; phone?: string };
  const normEmail = String(email || '').trim().toLowerCase();
  const normPhone = String(phone || '').replace(/[^\d+]/g, '');
  if (!normEmail && !normPhone) {
    throw new HttpsError('invalid-argument', 'email or phone required.');
  }

  const checks: Promise<boolean>[] = [];
  if (normEmail) {
    checks.push(
      db
        .collection('users')
        .where('email', '==', normEmail)
        .where('rehireEligible', '==', false)
        .limit(1)
        .get()
        .then((s) => !s.empty),
    );
  }
  if (normPhone) {
    for (const field of ['phoneE164', 'phone']) {
      checks.push(
        db
          .collection('users')
          .where(field, '==', normPhone)
          .where('rehireEligible', '==', false)
          .limit(1)
          .get()
          .then((s) => !s.empty),
      );
    }
  }
  const results = await Promise.all(checks.map((p) => p.catch(() => false)));
  return { eligible: !results.some(Boolean) };
});
