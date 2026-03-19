import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  AutomationRuleStatus,
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  listAutomationRules,
  normalizeDeliveryChannels,
  updateAutomationRule,
} from './messageAutomationRules';
import {
  isSystemTriggerKey,
  SYSTEM_TRIGGER_CATALOG,
  SystemTriggerKey,
} from './triggerRegistry';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { renderTemplate } from './templateEngine';
import { resolveTemplateVariables, TemplateVariableContext } from '../utils/templateVariableResolver';
import { buildWorkerAssignmentResponseUrl, buildWorkerAssignmentUrl } from '../utils/workerUrls';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const VALID_RULE_STATUS: AutomationRuleStatus[] = ['draft', 'active'];

/** Sample values for template variables when testing without real assignment/application context */
const TEST_SAMPLE_VARIABLES: Record<string, string> = {
  assignmentAcceptDeclineUrl: buildWorkerAssignmentResponseUrl({ assignmentId: 'sample-assignment-id' }),
  assignmentUrl: buildWorkerAssignmentUrl('sample-assignment-id'),
  assignmentId: 'sample-assignment-id',
  assignmentStatus: 'proposed',
  assignmentDate: new Date().toLocaleDateString(),
  assignmentTimeRange: '9:00 AM - 5:00 PM',
  jobPostId: 'sample-job-post',
  jobPostTitle: 'Warehouse Associate',
  jobOrderId: 'sample-job-order',
  jobOrderName: 'Sample Job Order',
  jobTitle: 'Warehouse Associate',
  shiftId: 'sample-shift',
  shiftDate: new Date().toLocaleDateString(),
  shiftTimeRange: '9:00 AM - 5:00 PM',
  shiftStartTime: '9:00 AM',
  shiftEndTime: '5:00 PM',
  applicationId: 'sample-application-id',
  locationCity: 'San Francisco',
  locationState: 'CA',
  locationName: 'Main Warehouse',
  locationAddress: '123 Main St',
  locationZipCode: '94102',
  companyName: 'Sample Company',
};

function hasDeliveryChannelEnabled(
  deliveryChannels:
    | {
        sms?: boolean;
        email?: boolean;
        push?: boolean;
      }
    | undefined
): boolean {
  if (!deliveryChannels) {
    return false;
  }
  return Boolean(
    deliveryChannels.sms || deliveryChannels.email || deliveryChannels.push
  );
}

function badRequest(response: any, message: string): void {
  response.status(400).json({
    success: false,
    error: { code: 'INVALID_ARGUMENT', message },
  });
}

export const listAutomationRulesApi = onRequest({ cors: true }, async (request, response) => {
  try {
    if (request.method !== 'GET') {
      response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
      return;
    }
    const tenantId = request.query.tenantId as string | undefined;
    if (!tenantId) {
      badRequest(response, 'tenantId is required');
      return;
    }
    const rules = await listAutomationRules(tenantId);
    response.status(200).json({ success: true, data: rules });
  } catch (error: any) {
    logger.error('listAutomationRulesApi error', error);
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' } });
  }
});

export const createAutomationRuleApi = onRequest({ cors: true }, async (request, response) => {
  try {
    if (request.method !== 'POST') {
      response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
      return;
    }
    const { tenantId, ruleId, name, triggerKey, templateId, deliveryChannels, status, language, priority } = request.body || {};
    if (!tenantId || !ruleId || !name || !triggerKey || !templateId || !status) {
      badRequest(response, 'tenantId, ruleId, name, triggerKey, templateId, and status are required');
      return;
    }
    if (!isSystemTriggerKey(triggerKey)) {
      badRequest(response, `Invalid triggerKey: ${triggerKey}`);
      return;
    }
    if (!VALID_RULE_STATUS.includes(status)) {
      badRequest(response, `Invalid status: ${status}`);
      return;
    }
    const normalizedChannels = normalizeDeliveryChannels(deliveryChannels);
    if (!hasDeliveryChannelEnabled(normalizedChannels)) {
      badRequest(response, 'At least one delivery channel must be enabled');
      return;
    }
    await createAutomationRule(tenantId, {
      ruleId,
      name,
      triggerKey,
      templateId,
      deliveryChannels: normalizedChannels,
      status,
      language,
      priority,
    });
    const rule = await getAutomationRule(tenantId, ruleId);
    response.status(200).json({ success: true, data: rule });
  } catch (error: any) {
    logger.error('createAutomationRuleApi error', error);
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' } });
  }
});

export const updateAutomationRuleApi = onRequest({ cors: true }, async (request, response) => {
  try {
    if (request.method !== 'PATCH' && request.method !== 'PUT') {
      response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH/PUT allowed' } });
      return;
    }
    const tenantId = request.query.tenantId as string | undefined;
    const ruleId = request.query.ruleId as string | undefined;
    if (!tenantId || !ruleId) {
      badRequest(response, 'tenantId and ruleId are required');
      return;
    }
    const updates = { ...(request.body || {}) };
    if (updates.triggerKey && !isSystemTriggerKey(updates.triggerKey)) {
      badRequest(response, `Invalid triggerKey: ${updates.triggerKey}`);
      return;
    }
    if (updates.status && !VALID_RULE_STATUS.includes(updates.status)) {
      badRequest(response, `Invalid status: ${updates.status}`);
      return;
    }
    if (updates.deliveryChannels) {
      updates.deliveryChannels = normalizeDeliveryChannels(updates.deliveryChannels);
      if (!hasDeliveryChannelEnabled(updates.deliveryChannels)) {
        badRequest(response, 'At least one delivery channel must be enabled');
        return;
      }
    }
    await updateAutomationRule(tenantId, ruleId, updates);
    const rule = await getAutomationRule(tenantId, ruleId);
    response.status(200).json({ success: true, data: rule });
  } catch (error: any) {
    logger.error('updateAutomationRuleApi error', error);
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' } });
  }
});

export const deleteAutomationRuleApi = onRequest({ cors: true }, async (request, response) => {
  try {
    if (request.method !== 'DELETE') {
      response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only DELETE allowed' } });
      return;
    }
    const tenantId = request.query.tenantId as string | undefined;
    const ruleId = request.query.ruleId as string | undefined;
    if (!tenantId || !ruleId) {
      badRequest(response, 'tenantId and ruleId are required');
      return;
    }
    await deleteAutomationRule(tenantId, ruleId);
    response.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('deleteAutomationRuleApi error', error);
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' } });
  }
});

export const listTriggerCatalogApi = onRequest({ cors: true }, async (request, response) => {
  if (request.method !== 'GET') {
    response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
    return;
  }
  response.status(200).json({ success: true, data: SYSTEM_TRIGGER_CATALOG });
});

export const testAutomationTemplateApi = onRequest({ cors: true }, async (request, response) => {
  try {
    if (request.method !== 'POST') {
      response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
      return;
    }

    const {
      tenantId,
      userId,
      templateId,
      triggerKey,
      applicationId,
      assignmentId,
      contextOverrides,
      send = false,
    } = request.body || {};

    if (!tenantId || !userId || !templateId || !triggerKey) {
      badRequest(response, 'tenantId, userId, templateId, and triggerKey are required');
      return;
    }
    if (!isSystemTriggerKey(triggerKey)) {
      badRequest(response, `Invalid triggerKey: ${triggerKey}`);
      return;
    }

    const templateDoc = await db.collection('tenants').doc(tenantId).collection('messageTemplates').doc(templateId).get();
    if (!templateDoc.exists) {
      response.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Template ${templateId} not found` },
      });
      return;
    }
    const template = { id: templateDoc.id, ...templateDoc.data() } as any;

    const userDoc = await db.doc(`users/${userId}`).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    let applicationData: Record<string, any> | undefined;
    if (applicationId) {
      const doc = await db.doc(`tenants/${tenantId}/applications/${applicationId}`).get();
      applicationData = doc.exists ? (doc.data() as Record<string, any>) : undefined;
    }

    let assignmentData: Record<string, any> | undefined;
    if (assignmentId) {
      const doc = await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get();
      assignmentData = doc.exists ? (doc.data() as Record<string, any>) : undefined;
    }

    const templateContext: TemplateVariableContext = {
      tenantId,
      userId,
      userData,
      applicationId,
      applicationData,
      assignmentId,
      assignmentData,
      status: (contextOverrides || {}).status || applicationData?.status || assignmentData?.status,
      ...(contextOverrides || {}),
    };

    let resolvedVariables = await resolveTemplateVariables(templateContext);

    // For test sends without real assignment/application context, fill in sample values for
    // any template variables that are still missing (e.g. assignmentAcceptDeclineUrl)
    const templateVarNames = template.variables || [];
    const missing = templateVarNames.filter((name: string) => {
      const v = resolvedVariables[name];
      return v === undefined || v === null || v === '';
    });
    if (missing.length > 0) {
      resolvedVariables = { ...resolvedVariables };
      for (const name of missing) {
        if (name in TEST_SAMPLE_VARIABLES) {
          resolvedVariables[name] = TEST_SAMPLE_VARIABLES[name];
        }
      }
    }

    const missingVariables = templateVarNames.filter((name: string) => {
      const value = resolvedVariables[name];
      return value === undefined || value === null || value === '';
    });

    const renderedBody = await renderTemplate(template, resolvedVariables, tenantId);

    let dispatchResult: any = null;
    if (send) {
      dispatchResult = await dispatchSystemMessage({
        tenantId,
        triggerKey: triggerKey as SystemTriggerKey,
        userId,
        context: {
          ...(contextOverrides || {}),
          applicationId,
          applicationData,
          assignmentId,
          assignmentData,
        },
        metadata: {
          testSend: true,
          templateId,
        },
        source: 'system_test',
      });
    }

    response.status(200).json({
      success: true,
      templateId,
      triggerKey,
      renderedBody,
      resolvedVariables,
      missingVariables,
      dispatchResult,
    });
  } catch (error: any) {
    logger.error('testAutomationTemplateApi error', error);
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' } });
  }
});
