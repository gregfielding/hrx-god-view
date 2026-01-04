/**
 * Push Provider Interface
 * 
 * Provider-agnostic interface for push notifications.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 2.1 PushProvider Interface
 */

export interface PushTarget {
  userId: string;
  deviceTokens: string[]; // FCM/Expo tokens
}

export interface PushSendParams {
  tenantId: string;
  targets: PushTarget[];
  title: string;
  body: string;
  data?: Record<string, any>;
  messageTypeId: string;
}

export interface PushSendResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors?: Array<{
    deviceToken: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface PushProvider {
  sendPush(params: PushSendParams): Promise<PushSendResult>;
}

