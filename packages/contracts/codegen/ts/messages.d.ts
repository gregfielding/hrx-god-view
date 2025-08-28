export interface Message {
  /**
   * Unique identifier for the message
   */
  id?: string;
  /**
   * Tenant ID this message belongs to
   */
  tenantId: string;
  /**
   * Type of sender
   */
  senderType: 'recruiter' | 'candidate' | 'ai' | 'system';
  /**
   * ID of the sender
   */
  senderId: string;
  /**
   * Message text content
   */
  text: string;
  /**
   * Array of attachment URLs
   */
  attachments?: string[];
  /**
   * Message timestamp
   */
  ts: number;
  /**
   * Array of user IDs who have read this message
   */
  readBy?: string[];
  /**
   * Message delivery status
   */
  deliveryStatus?: 'queued' | 'sent' | 'delivered' | 'read';
  metadata?: {
    messageType?: 'text' | 'image' | 'file' | 'system' | 'notification';
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    expiresAt?: number;
    [k: string]: unknown;
  };
}
