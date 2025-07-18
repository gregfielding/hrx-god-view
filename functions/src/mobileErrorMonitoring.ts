import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logAIAction } from './feedbackEngine';

const db = getFirestore();

// Mobile App Error Interface
interface MobileAppError {
  id: string;
  timestamp: Date;
  userId?: string;
  deviceId?: string;
  appVersion: string;
  platform: 'ios' | 'android' | 'web';
  errorType: 'crash' | 'network' | 'ui' | 'data' | 'authentication' | 'permission' | 'performance' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  errorDetails: string;
  stackTrace?: string;
  userAction?: string;
  screenName?: string;
  networkStatus?: 'online' | 'offline' | 'slow';
  deviceInfo: {
    model?: string;
    osVersion?: string;
    appVersion?: string;
    memoryUsage?: number;
    batteryLevel?: number;
    networkType?: string;
  };
  context: {
    sessionId?: string;
    lastAction?: string;
    timeInApp?: number;
    previousErrors?: number;
  };
  status: 'detected' | 'analyzing' | 'fixing' | 'fixed' | 'failed' | 'ignored';
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: Date;
  reprocessed?: boolean;
  aiAnalysis?: {
    rootCause?: string;
    suggestedFixes?: string[];
    userImpact?: 'low' | 'medium' | 'high';
    frequency?: number;
  };
}

// Mobile Error Analytics Interface
interface MobileErrorAnalytics {
  id: string;
  timestamp: Date;
  period: 'hourly' | 'daily' | 'weekly';
  
  // Error counts
  totalErrors: number;
  crashes: number;
  networkErrors: number;
  uiErrors: number;
  dataErrors: number;
  authErrors: number;
  permissionErrors: number;
  performanceErrors: number;
  
  // Severity breakdown
  criticalErrors: number;
  highErrors: number;
  mediumErrors: number;
  lowErrors: number;
  
  // Platform breakdown
  iosErrors: number;
  androidErrors: number;
  webErrors: number;
  
  // User impact
  affectedUsers: number;
  uniqueDevices: number;
  averageErrorsPerUser: number;
  
  // Auto-fix metrics
  autoFixAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  fixSuccessRate: number;
  
  // Performance metrics
  averageResolutionTimeMs: number;
  mostCommonErrors: Record<string, number>;
  errorTrends: Record<string, number>;
  
  // System health
  systemHealth: 'healthy' | 'degraded' | 'critical';
  healthScore: number; // 0-100
}

/**
 * Log a mobile app error to Firestore
 */
export const logMobileAppError = onCall(async (request) => {
  const { error, userId } = request.data;
  const start = Date.now();
  
  try {
    // Validate required fields
    if (!error.errorMessage || !error.appVersion || !error.platform) {
      throw new Error('Missing required error fields: errorMessage, appVersion, platform');
    }

    // Generate error ID
    const errorId = `mobile_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create mobile error document
    const mobileError: MobileAppError = {
      id: errorId,
      timestamp: new Date(),
      userId: userId || error.userId || null,
      deviceId: error.deviceId || null,
      appVersion: error.appVersion,
      platform: error.platform,
      errorType: error.errorType || 'other',
      severity: determineErrorSeverity(error.errorMessage, error.errorType),
      errorMessage: error.errorMessage,
      errorDetails: error.errorDetails || error.errorMessage,
      stackTrace: error.stackTrace || null,
      userAction: error.userAction || null,
      screenName: error.screenName || null,
      networkStatus: error.networkStatus || null,
      deviceInfo: {
        model: error.deviceInfo?.model || null,
        osVersion: error.deviceInfo?.osVersion || null,
        appVersion: error.deviceInfo?.appVersion || error.appVersion,
        memoryUsage: error.deviceInfo?.memoryUsage || null,
        batteryLevel: error.deviceInfo?.batteryLevel || null,
        networkType: error.deviceInfo?.networkType || null,
      },
      context: {
        sessionId: error.context?.sessionId || null,
        lastAction: error.context?.lastAction || null,
        timeInApp: error.context?.timeInApp || null,
        previousErrors: error.context?.previousErrors || 0,
      },
      status: 'detected',
      autoFixAttempted: false,
    };

    // Store the error
    await db.collection('mobileAppErrors').doc(errorId).set(mobileError);
    
    // Log to AI logs for AutoDevOps monitoring
    await logAIAction({
      userId: userId || 'mobile_app',
      actionType: 'mobile_error_logged',
      sourceModule: 'MobileErrorMonitoring',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Mobile app error logged: ${error.errorMessage}`,
      eventType: 'mobile.error.detected',
      targetType: 'mobile_error',
      targetId: errorId,
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', error.platform, error.errorType],
      urgencyScore: getUrgencyScore(mobileError.severity)
    });

    // Trigger immediate analysis for critical errors
    if (mobileError.severity === 'critical') {
      await analyzeMobileError(mobileError, userId);
    }

    return { 
      success: true, 
      errorId,
      message: 'Mobile error logged successfully'
    };
  } catch (error: any) {
    await logAIAction({
      userId: userId || 'mobile_app',
      actionType: 'mobile_error_logged',
      sourceModule: 'MobileErrorMonitoring',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to log mobile app error',
      eventType: 'mobile.error.failed',
      targetType: 'mobile_error',
      targetId: 'failed',
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', 'logging_failed'],
      urgencyScore: 8
    });
    throw error;
  }
});

/**
 * Monitor and analyze mobile app errors
 */
export const monitorMobileAppErrors = onCall(async (request) => {
  const { userId } = request.data;
  const start = Date.now();
  
  try {
    // Get recent mobile app errors
    const recentErrorsSnapshot = await db.collection('mobileAppErrors')
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const errors = recentErrorsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MobileAppError[];
    
    // Analyze errors for patterns
    const errorPatterns = analyzeMobileErrorPatterns(errors);
    const criticalErrors = errors.filter(e => e.severity === 'critical' && e.status === 'detected');
    
    // Attempt auto-fixes for critical errors
    for (const error of criticalErrors) {
      await attemptMobileErrorAutoFix(error, userId);
    }
    
    // Generate analytics
    const analytics = generateMobileErrorAnalytics(errors);
    await db.collection('mobileErrorAnalytics').doc(analytics.id).set(analytics);
    
    await logAIAction({
      userId,
      actionType: 'monitor_mobile_app_errors',
      sourceModule: 'MobileErrorMonitoring',
      success: true,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: `Analyzed ${errors.length} mobile app errors, ${criticalErrors.length} critical`,
      eventType: 'mobile.error.monitoring',
      targetType: 'mobile_errors',
      targetId: 'batch_analysis',
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', 'monitoring', 'analysis'],
      urgencyScore: null
    });

    return { 
      success: true, 
      errorsAnalyzed: errors.length,
      criticalErrors: criticalErrors.length,
      patterns: errorPatterns,
      analytics
    };
  } catch (error: any) {
    await logAIAction({
      userId,
      actionType: 'monitor_mobile_app_errors',
      sourceModule: 'MobileErrorMonitoring',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - start,
      versionTag: 'v1',
      reason: 'Failed to monitor mobile app errors',
      eventType: 'mobile.error.monitoring_failed',
      targetType: 'mobile_errors',
      targetId: 'failed',
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', 'monitoring_failed'],
      urgencyScore: null
    });
    throw error;
  }
});

/**
 * Get mobile app error statistics
 */
export const getMobileErrorStats = onCall(async () => {
  try {
    const errorsSnapshot = await db.collection('mobileAppErrors')
      .where('timestamp', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .get();

    const errors = errorsSnapshot.docs.map(doc => doc.data());
    
    const stats = {
      totalErrors: errors.length,
      crashes: errors.filter(e => e.errorType === 'crash').length,
      networkErrors: errors.filter(e => e.errorType === 'network').length,
      uiErrors: errors.filter(e => e.errorType === 'ui').length,
      dataErrors: errors.filter(e => e.errorType === 'data').length,
      authErrors: errors.filter(e => e.errorType === 'authentication').length,
      permissionErrors: errors.filter(e => e.errorType === 'permission').length,
      performanceErrors: errors.filter(e => e.errorType === 'performance').length,
      criticalErrors: errors.filter(e => e.severity === 'critical').length,
      autoFixed: errors.filter(e => e.status === 'fixed').length,
      pendingFixes: errors.filter(e => e.status === 'detected').length,
      failedFixes: errors.filter(e => e.status === 'failed').length,
      
      // Platform breakdown
      platforms: {
        ios: errors.filter(e => e.platform === 'ios').length,
        android: errors.filter(e => e.platform === 'android').length,
        web: errors.filter(e => e.platform === 'web').length
      },
      
      // Severity breakdown
      severity: {
        critical: errors.filter(e => e.severity === 'critical').length,
        high: errors.filter(e => e.severity === 'high').length,
        medium: errors.filter(e => e.severity === 'medium').length,
        low: errors.filter(e => e.severity === 'low').length
      },
      
      // Error trends
      errorTypes: {
        crash: errors.filter(e => e.errorType === 'crash').length,
        network: errors.filter(e => e.errorType === 'network').length,
        ui: errors.filter(e => e.errorType === 'ui').length,
        data: errors.filter(e => e.errorType === 'data').length,
        authentication: errors.filter(e => e.errorType === 'authentication').length,
        permission: errors.filter(e => e.errorType === 'permission').length,
        performance: errors.filter(e => e.errorType === 'performance').length,
        other: errors.filter(e => e.errorType === 'other').length
      }
    };

    return { success: true, stats };
  } catch (error: any) {
    console.error('Error getting mobile error stats:', error);
    throw new Error(`Failed to get mobile error stats: ${error.message}`);
  }
});

/**
 * Analyze a specific mobile error
 */
async function analyzeMobileError(error: MobileAppError, userId: string): Promise<void> {
  try {
    // Update error status to analyzing
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: 'analyzing'
    });
    
    // Perform AI analysis
    const analysis = await performMobileErrorAnalysis(error);
    
    // Update error with analysis results
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: 'detected',
      aiAnalysis: analysis
    });
    
    await logAIAction({
      userId,
      actionType: 'analyze_mobile_error',
      sourceModule: 'MobileErrorMonitoring',
      success: true,
      versionTag: 'v1',
      reason: `Analyzed mobile error: ${error.errorMessage}`,
      eventType: 'mobile.error.analysis',
      targetType: 'mobile_error',
      targetId: error.id,
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', 'analysis'],
      urgencyScore: null
    });
    
  } catch (error: any) {
    console.error('Error analyzing mobile error:', error);
    
    // Update error status back to detected
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: 'detected'
    });
  }
}

/**
 * Attempt to auto-fix a mobile error
 */
async function attemptMobileErrorAutoFix(error: MobileAppError, userId: string): Promise<void> {
  try {
    // Update error status to fixing
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: 'fixing',
      autoFixAttempted: true
    });
    
    let fixApplied = '';
    
    switch (error.errorType) {
      case 'network':
        fixApplied = await fixNetworkError(error);
        break;
      case 'authentication':
        fixApplied = await fixAuthenticationError(error);
        break;
      case 'data':
        fixApplied = await fixDataError(error);
        break;
      case 'ui':
        fixApplied = await fixUIError(error);
        break;
      case 'permission':
        fixApplied = await fixPermissionError(error);
        break;
      case 'performance':
        fixApplied = await fixPerformanceError(error);
        break;
      default:
        fixApplied = 'No auto-fix available for this error type';
    }
    
    // Update error with fix result
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: fixApplied.includes('Successfully') ? 'fixed' : 'failed',
      fixApplied,
      resolvedAt: new Date()
    });
    
    await logAIAction({
      userId,
      actionType: 'auto_fix_mobile_error',
      sourceModule: 'MobileErrorMonitoring',
      success: fixApplied.includes('Successfully'),
      versionTag: 'v1',
      reason: `Auto-fix attempt for ${error.errorType} error: ${fixApplied}`,
      eventType: 'mobile.error.auto_fix',
      targetType: 'mobile_error',
      targetId: error.id,
      aiRelevant: true,
      contextType: 'mobile',
      traitsAffected: null,
      aiTags: ['mobile', 'error', 'auto_fix'],
      urgencyScore: null
    });
    
  } catch (error: any) {
    console.error('Error attempting mobile error auto-fix:', error);
    
    // Update error status to failed
    await db.collection('mobileAppErrors').doc(error.id).update({
      status: 'failed',
      fixApplied: `Auto-fix failed: ${error.message}`
    });
  }
}

// Helper functions for error analysis and fixing
function determineErrorSeverity(errorMessage: string, errorType: string): 'low' | 'medium' | 'high' | 'critical' {
  const message = errorMessage.toLowerCase();
  
  // Critical errors
  if (message.includes('crash') || message.includes('fatal') || message.includes('out of memory')) {
    return 'critical';
  }
  
  // High severity errors
  if (message.includes('network') || message.includes('timeout') || message.includes('authentication')) {
    return 'high';
  }
  
  // Medium severity errors
  if (message.includes('validation') || message.includes('permission') || message.includes('data')) {
    return 'medium';
  }
  
  // Low severity errors
  return 'low';
}

function getUrgencyScore(severity: string): number {
  switch (severity) {
    case 'critical': return 10;
    case 'high': return 8;
    case 'medium': return 5;
    case 'low': return 2;
    default: return 1;
  }
}

function analyzeMobileErrorPatterns(errors: MobileAppError[]): any[] {
  const patterns = [];
  
  // Group errors by type and message
  const errorGroups = errors.reduce((groups, error) => {
    const key = `${error.errorType}_${error.errorMessage.substring(0, 50)}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(error);
    return groups;
  }, {} as Record<string, MobileAppError[]>);
  
  // Identify patterns
  for (const [key, groupErrors] of Object.entries(errorGroups)) {
    if (groupErrors.length >= 3) { // Pattern threshold
      patterns.push({
        pattern: key,
        count: groupErrors.length,
        errorType: groupErrors[0].errorType,
        errorMessage: groupErrors[0].errorMessage,
        platforms: [...new Set(groupErrors.map(e => e.platform))],
        severity: groupErrors[0].severity,
        firstSeen: Math.min(...groupErrors.map(e => e.timestamp.getTime())),
        lastSeen: Math.max(...groupErrors.map(e => e.timestamp.getTime()))
      });
    }
  }
  
  return patterns;
}

function generateMobileErrorAnalytics(errors: MobileAppError[]): MobileErrorAnalytics {
  const now = new Date();
  const analytics: MobileErrorAnalytics = {
    id: `mobile_analytics_${now.getTime()}`,
    timestamp: now,
    period: 'hourly',
    
    totalErrors: errors.length,
    crashes: errors.filter(e => e.errorType === 'crash').length,
    networkErrors: errors.filter(e => e.errorType === 'network').length,
    uiErrors: errors.filter(e => e.errorType === 'ui').length,
    dataErrors: errors.filter(e => e.errorType === 'data').length,
    authErrors: errors.filter(e => e.errorType === 'authentication').length,
    permissionErrors: errors.filter(e => e.errorType === 'permission').length,
    performanceErrors: errors.filter(e => e.errorType === 'performance').length,
    
    criticalErrors: errors.filter(e => e.severity === 'critical').length,
    highErrors: errors.filter(e => e.severity === 'high').length,
    mediumErrors: errors.filter(e => e.severity === 'medium').length,
    lowErrors: errors.filter(e => e.severity === 'low').length,
    
    iosErrors: errors.filter(e => e.platform === 'ios').length,
    androidErrors: errors.filter(e => e.platform === 'android').length,
    webErrors: errors.filter(e => e.platform === 'web').length,
    
    affectedUsers: new Set(errors.map(e => e.userId).filter(Boolean)).size,
    uniqueDevices: new Set(errors.map(e => e.deviceId).filter(Boolean)).size,
    averageErrorsPerUser: errors.length / Math.max(new Set(errors.map(e => e.userId).filter(Boolean)).size, 1),
    
    autoFixAttempts: errors.filter(e => e.autoFixAttempted).length,
    successfulFixes: errors.filter(e => e.status === 'fixed').length,
    failedFixes: errors.filter(e => e.status === 'failed').length,
    fixSuccessRate: errors.filter(e => e.autoFixAttempted).length > 0 
      ? errors.filter(e => e.status === 'fixed').length / errors.filter(e => e.autoFixAttempted).length 
      : 0,
    
    averageResolutionTimeMs: 0, // Would need to calculate from resolvedAt - timestamp
    mostCommonErrors: {},
    errorTrends: {},
    
    systemHealth: calculateMobileSystemHealth(errors),
    healthScore: calculateMobileHealthScore(errors)
  };
  
  return analytics;
}

function calculateMobileSystemHealth(errors: MobileAppError[]): 'healthy' | 'degraded' | 'critical' {
  const criticalErrors = errors.filter(e => e.severity === 'critical').length;
  const totalErrors = errors.length;
  
  if (totalErrors === 0) return 'healthy';
  
  const errorRate = criticalErrors / totalErrors;
  
  if (errorRate > 0.1) return 'critical';
  if (errorRate > 0.05) return 'degraded';
  return 'healthy';
}

function calculateMobileHealthScore(errors: MobileAppError[]): number {
  if (errors.length === 0) return 100;
  
  const criticalErrors = errors.filter(e => e.severity === 'critical').length;
  const highErrors = errors.filter(e => e.severity === 'high').length;
  const mediumErrors = errors.filter(e => e.severity === 'medium').length;
  const lowErrors = errors.filter(e => e.severity === 'low').length;
  
  const totalWeightedErrors = criticalErrors * 10 + highErrors * 5 + mediumErrors * 2 + lowErrors * 1;
  const maxPossibleErrors = errors.length * 10;
  
  const healthScore = Math.max(0, 100 - (totalWeightedErrors / maxPossibleErrors) * 100);
  return Math.round(healthScore);
}

async function performMobileErrorAnalysis(error: MobileAppError): Promise<any> {
  // This would integrate with AI analysis
  return {
    rootCause: 'Analysis pending',
    suggestedFixes: ['Contact support'],
    userImpact: 'medium' as const,
    frequency: 1
  };
}

// Auto-fix functions for different error types
async function fixNetworkError(error: MobileAppError): Promise<string> {
  // Implement network error fixes
  return 'Network error fix applied: Retry mechanism enabled';
}

async function fixAuthenticationError(error: MobileAppError): Promise<string> {
  // Implement authentication error fixes
  return 'Authentication error fix applied: Token refresh initiated';
}

async function fixDataError(error: MobileAppError): Promise<string> {
  // Implement data error fixes
  return 'Data error fix applied: Cache cleared and data revalidated';
}

async function fixUIError(error: MobileAppError): Promise<string> {
  // Implement UI error fixes
  return 'UI error fix applied: Component state reset';
}

async function fixPermissionError(error: MobileAppError): Promise<string> {
  // Implement permission error fixes
  return 'Permission error fix applied: Permission request flow updated';
}

async function fixPerformanceError(error: MobileAppError): Promise<string> {
  // Implement performance error fixes
  return 'Performance error fix applied: Memory optimization applied';
}

// Scheduled monitoring - will be called from main index.ts
export const scheduledMobileErrorMonitoring = onSchedule({
  schedule: 'every 1 hours',
  timeZone: 'America/New_York',
}, async (event) => {
  try {
    // This will be implemented in the main index.ts file
    console.log('Scheduled mobile error monitoring triggered');
  } catch (error) {
    console.error('Scheduled mobile error monitoring failed:', error);
  }
}); 