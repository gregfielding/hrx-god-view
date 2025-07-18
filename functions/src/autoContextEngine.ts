import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logAIAction } from './feedbackEngine';

const db = admin.firestore();

interface ContextChunk {
  id: string;
  content: string;
  source: string;
  relevance: number;
  tags: string[];
  lastUpdated: admin.firestore.Timestamp;
}

interface TraitData {
  userId: string;
  traits: Record<string, number>;
  lastUpdated: admin.firestore.Timestamp;
}

interface ToneData {
  defaultTone: string;
  customerOverrides?: Record<string, string>;
  context: string;
}

interface WeightData {
  moduleWeights: Record<string, number>;
  scenarioWeights: Record<string, number>;
  lastUpdated: admin.firestore.Timestamp;
}

interface OrchestratedPrompt {
  originalInput: string;
  userId: string;
  finalPrompt: string;
  contextUsed: ContextChunk[];
  traitsApplied: TraitData;
  toneApplied: ToneData;
  weightsApplied: WeightData;
  confidenceScore: number;
  escalationRisk: number;
  modulesEngaged: string[];
  walkthrough: string[];
  timestamp: admin.firestore.Timestamp;
}

// Main orchestration function
export const orchestratePrompt = onCall(async (request) => {
  const { input, userId, customerId, scenarioId = 'default' } = request.data;
  
  try {
    const startTime = Date.now();
    
    // Step 1: Gather all relevant context
    const contextChunks = await fetchRelevantContext(input, customerId, scenarioId);
    const traitData = await fetchUserTraits(userId);
    const toneData = await fetchToneSettings(customerId);
    const weightData = await fetchWeightSettings(customerId, scenarioId);
    
    // Step 2: Apply retrieval filters
    const filteredContext = await applyRetrievalFilters(contextChunks, customerId, scenarioId);
    
    // Step 3: Compose the final prompt
    const finalPrompt = composeFinalPrompt(input, filteredContext, traitData, toneData, weightData);
    
    // Step 4: Calculate confidence and risk scores
    const confidenceScore = calculateConfidenceScore(filteredContext, traitData, weightData);
    const escalationRisk = calculateEscalationRisk(traitData, confidenceScore);
    
    // Step 5: Determine which modules to engage
    const modulesEngaged = determineModulesToEngage(input, traitData, escalationRisk);
    
    // Step 6: Create walkthrough for transparency
    const walkthrough = createWalkthrough(input, filteredContext, traitData, toneData, weightData, finalPrompt);
    
    // Step 7: Create orchestrated prompt object
    const orchestratedPrompt: OrchestratedPrompt = {
      originalInput: input,
      userId,
      finalPrompt,
      contextUsed: filteredContext,
      traitsApplied: traitData,
      toneApplied: toneData,
      weightsApplied: weightData,
      confidenceScore,
      escalationRisk,
      modulesEngaged,
      walkthrough,
      timestamp: admin.firestore.Timestamp.now()
    };
    
    // Step 8: Log the orchestration
    await logAIAction({
      eventType: 'prompt_orchestration',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'prompt_composition',
      traitsAffected: Object.keys(traitData.traits),
      aiTags: ['orchestration', 'prompt_composition'],
      urgencyScore: escalationRisk > 7 ? 8 : 3,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['AutoContextEngine', ...modulesEngaged],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now(),
      timesProcessedByEngines: {
        AutoContextEngine: 1,
        ...modulesEngaged.reduce((acc, module) => ({ ...acc, [module]: 1 }), {})
      },
      finalPrompt,
      confidenceScore,
      escalationRisk,
      contextChunksUsed: filteredContext.length,
      modulesEngaged: modulesEngaged.length
    });
    
    // Step 9: Store orchestrated prompt for analysis
    await db.collection('orchestrated_prompts').add(orchestratedPrompt);
    
    return {
      success: true,
      data: {
        finalPrompt,
        confidenceScore,
        escalationRisk,
        modulesEngaged,
        walkthrough,
        contextUsed: filteredContext.length,
        orchestrationId: orchestratedPrompt.timestamp.toMillis().toString()
      }
    };
    
  } catch (error: any) {
    console.error('Orchestration error:', error);
    
    await logAIAction({
      eventType: 'prompt_orchestration_error',
      targetType: 'user',
      targetId: userId,
      aiRelevant: true,
      contextType: 'error_handling',
      traitsAffected: [],
      aiTags: ['error', 'orchestration'],
      urgencyScore: 8,
      success: false,
      errorMessage: error.message,
      engineTouched: ['AutoContextEngine'],
      processingStartedAt: admin.firestore.Timestamp.now(),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });
    
    throw new Error(`Orchestration failed: ${error.message}`);
  }
});

// Fetch relevant context chunks
async function fetchRelevantContext(input: string, customerId: string, scenarioId: string): Promise<ContextChunk[]> {
  const contextRef = db.collection('context_chunks');
  let query = contextRef.where('customerId', '==', customerId);
  
  if (scenarioId !== 'default') {
    query = query.where('scenarios', 'array-contains', scenarioId);
  }
  
  const snapshot = await query.orderBy('relevance', 'desc').limit(10).get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as ContextChunk[];
}

// Fetch user traits
async function fetchUserTraits(userId: string): Promise<TraitData> {
  const traitRef = db.collection('user_traits').doc(userId);
  const doc = await traitRef.get();
  
  if (doc.exists) {
    return {
      userId,
      ...doc.data()
    } as TraitData;
  }
  
  // Return default traits if none exist
  return {
    userId,
    traits: {
      communication: 5,
      responsiveness: 5,
      reliability: 5,
      engagement: 5
    },
    lastUpdated: admin.firestore.Timestamp.now()
  };
}

// Fetch tone settings
async function fetchToneSettings(customerId: string): Promise<ToneData> {
  const toneRef = db.collection('customer_settings').doc(customerId);
  const doc = await toneRef.get();
  
  if (doc.exists) {
    const data = doc.data();
    return {
      defaultTone: data?.defaultTone || 'friendly',
      customerOverrides: data?.toneOverrides || {},
      context: data?.toneContext || 'general'
    };
  }
  
  return {
    defaultTone: 'friendly',
    context: 'general'
  };
}

// Fetch weight settings
async function fetchWeightSettings(customerId: string, scenarioId: string): Promise<WeightData> {
  const weightRef = db.collection('weight_settings').doc(customerId);
  const doc = await weightRef.get();
  
  if (doc.exists) {
    const data = doc.data();
    return {
      moduleWeights: data?.moduleWeights || {
        traits: 0.3,
        tone: 0.2,
        context: 0.4,
        feedback: 0.1
      },
      scenarioWeights: data?.scenarioWeights || {},
      lastUpdated: admin.firestore.Timestamp.now()
    };
  }
  
  return {
    moduleWeights: {
      traits: 0.3,
      tone: 0.2,
      context: 0.4,
      feedback: 0.1
    },
    scenarioWeights: {},
    lastUpdated: admin.firestore.Timestamp.now()
  };
}

// Apply retrieval filters
async function applyRetrievalFilters(chunks: ContextChunk[], customerId: string, scenarioId: string): Promise<ContextChunk[]> {
  const filterRef = db.collection('retrieval_filters').doc(customerId);
  const doc = await filterRef.get();
  
  if (!doc.exists) {
    return chunks; // No filters, return all chunks
  }
  
  const filters = doc.data()?.filters || [];
  let filteredChunks = chunks;
  
  for (const filter of filters) {
    if (filter.active && filter.scenarios.includes(scenarioId)) {
      filteredChunks = filteredChunks.filter(chunk => {
        // Apply exclusion rules
        if (filter.excludeTags && filter.excludeTags.some((tag: string) => chunk.tags.includes(tag))) {
          return false;
        }
        
        // Apply date filters
        if (filter.maxAgeDays) {
          const maxAge = new Date();
          maxAge.setDate(maxAge.getDate() - filter.maxAgeDays);
          if (chunk.lastUpdated.toDate() < maxAge) {
            return false;
          }
        }
        
        // Apply relevance threshold
        if (filter.minRelevance && chunk.relevance < filter.minRelevance) {
          return false;
        }
        
        return true;
      });
    }
  }
  
  return filteredChunks;
}

// Compose final prompt
function composeFinalPrompt(
  input: string, 
  context: ContextChunk[], 
  traits: TraitData, 
  tone: ToneData, 
  weights: WeightData
): string {
  let prompt = `Context: You are an AI assistant for HR management. `;
  
  // Add tone instruction
  prompt += `Use a ${tone.defaultTone} tone. `;
  
  // Add relevant context chunks
  if (context.length > 0) {
    prompt += `\n\nRelevant information:\n`;
    context.forEach(chunk => {
      prompt += `- ${chunk.content}\n`;
    });
  }
  
  // Add user trait context
  const traitContext = Object.entries(traits.traits)
    .filter(([_, score]) => score < 4 || score > 6)
    .map(([trait, score]) => `${trait}: ${score}/10`)
    .join(', ');
  
  if (traitContext) {
    prompt += `\nUser context: ${traitContext}\n`;
  }
  
  // Add the actual user input
  prompt += `\nUser question: ${input}\n\nResponse:`;
  
  return prompt;
}

// Calculate confidence score
function calculateConfidenceScore(context: ContextChunk[], traits: TraitData, weights: WeightData): number {
  let score = 0.5; // Base score
  
  // Context relevance
  if (context.length > 0) {
    const avgRelevance = context.reduce((sum, chunk) => sum + chunk.relevance, 0) / context.length;
    score += avgRelevance * 0.2;
  }
  
  // Trait completeness
  const traitCompleteness = Object.keys(traits.traits).length / 4; // Assuming 4 core traits
  score += traitCompleteness * 0.2;
  
  // Weight configuration
  const weightCompleteness = Object.keys(weights.moduleWeights).length / 4;
  score += weightCompleteness * 0.1;
  
  return Math.min(Math.max(score, 0), 1);
}

// Calculate escalation risk
function calculateEscalationRisk(traits: TraitData, confidenceScore: number): number {
  let risk = 0;
  
  // Low confidence increases risk
  if (confidenceScore < 0.6) {
    risk += 3;
  }
  
  // Low trait scores increase risk
  Object.values(traits.traits).forEach(score => {
    if (score < 3) risk += 2;
    if (score < 2) risk += 3;
  });
  
  return Math.min(risk, 10);
}

// Determine which modules to engage
function determineModulesToEngage(input: string, traits: TraitData, escalationRisk: number): string[] {
  const modules: string[] = ['AutoContextEngine'];
  
  // Always engage context engine
  modules.push('ContextEngine');
  
  // Engage traits engine if traits are low
  if (Object.values(traits.traits).some(score => score < 4)) {
    modules.push('TraitsEngine');
  }
  
  // Engage feedback engine for high-risk situations
  if (escalationRisk > 6) {
    modules.push('FeedbackEngine');
  }
  
  // Engage moments engine for proactive interactions
  if (input.toLowerCase().includes('schedule') || input.toLowerCase().includes('remind')) {
    modules.push('MomentsEngine');
  }
  
  return modules;
}

// Create walkthrough for transparency
function createWalkthrough(
  input: string,
  context: ContextChunk[],
  traits: TraitData,
  tone: ToneData,
  weights: WeightData,
  finalPrompt: string
): string[] {
  const walkthrough: string[] = [];
  
  walkthrough.push(`Input received: "${input}"`);
  walkthrough.push(`User traits loaded: ${Object.entries(traits.traits).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  walkthrough.push(`Tone applied: ${tone.defaultTone}`);
  walkthrough.push(`Context chunks retrieved: ${context.length}`);
  walkthrough.push(`Module weights: ${Object.entries(weights.moduleWeights).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  walkthrough.push(`Final prompt composed with ${finalPrompt.length} characters`);
  
  return walkthrough;
}

// Get orchestration history
export const getOrchestrationHistory = onCall(async (request) => {
  const { userId, limit = 50 } = request.data;
  
  try {
    const query = db.collection('orchestrated_prompts')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit);
    
    const snapshot = await query.get();
    const history = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return {
      success: true,
      data: history
    };
  } catch (error: any) {
    console.error('Error fetching orchestration history:', error);
    throw new Error(`Failed to fetch history: ${error.message}`);
  }
});

// Test orchestration with preview
export const testOrchestration = onCall(async (request) => {
  const { input, userId, customerId, scenarioId } = request.data;
  
  try {
    
    // Step 1: Gather all relevant context
    const contextChunks = await fetchRelevantContext(input, customerId, scenarioId);
    const traitData = await fetchUserTraits(userId);
    const toneData = await fetchToneSettings(customerId);
    const weightData = await fetchWeightSettings(customerId, scenarioId);
    
    // Step 2: Apply retrieval filters
    const filteredContext = await applyRetrievalFilters(contextChunks, customerId, scenarioId);
    
    // Step 3: Compose the final prompt
    const finalPrompt = composeFinalPrompt(input, filteredContext, traitData, toneData, weightData);
    
    // Step 4: Calculate confidence and risk scores
    const confidenceScore = calculateConfidenceScore(filteredContext, traitData, weightData);
    const escalationRisk = calculateEscalationRisk(traitData, confidenceScore);
    
    // Step 5: Determine which modules to engage
    const modulesEngaged = determineModulesToEngage(input, traitData, escalationRisk);
    
    // Step 6: Create walkthrough for transparency
    const walkthrough = createWalkthrough(input, filteredContext, traitData, toneData, weightData, finalPrompt);
    
    return {
      success: true,
      data: {
        finalPrompt,
        confidenceScore,
        escalationRisk,
        modulesEngaged,
        walkthrough,
        contextUsed: filteredContext.length,
        isTest: true
      }
    };
  } catch (error: any) {
    console.error('Test orchestration error:', error);
    throw new Error(`Test failed: ${error.message}`);
  }
}); 