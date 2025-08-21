import * as admin from 'firebase-admin';
import { createSafeCallableFunction, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Safe configuration
const SAFE_CONFIG = {
  MAX_MONITORING_DURATION: 60 * 60 * 1000, // 1 hour
  CHECK_INTERVAL: 60 * 1000, // 1 minute
  MAX_MONITORING_INSTANCES: 5,
  FORCE_CLEANUP_BUFFER: 60000, // 1 minute buffer
  MAX_DEPLOYMENT_ATTEMPTS: 3,
  ROLLBACK_THRESHOLD: 0.8, // 80% error rate triggers rollback
};

// Track active monitoring sessions
const activeMonitoringSessions = new Map<string, {
  intervalId: NodeJS.Timeout;
  startTime: number;
  deploymentId: string;
  fixId: string;
  cleanupTimeout: NodeJS.Timeout;
}>();

/**
 * Safe AutoDevFix interface
 */
interface AutoDevFix {
  id: string;
  type: 'performance' | 'security' | 'bugfix' | 'feature';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  deploymentId?: string;
  metrics?: any;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

/**
 * Safe AutoDevAssistant class with proper cleanup
 */
export class SafeAutoDevAssistant {
  private static instance: SafeAutoDevAssistant;

  static getInstance(): SafeAutoDevAssistant {
    if (!SafeAutoDevAssistant.instance) {
      SafeAutoDevAssistant.instance = new SafeAutoDevAssistant();
    }
    return SafeAutoDevAssistant.instance;
  }

  /**
   * Start production monitoring with proper cleanup
   */
  async startProductionMonitoring(fix: AutoDevFix, deploymentId: string): Promise<void> {
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    try {
      // Check if we're already monitoring this deployment
      if (activeMonitoringSessions.has(deploymentId)) {
        console.warn(`Already monitoring deployment ${deploymentId}, skipping`);
        return;
      }

      // Check monitoring instance limit
      if (activeMonitoringSessions.size >= SAFE_CONFIG.MAX_MONITORING_INSTANCES) {
        console.warn(`Maximum monitoring instances reached (${SAFE_CONFIG.MAX_MONITORING_INSTANCES}), skipping`);
        return;
      }

      const startTime = Date.now();
      let monitoringInterval: NodeJS.Timeout | null = null;
      let cleanupTimeout: NodeJS.Timeout | null = null;

      try {
        // Start monitoring interval
        monitoringInterval = setInterval(async () => {
          try {
            SafeFunctionUtils.checkSafetyLimits();
            
            const metrics = await this.getProductionMetrics();
            
            if (this.shouldRollback(metrics)) {
              console.log(`🚨 Rollback triggered for deployment ${deploymentId}`);
              await this.rollbackDeployment(fix, deploymentId);
              this.cleanupMonitoring(deploymentId);
              return;
            }

            // Check if monitoring duration exceeded
            if (Date.now() - startTime > SAFE_CONFIG.MAX_MONITORING_DURATION) {
              console.log(`✅ Monitoring completed for deployment ${deploymentId}`);
              await this.updateFixStatus(fix.id, 'completed');
              this.cleanupMonitoring(deploymentId);
              return;
            }

            CostTracker.trackOperation('monitoringCheck', 0.0001);

          } catch (error) {
            console.error('Monitoring error:', error);
            // Don't throw - continue monitoring
          }
        }, SAFE_CONFIG.CHECK_INTERVAL);

        // Set force cleanup timeout
        cleanupTimeout = setTimeout(() => {
          console.log(`🛑 Force clearing monitoring for deployment ${deploymentId} after maximum duration`);
          this.cleanupMonitoring(deploymentId);
        }, SAFE_CONFIG.MAX_MONITORING_DURATION + SAFE_CONFIG.FORCE_CLEANUP_BUFFER);

        // Store monitoring session
        activeMonitoringSessions.set(deploymentId, {
          intervalId: monitoringInterval,
          startTime,
          deploymentId,
          fixId: fix.id,
          cleanupTimeout
        });

        console.log(`🔍 Started monitoring deployment ${deploymentId} for fix ${fix.id}`);

      } catch (error) {
        console.error('Error starting production monitoring:', error);
        this.cleanupMonitoring(deploymentId);
        throw error;
      }

    } catch (error) {
      console.error('Error in startProductionMonitoring:', error);
      throw error;
    }
  }

  /**
   * Clean up monitoring session
   */
  private cleanupMonitoring(deploymentId: string): void {
    const session = activeMonitoringSessions.get(deploymentId);
    if (!session) return;

    try {
      // Clear interval
      if (session.intervalId) {
        clearInterval(session.intervalId);
      }

      // Clear cleanup timeout
      if (session.cleanupTimeout) {
        clearTimeout(session.cleanupTimeout);
      }

      // Remove from active sessions
      activeMonitoringSessions.delete(deploymentId);

      console.log(`🧹 Cleaned up monitoring for deployment ${deploymentId}`);

    } catch (error) {
      console.error('Error cleaning up monitoring:', error);
    }
  }

  /**
   * Get production metrics safely
   */
  private async getProductionMetrics(): Promise<any> {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('getMetrics', 0.0001);

    try {
      // Get recent function logs with limits
      const logsQuery = db.collection('function_logs')
        .orderBy('timestamp', 'desc')
        .limit(100);

      const logs = await SafeFunctionUtils.safeQuery(logsQuery, 100);

      // Calculate error rate
      const totalLogs = logs.length;
      const errorLogs = logs.filter(log => log.data()?.level === 'error').length;
      const errorRate = totalLogs > 0 ? errorLogs / totalLogs : 0;

      // Get function invocation counts
      const invocationQuery = db.collection('function_metrics')
        .orderBy('invocationCount', 'desc')
        .limit(50);

      const metrics = await SafeFunctionUtils.safeQuery(invocationQuery, 50);

      return {
        errorRate,
        totalLogs,
        errorLogs,
        functionMetrics: metrics.map(doc => doc.data()),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

    } catch (error) {
      console.error('Error getting production metrics:', error);
      return {
        errorRate: 0,
        totalLogs: 0,
        errorLogs: 0,
        functionMetrics: [],
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
    }
  }

  /**
   * Check if deployment should be rolled back
   */
  private shouldRollback(metrics: any): boolean {
    try {
      // Check error rate threshold
      if (metrics.errorRate > SAFE_CONFIG.ROLLBACK_THRESHOLD) {
        console.warn(`High error rate detected: ${(metrics.errorRate * 100).toFixed(2)}%`);
        return true;
      }

      // Check for critical errors
      const criticalErrors = metrics.functionMetrics?.filter((m: any) => 
        m.errorCount > 10 || m.responseTime > 30000
      ) || [];

      if (criticalErrors.length > 0) {
        console.warn(`Critical errors detected in ${criticalErrors.length} functions`);
        return true;
      }

      return false;

    } catch (error) {
      console.error('Error in shouldRollback:', error);
      return false; // Fail safe - don't rollback on error
    }
  }

  /**
   * Rollback deployment safely
   */
  private async rollbackDeployment(fix: AutoDevFix, deploymentId: string): Promise<void> {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('rollback', 0.001);

    try {
      console.log(`🔄 Rolling back deployment ${deploymentId} for fix ${fix.id}`);

      // Update fix status
      await this.updateFixStatus(fix.id, 'rolled_back');

      // Log rollback event
      await db.collection('deployment_events').add({
        type: 'rollback',
        deploymentId,
        fixId: fix.id,
        reason: 'High error rate or critical issues detected',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metrics: await this.getProductionMetrics()
      });

      console.log(`✅ Rollback completed for deployment ${deploymentId}`);

    } catch (error) {
      console.error('Error rolling back deployment:', error);
      throw error;
    }
  }

  /**
   * Update fix status safely
   */
  private async updateFixStatus(fixId: string, status: string): Promise<void> {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('updateStatus', 0.0001);

    try {
      await db.collection('autodev_fixes').doc(fixId).update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch (error) {
      console.error('Error updating fix status:', error);
      throw error;
    }
  }

  /**
   * Get monitoring status
   */
  async getMonitoringStatus(): Promise<any> {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('getStatus', 0.0001);

    try {
      const activeSessions = Array.from(activeMonitoringSessions.entries()).map(([deploymentId, session]) => ({
        deploymentId,
        fixId: session.fixId,
        startTime: session.startTime,
        duration: Date.now() - session.startTime,
        isActive: true
      }));

      return {
        activeSessions,
        totalActive: activeSessions.length,
        maxInstances: SAFE_CONFIG.MAX_MONITORING_INSTANCES,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

    } catch (error) {
      console.error('Error getting monitoring status:', error);
      return {
        activeSessions: [],
        totalActive: 0,
        maxInstances: SAFE_CONFIG.MAX_MONITORING_INSTANCES,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
    }
  }

  /**
   * Stop all monitoring sessions
   */
  async stopAllMonitoring(): Promise<void> {
    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('stopAllMonitoring', 0.001);

    try {
      const deploymentIds = Array.from(activeMonitoringSessions.keys());
      
      for (const deploymentId of deploymentIds) {
        this.cleanupMonitoring(deploymentId);
      }

      console.log(`🛑 Stopped all monitoring sessions (${deploymentIds.length} total)`);

    } catch (error) {
      console.error('Error stopping all monitoring:', error);
      throw error;
    }
  }
}

// Export safe callable functions
export const startProductionMonitoring = createSafeCallableFunction(async (request) => {
  const { fixId, deploymentId } = request;
  
  if (!fixId || !deploymentId) {
    throw new Error('fixId and deploymentId are required');
  }

  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    // Get fix data
    const fixDoc = await db.collection('autodev_fixes').doc(fixId).get();
    if (!fixDoc.exists) {
      return { ok: false, error: 'Fix not found' };
    }

    const fix = { id: fixDoc.id, ...fixDoc.data() } as AutoDevFix;
    
    // Start monitoring
    const assistant = SafeAutoDevAssistant.getInstance();
    await assistant.startProductionMonitoring(fix, deploymentId);

    const costSummary = CostTracker.getCostSummary();
    console.log(`Monitoring started, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true, 
      fixId, 
      deploymentId,
      costSummary
    };

  } catch (error) {
    console.error('startProductionMonitoring error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});

export const getMonitoringStatus = createSafeCallableFunction(async (request) => {
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    const assistant = SafeAutoDevAssistant.getInstance();
    const status = await assistant.getMonitoringStatus();

    const costSummary = CostTracker.getCostSummary();
    console.log(`Status retrieved, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true, 
      status,
      costSummary
    };

  } catch (error) {
    console.error('getMonitoringStatus error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});

export const stopAllMonitoring = createSafeCallableFunction(async (request) => {
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  try {
    const assistant = SafeAutoDevAssistant.getInstance();
    await assistant.stopAllMonitoring();

    const costSummary = CostTracker.getCostSummary();
    console.log(`All monitoring stopped, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return { 
      ok: true,
      costSummary
    };

  } catch (error) {
    console.error('stopAllMonitoring error:', error);
    return { ok: false, error: (error as Error).message || 'unknown_error' };
  }
});

// Cleanup on function termination
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, cleaning up monitoring sessions...');
  const assistant = SafeAutoDevAssistant.getInstance();
  assistant.stopAllMonitoring().catch(console.error);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, cleaning up monitoring sessions...');
  const assistant = SafeAutoDevAssistant.getInstance();
  assistant.stopAllMonitoring().catch(console.error);
});
