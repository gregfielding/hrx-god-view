import { z } from 'zod';

export const RecommendedContactSchema = z.object({
  role: z.string().min(1),
  titleGuess: z.string().min(1),
});

export const InferredOrgSchema = z.object({
  ops: z.string().optional(),
  hr: z.string().optional(),
  warehouse: z.string().optional(),
});

export const GeneratedScriptsSchema = z.object({
  coldEmail: z.string().optional().default(''),
  coldCallOpening: z.string().optional().default(''),
  voicemail: z.string().optional().default(''),
});

export const CompanyEnrichmentSchema = z.object({
  // Make summary tolerant to sparse outputs
  businessSummary: z.string().default(''),
  hiringTrends: z.array(z.string()).default([]),
  topJobTitles: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
  likelyPainPoints: z.array(z.string()).default([]),
  suggestedApproach: z.string().default(''),
  inferredOrgStructure: InferredOrgSchema.default({}),
  competitorCompanies: z.array(z.string()).default([]),
  recommendedContacts: z.array(RecommendedContactSchema).default([]),
  generatedScripts: GeneratedScriptsSchema.default({}),
  suggestedTags: z.array(z.string()).default([]),
});

export type CompanyEnrichment = z.infer<typeof CompanyEnrichmentSchema>;

export const CompanyEnrichmentVersionMetaSchema = z.object({
  model: z.string().optional(),
  tokenUsage: z.object({ prompt: z.number().optional(), completion: z.number().optional(), total: z.number().optional() }).partial().optional(),
  websiteHash: z.string().optional(),
  linkedinHash: z.string().optional(),
  jobHash: z.string().optional(),
  qaNotes: z.string().optional(),
  signalStrength: z.enum(['high','medium','low','none']).optional(),
});


