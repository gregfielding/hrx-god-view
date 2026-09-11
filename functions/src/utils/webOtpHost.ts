/**
 * WebOTP host binding for the self-managed sign-in code SMS.
 *
 * Android Chrome's one-tap code autofill (WebOTP) only hands the code to a
 * page whose top-level host matches the SMS's final line exactly:
 * `@<host> #<code>`. The web app is served on several hostnames during the
 * hrxone.com → app.c1staffing.com migration (option 1: both keep working),
 * so the browser tells `sendOtp` which host it's on and we echo it — but
 * only for hosts we serve, so the SMS can never be bound to someone else's
 * site. Native app calls pass nothing and get the canonical host.
 */
import { PUBLIC_APP_HOST } from '../config/appOrigin';

export const WEB_OTP_HOSTS: readonly string[] = [
  'hrxone.com',
  'www.hrxone.com',
  'app.hrxone.com',
  'app.c1staffing.com',
  'hrx1-d3beb.web.app',
  'hrx1-d3beb.firebaseapp.com',
];

/** The requested host when it's one of ours, else [fallback] (the canonical host). */
export function resolveWebOtpHost(requested: unknown, fallback: string = PUBLIC_APP_HOST): string {
  const host = typeof requested === 'string' ? requested.trim().toLowerCase().replace(/\.$/, '') : '';
  return WEB_OTP_HOSTS.includes(host) ? host : fallback;
}

/** SMS body; the last line is the WebOTP binding and its format is exact. */
export function buildOtpSmsBody(code: string, host: string): string {
  return `Your C1 Staffing verification code is ${code}. It expires in 10 minutes.\n\n@${host} #${code}`;
}
