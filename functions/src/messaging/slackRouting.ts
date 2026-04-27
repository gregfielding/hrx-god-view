/**
 * Slack Routing Logic
 * 
 * Phase 5: Determines whether messages should be mirrored to Slack
 * based on conversation settings and message metadata
 */

import { SlackConversationMode } from './internalMessaging';
import { InternalMessage } from './internalMessaging';

export interface ShouldMirrorArgs {
  mode: SlackConversationMode;
  message: InternalMessage;
  senderSecurityLevel: number;
}

/**
 * Determine if a message should be mirrored to Slack
 * 
 * @param args - Mode, message, and sender security level
 * @returns true if message should be mirrored, false otherwise
 */
export function shouldMirrorMessageToSlack({
  mode,
  message,
  senderSecurityLevel,
}: ShouldMirrorArgs): boolean {
  // Never mirror messages that originated from Slack
  if (message.mirroredFromSlack) {
    return false;
  }

  // Already mirrored — nothing to do
  if (message.mirroredToSlack) {
    return false;
  }

  switch (mode) {
    case 'off':
      return false;

    case 'manual':
      // Only mirror if explicitly requested via UI
      return message.meta?.sendToSlackRequested === true;

    case 'auto_all':
      // Mirror all messages
      return true;

    case 'auto_admin_only':
      // Only mirror messages from high-security users (securityLevel >= 5)
      return senderSecurityLevel >= 5;

    default:
      return false;
  }
}



