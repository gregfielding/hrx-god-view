// /utils/autoFixLogs.ts - Main AutoDevOps fix engine

import { LogEntry, LogFixResult, AutoDevOpsStats } from '../types/LogEntry';
import { fixLogEntry } from '../firebase/fixLogEntry';

import { getSortedRules, getAutoApplyRules } from './logErrorTypemap';

export async function autoFixLogs(logs: LogEntry[]): Promise<{
  fixedLogs: LogEntry[];
  results: LogFixResult[];
  stats: AutoDevOpsStats;
}> {
  const startTime = Date.now();
  const fixedLogs: LogEntry[] = [];
  const results: LogFixResult[] = [];
  let errorsEncountered = 0;
  let logsUnfixable = 0;

  console.log(`🤖 AutoDevOps: Starting log repair for ${logs.length} logs...`);

  // Get sorted rules by priority
  const sortedRules = getSortedRules();
  const autoApplyRules = getAutoApplyRules();

  console.log(`📋 AutoDevOps: Loaded ${sortedRules.length} fix rules (${autoApplyRules.length} auto-apply)`);

  for (const log of logs) {
    let logFixed = false;
    let appliedRule: string | null = null;
    const originalLog = { ...log };

    try {
      // Apply rules in priority order
      for (const rule of sortedRules) {
        if (rule.condition(log)) {
          console.log(`🔧 AutoDevOps: Applying rule "${rule.name}" to log ${log.id || 'unknown'}`);
          
          const fixedLog = rule.fix(log);
          
          // Update the log for next rule evaluation
          Object.assign(log, fixedLog);
          
          appliedRule = rule.id;
          logFixed = true;
          
          // If rule is not auto-apply, stop here and require review
          if (!rule.autoApply) {
            console.log(`⚠️ AutoDevOps: Rule "${rule.name}" requires manual review`);
            break;
          }
        }
      }

      if (logFixed) {
        // Save the fixed log to Firebase
        try {
          await fixLogEntry(log);
          fixedLogs.push(log);
          
          results.push({
            logId: log.id || 'unknown',
            originalLog,
            fixedLog: log,
            ruleApplied: appliedRule!,
            success: true,
            timestamp: new Date().toISOString()
          });

          console.log(`✅ AutoDevOps: Successfully fixed log ${log.id || 'unknown'} with rule ${appliedRule}`);
        } catch (saveError) {
          errorsEncountered++;
          console.error(`❌ AutoDevOps: Failed to save fixed log ${log.id}:`, saveError);
          
          results.push({
            logId: log.id || 'unknown',
            originalLog,
            fixedLog: log,
            ruleApplied: appliedRule!,
            success: false,
            error: saveError instanceof Error ? saveError.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      } else {
        logsUnfixable++;
        console.log(`⚠️ AutoDevOps: No fix rules matched for log ${log.id || 'unknown'}`);
      }

    } catch (error) {
      errorsEncountered++;
      console.error(`❌ AutoDevOps: Error processing log ${log.id}:`, error);
      
      results.push({
        logId: log.id || 'unknown',
        originalLog,
        fixedLog: log,
        ruleApplied: 'error',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  const processingTime = Date.now() - startTime;
  const stats: AutoDevOpsStats = {
    totalLogsScanned: logs.length,
    logsFixed: fixedLogs.length,
    logsUnfixable,
    errorsEncountered,
    processingTime,
    timestamp: new Date().toISOString()
  };

  console.log(`🎉 AutoDevOps: Completed log repair in ${processingTime}ms`);
  console.log(`📊 AutoDevOps Stats:`, stats);

  return { fixedLogs, results, stats };
}

// Function to reprocess fixed logs through downstream engines
export async function reprocessFixedLogs(fixedLogs: LogEntry[]): Promise<void> {
  console.log(`🔄 AutoDevOps: Reprocessing ${fixedLogs.length} fixed logs...`);

  for (const log of fixedLogs) {
    try {
      // Mark log for reprocessing
      const reprocessLog = {
        ...log,
        status: 'Pending' as const,
        processing: 'Pending' as const,
        autoDevOps: {
          ...log.autoDevOps,
          reprocessed: true,
          reprocessedAt: new Date().toISOString()
        },
        notes: [...(log.notes || []), 'AutoDevOps: Marked for reprocessing']
      };

      await fixLogEntry(reprocessLog);
      console.log(`✅ AutoDevOps: Marked log ${log.id} for reprocessing`);
    } catch (error) {
      console.error(`❌ AutoDevOps: Failed to mark log ${log.id} for reprocessing:`, error);
    }
  }

  console.log(`🔄 AutoDevOps: Reprocessing complete`);
}

// Function to validate log structure
export function validateLogStructure(log: LogEntry): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!log.timestamp) errors.push('Missing timestamp');
  if (!log.eventType) errors.push('Missing event type');
  if (!log.status) errors.push('Missing status');

  // Field validation
  if (log.timestamp && (log.timestamp.includes('Invalid') || log.timestamp.includes('NaN'))) {
    errors.push('Invalid timestamp format');
  }

  if (log.eventType && log.eventType.trim() === '') {
    errors.push('Empty event type');
  }

  if (log.status && !['Success', 'Error', 'Fixed', 'Unfixable', 'Pending', 'Processing'].includes(log.status)) {
    warnings.push('Unknown status value');
  }

  // Module inference check
  if (!log.module || log.module === 'Unknown') {
    warnings.push('Module could be inferred from event type');
  }

  // Processing status consistency
  if (log.status === 'Error' && log.processing === 'Processed' && !log.errorDetails) {
    warnings.push('Error status with processed state but no error details');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// Function to get logs that need fixing
export function getLogsNeedingFixes(logs: LogEntry[]): LogEntry[] {
  return logs.filter(log => {
    const validation = validateLogStructure(log);
    return !validation.isValid || validation.errors.length > 0;
  });
}

// Function to get fix recommendations for a log
export function getFixRecommendations(log: LogEntry): {
  ruleId: string;
  name: string;
  description: string;
  priority: number;
  category: string;
}[] {
  const sortedRules = getSortedRules();
  const recommendations = [];

  for (const rule of sortedRules) {
    if (rule.condition(log)) {
      recommendations.push({
        ruleId: rule.id,
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        category: rule.category
      });
    }
  }

  return recommendations.sort((a, b) => b.priority - a.priority);
} 