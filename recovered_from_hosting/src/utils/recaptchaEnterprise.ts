/**
 * reCAPTCHA Enterprise integration utilities
 */

/**
 * reCAPTCHA has been disabled across the application.
 * These helpers now resolve immediately so existing auth flows continue to work
 * without loading Google's reCAPTCHA scripts.
 */
export async function executeRecaptcha(action = 'LOGIN'): Promise<string> {
  console.warn(`[reCAPTCHA disabled] Skipping token for action "${action}"`);
  return 'recaptcha-disabled';
}

export function isRecaptchaReady(): boolean {
  return true;
}

export function waitForRecaptcha(_timeout = 10000): Promise<void> {
  return Promise.resolve();
}
