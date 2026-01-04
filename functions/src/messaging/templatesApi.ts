/**
 * Templates API Routes
 * 
 * CRUD operations for message templates.
 * 
 * Implements: HRX One Messaging API Spec — Section 2 Templates Admin CRUD
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  getTemplate,
  createTemplate,
  updateTemplate,
  getTemplatesByMessageType,
  MessageTemplate,
  LanguageCode,
} from './templateEngine';
import { Channel } from './messageTypesRegistry';
import { getAllMessageTypes } from './messageTypesRegistry';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * GET /api/messaging/templates
 * 
 * List templates with filtering & pagination.
 * 
 * Implements: HRX Messaging API Spec §2.1
 */
export const listTemplatesApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Add authentication and permission checks

      const {
        messageTypeId,
        channel,
        language,
        active,
        page = 1,
        pageSize = 20,
        tenantId,
      } = request.query;

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      let templates: MessageTemplate[] = [];

      if (messageTypeId) {
        // Get templates for specific message type
        templates = await getTemplatesByMessageType(tenantId as string, messageTypeId as string, {
          channel: channel as Channel | undefined,
          language: language as LanguageCode | undefined,
          activeOnly: active !== 'false',
        });
      } else {
        // Get all templates (simplified - in production would need better querying)
        let query: admin.firestore.Query = db
          .collection('tenants')
          .doc(tenantId as string)
          .collection('messageTemplates');

        if (channel) {
          query = query.where('channel', '==', channel);
        }
        if (language) {
          query = query.where('language', '==', language);
        }
        if (active !== undefined) {
          query = query.where('active', '==', active === 'true');
        }

        const snapshot = await query.get();
        templates = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as MessageTemplate[];
      }

      // Pagination
      const startIndex = (Number(page) - 1) * Number(pageSize);
      const endIndex = startIndex + Number(pageSize);
      const paginatedTemplates = templates.slice(startIndex, endIndex);

      response.status(200).json({
        success: true,
        data: paginatedTemplates,
        page: Number(page),
        pageSize: Number(pageSize),
        total: templates.length,
      });
    } catch (error: any) {
      logger.error('Error in listTemplatesApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * GET /api/messaging/templates/:id
 * 
 * Fetch a single template by ID.
 * 
 * Implements: HRX Messaging API Spec §2.2
 */
export const getTemplateApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Add authentication

      const { tenantId, templateId } = request.query;

      if (!tenantId || !templateId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId and templateId are required' },
        });
        return;
      }

      const templateDoc = await db
        .collection('tenants')
        .doc(tenantId as string)
        .collection('messageTemplates')
        .doc(templateId as string)
        .get();

      if (!templateDoc.exists) {
        response.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Template not found' },
        });
        return;
      }

      const template = {
        id: templateDoc.id,
        ...templateDoc.data(),
      } as MessageTemplate;

      response.status(200).json({
        success: true,
        data: template,
      });
    } catch (error: any) {
      logger.error('Error in getTemplateApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/templates
 * 
 * Create a new template.
 * 
 * Implements: HRX Messaging API Spec §2.3
 */
export const createTemplateApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication and permission checks (admin/manager only)

      const {
        tenantId,
        messageTypeId,
        channel,
        language,
        name,
        body,
        subject,        // For email
        htmlBody,       // For email HTML
        variables,
        includeStopFooter = false,
        active = true,
      } = request.body;

      if (!tenantId || !messageTypeId || !channel || !language || !name || !body) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId, messageTypeId, channel, language, name, and body are required' },
        });
        return;
      }

      // For email templates, subject is required
      if (channel === 'email' && !subject) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'subject is required for email templates' },
        });
        return;
      }

      // TODO: Get userId from auth
      const createdBy = 'system'; // Placeholder

      const templateId = await createTemplate(tenantId, {
        messageTypeId,
        channel: channel as Channel,
        language: language as LanguageCode,
        name,
        body,
        subject,        // For email
        htmlBody,      // For email HTML
        includeStopFooter,
        active,
        createdBy,
        version: 1,
      });

      // Fetch created template
      const templateDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageTemplates')
        .doc(templateId)
        .get();

      const template = {
        id: templateDoc.id,
        ...templateDoc.data(),
      } as MessageTemplate;

      response.status(200).json({
        success: true,
        data: template,
      });
    } catch (error: any) {
      logger.error('Error in createTemplateApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * PATCH /api/messaging/templates/:id
 * 
 * Update an existing template (partial updates).
 * 
 * Implements: HRX Messaging API Spec §2.4
 */
export const updateTemplateApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'PATCH' && request.method !== 'PUT') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH/PUT allowed' } });
        return;
      }

      // TODO: Add authentication and permission checks

      const { tenantId, templateId } = request.query;
      const updates = request.body;

      if (!tenantId || !templateId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId and templateId are required' },
        });
        return;
      }

      await updateTemplate(tenantId as string, templateId as string, updates);

      // Fetch updated template
      const templateDoc = await db
        .collection('tenants')
        .doc(tenantId as string)
        .collection('messageTemplates')
        .doc(templateId as string)
        .get();

      const template = {
        id: templateDoc.id,
        ...templateDoc.data(),
      } as MessageTemplate;

      response.status(200).json({
        success: true,
        data: template,
      });
    } catch (error: any) {
      logger.error('Error in updateTemplateApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * DELETE /api/messaging/templates/:id
 * 
 * Soft-delete or archive a template.
 * 
 * Implements: HRX Messaging API Spec §2.5
 */
export const deleteTemplateApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'DELETE') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only DELETE allowed' } });
        return;
      }

      // TODO: Add authentication and permission checks

      const { tenantId, templateId } = request.query;

      if (!tenantId || !templateId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId and templateId are required' },
        });
        return;
      }

      // Soft delete by setting active = false
      await updateTemplate(tenantId as string, templateId as string, { active: false });

      response.status(200).json({
        success: true,
      });
    } catch (error: any) {
      logger.error('Error in deleteTemplateApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * GET /api/messaging/types
 * 
 * Expose the MessageTypes Registry to the frontend/admin.
 * 
 * Implements: HRX Messaging API Spec §2.6
 */
export const listMessageTypesApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Add authentication

      const { tenantId } = request.query;

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      const messageTypes = await getAllMessageTypes(tenantId as string);

      response.status(200).json({
        success: true,
        data: messageTypes,
      });
    } catch (error: any) {
      logger.error('Error in listMessageTypesApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

