import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendMessage, type SendMessageResult } from './routingOrchestrator';
import { MessageTemplate, renderTemplate, renderStringWithVariables } from './templateEngine';
import { resolveTemplateVariables, TemplateVariableContext } from '../utils/templateVariableResolver';
import {
  getActiveRulesByTrigger,
  MessageAutomationRule,
  toChannelList,
} from './messageAutomationRules';
import { SystemTriggerKey } from './triggerRegistry';

const db = admin.firestore();

export interface DispatchSystemMessageArgs {
  tenantId: string;
  triggerKey: SystemTriggerKey;
  userId: string;
  context?: Record<string, any>;
  metadata?: Record<string, any>;
  source?: string;
  sourceId?: string;
}

export interface DispatchSystemMessageResult {
  handled: boolean;
  sent: boolean;
  ruleIds: string[];
  errors: string[];
  /** Set when a rule successfully invoked `sendMessage` (for callers that need message log id / delivery details). */
  sendMessageResult?: SendMessageResult;
}

function isPassiveModeEnabled(): boolean {
  return process.env.MESSAGE_AUTOMATION_PASSIVE_MODE === 'true';
}

function normalizePreferredLanguage(value: unknown): 'en' | 'es' {
  return String(value || '').toLowerCase() === 'es' ? 'es' : 'en';
}

function normalizeRuleLanguage(rule: MessageAutomationRule): 'en' | 'es' {
  return String(rule.language || '').toLowerCase() === 'es' ? 'es' : 'en';
}

function orderRulesByLanguagePreference(
  rules: MessageAutomationRule[],
  preferredLanguage: 'en' | 'es'
): MessageAutomationRule[] {
  if (preferredLanguage === 'es') {
    const spanishFirst = rules.filter((rule) => normalizeRuleLanguage(rule) === 'es');
    const englishFallback = rules.filter((rule) => normalizeRuleLanguage(rule) === 'en');
    return [...spanishFirst, ...englishFallback];
  }
  const englishFirst = rules.filter((rule) => normalizeRuleLanguage(rule) === 'en');
  const spanishFallback = rules.filter((rule) => normalizeRuleLanguage(rule) === 'es');
  return [...englishFirst, ...spanishFallback];
}

async function getTemplateById(tenantId: string, templateId: string): Promise<MessageTemplate | null> {
  const doc = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('messageTemplates')
    .doc(templateId)
    .get();

  if (!doc.exists) {
    return null;
  }
  return {
    id: doc.id,
    ...doc.data(),
  } as MessageTemplate;
}

/**
 * `resolveTemplateVariables` returns a fixed shape and drops payroll/on-call fields that callers pass only on
 * `args.context`. Merge those into the render map so automation templates get {{entityName}}, URLs, etc.
 */
const AUTOMATION_CONTEXT_TEMPLATE_KEYS = [
  'entityName',
  'hiringEntityId',
  'hiringEntityName',
  'payrollOnboardingUrl',
  'payrollSignupUrl',
  'payrollPortalLoginUrl',
  'payrollProvider',
  'message',
  'jobTitle',
  'correlationKey',
  'entityKey',
  'onCallEmployment',
  'contextLabel',
] as const;

function mergeDispatchContextForTemplateRender(
  resolved: Record<string, unknown>,
  ctx: Record<string, any>
): Record<string, any> {
  const merged: Record<string, any> = { ...resolved };
  for (const k of AUTOMATION_CONTEXT_TEMPLATE_KEYS) {
    const v = ctx[k];
    if (v === undefined || v === null) continue;
    merged[k] = typeof v === 'string' ? v : String(v);
  }
  const entityNamed = String(merged.entityName || merged.hiringEntityName || '').trim();
  if (entityNamed && !String(merged.companyName || '').trim()) {
    merged.companyName = entityNamed;
  }
  const payrollUrl = String(merged.payrollOnboardingUrl || merged.payrollSignupUrl || '').trim();
  if (payrollUrl) {
    if (merged.link == null || merged.link === '') merged.link = payrollUrl;
    if (merged.url == null || merged.url === '') merged.url = payrollUrl;
  }
  return merged;
}

async function buildVariables(
  args: DispatchSystemMessageArgs,
  rule: MessageAutomationRule,
  template: MessageTemplate,
  userData: Record<string, unknown>
): Promise<Record<string, any>> {
  const ctx = (args.context || {}) as Record<string, any>;
  const variableContext: TemplateVariableContext = {
    userId: args.userId,
    userData,
    tenantId: args.tenantId,
    applicationId: ctx.applicationId,
    applicationData: ctx.applicationData,
    assignmentId: ctx.assignmentId,
    assignmentData: ctx.assignmentData,
    jobOrderId: ctx.jobOrderId,
    jobPostId: ctx.jobPostId,
    status: ctx.status,
    ...ctx,
  };

  const resolved = await resolveTemplateVariables(variableContext);
  const forRender = mergeDispatchContextForTemplateRender(resolved, ctx);
  const rendered = await renderTemplate(template, forRender, args.tenantId);
  const rawSubject = template.subject || template.name || rule.name || '';
  const _subject = rawSubject ? renderStringWithVariables(rawSubject, forRender) : '';
  return {
    ...resolved,
    ...ctx,
    _directMessage: true,
    _message: rendered,
    _subject,
  };
}

export async function dispatchSystemMessage(args: DispatchSystemMessageArgs): Promise<DispatchSystemMessageResult> {
  const errors: string[] = [];
  const rules = await getActiveRulesByTrigger(args.tenantId, args.triggerKey);

  if (!rules.length) {
    return {
      handled: false,
      sent: false,
      ruleIds: [],
      errors: [],
    };
  }

  const passiveMode = isPassiveModeEnabled();
  let sent = false;
  let sendMessageResult: SendMessageResult | undefined;
  const attemptedRuleIds: string[] = [];
  const userDoc = await db.doc(`users/${args.userId}`).get();
  const userData = (userDoc.exists ? userDoc.data() : {}) || {};
  const preferredLanguage = normalizePreferredLanguage((userData as any).preferredLanguage);
  const candidateRules = orderRulesByLanguagePreference(rules, preferredLanguage);

  logger.info('dispatchSystemMessage candidate rule selection', {
    tenantId: args.tenantId,
    triggerKey: args.triggerKey,
    userId: args.userId,
    preferredLanguage,
    candidateRuleIds: candidateRules.map((rule) => rule.ruleId),
    candidateRuleLanguages: candidateRules.map((rule) => normalizeRuleLanguage(rule)),
  });

  for (const rule of candidateRules) {
    try {
      attemptedRuleIds.push(rule.ruleId);
      const template = await getTemplateById(args.tenantId, rule.templateId);
      if (!template) {
        errors.push(`Template ${rule.templateId} not found`);
        continue;
      }

      const overrideChannels = toChannelList(rule.deliveryChannels);
      if (!overrideChannels.length) {
        errors.push(`Rule ${rule.ruleId} has no delivery channels enabled`);
        continue;
      }

      const variables = await buildVariables(args, rule, template, userData as Record<string, unknown>);
      const messageTypeId = template.messageTypeId || 'direct_message';

      if (passiveMode) {
        logger.info('MESSAGE_AUTOMATION_PASSIVE_MODE enabled, skipping send', {
          tenantId: args.tenantId,
          triggerKey: args.triggerKey,
          ruleId: rule.ruleId,
          messageTypeId,
          channels: overrideChannels,
        });
        // In passive mode, only evaluate the first candidate for single-message semantics.
        break;
      }

      const result = await sendMessage({
        tenantId: args.tenantId,
        userId: args.userId,
        messageTypeId,
        variables,
        metadata: {
          ...(args.metadata || {}),
          triggerKey: args.triggerKey,
          ruleId: rule.ruleId,
          templateId: template.id,
        },
        source: args.source || 'system',
        sourceId: args.sourceId,
        overrideChannels,
      });

      sent = sent || result.success;
      if (!result.success) {
        // Log per-channel results so we can see why SMS/email/push failed (e.g. consent, Twilio, SendGrid)
        const deliverySummary = (result.deliveryResults || []).map(
          (r: { channel: string; success: boolean; error?: string }) =>
            `${r.channel}: ${r.success ? 'ok' : (r.error || 'failed')}`
        ).join('; ');
        const skippedSummary = (result.routingDecision?.skippedChannels || []).map(
          (s: { channel: string; reason: string }) => `${s.channel}=${s.reason}`
        ).join('; ');
        logger.warn('Rule send failed – delivery and skip details', {
          tenantId: args.tenantId,
          triggerKey: args.triggerKey,
          ruleId: rule.ruleId,
          userId: args.userId,
          deliveryResults: deliverySummary || '(none)',
          skippedChannels: skippedSummary || '(none)',
        });
        const firstFailure = (result.deliveryResults || []).find((r: { success: boolean }) => !r.success);
        const errDetail = firstFailure?.error
          ? ` (${firstFailure.channel}: ${firstFailure.error})`
          : (result.routingDecision?.skippedChannels?.length
              ? ` (skipped: ${result.routingDecision.skippedChannels.map((s: { channel: string; reason: string }) => `${s.channel}=${s.reason}`).join('; ')})`
              : '');
        errors.push(`Rule ${rule.ruleId} send failed${errDetail}`);
        continue;
      }
      sendMessageResult = result;
      // Send only one message per trigger event.
      break;
    } catch (error: any) {
      logger.error('dispatchSystemMessage failed for rule', {
        tenantId: args.tenantId,
        triggerKey: args.triggerKey,
        ruleId: rule.ruleId,
        error: error?.message || String(error),
      });
      errors.push(`Rule ${rule.ruleId}: ${error?.message || 'unknown error'}`);
    }
  }

  return {
    handled: true,
    sent,
    ruleIds: attemptedRuleIds,
    errors,
    sendMessageResult,
  };
}
