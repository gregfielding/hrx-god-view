import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logAIAction } from './feedbackEngine';

const db = admin.firestore();

interface RetrievalFilter {
  id: string;
  name: string;
  description: string;
  active: boolean;
  customerId: string;
  scenarios: string[];
  excludeTags: string[];
  includeTags: string[];
  maxAgeDays?: number;
  minRelevance: number;
  maxChunks: number;
  sourceRestrictions: string[];
  priority: number;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}



// Create a new retrieval filter
export const createRetrievalFilter = onCall(async (request) => {
  const { 
    name, 
    description, 
    customerId, 
    scenarios = ['default'], 
    excludeTags = [], 
    includeTags = [],
    maxAgeDays,
    minRelevance = 0.5,
    maxChunks = 10,
    sourceRestrictions = [],
    priority = 1
  } = request.data;

  try {
    const filterData: Omit<RetrievalFilter, 'id'> = {
      name,
      description,
      active: true,
      customerId,
      scenarios,
      excludeTags,
      includeTags,
      maxAgeDays,
      minRelevance,
      maxChunks,
      sourceRestrictions,
      priority,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    const docRef = await db.collection('retrieval_filters').add(filterData);

    await logAIAction({
      eventType: 'filter_created',
      targetType: 'filter',
      targetId: docRef.id,
      aiRelevant: true,
      contextType: 'filter_management',
      traitsAffected: [],
      aiTags: ['retrieval_filter', 'filter_creation'],
      urgencyScore: 2,
      success: true,
      latencyMs: 0,
      engineTouched: ['RetrievalFiltersEngine'],
      processingStartedAt: admin.firestore.Timestamp.now(),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        filterId: docRef.id,
        message: 'Retrieval filter created successfully'
      }
    };
  } catch (error: any) {
    console.error('Error creating retrieval filter:', error);
    throw new Error(`Failed to create filter: ${error.message}`);
  }
});

// Get all filters for a customer
export const getCustomerFilters = onCall(async (request) => {
  const { customerId } = request.data;

  try {
    const snapshot = await db.collection('retrieval_filters')
      .where('customerId', '==', customerId)
      .orderBy('priority', 'desc')
      .orderBy('createdAt', 'desc')
      .get();

    const filters = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      data: filters
    };
  } catch (error: any) {
    console.error('Error fetching customer filters:', error);
    throw new Error(`Failed to fetch filters: ${error.message}`);
  }
});

// Update a retrieval filter
export const updateRetrievalFilter = onCall(async (request) => {
  const { filterId, updates } = request.data;

  try {
    const updateData = {
      ...updates,
      updatedAt: admin.firestore.Timestamp.now()
    };

    await db.collection('retrieval_filters').doc(filterId).update(updateData);

    await logAIAction({
      eventType: 'filter_updated',
      targetType: 'filter',
      targetId: filterId,
      aiRelevant: true,
      contextType: 'filter_management',
      traitsAffected: [],
      aiTags: ['retrieval_filter', 'filter_update'],
      urgencyScore: 2,
      success: true,
      latencyMs: 0,
      engineTouched: ['RetrievalFiltersEngine'],
      processingStartedAt: admin.firestore.Timestamp.now(),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        message: 'Filter updated successfully'
      }
    };
  } catch (error: any) {
    console.error('Error updating retrieval filter:', error);
    throw new Error(`Failed to update filter: ${error.message}`);
  }
});

// Delete a retrieval filter
export const deleteRetrievalFilter = onCall(async (request) => {
  const { filterId } = request.data;

  try {
    await db.collection('retrieval_filters').doc(filterId).delete();

    await logAIAction({
      eventType: 'filter_deleted',
      targetType: 'filter',
      targetId: filterId,
      aiRelevant: true,
      contextType: 'filter_management',
      traitsAffected: [],
      aiTags: ['retrieval_filter', 'filter_deletion'],
      urgencyScore: 2,
      success: true,
      latencyMs: 0,
      engineTouched: ['RetrievalFiltersEngine'],
      processingStartedAt: admin.firestore.Timestamp.now(),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: {
        message: 'Filter deleted successfully'
      }
    };
  } catch (error: any) {
    console.error('Error deleting retrieval filter:', error);
    throw new Error(`Failed to delete filter: ${error.message}`);
  }
});

// Apply filters to context chunks
export const applyFiltersToChunks = onCall(async (request) => {
  const { chunks, customerId, scenarioId = 'default' } = request.data;

  try {
    const startTime = Date.now();

    // Get active filters for this customer and scenario
    const snapshot = await db.collection('retrieval_filters')
      .where('customerId', '==', customerId)
      .where('active', '==', true)
      .get();

    const filters = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RetrievalFilter[];

    // Filter chunks based on scenario
    const scenarioFilters = filters.filter(filter => 
      filter.scenarios.includes(scenarioId) || filter.scenarios.includes('default')
    );

    let filteredChunks = [...chunks];

    // Apply each filter in priority order
    scenarioFilters
      .sort((a, b) => b.priority - a.priority)
      .forEach(filter => {
        filteredChunks = filteredChunks.filter(chunk => {
          // Apply tag exclusions
          if (filter.excludeTags.length > 0) {
            const hasExcludedTag = filter.excludeTags.some(tag => 
              chunk.tags && chunk.tags.includes(tag)
            );
            if (hasExcludedTag) return false;
          }

          // Apply tag inclusions (if specified)
          if (filter.includeTags.length > 0) {
            const hasIncludedTag = filter.includeTags.some(tag => 
              chunk.tags && chunk.tags.includes(tag)
            );
            if (!hasIncludedTag) return false;
          }

          // Apply age filter
          if (filter.maxAgeDays) {
            const maxAge = new Date();
            maxAge.setDate(maxAge.getDate() - filter.maxAgeDays);
            if (chunk.lastUpdated && chunk.lastUpdated.toDate() < maxAge) {
              return false;
            }
          }

          // Apply relevance threshold
          if (chunk.relevance < filter.minRelevance) {
            return false;
          }

          // Apply source restrictions
          if (filter.sourceRestrictions.length > 0) {
            if (!filter.sourceRestrictions.includes(chunk.source)) {
              return false;
            }
          }

          return true;
        });

        // Apply max chunks limit
        if (filter.maxChunks && filteredChunks.length > filter.maxChunks) {
          filteredChunks = filteredChunks
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, filter.maxChunks);
        }
      });

    await logAIAction({
      eventType: 'filters_applied',
      targetType: 'context_chunks',
      targetId: 'batch',
      aiRelevant: true,
      contextType: 'filter_application',
      traitsAffected: [],
      aiTags: ['retrieval_filter', 'chunk_filtering'],
      urgencyScore: 3,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['RetrievalFiltersEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now(),
      contextChunksUsed: filteredChunks.length,
      filtersApplied: scenarioFilters.length
    });

    return {
      success: true,
      data: {
        originalCount: chunks.length,
        filteredCount: filteredChunks.length,
        filtersApplied: scenarioFilters.length,
        chunks: filteredChunks
      }
    };
  } catch (error: any) {
    console.error('Error applying filters:', error);
    throw new Error(`Failed to apply filters: ${error.message}`);
  }
});

// Test filter effectiveness
export const testFilterEffectiveness = onCall(async (request) => {
  const { customerId, scenarioId = 'default', testChunks } = request.data;

  try {
    const startTime = Date.now();

    // Get active filters for this customer and scenario
    const snapshot = await db.collection('retrieval_filters')
      .where('customerId', '==', customerId)
      .where('active', '==', true)
      .get();

    const filters = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RetrievalFilter[];

    // Filter chunks based on scenario
    const scenarioFilters = filters.filter(filter => 
      filter.scenarios.includes(scenarioId) || filter.scenarios.includes('default')
    );

    let filteredChunks = [...testChunks];

    // Apply each filter in priority order
    scenarioFilters
      .sort((a, b) => b.priority - a.priority)
      .forEach(filter => {
        filteredChunks = filteredChunks.filter(chunk => {
          // Apply tag exclusions
          if (filter.excludeTags.length > 0) {
            const hasExcludedTag = filter.excludeTags.some(tag => 
              chunk.tags && chunk.tags.includes(tag)
            );
            if (hasExcludedTag) return false;
          }

          // Apply tag inclusions (if specified)
          if (filter.includeTags.length > 0) {
            const hasIncludedTag = filter.includeTags.some(tag => 
              chunk.tags && chunk.tags.includes(tag)
            );
            if (!hasIncludedTag) return false;
          }

          // Apply age filter
          if (filter.maxAgeDays) {
            const maxAge = new Date();
            maxAge.setDate(maxAge.getDate() - filter.maxAgeDays);
            if (chunk.lastUpdated && chunk.lastUpdated.toDate() < maxAge) {
              return false;
            }
          }

          // Apply relevance threshold
          if (chunk.relevance < filter.minRelevance) {
            return false;
          }

          // Apply source restrictions
          if (filter.sourceRestrictions.length > 0) {
            if (!filter.sourceRestrictions.includes(chunk.source)) {
              return false;
            }
          }

          return true;
        });

        // Apply max chunks limit
        if (filter.maxChunks && filteredChunks.length > filter.maxChunks) {
          filteredChunks = filteredChunks
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, filter.maxChunks);
        }
      });

    const effectiveness = {
      originalCount: testChunks.length,
      filteredCount: filteredChunks.length,
      reductionPercentage: ((testChunks.length - filteredChunks.length) / testChunks.length) * 100,
      filtersApplied: scenarioFilters.length,
      averageRelevance: filteredChunks.length > 0 
        ? filteredChunks.reduce((sum: number, chunk: any) => sum + chunk.relevance, 0) / filteredChunks.length 
        : 0
    };

    await logAIAction({
      eventType: 'filter_effectiveness_test',
      targetType: 'filter_test',
      targetId: 'effectiveness',
      aiRelevant: true,
      contextType: 'filter_testing',
      traitsAffected: [],
      aiTags: ['retrieval_filter', 'effectiveness_test'],
      urgencyScore: 2,
      success: true,
      latencyMs: Date.now() - startTime,
      engineTouched: ['RetrievalFiltersEngine'],
      processingStartedAt: admin.firestore.Timestamp.fromDate(new Date(startTime)),
      processingCompletedAt: admin.firestore.Timestamp.now()
    });

    return {
      success: true,
      data: effectiveness
    };
  } catch (error: any) {
    console.error('Error testing filter effectiveness:', error);
    throw new Error(`Failed to test effectiveness: ${error.message}`);
  }
});

// Get filter analytics
export const getFilterAnalytics = onCall(async (request) => {
  const { timeRange = '7d' } = request.data;

  try {
    const startDate = new Date();
    if (timeRange === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (timeRange === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get filter usage logs
    const logsSnapshot = await db.collection('ai_logs')
      .where('eventType', 'in', ['filters_applied', 'filter_effectiveness_test'])
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());

    const analytics = {
      totalFilterApplications: logs.filter(log => log.eventType === 'filters_applied').length,
      totalEffectivenessTests: logs.filter(log => log.eventType === 'filter_effectiveness_test').length,
      averageChunkReduction: logs.length > 0 
        ? logs.reduce((sum, log) => sum + (log.contextChunksUsed || 0), 0) / logs.length 
        : 0,
      mostActiveFilters: getMostActiveFilters(logs),
      filterPerformance: getFilterPerformance(logs)
    };

    return {
      success: true,
      data: analytics
    };
  } catch (error: any) {
    console.error('Error getting filter analytics:', error);
    throw new Error(`Failed to get analytics: ${error.message}`);
  }
});

// Helper function to get most active filters
function getMostActiveFilters(logs: any[]): any[] {
  const filterUsage: Record<string, number> = {};
  
  logs.forEach(log => {
    if (log.filtersApplied) {
      filterUsage['filters'] = (filterUsage['filters'] || 0) + log.filtersApplied;
    }
  });

  return Object.entries(filterUsage)
    .map(([filter, count]) => ({ filter, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Helper function to get filter performance
function getFilterPerformance(logs: any[]): any {
  const performance = {
    averageLatency: logs.length > 0 
      ? logs.reduce((sum, log) => sum + (log.latencyMs || 0), 0) / logs.length 
      : 0,
    successRate: logs.length > 0 
      ? (logs.filter(log => log.success).length / logs.length) * 100 
      : 0,
    totalChunksProcessed: logs.reduce((sum, log) => sum + (log.contextChunksUsed || 0), 0)
  };

  return performance;
} 