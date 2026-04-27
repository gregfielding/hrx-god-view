/**
 * Slack Reactions API Client
 * 
 * Typed functions for Slack reactions operations.
 * Calls Firebase Cloud Functions for reaction operations.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

export interface ReactToSlackMessageInput {
  channelId: string;
  messageTs: string;
  emoji: string;
}

export interface ReactToSlackMessageResult {
  success: boolean;
}

/**
 * React to a Slack message (toggle reaction)
 */
export async function callReactToSlackMessage(
  input: ReactToSlackMessageInput
): Promise<ReactToSlackMessageResult> {
  const reactToSlackMessageFn = httpsCallable<
    ReactToSlackMessageInput,
    ReactToSlackMessageResult
  >(functions, 'reactToSlackMessage');
  const response = await reactToSlackMessageFn(input);
  return response.data;
}

