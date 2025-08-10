// /modules/autoDevOps/runLogFixer.ts - Main entry point for AutoDevOps log fixing

import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';

import { db } from '../../firebase';
import { autoFixLogs, reprocessFixedLogs, getLogsNeedingFixes, validateLogStructure } from '../../utils/autoFixLogs';
import { LogEntry, AutoDevOpsStats } from '../../types/LogEntry';
import { createAutoDevOpsLog } from '../../firebase/fixLogEntry';

export interface LogFixerOptions {
  scanAllLogs?: boolean;
  onlyErrorLogs?: boolean;
  limit?: number;
  reprocessAfterFix?: boolean;
  dryRun?: boolean;
}

export async function runLogFixer(options: LogFixerOptions = {}): Promise<{
  stats: AutoDevOpsStats;
  results: any[];
  logsProcessed: LogEntry[];
}> {
  const {
    scanAllLogs = false,
    onlyErrorLogs = true,
    limit: logLimit = 100,
    reprocessAfterFix = true,
    dryRun = false
  } = options;

  console.log(`🤖 AutoDevOps: Starting log fixer with options:`, options);

  try {
    // Build query based on options
    const logsCollection = collection(db, 'ai_logs');
    
    let logsQuery;
    if (onlyErrorLogs) {
      logsQuery = query(
        logsCollection,
        where('status', '==', 'Error'),
        orderBy('timestamp', 'desc'),
        limit(logLimit)
      );
    } else {
      logsQuery = query(
        logsCollection,
        orderBy('timestamp', 'desc'),
        limit(logLimit)
      );
    }

    // Fetch logs
    const snapshot = await getDocs(logsQuery);
    const logs: LogEntry[] = [];
    
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...(doc.data() as object) } as LogEntry);
    });

    console.log(`📊 AutoDevOps: Found ${logs.length} logs to process`);

    // Validate logs and identify those needing fixes
    const logsNeedingFixes = getLogsNeedingFixes(logs);
    console.log(`🔍 AutoDevOps: ${logsNeedingFixes.length} logs need fixing`);

    if (logsNeedingFixes.length === 0) {
      console.log(`✅ AutoDevOps: No logs need fixing`);
      return {
        stats: {
          totalLogsScanned: logs.length,
          logsFixed: 0,
          logsUnfixable: 0,
          errorsEncountered: 0,
          processingTime: 0,
          timestamp: new Date().toISOString()
        },
        results: [],
        logsProcessed: logs
      };
    }

    // Run the fix engine
    const { fixedLogs, results, stats } = await autoFixLogs(logsNeedingFixes);

    // Reprocess fixed logs if requested
    if (reprocessAfterFix && fixedLogs.length > 0 && !dryRun) {
      await reprocessFixedLogs(fixedLogs);
    }

    // Create AutoDevOps action log
    if (!dryRun) {
      await createAutoDevOpsLog('log_fix_run', {
        options,
        stats,
        fixedLogsCount: fixedLogs.length,
        totalLogsScanned: logs.length
      });
    }

    console.log(`🎉 AutoDevOps: Log fixer completed successfully`);
    console.log(`📊 Final Stats:`, stats);

    return {
      stats,
      results,
      logsProcessed: logs
    };

  } catch (error) {
    console.error(`❌ AutoDevOps: Log fixer failed:`, error);
    
    // Create error log
    if (!dryRun) {
      await createAutoDevOpsLog('log_fix_error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options
      });
    }

    throw error;
  }
}

// Function to run scheduled log fixing
export async function runScheduledLogFixer(): Promise<void> {
  console.log(`⏰ AutoDevOps: Running scheduled log fixer`);
  
  try {
    await runLogFixer({
      onlyErrorLogs: true,
      limit: 50,
      reprocessAfterFix: true,
      dryRun: false
    });
  } catch (error) {
    console.error(`❌ AutoDevOps: Scheduled log fixer failed:`, error);
  }
}

// Function to run comprehensive log analysis
export async function runComprehensiveLogAnalysis(): Promise<{
  totalLogs: number;
  errorLogs: number;
  logsNeedingFixes: number;
  fixRecommendations: any[];
}> {
  console.log(`🔍 AutoDevOps: Running comprehensive log analysis`);

  try {
    // Get all logs from the last 24 hours
    const logsQuery = query(
      collection(db, 'ai_logs'),
      where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      orderBy('timestamp', 'desc')
    );

    const snapshot = await getDocs(logsQuery);
    const logs: LogEntry[] = [];
    
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...(doc.data() as object) } as LogEntry);
    });

    // Analyze logs
    const errorLogs = logs.filter(log => log.status === 'Error');
    const logsNeedingFixes = getLogsNeedingFixes(logs);
    
    // Get fix recommendations for each log
    const fixRecommendations = logsNeedingFixes.map(log => ({
      logId: log.id,
      eventType: log.eventType,
      status: log.status,
      validation: validateLogStructure(log),
      recommendations: [] // This would be populated by getFixRecommendations if implemented
    }));

    const analysis = {
      totalLogs: logs.length,
      errorLogs: errorLogs.length,
      logsNeedingFixes: logsNeedingFixes.length,
      fixRecommendations
    };

    console.log(`📊 AutoDevOps: Analysis complete:`, analysis);
    return analysis;

  } catch (error) {
    console.error(`❌ AutoDevOps: Comprehensive analysis failed:`, error);
    throw error;
  }
}

// Function to get AutoDevOps statistics
export async function getAutoDevOpsStats(): Promise<{
  totalRuns: number;
  totalLogsFixed: number;
  successRate: number;
  lastRun: string | null;
  averageProcessingTime: number;
}> {
  console.log(`📊 AutoDevOps: Getting statistics`);

  try {
    // Query AutoDevOps logs
    const autoDevOpsQuery = query(
      collection(db, 'ai_logs'),
      where('eventType', '==', 'auto_devops_log_fix_run'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const snapshot = await getDocs(autoDevOpsQuery);
    const runs: any[] = [];
    
    snapshot.forEach(doc => {
      runs.push({ id: doc.id, ...(doc.data() as object) });
    });

    if (runs.length === 0) {
      return {
        totalRuns: 0,
        totalLogsFixed: 0,
        successRate: 0,
        lastRun: null,
        averageProcessingTime: 0
      };
    }

    const totalLogsFixed = runs.reduce((sum, run) => {
      const stats = run.notes?.[1] ? JSON.parse(run.notes[1]) : {};
      return sum + (stats.logsFixed || 0);
    }, 0);

    const averageProcessingTime = runs.reduce((sum, run) => {
      const stats = run.notes?.[1] ? JSON.parse(run.notes[1]) : {};
      return sum + (stats.processingTime || 0);
    }, 0) / runs.length;

    const stats = {
      totalRuns: runs.length,
      totalLogsFixed,
      successRate: runs.length > 0 ? 100 : 0, // Simplified for now
      lastRun: runs[0]?.timestamp || null,
      averageProcessingTime
    };

    console.log(`📊 AutoDevOps: Statistics retrieved:`, stats);
    return stats;

  } catch (error) {
    console.error(`❌ AutoDevOps: Failed to get statistics:`, error);
    throw error;
  }
} 