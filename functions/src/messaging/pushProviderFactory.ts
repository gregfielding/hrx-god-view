/**
 * Push Provider Factory
 * 
 * Centralized provider selection.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 2.3 Push Provider Factory
 */

import { PushProvider } from './PushProvider';
import { FcmPushProvider } from './FcmPushProvider';
import { logger } from 'firebase-functions/v2';

let cachedProvider: PushProvider | null = null;

/**
 * Get the push provider instance (singleton)
 * 
 * For now there is only one implementation (FCM).
 * Optionally add PUSH_PROVIDER env and Mock provider similar to SMS.
 */
export function getPushProvider(): PushProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  logger.info('Initializing FcmPushProvider');
  cachedProvider = new FcmPushProvider();

  return cachedProvider;
}

/**
 * Reset the push provider (useful for testing)
 */
export function resetPushProvider(): void {
  cachedProvider = null;
}

