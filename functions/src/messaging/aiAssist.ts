/**
 * AI Assist for Inbound Messaging
 * 
 * Uses AI to classify inbound intent and propose reply options.
 * AI never auto-sends - human approval required.
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 3 AI Assist for Inbound Messaging
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export interface MessageDraft {
  id?: string;
  threadId: string;
  userId: string;
  tenantId: string;
  aiSuggested: boolean;
  approved: boolean;
  messageText: string;
  reason: string; // e.g., classified intent
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  approvedAt?: admin.firestore.Timestamp;
  approvedBy?: string; // userId who approved
}

export interface InboundClassification {
  intent: 'question' | 'complaint' | 'request' | 'confirmation' | 'greeting' | 'other';
  urgency: 'low' | 'medium' | 'high';
  suggestedAction: string;
  confidence: number; // 0-1
}

export interface ReplySuggestion {
  draftText: string;
  reason: string;
  confidence: number;
}

/**
 * Classify an inbound message to understand intent
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 3.3 AI Pipeline
 */
export async function classifyInboundMessage(
  messageBody: string,
  threadId: string,
  tenantId: string
): Promise<InboundClassification> {
  try {
    // TODO: Integrate with actual AI service (OpenAI, Anthropic, etc.)
    // For now, use simple keyword-based classification
    
    const bodyLower = messageBody.toLowerCase().trim();
    
    // Simple keyword-based classification
    let intent: InboundClassification['intent'] = 'other';
    let urgency: InboundClassification['urgency'] = 'low';
    let suggestedAction = 'Review and respond';
    
    if (bodyLower.includes('?') || bodyLower.includes('when') || bodyLower.includes('where') || bodyLower.includes('how')) {
      intent = 'question';
      urgency = 'medium';
      suggestedAction = 'Answer the question';
    } else if (bodyLower.includes('problem') || bodyLower.includes('issue') || bodyLower.includes('wrong') || bodyLower.includes('error')) {
      intent = 'complaint';
      urgency = 'high';
      suggestedAction = 'Address the complaint';
    } else if (bodyLower.includes('need') || bodyLower.includes('want') || bodyLower.includes('please')) {
      intent = 'request';
      urgency = 'medium';
      suggestedAction = 'Fulfill the request';
    } else if (bodyLower.includes('yes') || bodyLower.includes('ok') || bodyLower.includes('confirm') || bodyLower.includes('sure')) {
      intent = 'confirmation';
      urgency = 'low';
      suggestedAction = 'Acknowledge confirmation';
    } else if (bodyLower.includes('hi') || bodyLower.includes('hello') || bodyLower.includes('hey')) {
      intent = 'greeting';
      urgency = 'low';
      suggestedAction = 'Respond with greeting';
    }
    
    // Determine urgency based on keywords
    if (bodyLower.includes('urgent') || bodyLower.includes('asap') || bodyLower.includes('emergency')) {
      urgency = 'high';
    } else if (bodyLower.includes('soon') || bodyLower.includes('quick')) {
      urgency = 'medium';
    }
    
    const confidence = 0.7; // Placeholder - would be from AI model
    
    logger.info(`Classified inbound message: intent=${intent}, urgency=${urgency}`);
    
    return {
      intent,
      urgency,
      suggestedAction,
      confidence,
    };
  } catch (error: any) {
    logger.error('Error classifying inbound message:', error);
    // Return default classification on error
    return {
      intent: 'other',
      urgency: 'low',
      suggestedAction: 'Review and respond',
      confidence: 0.5,
    };
  }
}

/**
 * Suggest a reply draft for an inbound message
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 3.3 AI Pipeline
 */
export async function suggestReply(
  messageBody: string,
  threadId: string,
  tenantId: string,
  userId: string,
  classification?: InboundClassification
): Promise<ReplySuggestion> {
  try {
    // Get classification if not provided
    const classificationResult = classification || await classifyInboundMessage(messageBody, threadId, tenantId);
    
    // TODO: Integrate with actual AI service to generate reply
    // For now, use template-based suggestions
    
    let draftText = '';
    let reason = '';
    
    switch (classificationResult.intent) {
      case 'question':
        draftText = 'Thank you for your question. Let me look into that for you and get back to you shortly.';
        reason = 'Responding to question';
        break;
      case 'complaint':
        draftText = 'I apologize for the inconvenience. I\'m looking into this issue and will resolve it as soon as possible.';
        reason = 'Addressing complaint';
        break;
      case 'request':
        draftText = 'Thank you for your request. I\'ll work on that and update you soon.';
        reason = 'Acknowledging request';
        break;
      case 'confirmation':
        draftText = 'Thank you for confirming. We\'ve received your confirmation.';
        reason = 'Acknowledging confirmation';
        break;
      case 'greeting':
        draftText = 'Hello! How can I help you today?';
        reason = 'Responding to greeting';
        break;
      default:
        draftText = 'Thank you for your message. I\'ll review it and get back to you soon.';
        reason = 'General response';
    }
    
    const confidence = classificationResult.confidence;
    
    logger.info(`Generated reply suggestion for thread ${threadId}: ${reason}`);
    
    return {
      draftText,
      reason,
      confidence,
    };
  } catch (error: any) {
    logger.error('Error suggesting reply:', error);
    // Return default suggestion on error
    return {
      draftText: 'Thank you for your message. I\'ll review it and get back to you soon.',
      reason: 'Default response',
      confidence: 0.5,
    };
  }
}

/**
 * Create an AI-suggested message draft
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 3.2 New Collection
 */
export async function createAIDraft(
  threadId: string,
  userId: string,
  tenantId: string,
  messageBody: string,
  classification?: InboundClassification
): Promise<string> {
  try {
    // Get reply suggestion
    const suggestion = await suggestReply(messageBody, threadId, tenantId, userId, classification);
    
    // Create draft document
    const draftRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageDrafts')
      .doc();
    
    const draft: Omit<MessageDraft, 'id'> = {
      threadId,
      userId,
      tenantId,
      aiSuggested: true,
      approved: false,
      messageText: suggestion.draftText,
      reason: suggestion.reason,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await draftRef.set(draft);
    
    // Log the draft creation
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .add({
        tenantId,
        userId,
        threadId,
        messageTypeId: 'ai_draft_created',
        channel: 'sms',
        direction: 'outbound',
        fromIdentity: 'ai',
        contentSent: suggestion.draftText,
        language: 'en',
        status: 'ai_draft_created',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    
    logger.info(`Created AI draft ${draftRef.id} for thread ${threadId}`);
    
    return draftRef.id;
  } catch (error: any) {
    logger.error('Error creating AI draft:', error);
    throw error;
  }
}

/**
 * Approve an AI draft (marks it as approved, but doesn't send)
 * Actual sending happens through the orchestrator
 */
export async function approveAIDraft(
  draftId: string,
  tenantId: string,
  approvedBy: string
): Promise<void> {
  try {
    const draftRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageDrafts')
      .doc(draftId);
    
    await draftRef.update({
      approved: true,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy,
    });
    
    // Log the approval
    const draftDoc = await draftRef.get();
    const draft = draftDoc.data() as MessageDraft;
    
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .add({
        tenantId,
        userId: draft.userId,
        threadId: draft.threadId,
        messageTypeId: 'ai_draft_approved',
        channel: 'sms',
        direction: 'outbound',
        fromIdentity: 'recruiter',
        fromUserId: approvedBy,
        contentSent: draft.messageText,
        language: 'en',
        status: 'ai_draft_approved',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    
    logger.info(`Approved AI draft ${draftId} by user ${approvedBy}`);
  } catch (error: any) {
    logger.error('Error approving AI draft:', error);
    throw error;
  }
}

