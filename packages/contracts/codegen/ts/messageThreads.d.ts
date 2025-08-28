export interface MessageThread {
  /**
   * Unique identifier for the message thread
   */
  id?: string;
  /**
   * Tenant ID this thread belongs to
   */
  tenantId: string;
  /**
   * Type of message thread
   */
  type: 'recruiter_thread' | 'ai_thread' | 'system_thread';
  /**
   * Related job order ID
   */
  jobOrderId?: string | null;
  /**
   * Candidate ID this thread is for
   */
  candidateId: string;
  /**
   * Recruiter IDs participating in this thread
   */
  recruiterIds?: string[];
  /**
   * Timestamp of last message
   */
  lastMessageAt: number;
  /**
   * Thread status
   */
  status?: 'open' | 'archived';
  /**
   * Creation timestamp
   */
  createdAt?: number;
  /**
   * Last update timestamp
   */
  updatedAt?: number;
  metadata?: {
    subject?: string;
    tags?: string[];
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    [k: string]: unknown;
  };
}
