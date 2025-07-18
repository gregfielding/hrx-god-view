import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

const db = admin.firestore();

// AI Engine Processor - Listens to ai_logs collection and routes to appropriate engines
export const processAILog = onDocumentCreated('ai_logs/{logId}', async (event) => {
  const logData = event.data?.data();
  const logId = event.params.logId;

  if (!logData) {
    console.error('No log data found for logId:', logId);
    return;
  }

  console.log('Processing AI log:', logId, 'Event type:', logData.eventType);

  const start = Date.now(); // Start time for latency

  try {
    // Update log status to processing
    await db.collection('ai_logs').doc(logId).update({
      processed: true,
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      engineTouched: []
    });

    const enginesToProcess = determineEnginesToProcess(logData);
    const processingResults = [];

    // Process through each relevant engine
    for (const engine of enginesToProcess) {
      try {
        const result = await processWithEngine(engine, logData, logId);
        processingResults.push({
          engine,
          success: true,
          result,
          processedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error processing with engine ${engine}:`, error);
        processingResults.push({
          engine,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date().toISOString()
        });
      }
    }

    const latencyMs = Date.now() - start;

    // Update log with processing results
    await db.collection('ai_logs').doc(logId).update({
      engineTouched: enginesToProcess,
      processingResults,
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      errors: processingResults.filter(r => !r.success).map(r => r.error),
      latencyMs
    });

    console.log(`Successfully processed log ${logId} through ${enginesToProcess.length} engines`);

  } catch (error) {
    console.error('Error processing AI log:', error);
    
    // Update log with error status
    await db.collection('ai_logs').doc(logId).update({
      processed: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      processingCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
});

// Determine which engines should process this log based on schema fields
function determineEnginesToProcess(logData: any): string[] {
  const engines: string[] = [];

  // Always process through Context Engine for AI-relevant logs
  if (logData.aiRelevant) {
    engines.push('ContextEngine');
  }

  // Route based on eventType
  if (logData.eventType) {
    if (logData.eventType.startsWith('feedback.')) {
      engines.push('FeedbackEngine');
    }
    if (logData.eventType.startsWith('moment.')) {
      engines.push('MomentsEngine');
    }
    if (logData.eventType.startsWith('campaign.')) {
      engines.push('CampaignsEngine');
    }
    if (logData.eventType.startsWith('tone.') || logData.eventType.includes('tone')) {
      engines.push('ToneEngine');
    }
    if (logData.eventType.startsWith('traits.') || logData.traitsAffected) {
      engines.push('TraitsEngine');
    }
    if (logData.eventType.startsWith('weights.') || logData.weightsApplied) {
      engines.push('WeightsEngine');
    }
    if (logData.eventType.startsWith('vector.')) {
      engines.push('VectorEngine');
    }
  }

  // Route based on contextType
  if (logData.contextType) {
    switch (logData.contextType) {
      case 'feedback':
        if (!engines.includes('FeedbackEngine')) engines.push('FeedbackEngine');
        break;
      case 'moment':
        if (!engines.includes('MomentsEngine')) engines.push('MomentsEngine');
        break;
      case 'campaigns':
        if (!engines.includes('CampaignsEngine')) engines.push('CampaignsEngine');
        break;
      case 'tone':
        if (!engines.includes('ToneEngine')) engines.push('ToneEngine');
        break;
      case 'traits':
        if (!engines.includes('TraitsEngine')) engines.push('TraitsEngine');
        break;
      case 'weights':
        if (!engines.includes('WeightsEngine')) engines.push('WeightsEngine');
        break;
      case 'vector':
        if (!engines.includes('VectorEngine')) engines.push('VectorEngine');
        break;
    }
  }

  // Route based on urgency score
  if (logData.urgencyScore && logData.urgencyScore > 7) {
    engines.push('PriorityEngine');
  }

  // Remove duplicates
  return [...new Set(engines)];
}

// Process log through a specific engine
async function processWithEngine(engine: string, logData: any, logId: string): Promise<any> {
  console.log(`Processing log ${logId} with engine: ${engine}`);

  switch (engine) {
    case 'ContextEngine':
      return await processWithContextEngine(logData, logId);
    
    case 'FeedbackEngine':
      return await processWithFeedbackEngine(logData, logId);
    
    case 'MomentsEngine':
      return await processWithMomentsEngine(logData, logId);
    
    case 'CampaignsEngine':
      return await processWithCampaignsEngine(logData, logId);
    
    case 'ToneEngine':
      return await processWithToneEngine(logData, logId);
    
    case 'TraitsEngine':
      return await processWithTraitsEngine(logData, logId);
    
    case 'WeightsEngine':
      return await processWithWeightsEngine(logData, logId);
    
    case 'VectorEngine':
      return await processWithVectorEngine(logData, logId);
    
    case 'PriorityEngine':
      return await processWithPriorityEngine(logData, logId);
    
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

// Context Engine Processing
async function processWithContextEngine(logData: any, logId: string): Promise<any> {
  // Analyze context usage patterns
  const contextAnalysis = {
    globalContextUsed: !!logData.globalContextUsed,
    scenarioContextUsed: !!logData.scenarioContextUsed,
    customerContextUsed: !!logData.customerContextUsed,
    contextEfficiency: calculateContextEfficiency(logData),
    recommendations: generateContextRecommendations(logData)
  };

  // Store context analysis
  await db.collection('context_analysis').add({
    logId: logId,
    analysis: contextAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return contextAnalysis;
}

// Feedback Engine Processing
async function processWithFeedbackEngine(logData: any, logId: string): Promise<any> {
  // Analyze feedback patterns and sentiment
  const feedbackAnalysis = {
    sentimentScore: analyzeSentiment(logData.aiResponse),
    responseQuality: assessResponseQuality(logData),
    improvementAreas: identifyImprovementAreas(logData),
    trends: await analyzeFeedbackTrends(logData)
  };

  // Store feedback analysis
  await db.collection('feedback_analysis').add({
    logId: logId,
    analysis: feedbackAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return feedbackAnalysis;
}

// Moments Engine Processing
async function processWithMomentsEngine(logData: any, logId: string): Promise<any> {
  // Analyze moment triggers and effectiveness
  const momentAnalysis = {
    triggerEffectiveness: assessTriggerEffectiveness(logData),
    timing: analyzeMomentTiming(logData),
    userEngagement: calculateUserEngagement(logData),
    optimization: generateMomentOptimizations(logData)
  };

  // Store moment analysis
  await db.collection('moment_analysis').add({
    logId: logId,
    analysis: momentAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return momentAnalysis;
}

// Campaigns Engine Processing
async function processWithCampaignsEngine(logData: any, logId: string): Promise<any> {
  // Analyze campaign engagement and effectiveness
  const campaignAnalysis = {
    engagementMetrics: { responseRate: 0, avgEngagement: 0 },
    responsePatterns: { positive: 0, neutral: 0, negative: 0 },
    traitImpact: { motivation: 0, engagement: 0 },
    optimization: { suggestions: [] }
  };

  // Store campaign analysis
  await db.collection('campaign_analysis').add({
    logId: logId,
    analysis: campaignAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return campaignAnalysis;
}

// Tone Engine Processing
async function processWithToneEngine(logData: any, logId: string): Promise<any> {
  // Analyze tone consistency and effectiveness
  const toneAnalysis = {
    toneConsistency: assessToneConsistency(logData),
    customerAlignment: analyzeCustomerAlignment(logData),
    toneEffectiveness: calculateToneEffectiveness(logData),
    recommendations: generateToneRecommendations(logData)
  };

  // Store tone analysis
  await db.collection('tone_analysis').add({
    logId: logId,
    analysis: toneAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return toneAnalysis;
}

// Traits Engine Processing
async function processWithTraitsEngine(logData: any, logId: string): Promise<any> {
  // Analyze trait changes and patterns
  const traitsAnalysis = {
    traitChanges: analyzeTraitChanges(logData),
    patternDetection: detectTraitPatterns(logData),
    predictions: generateTraitPredictions(logData),
    interventions: suggestTraitInterventions(logData)
  };

  // Store traits analysis
  await db.collection('traits_analysis').add({
    logId: logId,
    analysis: traitsAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return traitsAnalysis;
}

// Weights Engine Processing
async function processWithWeightsEngine(logData: any, logId: string): Promise<any> {
  // Analyze weight effectiveness and optimization
  const weightsAnalysis = {
    weightEffectiveness: assessWeightEffectiveness(logData),
    optimization: generateWeightOptimizations(logData),
    balance: analyzeWeightBalance(logData),
    recommendations: generateWeightRecommendations(logData)
  };

  // Store weights analysis
  await db.collection('weights_analysis').add({
    logId: logId,
    analysis: weightsAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return weightsAnalysis;
}

// Vector Engine Processing
async function processWithVectorEngine(logData: any, logId: string): Promise<any> {
  // Analyze vector usage and similarity scores
  const vectorAnalysis = {
    similarityEffectiveness: assessSimilarityEffectiveness(logData),
    chunkQuality: analyzeChunkQuality(logData),
    retrievalOptimization: generateRetrievalOptimizations(logData),
    recommendations: generateVectorRecommendations(logData)
  };

  // Store vector analysis
  await db.collection('vector_analysis').add({
    logId: logId,
    analysis: vectorAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return vectorAnalysis;
}

// Priority Engine Processing
async function processWithPriorityEngine(logData: any, logId: string): Promise<any> {
  // Handle high-urgency logs with priority processing
  const priorityAnalysis = {
    urgencyLevel: logData.urgencyScore,
    escalationNeeded: determineEscalationNeeded(logData),
    immediateActions: generateImmediateActions(logData),
    priorityQueue: await addToPriorityQueue(logData)
  };

  // Store priority analysis
  await db.collection('priority_analysis').add({
    logId: logId,
    analysis: priorityAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return priorityAnalysis;
}

// Helper functions for analysis
function calculateContextEfficiency(logData: any): number {
  // Calculate how efficiently context was used
  let efficiency = 0.5; // Base efficiency
  
  if (logData.globalContextUsed) efficiency += 0.2;
  if (logData.scenarioContextUsed) efficiency += 0.2;
  if (logData.customerContextUsed) efficiency += 0.1;
  
  return Math.min(efficiency, 1.0);
}

function generateContextRecommendations(logData: any): string[] {
  const recommendations = [];
  
  if (!logData.globalContextUsed) {
    recommendations.push('Consider using global context for better consistency');
  }
  
  if (!logData.scenarioContextUsed) {
    recommendations.push('Scenario context could improve response relevance');
  }
  
  return recommendations;
}

function analyzeSentiment(text: string): number {
  // Simple sentiment analysis (in real implementation, use proper NLP)
  if (!text) return 0;
  
  const positiveWords = ['good', 'great', 'excellent', 'happy', 'satisfied', 'positive'];
  const negativeWords = ['bad', 'terrible', 'unhappy', 'dissatisfied', 'negative', 'poor'];
  
  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  
  words.forEach(word => {
    if (positiveWords.includes(word)) score += 1;
    if (negativeWords.includes(word)) score -= 1;
  });
  
  return Math.max(-1, Math.min(1, score / words.length));
}

function assessResponseQuality(logData: any): number {
  // Assess the quality of the AI response
  let quality = 0.5; // Base quality
  
  if (logData.success) quality += 0.3;
  if (logData.latencyMs && logData.latencyMs < 1000) quality += 0.2;
  if (logData.aiResponse && logData.aiResponse.length > 10) quality += 0.1;
  
  return Math.min(quality, 1.0);
}

function identifyImprovementAreas(logData: any): string[] {
  const areas = [];
  
  if (logData.latencyMs && logData.latencyMs > 2000) {
    areas.push('Response latency optimization needed');
  }
  
  if (!logData.success) {
    areas.push('Error handling improvement required');
  }
  
  return areas;
}

async function analyzeFeedbackTrends(logData: any): Promise<any> {
  // Analyze feedback trends over time
  const trends = {
    sentimentTrend: 'stable',
    responseTimeTrend: 'improving',
    satisfactionTrend: 'stable'
  };
  
  return trends;
}

function assessTriggerEffectiveness(logData: any): number {
  // Assess how effective the moment trigger was
  let effectiveness = 0.5;
  
  if (logData.success) effectiveness += 0.3;
  if (logData.traitsActive) effectiveness += 0.2;
  
  return Math.min(effectiveness, 1.0);
}

function analyzeMomentTiming(logData: any): any {
  return {
    optimal: true,
    timingScore: 0.8,
    recommendations: ['Consider earlier trigger for better engagement']
  };
}

function calculateUserEngagement(logData: any): number {
  // Calculate user engagement based on log data
  let engagement = 0.5;
  
  if (logData.success) engagement += 0.3;
  if (logData.traitsActive) engagement += 0.2;
  
  return Math.min(engagement, 1.0);
}

function generateMomentOptimizations(logData: any): string[] {
  return [
    'Optimize trigger timing based on user patterns',
    'Improve moment personalization',
    'Enhance follow-up actions'
  ];
}

function assessToneConsistency(logData: any): number {
  // Assess tone consistency across interactions
  return 0.8; // Placeholder
}

function analyzeCustomerAlignment(logData: any): any {
  return {
    alignment: 0.9,
    recommendations: ['Maintain current tone settings']
  };
}

function calculateToneEffectiveness(logData: any): number {
  return 0.85; // Placeholder
}

function generateToneRecommendations(logData: any): string[] {
  return [
    'Consider more formal tone for technical queries',
    'Maintain friendly tone for general interactions'
  ];
}

function analyzeTraitChanges(logData: any): any {
  return {
    changes: [],
    impact: 'minimal',
    recommendations: []
  };
}

function detectTraitPatterns(logData: any): any {
  return {
    patterns: [],
    significance: 'low'
  };
}

function generateTraitPredictions(logData: any): any {
  return {
    predictions: [],
    confidence: 0.6
  };
}

function suggestTraitInterventions(logData: any): string[] {
  return [
    'Monitor trait changes more closely',
    'Consider proactive interventions'
  ];
}

function assessWeightEffectiveness(logData: any): number {
  return 0.75; // Placeholder
}

function generateWeightOptimizations(logData: any): any {
  return {
    suggestions: [],
    impact: 'medium'
  };
}

function analyzeWeightBalance(logData: any): any {
  return {
    balance: 'good',
    recommendations: []
  };
}

function generateWeightRecommendations(logData: any): string[] {
  return [
    'Consider adjusting weights for better balance',
    'Monitor weight effectiveness over time'
  ];
}

function assessSimilarityEffectiveness(logData: any): number {
  return 0.8; // Placeholder
}

function analyzeChunkQuality(logData: any): any {
  return {
    quality: 'good',
    improvements: []
  };
}

function generateRetrievalOptimizations(logData: any): any {
  return {
    optimizations: [],
    impact: 'medium'
  };
}

function generateVectorRecommendations(logData: any): string[] {
  return [
    'Consider expanding vector collection',
    'Optimize similarity thresholds'
  ];
}

function determineEscalationNeeded(logData: any): boolean {
  return logData.urgencyScore > 8;
}

function generateImmediateActions(logData: any): string[] {
  return [
    'Review high-urgency log immediately',
    'Consider manual intervention',
    'Update escalation protocols'
  ];
}

async function addToPriorityQueue(logData: any): Promise<any> {
  // Add to priority processing queue
  await db.collection('priority_queue').add({
    logId: logData.id,
    urgencyScore: logData.urgencyScore,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending'
  });
  
  return { queued: true, priority: 'high' };
}

// Manual reprocessing function
export const reprocessLog = async (logId: string, engines: string[] = []) => {
  const logDoc = await db.collection('ai_logs').doc(logId).get();
  
  if (!logDoc.exists) {
    throw new Error('Log not found');
  }
  
  const logData = logDoc.data();
  
  // Reset processing status
  await db.collection('ai_logs').doc(logId).update({
    processed: false,
    engineTouched: [],
    processingResults: [],
    errors: [],
    reprocessedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Determine engines to process (use provided engines or auto-detect)
  const enginesToProcess = engines.length > 0 ? engines : determineEnginesToProcess(logData);
  
  // Process through engines
  const processingResults = [];
  
  for (const engine of enginesToProcess) {
    try {
      const result = await processWithEngine(engine, logData, logId);
      processingResults.push({
        engine,
        success: true,
        result,
        processedAt: new Date().toISOString()
      });
    } catch (error) {
      processingResults.push({
        engine,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processedAt: new Date().toISOString()
      });
    }
  }
  
  // Update log with new processing results
  await db.collection('ai_logs').doc(logId).update({
    processed: true,
    engineTouched: enginesToProcess,
    processingResults,
    processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    errors: processingResults.filter(r => !r.success).map(r => r.error)
  });
  
  return { success: true, enginesProcessed: enginesToProcess.length };
}; 