import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Helper types
interface BilingualContent {
  en: string;
  es: string;
  [key: string]: string;
}

interface BroadcastData {
  title: BilingualContent;
  content: BilingualContent;
  targetUsers: string[];
  targetFilters: Record<string, any>;
  priority: string;
  status: string;
  createdBy: string;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp | null;
  sentCount: number;
  readCount: number;
  replyCount: number;
}

// Broadcast Message System
export const createBroadcastMessage = functions.https.onCall(async (request) => {
  const { 
    title, 
    content, 
    targetUsers, 
    targetFilters, 
    priority = 'normal',
    expiresAt,
    createdBy 
  } = request.data;
  const start = Date.now();
  
  try {
    if (!title || !content || (!targetUsers && !targetFilters)) {
      throw new Error('Title, content, and either targetUsers or targetFilters are required');
    }
    
    // Validate content structure for bilingual support
    const validatedContent = typeof content === 'string' 
      ? { en: content, es: content } 
      : content;
    
    // Create broadcast message
    const broadcastData: BroadcastData = {
      title: {
        en: title,
        es: title // Will be translated if needed
      },
      content: validatedContent,
      targetUsers: targetUsers || [],
      targetFilters: targetFilters || {},
      priority,
      status: 'active',
      createdBy: createdBy || request.auth?.uid || 'system',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null,
      sentCount: 0,
      readCount: 0,
      replyCount: 0
    };
    
    // Translate title and content if needed
    if (typeof title === 'string') {
      try {
        const titleTranslation = await translateContent({
          content: title,
          targetLanguage: 'es',
          sourceLanguage: 'en'
        });
        broadcastData.title.es = titleTranslation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate broadcast title:', error.message);
      }
    }
    
    if (typeof content === 'string') {
      try {
        const contentTranslation = await translateContent({
          content: content,
          targetLanguage: 'es',
          sourceLanguage: 'en'
        });
        broadcastData.content.es = contentTranslation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate broadcast content:', error.message);
      }
    }
    
    const broadcastRef = await db.collection('broadcasts').add(broadcastData);
    
    // Create broadcast conversations for target users
    const targetUserIds = targetUsers || [];
    if (targetFilters) {
      // Get users based on filters
      const filteredUsers = await getUsersByFilters(targetFilters);
      targetUserIds.push(...filteredUsers.map(u => u.id));
    }
    
    // Remove duplicates
    const uniqueUserIds = [...new Set(targetUserIds)];
    
    // Create broadcast conversations
    const broadcastConversations = uniqueUserIds.map(userId => ({
      broadcastId: broadcastRef.id,
      workerId: userId,
      status: 'unread',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      readAt: null,
      repliedAt: null
    }));
    
    // Batch write broadcast conversations
    const batch = db.batch();
    broadcastConversations.forEach(conversation => {
      const conversationRef = db.collection('broadcast_conversations').doc();
      batch.set(conversationRef, conversation);
    });
    
    await batch.commit();
    
    // Update broadcast with sent count
    await broadcastRef.update({
      sentCount: uniqueUserIds.length
    });
    
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'broadcast_created',
      sourceModule: 'BroadcastSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Created broadcast message for ${uniqueUserIds.length} users`,
      eventType: 'broadcast.created',
      targetType: 'broadcast',
      targetId: broadcastRef.id,
      aiRelevant: true,
      contextType: 'broadcast',
      traitsAffected: null,
      aiTags: ['broadcast', 'message', 'notification'],
      urgencyScore: priority === 'high' ? 7 : 4
    });
    
    return {
      success: true,
      broadcastId: broadcastRef.id,
      sentCount: uniqueUserIds.length,
      targetUsers: uniqueUserIds
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'broadcast_created',
      sourceModule: 'BroadcastSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to create broadcast: ${error.message}`
    });
    
    throw error;
  }
});

// Get broadcast messages for a user
export const getUserBroadcasts = functions.https.onCall({
  maxInstances: 5,
  timeoutSeconds: 60
}, async (request) => {
  const { userId, status = 'all', limit = 20, offset = 0 } = request.data;
  const start = Date.now();
  
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    let query = db.collection('broadcast_conversations')
      .where('workerId', '==', userId);
    
    if (status !== 'all') {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset);
    
    const conversationsSnapshot = await query.get();
    
    // Get broadcast details for each conversation
    const broadcastIds = conversationsSnapshot.docs.map(doc => doc.data().broadcastId);
    const broadcastsSnapshot = await db.collection('broadcasts')
      .where(admin.firestore.FieldPath.documentId(), 'in', broadcastIds)
      .get();
    
    const broadcastsMap = new Map();
    broadcastsSnapshot.docs.forEach(doc => {
      broadcastsMap.set(doc.id, { id: doc.id, ...doc.data() });
    });
    
    // Combine conversation and broadcast data
    const broadcasts = conversationsSnapshot.docs.map(doc => {
      const conversationData = doc.data();
      const broadcastData = broadcastsMap.get(conversationData.broadcastId);
      
      return {
        conversationId: doc.id,
        ...conversationData,
        broadcast: broadcastData,
        createdAt: conversationData.createdAt?.toDate(),
        updatedAt: conversationData.updatedAt?.toDate(),
        readAt: conversationData.readAt?.toDate(),
        repliedAt: conversationData.repliedAt?.toDate()
      };
    });
    
    await logAIAction({
      userId,
      actionType: 'user_broadcasts_retrieved',
      sourceModule: 'BroadcastSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Retrieved ${broadcasts.length} broadcasts for user ${userId}`,
      eventType: 'broadcast.retrieved',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'broadcast',
      traitsAffected: null,
      aiTags: ['broadcast', 'retrieval'],
      urgencyScore: 3
    });
    
    return {
      success: true,
      broadcasts,
      totalCount: broadcasts.length,
      hasMore: broadcasts.length === limit
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'user_broadcasts_retrieved',
      sourceModule: 'BroadcastSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to retrieve broadcasts: ${error.message}`
    });
    
    throw error;
  }
});

// Mark broadcast as read
export const markBroadcastRead = functions.https.onCall({
  maxInstances: 5,
  timeoutSeconds: 30
}, async (request) => {
  const { conversationId, userId } = request.data;
  const start = Date.now();
  
  try {
    if (!conversationId || !userId) {
      throw new Error('conversationId and userId are required');
    }
    
    const conversationRef = db.collection('broadcast_conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    
    if (!conversationDoc.exists) {
      throw new Error('Broadcast conversation not found');
    }
    
    const conversationData = conversationDoc.data();
    if (!conversationData) {
      throw new Error('Broadcast conversation data is undefined');
    }
    if (conversationData.workerId !== userId) {
      throw new Error('Unauthorized access to broadcast conversation');
    }
    
    const updateData = {
      status: 'read',
      readAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await conversationRef.update(updateData);
    
    // Update broadcast read count
    if (!conversationData.broadcastId) {
      throw new Error('Broadcast ID is missing in conversation data');
    }
    const broadcastRef = db.collection('broadcasts').doc(conversationData.broadcastId);
    await broadcastRef.update({
      readCount: admin.firestore.FieldValue.increment(1)
    });
    
    await logAIAction({
      userId,
      actionType: 'broadcast_marked_read',
      sourceModule: 'BroadcastSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Marked broadcast ${conversationId} as read`,
      eventType: 'broadcast.read',
      targetType: 'broadcast',
      targetId: conversationData.broadcastId,
      aiRelevant: true,
      contextType: 'broadcast',
      traitsAffected: null,
      aiTags: ['broadcast', 'read'],
      urgencyScore: 2
    });
    
    return { success: true };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'broadcast_marked_read',
      sourceModule: 'BroadcastSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to mark broadcast as read: ${error.message}`
    });
    
    throw error;
  }
});

// Reply to broadcast
export const replyToBroadcast = functions.https.onCall({
  maxInstances: 5,
  timeoutSeconds: 60
}, async (request) => {
  const { conversationId, userId, message, language = 'en' } = request.data;
  const start = Date.now();
  
  try {
    if (!conversationId || !userId || !message) {
      throw new Error('conversationId, userId, and message are required');
    }
    
    const conversationRef = db.collection('broadcast_conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    
    if (!conversationDoc.exists) {
      throw new Error('Broadcast conversation not found');
    }
    
    const conversationData = conversationDoc.data();
    if (!conversationData) {
      throw new Error('Broadcast conversation data is undefined');
    }
    if (conversationData.workerId !== userId) {
      throw new Error('Unauthorized access to broadcast conversation');
    }
    
    // Create reply message
    const replyMessage: any = {
      id: Date.now().toString(),
      sender: 'user',
      content: {
        [language]: message
      },
      originalLanguage: language,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'broadcast_reply',
      metadata: {
        confidence: 1.0,
        sentiment: 0.5,
        escalated: false
      }
    };
    
    // Translate message if needed
    if (language === 'en') {
      try {
        const translation = await translateContent({
          content: message,
          targetLanguage: 'es',
          sourceLanguage: 'en'
        });
        (replyMessage.content as Record<string, string>)['es'] = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate reply:', error.message);
        (replyMessage.content as Record<string, string>)['es'] = message; // Fallback to original
      }
    } else if (language === 'es') {
      try {
        const translation = await translateContent({
          content: message,
          targetLanguage: 'en',
          sourceLanguage: 'es'
        });
        (replyMessage.content as Record<string, string>)['en'] = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate reply:', error.message);
        (replyMessage.content as Record<string, string>)['en'] = message; // Fallback to original
      }
    }
    
    // Update conversation with reply
    await conversationRef.update({
      status: 'replied',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastReply: replyMessage
    });
    
    // Update broadcast reply count
    if (!conversationData.broadcastId) {
      throw new Error('Broadcast ID is missing in conversation data');
    }
    const broadcastRef = db.collection('broadcasts').doc(conversationData.broadcastId);
    await broadcastRef.update({
      replyCount: admin.firestore.FieldValue.increment(1)
    });
    
    await logAIAction({
      userId,
      actionType: 'broadcast_replied',
      sourceModule: 'BroadcastSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `User replied to broadcast ${conversationId}`,
      eventType: 'broadcast.replied',
      targetType: 'broadcast',
      targetId: conversationData.broadcastId,
      aiRelevant: true,
      contextType: 'broadcast',
      traitsAffected: null,
      aiTags: ['broadcast', 'reply', 'user'],
      urgencyScore: 4
    });
    
    return {
      success: true,
      replyId: replyMessage.id,
      message: replyMessage.content[language]
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'broadcast_replied',
      sourceModule: 'BroadcastSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to reply to broadcast: ${error.message}`
    });
    
    throw error;
  }
});

// Real-time Chat Features
export const sendChatMessage = functions.https.onCall(async (request) => {
  const { userId, message, language = 'en', messageType = 'chat' } = request.data;
  const start = Date.now();
  
  try {
    if (!userId || !message) {
      throw new Error('userId and message are required');
    }
    
    // Get or create primary conversation
    const conversationRef = await getOrCreatePrimaryConversation(userId);
    
    // Create user message
    const userMessage: {
      id: string;
      sender: string;
      content: BilingualContent;
      originalLanguage: string;
      timestamp: FirebaseFirestore.FieldValue;
      messageType: string;
      metadata: Record<string, any>;
    } = {
      id: Date.now().toString(),
      sender: 'user',
      content: { en: '', es: '', [language]: message },
      originalLanguage: language,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType,
      metadata: {
        confidence: 1.0,
        sentiment: 0.5,
        escalated: false
      }
    };
    if (language === 'en') {
      try {
        const translation = await translateContent({
          content: message,
          targetLanguage: 'es',
          sourceLanguage: 'en'
        });
        userMessage.content.en = message;
        userMessage.content.es = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate user message:', error.message);
        userMessage.content.en = message;
        userMessage.content.es = message;
      }
    } else if (language === 'es') {
      try {
        const translation = await translateContent({
          content: message,
          targetLanguage: 'en',
          sourceLanguage: 'es'
        });
        userMessage.content.es = message;
        userMessage.content.en = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate user message:', error.message);
        userMessage.content.es = message;
        userMessage.content.en = message;
      }
    }
    
    // Add message to conversation
    await conversationRef.update({
      messages: admin.firestore.FieldValue.arrayUnion(userMessage),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Generate AI response
    const aiResponse = await generateAIResponseForChat(userId, message, language);
    
    // Add AI response to conversation
    await conversationRef.update({
      messages: admin.firestore.FieldValue.arrayUnion(aiResponse),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAIAction({
      userId,
      actionType: 'chat_message_sent',
      sourceModule: 'ChatSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `User sent chat message and received AI response`,
      eventType: 'chat.message-sent',
      targetType: 'conversation',
      targetId: conversationRef.id,
      aiRelevant: true,
      contextType: 'chat',
      traitsAffected: null,
      aiTags: ['chat', 'message', 'ai-response'],
      urgencyScore: 3
    });
    
    return {
      success: true,
      userMessageId: userMessage.id,
      aiResponseId: aiResponse.id,
      aiResponse: aiResponse.content[language]
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'chat_message_sent',
      sourceModule: 'ChatSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to send chat message: ${error.message}`
    });
    
    throw error;
  }
});

// Get chat history
export const getChatHistory = functions.https.onCall(async (request) => {
  const { userId, limit = 50, beforeTimestamp } = request.data;
  const start = Date.now();
  
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get primary conversation
    const conversationQuery = db.collection('conversations')
      .where('workerId', '==', userId)
      .where('type', '==', 'primary')
      .limit(1);
    
    const conversationSnapshot = await conversationQuery.get();
    
    if (conversationSnapshot.empty) {
      return {
        success: true,
        messages: [],
        hasMore: false
      };
    }
    
    const conversationData = conversationSnapshot.docs[0].data();
    let messages = conversationData.messages || [];
    
    // Filter messages by timestamp if provided
    if (beforeTimestamp) {
      const beforeDate = new Date(beforeTimestamp);
      messages = messages.filter((msg: any) => 
        msg.timestamp && msg.timestamp.toDate() < beforeDate
      );
    }
    
    // Sort messages by timestamp (newest first)
    messages.sort((a: any, b: any) => {
      const aTime = a.timestamp?.toDate() || new Date(0);
      const bTime = b.timestamp?.toDate() || new Date(0);
      return bTime.getTime() - aTime.getTime();
    });
    
    // Limit messages
    const limitedMessages = messages.slice(0, limit);
    
    // Convert timestamps to ISO strings for JSON serialization
    const serializedMessages = limitedMessages.map((msg: any) => ({
      ...msg,
      timestamp: msg.timestamp?.toDate().toISOString()
    }));
    
    await logAIAction({
      userId,
      actionType: 'chat_history_retrieved',
      sourceModule: 'ChatSystem',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Retrieved ${serializedMessages.length} chat messages`,
      eventType: 'chat.history-retrieved',
      targetType: 'conversation',
      targetId: conversationSnapshot.docs[0].id,
      aiRelevant: true,
      contextType: 'chat',
      traitsAffected: null,
      aiTags: ['chat', 'history'],
      urgencyScore: 2
    });
    
    return {
      success: true,
      messages: serializedMessages,
      hasMore: messages.length > limit
    };
  } catch (error: any) {
    await logAIAction({
      userId: request.auth?.uid || 'system',
      actionType: 'chat_history_retrieved',
      sourceModule: 'ChatSystem',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v2',
      reason: `Failed to retrieve chat history: ${error.message}`
    });
    
    throw error;
  }
});

// Helper function to get users by filters
async function getUsersByFilters(filters: any): Promise<any[]> {
  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db.collection('users');
  
  if (filters.customerId) {
    query = query.where('customerId', '==', filters.customerId);
  }
  
  if (filters.agencyId) {
    query = query.where('agencyId', '==', filters.agencyId);
  }
  
  if (filters.department) {
    query = query.where('department', '==', filters.department);
  }
  
  if (filters.location) {
    query = query.where('location', '==', filters.location);
  }
  
  if (filters.role) {
    query = query.where('role', '==', filters.role);
  }
  
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Helper function to generate AI response for chat
async function generateAIResponseForChat(userId: string, userMessage: string, language: string) {
  try {
    // Get user context
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    // Get customer context if available
    let customerContext = null;
    if (userData?.customerId) {
      const customerDoc = await db.collection('customers').doc(userData.customerId).get();
      customerContext = customerDoc.data();
    }
    
    // Generate AI response using existing AI chat system
    const aiResponse = await generateAIResponse(userMessage, {
      language,
      customerId: userData?.customerId,
      context: customerContext
    }, userData?.customerId || 'default');
    
    // Create AI message
    const aiMessage = {
      id: Date.now().toString(),
      sender: 'ai',
      content: {
        [language]: aiResponse.response
      },
      originalLanguage: language,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'chat',
      metadata: {
        confidence: aiResponse.confidence || 0.8,
        sentiment: aiResponse.sentiment || 0.5,
        escalated: aiResponse.escalated || false
      }
    };
    
    // Translate AI response if needed
    if (language === 'en') {
      try {
        const translation = await translateContent({
          content: aiResponse.response,
          targetLanguage: 'es',
          sourceLanguage: 'en'
        });
        aiMessage.content.es = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate AI response:', error.message);
        aiMessage.content.es = aiResponse.response;
      }
    } else if (language === 'es') {
      try {
        const translation = await translateContent({
          content: aiResponse.response,
          targetLanguage: 'en',
          sourceLanguage: 'es'
        });
        aiMessage.content.en = translation.translatedContent;
      } catch (error: any) {
        console.warn('Failed to translate AI response:', error.message);
        aiMessage.content.en = aiResponse.response;
      }
    }
    
    return aiMessage;
  } catch (error: any) {
    console.error('Error generating AI response:', error);
    
    // Fallback response
    return {
      id: Date.now().toString(),
      sender: 'ai',
      content: {
        en: 'Sorry, I couldn\'t process your message right now. Can you try again?',
        es: 'Lo siento, no pude procesar tu mensaje en este momento. ¿Puedes intentar de nuevo?'
      },
      originalLanguage: language,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'chat',
      metadata: {
        confidence: 0.5,
        sentiment: 0.3,
        escalated: false
      }
    };
  }
}

// Helper function to get or create primary conversation
async function getOrCreatePrimaryConversation(userId: string) {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  // Try to find existing primary conversation
  const existingConversationQuery = db.collection('conversations')
    .where('workerId', '==', userId)
    .where('type', '==', 'primary')
    .limit(1);
  
  const existingConversationSnapshot = await existingConversationQuery.get();
  
  if (!existingConversationSnapshot.empty) {
    return existingConversationSnapshot.docs[0].ref;
  }
  
  // Create new primary conversation
  const newConversation = {
    workerId: userId,
    customerId: userData?.customerId || null,
    agencyId: userData?.agencyId || null,
    type: 'primary',
    status: 'active',
    messages: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  const conversationRef = await db.collection('conversations').add(newConversation);
  return conversationRef;
}

// Import required functions from main index.ts
// These will need to be imported or redefined
async function translateContent(params: any) {
  // This should be imported from the main index.ts
  // For now, we'll create a placeholder
  return { translatedContent: params.content };
}

async function logAIAction(params: any) {
  // This should be imported from the main index.ts
  // For now, we'll create a placeholder
  console.log('AI Action logged:', params);
}

async function generateAIResponse(message: string, settings: any, customerId: string) {
  // This should be imported from the main index.ts
  // For now, we'll create a placeholder
  return {
    response: `AI response to: ${message}`,
    confidence: 0.8,
    sentiment: 0.5,
    escalated: false
  };
} 