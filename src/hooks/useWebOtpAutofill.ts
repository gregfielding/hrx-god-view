import { useEffect } from 'react';

/**
 * WebOTP autofill (Android Chrome, 2026-08-25): while `active`, listens for
 * the incoming verification SMS and hands the code to `onCode` — the SMS must
 * end with the origin-binding line `@hrxone.com #123456` (see sendSelfOtp in
 * functions/src/twilio.ts). iOS/Safari ignores this API and autofills via
 * autocomplete="one-time-code" on the input instead — keep both.
 * No-op on unsupported browsers; aborts the listener on unmount/deactivate.
 */
export function useWebOtpAutofill(active: boolean, onCode: (code: string) => void): void {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined' || !('OTPCredential' in window)) return undefined;
    const ac = new AbortController();
    (navigator.credentials as unknown as {
      get: (opts: unknown) => Promise<{ code?: string } | null>;
    })
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((cred) => {
        const code = String(cred?.code ?? '').trim();
        if (/^\d{6}$/.test(code)) onCode(code);
      })
      .catch(() => {
        // Aborted or dismissed — the user can still type the code.
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
