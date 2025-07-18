# Mobile App Chat System Implementation Plan

## Current State Analysis

✅ **What's Already Working:**
- Firebase authentication with login logging via `firestoreLogUserCreated` trigger
- Conversation structure in `/conversations` collection
- Broadcast system with `/broadcasts` and `/broadcast_notifications` collections
- AI chat functionality with escalation and sentiment analysis
- Basic translation support (language options in settings)

## Data Structure & Architecture Plan

### 1. **Login Detection & Hello Messages**

#### A. Login Trigger System
```typescript
// Enhanced user login tracking
/users/{userId}
{
  // ... existing fields
  lastLoginAt: Timestamp,
  loginCount: number,
  preferredLanguage: 'en' | 'es',
  helloMessageSettings: {
    enabled: boolean,
    frequency: 'always' | 'daily' | 'weekly',
    lastHelloSent: Timestamp
  }
}
```

#### B. Hello Message Configuration
```typescript
/appAiSettings/helloMessages
{
  templates: {
    en: [
      "Hi {firstName}. How's work going so far today?",
      "Good morning {firstName}! Ready for another great day?",
      "Hey {firstName}, how are you feeling about your shift today?"
    ],
    es: [
      "¡Hola {firstName}! ¿Cómo va el trabajo hoy?",
      "¡Buenos días {firstName}! ¿Listo para otro gran día?",
      "Hola {firstName}, ¿cómo te sientes con tu turno hoy?"
    ]
  },
  triggers: {
    onLogin: boolean,
    dailyCheckin: boolean,
    weeklyCheckin: boolean
  }
}
```

### 2. **Enhanced Chat Structure**

#### A. Primary Chat Thread (Continuous)
```typescript
/conversations/{conversationId}
{
  workerId: string,
  customerId: string,
  type: 'primary' | 'broadcast',
  status: 'active' | 'archived',
  messages: [
    {
      id: string,
      sender: 'worker' | 'ai' | 'system',
      content: {
        en: string,
        es: string
        
      },
      originalLanguage: 'en' | 'es',
      timestamp: Timestamp,
      messageType: 'text' | 'hello' | 'question' | 'response',
      metadata: {
        confidence?: number,
        sentiment?: number,
        escalated?: boolean
      }
    }
  ],
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastActivityAt: Timestamp
}
```

#### B. Broadcast Messages (Separate Thread)
```typescript
/broadcast_conversations/{broadcastId}
{
  broadcastId: string,
  workerId: string,
  customerId: string,
  type: 'broadcast',
  originalBroadcast: {
    message: {
      en: string,
      es: string
    },
    senderId: string,
    sentAt: Timestamp
  },
  messages: [
    {
      id: string,
      sender: 'worker' | 'ai' | 'admin',
      content: {
        en: string,
        es: string
      },
      originalLanguage: 'en' | 'es',
      timestamp: Timestamp,
      messageType: 'broadcast' | 'reply' | 'ai_response'
    }
  ],
  status: 'unread' | 'read' | 'replied',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 3. **Translation System**

#### A. Translation Service
```typescript
// Cloud Function: translateContent
export const translateContent = onCall(async (request) => {
  const { content, targetLanguage, sourceLanguage = 'en' } = request.data;
  
  try {
    // Use OpenAI for translation
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following text to ${targetLanguage}. Maintain the original tone and context.`
        },
        {
          role: "user",
          content: content
        }
      ]
    });
    
    return { 
      translatedContent: completion.choices[0].message.content,
      confidence: 0.95
    };
  } catch (error) {
    throw new Error('Translation failed');
  }
});
```

#### B. Translation Triggers
```typescript
// Firestore trigger for new content
export const autoTranslateContent = onDocumentCreated('conversations/{conversationId}', async (event) => {
  const conversationData = event.data?.data();
  if (!conversationData) return;
  
  const lastMessage = conversationData.messages[conversationData.messages.length - 1];
  if (lastMessage && !lastMessage.content.es) {
    // Auto-translate to Spanish
    const translation = await translateContent({
      content: lastMessage.content.en,
      targetLanguage: 'es'
    });
    
    await event.data.ref.update({
      [`messages.${conversationData.messages.length - 1}.content.es`]: translation.translatedContent
    });
  }
});
```

### 4. **Mobile App API Endpoints**

#### A. Get User Chat Data
```typescript
// Cloud Function: getMobileChatData
export const getMobileChatData = onCall(async (request) => {
  const { userId, language = 'en' } = request.data;
  
  try {
    // Get primary conversation
    const primaryConversation = await db.collection('conversations')
      .where('workerId', '==', userId)
      .where('type', '==', 'primary')
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    
    // Get unread broadcasts
    const broadcastConversations = await db.collection('broadcast_conversations')
      .where('workerId', '==', userId)
      .where('status', '==', 'unread')
      .orderBy('createdAt', 'desc')
      .get();
    
    return {
      primaryChat: primaryConversation.docs[0]?.data() || null,
      broadcastCount: broadcastConversations.docs.length,
      broadcasts: broadcastConversations.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    };
  } catch (error) {
    throw error;
  }
});
```

#### B. Send Message
```typescript
// Cloud Function: sendMobileMessage
export const sendMobileMessage = onCall(async (request) => {
  const { userId, message, conversationType = 'primary', broadcastId } = request.data;
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userLanguage = userData?.preferredLanguage || 'en';
    
    // Create message object with translation
    const messageObj = {
      id: Date.now().toString(),
      sender: 'worker',
      content: {
        [userLanguage]: message
      },
      originalLanguage: userLanguage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      messageType: 'text'
    };
    
    // Auto-translate if needed
    if (userLanguage === 'en') {
      const translation = await translateContent({
        content: message,
        targetLanguage: 'es'
      });
      messageObj.content.es = translation.translatedContent;
    } else {
      const translation = await translateContent({
        content: message,
        targetLanguage: 'en'
      });
      messageObj.content.en = translation.translatedContent;
    }
    
    // Add to appropriate conversation
    if (conversationType === 'primary') {
      await db.collection('conversations').doc(conversationId).update({
        messages: admin.firestore.FieldValue.arrayUnion(messageObj),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('broadcast_conversations').doc(broadcastId).update({
        messages: admin.firestore.FieldValue.arrayUnion(messageObj),
        status: 'replied',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    return { success: true, messageId: messageObj.id };
  } catch (error) {
    throw error;
  }
});
```

### 5. **Hello Message Trigger System**

#### A. Login Detection
```typescript
// Enhanced login trigger
export const triggerHelloMessage = onDocumentUpdated('users/{userId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  
  if (!beforeData || !afterData) return;
  
  // Check if this is a login event
  const lastLoginBefore = beforeData.lastLoginAt?.toDate();
  const lastLoginAfter = afterData.lastLoginAt?.toDate();
  
  if (lastLoginAfter && (!lastLoginBefore || lastLoginAfter > lastLoginBefore)) {
    // User just logged in - check if we should send hello message
    const helloSettings = await db.collection('appAiSettings').doc('helloMessages').get();
    const settings = helloSettings.data();
    
    if (settings?.triggers?.onLogin) {
      await sendHelloMessage(afterData.uid, afterData.preferredLanguage || 'en');
    }
  }
});
```

#### B. Hello Message Sender
```typescript
async function sendHelloMessage(userId: string, language: 'en' | 'es') {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  const helloSettings = await db.collection('appAiSettings').doc('helloMessages').get();
  const settings = helloSettings.data();
  
  // Select random template
  const templates = settings?.templates?.[language] || settings?.templates?.en;
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  // Replace placeholders
  const message = template.replace('{firstName}', userData?.firstName || 'there');
  
  // Create hello message
  const helloMessage = {
    id: Date.now().toString(),
    sender: 'ai',
    content: {
      [language]: message
    },
    originalLanguage: language,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    messageType: 'hello'
  };
  
  // Add to primary conversation
  const conversationRef = await getOrCreatePrimaryConversation(userId);
  await conversationRef.update({
    messages: admin.firestore.FieldValue.arrayUnion(helloMessage),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Update user's hello message tracking
  await db.collection('users').doc(userId).update({
    'helloMessageSettings.lastHelloSent': admin.firestore.FieldValue.serverTimestamp()
  });
}
```

## Implementation Steps

### Phase 1: Backend Infrastructure (Week 1)
1. **Create translation service** with OpenAI integration
2. **Enhance user login tracking** with hello message settings
3. **Implement hello message configuration** in admin panel
4. **Create mobile API endpoints** for chat data retrieval

### Phase 2: Data Structure Migration (Week 2)
1. **Update conversation schema** to support bilingual content
2. **Create broadcast conversation structure**
3. **Implement auto-translation triggers**
4. **Add hello message trigger system**

### Phase 3: Admin Configuration (Week 3)
1. **Build hello message management UI** in admin panel
2. **Create translation management interface**
3. **Add language preference settings** for users
4. **Implement broadcast management** for mobile

### Phase 4: Mobile App Integration (Week 4)
1. **Flutter app chat interface** with primary/broadcast separation
2. **Real-time message synchronization**
3. **Language preference handling**
4. **Push notification integration**

## Scalability Considerations

### 1. **Performance Optimizations**
- **Message pagination** for long conversations
- **Indexed queries** for efficient message retrieval
- **Caching layer** for frequently accessed data
- **Batch operations** for translation processing

### 2. **Cost Management**
- **Translation caching** to avoid repeated API calls
- **Message archiving** for old conversations
- **Selective translation** based on user preferences
- **Rate limiting** for translation requests

### 3. **Data Consistency**
- **Atomic operations** for message updates
- **Conflict resolution** for concurrent edits
- **Backup strategies** for critical conversations
- **Audit trails** for message history

## Security & Privacy

### 1. **Data Protection**
- **End-to-end encryption** for sensitive messages
- **Role-based access** to conversation data
- **Data retention policies** for message cleanup
- **GDPR compliance** for user data handling

### 2. **Access Control**
- **User authentication** for all chat operations
- **Organization isolation** for multi-tenant setup
- **Admin oversight** for escalated conversations
- **Audit logging** for all chat activities

## Firestore Indexes Required

```json
{
  "indexes": [
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "workerId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "updatedAt",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "broadcast_conversations",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "workerId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "preferredLanguage",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "lastLoginAt",
          "order": "DESCENDING"
        }
      ]
    }
  ]
}
```

## Cloud Functions to Deploy

### New Functions
1. `translateContent` - OpenAI-powered translation service
2. `getMobileChatData` - Retrieve chat data for mobile app
3. `sendMobileMessage` - Send messages from mobile app
4. `triggerHelloMessage` - Login-triggered hello messages
5. `sendHelloMessage` - Send personalized hello messages
6. `autoTranslateContent` - Auto-translate new content
7. `getOrCreatePrimaryConversation` - Conversation management

### Enhanced Functions
1. `firestoreLogUserUpdated` - Enhanced with login tracking
2. `createAIChatConversation` - Updated for bilingual support
3. `sendAIChatMessage` - Updated for translation
4. `createBroadcast` - Updated for mobile broadcast threads

## Testing Strategy

### 1. **Unit Tests**
- Translation service accuracy
- Hello message template processing
- Message structure validation
- API endpoint functionality

### 2. **Integration Tests**
- End-to-end message flow
- Translation trigger system
- Login detection accuracy
- Broadcast thread separation

### 3. **Performance Tests**
- Message retrieval speed
- Translation API response times
- Concurrent user handling
- Database query optimization

### 4. **User Acceptance Tests**
- Mobile app chat interface
- Language switching functionality
- Hello message timing
- Broadcast notification handling

## Monitoring & Analytics

### 1. **Key Metrics**
- Message translation success rate
- Hello message engagement
- Broadcast read rates
- API response times
- Translation API costs

### 2. **Alerts**
- Translation service failures
- High API usage spikes
- Message delivery failures
- Database performance issues

### 3. **Dashboards**
- Real-time chat activity
- Language usage statistics
- User engagement metrics
- System health monitoring

## Future Enhancements

### 1. **Advanced Features**
- Voice message support
- Image sharing capabilities
- Message reactions/emojis
- Typing indicators
- Message search functionality

### 2. **AI Enhancements**
- Sentiment-based responses
- Contextual conversation memory
- Personalized message suggestions
- Automated follow-up scheduling

### 3. **Integration Opportunities**
- Slack/Teams integration
- Email notification system
- SMS fallback for urgent messages
- Calendar integration for scheduling

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Next Review:** February 2025 