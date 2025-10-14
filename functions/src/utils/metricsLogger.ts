import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Metrics Logger - Structured logging utility for cost tracking and monitoring
 * 
 * Features:
 * - Structured JSON logging for Cloud Logging queries
 * - BigQuery-ready format for billing analysis
 * - Function execution metrics
 * - Cost estimation helpers
 */

export interface FunctionMetrics {
  functionName: string;
  executionId?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
  itemsProcessed?: number;
  firestoreReads?: number;
  firestoreWrites?: number;
  estimatedCostUSD?: number;
  metadata?: Record<string, any>;
}

export interface CostEstimate {
  firestoreReads: number;
  firestoreWrites: number;
  functionInvocations: number;
  functionGBSeconds: number;
  totalEstimatedUSD: number;
}

// Pricing constants (as of 2024)
const PRICING = {
  FIRESTORE_READ: 0.06 / 100000, // $0.06 per 100k reads
  FIRESTORE_WRITE: 0.18 / 100000, // $0.18 per 100k writes
  FIRESTORE_DELETE: 0.02 / 100000, // $0.02 per 100k deletes
  FUNCTION_INVOCATION: 0.40 / 1000000, // $0.40 per million invocations
  FUNCTION_GB_SECOND: 0.0000025, // $0.0000025 per GB-second
  FUNCTION_GHZ_SECOND: 0.0000100, // $0.0000100 per GHz-second
};

/**
 * Log structured function metrics to Cloud Logging
 */
export function logMetrics(metrics: FunctionMetrics): void {
  const structuredLog = {
    severity: metrics.success ? 'INFO' : 'ERROR',
    message: `Function execution: ${metrics.functionName}`,
    'logging.googleapis.com/labels': {
      function_name: metrics.functionName,
      success: String(metrics.success)
    },
    metrics: {
      ...metrics,
      timestamp: new Date().toISOString()
    }
  };
  
  if (metrics.success) {
    logger.info(structuredLog.message, structuredLog.metrics);
  } else {
    logger.error(structuredLog.message, structuredLog.metrics);
  }
}

/**
 * Estimate cost of function execution
 */
export function estimateCost(
  firestoreReads: number,
  firestoreWrites: number,
  durationMs: number,
  memoryMB: number = 256
): CostEstimate {
  const memoryGB = memoryMB / 1024;
  const durationSeconds = durationMs / 1000;
  const gbSeconds = memoryGB * durationSeconds;
  
  const readCost = firestoreReads * PRICING.FIRESTORE_READ;
  const writeCost = firestoreWrites * PRICING.FIRESTORE_WRITE;
  const invocationCost = PRICING.FUNCTION_INVOCATION;
  const computeCost = gbSeconds * PRICING.FUNCTION_GB_SECOND;
  
  return {
    firestoreReads,
    firestoreWrites,
    functionInvocations: 1,
    functionGBSeconds: gbSeconds,
    totalEstimatedUSD: readCost + writeCost + invocationCost + computeCost
  };
}

/**
 * Track function execution with automatic metrics
 */
export class FunctionExecutionTracker {
  private startTime: number;
  private functionName: string;
  private firestoreReads: number = 0;
  private firestoreWrites: number = 0;
  private metadata: Record<string, any> = {};
  
  constructor(functionName: string) {
    this.functionName = functionName;
    this.startTime = Date.now();
  }
  
  trackFirestoreRead(count: number = 1): void {
    this.firestoreReads += count;
  }
  
  trackFirestoreWrite(count: number = 1): void {
    this.firestoreWrites += count;
  }
  
  addMetadata(key: string, value: any): void {
    this.metadata[key] = value;
  }
  
  complete(success: boolean, errorMessage?: string, itemsProcessed?: number): FunctionMetrics {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;
    
    const costEstimate = estimateCost(
      this.firestoreReads,
      this.firestoreWrites,
      durationMs
    );
    
    const metrics: FunctionMetrics = {
      functionName: this.functionName,
      startTime: this.startTime,
      endTime,
      durationMs,
      success,
      errorMessage,
      itemsProcessed,
      firestoreReads: this.firestoreReads,
      firestoreWrites: this.firestoreWrites,
      estimatedCostUSD: costEstimate.totalEstimatedUSD,
      metadata: this.metadata
    };
    
    logMetrics(metrics);
    return metrics;
  }
}

/**
 * Create daily roll-up of function metrics
 */
export async function createDailyRollup(date: Date = new Date()): Promise<void> {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    // Query all function runs from the date
    const runsSnapshot = await db.collection('function_runs')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(dateStr)))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(new Date(date.getTime() + 86400000)))
      .get();
    
    const rollup: Record<string, any> = {
      date: dateStr,
      totalRuns: runsSnapshot.size,
      byFunction: {} as Record<string, { count: number; totalDurationMs: number; errors: number }>
    };
    
    runsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const functionName = data.type || 'unknown';
      
      if (!rollup.byFunction[functionName]) {
        rollup.byFunction[functionName] = {
          count: 0,
          totalDurationMs: 0,
          errors: 0
        };
      }
      
      rollup.byFunction[functionName].count++;
      if (data.summary?.overallDurationMs) {
        rollup.byFunction[functionName].totalDurationMs += data.summary.overallDurationMs;
      }
      if (data.summary?.failedTasks) {
        rollup.byFunction[functionName].errors += data.summary.failedTasks;
      }
    });
    
    // Store rollup
    await db.collection('metrics_rollups').doc(dateStr).set(rollup);
    
    logger.info('Daily rollup created', { date: dateStr, totalRuns: rollup.totalRuns });
  } catch (error: any) {
    logger.error('Error creating daily rollup', { date: dateStr, error: error.message });
    throw error;
  }
}

/**
 * Query metrics for a date range
 */
export async function queryMetrics(startDate: Date, endDate: Date): Promise<any[]> {
  try {
    const snapshot = await db.collection('metrics_rollups')
      .where('date', '>=', startDate.toISOString().split('T')[0])
      .where('date', '<=', endDate.toISOString().split('T')[0])
      .orderBy('date', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  } catch (error: any) {
    logger.error('Error querying metrics', { error: error.message });
    return [];
  }
}

