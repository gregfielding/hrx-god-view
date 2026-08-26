import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getClaudeChat } from './utils/claudeChat';
import {
  createPayrollTicket,
  replyPayrollTicket,
  setPayrollTicketStatus,
  setPayrollTicketLane,
  sendPayrollLinkAction,
  refreshEvereeAction,
  investigatePayrollTicketAction,
  authorizeCorrectionAction,
  resolvePaidCorrectlyAction,
  PAYROLL_SLACK_BOT_TOKEN,
  TicketForbiddenError,
  TicketNotFoundError,
  TicketRateLimitedError,
  type PayrollTicketStatus,
  type PayrollLinkKind,
} from './payroll/payrollTicketsCore';
import { approvePhoneChange, rejectPhoneChange } from './phoneChangeCore';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
} from './messaging/twilioSecrets';

function toTicketHttpsError(e: unknown): HttpsError {
  // ensureBooksAccess / the off-cycle path throw HttpsError directly — keep
  // their codes (permission-denied, invalid-argument) instead of 'internal'.
  if (e instanceof HttpsError) return e;
  if (e instanceof TicketNotFoundError) return new HttpsError('not-found', e.message);
  if (e instanceof TicketForbiddenError) return new HttpsError('permission-denied', e.message);
  if (e instanceof TicketRateLimitedError) return new HttpsError('resource-exhausted', e.message);
  return new HttpsError('internal', e instanceof Error ? e.message : String(e));
}

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
      'C1 Select: the pay week runs Sunday through Saturday, and payday is the following Friday. C1 Events: the pay week runs Monday through Sunday, and payday is Friday. All payments are made by direct deposit. Workers should review Earnings/pay details in-app first, then use Payroll help if a payment looks late or incorrect.',
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
    // 120s: payroll-ticket creation runs the Claude diagnosis inline
    // (Cloud Run cap — this callable hosts the help-desk actions too).
    timeoutSeconds: 120,
    // Twilio secrets for the urgent-ticket SMS alert (payrollTicketsCore).
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, PAYROLL_SLACK_BOT_TOKEN],
    memory: '512MiB', // 256MiB OOM'd on cold start (267MiB) after the 2026-08-21 Claude migration
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request): Promise<any> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    // Payroll help-desk actions (Slice 1, 2026-08-24) share this callable —
    // the project is AT the Cloud Run function cap, so no new functions.
    const action = String((request.data as Record<string, unknown> | undefined)?.action || '').trim();
    if (action === 'payroll_create_ticket') {
      const tenantId = String(request.data?.tenantId || '').trim();
      const text = String(request.data?.text || '').trim();
      if (!tenantId || !text) throw new HttpsError('invalid-argument', 'tenantId and text are required.');
      if (text.length > 2000) throw new HttpsError('invalid-argument', 'Message is too long.');
      try {
        return await createPayrollTicket({ uid: request.auth.uid, tenantId, text, channel: 'app' });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_reply') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const text = String(request.data?.text || '').trim();
      if (!ticketId || !text) throw new HttpsError('invalid-argument', 'ticketId and text are required.');
      if (text.length > 2000) throw new HttpsError('invalid-argument', 'Message is too long.');
      try {
        return await replyPayrollTicket({ actorUid: request.auth.uid, ticketId, text });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_set_lane') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const lane = String(request.data?.lane || '').trim() as 'fix_it' | 'money';
      if (!ticketId || !lane) throw new HttpsError('invalid-argument', 'ticketId and lane are required.');
      try {
        return await setPayrollTicketLane({ actorUid: request.auth.uid, ticketId, lane });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_action_send_link') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const kind = String(request.data?.kind || '').trim();
      if (!ticketId || !['onboarding', 'bank_update', 'portal'].includes(kind)) {
        throw new HttpsError('invalid-argument', 'ticketId and a valid kind are required.');
      }
      try {
        return await sendPayrollLinkAction({
          actorUid: request.auth.uid,
          ticketId,
          kind: kind as PayrollLinkKind,
        });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_investigate') {
      const ticketId = String(request.data?.ticketId || '').trim();
      if (!ticketId) throw new HttpsError('invalid-argument', 'ticketId is required.');
      try {
        return await investigatePayrollTicketAction({ actorUid: request.auth.uid, ticketId });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_authorize_correction') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const amount = Number(request.data?.amount) || 0;
      const workDate = String(request.data?.workDate || '').trim();
      const entityId = String(request.data?.entityId || '').trim();
      if (!ticketId || amount <= 0 || !workDate || !entityId) {
        throw new HttpsError('invalid-argument', 'ticketId, amount, workDate, and entityId are required.');
      }
      try {
        return await authorizeCorrectionAction({
          actorUid: request.auth.uid,
          actorToken: request.auth.token as never,
          ticketId,
          amount,
          workDate,
          hours: Number(request.data?.hours) || 0,
          hourlyRate: Number(request.data?.hourlyRate) || 0,
          entityId,
          notes: String(request.data?.notes || '').trim() || undefined,
          overrideDuplicateWarning: request.data?.overrideDuplicateWarning === true,
        });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_resolve_paid_correctly') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const text = String(request.data?.text || '').trim();
      if (!ticketId || !text) throw new HttpsError('invalid-argument', 'ticketId and text are required.');
      if (text.length > 2000) throw new HttpsError('invalid-argument', 'Message is too long.');
      try {
        return await resolvePaidCorrectlyAction({ actorUid: request.auth.uid, ticketId, text });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_action_refresh_everee') {
      const ticketId = String(request.data?.ticketId || '').trim();
      if (!ticketId) throw new HttpsError('invalid-argument', 'ticketId is required.');
      try {
        return await refreshEvereeAction({ actorUid: request.auth.uid, ticketId });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }
    if (action === 'payroll_set_status') {
      const ticketId = String(request.data?.ticketId || '').trim();
      const status = String(request.data?.status || '').trim() as PayrollTicketStatus;
      const note = String(request.data?.note || '').trim() || undefined;
      if (!ticketId || !status) throw new HttpsError('invalid-argument', 'ticketId and status are required.');
      try {
        return await setPayrollTicketStatus({ actorUid: request.auth.uid, ticketId, status, note });
      } catch (e) {
        throw toTicketHttpsError(e);
      }
    }

    // Phone-change recovery approvals (Slice 3, 2026-08-25) — staff-only,
    // reviewed at /users/phone-changes; same callable for the same cap reason.
    if (action === 'phone_change_approve') {
      const requestId = String(request.data?.requestId || '').trim();
      const uid = String(request.data?.uid || '').trim();
      if (!requestId || !uid) throw new HttpsError('invalid-argument', 'requestId and uid are required.');
      return approvePhoneChange({ actorUid: request.auth.uid, requestId, uid });
    }
    if (action === 'phone_change_reject') {
      const requestId = String(request.data?.requestId || '').trim();
      const note = String(request.data?.note || '').trim() || undefined;
      if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.');
      return rejectPhoneChange({ actorUid: request.auth.uid, requestId, note });
    }

    const { question, tenantId } = (request.data || {}) as SupportRequest;
    const trimmedQuestion = String(question || '').trim();
    if (!trimmedQuestion) {
      throw new HttpsError('invalid-argument', 'Question is required.');
    }
    if (trimmedQuestion.length > 1000) {
      throw new HttpsError('invalid-argument', 'Question is too long.');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
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

    // Claude-backed since 2026-08-21 (was OpenAI Responses API) — utils/claudeChat.
    const openai = getClaudeChat();

    try {
      const completion = await openai.chat.completions.create({
        model: 'claude-opus-5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 400,
      });

      const text = (completion.choices?.[0]?.message?.content || '').trim();
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

