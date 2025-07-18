import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

const db = admin.firestore();

// Analytics Engine - Processes log data to generate comprehensive analytics
export const getAIAnalytics = onCall(async (request) => {
  const { timeRange = '24h' } = request.data;
  
  try {
    const cutoffTime = getCutoffTime(timeRange);
    
    // Fetch logs for the time range
    const logsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', cutoffTime)
      .orderBy('timestamp', 'desc')
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Generate analytics
    const analytics = {
      eventFrequency: calculateEventFrequency(logs),
      engineProcessingTimes: calculateEngineProcessingTimes(logs),
      errorRates: calculateErrorRates(logs),
      performanceMetrics: calculatePerformanceMetrics(logs),
      topIssues: identifyTopIssues(logs),
      contextUsage: analyzeContextUsage(logs),
      urgencyDistribution: calculateUrgencyDistribution(logs),
      engineEffectiveness: analyzeEngineEffectiveness(logs)
    };
    
    return {
      success: true,
      data: analytics,
      timeRange,
      logCount: logs.length
    };
    
  } catch (error) {
    console.error('Analytics error:', error);
    throw new Error('Failed to generate analytics');
  }
});

// Helper function to get cutoff time based on time range
function getCutoffTime(timeRange: string): Date {
  const now = new Date();
  const hours = {
    '1h': 1,
    '6h': 6,
    '24h': 24,
    '7d': 168,
    '30d': 720
  };
  
  const hoursToSubtract = hours[timeRange as keyof typeof hours] || 24;
  return new Date(now.getTime() - hoursToSubtract * 60 * 60 * 1000);
}

// Calculate event frequency trends
function calculateEventFrequency(logs: any[]) {
  const eventCounts: Record<string, number> = {};
  
  logs.forEach(log => {
    const eventType = log.eventType || log.actionType || 'unknown';
    eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
  });
  
  return Object.entries(eventCounts)
    .map(([eventType, count]) => ({
      eventType,
      count,
      trend: Math.random() * 20 - 10 // Placeholder trend calculation
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// Calculate engine processing times
function calculateEngineProcessingTimes(logs: any[]) {
  const engineTimes: Record<string, { totalTime: number; count: number }> = {};
  
  logs.forEach(log => {
    if (log.engineTouched && Array.isArray(log.engineTouched)) {
      log.engineTouched.forEach((engine: string) => {
        if (!engineTimes[engine]) {
          engineTimes[engine] = { totalTime: 0, count: 0 };
        }
        
        // Calculate processing time if available
        if (log.processingStartedAt && log.processingCompletedAt) {
          const startTime = log.processingStartedAt.toDate ? log.processingStartedAt.toDate() : new Date(log.processingStartedAt);
          const endTime = log.processingCompletedAt.toDate ? log.processingCompletedAt.toDate() : new Date(log.processingCompletedAt);
          const processingTime = endTime.getTime() - startTime.getTime();
          engineTimes[engine].totalTime += processingTime;
        }
        
        engineTimes[engine].count += 1;
      });
    }
  });
  
  return Object.entries(engineTimes)
    .map(([engine, data]) => ({
      engine,
      avgTime: data.count > 0 ? Math.round(data.totalTime / data.count) : 0,
      count: data.count
    }))
    .sort((a, b) => b.count - a.count);
}

// Calculate error rates by engine
function calculateErrorRates(logs: any[]) {
  const engineStats: Record<string, { errors: number; total: number }> = {};
  
  logs.forEach(log => {
    if (log.engineTouched && Array.isArray(log.engineTouched)) {
      log.engineTouched.forEach((engine: string) => {
        if (!engineStats[engine]) {
          engineStats[engine] = { errors: 0, total: 0 };
        }
        
        engineStats[engine].total += 1;
        if (!log.success || (log.errors && log.errors.length > 0)) {
          engineStats[engine].errors += 1;
        }
      });
    }
  });
  
  return Object.entries(engineStats)
    .map(([engine, stats]) => ({
      engine,
      errorRate: stats.total > 0 ? Math.round((stats.errors / stats.total) * 100) : 0,
      totalLogs: stats.total
    }))
    .sort((a, b) => b.errorRate - a.errorRate);
}

// Calculate overall performance metrics
function calculatePerformanceMetrics(logs: any[]) {
  const totalLogs = logs.length;
  const successfulLogs = logs.filter(log => log.success).length;
  const errorLogs = totalLogs - successfulLogs;
  
  const latencies = logs
    .filter(log => log.latencyMs)
    .map(log => log.latencyMs);
  
  const avgLatency = latencies.length > 0 
    ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
    : 0;
  
  const successRate = totalLogs > 0 ? (successfulLogs / totalLogs) * 100 : 0;
  
  // Calculate throughput (logs per minute)
  const timeSpan = logs.length > 0 ? 
    (new Date().getTime() - logs[logs.length - 1].timestamp.toDate().getTime()) / (1000 * 60) : 
    1;
  const throughput = Math.round(totalLogs / timeSpan);
  
  return {
    avgLatency,
    successRate,
    throughput,
    errorCount: errorLogs
  };
}

// Identify top issues
function identifyTopIssues(logs: any[]) {
  const issues: Record<string, number> = {};
  
  logs.forEach(log => {
    if (!log.success) {
      const errorType = log.errorMessage || 'Unknown error';
      issues[errorType] = (issues[errorType] || 0) + 1;
    }
    
    if (log.latencyMs && log.latencyMs > 2000) {
      issues['High latency'] = (issues['High latency'] || 0) + 1;
    }
    
    if (log.urgencyScore && log.urgencyScore > 8) {
      issues['High urgency events'] = (issues['High urgency events'] || 0) + 1;
    }
  });
  
  return Object.entries(issues)
    .map(([issue, count]) => ({
      issue,
      count,
      impact: count > 10 ? 'High' : count > 5 ? 'Medium' : 'Low'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// Analyze context usage
function analyzeContextUsage(logs: any[]) {
  const contextStats: Record<string, { usage: number; effectiveness: number }> = {};
  
  logs.forEach(log => {
    const contextType = log.contextType || 'unknown';
    
    if (!contextStats[contextType]) {
      contextStats[contextType] = { usage: 0, effectiveness: 0 };
    }
    
    contextStats[contextType].usage += 1;
    
    // Calculate effectiveness based on success and latency
    let effectiveness = 0;
    if (log.success) effectiveness += 50;
    if (log.latencyMs && log.latencyMs < 1000) effectiveness += 30;
    if (log.aiRelevant) effectiveness += 20;
    
    contextStats[contextType].effectiveness = Math.round(
      (contextStats[contextType].effectiveness + effectiveness) / 2
    );
  });
  
  return Object.entries(contextStats)
    .map(([contextType, stats]) => ({
      contextType,
      usage: stats.usage,
      effectiveness: stats.effectiveness
    }))
    .sort((a, b) => b.usage - a.usage);
}

// Calculate urgency distribution
function calculateUrgencyDistribution(logs: any[]) {
  const urgencyCounts: Record<string, number> = {
    'Low (1-3)': 0,
    'Medium (4-6)': 0,
    'High (7-8)': 0,
    'Critical (9-10)': 0
  };
  
  logs.forEach(log => {
    const urgency = log.urgencyScore || 1;
    
    if (urgency <= 3) urgencyCounts['Low (1-3)'] += 1;
    else if (urgency <= 6) urgencyCounts['Medium (4-6)'] += 1;
    else if (urgency <= 8) urgencyCounts['High (7-8)'] += 1;
    else urgencyCounts['Critical (9-10)'] += 1;
  });
  
  const total = logs.length;
  
  return Object.entries(urgencyCounts)
    .map(([level, count]) => ({
      level,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    }))
    .filter(item => item.count > 0);
}

// Analyze engine effectiveness
function analyzeEngineEffectiveness(logs: any[]) {
  const engineStats: Record<string, { 
    total: number; 
    successful: number; 
    avgLatency: number; 
    totalLatency: number 
  }> = {};
  
  logs.forEach(log => {
    if (log.engineTouched && Array.isArray(log.engineTouched)) {
      log.engineTouched.forEach((engine: string) => {
        if (!engineStats[engine]) {
          engineStats[engine] = { total: 0, successful: 0, avgLatency: 0, totalLatency: 0 };
        }
        
        engineStats[engine].total += 1;
        if (log.success) engineStats[engine].successful += 1;
        if (log.latencyMs) engineStats[engine].totalLatency += log.latencyMs;
      });
    }
  });
  
  return Object.entries(engineStats)
    .map(([engine, stats]) => {
      const successRate = stats.total > 0 ? (stats.successful / stats.total) * 100 : 0;
      const avgLatency = stats.total > 0 ? stats.totalLatency / stats.total : 0;
      
      // Calculate effectiveness score (0-100)
      let effectiveness = successRate * 0.6; // 60% weight on success rate
      
      if (avgLatency < 500) effectiveness += 20; // Fast processing
      else if (avgLatency < 1000) effectiveness += 15; // Good processing
      else if (avgLatency < 2000) effectiveness += 10; // Acceptable processing
      else effectiveness += 5; // Slow processing
      
      // Generate recommendations
      const recommendations = [];
      if (successRate < 80) {
        recommendations.push('Improve error handling and validation');
      }
      if (avgLatency > 1000) {
        recommendations.push('Optimize processing performance');
      }
      if (stats.total < 10) {
        recommendations.push('Increase usage for better data');
      }
      
      return {
        engine,
        effectiveness: Math.round(effectiveness),
        recommendations
      };
    })
    .sort((a, b) => b.effectiveness - a.effectiveness);
}

// Real-time analytics updates
export const getRealTimeAIAnalytics = onCall(async (request) => {
  const { } = request.data;
  
  try {
    // Get logs from the last hour
    const cutoffTime = new Date(Date.now() - 60 * 60 * 1000);
    
    const logsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', cutoffTime)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // Calculate real-time metrics
    const realTimeMetrics = {
      logsInLastHour: logs.length,
      activeEngines: new Set(logs.flatMap((log: any) => log.engineTouched || [])).size,
      errorRate: logs.length > 0 ? 
        (logs.filter((log: any) => !log.success).length / logs.length) * 100 : 0,
      avgLatency: logs.length > 0 ?
        logs.reduce((sum: number, log: any) => sum + (log.latencyMs || 0), 0) / logs.length : 0,
      highUrgencyEvents: logs.filter((log: any) => log.urgencyScore && log.urgencyScore > 7).length
    };
    
    return {
      success: true,
      data: realTimeMetrics,
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('Real-time analytics error:', error);
    throw new Error('Failed to get real-time analytics');
  }
});

// Export analytics data
export const exportAnalyticsData = onCall(async (request) => {
  const { timeRange = '24h', format = 'json' } = request.data;
  
  try {
    const cutoffTime = getCutoffTime(timeRange);
    
    const logsSnapshot = await db.collection('ai_logs')
      .where('timestamp', '>=', cutoffTime)
      .orderBy('timestamp', 'desc')
      .get();
    
    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Generate analytics
    const analytics = {
      eventFrequency: calculateEventFrequency(logs),
      engineProcessingTimes: calculateEngineProcessingTimes(logs),
      errorRates: calculateErrorRates(logs),
      performanceMetrics: calculatePerformanceMetrics(logs),
      topIssues: identifyTopIssues(logs),
      contextUsage: analyzeContextUsage(logs),
      urgencyDistribution: calculateUrgencyDistribution(logs),
      engineEffectiveness: analyzeEngineEffectiveness(logs),
      rawLogs: logs
    };
    
    if (format === 'csv') {
      // Convert to CSV format (simplified)
      const csvData = convertToCSV(analytics);
      return {
        success: true,
        data: csvData,
        format: 'csv',
        filename: `ai_analytics_${timeRange}_${new Date().toISOString().split('T')[0]}.csv`
      };
    }
    
    return {
      success: true,
      data: analytics,
      format: 'json',
      filename: `ai_analytics_${timeRange}_${new Date().toISOString().split('T')[0]}.json`
    };
    
  } catch (error) {
    console.error('Export analytics error:', error);
    throw new Error('Failed to export analytics data');
  }
});

// Helper function to convert analytics to CSV
function convertToCSV(analytics: any): string {
  const csvRows = [];
  
  // Add headers
  csvRows.push(['Metric', 'Value', 'Details']);
  
  // Add performance metrics
  csvRows.push(['Average Latency', analytics.performanceMetrics.avgLatency, 'ms']);
  csvRows.push(['Success Rate', analytics.performanceMetrics.successRate, '%']);
  csvRows.push(['Throughput', analytics.performanceMetrics.throughput, 'logs/min']);
  csvRows.push(['Error Count', analytics.performanceMetrics.errorCount, '']);
  
  // Add event frequency
  analytics.eventFrequency.forEach((event: any) => {
    csvRows.push([`Event: ${event.eventType}`, event.count, `trend: ${event.trend}%`]);
  });
  
  // Add engine processing times
  analytics.engineProcessingTimes.forEach((engine: any) => {
    csvRows.push([`Engine: ${engine.engine}`, engine.avgTime, `ms (${engine.count} logs)`]);
  });
  
  return csvRows.map(row => row.join(',')).join('\n');
} 