import { z } from 'zod';

export const DEAL_COACH_SCHEMA_VERSION = 'deal-coach.v1';

// ---------- Common ----------
export const CoachAction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('draftEmail'),
    toContactId: z.string().min(1).optional(),
    subjectHint: z.string().max(120).optional(),
    goal: z.string().max(200)
  }),
  z.object({
    type: z.literal('draftCall'),
    scriptGoal: z.string().max(200),
    objectionsFocus: z.array(z.string().max(120)).default([])
  }),
  z.object({
    type: z.literal('createTask'),
    title: z.string().max(120),
    dueInDays: z.number().int().min(0).max(60),
    assigneeId: z.string().optional()
  }),
  z.object({
    type: z.literal('askQuestion'),
    target: z.enum(['buyer', 'ops', 'finance', 'legal', 'unknown']).default('buyer'),
    question: z.string().max(240)
  })
]);

export const AnalyzeSuggestion = z.object({
  label: z.string().max(80),
  action: CoachAction
});

export const AnalyzeResponse = z.object({
  summary: z.string().min(1).max(400),
  suggestions: z.array(AnalyzeSuggestion).max(3)
});

export type AnalyzeResponseT = z.infer<typeof AnalyzeResponse>;

export const ChatResponse = z.object({
  text: z.string().min(1),
  actions: z.array(CoachAction).max(3).optional()
});

export type ChatResponseT = z.infer<typeof ChatResponse>;


