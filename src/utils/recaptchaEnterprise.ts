/**
 * reCAPTCHA Enterprise integration utilities
 */

// Declare grecaptcha as global
declare global {
  interface Window {
    grecaptcha: any;
  }
}

// Temporarily disabled for production - update with proper domain-restricted key
const RECAPTCHA_SITE_KEY = process.env.NODE_ENV === 'development' ? '6LfslOQrAAAAADtgTB4kB1N3_BY2DfSKXgKpk9Tu' : null;

/**
 * Execute reCAPTCHA Enterprise and get a token
 * @param action - The action being performed (e.g., 'LOGIN', 'SIGNUP')
 * @returns Promise resolving to the reCAPTCHA token
 */
export async function executeRecaptcha(action = 'LOGIN'): Promise<string> {
  return new Promise((resolve, reject) => {
    // Skip reCAPTCHA in production if no valid site key
    if (!RECAPTCHA_SITE_KEY) {
      console.warn('reCAPTCHA disabled in production - using dummy token');
      resolve('dummy-token-for-production');
      return;
    }

    if (!window.grecaptcha) {
      reject(new Error('reCAPTCHA not loaded'));
      return;
    }

    window.grecaptcha.enterprise.ready(async () => {
      try {
        const token = await window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
        resolve(token);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Check if reCAPTCHA is loaded and ready
 * @returns boolean indicating if reCAPTCHA is available
 */
export function isRecaptchaReady(): boolean {
  return !!(window.grecaptcha && window.grecaptcha.enterprise);
}

/**
 * Wait for reCAPTCHA to be ready
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Promise that resolves when reCAPTCHA is ready
 */
export function waitForRecaptcha(timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isRecaptchaReady()) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (isRecaptchaReady()) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('reCAPTCHA failed to load within timeout'));
      }
    }, 100);
  });
}
