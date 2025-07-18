import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
// import { logAIAction } from './feedbackEngine';
import { reprocessLog } from './aiEngineProcessor';

const db = admin.firestore();

// Test Harness for AI Log System
export const runAILogTests = onCall(async (request) => {
  const { testType, userId } = request.data;
  
  try {
    switch (testType) {
      case 'all':
        return await runAllTests(userId);
      case 'schema':
        return await testLogSchema(userId);
      case 'engines':
        return await testEngineProcessing(userId);
      case 'performance':
        return await testPerformance(userId);
      case 'error':
        return await testErrorHandling(userId);
      default:
        throw new Error(`Unknown test type: ${testType}`);
    }
  } catch (error) {
    console.error('Test harness error:', error);
    throw error;
  }
});

// Run all tests
async function runAllTests(userId: string) {
  const results = {
    schema: await testLogSchema(userId),
    engines: await testEngineProcessing(userId),
    performance: await testPerformance(userId),
    error: await testErrorHandling(userId)
  };
  
  return {
    success: true,
    message: 'All tests completed',
    results
  };
}

// Test 1: Log Schema Completeness
async function testLogSchema(userId: string) {
  const testLogs = [];
  const eventTypes = [
    'feedback.campaign.created',
    'feedback.response.submitted',
    'feedback.analysis.completed',
    'moment.triggered',
    'moment.skipped',
    'moment.error',
    'tone.customer.set',
    'tone.customer.reset',
    'traits.updated',
    'traits.analyzed',
    'weights.applied',
    'weights.optimized',
    'vector.indexed',
    'vector.searched',
    'context.assembled',
    'context.failed',
    'priority.escalated',
    'training.analysis',
    'retrieval.filter.created',
    'prompt.template.created'
  ];

  for (const eventType of eventTypes) {
    const logData = generateTestLogData(eventType, userId);
    const logRef = await db.collection('ai_logs').add(logData);
    testLogs.push({ eventType, logId: logRef.id, data: logData });
  }

  // Verify schema completeness
  const verificationResults = [];
  for (const testLog of testLogs) {
    const verification = await verifyLogSchema(testLog.logId);
    verificationResults.push({
      eventType: testLog.eventType,
      logId: testLog.logId,
      schemaComplete: verification.schemaComplete,
      missingFields: verification.missingFields
    });
  }

  return {
    testType: 'schema',
    logsCreated: testLogs.length,
    verificationResults,
    success: verificationResults.every(r => r.schemaComplete)
  };
}

// Test 2: Engine Processing
async function testEngineProcessing(userId: string) {
  const testLogs = [];
  const engineTests = [
    {
      eventType: 'feedback.campaign.created',
      expectedEngines: ['ContextEngine', 'FeedbackEngine'],
      contextType: 'feedback'
    },
    {
      eventType: 'moment.triggered',
      expectedEngines: ['ContextEngine', 'MomentsEngine'],
      contextType: 'moment'
    },
    {
      eventType: 'tone.customer.set',
      expectedEngines: ['ContextEngine', 'ToneEngine'],
      contextType: 'tone'
    },
    {
      eventType: 'traits.updated',
      expectedEngines: ['ContextEngine', 'TraitsEngine'],
      contextType: 'traits'
    },
    {
      eventType: 'weights.applied',
      expectedEngines: ['ContextEngine', 'WeightsEngine'],
      contextType: 'weights'
    },
    {
      eventType: 'vector.indexed',
      expectedEngines: ['ContextEngine', 'VectorEngine'],
      contextType: 'vector'
    },
    {
      eventType: 'priority.escalated',
      expectedEngines: ['ContextEngine', 'PriorityEngine'],
      urgencyScore: 9
    }
  ];

  for (const test of engineTests) {
    const logData = generateTestLogData(test.eventType, userId, test);
    const logRef = await db.collection('ai_logs').add(logData);
    testLogs.push({ ...test, logId: logRef.id, data: logData });
  }

  // Wait for processing to complete
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Verify engine processing
  const processingResults = [];
  for (const testLog of testLogs) {
    const processing = await verifyEngineProcessing(testLog.logId, testLog.expectedEngines);
    processingResults.push({
      eventType: testLog.eventType,
      logId: testLog.logId,
      enginesExpected: testLog.expectedEngines,
      enginesProcessed: processing.enginesProcessed,
      processingSuccess: processing.success,
      errors: processing.errors
    });
  }

  return {
    testType: 'engines',
    logsCreated: testLogs.length,
    processingResults,
    success: processingResults.every(r => r.processingSuccess)
  };
}

// Test 3: Performance Testing
async function testPerformance(userId: string) {
  const performanceTests = [];
  const batchSize = 10;
  
  // Create batch of logs
  for (let i = 0; i < batchSize; i++) {
    const logData = generateTestLogData('performance.test', userId, {
      latencyMs: Math.floor(Math.random() * 2000) + 100,
      urgencyScore: Math.floor(Math.random() * 10) + 1
    });
    
    const startTime = Date.now();
    const logRef = await db.collection('ai_logs').add(logData);
    const writeTime = Date.now() - startTime;
    
    performanceTests.push({
      logId: logRef.id,
      writeTime,
      data: logData
    });
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Measure processing times
  const processingTimes = [];
  for (const test of performanceTests) {
    const logDoc = await db.collection('ai_logs').doc(test.logId).get();
    const logData = logDoc.data();
    
    if (logData?.processingStartedAt && logData?.processingCompletedAt) {
      const processingTime = logData.processingCompletedAt.toDate().getTime() - 
                           logData.processingStartedAt.toDate().getTime();
      processingTimes.push(processingTime);
    }
  }

  const avgWriteTime = performanceTests.reduce((sum, t) => sum + t.writeTime, 0) / performanceTests.length;
  const avgProcessingTime = processingTimes.reduce((sum, t) => sum + t, 0) / processingTimes.length;

  return {
    testType: 'performance',
    logsCreated: performanceTests.length,
    avgWriteTime,
    avgProcessingTime,
    processingTimes,
    success: avgProcessingTime < 5000 // 5 second threshold
  };
}

// Test 4: Error Handling
async function testErrorHandling(userId: string) {
  const errorTests = [];
  
  // Test 1: Invalid event type
  const invalidEventLog = generateTestLogData('invalid.event.type', userId);
  const invalidRef = await db.collection('ai_logs').add(invalidEventLog);
  errorTests.push({ type: 'invalid_event', logId: invalidRef.id });

  // Test 2: Missing required fields
  const incompleteLog = {
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    userId,
    actionType: 'incomplete_test',
    sourceModule: 'TestHarness',
    success: false,
    errorMessage: 'Missing required fields'
  };
  const incompleteRef = await db.collection('ai_logs').add(incompleteLog);
  errorTests.push({ type: 'incomplete_fields', logId: incompleteRef.id });

  // Test 3: High urgency error
  const highUrgencyLog = generateTestLogData('error.high_urgency', userId, {
    urgencyScore: 10,
    success: false,
    errorMessage: 'Critical system error'
  });
  const highUrgencyRef = await db.collection('ai_logs').add(highUrgencyLog);
  errorTests.push({ type: 'high_urgency_error', logId: highUrgencyRef.id });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify error handling
  const errorResults = [];
  for (const test of errorTests) {
    const logDoc = await db.collection('ai_logs').doc(test.logId).get();
    const logData = logDoc.data();
    
    errorResults.push({
      type: test.type,
      logId: test.logId,
      processed: logData?.processed || false,
      errors: logData?.errors || [],
      engineTouched: logData?.engineTouched || [],
      success: logData?.processed === true // Should still be processed even with errors
    });
  }

  return {
    testType: 'error_handling',
    testsCreated: errorTests.length,
    errorResults,
    success: errorResults.every(r => r.processed)
  };
}

// Generate test log data with full schema
function generateTestLogData(eventType: string, userId: string, overrides: any = {}) {
  const baseData = {
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    userId,
    actionType: eventType.replace(/\./g, '_'),
    sourceModule: getModuleFromEventType(eventType),
    inputPrompt: `Test input for ${eventType}`,
    composedPrompt: `Test composed prompt for ${eventType}`,
    aiResponse: `Test AI response for ${eventType}`,
    success: true,
    errorMessage: null,
    latencyMs: Math.floor(Math.random() * 1000) + 100,
    versionTag: 'v1',
    scenarioContext: `test_scenario_${Math.floor(Math.random() * 1000)}`,
    customerId: `test_customer_${Math.floor(Math.random() * 1000)}`,
    tenantId: `test_tenant_${Math.floor(Math.random() * 1000)}`,
    globalContextUsed: { test: 'global_context' },
    scenarioContextUsed: { test: 'scenario_context' },
    customerContextUsed: { test: 'customer_context' },
    weightsApplied: { test: 'weights' },
    traitsActive: { test: 'traits' },
    vectorChunksUsed: ['test_chunk_1', 'test_chunk_2'],
    vectorSimilarityScores: [0.85, 0.72],
    dryRun: false,
    manualOverride: false,
    feedbackGiven: { test: 'feedback' },
    reason: `Test log for ${eventType}`,
    // New schema fields
    eventType,
    targetType: getTargetTypeFromEventType(eventType),
    targetId: `test_target_${Math.floor(Math.random() * 1000)}`,
    aiRelevant: true,
    contextType: overrides.contextType || getContextTypeFromEventType(eventType),
    traitsAffected: overrides.traitsAffected || null,
    aiTags: overrides.aiTags || ['test', 'automated'],
    urgencyScore: overrides.urgencyScore || Math.floor(Math.random() * 5) + 1
  };

  return { ...baseData, ...overrides };
}

// Helper functions
function getModuleFromEventType(eventType: string): string {
  if (eventType.startsWith('feedback.')) return 'FeedbackEngine';
  if (eventType.startsWith('moment.')) return 'MomentsEngine';
  if (eventType.startsWith('tone.')) return 'ToneEngine';
  if (eventType.startsWith('traits.')) return 'TraitsEngine';
  if (eventType.startsWith('weights.')) return 'WeightsEngine';
  if (eventType.startsWith('vector.')) return 'VectorEngine';
  if (eventType.startsWith('context.')) return 'ContextEngine';
  if (eventType.startsWith('priority.')) return 'PriorityEngine';
  if (eventType.startsWith('training.')) return 'TrainingEngine';
  if (eventType.startsWith('retrieval.')) return 'RetrievalEngine';
  if (eventType.startsWith('prompt.')) return 'PromptEngine';
  return 'TestHarness';
}

function getTargetTypeFromEventType(eventType: string): string {
  if (eventType.includes('campaign')) return 'campaign';
  if (eventType.includes('moment')) return 'moment';
  if (eventType.includes('customer')) return 'customer';
  if (eventType.includes('traits')) return 'traits';
  if (eventType.includes('weights')) return 'weights';
  if (eventType.includes('vector')) return 'vector';
  if (eventType.includes('context')) return 'context';
  if (eventType.includes('filter')) return 'filter';
  if (eventType.includes('template')) return 'template';
  return 'test';
}

function getContextTypeFromEventType(eventType: string): string {
  if (eventType.startsWith('feedback.')) return 'feedback';
  if (eventType.startsWith('moment.')) return 'moment';
  if (eventType.startsWith('tone.')) return 'tone';
  if (eventType.startsWith('traits.')) return 'traits';
  if (eventType.startsWith('weights.')) return 'weights';
  if (eventType.startsWith('vector.')) return 'vector';
  if (eventType.startsWith('context.')) return 'context';
  if (eventType.startsWith('priority.')) return 'priority';
  if (eventType.startsWith('training.')) return 'training';
  if (eventType.startsWith('retrieval.')) return 'retrieval';
  if (eventType.startsWith('prompt.')) return 'prompt';
  return 'test';
}

// Verify log schema completeness
async function verifyLogSchema(logId: string) {
  const logDoc = await db.collection('ai_logs').doc(logId).get();
  const logData = logDoc.data();
  
  const requiredFields = [
    'eventType', 'targetType', 'targetId', 'aiRelevant', 
    'contextType', 'traitsAffected', 'aiTags', 'urgencyScore'
  ];
  
  const missingFields = requiredFields.filter(field => 
    logData?.[field] === undefined || logData?.[field] === null
  );
  
  return {
    schemaComplete: missingFields.length === 0,
    missingFields
  };
}

// Verify engine processing
async function verifyEngineProcessing(logId: string, expectedEngines: string[]) {
  const logDoc = await db.collection('ai_logs').doc(logId).get();
  const logData = logDoc.data();
  
  const enginesProcessed = logData?.engineTouched || [];
  const processingResults = logData?.processingResults || [];
  const errors = logData?.errors || [];
  
  const success = logData?.processed === true && 
                 expectedEngines.every(engine => enginesProcessed.includes(engine));
  
  return {
    success,
    enginesProcessed,
    processingResults,
    errors
  };
}

// Manual test log creation
export const createTestLog = onCall(async (request) => {
  const { eventType, userId, customData } = request.data;
  
  try {
    const logData = generateTestLogData(eventType, userId, customData);
    const logRef = await db.collection('ai_logs').add(logData);
    
    return {
      success: true,
      logId: logRef.id,
      data: logData
    };
  } catch (error) {
    console.error('Error creating test log:', error);
    throw error;
  }
});

// Manual log reprocessing
export const reprocessTestLog = onCall(async (request) => {
  const { logId, engines } = request.data;
  
  try {
    const result = await reprocessLog(logId, engines);
    return result;
  } catch (error) {
    console.error('Error reprocessing log:', error);
    throw error;
  }
});

// Get test results
export const getTestResults = onCall(async (request) => {
  const { timeRange } = request.data;
  
  try {
    const query = db.collection('ai_logs')
      .where('sourceModule', '==', 'TestHarness');
    
    if (timeRange) {
      const cutoff = new Date(Date.now() - timeRange);
      query.where('timestamp', '>=', cutoff);
    }
    
    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return {
      success: true,
      logs,
      count: logs.length
    };
  } catch (error) {
    console.error('Error getting test results:', error);
    throw error;
  }
});

// Clean up test data
export const cleanupTestData = onCall(async (request) => {
  const { timeRange } = request.data;
  
  try {
    const query = db.collection('ai_logs')
      .where('sourceModule', '==', 'TestHarness');
    
    if (timeRange) {
      const cutoff = new Date(Date.now() - timeRange);
      query.where('timestamp', '>=', cutoff);
    }
    
    const snapshot = await query.get();
    const batch = db.batch();
    
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    return {
      success: true,
      deletedCount: snapshot.docs.length
    };
  } catch (error) {
    console.error('Error cleaning up test data:', error);
    throw error;
  }
}); 