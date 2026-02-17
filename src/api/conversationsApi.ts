/**
 * Client API for tenant-scoped conversations (callables).
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export const sendConversationMessageCallable = httpsCallable<
  { tenantId: string; conversationId: string; text: string },
  { messageId?: string }
>(functions, 'sendConversationMessage');

export const markConversationReadCallable = httpsCallable<
  { tenantId: string; conversationId: string },
  void
>(functions, 'markConversationRead');
