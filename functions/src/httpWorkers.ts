import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { logger } from './utils/logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// HTTP worker for task update logging (called by Cloud Tasks)
export const logTaskUpdate = onRequest({
  cors: true,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 2
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { taskId, changedFields, payload } = req.body;
    
    if (!taskId || !payload) {
      res.status(400).send('Missing required fields');
      return;
    }

    // Process the AI log entry
    await logger.aiEvent({
      userId: payload.userId || 'system',
      actionType: payload.actionType || 'task_updated',
      sourceModule: 'HTTPWorker',
      success: true,
      eventType: payload.eventType || 'deal.task_updated',
      targetType: 'task',
      targetId: payload.targetId || taskId,
      aiRelevant: true,
      contextType: 'crm',
      traitsAffected: null,
      aiTags: ['task', 'update', 'deal', ...changedFields],
      urgencyScore: payload.priority === 'urgent' ? 8 : payload.priority === 'high' ? 6 : 4,
      reason: `Task updated: ${changedFields.join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });

    logger.info('Task update logged', { taskId, changedFields: changedFields.length });
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Error in logTaskUpdate:', error);
    res.status(500).json({ error: error.message });
  }
});

// HTTP worker for user update logging (called by Cloud Tasks)
export const logUserUpdate = onRequest({
  cors: true,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 2
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { userId, changedFields, payload } = req.body;
    
    if (!userId || !payload) {
      res.status(400).send('Missing required fields');
      return;
    }

    // Process the AI log entry
    await logger.aiEvent({
      userId: payload.userId || 'system',
      actionType: payload.actionType || 'user_updated',
      sourceModule: 'HTTPWorker',
      success: true,
      eventType: payload.eventType || 'user.updated',
      targetType: 'user',
      targetId: payload.targetId || userId,
      aiRelevant: true,
      contextType: 'user',
      traitsAffected: null,
      aiTags: ['user', 'update', ...payload.importantFields || []],
      urgencyScore: 4,
      reason: `User updated: ${(payload.importantFields || []).join(', ')}`,
      versionTag: 'v1',
      latencyMs: 0
    });

    logger.info('User update logged', { userId, changedFields: changedFields.length });
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Error in logUserUpdate:', error);
    res.status(500).json({ error: error.message });
  }
});

// HTTP worker for active salespeople updates (called by Cloud Tasks)
export const updateActiveSalespeople = onRequest({
  cors: true,
  timeoutSeconds: 300,
  memory: '512MiB',
  maxInstances: 2
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { tenantId, dealId, before, after } = req.body;
    
    if (!tenantId || !dealId) {
      res.status(400).send('Missing required fields');
      return;
    }

    // Import the computation functions (they're not exported, so we'll inline the logic)
    // For now, we'll create a simplified version that just updates the timestamp
    // TODO: Implement full active salespeople computation
    
    const companyIds: string[] = [];
    if (after.companyId) companyIds.push(after.companyId);
    if (Array.isArray(after.companyIds)) after.companyIds.forEach((id: string) => companyIds.push(id));
    if (Array.isArray(after.associations?.companies)) after.associations.companies.forEach((c: any) => companyIds.push(typeof c === 'string' ? c : c?.id));
    
    const uniq = Array.from(new Set(companyIds.filter(Boolean)));
    
    // Update company active salespeople (simplified for now)
    await Promise.all(uniq.map(async (cid) => {
      await db.doc(`tenants/${tenantId}/crm_companies/${cid}`).set({ 
        activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() 
      }, { merge: true });
    }));
    
    // Update contact active salespeople (simplified for now)
    const contactIds: string[] = [];
    if (Array.isArray(after.contactIds)) after.contactIds.forEach((id: string) => contactIds.push(id));
    if (Array.isArray(after.associations?.contacts)) after.associations.contacts.forEach((c: any) => contactIds.push(typeof c === 'string' ? c : c?.id));
    
    const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean)));
    await Promise.all(uniqueContactIds.map(async (contactId) => {
      await db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`).set({ 
        activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp() 
      }, { merge: true });
    }));

    logger.info('Active salespeople updated', { 
      tenantId, 
      dealId, 
      companies: uniq.length, 
      contacts: uniqueContactIds.length 
    });
    
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Error in updateActiveSalespeople:', error);
    res.status(500).json({ error: error.message });
  }
});
