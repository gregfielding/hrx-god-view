import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import OpenAI from 'openai';
import { getOpenAIKey } from './utils/secrets';

type SupportTopic =
  | 'shift_cancellation'
  | 'pay_schedule_basics'
  | 'dress_code_what_to_bring'
  | 'certification_updates'
  | 'recruiter_contact_escalation'
  | 'late_to_shift'
  | 'assignment_details_location';

interface SupportRequest {
  question?: string;
  tenantId?: string;
}

interface SupportResponse {
  answer: string;
  confidence: number;
  suggestedActions: string[];
  followUps: string[];
  escalate: boolean;
  sourceTopics: SupportTopic[];
}

const SUPPORT_KNOWLEDGE_V1: Record<SupportTopic, { summary: string; actions: string[] }> = {
  shift_cancellation: {
    summary:
      'Workers should notify staffing as soon as possible if they cannot work a confirmed shift. Last-minute cancellations can affect future assignment eligibility. Use inbox to contact recruiter quickly.',
    actions: ['Open inbox', 'Contact recruiter', 'View assignments'],
  },
  pay_schedule_basics: {
    summary:
      'Pay timing can depend on assignment, payroll cycle, and processing cutoff. Workers should review assignment/pay details in-app first, then contact recruiter/payroll if something seems incorrect.',
    actions: ['View assignments', 'Open inbox', 'Contact recruiter'],
  },
  dress_code_what_to_bring: {
    summary:
      'Dress code, PPE, and what to bring should be checked in assignment details. If unclear, workers should ask recruiter before shift start.',
    actions: ['View assignments', 'Open inbox', 'Contact recruiter'],
  },
  certification_updates: {
    summary:
      'Workers can update certifications/documents in Profile under certifications/documents. Recruiter should be contacted if a role requires verification or urgent review.',
    actions: ['Open profile', 'Open inbox', 'Contact recruiter'],
  },
  recruiter_contact_escalation: {
    summary:
      'For account-specific, urgent, or unclear issues, escalate to recruiter through inbox. Avoid giving policy guarantees not confirmed for that worker/assignment.',
    actions: ['Open inbox', 'Contact recruiter'],
  },
  late_to_shift: {
    summary:
      'If running late, workers should message recruiter immediately with updated ETA and still review assignment details for check-in instructions.',
    actions: ['Open inbox', 'View assignments', 'Contact recruiter'],
  },
  assignment_details_location: {
    summary:
      'Assignment details page is source of truth for shift time, location, directions, and instructions.',
    actions: ['View assignments', 'Open inbox'],
  },
};

const TOPIC_KEYWORDS: Array<{ topic: SupportTopic; patterns: RegExp[] }> = [
  {
    topic: 'shift_cancellation',
    patterns: [/cancel/i, /cancellation/i, /can'?t make/i, /cannot make/i, /drop shift/i],
  },
  {
    topic: 'pay_schedule_basics',
    patterns: [/pay/i, /paid/i, /paycheck/i, /direct deposit/i, /payroll/i],
  },
  {
    topic: 'dress_code_what_to_bring',
    patterns: [/dress/i, /uniform/i, /wear/i, /bring/i, /ppe/i, /shoes/i],
  },
  {
    topic: 'certification_updates',
    patterns: [/cert/i, /license/i, /credential/i, /food handler/i, /forklift/i],
  },
  {
    topic: 'recruiter_contact_escalation',
    patterns: [/recruiter/i, /support/i, /help/i, /escalat/i, /agent/i],
  },
  {
    topic: 'late_to_shift',
    patterns: [/late/i, /running late/i, /eta/i, /traffic/i],
  },
  {
    topic: 'assignment_details_location',
    patterns: [/assignment/i, /where/i, /location/i, /address/i, /details/i, /directions/i],
  },
];

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function detectTopics(question: string): SupportTopic[] {
  const topics: SupportTopic[] = [];
  for (const entry of TOPIC_KEYWORDS) {
    if (entry.patterns.some((p) => p.test(question))) {
      topics.push(entry.topic);
    }
  }
  return Array.from(new Set(topics));
}

function looksAccountSpecific(question: string): boolean {
  const accountSpecificPatterns = [
    /my account/i,
    /my paycheck/i,
    /why wasn't i paid/i,
    /my assignment id/i,
    /password/i,
    /login/i,
    /ssn/i,
    /routing number/i,
    /bank account/i,
    /specific case/i,
  ];
  return accountSpecificPatterns.some((p) => p.test(question));
}

function buildKnowledgeSnippet(topics: SupportTopic[]): string {
  const selected = topics.length > 0 ? topics : (Object.keys(SUPPORT_KNOWLEDGE_V1) as SupportTopic[]);
  return selected
    .map((topic) => {
      const entry = SUPPORT_KNOWLEDGE_V1[topic];
      return `- ${topic}: ${entry.summary} | Suggested actions: ${entry.actions.join(', ')}`;
    })
    .join('\n');
}

function fallbackEscalation(topics: SupportTopic[]): SupportResponse {
  const suggestedActions = ['Contact recruiter', 'Open inbox', 'View assignments'];
  const followUps = [
    'Do you want to open inbox now?',
    'Do you want to review assignment details first?',
  ];
  return {
    answer:
      'I am not fully confident on this from approved support guidance alone. Please contact your recruiter so they can help with your specific situation.',
    confidence: 0.2,
    suggestedActions,
    followUps,
    escalate: true,
    sourceTopics: topics,
  };
}

export const workerSupportAssistant = onCall(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 45,
    memory: '256MiB',
  },
  async (request): Promise<SupportResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { question, tenantId } = (request.data || {}) as SupportRequest;
    const trimmedQuestion = String(question || '').trim();
    if (!trimmedQuestion) {
      throw new HttpsError('invalid-argument', 'Question is required.');
    }
    if (trimmedQuestion.length > 1000) {
      throw new HttpsError('invalid-argument', 'Question is too long.');
    }

    const apiKey = await getOpenAIKey(tenantId);
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Support assistant is not configured.');
    }

    const topics = detectTopics(trimmedQuestion);
    const accountSpecific = looksAccountSpecific(trimmedQuestion);
    const knowledgeSnippet = buildKnowledgeSnippet(topics);

    const systemPrompt = [
      'You are an HRX worker support assistant.',
      'Answer ONLY from provided approved support knowledge.',
      'Do not guess, do not invent policy, and do not make legal/payroll guarantees.',
      'If unsure OR the issue is account-specific, set escalate=true.',
      'Return strict JSON only with shape:',
      '{"answer":string,"confidence":number,"suggestedActions":string[],"followUps":string[],"escalate":boolean}',
      'Answer should be short and practical (2-5 sentences).',
    ].join('\n');

    const userPrompt = [
      `Worker question: ${trimmedQuestion}`,
      `Account specific detected: ${accountSpecific ? 'yes' : 'no'}`,
      'Approved support knowledge:',
      knowledgeSnippet,
      'Allowed suggestedActions values:',
      '["Contact recruiter","Open inbox","View assignments","Open profile"]',
    ].join('\n\n');

    const openai = new OpenAI({ apiKey });

    try {
      const completion = await openai.responses.create({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_output_tokens: 400,
      });

      const text = (completion.output_text || '').trim();
      if (!text) {
        logger.warn('workerSupportAssistant.empty_response', {
          uid: request.auth.uid,
          tenantId: tenantId || null,
          questionLength: trimmedQuestion.length,
          topics,
        });
        return fallbackEscalation(topics);
      }

      let parsed: Partial<SupportResponse> = {};
      try {
        parsed = JSON.parse(text) as Partial<SupportResponse>;
      } catch {
        logger.warn('workerSupportAssistant.invalid_json', {
          uid: request.auth.uid,
          tenantId: tenantId || null,
          questionLength: trimmedQuestion.length,
          topics,
        });
        return fallbackEscalation(topics);
      }

      const response: SupportResponse = {
        answer: String(parsed.answer || '').trim() || fallbackEscalation(topics).answer,
        confidence: clampConfidence(parsed.confidence),
        suggestedActions: toStringArray(parsed.suggestedActions).slice(0, 3),
        followUps: toStringArray(parsed.followUps).slice(0, 3),
        escalate: Boolean(parsed.escalate),
        sourceTopics: topics,
      };

      // Deterministic escalation hardening for account-specific or low-confidence responses.
      if (accountSpecific || response.confidence < 0.45) {
        response.escalate = true;
      }
      if (response.suggestedActions.length === 0) {
        response.suggestedActions = ['Contact recruiter', 'Open inbox'];
      }

      logger.info('workerSupportAssistant.completed', {
        uid: request.auth.uid,
        tenantId: tenantId || null,
        questionLength: trimmedQuestion.length,
        topicCount: topics.length,
        topics,
        accountSpecific,
        confidence: response.confidence,
        escalate: response.escalate,
        suggestedActionCount: response.suggestedActions.length,
        followUpCount: response.followUps.length,
        model: 'gpt-5-mini',
      });

      return response;
    } catch (error: unknown) {
      logger.error('workerSupportAssistant.error', {
        uid: request.auth.uid,
        tenantId: tenantId || null,
        questionLength: trimmedQuestion.length,
        topics,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackEscalation(topics);
    }
  },
);

