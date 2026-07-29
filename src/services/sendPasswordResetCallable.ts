/**
 * Password-reset send — routes through the server callable so the email
 * goes out via our AUTHENTICATED SendGrid sender (no-reply@hrxone.com),
 * not Firebase's built-in mailer (noreply@hrx1-d3beb.firebaseapp.com,
 * which isn't domain-authenticated and gets dropped/spam-foldered).
 *
 * Drop-in replacement for the client SDK `sendPasswordResetEmail`
 * (Danny 2026-07-29). The link still lands on /setup-password.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export interface SendPasswordResetResult {
  success: boolean;
  /** Present only for authenticated staff callers; false ⇒ no Auth account yet. */
  userExists?: boolean;
}

/**
 * @param email        the account email to reset
 * @param continueUrl  optional in-app path to land on after reset
 *                     (e.g. '/c1/workers/payroll')
 */
export async function sendPasswordReset(
  email: string,
  continueUrl?: string,
): Promise<SendPasswordResetResult> {
  const fn = httpsCallable(functions, 'sendPasswordResetV2');
  const res = (await fn({ email: email.trim().toLowerCase(), continueUrl })) as {
    data: SendPasswordResetResult;
  };
  return res.data;
}
