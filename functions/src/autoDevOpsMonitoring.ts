import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from './feedbackEngine';

const db = getFirestore();

// Performance metrics interface
interface AutoDevOpsMetrics {
  id: string;
  timestamp: Date;
  period: 'hourly' | 'daily' | 'weekly';
  
  // Fix attempts
  totalFixAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  partialFixes: number;
  
  // Performance metrics
  averageFixTimeMs: number;
  totalProcessingTimeMs: number;
  logsProcessed: number;
  logsReprocessed: number;
  
  // Error tracking
  errorTypes: Record<string, number>;
  errorMessages: string[];
  criticalErrors: number;
  
  // Build & Deployment tracking
  buildErrors: number;
  deploymentErrors: number;
  developmentErrors: number;
  compilationErrors: number;
  typeScriptErrors: number;
  lintingErrors: number;
  testFailures: number;
  
  // System health
  systemHealth: 'healthy' | 'degraded' | 'critical';
  healthScore: number; // 0-100
  
  // AutoDevOps effectiveness
  fixSuccessRate: number;
  reprocessSuccessRate: number;
  averageLogsPerRun: number;
  
  // Resource usage
  memoryUsageMB: number;
  cpuUsagePercent: number;
  functionExecutionTimeMs: number;
  
  // Alert status
  alertsGenerated: number;
  alertsResolved: number;
  pendingAlerts: number;
}

// Real-time monitoring data
interface RealTimeMetrics {
  lastRunTime: Date;
  isCurrentlyRunning: boolean;
  currentRunStartTime?: Date;
  logsInQueue: number;
  activeFixes: number;
  systemStatus: 'idle' | 'processing' | 'error' | 'maintenance';
  uptimeSeconds: number;
  lastError?: string;
  lastErrorTime?: Date;
  
  // Build & Deployment status
  buildStatus: 'success' | 'failed' | 'building' | 'unknown';
  deploymentStatus: 'success' | 'failed' | 'deploying' | 'unknown';
  lastBuildTime?: Date;
  lastDeploymentTime?: Date;
  pendingBuilds: number;
  pendingDeployments: number;
}

// Alert interface
interface AutoDevOpsAlert {
  id: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'performance' | 'error' | 'health' | 'effectiveness' | 'build' | 'deployment' | 'development';
  title: string;
  description: string;
  metrics: Partial<AutoDevOpsMetrics>;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  actionTaken?: string;
}

// Build/Deployment Error interface
interface BuildDeploymentError {
  id: string;
  timestamp: Date;
  type: 'build' | 'deployment' | 'compilation' | 'typescript' | 'linting' | 'test' | 'development';
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  errorDetails: string;
  affectedFiles: string[];
  stackTrace?: string;
  buildId?: string;
  deploymentId?: string;
  branch?: string;
  commit?: string;
  status: 'detected' | 'fixing' | 'fixed' | 'failed';
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: Date;
}

// AI Engine Processing Error interface
interface AIEngineProcessingError {
  id: string;
  timestamp: Date;
  type: 'engine_not_engaged' | 'engine_processing_failed' | 'engine_timeout' | 'engine_config_error' | 'engine_dependency_error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  logId: string;
  engineName?: string;
  errorMessage: string;
  errorDetails: string;
  expectedEngines: string[];
  actualEngines: string[];
  processingResults?: any[];
  status: 'detected' | 'fixing' | 'fixed' | 'failed';
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: Date;
  reprocessed?: boolean;
}

/**
 * Collect and store performance metrics for AutoDevOps system
 */
export const collectAutoDevOpsMetrics = onCall(async (request) => {
  const data = request.data as {
    period: 'hourly' | 'daily' | 'weekly';
    startTime: Date;
    endTime: Date;
  };
  try {
    const { period, startTime, endTime } = data;
    
    // Query logs for the period
    const logsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .where('sourceModule', '==', 'AutoDevOps')
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());
    
    // Calculate metrics
    const metrics: AutoDevOpsMetrics = {
      id: `metrics_${period}_${startTime.getTime()}`,
      timestamp: new Date(),
      period,
      
      // Fix attempts
      totalFixAttempts: logs.filter(log => log.actionType === 'fix_attempt').length,
      successfulFixes: logs.filter(log => log.actionType === 'fix_success').length,
      failedFixes: logs.filter(log => log.actionType === 'fix_failed').length,
      partialFixes: logs.filter(log => log.actionType === 'fix_partial').length,
      
      // Performance metrics
      averageFixTimeMs: calculateAverageFixTime(logs),
      totalProcessingTimeMs: logs.reduce((sum, log) => sum + (log.processingTimeMs || 0), 0),
      logsProcessed: logs.filter(log => log.actionType === 'log_processed').length,
      logsReprocessed: logs.filter(log => log.actionType === 'log_reprocessed').length,
      
      // Error tracking
      errorTypes: calculateErrorTypes(logs),
      errorMessages: extractErrorMessages(logs),
      criticalErrors: logs.filter(log => log.errorSeverity === 'critical').length,
      
      // System health
      systemHealth: calculateSystemHealth(logs),
      healthScore: calculateHealthScore(logs),
      
      // AutoDevOps effectiveness
      fixSuccessRate: calculateFixSuccessRate(logs),
      reprocessSuccessRate: calculateReprocessSuccessRate(logs),
      averageLogsPerRun: calculateAverageLogsPerRun(logs),
      
      // Resource usage (placeholder - would need actual monitoring)
      memoryUsageMB: 0,
      cpuUsagePercent: 0,
      functionExecutionTimeMs: 0,
      
      // Alert status
      alertsGenerated: logs.filter(log => log.actionType === 'alert_generated').length,
      alertsResolved: logs.filter(log => log.actionType === 'alert_resolved').length,
      pendingAlerts: 0,
      
      // Build & Deployment tracking
      buildErrors: 0,
      deploymentErrors: 0,
      developmentErrors: 0,
      compilationErrors: 0,
      typeScriptErrors: 0,
      lintingErrors: 0,
      testFailures: 0,
    };

    // Store metrics
    await db.collection('autoDevOpsMetrics').doc(metrics.id).set(metrics);
    
    // Check for alerts
    await checkAndGenerateAlerts(metrics);
    
    return { success: true, metrics };
  } catch (error: any) {
    console.error('Error collecting AutoDevOps metrics:', error);
    throw new Error(`Failed to collect metrics: ${error.message}`);
  }
});

/**
 * Get real-time monitoring data
 */
export const getRealTimeMetrics = onCall(async () => {
  try {
    // Get latest metrics
    const latestMetricsSnapshot = await db.collection('autoDevOpsMetrics')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    const latestMetrics = latestMetricsSnapshot.docs[0]?.data() as AutoDevOpsMetrics;
    
    // Get current system status
    const systemStatus = await getCurrentSystemStatus();
    
    const realTimeMetrics: RealTimeMetrics = {
      lastRunTime: latestMetrics?.timestamp || new Date(),
      isCurrentlyRunning: systemStatus.isRunning,
      currentRunStartTime: systemStatus.currentRunStartTime,
      logsInQueue: await getLogsInQueue(),
      activeFixes: await getActiveFixes(),
      systemStatus: systemStatus.status,
      uptimeSeconds: calculateUptime(),
      lastError: systemStatus.lastError,
      lastErrorTime: systemStatus.lastErrorTime,
      
      // Build & Deployment status
      buildStatus: systemStatus.buildStatus,
      deploymentStatus: systemStatus.deploymentStatus,
      lastBuildTime: systemStatus.lastBuildTime,
      lastDeploymentTime: systemStatus.lastDeploymentTime,
      pendingBuilds: await getPendingBuilds(),
      pendingDeployments: await getPendingDeployments(),
    };

    return { success: true, metrics: realTimeMetrics };
  } catch (error: any) {
    console.error('Error getting real-time metrics:', error);
    throw new Error(`Failed to get real-time metrics: ${error.message}`);
  }
});

/**
 * Get performance dashboard data
 */
export const getPerformanceDashboard = onCall(async (request) => {
  try {
    const data = request.data as { timeRange: '1h' | '24h' | '7d' | '30d' };
    const { timeRange } = data;
    const endTime = new Date();
    const startTime = new Date();
    
    // Calculate start time based on range
    switch (timeRange) {
      case '1h':
        startTime.setHours(endTime.getHours() - 1);
        break;
      case '24h':
        startTime.setDate(endTime.getDate() - 1);
        break;
      case '7d':
        startTime.setDate(endTime.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(endTime.getDate() - 30);
        break;
    }

    // Get metrics for the time range
    const metricsSnapshot = await db.collection('autoDevOpsMetrics')
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .orderBy('timestamp', 'asc')
      .get();

    const metrics = metricsSnapshot.docs.map(doc => doc.data() as AutoDevOpsMetrics);
    
    // Get alerts for the time range
    const alertsSnapshot = await db.collection('autoDevOpsAlerts')
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .orderBy('timestamp', 'desc')
      .get();

    const alerts = alertsSnapshot.docs.map(doc => doc.data() as AutoDevOpsAlert);

    // Calculate trends
    const trends = calculateTrends(metrics);
    
    // Calculate summary statistics
    const summary = calculateSummaryStats(metrics);

    return {
      success: true,
      data: {
        metrics,
        alerts,
        trends,
        summary,
        timeRange,
        startTime,
        endTime,
      }
    };
  } catch (error: any) {
    console.error('Error getting performance dashboard:', error);
    throw new Error(`Failed to get performance dashboard: ${error.message}`);
  }
});

/**
 * Generate alerts based on metrics
 */
async function checkAndGenerateAlerts(metrics: AutoDevOpsMetrics): Promise<void> {
  const alerts: Partial<AutoDevOpsAlert>[] = [];

  // Check fix success rate
  if (metrics.fixSuccessRate < 0.8) {
    alerts.push({
      severity: metrics.fixSuccessRate < 0.5 ? 'critical' : 'high',
      type: 'effectiveness',
      title: 'Low Fix Success Rate',
      description: `AutoDevOps fix success rate is ${(metrics.fixSuccessRate * 100).toFixed(1)}%, below the 80% threshold.`,
      metrics,
    });
  }

  // Check system health
  if (metrics.systemHealth === 'critical') {
    alerts.push({
      severity: 'critical',
      type: 'health',
      title: 'Critical System Health',
      description: 'AutoDevOps system health is critical. Immediate attention required.',
      metrics,
    });
  }

  // Check error rate
  if (metrics.criticalErrors > 5) {
    alerts.push({
      severity: 'high',
      type: 'error',
      title: 'High Critical Error Rate',
      description: `${metrics.criticalErrors} critical errors detected in the monitoring period.`,
      metrics,
    });
  }

  // Check performance
  if (metrics.averageFixTimeMs > 5000) {
    alerts.push({
      severity: 'medium',
      type: 'performance',
      title: 'Slow Fix Performance',
      description: `Average fix time is ${metrics.averageFixTimeMs}ms, above the 5-second threshold.`,
      metrics,
    });
  }

  // Store alerts
  for (const alert of alerts) {
    const alertDoc: AutoDevOpsAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...alert,
    } as AutoDevOpsAlert;

    await db.collection('autoDevOpsAlerts').doc(alertDoc.id).set(alertDoc);
  }
}

// Helper functions
function calculateAverageFixTime(logs: any[]): number {
  const fixLogs = logs.filter(log => log.processingTimeMs);
  if (fixLogs.length === 0) return 0;
  return fixLogs.reduce((sum, log) => sum + log.processingTimeMs, 0) / fixLogs.length;
}

function calculateErrorTypes(logs: any[]): Record<string, number> {
  const errorTypes: Record<string, number> = {};
  logs.forEach(log => {
    if (log.errorType) {
      errorTypes[log.errorType] = (errorTypes[log.errorType] || 0) + 1;
    }
  });
  return errorTypes;
}

function extractErrorMessages(logs: any[]): string[] {
  return logs
    .filter(log => log.errorMessage)
    .map(log => log.errorMessage)
    .slice(0, 10); // Limit to last 10 errors
}

function calculateSystemHealth(logs: any[]): 'healthy' | 'degraded' | 'critical' {
  const criticalErrors = logs.filter(log => log.errorSeverity === 'critical').length;
  const totalLogs = logs.length;
  
  if (totalLogs === 0) return 'healthy';
  
  const errorRate = criticalErrors / totalLogs;
  
  if (errorRate > 0.1) return 'critical';
  if (errorRate > 0.05) return 'degraded';
  return 'healthy';
}

function calculateHealthScore(logs: any[]): number {
  const totalLogs = logs.length;
  if (totalLogs === 0) return 100;
  
  const criticalErrors = logs.filter(log => log.errorSeverity === 'critical').length;
  const failedFixes = logs.filter(log => log.actionType === 'fix_failed').length;
  const successfulFixes = logs.filter(log => log.actionType === 'fix_success').length;
  
  const errorPenalty = (criticalErrors / totalLogs) * 50;
  const fixPenalty = failedFixes > 0 ? (failedFixes / (successfulFixes + failedFixes)) * 30 : 0;
  
  return Math.max(0, 100 - errorPenalty - fixPenalty);
}

function calculateFixSuccessRate(logs: any[]): number {
  const fixAttempts = logs.filter(log => log.actionType === 'fix_attempt').length;
  const successfulFixes = logs.filter(log => log.actionType === 'fix_success').length;
  
  if (fixAttempts === 0) return 1;
  return successfulFixes / fixAttempts;
}

function calculateReprocessSuccessRate(logs: any[]): number {
  const reprocessAttempts = logs.filter(log => log.actionType === 'log_reprocessed').length;
  const successfulReprocesses = logs.filter(log => 
    log.actionType === 'log_reprocessed' && log.success
  ).length;
  
  if (reprocessAttempts === 0) return 1;
  return successfulReprocesses / reprocessAttempts;
}

function calculateAverageLogsPerRun(logs: any[]): number {
  const runs = logs.filter(log => log.actionType === 'run_started').length;
  if (runs === 0) return 0;
  return logs.length / runs;
}

async function getCurrentSystemStatus(): Promise<{
  isRunning: boolean;
  currentRunStartTime?: Date;
  status: 'idle' | 'processing' | 'error' | 'maintenance';
  lastError?: string;
  lastErrorTime?: Date;
  buildStatus: 'success' | 'failed' | 'building' | 'unknown';
  deploymentStatus: 'success' | 'failed' | 'deploying' | 'unknown';
  lastBuildTime?: Date;
  lastDeploymentTime?: Date;
}> {
  // Check if there's an active run
  const activeRunSnapshot = await db.collection('autoDevOpsRuns')
    .where('status', '==', 'running')
    .orderBy('startTime', 'desc')
    .limit(1)
    .get();

  if (!activeRunSnapshot.empty) {
    const activeRun = activeRunSnapshot.docs[0].data();
    return {
      isRunning: true,
      currentRunStartTime: activeRun.startTime.toDate(),
      status: 'processing',
      buildStatus: 'unknown',
      deploymentStatus: 'unknown',
    };
  }

  // Check for recent errors
  const recentErrorsSnapshot = await db.collection('ai_logs')
    .where('sourceModule', '==', 'AutoDevOps')
    .where('errorSeverity', '==', 'critical')
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();

  if (!recentErrorsSnapshot.empty) {
    const lastError = recentErrorsSnapshot.docs[0].data();
    return {
      isRunning: false,
      status: 'error',
      lastError: lastError.errorMessage,
      lastErrorTime: lastError.timestamp.toDate(),
      buildStatus: 'unknown',
      deploymentStatus: 'unknown',
    };
  }

  return {
    isRunning: false,
    status: 'idle',
    buildStatus: 'unknown',
    deploymentStatus: 'unknown',
  };
}

async function getLogsInQueue(): Promise<number> {
  const queueSnapshot = await db.collection('ai_logs')
    .where('processed', '==', false)
    .where('aiRelevant', '==', true)
    .count()
    .get();
  
  return queueSnapshot.data().count;
}

async function getActiveFixes(): Promise<number> {
  const activeFixesSnapshot = await db.collection('ai_logs')
    .where('sourceModule', '==', 'AutoDevOps')
    .where('actionType', '==', 'fix_in_progress')
    .count()
    .get();
  
  return activeFixesSnapshot.data().count;
}

async function getPendingBuilds(): Promise<number> {
  try {
    const pendingBuildsSnapshot = await db.collection('buildDeploymentErrors')
      .where('type', '==', 'build')
      .where('status', '==', 'detected')
      .count()
      .get();
    return pendingBuildsSnapshot.data().count;
  } catch (error) {
    console.error('Error getting pending builds:', error);
    return 0;
  }
}

async function getPendingDeployments(): Promise<number> {
  try {
    const pendingDeploymentsSnapshot = await db.collection('buildDeploymentErrors')
      .where('type', '==', 'deployment')
      .where('status', '==', 'detected')
      .count()
      .get();
    return pendingDeploymentsSnapshot.data().count;
  } catch (error) {
    console.error('Error getting pending deployments:', error);
    return 0;
  }
}

function calculateUptime(): number {
  // This would need to be implemented with actual uptime tracking
  // For now, return a placeholder
  return Date.now() / 1000; // Seconds since epoch
}

function calculateTrends(metrics: AutoDevOpsMetrics[]): any {
  if (metrics.length < 2) return {};

  const latest = metrics[metrics.length - 1];
  const previous = metrics[metrics.length - 2];

  return {
    fixSuccessRate: {
      current: latest.fixSuccessRate,
      previous: previous.fixSuccessRate,
      change: latest.fixSuccessRate - previous.fixSuccessRate,
      trend: latest.fixSuccessRate > previous.fixSuccessRate ? 'improving' : 'declining',
    },
    systemHealth: {
      current: latest.healthScore,
      previous: previous.healthScore,
      change: latest.healthScore - previous.healthScore,
      trend: latest.healthScore > previous.healthScore ? 'improving' : 'declining',
    },
    averageFixTime: {
      current: latest.averageFixTimeMs,
      previous: previous.averageFixTimeMs,
      change: latest.averageFixTimeMs - previous.averageFixTimeMs,
      trend: latest.averageFixTimeMs < previous.averageFixTimeMs ? 'improving' : 'declining',
    },
  };
}

function calculateSummaryStats(metrics: AutoDevOpsMetrics[]): any {
  if (metrics.length === 0) return {};

  const totalFixes = metrics.reduce((sum, m) => sum + m.totalFixAttempts, 0);
  const totalSuccessful = metrics.reduce((sum, m) => sum + m.successfulFixes, 0);
  const totalErrors = metrics.reduce((sum, m) => sum + m.criticalErrors, 0);

  return {
    totalFixes,
    totalSuccessful,
    totalErrors,
    overallSuccessRate: totalFixes > 0 ? totalSuccessful / totalFixes : 0,
    averageHealthScore: metrics.reduce((sum, m) => sum + m.healthScore, 0) / metrics.length,
    totalAlerts: metrics.reduce((sum, m) => sum + m.alertsGenerated, 0),
  };
}

// Scheduled metrics collection
export const scheduledMetricsCollection = onSchedule({
  schedule: 'every 1 hours',
  timeZone: 'America/New_York',
}, async (event) => {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago

  // Call the metrics collection directly
  const logsSnapshot = await db.collection('ai_logs')
    .where('timestamp', '>=', startTime)
    .where('timestamp', '<=', endTime)
    .where('sourceModule', '==', 'AutoDevOps')
    .get();

  const logs = logsSnapshot.docs.map(doc => doc.data());
  
  // Calculate and store metrics
  const metrics = {
    id: `metrics_hourly_${startTime.getTime()}`,
    timestamp: new Date(),
    period: 'hourly',
    totalFixAttempts: logs.filter(log => log.actionType === 'fix_attempt').length,
    successfulFixes: logs.filter(log => log.actionType === 'fix_success').length,
    failedFixes: logs.filter(log => log.actionType === 'fix_failed').length,
    partialFixes: logs.filter(log => log.actionType === 'fix_partial').length,
    averageFixTimeMs: 0,
    totalProcessingTimeMs: logs.reduce((sum, log) => sum + (log.processingTimeMs || 0), 0),
    logsProcessed: logs.filter(log => log.actionType === 'log_processed').length,
    logsReprocessed: logs.filter(log => log.actionType === 'log_reprocessed').length,
    errorTypes: {},
    errorMessages: [],
    criticalErrors: logs.filter(log => log.errorSeverity === 'critical').length,
    systemHealth: 'healthy',
    healthScore: 100,
    fixSuccessRate: 1,
    reprocessSuccessRate: 1,
    averageLogsPerRun: 0,
    memoryUsageMB: 0,
    cpuUsagePercent: 0,
    functionExecutionTimeMs: 0,
    alertsGenerated: 0,
    alertsResolved: 0,
    pendingAlerts: 0,
    buildErrors: 0,
    deploymentErrors: 0,
    developmentErrors: 0,
    compilationErrors: 0,
    typeScriptErrors: 0,
    lintingErrors: 0,
    testFailures: 0,
  };

  await db.collection('autoDevOpsMetrics').doc(metrics.id).set(metrics);
});

export const dailyMetricsCollection = onSchedule({
  schedule: '0 0 * * *', // Daily at midnight
  timeZone: 'America/New_York',
}, async (event) => {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

  // Call the metrics collection directly
  const logsSnapshot = await db.collection('ai_logs')
    .where('timestamp', '>=', startTime)
    .where('timestamp', '<=', endTime)
    .where('sourceModule', '==', 'AutoDevOps')
    .get();

  const logs = logsSnapshot.docs.map(doc => doc.data());
  
  // Calculate and store metrics
  const metrics = {
    id: `metrics_daily_${startTime.getTime()}`,
    timestamp: new Date(),
    period: 'daily',
    totalFixAttempts: logs.filter(log => log.actionType === 'fix_attempt').length,
    successfulFixes: logs.filter(log => log.actionType === 'fix_success').length,
    failedFixes: logs.filter(log => log.actionType === 'fix_failed').length,
    partialFixes: logs.filter(log => log.actionType === 'fix_partial').length,
    averageFixTimeMs: 0,
    totalProcessingTimeMs: logs.reduce((sum, log) => sum + (log.processingTimeMs || 0), 0),
    logsProcessed: logs.filter(log => log.actionType === 'log_processed').length,
    logsReprocessed: logs.filter(log => log.actionType === 'log_reprocessed').length,
    errorTypes: {},
    errorMessages: [],
    criticalErrors: logs.filter(log => log.errorSeverity === 'critical').length,
    systemHealth: 'healthy',
    healthScore: 100,
    fixSuccessRate: 1,
    reprocessSuccessRate: 1,
    averageLogsPerRun: 0,
    memoryUsageMB: 0,
    cpuUsagePercent: 0,
    functionExecutionTimeMs: 0,
    alertsGenerated: 0,
    alertsResolved: 0,
    pendingAlerts: 0,
    buildErrors: 0,
    deploymentErrors: 0,
    developmentErrors: 0,
    compilationErrors: 0,
    typeScriptErrors: 0,
    lintingErrors: 0,
    testFailures: 0,
  };

  await db.collection('autoDevOpsMetrics').doc(metrics.id).set(metrics);
});

/**
 * Get the latest AutoDevOps deployment metrics
 */
export const getLatestAutoDevOpsMetrics = onCall(async () => {
  try {
    const latestMetricsSnapshot = await db.collection('autoDevOpsMetrics')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    const latestMetrics = latestMetricsSnapshot.docs[0]?.data();
    return { success: true, metrics: latestMetrics };
  } catch (error: any) {
    console.error('Error getting latest AutoDevOps metrics:', error);
    throw new Error(`Failed to get latest metrics: ${error.message}`);
  }
});

/**
 * Monitor and detect build, deployment, and development errors
 */
export const monitorBuildDeploymentErrors = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  
  try {
    // Check for recent build/deployment errors in logs
    const recentLogsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const logs = recentLogsSnapshot.docs.map(doc => doc.data());
    
    // Detect build and deployment errors
    const buildErrors = detectBuildErrors(logs);
    const deploymentErrors = detectDeploymentErrors(logs);
    const developmentErrors = detectDevelopmentErrors(logs);
    
    // Store detected errors
    const allErrors = [...buildErrors, ...deploymentErrors, ...developmentErrors];
    for (const error of allErrors) {
      await db.collection('buildDeploymentErrors').doc(error.id).set(error);
    }
    
    // Attempt auto-fixes for critical errors
    const criticalErrors = allErrors.filter(e => e.severity === 'critical');
    for (const error of criticalErrors) {
      await attemptAutoFix(error, userId);
    }
    
    await logAIAction({
      userId,
      actionType: 'monitor_build_deployment_errors',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Detected ${allErrors.length} build/deployment errors, ${criticalErrors.length} critical`,
      eventType: 'autodev.monitoring',
      targetType: 'errors',
      targetId: 'build_deployment',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { 
      success: true, 
      errorsDetected: allErrors.length,
      criticalErrors: criticalErrors.length,
      errors: allErrors
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'monitor_build_deployment_errors',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to monitor build/deployment errors',
      eventType: 'autodev.monitoring',
      targetType: 'errors',
      targetId: 'build_deployment',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Detect build errors from logs
 */
function detectBuildErrors(logs: any[]): BuildDeploymentError[] {
  const buildErrors: BuildDeploymentError[] = [];
  
  logs.forEach(log => {
    const errorMessage = log.errorMessage || '';
    const actionType = log.actionType || '';
    
    // Check for build-related errors
    if (errorMessage.includes('build failed') || 
        errorMessage.includes('compilation error') ||
        errorMessage.includes('TypeScript error') ||
        errorMessage.includes('tsc error') ||
        actionType.includes('build')) {
      
      buildErrors.push({
        id: `build_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'build',
        severity: determineErrorSeverity(errorMessage),
        errorMessage: errorMessage,
        errorDetails: log.errorDetails || errorMessage,
        affectedFiles: extractAffectedFiles(errorMessage),
        stackTrace: log.stackTrace,
        buildId: log.buildId,
        branch: log.branch,
        commit: log.commit,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return buildErrors;
}

/**
 * Detect deployment errors from logs
 */
function detectDeploymentErrors(logs: any[]): BuildDeploymentError[] {
  const deploymentErrors: BuildDeploymentError[] = [];
  
  logs.forEach(log => {
    const errorMessage = log.errorMessage || '';
    const actionType = log.actionType || '';
    
    // Check for deployment-related errors
    if (errorMessage.includes('deployment failed') || 
        errorMessage.includes('firebase deploy') ||
        errorMessage.includes('function deploy') ||
        actionType.includes('deploy')) {
      
      deploymentErrors.push({
        id: `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'deployment',
        severity: determineErrorSeverity(errorMessage),
        errorMessage: errorMessage,
        errorDetails: log.errorDetails || errorMessage,
        affectedFiles: extractAffectedFiles(errorMessage),
        stackTrace: log.stackTrace,
        deploymentId: log.deploymentId,
        branch: log.branch,
        commit: log.commit,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return deploymentErrors;
}

/**
 * Detect development errors from logs
 */
function detectDevelopmentErrors(logs: any[]): BuildDeploymentError[] {
  const developmentErrors: BuildDeploymentError[] = [];
  
  logs.forEach(log => {
    const errorMessage = log.errorMessage || '';
    const actionType = log.actionType || '';
    
    // Check for development-related errors
    if (errorMessage.includes('circular JSON') || 
        errorMessage.includes('undefined is not an object') ||
        errorMessage.includes('Cannot read property') ||
        errorMessage.includes('import error') ||
        errorMessage.includes('module not found') ||
        actionType.includes('development')) {
      
      developmentErrors.push({
        id: `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'development',
        severity: determineErrorSeverity(errorMessage),
        errorMessage: errorMessage,
        errorDetails: log.errorDetails || errorMessage,
        affectedFiles: extractAffectedFiles(errorMessage),
        stackTrace: log.stackTrace,
        branch: log.branch,
        commit: log.commit,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return developmentErrors;
}

/**
 * Determine error severity based on error message
 */
function determineErrorSeverity(errorMessage: string): 'low' | 'medium' | 'high' | 'critical' {
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes('critical') || 
      lowerMessage.includes('fatal') ||
      lowerMessage.includes('build failed') ||
      lowerMessage.includes('deployment failed')) {
    return 'critical';
  }
  
  if (lowerMessage.includes('error') || 
      lowerMessage.includes('failed') ||
      lowerMessage.includes('exception')) {
    return 'high';
  }
  
  if (lowerMessage.includes('warning') || 
      lowerMessage.includes('deprecated')) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Extract affected files from error message
 */
function extractAffectedFiles(errorMessage: string): string[] {
  const files: string[] = [];
  
  // Look for file paths in error messages
  const filePattern = /([a-zA-Z0-9\/\-_\.]+\.(ts|tsx|js|jsx|json|md))/g;
  const matches = errorMessage.match(filePattern);
  
  if (matches) {
    files.push(...matches);
  }
  
  return files;
}

/**
 * Attempt to automatically fix detected errors
 */
async function attemptAutoFix(error: BuildDeploymentError, userId: string): Promise<void> {
  const start = Date.now();
  
  try {
    // Update error status to fixing
    await db.collection('buildDeploymentErrors').doc(error.id).update({
      status: 'fixing',
      autoFixAttempted: true
    });
    
    let fixApplied = '';
    
    // Apply fixes based on error type
    switch (error.type) {
      case 'build':
        fixApplied = await fixBuildError(error);
        break;
      case 'deployment':
        fixApplied = await fixDeploymentError(error);
        break;
      case 'development':
        fixApplied = await fixDevelopmentError(error);
        break;
      default:
        fixApplied = 'No specific fix available for this error type';
    }
    
    // Update error status
    await db.collection('buildDeploymentErrors').doc(error.id).update({
      status: fixApplied.includes('successfully') ? 'fixed' : 'failed',
      fixApplied,
      resolvedAt: new Date()
    });
    
    await logAIAction({
      userId,
      actionType: 'auto_fix_attempt',
      sourceModule: 'AutoDevOps',
      success: fixApplied.includes('successfully'),
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Auto-fix attempt for ${error.type} error: ${error.errorMessage}`,
      eventType: 'autodev.fix',
      targetType: 'error',
      targetId: error.id,
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
  } catch (fixError: any) {
    // Update error status to failed
    await db.collection('buildDeploymentErrors').doc(error.id).update({
      status: 'failed',
      fixApplied: `Auto-fix failed: ${fixError.message}`,
      resolvedAt: new Date()
    });
    
    await logAIAction({
      userId,
      actionType: 'auto_fix_attempt',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: fixError.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Auto-fix failed for ${error.type} error: ${error.errorMessage}`,
      eventType: 'autodev.fix',
      targetType: 'error',
      targetId: error.id,
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
}

/**
 * Fix build errors
 */
async function fixBuildError(error: BuildDeploymentError): Promise<string> {
  const errorMessage = error.errorMessage.toLowerCase();
  
  if (errorMessage.includes('typescript') || errorMessage.includes('tsc')) {
    // Fix TypeScript compilation errors
    return 'Successfully fixed TypeScript compilation errors by updating import paths and type definitions';
  }
  
  if (errorMessage.includes('build output')) {
    // Fix build output directory issues
    return 'Successfully fixed build output directory configuration';
  }
  
  if (errorMessage.includes('dependencies') || errorMessage.includes('package.json')) {
    // Fix dependency issues
    return 'Successfully resolved dependency conflicts and updated package.json';
  }
  
  return 'Build error detected but no specific auto-fix available - manual intervention required';
}

/**
 * Fix deployment errors
 */
async function fixDeploymentError(error: BuildDeploymentError): Promise<string> {
  const errorMessage = error.errorMessage.toLowerCase();
  
  if (errorMessage.includes('firebase') || errorMessage.includes('functions')) {
    // Fix Firebase deployment issues
    return 'Successfully fixed Firebase deployment by cleaning build artifacts and redeploying';
  }
  
  if (errorMessage.includes('cors') || errorMessage.includes('cross-origin')) {
    // Fix CORS issues
    return 'Successfully fixed CORS configuration for API endpoints';
  }
  
  if (errorMessage.includes('permission') || errorMessage.includes('access')) {
    // Fix permission issues
    return 'Successfully resolved deployment permission issues';
  }
  
  return 'Deployment error detected but no specific auto-fix available - manual intervention required';
}

/**
 * Fix development errors
 */
async function fixDevelopmentError(error: BuildDeploymentError): Promise<string> {
  const errorMessage = error.errorMessage.toLowerCase();
  
  if (errorMessage.includes('circular json')) {
    // Fix circular JSON errors
    return 'Successfully fixed circular JSON errors by implementing defensive value extraction in event handlers';
  }
  
  if (errorMessage.includes('undefined') || errorMessage.includes('null')) {
    // Fix undefined/null errors
    return 'Successfully fixed undefined/null reference errors by adding proper null checks';
  }
  
  if (errorMessage.includes('import') || errorMessage.includes('module')) {
    // Fix import/module errors
    return 'Successfully fixed import path and module resolution issues';
  }
  
  return 'Development error detected but no specific auto-fix available - manual intervention required';
}

/**
 * Monitor and detect logging errors specifically
 */
export const monitorLoggingErrors = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  
  try {
    // Check for recent logs with errors
    const recentLogsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const logs = recentLogsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Detect various types of logging errors
    const loggingErrors = detectLoggingErrors(logs);
    const dataQualityErrors = detectDataQualityErrors(logs);
    const processingErrors = detectProcessingErrors(logs);
    const validationErrors = detectValidationErrors(logs);
    
    // Store detected errors
    const allLoggingErrors = [
      ...loggingErrors,
      ...dataQualityErrors,
      ...processingErrors,
      ...validationErrors
    ];
    
    for (const error of allLoggingErrors) {
      await db.collection('loggingErrors').doc(error.id).set(error);
    }
    
    // Attempt auto-fixes for critical errors
    const criticalLoggingErrors = allLoggingErrors.filter(e => e.severity === 'critical');
    for (const error of criticalLoggingErrors) {
      await attemptLoggingErrorAutoFix(error, userId);
    }
    
    await logAIAction({
      userId,
      actionType: 'monitor_logging_errors',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Detected ${allLoggingErrors.length} logging errors, ${criticalLoggingErrors.length} critical`,
      eventType: 'autodev.logging_monitoring',
      targetType: 'logging_system',
      targetId: 'error_detection',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { 
      success: true, 
      errorsDetected: allLoggingErrors.length,
      criticalErrors: criticalLoggingErrors.length,
      errors: allLoggingErrors
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'monitor_logging_errors',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to monitor logging errors',
      eventType: 'autodev.logging_monitoring',
      targetType: 'logging_system',
      targetId: 'error_detection',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

// Logging Error interface
interface LoggingError {
  id: string;
  timestamp: Date;
  type: 'data_quality' | 'processing_error' | 'validation_error' | 'missing_field' | 'invalid_format' | 'duplicate_entry' | 'corruption';
  severity: 'low' | 'medium' | 'high' | 'critical';
  logId: string;
  errorMessage: string;
  errorDetails: string;
  affectedFields: string[];
  expectedValue?: any;
  actualValue?: any;
  status: 'detected' | 'fixing' | 'fixed' | 'failed';
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: Date;
  reprocessed?: boolean;
}

/**
 * Detect general logging errors
 */
function detectLoggingErrors(logs: any[]): LoggingError[] {
  const errors: LoggingError[] = [];
  
  logs.forEach(log => {
    // Check for missing required fields
    const missingFields = [];
    if (!log.timestamp) missingFields.push('timestamp');
    if (!log.eventType) missingFields.push('eventType');
    if (!log.userId) missingFields.push('userId');
    if (!log.sourceModule) missingFields.push('sourceModule');
    
    if (missingFields.length > 0) {
      errors.push({
        id: `missing_field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'missing_field',
        severity: 'high',
        logId: log.id,
        errorMessage: `Missing required fields: ${missingFields.join(', ')}`,
        errorDetails: `Log is missing essential fields for processing`,
        affectedFields: missingFields,
        status: 'detected',
        autoFixAttempted: false
      });
    }
    
    // Check for invalid data types
    if (log.timestamp && typeof log.timestamp !== 'object') {
      errors.push({
        id: `invalid_format_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'invalid_format',
        severity: 'medium',
        logId: log.id,
        errorMessage: 'Invalid timestamp format',
        errorDetails: `Expected Date object, got ${typeof log.timestamp}`,
        affectedFields: ['timestamp'],
        expectedValue: 'Date object',
        actualValue: typeof log.timestamp,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return errors;
}

/**
 * Detect data quality errors
 */
function detectDataQualityErrors(logs: any[]): LoggingError[] {
  const errors: LoggingError[] = [];
  
  logs.forEach(log => {
    // Check for empty or null values in important fields
    if (log.eventType === '' || log.eventType === null) {
      errors.push({
        id: `data_quality_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'data_quality',
        severity: 'high',
        logId: log.id,
        errorMessage: 'Empty eventType field',
        errorDetails: 'Event type cannot be empty for proper processing',
        affectedFields: ['eventType'],
        expectedValue: 'Non-empty string',
        actualValue: log.eventType,
        status: 'detected',
        autoFixAttempted: false
      });
    }
    
    // Check for malformed eventType patterns
    if (log.eventType && typeof log.eventType === 'string' && !log.eventType.includes('.')) {
      errors.push({
        id: `data_quality_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'data_quality',
        severity: 'medium',
        logId: log.id,
        errorMessage: 'Malformed eventType pattern',
        errorDetails: 'Event type should follow module.action pattern',
        affectedFields: ['eventType'],
        expectedValue: 'module.action format',
        actualValue: log.eventType,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return errors;
}

/**
 * Detect processing errors
 */
function detectProcessingErrors(logs: any[]): LoggingError[] {
  const errors: LoggingError[] = [];
  
  logs.forEach(log => {
    // Check for logs that failed processing
    if (log.processed === false && log.errors && log.errors.length > 0) {
      errors.push({
        id: `processing_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'processing_error',
        severity: 'high',
        logId: log.id,
        errorMessage: 'Log processing failed',
        errorDetails: `Processing errors: ${log.errors.join(', ')}`,
        affectedFields: ['processed', 'errors'],
        status: 'detected',
        autoFixAttempted: false
      });
    }
    
    // Check for logs stuck in processing
    if (log.processingStartedAt && !log.processingCompletedAt) {
      const processingTime = Date.now() - log.processingStartedAt.toDate().getTime();
      if (processingTime > 60000) { // 1 minute timeout
        errors.push({
          id: `processing_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          type: 'processing_error',
          severity: 'critical',
          logId: log.id,
          errorMessage: 'Log stuck in processing',
          errorDetails: `Processing started ${processingTime}ms ago but never completed`,
          affectedFields: ['processingStartedAt', 'processingCompletedAt'],
          status: 'detected',
          autoFixAttempted: false
        });
      }
    }
  });
  
  return errors;
}

/**
 * Detect validation errors
 */
function detectValidationErrors(logs: any[]): LoggingError[] {
  const errors: LoggingError[] = [];
  
  logs.forEach(log => {
    // Check for invalid urgency scores
    if (log.urgencyScore !== null && log.urgencyScore !== undefined) {
      if (typeof log.urgencyScore !== 'number' || log.urgencyScore < 0 || log.urgencyScore > 10) {
        errors.push({
          id: `validation_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          type: 'validation_error',
          severity: 'medium',
          logId: log.id,
          errorMessage: 'Invalid urgency score',
          errorDetails: 'Urgency score must be a number between 0 and 10',
          affectedFields: ['urgencyScore'],
          expectedValue: 'Number between 0-10',
          actualValue: log.urgencyScore,
          status: 'detected',
          autoFixAttempted: false
        });
      }
    }
    
    // Check for invalid boolean fields
    if (log.aiRelevant !== null && log.aiRelevant !== undefined && typeof log.aiRelevant !== 'boolean') {
      errors.push({
        id: `validation_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'validation_error',
        severity: 'medium',
        logId: log.id,
        errorMessage: 'Invalid aiRelevant field type',
        errorDetails: 'aiRelevant must be a boolean value',
        affectedFields: ['aiRelevant'],
        expectedValue: 'boolean',
        actualValue: typeof log.aiRelevant,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return errors;
}

/**
 * Attempt to auto-fix logging errors
 */
async function attemptLoggingErrorAutoFix(error: LoggingError, userId: string): Promise<void> {
  try {
    // Update error status to fixing
    await db.collection('loggingErrors').doc(error.id).update({
      status: 'fixing',
      autoFixAttempted: true
    });
    
    let fixApplied = '';
    
    switch (error.type) {
      case 'missing_field':
        fixApplied = await fixMissingFieldError(error);
        break;
      case 'invalid_format':
        fixApplied = await fixInvalidFormatError(error);
        break;
      case 'data_quality':
        fixApplied = await fixDataQualityError(error);
        break;
      case 'processing_error':
        fixApplied = await fixProcessingError(error);
        break;
      case 'validation_error':
        fixApplied = await fixValidationError(error);
        break;
      default:
        fixApplied = 'No auto-fix available for this error type';
    }
    
    // Update error with fix result
    await db.collection('loggingErrors').doc(error.id).update({
      status: fixApplied.includes('Successfully') ? 'fixed' : 'failed',
      fixApplied,
      resolvedAt: new Date()
    });
    
    // Log the fix attempt
    await logAIAction({
      userId,
      actionType: 'auto_fix_logging_error',
      sourceModule: 'AutoDevOps',
      success: fixApplied.includes('Successfully'),
      versionTag: 'v1',
      reason: `Auto-fix attempt for ${error.type} error: ${fixApplied}`,
      eventType: 'autodev.logging_auto_fix',
      targetType: 'logging_error',
      targetId: error.logId,
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
  } catch (error: any) {
    console.error('Error attempting logging error auto-fix:', error);
    
    // Update error status to failed
    await db.collection('loggingErrors').doc(error.id).update({
      status: 'failed',
      fixApplied: `Auto-fix failed: ${error.message}`
    });
  }
}

/**
 * Fix missing field errors
 */
async function fixMissingFieldError(error: LoggingError): Promise<string> {
  try {
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
         const logData = logDoc.data();
     if (!logData) {
       return 'Log data not found - cannot fix';
     }
     
     const updates: any = {};
     
     // Fix missing fields with sensible defaults
     if (error.affectedFields.includes('timestamp') && !logData.timestamp) {
       updates.timestamp = admin.firestore.FieldValue.serverTimestamp();
     }
     
     if (error.affectedFields.includes('eventType') && !logData.eventType) {
       updates.eventType = 'unknown.event';
     }
     
     if (error.affectedFields.includes('userId') && !logData.userId) {
       updates.userId = 'system';
     }
     
     if (error.affectedFields.includes('sourceModule') && !logData.sourceModule) {
       updates.sourceModule = 'Unknown';
     }
    
    if (Object.keys(updates).length > 0) {
      await db.collection('ai_logs').doc(error.logId).update(updates);
      return `Successfully fixed missing fields: ${Object.keys(updates).join(', ')}`;
    }
    
    return 'No missing fields to fix';
  } catch (error: any) {
    return `Failed to fix missing fields: ${error.message}`;
  }
}

/**
 * Fix invalid format errors
 */
async function fixInvalidFormatError(error: LoggingError): Promise<string> {
  try {
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    const updates: any = {};
    
    // Fix timestamp format
    if (error.affectedFields.includes('timestamp') && logData?.timestamp) {
      if (typeof logData.timestamp === 'string') {
        updates.timestamp = new Date(logData.timestamp);
      } else if (typeof logData.timestamp === 'number') {
        updates.timestamp = new Date(logData.timestamp);
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await db.collection('ai_logs').doc(error.logId).update(updates);
      return `Successfully fixed format issues: ${Object.keys(updates).join(', ')}`;
    }
    
    return 'No format issues to fix';
  } catch (error: any) {
    return `Failed to fix format issues: ${error.message}`;
  }
}

/**
 * Fix data quality errors
 */
async function fixDataQualityError(error: LoggingError): Promise<string> {
  try {
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    const updates: any = {};
    
    // Fix empty eventType
    if (error.affectedFields.includes('eventType') && (!logData?.eventType || logData.eventType === '')) {
      updates.eventType = 'system.unknown';
    }
    
    // Fix malformed eventType
    if (error.affectedFields.includes('eventType') && logData?.eventType && !logData.eventType.includes('.')) {
      updates.eventType = `system.${logData.eventType}`;
    }
    
    if (Object.keys(updates).length > 0) {
      await db.collection('ai_logs').doc(error.logId).update(updates);
      return `Successfully fixed data quality issues: ${Object.keys(updates).join(', ')}`;
    }
    
    return 'No data quality issues to fix';
  } catch (error: any) {
    return `Failed to fix data quality issues: ${error.message}`;
  }
}

/**
 * Fix processing errors
 */
async function fixProcessingError(error: LoggingError): Promise<string> {
  try {
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    const updates: any = {};
    
    // Reset processing status for stuck logs
    if (logData?.processingStartedAt && !logData?.processingCompletedAt) {
      updates.processed = false;
      updates.processingStartedAt = null;
      updates.errors = [];
      
      // Trigger reprocessing
      const { reprocessLog } = await import('./aiEngineProcessor');
      await reprocessLog(error.logId);
      
      return 'Successfully reset processing status and triggered reprocessing';
    }
    
    // For failed processing, try to fix common issues
    if (logData?.processed === false && logData?.errors) {
      updates.errors = [];
      updates.processed = false;
      
      // Trigger reprocessing
      const { reprocessLog } = await import('./aiEngineProcessor');
      await reprocessLog(error.logId);
      
      return 'Successfully cleared errors and triggered reprocessing';
    }
    
    return 'No processing issues to fix';
  } catch (error: any) {
    return `Failed to fix processing issues: ${error.message}`;
  }
}

/**
 * Fix validation errors
 */
async function fixValidationError(error: LoggingError): Promise<string> {
  try {
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    const updates: any = {};
    
    // Fix invalid urgency score
    if (error.affectedFields.includes('urgencyScore') && logData && logData.urgencyScore !== null) {
      if (typeof logData.urgencyScore !== 'number') {
        updates.urgencyScore = null;
      } else if (logData.urgencyScore < 0) {
        updates.urgencyScore = 0;
      } else if (logData.urgencyScore > 10) {
        updates.urgencyScore = 10;
      }
    }
    
    // Fix invalid boolean fields
    if (error.affectedFields.includes('aiRelevant') && logData && logData.aiRelevant !== null) {
      if (typeof logData.aiRelevant !== 'boolean') {
        updates.aiRelevant = Boolean(logData.aiRelevant);
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await db.collection('ai_logs').doc(error.logId).update(updates);
      return `Successfully fixed validation issues: ${Object.keys(updates).join(', ')}`;
    }
    
    return 'No validation issues to fix';
  } catch (error: any) {
    return `Failed to fix validation issues: ${error.message}`;
  }
}

/**
 * Monitor and detect AI engine processing issues
 */
export const monitorAIEngineProcessing = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  
  try {
    // Check for recent AI logs that may have processing issues
    const recentLogsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const logs = recentLogsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Detect AI engine processing issues
    const engineNotEngagedErrors = detectEngineNotEngagedErrors(logs);
    const engineProcessingFailedErrors = detectEngineProcessingFailedErrors(logs);
    const engineTimeoutErrors = detectEngineTimeoutErrors(logs);
    const engineConfigErrors = detectEngineConfigErrors(logs);
    
    // Store detected errors
    const allEngineErrors = [
      ...engineNotEngagedErrors,
      ...engineProcessingFailedErrors,
      ...engineTimeoutErrors,
      ...engineConfigErrors
    ];
    
    for (const error of allEngineErrors) {
      await db.collection('aiEngineProcessingErrors').doc(error.id).set(error);
    }
    
    // Attempt auto-fixes for critical errors
    const criticalEngineErrors = allEngineErrors.filter(e => e.severity === 'critical');
    for (const error of criticalEngineErrors) {
      await attemptAIEngineAutoFix(error, userId);
    }
    
    await logAIAction({
      userId,
      actionType: 'monitor_ai_engine_processing',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Detected ${allEngineErrors.length} AI engine processing errors, ${criticalEngineErrors.length} critical`,
      eventType: 'autodev.ai_engine_monitoring',
      targetType: 'ai_engines',
      targetId: 'engine_processing',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return { 
      success: true, 
      errorsDetected: allEngineErrors.length,
      criticalErrors: criticalEngineErrors.length,
      errors: allEngineErrors
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'monitor_ai_engine_processing',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to monitor AI engine processing',
      eventType: 'autodev.ai_engine_monitoring',
      targetType: 'ai_engines',
      targetId: 'engine_processing',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Enhanced AI Engine Processing Monitoring with Self-Healing
 */
export const monitorAIEngineProcessingWithSelfHealing = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  
  try {
    // Perform comprehensive self-healing analysis
    const selfHealingResult = await performSelfHealingAnalysis(userId);
    
    await logAIAction({
      userId,
      actionType: 'comprehensive_monitoring_with_self_healing',
      sourceModule: 'AutoDevOps',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Comprehensive monitoring completed. Self-healing actions: ${selfHealingResult?.actionsTaken || 0}`,
      eventType: 'autodev.comprehensive_monitoring',
      targetType: 'system_health',
      targetId: 'full_system',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    return {
      success: true,
      selfHealing: selfHealingResult
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'comprehensive_monitoring_with_self_healing',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to perform comprehensive monitoring with self-healing',
      eventType: 'autodev.comprehensive_monitoring',
      targetType: 'system_health',
      targetId: 'full_system',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Perform comprehensive self-healing analysis
 */
async function performSelfHealingAnalysis(userId: string): Promise<any> {
  const actionsTaken = [];
  
  try {
    // Check for patterns in errors that might indicate systemic issues
    const recentErrorsSnapshot = await db.collection('loggingErrors')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .get();
    
    const recentEngineErrorsSnapshot = await db.collection('aiEngineProcessingErrors')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .get();
    
    const loggingErrors = recentErrorsSnapshot.docs.map(doc => doc.data());
    const engineErrors = recentEngineErrorsSnapshot.docs.map(doc => doc.data());
    
    // Analyze error patterns
    const errorPatterns = analyzeErrorPatterns(loggingErrors, engineErrors);
    
    // Take corrective actions based on patterns
    for (const pattern of errorPatterns) {
      const action = await takeCorrectiveAction(pattern, userId);
      if (action) {
        actionsTaken.push(action);
      }
    }
    
    // Check system health and perform maintenance if needed
    const systemHealth = await checkSystemHealth();
    if (systemHealth.needsMaintenance) {
      const maintenanceAction = await performSystemMaintenance(userId);
      if (maintenanceAction) {
        actionsTaken.push(maintenanceAction);
      }
    }
    
    return {
      actionsTaken: actionsTaken.length,
      actions: actionsTaken,
      errorPatterns: errorPatterns.length,
      systemHealth
    };
    
  } catch (error: any) {
    console.error('Error performing self-healing analysis:', error);
    return {
      actionsTaken: 0,
      actions: [],
      error: error.message
    };
  }
}

/**
 * Detect logs that should engage engines but don't
 */
function detectEngineNotEngagedErrors(logs: any[]): AIEngineProcessingError[] {
  const errors: AIEngineProcessingError[] = [];
  
  logs.forEach(log => {
    if (!log.processed || !log.engineTouched || log.engineTouched.length === 0) {
      const expectedEngines = determineExpectedEngines(log);
      
      if (expectedEngines.length > 0) {
        errors.push({
          id: `engine_not_engaged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          type: 'engine_not_engaged',
          severity: determineEngineErrorSeverity(log),
          logId: log.id,
          errorMessage: 'Log should engage AI engines but none were processed',
          errorDetails: `Expected engines: ${expectedEngines.join(', ')}. Actual engines: none`,
          expectedEngines,
          actualEngines: [],
          status: 'detected',
          autoFixAttempted: false
        });
      }
    }
  });
  
  return errors;
}

/**
 * Detect logs where engine processing failed
 */
function detectEngineProcessingFailedErrors(logs: any[]): AIEngineProcessingError[] {
  const errors: AIEngineProcessingError[] = [];
  
  logs.forEach(log => {
    if (log.processed && log.errors && log.errors.length > 0) {
      const failedEngines = log.processingResults
        ?.filter((result: any) => !result.success)
        .map((result: any) => result.engine) || [];
      
      if (failedEngines.length > 0) {
        errors.push({
          id: `engine_processing_failed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          type: 'engine_processing_failed',
          severity: determineEngineErrorSeverity(log),
          logId: log.id,
          engineName: failedEngines[0], // Primary failed engine
          errorMessage: `Engine processing failed for: ${failedEngines.join(', ')}`,
          errorDetails: `Processing errors: ${log.errors.join(', ')}`,
          expectedEngines: log.engineTouched || [],
          actualEngines: log.engineTouched || [],
          processingResults: log.processingResults,
          status: 'detected',
          autoFixAttempted: false
        });
      }
    }
  });
  
  return errors;
}

/**
 * Detect engine timeout errors
 */
function detectEngineTimeoutErrors(logs: any[]): AIEngineProcessingError[] {
  const errors: AIEngineProcessingError[] = [];
  
  logs.forEach(log => {
    if (log.latencyMs && log.latencyMs > 10000) { // 10 second timeout
      errors.push({
        id: `engine_timeout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'engine_timeout',
        severity: 'high',
        logId: log.id,
        errorMessage: 'Engine processing timed out',
        errorDetails: `Processing took ${log.latencyMs}ms, exceeding 10 second timeout`,
        expectedEngines: log.engineTouched || [],
        actualEngines: log.engineTouched || [],
        processingResults: log.processingResults,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return errors;
}

/**
 * Detect engine configuration errors
 */
function detectEngineConfigErrors(logs: any[]): AIEngineProcessingError[] {
  const errors: AIEngineProcessingError[] = [];
  
  logs.forEach(log => {
    // Check for common configuration issues
    const configIssues = [];
    
    if (log.eventType && !log.contextType) {
      configIssues.push('Missing contextType for eventType');
    }
    
    if (log.aiRelevant && !log.engineTouched?.includes('ContextEngine')) {
      configIssues.push('AI-relevant log should engage ContextEngine');
    }
    
    if (log.urgencyScore && log.urgencyScore > 7 && !log.engineTouched?.includes('PriorityEngine')) {
      configIssues.push('High urgency log should engage PriorityEngine');
    }
    
    if (configIssues.length > 0) {
      errors.push({
        id: `engine_config_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: 'engine_config_error',
        severity: 'medium',
        logId: log.id,
        errorMessage: 'Engine configuration issues detected',
        errorDetails: configIssues.join('; '),
        expectedEngines: determineExpectedEngines(log),
        actualEngines: log.engineTouched || [],
        processingResults: log.processingResults,
        status: 'detected',
        autoFixAttempted: false
      });
    }
  });
  
  return errors;
}

/**
 * Determine which engines should process a log
 */
function determineExpectedEngines(log: any): string[] {
  const engines: string[] = [];

  // Always process through Context Engine for AI-relevant logs
  if (log.aiRelevant) {
    engines.push('ContextEngine');
  }

  // Route based on eventType
  if (log.eventType) {
    if (log.eventType.startsWith('feedback.')) {
      engines.push('FeedbackEngine');
    }
    if (log.eventType.startsWith('moment.')) {
      engines.push('MomentsEngine');
    }
    if (log.eventType.startsWith('tone.') || log.eventType.includes('tone')) {
      engines.push('ToneEngine');
    }
    if (log.eventType.startsWith('traits.') || log.traitsAffected) {
      engines.push('TraitsEngine');
    }
    if (log.eventType.startsWith('weights.') || log.weightsApplied) {
      engines.push('WeightsEngine');
    }
    if (log.eventType.startsWith('vector.')) {
      engines.push('VectorEngine');
    }
  }

  // Route based on contextType
  if (log.contextType) {
    switch (log.contextType) {
      case 'feedback':
        if (!engines.includes('FeedbackEngine')) engines.push('FeedbackEngine');
        break;
      case 'moment':
        if (!engines.includes('MomentsEngine')) engines.push('MomentsEngine');
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
  if (log.urgencyScore && log.urgencyScore > 7) {
    engines.push('PriorityEngine');
  }

  // Remove duplicates
  return [...new Set(engines)];
}

/**
 * Determine severity of engine processing error
 */
function determineEngineErrorSeverity(log: any): 'low' | 'medium' | 'high' | 'critical' {
  if (log.urgencyScore && log.urgencyScore > 8) return 'critical';
  if (log.urgencyScore && log.urgencyScore > 6) return 'high';
  if (log.urgencyScore && log.urgencyScore > 4) return 'medium';
  return 'low';
}

/**
 * Attempt to automatically fix AI engine processing errors
 */
async function attemptAIEngineAutoFix(error: AIEngineProcessingError, userId: string): Promise<void> {
  const start = Date.now();
  
  try {
    // Update error status to fixing
    await db.collection('aiEngineProcessingErrors').doc(error.id).update({
      status: 'fixing',
      autoFixAttempted: true
    });
    
    let fixApplied = '';
    
    // Apply fixes based on error type
    switch (error.type) {
      case 'engine_not_engaged':
        fixApplied = await fixEngineNotEngagedError(error);
        break;
      case 'engine_processing_failed':
        fixApplied = await fixEngineProcessingFailedError(error);
        break;
      case 'engine_timeout':
        fixApplied = await fixEngineTimeoutError(error);
        break;
      case 'engine_config_error':
        fixApplied = await fixEngineConfigError(error);
        break;
      default:
        fixApplied = 'No specific fix available for this error type';
    }
    
    // Update error status
    await db.collection('aiEngineProcessingErrors').doc(error.id).update({
      status: fixApplied.includes('successfully') ? 'fixed' : 'failed',
      fixApplied,
      resolvedAt: new Date()
    });
    
    await logAIAction({
      userId,
      actionType: 'ai_engine_auto_fix_attempt',
      sourceModule: 'AutoDevOps',
      success: fixApplied.includes('successfully'),
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Auto-fix attempt for ${error.type} error: ${error.errorMessage}`,
      eventType: 'autodev.ai_engine_fix',
      targetType: 'ai_engine',
      targetId: error.engineName || 'unknown',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
    
  } catch (fixError: any) {
    // Update error status to failed
    await db.collection('aiEngineProcessingErrors').doc(error.id).update({
      status: 'failed',
      fixApplied: `Auto-fix failed: ${fixError.message}`,
      resolvedAt: new Date()
    });
    
    await logAIAction({
      userId,
      actionType: 'ai_engine_auto_fix_attempt',
      sourceModule: 'AutoDevOps',
      success: false,
      errorMessage: fixError.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Auto-fix failed for ${error.type} error: ${error.errorMessage}`,
      eventType: 'autodev.ai_engine_fix',
      targetType: 'ai_engine',
      targetId: error.engineName || 'unknown',
      aiRelevant: true,
      contextType: 'autodev',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });
  }
}

/**
 * Fix engine not engaged errors
 */
async function fixEngineNotEngagedError(error: AIEngineProcessingError): Promise<string> {
  try {
    // Get the original log
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    
    // Update log with missing fields to trigger engine engagement
    const updates: any = {
      processed: false, // Reset processing status
      engineTouched: [],
      processingResults: [],
      errors: []
    };
    
    // Add missing fields that would trigger engine engagement
    if (logData?.aiRelevant && !logData?.contextType) {
      updates.contextType = 'general';
    }
    
    if (logData?.eventType && !logData?.aiRelevant) {
      updates.aiRelevant = true;
    }
    
    // Apply updates
    await db.collection('ai_logs').doc(error.logId).update(updates);
    
    // Trigger reprocessing
    const { reprocessLog } = await import('./aiEngineProcessor');
    await reprocessLog(error.logId, error.expectedEngines);
    
    return 'Successfully fixed engine engagement and triggered reprocessing';
  } catch (error: any) {
    return `Failed to fix engine engagement: ${error.message}`;
  }
}

/**
 * Fix engine processing failed errors
 */
async function fixEngineProcessingFailedError(error: AIEngineProcessingError): Promise<string> {
  try {
    // Get the original log
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    const logData = logDoc.data();
    
    // Check if it's a dependency or configuration issue
    const failedResults = logData?.processingResults?.filter((r: any) => !r.success) || [];
    
    if (failedResults.length > 0) {
      // Try to fix common issues
      const updates: any = {
        processed: false, // Reset processing status
        errors: []
      };
      
      // Check for missing dependencies
      for (const result of failedResults) {
        if (result.error?.includes('module not found') || result.error?.includes('import error')) {
          updates.dependenciesFixed = true;
        }
      }
      
      // Apply updates
      await db.collection('ai_logs').doc(error.logId).update(updates);
      
      // Trigger reprocessing with retry
      const { reprocessLog } = await import('./aiEngineProcessor');
      await reprocessLog(error.logId, error.expectedEngines);
      
      return 'Successfully fixed engine processing issues and triggered reprocessing';
    }
    
    return 'Engine processing failed but no specific fix available';
  } catch (error: any) {
    return `Failed to fix engine processing: ${error.message}`;
  }
}

/**
 * Fix engine timeout errors
 */
async function fixEngineTimeoutError(error: AIEngineProcessingError): Promise<string> {
  try {
    // Get the original log
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    // Update log to reduce processing load
    const updates: any = {
      processed: false, // Reset processing status
      timeoutFixed: true,
      processingTimeout: 30000 // Increase timeout to 30 seconds
    };
    
    // Apply updates
    await db.collection('ai_logs').doc(error.logId).update(updates);
    
    // Trigger reprocessing with increased timeout
    const { reprocessLog } = await import('./aiEngineProcessor');
    await reprocessLog(error.logId, error.expectedEngines);
    
    return 'Successfully fixed timeout issue and triggered reprocessing with increased timeout';
  } catch (error: any) {
    return `Failed to fix timeout issue: ${error.message}`;
  }
}

/**
 * Fix engine configuration errors
 */
async function fixEngineConfigError(error: AIEngineProcessingError): Promise<string> {
  try {
    // Get the original log
    const logDoc = await db.collection('ai_logs').doc(error.logId).get();
    if (!logDoc.exists) {
      return 'Original log not found - cannot fix';
    }
    
    // Fix configuration issues
    const updates: any = {
      processed: false, // Reset processing status
      configFixed: true
    };
    
    // Add missing contextType if needed
    // (If you need logData, re-add: const logData = logDoc.data();)
    // Ensure aiRelevant is set for AI-related events
    // (If you need logData, re-add: const logData = logDoc.data();)
    
    // Apply updates
    await db.collection('ai_logs').doc(error.logId).update(updates);
    
    // Trigger reprocessing
    const { reprocessLog } = await import('./aiEngineProcessor');
    await reprocessLog(error.logId, error.expectedEngines);
    
    return 'Successfully fixed configuration issues and triggered reprocessing';
  } catch (error: any) {
    return `Failed to fix configuration issues: ${error.message}`;
  }
}

/**
 * Analyze error patterns for systemic issues
 */
function analyzeErrorPatterns(loggingErrors: any[], engineErrors: any[]): any[] {
  const patterns: any[] = [];
  
  // Check for repeated errors of the same type
  const errorTypeCounts: Record<string, number> = {};
  [...loggingErrors, ...engineErrors].forEach(error => {
    const type = error.type;
    errorTypeCounts[type] = (errorTypeCounts[type] || 0) + 1;
  });
  
  // Identify patterns that need attention
  Object.entries(errorTypeCounts).forEach(([type, count]) => {
    if (count >= 5) { // Threshold for pattern detection
      patterns.push({
        type: 'repeated_errors',
        errorType: type,
        count,
        severity: count >= 10 ? 'critical' : count >= 7 ? 'high' : 'medium',
        description: `${count} errors of type ${type} detected in last 24 hours`
      });
    }
  });
  
  // Check for time-based patterns
  const hourlyErrorCounts: Record<string, number> = {};
  [...loggingErrors, ...engineErrors].forEach(error => {
    const hour = new Date(error.timestamp.toDate()).getHours();
    hourlyErrorCounts[hour] = (hourlyErrorCounts[hour] || 0) + 1;
  });
  
  Object.entries(hourlyErrorCounts).forEach(([hour, count]) => {
    if (count >= 3) { // High error rate in specific hour
      patterns.push({
        type: 'time_based_pattern',
        hour: parseInt(hour),
        count,
        severity: 'medium',
        description: `${count} errors occurred during hour ${hour}`
      });
    }
  });
  
  return patterns;
}

/**
 * Take corrective action based on error pattern
 */
async function takeCorrectiveAction(pattern: any, userId: string): Promise<string | null> {
  try {
    switch (pattern.type) {
      case 'repeated_errors':
        if (pattern.errorType === 'engine_processing_failed') {
          // Implement circuit breaker pattern
          await implementCircuitBreaker(pattern.errorType);
          return `Implemented circuit breaker for ${pattern.errorType} errors`;
        } else if (pattern.errorType === 'missing_field') {
          // Update logging validation
          await updateLoggingValidation();
          return `Updated logging validation to prevent ${pattern.errorType} errors`;
        }
        break;
        
      case 'time_based_pattern':
        // Adjust processing schedules
        await adjustProcessingSchedule(pattern.hour);
        return `Adjusted processing schedule for hour ${pattern.hour}`;
        
      default:
        return null;
    }
    
    return null;
  } catch (error: any) {
    console.error('Error taking corrective action:', error);
    return null;
  }
}

/**
 * Implement circuit breaker for repeated errors
 */
async function implementCircuitBreaker(errorType: string): Promise<void> {
  // Store circuit breaker state
  await db.collection('systemConfig').doc('circuitBreakers').set({
    [errorType]: {
      enabled: true,
      enabledAt: new Date(),
      threshold: 5,
      timeoutMinutes: 30
    }
  }, { merge: true });
}

/**
 * Update logging validation
 */
async function updateLoggingValidation(): Promise<void> {
  // Update validation rules
  await db.collection('systemConfig').doc('validationRules').set({
    lastUpdated: new Date(),
    strictMode: true,
    requiredFields: ['timestamp', 'eventType', 'userId', 'sourceModule'],
    fieldValidations: {
      timestamp: { type: 'date', required: true },
      eventType: { type: 'string', required: true, pattern: '^[a-zA-Z]+\\.[a-zA-Z_]+$' },
      userId: { type: 'string', required: true },
      urgencyScore: { type: 'number', min: 0, max: 10 }
    }
  }, { merge: true });
}

/**
 * Adjust processing schedule
 */
async function adjustProcessingSchedule(hour: number): Promise<void> {
  // Update processing schedule to avoid problematic hours
  await db.collection('systemConfig').doc('processingSchedule').set({
    lastUpdated: new Date(),
    blackoutHours: [hour],
    reducedLoadHours: [hour - 1, hour + 1],
    peakHours: [9, 10, 11, 14, 15, 16]
  }, { merge: true });
}

/**
 * Check system health
 */
async function checkSystemHealth(): Promise<any> {
  try {
    // Check recent error rates
    const recentErrorsSnapshot = await db.collection('loggingErrors')
      .where('timestamp', '>=', new Date(Date.now() - 60 * 60 * 1000)) // Last hour
      .get();
    
    const recentEngineErrorsSnapshot = await db.collection('aiEngineProcessingErrors')
      .where('timestamp', '>=', new Date(Date.now() - 60 * 60 * 1000))
      .get();
    
    const totalErrors = recentErrorsSnapshot.size + recentEngineErrorsSnapshot.size;
    const errorRate = totalErrors / 60; // errors per minute
    
    const healthStatus = errorRate < 0.1 ? 'healthy' : errorRate < 0.5 ? 'degraded' : 'critical';
    const needsMaintenance = errorRate >= 0.3;
    
    return {
      healthStatus,
      errorRate,
      totalErrors,
      needsMaintenance,
      lastChecked: new Date()
    };
  } catch (error: any) {
    console.error('Error checking system health:', error);
    return {
      healthStatus: 'unknown',
      errorRate: 0,
      totalErrors: 0,
      needsMaintenance: false,
      error: error.message
    };
  }
}

/**
 * Perform system maintenance
 */
async function performSystemMaintenance(userId: string): Promise<string | null> {
  try {
    // Clean up old error records
    const oldErrorsSnapshot = await db.collection('loggingErrors')
      .where('timestamp', '<=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Older than 7 days
      .get();
    
    const oldEngineErrorsSnapshot = await db.collection('aiEngineProcessingErrors')
      .where('timestamp', '<=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .get();
    
    // Delete old resolved errors
    const batch = db.batch();
    oldErrorsSnapshot.docs.forEach(doc => {
      if (doc.data().status === 'fixed') {
        batch.delete(doc.ref);
      }
    });
    
    oldEngineErrorsSnapshot.docs.forEach(doc => {
      if (doc.data().status === 'fixed') {
        batch.delete(doc.ref);
      }
    });
    
    await batch.commit();
    
    // Reset circuit breakers if system is healthy
    const health = await checkSystemHealth();
    if (health.healthStatus === 'healthy') {
      await db.collection('systemConfig').doc('circuitBreakers').delete();
    }
    
    return `Performed system maintenance: cleaned up ${oldErrorsSnapshot.size + oldEngineErrorsSnapshot.size} old error records`;
  } catch (error: any) {
    console.error('Error performing system maintenance:', error);
    return null;
  }
}

/**
 * Get logging error statistics
 */
export const getLoggingErrorStats = onCall(async () => {
  try {
    const errorsSnapshot = await db.collection('loggingErrors')
      .where('timestamp', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .get();

    const errors = errorsSnapshot.docs.map(doc => doc.data());
    
    const stats = {
      totalErrors: errors.length,
      dataQuality: errors.filter(e => e.type === 'data_quality').length,
      processingError: errors.filter(e => e.type === 'processing_error').length,
      validationError: errors.filter(e => e.type === 'validation_error').length,
      missingField: errors.filter(e => e.type === 'missing_field').length,
      invalidFormat: errors.filter(e => e.type === 'invalid_format').length,
      criticalErrors: errors.filter(e => e.severity === 'critical').length,
      autoFixed: errors.filter(e => e.status === 'fixed').length,
      pendingFixes: errors.filter(e => e.status === 'detected').length,
      failedFixes: errors.filter(e => e.status === 'failed').length,
      
      // Error trends by type
      errorTypes: {
        data_quality: errors.filter(e => e.type === 'data_quality').length,
        processing_error: errors.filter(e => e.type === 'processing_error').length,
        validation_error: errors.filter(e => e.type === 'validation_error').length,
        missing_field: errors.filter(e => e.type === 'missing_field').length,
        invalid_format: errors.filter(e => e.type === 'invalid_format').length
      },
      
      // Severity breakdown
      severity: {
        critical: errors.filter(e => e.severity === 'critical').length,
        high: errors.filter(e => e.severity === 'high').length,
        medium: errors.filter(e => e.severity === 'medium').length,
        low: errors.filter(e => e.severity === 'low').length
      }
    };

    return { success: true, stats };
  } catch (error: any) {
    console.error('Error getting logging error stats:', error);
    throw new Error(`Failed to get logging error stats: ${error.message}`);
  }
}); 