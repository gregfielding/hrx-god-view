/**
 * Messaging API Routes
 * 
 * High-level HTTP API for messaging operations.
 * 
 * Implements: HRX One Messaging API Spec — Section 1 High-Level Send API
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendMessage, MessageContext } from './routingOrchestrator';
import { getTemplate, renderTemplate, MessageTemplate } from './templateEngine';
import { Channel } from './messageTypesRegistry';
import type { LanguageCode } from './templateEngine';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './twilioSecrets';

/**
 * POST /api/messaging/send
 * 
 * Generic, type-based message send. Preferred entry point for backoffice UI and business logic.
 * 
 * Implements: HRX Messaging API Spec §1.1
 */
export const sendMessageApi = onRequest(
  {
    cors: true, // Enable CORS handling - Firebase will handle OPTIONS automatically
    invoker: 'public', // Allow unauthenticated calls for CORS preflight
    // Twilio secrets must be bound or TwilioSmsProvider.initialize() throws
    // "Twilio credentials not configured". SendGrid is intentionally read from
    // process.env via emailProviderFactory and is not bound here.
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request, response) => {
    // Set CORS headers
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // Prefer parsed body; some proxies/clients omit JSON parsing — fall back to rawBody.
      let body: Record<string, unknown> = (request.body || {}) as Record<string, unknown>;
      if (
        (!body || typeof body !== 'object' || Object.keys(body).length === 0) &&
        (request as any).rawBody
      ) {
        try {
          const raw = (request as any).rawBody;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
          if (parsed && typeof parsed === 'object') body = parsed;
        } catch (parseErr: any) {
          logger.warn('sendMessageApi: could not parse rawBody as JSON', parseErr?.message);
        }
      }

      // TODO: Add authentication middleware
      // const auth = await verifyAuth(request);
      // if (!auth) {
      //   response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      //   return;
      // }

      const {
        userId,
        messageTypeId,
        context,
        overrideChannels,
        customerId,
        agencyId,
        metadata,
      } = body as any;

      logger.info('sendMessageApi called', {
        userId,
        messageTypeId,
        hasContext: !!context,
        tenantId: context?.tenantId,
        overrideChannels,
      });

      if (!userId || !messageTypeId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'userId and messageTypeId are required' },
        });
        return;
      }

      // Get tenantId from context - this is required
      const tenantId = context?.tenantId;
      if (!tenantId) {
        logger.error('sendMessageApi: tenantId missing from context', { context });
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required in context' },
        });
        return;
      }

      // Merge metadata from request (includes senderId, senderType, source, sourceId)
      const mergedMetadata = {
        ...(metadata || {}),
        customerId,
        agencyId,
      };

      const messageContext: MessageContext = {
        userId,
        tenantId,
        messageTypeId,
        variables: context || {},
        metadata: mergedMetadata,
        source: metadata?.source || 'api',
        sourceId: metadata?.sourceId,
        overrideChannels: overrideChannels as Channel[] | undefined, // Channels selected in UI (e.g., MessageDrawer)
      };

      const result = await sendMessage(messageContext);

      const dispatchedChannels = result.routingDecision.channels;
      const messageLogIds: string[] = [];
      if (result.messageLogId) {
        messageLogIds.push(result.messageLogId);
      }

      const warnings: string[] = [];
      if (result.routingDecision.reason && (!result.success || !result.routingDecision.shouldSend)) {
        warnings.push(result.routingDecision.reason);
      }
      result.routingDecision.skippedChannels.forEach(skipped => {
        warnings.push(`Skipped ${skipped.channel}: ${skipped.reason}`);
      });
      result.deliveryResults.forEach(dr => {
        if (!dr.success && dr.error) {
          warnings.push(`${dr.channel}: ${dr.error}`);
        }
      });

      logger.info('sendMessageApi success', {
        success: result.success,
        dispatchedChannels,
        messageLogIds,
        warnings: warnings.length,
      });

      response.status(200).json({
        success: result.success,
        dispatchedChannels,
        messageLogIds,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (error: any) {
      logger.error('Error in sendMessageApi:', error, {
        stack: error.stack,
        message: error.message,
        name: error.name,
      });
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/test-render
 * 
 * Render (but do not send) a template for preview/testing.
 * 
 * Implements: HRX Messaging API Spec §1.2
 */
export const testRenderApi = onRequest(
  {
    cors: true, // Enable CORS handling - Firebase will handle OPTIONS automatically
    invoker: 'public', // Allow unauthenticated calls for CORS preflight
  },
  async (request, response) => {
    // Log all request details for debugging
    logger.info('testRenderApi called', {
      method: request.method,
      origin: request.headers.origin,
      'user-agent': request.headers['user-agent'],
      'content-type': request.headers['content-type'],
      'access-control-request-method': request.headers['access-control-request-method'],
      'access-control-request-headers': request.headers['access-control-request-headers'],
      url: request.url,
      path: request.path,
    });

    // When cors: true is set, Firebase handles OPTIONS automatically
    // But we still need to set CORS headers for actual requests
    const requestOrigin = (request.headers.origin as string) || '';
    const allowedOrigins = new Set(['http://localhost:3000', 'https://hrxone.com']);
    const corsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : 'https://hrxone.com';

    logger.info('CORS configuration', {
      requestOrigin,
      corsOrigin,
      isAllowed: allowedOrigins.has(requestOrigin),
    });

    // Set CORS headers for all responses (cors: true handles OPTIONS, but we set headers for POST)
    response.set('Access-Control-Allow-Origin', corsOrigin);
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.set('Access-Control-Max-Age', '3600');
    response.set('Vary', 'Origin');

    logger.info('CORS headers set', {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });

    // Handle preflight OPTIONS request (backup - cors: true should handle this, but just in case)
    if (request.method === 'OPTIONS') {
      logger.info('Handling OPTIONS preflight request');
      response.status(204).send('');
      return;
    }

    try {
      logger.info('Processing request', { method: request.method, hasBody: !!request.body });

      if (request.method !== 'POST') {
        logger.warn('Method not allowed', { method: request.method });
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication middleware

      const {
        messageTypeId,
        channel,
        language,
        context,
        tenantId,
      } = request.body;

      logger.info('Request body parsed', {
        messageTypeId,
        channel,
        language,
        hasContext: !!context,
        tenantId,
      });

      if (!messageTypeId || !channel || !language || !context) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'messageTypeId, channel, language, and context are required' },
        });
        return;
      }

      const resolvedTenantId = tenantId || 'default'; // Placeholder

      // Get template
      const template = await getTemplate(resolvedTenantId, messageTypeId, channel as Channel, language as LanguageCode);

      if (!template) {
        response.status(404).json({
          success: false,
          error: { code: 'TEMPLATE_NOT_FOUND', message: `No template found for ${messageTypeId}/${channel}/${language}` },
          variablesMissing: [],
        });
        return;
      }

      // Check for missing variables
      const variablesMissing: string[] = [];
      for (const varName of template.variables) {
        if (!(varName in context) || context[varName] == null) {
          variablesMissing.push(varName);
        }
      }

      if (variablesMissing.length > 0) {
        response.status(200).json({
          success: false,
          templateId: template.id,
          variablesMissing,
        });
        return;
      }

      // Render template
      const renderedBody = await renderTemplate(template, context, resolvedTenantId);

      response.status(200).json({
        success: true,
        renderedBody,
        templateId: template.id,
        variablesMissing: [],
      });
    } catch (error: any) {
      logger.error('Error in testRenderApi:', error);
      
      // Set CORS headers even on error (corsOrigin is already defined in outer scope)
      response.set('Access-Control-Allow-Origin', corsOrigin);
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

