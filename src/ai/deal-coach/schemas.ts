import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const DEAL_COACH_SCHEMA_VERSION = 'deal-coach.v1';

// ---------- Common ----------
export const ActionType = z.enum([
  'draftEmail',
  'draftCall',
  'createTask',
  'askQuestion'
]);

// Discriminated action payloads
const DraftEmail = z.object({
  type: z.literal('draftEmail'),
  toContactId: z.string().min(1, 'contact required').optional(),
  subjectHint: z.string().max(120).optional(),
  goal: z.string().max(200)
});

const DraftCall = z.object({
  type: z.literal('draftCall'),
  scriptGoal: z.string().max(200),
  objectionsFocus: z.array(z.string().max(120)).default([])
});

const CreateTask = z.object({
  type: z.literal('createTask'),
  title: z.string().max(120),
  dueInDays: z.number().int().min(0).max(60),
  assigneeId: z.string().optional()
});

const AskQuestion = z.object({
  type: z.literal('askQuestion'),
  target: z.enum(['buyer', 'ops', 'finance', 'legal', 'unknown']).default('buyer'),
  question: z.string().max(240)
});

export const CoachAction = z.discriminatedUnion('type', [
  DraftEmail,
  DraftCall,
  CreateTask,
  AskQuestion
]);

// ---------- Analyze ----------
export const AnalyzeSuggestion = z.object({
  label: z.string().max(80),
  action: CoachAction
});

export const AnalyzeResponse = z.object({
  summary: z.string().min(1).max(400),
  suggestions: z.array(AnalyzeSuggestion).max(3)
});

export type AnalyzeResponseT = z.infer<typeof AnalyzeResponse>;

// ---------- Chat ----------
export const ChatResponse = z.object({
  text: z.string().min(1),
  actions: z.array(CoachAction).max(3).optional()
});

export type ChatResponseT = z.infer<typeof ChatResponse>;

// ---------- JSON Schemas (strict) ----------
export const AnalyzeResponseJSON = zodToJsonSchema(AnalyzeResponse, {
  $refStrategy: 'none',
  definitionPath: 'definitions'
});

export const ChatResponseJSON = zodToJsonSchema(ChatResponse, {
  $refStrategy: 'none',
  definitionPath: 'definitions'
});


