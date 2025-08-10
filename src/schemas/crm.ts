import { z } from 'zod';

// Firestore Timestamp placeholder (runtime objects), kept permissive for browser SDK
export const TimestampLike = z.any();

// Shared
export const Id = z.string().min(1);
export const OptionalTimestamp = z.union([TimestampLike, z.string()]).optional();

// Company
export const CompanySchema = z.object({
  id: Id.optional(),
  name: z.string().optional(),
  companyName: z.string().optional(),
  status: z.enum(['lead', 'qualified', 'active', 'inactive', 'lost']).optional(),
  industry: z.string().optional(),
  tier: z.enum(['A', 'B', 'C']).optional(),
  tags: z.array(z.string()).default([]),
  accountOwner: z.string().optional(),
  salesOwnerId: z.string().optional(),
  createdAt: OptionalTimestamp,
  updatedAt: OptionalTimestamp,
});
export type Company = z.infer<typeof CompanySchema>;

// Contact
export const ContactSchema = z.object({
  id: Id.optional(),
  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  companyId: z.string().optional(),
  role: z.enum(['decision_maker','influencer','finance','operations','hr','other']).optional(),
  status: z.enum(['active','inactive']).optional(),
  tags: z.array(z.string()).default([]),
  createdAt: OptionalTimestamp,
  updatedAt: OptionalTimestamp,
});
export type Contact = z.infer<typeof ContactSchema>;

// Deal
export const DealSchema = z.object({
  id: Id.optional(),
  name: z.string().min(1),
  companyId: z.string().optional(),
  contactIds: z.array(z.string()).default([]),
  stage: z.string().min(1),
  estimatedRevenue: z.number().optional(),
  probability: z.number().min(0).max(1).optional(),
  closeDate: z.union([z.string(), TimestampLike]).optional(),
  owner: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: OptionalTimestamp,
  updatedAt: OptionalTimestamp,
});
export type Deal = z.infer<typeof DealSchema>;

// Task
export const TaskAssociations = z.object({
  deals: z.array(z.string()).optional(),
  companies: z.array(z.string()).optional(),
  contacts: z.array(z.string()).optional(),
  salespeople: z.array(z.string()).optional(),
}).partial();

export const TaskSchema = z.object({
  id: Id.optional(),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z.string().min(1),
  priority: z.enum(['urgent','high','medium','low','Low','Medium','High']).transform(v => v.toString().toLowerCase() as 'urgent'|'high'|'medium'|'low').optional().default('medium'),
  status: z.string().min(1),
  classification: z.enum(['todo','appointment']).optional().default('todo'),
  scheduledDate: z.union([z.string(), TimestampLike]).optional(),
  dueDate: z.union([z.string(), TimestampLike]).optional(),
  startTime: z.union([z.string(), TimestampLike]).optional().nullable(),
  duration: z.number().optional().nullable(),
  assignedTo: z.string().optional(),
  assignedToName: z.string().optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  associations: TaskAssociations.optional().default({}),
  aiSuggested: z.boolean().optional(),
  aiPrompt: z.string().optional(),
  createdAt: OptionalTimestamp,
  updatedAt: OptionalTimestamp,
});
export type Task = z.infer<typeof TaskSchema>;

// Helper to strip undefined before writes
export function cleanForWrite<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v as unknown;
  }
  return out as T;
}


