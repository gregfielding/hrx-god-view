import { z } from 'zod';

// Base schema that all recruiter entities must extend
export const BaseSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  createdBy: z.string().min(1, 'Created by is required'),
  updatedBy: z.string().min(1, 'Updated by is required'),
  searchKeywords: z.array(z.string()).default([]),
  status: z.string().optional(),
});

// Event schema for the event bus
export const EventSchema = BaseSchema.extend({
  type: z.string().min(1, 'Event type is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.string().min(1, 'Entity ID is required'),
  payload: z.record(z.any()),
  source: z.string().min(1, 'Event source is required'),
  dedupeKey: z.string().min(1, 'Deduplication key is required'),
  processed: z.boolean().default(false),
  processedAt: z.number().int().positive().optional(),
  error: z.string().optional(),
  retryCount: z.number().int().min(0).default(0),
});

// Handoff guardrails schema
export const HandoffGuardrailsSchema = z.object({
  msaAccepted: z.boolean(),
  creditApproved: z.boolean(),
  billingProfileComplete: z.boolean(),
  primaryContactSet: z.boolean(),
  worksiteCaptured: z.boolean(),
});

// Supporting schemas
export const ShiftSchema = z.object({
  label: z.string().min(1, 'Shift label is required'),
  start: z.string().min(1, 'Start time is required'),
  end: z.string().min(1, 'End time is required'),
  days: z.array(z.number().int().min(0).max(6)), // 0-6 (Sunday-Saturday)
});

export const OTRulesSchema = z.object({
  enabled: z.boolean(),
  rate: z.number().positive(),
  threshold: z.number().int().positive(), // hours per week
});

export const BackgroundCheckSchema = z.object({
  required: z.boolean(),
  package: z.string().optional(),
});

export const DrugTestSchema = z.object({
  required: z.boolean(),
  panel: z.string().optional(),
});

export const JobOrderMetricsSchema = z.object({
  submittals: z.number().int().min(0).default(0),
  interviews: z.number().int().min(0).default(0),
  offers: z.number().int().min(0).default(0),
  placements: z.number().int().min(0).default(0),
  timeToFirstSubmittalHrs: z.number().int().positive().optional(),
  timeToFillDays: z.number().int().positive().optional(),
  jobAgingDays: z.number().int().positive().optional(),
});

// Job Order Status enum
export const JobOrderStatusSchema = z.enum([
  'draft',
  'open',
  'interviewing',
  'offer',
  'partially_filled',
  'filled',
  'closed',
  'canceled',
]);

// Priority enum
export const PrioritySchema = z.enum(['low', 'medium', 'high']);

// Client Tier enum
export const ClientTierSchema = z.enum(['bronze', 'silver', 'gold', 'platinum']);

// Channel enums
export const PreferredChannelSchema = z.enum(['SMS', 'email', 'app']);
export const JobsBoardChannelSchema = z.enum(['Companion', 'PublicURL', 'QR']);

// Visibility enum
export const VisibilitySchema = z.enum(['public', 'private', 'internal']);

// Question type enum
export const QuestionTypeSchema = z.enum(['text', 'yesno', 'multiselect', 'number']);

// Application source enum
export const ApplicationSourceSchema = z.enum(['QR', 'URL', 'referral', 'Companion']);

// Application status enum
export const ApplicationStatusSchema = z.enum([
  'new',
  'screened',
  'rejected',
  'advanced',
  'hired',
  'withdrawn',
  'duplicate',
]);

// Candidate status enum
export const CandidateStatusSchema = z.enum([
  'applicant',
  'active_employee',
  'inactive',
  'do_not_hire',
]);

// Compliance status enum
export const ComplianceStatusSchema = z.enum(['pending', 'complete', 'pass', 'fail', 'expired']);

// Interview type enum
export const InterviewTypeSchema = z.enum(['phone', 'video', 'onsite']);

// Interview outcome enum
export const InterviewOutcomeSchema = z.enum(['pending', 'advance', 'reject']);

// Employment type enum
export const EmploymentTypeSchema = z.enum(['temp', 'temp_to_hire', 'direct']);

// Offer state enum
export const OfferStateSchema = z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']);

// Placement status enum
export const PlacementStatusSchema = z.enum(['active', 'completed', 'terminated', 'no_show']);

// Timeclock mode enum
export const TimeclockModeSchema = z.enum(['kiosk', 'mobile_geofence', 'badge']);

// Jobs Board mode enum
export const JobsBoardModeSchema = z.enum(['linked', 'evergreen']);

// Jobs Board status enum
export const JobsBoardStatusSchema = z.enum(['draft', 'posted', 'paused', 'closed']);

// Submittal feedback status enum
export const SubmittalFeedbackStatusSchema = z.enum([
  'review',
  'declined',
  'interview_request',
  'offer',
]);

// Interview recommendation enum
export const InterviewRecommendationSchema = z.enum(['hire', 'maybe', 'no']);

// Reminder type enum
export const ReminderTypeSchema = z.enum(['email', 'sms', 'push']);
