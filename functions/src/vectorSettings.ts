import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logAIAction } from './feedbackEngine';

const db = admin.firestore();

interface VectorChunk {
  id: string;
  content: string;
  source: string;
  tags: string[];
  relevance: number;
  embedding: number[];
  chunkSize: number;
  overlap: number;
  model: string;
  lastUpdated: admin.firestore.Timestamp;
  customerId: string;
  scenarios: string[];
  priority: number;
  archived: boolean;
}

interface ChunkingStrategy {
  id: string;
  name: string;
  description: string;
  chunkSize: number;
  overlap: number;
  model: string;
  customerId: string;
  active: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}



// Create a new vector chunk
export const createVectorChunk = onCall(async (request) => {
  const { 
    content, 
    source, 
    tags = [], 
    customerId, 
    scenarios = ['default'],
    priority = 1,
    chunkSize = 1000,
    overlap = 200
  } = request.data;

  try {
    const startTime = Date.now();

    // Generate embedding (simulated for now)
    const embedding = generateEmbedding(content);
    const relevance = calculateInitialRelevance(content, tags);

    const chunkData: Omit<VectorChunk, 'id'> = {
      content,
      source,
      tags,
      relevance,
      embedding,
      chunkSize,
      overlap,
      model: 'text-embedding-ada-002',
      lastUpdated: admin.firestore.Timestamp.now(),
      customerId,
      scenarios,
      priority,
      archived: false
    };

    const docRef = await db.collection('vector_chunks').add(chunkData);

    await logAIAction({
      eventType: 'vector_chunk_created',
      targetType: 'chunk',
      targetId: docRef.id,
      aiRelevant: true,
      contextType: 'vector_management',
      traitsAffected: [],
      aiTags: ['vector_chunk', 'embedding'],
      urgencyScore: 3,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['VectorSettingsEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        chunkId: docRef.id,
        relevance,
        embeddingLength: embedding.length,
        message: 'Vector chunk created successfully'
      }
    };
  } catch (error: any) {
    console.error('Error creating vector chunk:', error);
    throw new Error(`Failed to create chunk: ${error.message}`);
  }
});

// Search vector chunks
export const searchVectorChunks = onCall({
  maxInstances: 5,
  timeoutSeconds: 60
}, async (request) => {
  const { 
    query, 
    customerId, 
    scenarioId = 'default', 
    limit = 10,
    minRelevance = 0.5,
    tags = []
  } = request.data;

  try {
    const startTime = Date.now();

    // Generate query embedding
    const queryEmbedding = generateEmbedding(query);

    // Get relevant chunks
    const chunksRef = db.collection('vector_chunks');
    let queryBuilder = chunksRef
      .where('customerId', '==', customerId)
      .where('archived', '==', false)
      .where('relevance', '>=', minRelevance);

    if (scenarioId !== 'default') {
      queryBuilder = queryBuilder.where('scenarios', 'array-contains', scenarioId);
    }

    const snapshot = await queryBuilder
      .orderBy('relevance', 'desc')
      .limit(limit * 2) // Get more to filter by tags
      .get();

    let chunks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as VectorChunk[];

    // Filter by tags if specified
    if (tags.length > 0) {
      chunks = chunks.filter(chunk => 
        tags.some((tag: string) => chunk.tags.includes(tag))
      );
    }

    // Calculate similarity scores
    const scoredChunks = chunks.map(chunk => ({
      ...chunk,
      similarity: calculateSimilarity(queryEmbedding, chunk.embedding)
    }));

    // Sort by similarity and limit
    const results = scoredChunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    await logAIAction({
      eventType: 'vector_search',
      targetType: 'search',
      targetId: 'vector_search',
      aiRelevant: true,
      contextType: 'vector_search',
      traitsAffected: [],
      aiTags: ['vector_search', 'similarity'],
      urgencyScore: 3,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['VectorSettingsEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now(),
      contextChunksUsed: results.length
    });

    return {
      success: true,
      data: {
        results,
        totalFound: chunks.length,
        query: query
      }
    };
  } catch (error: any) {
    console.error('Error searching vector chunks:', error);
    throw new Error(`Failed to search chunks: ${error.message}`);
  }
});

// Update chunk relevance
export const updateChunkRelevance = onCall(async (request) => {
  const { chunkId, newRelevance } = request.data;

  try {
    const startTime = Date.now();

    await db.collection('vector_chunks').doc(chunkId).update({
      relevance: newRelevance,
      lastUpdated: admin.firestore.Timestamp.now()
    });

    await logAIAction({
      eventType: 'chunk_relevance_updated',
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'relevance_update',
      traitsAffected: [],
      aiTags: ['vector_chunk', 'relevance_update'],
      urgencyScore: 2,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['VectorSettingsEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        message: 'Chunk relevance updated successfully',
        newRelevance
      }
    };
  } catch (error: any) {
    console.error('Error updating chunk relevance:', error);
    throw new Error(`Failed to update relevance: ${error.message}`);
  }
});

// Archive or delete chunk
export const archiveChunk = onCall(async (request) => {
  const { chunkId, action = 'archive' } = request.data;

  try {
    const startTime = Date.now();

    if (action === 'delete') {
      await db.collection('vector_chunks').doc(chunkId).delete();
    } else {
      await db.collection('vector_chunks').doc(chunkId).update({
        archived: true,
        lastUpdated: admin.firestore.Timestamp.now()
      });
    }

    await logAIAction({
      eventType: `chunk_${action}d`,
      targetType: 'chunk',
      targetId: chunkId,
      aiRelevant: true,
      contextType: 'chunk_management',
      traitsAffected: [],
      aiTags: ['vector_chunk', action],
      urgencyScore: 2,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['VectorSettingsEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        message: `Chunk ${action}d successfully`
      }
    };
  } catch (error: any) {
    console.error(`Error ${action}ing chunk:`, error);
    throw new Error(`Failed to ${action} chunk: ${error.message}`);
  }
});

// Create chunking strategy
export const createChunkingStrategy = onCall(async (request) => {
  const { 
    name, 
    description, 
    chunkSize, 
    overlap, 
    model, 
    customerId 
  } = request.data;

  try {
    const strategyData: Omit<ChunkingStrategy, 'id'> = {
      name,
      description,
      chunkSize,
      overlap,
      model,
      customerId,
      active: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    const docRef = await db.collection('chunking_strategies').add(strategyData);

    await logAIAction({
      eventType: 'chunking_strategy_created',
      targetType: 'strategy',
      targetId: docRef.id,
      aiRelevant: true,
      contextType: 'strategy_management',
      traitsAffected: [],
      aiTags: ['chunking_strategy', 'strategy_creation'],
      urgencyScore: 2,
      success: true,
      latencyMs: 0,
      engineTouched: ['VectorSettingsEngine'],
      processingStartedAt: admin.firestore.Timestamp.now(),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        strategyId: docRef.id,
        message: 'Chunking strategy created successfully'
      }
    };
  } catch (error: any) {
    console.error('Error creating chunking strategy:', error);
    throw new Error(`Failed to create strategy: ${error.message}`);
  }
});

// Get chunking strategies
export const getChunkingStrategies = onCall(async (request) => {
  const { customerId } = request.data;

  try {
    const snapshot = await db.collection('chunking_strategies')
      .where('customerId', '==', customerId)
      .orderBy('createdAt', 'desc')
      .get();

    const strategies = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      data: strategies
    };
  } catch (error: any) {
    console.error('Error fetching chunking strategies:', error);
    throw new Error(`Failed to fetch strategies: ${error.message}`);
  }
});

// Get vector analytics
export const getVectorAnalytics = onCall({
  maxInstances: 3,
  timeoutSeconds: 60
}, async (request) => {
  const { customerId, timeRange = '7d' } = request.data;

  try {
    const startDate = new Date();
    if (timeRange === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (timeRange === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get vector-related logs
    const logsSnapshot = await db.collection('ai_logs')
      .where('eventType', 'in', ['vector_chunk_created', 'vector_search', 'chunk_relevance_updated'])
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());

    // Get chunk statistics
    const chunksSnapshot = await db.collection('vector_chunks')
      .where('customerId', '==', customerId)
      .get();

    const chunks = chunksSnapshot.docs.map(doc => doc.data());

    const analytics = {
      totalChunks: chunks.length,
      activeChunks: chunks.filter(chunk => !chunk.archived).length,
      averageRelevance: chunks.length > 0 
        ? chunks.reduce((sum, chunk) => sum + chunk.relevance, 0) / chunks.length 
        : 0,
      totalSearches: logs.filter(log => log.eventType === 'vector_search').length,
      totalChunksCreated: logs.filter(log => log.eventType === 'vector_chunk_created').length,
      averageSearchLatency: logs.filter(log => log.eventType === 'vector_search').length > 0
        ? logs.filter(log => log.eventType === 'vector_search')
            .reduce((sum, log) => sum + (log.latencyMs || 0), 0) / 
            logs.filter(log => log.eventType === 'vector_search').length
        : 0,
      topTags: getTopTags(chunks),
      searchPerformance: getSearchPerformance(logs)
    };

    return {
      success: true,
      data: analytics
    };
  } catch (error: any) {
    console.error('Error getting vector analytics:', error);
    throw new Error(`Failed to get analytics: ${error.message}`);
  }
});

// Helper function to generate embedding (simulated)
function generateEmbedding(text: string): number[] {
  // Simulate embedding generation
  const embedding = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(Math.random() * 2 - 1);
  }
  return embedding;
}

// Helper function to calculate initial relevance
function calculateInitialRelevance(content: string, tags: string[]): number {
  let relevance = 0.5; // Base relevance
  
  // Content length factor
  if (content.length > 1000) relevance += 0.1;
  if (content.length > 2000) relevance += 0.1;
  
  // Tags factor
  relevance += tags.length * 0.05;
  
  return Math.min(Math.max(relevance, 0), 1);
}

// Helper function to calculate similarity
function calculateSimilarity(embedding1: number[], embedding2: number[]): number {
  // Cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Helper function to get top tags
function getTopTags(chunks: any[]): any[] {
  const tagCount: Record<string, number> = {};
  
  chunks.forEach(chunk => {
    chunk.tags.forEach((tag: string) => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });

  return Object.entries(tagCount)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// Helper function to get search performance
function getSearchPerformance(logs: any[]): any {
  const searchLogs = logs.filter(log => log.eventType === 'vector_search');
  
  return {
    totalSearches: searchLogs.length,
    averageLatency: searchLogs.length > 0 
      ? searchLogs.reduce((sum, log) => sum + (log.latencyMs || 0), 0) / searchLogs.length 
      : 0,
    averageResultsPerSearch: searchLogs.length > 0
      ? searchLogs.reduce((sum, log) => sum + (log.contextChunksUsed || 0), 0) / searchLogs.length
      : 0,
    successRate: searchLogs.length > 0 
      ? (searchLogs.filter(log => log.success).length / searchLogs.length) * 100 
      : 0
  };
} 