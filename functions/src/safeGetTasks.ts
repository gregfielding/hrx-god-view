import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe task retrieval
const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  TAG: 'getTasks@v2',
  // Input validation limits
  MAX_LIMIT: 100, // Maximum tasks to return
  MAX_STATUS_ARRAY_LENGTH: 10,
  MAX_TYPE_ARRAY_LENGTH: 10,
  MAX_CATEGORY_ARRAY_LENGTH: 10,
  MAX_PRIORITY_ARRAY_LENGTH: 10,
  MAX_QUOTA_CATEGORY_ARRAY_LENGTH: 10,
  MAX_TAGS_ARRAY_LENGTH: 20,
  MAX_ORDER_BY_LENGTH: 50,
  // Query limits
  MAX_FILTERS: 8, // Maximum number of filters to apply
  MAX_CLIENT_FILTERS: 5, // Maximum number of client-side filters
  // Cost limits
  MAX_COST_PER_CALL: 0.05 // $0.05 USD max per call
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Validate input parameters
 */
function validateInput(data: any): {
  tenantId: string;
  userId?: string;
  status?: string[];
  type?: string[];
  category?: string[];
  priority?: string[];
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  aiGenerated?: boolean;
  quotaCategory?: string[];
  orderBy: string;
  orderDirection: 'asc' | 'desc';
  limit: number;
  dealId?: string;
  companyId?: string;
  contactId?: string;
  salespersonId?: string;
  tags?: string[];
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid request data');
  }

  const { 
    tenantId, 
    userId, 
    status, 
    type, 
    category, 
    priority, 
    startDate, 
    endDate, 
    dueDate, 
    aiGenerated, 
    quotaCategory, 
    orderBy = 'scheduledDate', 
    orderDirection = 'asc', 
    limit = 50,
    dealId,
    companyId,
    contactId,
    salespersonId,
    tags
  } = data;

  // Required field validation
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required and must be a non-empty string');
  }

  // Optional field validation
  if (userId && (typeof userId !== 'string' || userId.trim() === '')) {
    throw new Error('userId must be a non-empty string if provided');
  }

  // Array field validation
  if (status && (!Array.isArray(status) || status.length > SAFE_CONFIG.MAX_STATUS_ARRAY_LENGTH)) {
    throw new Error(`status must be an array with ${SAFE_CONFIG.MAX_STATUS_ARRAY_LENGTH} or fewer items`);
  }

  if (type && (!Array.isArray(type) || type.length > SAFE_CONFIG.MAX_TYPE_ARRAY_LENGTH)) {
    throw new Error(`type must be an array with ${SAFE_CONFIG.MAX_TYPE_ARRAY_LENGTH} or fewer items`);
  }

  if (category && (!Array.isArray(category) || category.length > SAFE_CONFIG.MAX_CATEGORY_ARRAY_LENGTH)) {
    throw new Error(`category must be an array with ${SAFE_CONFIG.MAX_CATEGORY_ARRAY_LENGTH} or fewer items`);
  }

  if (priority && (!Array.isArray(priority) || priority.length > SAFE_CONFIG.MAX_PRIORITY_ARRAY_LENGTH)) {
    throw new Error(`priority must be an array with ${SAFE_CONFIG.MAX_PRIORITY_ARRAY_LENGTH} or fewer items`);
  }

  if (quotaCategory && (!Array.isArray(quotaCategory) || quotaCategory.length > SAFE_CONFIG.MAX_QUOTA_CATEGORY_ARRAY_LENGTH)) {
    throw new Error(`quotaCategory must be an array with ${SAFE_CONFIG.MAX_QUOTA_CATEGORY_ARRAY_LENGTH} or fewer items`);
  }

  if (tags && (!Array.isArray(tags) || tags.length > SAFE_CONFIG.MAX_TAGS_ARRAY_LENGTH)) {
    throw new Error(`tags must be an array with ${SAFE_CONFIG.MAX_TAGS_ARRAY_LENGTH} or fewer items`);
  }

  // Date validation
  if (startDate && typeof startDate !== 'string') {
    throw new Error('startDate must be a string');
  }

  if (endDate && typeof endDate !== 'string') {
    throw new Error('endDate must be a string');
  }

  if (dueDate && typeof dueDate !== 'string') {
    throw new Error('dueDate must be a string');
  }

  // Boolean validation
  if (aiGenerated !== undefined && typeof aiGenerated !== 'boolean') {
    throw new Error('aiGenerated must be a boolean');
  }

  // Order validation
  if (typeof orderBy !== 'string' || orderBy.length > SAFE_CONFIG.MAX_ORDER_BY_LENGTH) {
    throw new Error(`orderBy must be a string and ${SAFE_CONFIG.MAX_ORDER_BY_LENGTH} characters or less`);
  }

  if (orderDirection !== 'asc' && orderDirection !== 'desc') {
    throw new Error('orderDirection must be either "asc" or "desc"');
  }

  // Limit validation
  if (typeof limit !== 'number' || limit < 1 || limit > SAFE_CONFIG.MAX_LIMIT) {
    throw new Error(`limit must be a number between 1 and ${SAFE_CONFIG.MAX_LIMIT}`);
  }

  // Association ID validation
  if (dealId && (typeof dealId !== 'string' || dealId.trim() === '')) {
    throw new Error('dealId must be a non-empty string if provided');
  }

  if (companyId && (typeof companyId !== 'string' || companyId.trim() === '')) {
    throw new Error('companyId must be a non-empty string if provided');
  }

  if (contactId && (typeof contactId !== 'string' || contactId.trim() === '')) {
    throw new Error('contactId must be a non-empty string if provided');
  }

  if (salespersonId && (typeof salespersonId !== 'string' || salespersonId.trim() === '')) {
    throw new Error('salespersonId must be a non-empty string if provided');
  }

  return {
    tenantId: tenantId.trim(),
    userId: userId?.trim(),
    status: status?.map(s => s.trim()),
    type: type?.map(t => t.trim()),
    category: category?.map(c => c.trim()),
    priority: priority?.map(p => p.trim()),
    startDate,
    endDate,
    dueDate,
    aiGenerated,
    quotaCategory: quotaCategory?.map(q => q.trim()),
    orderBy: orderBy.trim(),
    orderDirection,
    limit,
    dealId: dealId?.trim(),
    companyId: companyId?.trim(),
    contactId: contactId?.trim(),
    salespersonId: salespersonId?.trim(),
    tags: tags?.map(t => t.trim())
  };
}

/**
 * Build Firestore query safely with filter limits
 */
function buildQuerySafely(
  tenantId: string,
  filters: any,
  orderBy: string,
  orderDirection: 'asc' | 'desc',
  limit: number
): admin.firestore.Query {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('buildQuerySafely', 0.001);

  let q: admin.firestore.Query = db.collection('tenants').doc(tenantId).collection('tasks');
  let filterCount = 0;

  // Apply filters with limits
  if (filters.userId && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('assignedTo', '==', filters.userId);
    filterCount++;
  }

  if (filters.status && filters.status.length > 0 && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('status', 'in', filters.status);
    filterCount++;
  }

  if (filters.type && filters.type.length > 0 && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('type', 'in', filters.type);
    filterCount++;
  }

  if (filters.category && filters.category.length > 0 && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('category', 'in', filters.category);
    filterCount++;
  }

  if (filters.priority && filters.priority.length > 0 && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('priority', 'in', filters.priority);
    filterCount++;
  }

  if (filters.startDate && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('scheduledDate', '>=', filters.startDate);
    filterCount++;
  }

  if (filters.endDate && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('scheduledDate', '<=', filters.endDate);
    filterCount++;
  }

  if (filters.dueDate && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('dueDate', '==', filters.dueDate);
    filterCount++;
  }

  if (filters.aiGenerated !== undefined && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('aiGenerated', '==', filters.aiGenerated);
    filterCount++;
  }

  if (filters.quotaCategory && filters.quotaCategory.length > 0 && filterCount < SAFE_CONFIG.MAX_FILTERS) {
    q = q.where('quotaCategory', 'in', filters.quotaCategory);
    filterCount++;
  }

  // Apply ordering
  q = q.orderBy(orderBy, orderDirection);

  // Apply limit
  q = q.limit(limit);

  return q;
}

/**
 * Apply client-side filters safely
 */
function applyClientFiltersSafely(tasks: any[], filters: any): any[] {
  SafeFunctionUtils.checkSafetyLimits();
  CostTracker.trackOperation('applyClientFiltersSafely', 0.001);

  let filteredTasks = tasks;
  let filterCount = 0;

  // Apply association filters (client-side filtering) with limits
  if (filters.dealId && filterCount < SAFE_CONFIG.MAX_CLIENT_FILTERS) {
    filteredTasks = filteredTasks.filter(task => task.associations?.deals?.includes(filters.dealId));
    filterCount++;
  }

  if (filters.companyId && filterCount < SAFE_CONFIG.MAX_CLIENT_FILTERS) {
    filteredTasks = filteredTasks.filter(task => task.associations?.companies?.includes(filters.companyId));
    filterCount++;
  }

  if (filters.contactId && filterCount < SAFE_CONFIG.MAX_CLIENT_FILTERS) {
    filteredTasks = filteredTasks.filter(task => task.associations?.contacts?.includes(filters.contactId));
    filterCount++;
  }

  if (filters.salespersonId && filterCount < SAFE_CONFIG.MAX_CLIENT_FILTERS) {
    filteredTasks = filteredTasks.filter(task => task.associations?.salespeople?.includes(filters.salespersonId));
    filterCount++;
  }

  if (filters.tags && filters.tags.length > 0 && filterCount < SAFE_CONFIG.MAX_CLIENT_FILTERS) {
    filteredTasks = filteredTasks.filter(task => 
      task.tags && filters.tags.some((tag: string) => task.tags.includes(tag))
    );
    filterCount++;
  }

  return filteredTasks;
}

// Cache for tasks queries
const tasksCache = new Map<string, { data: any; timestamp: number }>();
const TASKS_CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes cache

// Cleanup cache every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tasksCache.entries()) {
    if (now - value.timestamp > TASKS_CACHE_DURATION_MS) {
      tasksCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Safe version of getTasks with hardening playbook compliance and caching
 */
export const getTasks = onCall(
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  },
  async (request) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Validate input
      const validatedFilters = validateInput(request.data);

      // Create cache key
      const cacheKey = `tasks_${validatedFilters.tenantId}_${JSON.stringify(validatedFilters)}`;
      
      // Check cache first
      const cached = tasksCache.get(cacheKey);
      const now = Date.now();
      if (cached && (now - cached.timestamp) < TASKS_CACHE_DURATION_MS) {
        console.log('Tasks served from cache for tenant:', validatedFilters.tenantId);
        return cached.data;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      let tasks: any[] = [];

      try {
        // Build query safely
        const query = buildQuerySafely(
          validatedFilters.tenantId,
          validatedFilters,
          validatedFilters.orderBy,
          validatedFilters.orderDirection,
          validatedFilters.limit
        );

        // Check abort signal
        if (abort.aborted) {
          throw new Error('Function execution timeout');
        }

        // Execute query
        const snapshot = await query.get();
        tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Check abort signal
        if (abort.aborted) {
          throw new Error('Function execution timeout');
        }

        // Apply client-side filters safely
        tasks = applyClientFiltersSafely(tasks, validatedFilters);

      } catch (indexError: any) {
        console.warn('Index not ready for tasks query, returning empty results:', indexError.message);
        tasks = [];
      }

      const costSummary = CostTracker.getCostSummary();
      console.log(`Tasks retrieved for ${validatedFilters.tenantId}, Count: ${tasks.length}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

      const result = { 
        tasks, 
        success: true,
        _metadata: {
          tenantId: validatedFilters.tenantId,
          count: tasks.length,
          limit: validatedFilters.limit,
          processedBy: SAFE_CONFIG.TAG,
          cost: costSummary.estimatedCost
        }
      };

      // Cache the result
      tasksCache.set(cacheKey, { data: result, timestamp: now });

      return result;

    } catch (error) {
      console.error('Error in getTasks:', error);
      throw new Error(`Failed to fetch tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);
