import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Safety configuration
const SAFETY_CONFIG = {
  MAX_EXECUTION_TIME: 540, // 9 minutes (Firebase limit is 10 minutes)
  MAX_DOCUMENTS_PER_BATCH: 500,
  MAX_RECURSIVE_CALLS: 3,
  MAX_CONCURRENT_OPERATIONS: 10,
  RATE_LIMIT_PER_MINUTE: 100,
  COST_LIMIT_PER_CALL: 0.01, // $0.01 USD per function call
};

// Safety utilities
export class SafeFunctionUtils {
  private static executionStartTime = Date.now();
  private static recursiveCallCount = 0;
  private static operationCount = 0;
  private static lastCallTime = 0;

  /**
   * Check if function execution should be aborted due to safety limits
   */
  static checkSafetyLimits(): void {
    const currentTime = Date.now();
    const executionTime = currentTime - this.executionStartTime;

    // Check execution time
    if (executionTime > SAFETY_CONFIG.MAX_EXECUTION_TIME * 1000) {
      throw new HttpsError('deadline-exceeded', 'Function execution time exceeded safety limit');
    }

    // Check recursive calls
    if (this.recursiveCallCount > SAFETY_CONFIG.MAX_RECURSIVE_CALLS) {
      throw new HttpsError('resource-exhausted', 'Maximum recursive calls exceeded');
    }

    // Check operation count
    if (this.operationCount > SAFETY_CONFIG.MAX_CONCURRENT_OPERATIONS) {
      throw new HttpsError('resource-exhausted', 'Maximum concurrent operations exceeded');
    }

    // Check rate limiting
    const timeSinceLastCall = currentTime - this.lastCallTime;
    if (timeSinceLastCall < (60 * 1000 / SAFETY_CONFIG.RATE_LIMIT_PER_MINUTE)) {
      throw new HttpsError('resource-exhausted', 'Rate limit exceeded');
    }

    this.lastCallTime = currentTime;
  }

  /**
   * Increment operation counter
   */
  static incrementOperationCount(): void {
    this.operationCount++;
  }

  /**
   * Decrement operation counter
   */
  static decrementOperationCount(): void {
    this.operationCount = Math.max(0, this.operationCount - 1);
  }

  /**
   * Increment recursive call counter
   */
  static incrementRecursiveCallCount(): number {
    this.recursiveCallCount++;
    return this.recursiveCallCount;
  }

  /**
   * Reset counters for new function execution
   */
  static resetCounters(): void {
    this.executionStartTime = Date.now();
    this.recursiveCallCount = 0;
    this.operationCount = 0;
  }

  /**
   * Safe batch operation with limits
   */
  static async safeBatchOperation<T>(
    items: T[],
    operation: (batch: admin.firestore.WriteBatch, item: T) => void,
    batchSize: number = SAFETY_CONFIG.MAX_DOCUMENTS_PER_BATCH
  ): Promise<void> {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = db.batch();
      const batchItems = items.slice(i, i + batchSize);
      
      batchItems.forEach(item => operation(batch, item));
      batches.push(batch);
    }

    // Execute batches with safety checks
    for (const batch of batches) {
      this.checkSafetyLimits();
      await batch.commit();
    }
  }

  /**
   * Safe query with limits
   */
  static async safeQuery<T>(
    query: admin.firestore.Query,
    limit: number = SAFETY_CONFIG.MAX_DOCUMENTS_PER_BATCH
  ): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    this.checkSafetyLimits();
    const snapshot = await query.limit(limit).get();
    return snapshot.docs;
  }

  /**
   * Check if document update would cause infinite loop
   */
  static async checkForInfiniteLoop(
    collectionPath: string,
    documentId: string,
    updateData: any,
    maxChecks: number = 5
  ): Promise<boolean> {
    try {
      const docRef = db.collection(collectionPath).doc(documentId);
      const doc = await docRef.get();
      
      if (!doc.exists) return false;

      const currentData = doc.data();
      let checkCount = 0;
      let currentDoc = doc;

      // Check recent update history
      while (checkCount < maxChecks) {
        const lastUpdate = currentDoc.data()?.lastUpdated || currentDoc.data()?.updatedAt;
        if (!lastUpdate) break;

        // If the update would trigger the same function again, it's a potential loop
        if (this.wouldTriggerSameFunction(updateData, currentData)) {
          return true;
        }

        checkCount++;
      }

      return false;
    } catch (error) {
      console.error('Error checking for infinite loop:', error);
      return false; // Fail safe - assume no loop
    }
  }

  /**
   * Check if an update would trigger the same function
   */
  private static wouldTriggerSameFunction(newData: any, currentData: any): boolean {
    // Add logic to detect if the update would trigger the same function
    // This is a simplified check - you can enhance it based on your specific triggers
    const triggerFields = ['activeSalespeople', 'associations', 'lastUpdated', 'updatedAt'];
    
    for (const field of triggerFields) {
      if (newData[field] && currentData[field] && 
          JSON.stringify(newData[field]) !== JSON.stringify(currentData[field])) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Add safety metadata to document updates
   */
  static addSafetyMetadata(updateData: any): any {
    return {
      ...updateData,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      safetyCheck: {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        functionName: process.env.FUNCTION_NAME || 'unknown',
        executionId: Date.now().toString(),
        recursiveCallCount: this.recursiveCallCount
      }
    };
  }
}

// Safe callable function wrapper
export function createSafeCallableFunction<T = any, R = any>(
  handler: (data: T, context: any) => Promise<R>
) {
  return onCall({
    timeoutSeconds: SAFETY_CONFIG.MAX_EXECUTION_TIME,
    memory: '256MiB',
    maxInstances: 10
  }, async (request) => {
    SafeFunctionUtils.resetCounters();
    
    try {
      SafeFunctionUtils.checkSafetyLimits();
      return await handler(request.data, request);
    } catch (error) {
      console.error('Safe function error:', error);
      throw new HttpsError('internal', 'Function execution failed');
    }
  });
}

// Safe Firestore trigger wrapper
export function createSafeFirestoreTrigger<T = any>(
  handler: (event: any) => Promise<void>,
  options: {
    timeoutSeconds?: number;
    memory?: string;
    maxInstances?: number;
  } = {}
) {
  const defaultOptions = {
    timeoutSeconds: SAFETY_CONFIG.MAX_EXECUTION_TIME,
    memory: '256MiB',
    maxInstances: 10,
    ...options
  };

  return {
    onDocumentCreated: (path: string) => onDocumentCreated(path, async (event) => {
      SafeFunctionUtils.resetCounters();
      const callCount = SafeFunctionUtils.incrementRecursiveCallCount();
      
      try {
        SafeFunctionUtils.checkSafetyLimits();
        await handler(event);
      } catch (error) {
        console.error('Safe Firestore trigger error:', error);
        // Don't throw - Firestore triggers should fail gracefully
      }
    }),

    onDocumentUpdated: (path: string) => onDocumentUpdated(path, async (event) => {
      SafeFunctionUtils.resetCounters();
      const callCount = SafeFunctionUtils.incrementRecursiveCallCount();
      
      try {
        SafeFunctionUtils.checkSafetyLimits();
        await handler(event);
      } catch (error) {
        console.error('Safe Firestore trigger error:', error);
        // Don't throw - Firestore triggers should fail gracefully
      }
    }),

    onDocumentDeleted: (path: string) => onDocumentDeleted(path, async (event) => {
      SafeFunctionUtils.resetCounters();
      const callCount = SafeFunctionUtils.incrementRecursiveCallCount();
      
      try {
        SafeFunctionUtils.checkSafetyLimits();
        await handler(event);
      } catch (error) {
        console.error('Safe Firestore trigger error:', error);
        // Don't throw - Firestore triggers should fail gracefully
      }
    })
  };
}

// Cost tracking utility
export class CostTracker {
  private static startTime = Date.now();
  private static operations = 0;
  private static estimatedCost = 0;

  static trackOperation(operationType: string, estimatedCost: number = 0.0001): void {
    this.operations++;
    this.estimatedCost += estimatedCost;

    // Log if approaching cost limit
    if (this.estimatedCost > SAFETY_CONFIG.COST_LIMIT_PER_CALL) {
      console.warn(`Function approaching cost limit: $${this.estimatedCost.toFixed(4)}`);
    }
  }

  static getCostSummary(): { operations: number; estimatedCost: number; executionTime: number } {
    return {
      operations: this.operations,
      estimatedCost: this.estimatedCost,
      executionTime: Date.now() - this.startTime
    };
  }

  static reset(): void {
    this.startTime = Date.now();
    this.operations = 0;
    this.estimatedCost = 0;
  }
}
