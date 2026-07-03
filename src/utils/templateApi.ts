/**
 * Template API Utilities
 * 
 * Helper functions for interacting with the unified messaging template API
 */

export type Channel = 'sms' | 'email' | 'push';
export type LanguageCode = 'en' | 'es';

export interface UnifiedMessageTemplate {
  id?: string;
  messageTypeId: string;
  channel: Channel;
  language: LanguageCode;
  name: string;
  body: string;              // For SMS/plain text
  subject?: string;         // For email
  htmlBody?: string;        // For email HTML
  variables: string[];
  includeStopFooter: boolean;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MessageTypeConfig {
  id: string;
  label: string;
  category:
    | 'system'
    | 'onboarding'
    | 'transactional'
    | 'compliance'
    | 'engagement'
    | 'chat'
    | 'marketing';
  defaultChannels: Channel[];
  critical: boolean;
  allowReply: boolean;
  requiresExplicitSmsOptIn: boolean;
  requiresTemplate: boolean;
  aiAllowedToDraft: boolean;
  aiAllowedToAutoSend: boolean;
  description?: string;
  enabled: boolean;
}

export type AutomationRuleStatus = 'draft' | 'active';

export interface MessageAutomationRule {
  id?: string;
  ruleId: string;
  name: string;
  triggerKey: string;
  templateId: string;
  deliveryChannels: {
    sms: boolean;
    email: boolean;
    push: boolean;
  };
  status: AutomationRuleStatus;
  language?: LanguageCode;
  priority?: number;
}

export interface TriggerCatalogItem {
  key: string;
  label: string;
  description: string;
}

const API_BASE_URL = 'https://us-central1-hrx1-d3beb.cloudfunctions.net';

/** JSON headers + Firebase ID token. `sendMessageApi`/`testRenderApi`
 *  require a Bearer token as of 2026-07-03 (they were unauthenticated
 *  public endpoints; sendMessageApi could send real SMS). */
async function authJsonHeaders(): Promise<Record<string, string>> {
  const { auth } = await import('../firebase');
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * List templates with optional filtering
 */
export async function listTemplates(
  tenantId: string,
  options?: {
    channel?: Channel;
    messageTypeId?: string;
    language?: LanguageCode;
    active?: boolean;
    page?: number;
    pageSize?: number;
  }
): Promise<{ success: boolean; data: UnifiedMessageTemplate[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams({
    tenantId,
    ...(options?.channel && { channel: options.channel }),
    ...(options?.messageTypeId && { messageTypeId: options.messageTypeId }),
    ...(options?.language && { language: options.language }),
    ...(options?.active !== undefined && { active: String(options.active) }),
    ...(options?.page && { page: String(options.page) }),
    ...(options?.pageSize && { pageSize: String(options.pageSize) }),
  });

  const response = await fetch(`${API_BASE_URL}/listTemplatesApi?${params.toString()}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to fetch templates' } }));
    throw new Error(error.error?.message || 'Failed to fetch templates');
  }

  const result = await response.json();
  
  // Convert Firestore timestamps to Dates
  if (result.success && result.data) {
    result.data = result.data.map((template: any) => ({
      ...template,
      createdAt: template.createdAt?.toDate ? template.createdAt.toDate() : template.createdAt,
      updatedAt: template.updatedAt?.toDate ? template.updatedAt.toDate() : template.updatedAt,
    }));
  }

  return result;
}

/**
 * Get a single template by ID
 */
export async function getTemplate(
  tenantId: string,
  templateId: string
): Promise<{ success: boolean; data: UnifiedMessageTemplate }> {
  const params = new URLSearchParams({
    tenantId,
    templateId,
  });

  const response = await fetch(`${API_BASE_URL}/getTemplateApi?${params.toString()}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to fetch template' } }));
    throw new Error(error.error?.message || 'Failed to fetch template');
  }

  const result = await response.json();
  
  // Convert Firestore timestamps to Dates
  if (result.success && result.data) {
    result.data = {
      ...result.data,
      createdAt: result.data.createdAt?.toDate ? result.data.createdAt.toDate() : result.data.createdAt,
      updatedAt: result.data.updatedAt?.toDate ? result.data.updatedAt.toDate() : result.data.updatedAt,
    };
  }

  return result;
}

/**
 * Create a new template
 */
export async function createTemplate(
  template: Omit<UnifiedMessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { version?: number; tenantId: string }
): Promise<{ success: boolean; data: UnifiedMessageTemplate }> {
  const response = await fetch(`${API_BASE_URL}/createTemplateApi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...template,
      version: template.version || 1,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to create template' } }));
    throw new Error(error.error?.message || 'Failed to create template');
  }

  const result = await response.json();
  
  // Convert Firestore timestamps to Dates
  if (result.success && result.data) {
    result.data = {
      ...result.data,
      createdAt: result.data.createdAt?.toDate ? result.data.createdAt.toDate() : result.data.createdAt,
      updatedAt: result.data.updatedAt?.toDate ? result.data.updatedAt.toDate() : result.data.updatedAt,
    };
  }

  return result;
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  tenantId: string,
  templateId: string,
  updates: Partial<UnifiedMessageTemplate>
): Promise<{ success: boolean; data: UnifiedMessageTemplate }> {
  const params = new URLSearchParams({
    tenantId,
    templateId,
  });

  const response = await fetch(`${API_BASE_URL}/updateTemplateApi?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to update template' } }));
    throw new Error(error.error?.message || 'Failed to update template');
  }

  const result = await response.json();
  
  // Convert Firestore timestamps to Dates
  if (result.success && result.data) {
    result.data = {
      ...result.data,
      createdAt: result.data.createdAt?.toDate ? result.data.createdAt.toDate() : result.data.createdAt,
      updatedAt: result.data.updatedAt?.toDate ? result.data.updatedAt.toDate() : result.data.updatedAt,
    };
  }

  return result;
}

/**
 * Delete a template (soft delete)
 */
export async function deleteTemplate(
  tenantId: string,
  templateId: string
): Promise<{ success: boolean }> {
  const params = new URLSearchParams({
    tenantId,
    templateId,
  });

  const response = await fetch(`${API_BASE_URL}/deleteTemplateApi?${params.toString()}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to delete template' } }));
    throw new Error(error.error?.message || 'Failed to delete template');
  }

  return await response.json();
}

/**
 * Get all message types
 */
export async function getMessageTypes(
  tenantId: string
): Promise<{ success: boolean; data: MessageTypeConfig[] }> {
  const params = new URLSearchParams({
    tenantId,
  });

  const response = await fetch(`${API_BASE_URL}/listMessageTypesApi?${params.toString()}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to fetch message types' } }));
    throw new Error(error.error?.message || 'Failed to fetch message types');
  }

  return await response.json();
}

/**
 * Test render a template with sample data
 */
export async function testRenderTemplate(
  tenantId: string,
  messageTypeId: string,
  channel: Channel,
  language: LanguageCode,
  context: Record<string, any>
): Promise<{ success: boolean; renderedBody?: string; templateId?: string; variablesMissing?: string[] }> {
  const response = await fetch(`${API_BASE_URL}/testRenderApi`, {
    method: 'POST',
    headers: await authJsonHeaders(),
    body: JSON.stringify({
      tenantId,
      messageTypeId,
      channel,
      language,
      context,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to render template' } }));
    throw new Error(error.error?.message || 'Failed to render template');
  }

  return await response.json();
}

/**
 * Extract variables from template body (e.g., {{firstName}})
 */
export function extractVariables(body: string): string[] {
  const variableRegex = /\{\{(\w+)\}\}/g;
  const variables: string[] = [];
  let match;
  
  while ((match = variableRegex.exec(body)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }
  
  return variables;
}

/**
 * Send a test message using a template
 */
export async function sendTestMessage(
  tenantId: string,
  userId: string,
  messageTypeId: string,
  context: Record<string, any>,
  overrideChannels?: Channel[]
): Promise<{ success: boolean; dispatchedChannels?: Channel[]; messageLogIds?: string[]; warnings?: string[] }> {
  const response = await fetch(`${API_BASE_URL}/sendMessageApi`, {
    method: 'POST',
    headers: await authJsonHeaders(),
    body: JSON.stringify({
      userId,
      messageTypeId,
      context: {
        ...context,
        tenantId,
      },
      overrideChannels,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to send test message' } }));
    throw new Error(error.error?.message || 'Failed to send test message');
  }

  return await response.json();
}

export async function listAutomationRules(
  tenantId: string
): Promise<{ success: boolean; data: MessageAutomationRule[] }> {
  const params = new URLSearchParams({ tenantId });
  const response = await fetch(`${API_BASE_URL}/listAutomationRulesApi?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to fetch automation rules' } }));
    throw new Error(error.error?.message || 'Failed to fetch automation rules');
  }
  return await response.json();
}

export async function createAutomationRule(
  payload: { tenantId: string } & Omit<MessageAutomationRule, 'id'>
): Promise<{ success: boolean; data: MessageAutomationRule }> {
  const response = await fetch(`${API_BASE_URL}/createAutomationRuleApi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to create automation rule' } }));
    throw new Error(error.error?.message || 'Failed to create automation rule');
  }
  return await response.json();
}

export async function updateAutomationRule(
  tenantId: string,
  ruleId: string,
  updates: Partial<MessageAutomationRule>
): Promise<{ success: boolean; data: MessageAutomationRule }> {
  const params = new URLSearchParams({ tenantId, ruleId });
  const response = await fetch(`${API_BASE_URL}/updateAutomationRuleApi?${params.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to update automation rule' } }));
    throw new Error(error.error?.message || 'Failed to update automation rule');
  }
  return await response.json();
}

export async function deleteAutomationRule(
  tenantId: string,
  ruleId: string
): Promise<{ success: boolean }> {
  const params = new URLSearchParams({ tenantId, ruleId });
  const response = await fetch(`${API_BASE_URL}/deleteAutomationRuleApi?${params.toString()}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to delete automation rule' } }));
    throw new Error(error.error?.message || 'Failed to delete automation rule');
  }
  return await response.json();
}

export async function listTriggerCatalog(): Promise<{ success: boolean; data: TriggerCatalogItem[] }> {
  const response = await fetch(`${API_BASE_URL}/listTriggerCatalogApi`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to load trigger catalog' } }));
    throw new Error(error.error?.message || 'Failed to load trigger catalog');
  }
  return await response.json();
}

export async function testAutomationTemplate(payload: {
  tenantId: string;
  userId: string;
  templateId: string;
  triggerKey: string;
  applicationId?: string;
  assignmentId?: string;
  contextOverrides?: Record<string, any>;
  send?: boolean;
}): Promise<{
  success: boolean;
  renderedBody?: string;
  resolvedVariables?: Record<string, any>;
  missingVariables?: string[];
  dispatchResult?: any;
}> {
  const response = await fetch(`${API_BASE_URL}/testAutomationTemplateApi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to test automation template' } }));
    throw new Error(error.error?.message || 'Failed to test automation template');
  }
  return await response.json();
}

