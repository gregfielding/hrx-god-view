import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

const db = admin.firestore();

interface TestResultSummary {
  date: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  duration: number;
  failedTestNames: string[];
  error?: string;
}

interface DashboardData {
  recentResults: TestResultSummary[];
  overallStats: {
    totalRuns: number;
    averageSuccessRate: number;
    lastRunDate: string;
    lastRunStatus: string;
  };
  recommendations: string[];
}

/**
 * Get a dashboard view of recent Firestore trigger test results
 * This can be called from a callable function or used internally
 */
export async function getTestResultsDashboard(days: number = 7): Promise<DashboardData> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    // Get recent test results from ai_logs
    const logsQuery = await db.collection('ai_logs')
      .where('sourceModule', '==', 'ScheduledTests')
      .where('actionType', 'in', ['scheduled_trigger_tests_completed', 'scheduled_trigger_tests_failed'])
      .where('timestamp', '>=', startDate)
      .orderBy('timestamp', 'desc')
      .get();

    const recentResults: TestResultSummary[] = [];
    let totalRuns = 0;
    let totalSuccessRate = 0;
    let lastRunDate = '';
    let lastRunStatus: string = 'success';

    logsQuery.docs.forEach(doc => {
      const logData = doc.data();
      const timestamp = logData.timestamp?.toDate?.() || new Date(logData.timestamp);
      
      if (logData.actionType === 'scheduled_trigger_tests_completed') {
        // Parse the reason to extract test results
        const reason = logData.reason || '';
        const match = reason.match(/(\d+)\/(\d+) passed/);
        
        if (match) {
          const passedTests = parseInt(match[1]);
          const totalTests = parseInt(match[2]);
          const failedTests = totalTests - passedTests;
          const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
          
          const result: TestResultSummary = {
            date: timestamp.toISOString().split('T')[0],
            totalTests,
            passedTests,
            failedTests,
            successRate,
            duration: logData.latencyMs || 0,
            failedTestNames: [] // We don't have this in the current log format
          };

          recentResults.push(result);
          totalRuns++;
          totalSuccessRate += successRate;
          
          if (!lastRunDate || timestamp > new Date(lastRunDate)) {
            lastRunDate = timestamp.toISOString().split('T')[0];
            lastRunStatus = failedTests > 0 ? 'failure' : 'success';
          }
        }
      } else if (logData.actionType === 'scheduled_trigger_tests_failed') {
        // Handle complete test failures
        const result: TestResultSummary = {
          date: timestamp.toISOString().split('T')[0],
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          successRate: 0,
          duration: 0,
          failedTestNames: [],
          error: logData.errorMessage || 'Unknown error'
        };

        recentResults.push(result);
        totalRuns++;
        
        if (!lastRunDate || timestamp > new Date(lastRunDate)) {
          lastRunDate = timestamp.toISOString().split('T')[0];
          lastRunStatus = 'error';
        }
      }
    });

    // Calculate overall stats
    const averageSuccessRate = totalRuns > 0 ? totalSuccessRate / totalRuns : 0;

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (averageSuccessRate < 90) {
      recommendations.push('⚠️ Test success rate is below 90%. Consider reviewing failing triggers.');
    }
    
    if (lastRunStatus === 'error') {
      recommendations.push('🚨 Last test run completely failed. Check function logs immediately.');
    } else if (lastRunStatus === 'failure') {
      recommendations.push('⚠️ Last test run had failures. Review and fix failing triggers.');
    }
    
    if (recentResults.length === 0) {
      recommendations.push('ℹ️ No recent test results found. Check if scheduled tests are running.');
    }

    return {
      recentResults: recentResults.slice(0, 10), // Limit to last 10 results
      overallStats: {
        totalRuns,
        averageSuccessRate: Math.round(averageSuccessRate * 100) / 100,
        lastRunDate,
        lastRunStatus
      },
      recommendations
    };

  } catch (error: any) {
    console.error('Error getting test results dashboard:', error);
    throw new Error(`Failed to get test results dashboard: ${error.message}`);
  }
}

/**
 * Callable function to get test results dashboard
 */
export const getTestDashboard = onCall(async (request) => {
  try {
    const days = request.data?.days || 7;
    const dashboard = await getTestResultsDashboard(days);
    
    return {
      success: true,
      dashboard
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}); 