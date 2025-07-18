const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxJjJjJjJjJjJjJjJjJjJjJjJjJjJjJj",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Test log data
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
    userId: 'test-user-4',
    customerId: 'test-customer-1',
    action: 'AI processing failed',
    details: 'Timeout error during context assembly',
    errorMessage: 'Processing timeout after 5 seconds'
  }
];

async function createTestLogs() {
  const createTestLog = httpsCallable(functions, 'createTestLog');
  
  console.log('Creating test AI logs...');
  
  for (const log of testLogs) {
    try {
      const result = await createTestLog({ 
        eventType: log.eventType, 
        userId: log.userId, 
        customData: log 
      });
      console.log(`Created log: ${log.eventType}`, result.data);
    } catch (error) {
      console.error(`Failed to create log ${log.eventType}:`, error);
    }
  }
  
  console.log('Test logs creation completed!');
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