export interface JobsBoardPost {
  /**
   * Unique identifier for the job post
   */
  id?: string;
  /**
   * Tenant ID this post belongs to
   */
  tenantId: string;
  /**
   * Whether post is linked to a job order or standalone
   */
  mode?: 'linked' | 'evergreen';
  /**
   * Linked job order ID (required for linked mode)
   */
  jobOrderId?: string | null;
  /**
   * Job title
   */
  title: string;
  /**
   * Job description
   */
  description: string;
  /**
   * Job location
   */
  location: string;
  /**
   * Pay rate amount
   */
  payRate: number;
  /**
   * Pay rate period
   */
  payPeriod: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  /**
   * Bill rate amount
   */
  billRate?: number;
  /**
   * Bill rate period
   */
  billPeriod?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  /**
   * Post visibility level
   */
  visibility: 'public' | 'private' | 'internal';
  /**
   * Post status
   */
  status: 'draft' | 'posted' | 'paused' | 'closed';
  /**
   * Distribution channels
   */
  channels?: ('Companion' | 'PublicURL' | 'QR')[];
  screeningQuestions?: {
    id: string;
    question: string;
    type: 'text' | 'yesno' | 'multiselect' | 'number';
    required: boolean;
    options?: string[];
    minLength?: number;
    maxLength?: number;
    regex?: string;
    [k: string]: unknown;
  }[];
  searchKeywords?: string[];
  metrics?: {
    views?: number;
    applications?: number;
    conversionRate?: number;
    [k: string]: unknown;
  };
  /**
   * Creation timestamp
   */
  createdAt?: number;
  /**
   * Last update timestamp
   */
  updatedAt?: number;
  /**
   * When post was published
   */
  postedAt?: number | null;
  /**
   * Post expiration timestamp
   */
  expiresAt?: number | null;
}
