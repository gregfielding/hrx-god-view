import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { Channel } from './messageTypesRegistry';
import { SystemTriggerKey } from './triggerRegistry';

const db = admin.firestore();

export type AutomationRuleStatus = 'draft' | 'active';

export interface DeliveryChannels {
  sms: boolean;
  email: boolean;
  push: boolean;
}

export interface MessageAutomationRule {
  id?: string;
  ruleId: string;
  name: string;
  triggerKey: SystemTriggerKey;
  templateId: string;
  deliveryChannels: DeliveryChannels;
  status: AutomationRuleStatus;
  language?: 'en' | 'es';
  priority?: number;
  updatedAt?: admin.firestore.Timestamp;
  createdAt?: admin.firestore.Timestamp;
}

export function normalizeDeliveryChannels(input?: Partial<DeliveryChannels>): DeliveryChannels {
  return {
    sms: !!input?.sms,
    email: !!input?.email,
    push: !!input?.push,
  };
}

export function toChannelList(deliveryChannels: DeliveryChannels): Channel[] {
  const channels: Channel[] = [];
  if (deliveryChannels.sms) channels.push('sms');
  if (deliveryChannels.email) channels.push('email');
  if (deliveryChannels.push) channels.push('push');
  return channels;
}

export async function listAutomationRules(tenantId: string): Promise<MessageAutomationRule[]> {
  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('messageAutomationRules')
    .orderBy('updatedAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MessageAutomationRule));
}

export async function getAutomationRule(tenantId: string, ruleId: string): Promise<MessageAutomationRule | null> {
  const doc = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('messageAutomationRules')
    .doc(ruleId)
    .get();

  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as MessageAutomationRule;
}

export async function getActiveRulesByTrigger(
  tenantId: string,
  triggerKey: SystemTriggerKey
): Promise<MessageAutomationRule[]> {
  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('messageAutomationRules')
    .where('triggerKey', '==', triggerKey)
    .where('status', '==', 'active')
    .get();

  const rules = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MessageAutomationRule));
  return rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

export async function createAutomationRule(
  tenantId: string,
  payload: Omit<MessageAutomationRule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ruleRef = db.collection('tenants').doc(tenantId).collection('messageAutomationRules').doc(payload.ruleId);

  await ruleRef.set({
    ...payload,
    deliveryChannels: normalizeDeliveryChannels(payload.deliveryChannels),
    createdAt: now,
    updatedAt: now,
  });

  return ruleRef.id;
}

export async function updateAutomationRule(
  tenantId: string,
  ruleId: string,
  updates: Partial<MessageAutomationRule>
): Promise<void> {
  const ref = db.collection('tenants').doc(tenantId).collection('messageAutomationRules').doc(ruleId);
  const updateDoc: Record<string, unknown> = {
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (updates.deliveryChannels) {
    updateDoc.deliveryChannels = normalizeDeliveryChannels(updates.deliveryChannels);
  }

  await ref.set(updateDoc, { merge: true });
}

export async function deleteAutomationRule(tenantId: string, ruleId: string): Promise<void> {
  await db.collection('tenants').doc(tenantId).collection('messageAutomationRules').doc(ruleId).delete();
}

export async function upsertDefaultRuleForTemplate(args: {
  tenantId: string;
  templateId: string;
  templateName: string;
  triggerKey: SystemTriggerKey;
  deliveryChannels: DeliveryChannels;
  status: AutomationRuleStatus;
}): Promise<string> {
  const { tenantId, templateId, templateName, triggerKey, deliveryChannels, status } = args;
  const ruleId = `rule_${templateId}`;
  try {
    await updateAutomationRule(tenantId, ruleId, {
      ruleId,
      name: templateName,
      triggerKey,
      templateId,
      deliveryChannels,
      status,
    } as MessageAutomationRule);
    return ruleId;
  } catch (error: any) {
    logger.warn(`Failed to update rule ${ruleId}, trying create`, error);
    await createAutomationRule(tenantId, {
      ruleId,
      name: templateName,
      triggerKey,
      templateId,
      deliveryChannels,
      status,
      priority: 0,
    });
    return ruleId;
  }
}
