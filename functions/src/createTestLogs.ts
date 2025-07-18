import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Generate test AI logs for analytics
async function createTestLogs() {
  const testLogs = [
    {
      eventType: 'ai_chat_message',
      targetType: 'conversation',
      targetId: 'test-conv-1',
      aiRelevant: true,
      contextType: 'user_query',
      traitsAffected: ['communication', 'responsiveness'],
      aiTags: ['chat', 'support'],
      urgencyScore: 5,
      success: true,
      latencyMs: 1200,
      engineTouched: ['FeedbackEngine', 'ToneEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1300)),
      processingCompletedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      userId: 'test-user-1',
      customerId: 'test-customer-1',
      action: 'Processed chat message',
      details: 'User asked about shift scheduling'
    },
    {
      eventType: 'ai_broadcast_sent',
      targetType: 'broadcast',
      targetId: 'test-broadcast-1',
      aiRelevant: true,
      contextType: 'announcement',
      traitsAffected: ['communication'],
      aiTags: ['broadcast', 'notification'],
      urgencyScore: 7,
      success: true,
      latencyMs: 800,
      engineTouched: ['MomentsEngine', 'ToneEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 900)),
      processingCompletedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      userId: 'test-user-2',
      customerId: 'test-customer-1',
      action: 'Sent AI-powered broadcast',
      details: 'Emergency shift change notification'
    },
    {
      eventType: 'ai_feedback_processed',
      targetType: 'feedback',
      targetId: 'test-feedback-1',
      aiRelevant: true,
      contextType: 'worker_feedback',
      traitsAffected: ['satisfaction', 'engagement'],
      aiTags: ['feedback', 'sentiment'],
      urgencyScore: 3,
      success: true,
      latencyMs: 1500,
      engineTouched: ['FeedbackEngine', 'AnalyticsEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1600)),
      processingCompletedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      userId: 'test-user-3',
      customerId: 'test-customer-2',
      action: 'Processed worker feedback',
      details: 'Positive feedback about work environment'
    },
    {
      eventType: 'ai_context_assembled',
      targetType: 'context',
      targetId: 'test-context-1',
      aiRelevant: true,
      contextType: 'worker_profile',
      traitsAffected: ['personalization'],
      aiTags: ['context', 'profile'],
      urgencyScore: 4,
      success: true,
      latencyMs: 2000,
      engineTouched: ['ContextEngine', 'VectorEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 2100)),
      processingCompletedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      userId: 'test-user-1',
      customerId: 'test-customer-1',
      action: 'Assembled worker context',
      details: 'Built comprehensive worker profile for AI processing'
    },
    {
      eventType: 'ai_error_occurred',
      targetType: 'error',
      targetId: 'test-error-1',
      aiRelevant: true,
      contextType: 'system_error',
      traitsAffected: ['reliability'],
      aiTags: ['error', 'system'],
      urgencyScore: 9,
      success: false,
      latencyMs: 5000,
      engineTouched: ['ErrorEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5100)),
      processingCompletedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 100)),
      userId: 'test-user-4',
      customerId: 'test-customer-1',
      action: 'AI processing failed',
      details: 'Timeout error during context assembly',
      errorMessage: 'Processing timeout after 5 seconds'
    }
  ];

  console.log('Creating test AI logs...');
  
  for (const log of testLogs) {
    try {
      await db.collection('ai_logs').add(log);
      console.log(`Created log: ${log.eventType}`);
    } catch (error) {
      console.error(`Failed to create log ${log.eventType}:`, error);
    }
  }
  
  console.log('Test logs created successfully!');
}

// Run the function
createTestLogs()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  }); 