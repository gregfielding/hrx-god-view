/**
 * Cross-System Mentions Types
 * 
 * Types for @user, #contact, &company, %deal mentions across the system.
 * This extends the existing user-only mention system to support CRM entities.
 */

export type MentionType = 'user' | 'contact' | 'company' | 'deal' | 'job' | 'candidate' | 'location' | 'task' | 'worker';

export type MentionPrefix = '@' | '#' | '&' | '%' | '!' | '^' | '*' | '~';

/**
 * Prefix to mention type mapping
 * @ = internal team (securityLevel 5-7)
 * & = workers (securityLevel 1-4)
 */
export const MENTION_PREFIX_MAP: Record<MentionPrefix, MentionType> = {
  '@': 'user',      // Internal team (securityLevel 5-7)
  '#': 'contact',
  '&': 'worker',    // Workers (securityLevel 1-4)
  '%': 'deal',
  '!': 'job',
  '^': 'candidate',
  '*': 'location',
  '~': 'task',
};

/**
 * Mention type to prefix mapping
 */
export const MENTION_TYPE_PREFIX_MAP: Record<MentionType, MentionPrefix> = {
  user: '@',
  contact: '#',
  company: '&',      // Keep for backward compatibility, but & now maps to worker
  deal: '%',
  job: '!',
  candidate: '^',
  location: '*',
  task: '~',
  worker: '&',
};

export interface BaseMention {
  type: MentionType;
  id: string;           // Firestore doc ID
  label: string;        // Display label rendered in the UI
  slug?: string;        // Optional short slug (e.g., "donna", "arcil")
}

export interface UserMention extends BaseMention {
  type: 'user';
  userId: string;       // Alias for id
}

export interface ContactMention extends BaseMention {
  type: 'contact';
  contactId: string;    // Alias for id
}

export interface CompanyMention extends BaseMention {
  type: 'company';
  companyId: string;
}

export interface DealMention extends BaseMention {
  type: 'deal';
  dealId: string;
}

export interface JobMention extends BaseMention {
  type: 'job';
  jobId: string;
}

export interface CandidateMention extends BaseMention {
  type: 'candidate';
  candidateId: string;
}

export interface LocationMention extends BaseMention {
  type: 'location';
  locationId: string;
}

export interface TaskMention extends BaseMention {
  type: 'task';
  taskId: string;
}

export interface WorkerMention extends BaseMention {
  type: 'worker';
  workerId: string;  // Alias for id (user ID)
}

export type Mention = UserMention | ContactMention | CompanyMention | DealMention | JobMention | CandidateMention | LocationMention | TaskMention | WorkerMention;

/**
 * Mentionable entity for autocomplete/search
 */
export interface MentionableEntity {
  id: string;
  type: MentionType;
  label: string;
  slug?: string;
  avatarUrl?: string;   // For users and contacts
  subtitle?: string;    // Additional context (e.g., company name for contact)
}

