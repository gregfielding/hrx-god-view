import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const EmailThreadSummary = z.object({
  title: z.string(),
  keyDecisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
  sentiment: z.enum(['positive','neutral','negative']).default('neutral')
});

export type EmailThreadSummaryT = z.infer<typeof EmailThreadSummary>;

export const EmailThreadSummaryJson = zodToJsonSchema(EmailThreadSummary, { name: 'EmailThreadSummary', $refStrategy: 'none' }) as Record<string, any>;


