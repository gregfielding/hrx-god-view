/**
 * SMS Trigger Registry
 * 
 * Central registry for all SMS template triggers.
 * Add new triggers here - they automatically appear in the UI!
 */

// Define category type to avoid circular dependency
export type TemplateCategory = 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';

export interface TriggerDefinition {
  id: string;
  label: string;
  category: TemplateCategory;
  description: string;
  requiresStatus?: boolean; // Does this trigger need a status value?
  statusOptions?: string[]; // Predefined status options (optional)
  statusPlaceholder?: string; // Help text for status field
  available: boolean; // Is this trigger currently implemented?
}

export const TRIGGER_REGISTRY: TriggerDefinition[] = [
  // Application Triggers
  {
    id: 'applicationStatusChange',
    label: 'Application Status Changes',
    category: 'application',
    description: 'Sends when an application status changes (e.g., screened, hired)',
    requiresStatus: true,
    statusOptions: ['screened', 'advanced', 'interview', 'offer', 'hired', 'rejected'],
    statusPlaceholder: 'e.g., screened, advanced, hired',
    available: true, // ✅ Already implemented
  },
  {
    id: 'applicationCreated',
    label: 'New Application Received',
    category: 'application',
    description: 'Sends immediately when a new application is created',
    requiresStatus: false,
    available: true, // ✅ Implemented
  },
  
  // Assignment Triggers
  {
    id: 'assignmentCreated',
    label: 'Assignment Created',
    category: 'assignment',
    description: 'Sends when a worker is assigned to a job',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'assignmentStatusChange',
    label: 'Assignment Status Changes',
    category: 'assignment',
    description: 'Sends when assignment status changes (confirmed, cancelled, etc.)',
    requiresStatus: true,
    statusPlaceholder: 'e.g., confirmed, cancelled, completed',
    available: false, // 🚧 Coming soon
  },
  
  // Shift Triggers
  {
    id: 'shiftCreated',
    label: 'New Shift Posted',
    category: 'shift',
    description: 'Sends when a new shift is created',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'shiftUpdated',
    label: 'Shift Updated',
    category: 'shift',
    description: 'Sends when shift details change (time, location, etc.)',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'shiftDeleted',
    label: 'Shift Cancelled',
    category: 'shift',
    description: 'Sends when a shift is deleted/cancelled',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'shiftReminder',
    label: 'Shift Reminder',
    category: 'shift',
    description: 'Sends X hours before shift starts',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  
  // Bulk Triggers
  {
    id: 'manual',
    label: 'Manual Send',
    category: 'bulk',
    description: 'Send manually via bulk messaging UI',
    requiresStatus: false,
    available: true, // ✅ Always available
  },
  
  // Semi-Automated Triggers (Future)
  {
    id: 'documentMissing',
    label: 'Document Missing Reminder',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Send Reminder" button',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'certificationExpiring',
    label: 'Certification Expiring',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Remind About Certification"',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'backgroundCheckReminder',
    label: 'Background Check Reminder',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Send Background Check Reminder"',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'resumeUploadReminder',
    label: 'Resume Upload Reminder',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Remind to Upload Resume"',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'workEligibilityReminder',
    label: 'Work Eligibility Reminder',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Remind About Work Eligibility"',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'interviewScheduled',
    label: 'Interview Scheduled',
    category: 'semiAutomated',
    description: 'Triggered when admin schedules an interview',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  
  // Fully-Automated Triggers (Future)
  {
    id: 'autoDocumentCheck',
    label: 'Auto: Document Missing',
    category: 'fullyAutomated',
    description: 'Automatically checks and sends if document missing for X days',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'autoCertificationExpiring',
    label: 'Auto: Certification Expiring',
    category: 'fullyAutomated',
    description: 'Automatically sends reminder X days before certification expires',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'autoResumeMissing',
    label: 'Auto: Resume Missing',
    category: 'fullyAutomated',
    description: 'Automatically checks if resume is missing after X days from application',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'autoWorkEligibilityCheck',
    label: 'Auto: Work Eligibility Incomplete',
    category: 'fullyAutomated',
    description: 'Automatically sends reminder if work eligibility docs incomplete',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
];

// Helper functions
export function getTriggersForCategory(category: TemplateCategory): TriggerDefinition[] {
  return TRIGGER_REGISTRY.filter(t => t.category === category);
}

export function getAvailableTriggersForCategory(category: TemplateCategory): TriggerDefinition[] {
  return TRIGGER_REGISTRY.filter(t => t.category === category && t.available);
}

export function getTriggerDefinition(triggerId: string): TriggerDefinition | undefined {
  return TRIGGER_REGISTRY.find(t => t.id === triggerId);
}

export function getAllAvailableTriggers(): TriggerDefinition[] {
  return TRIGGER_REGISTRY.filter(t => t.available);
}

