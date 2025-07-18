// /firebase/fixLogEntry.ts - Firebase function to save fixed log entries

import { db } from '../firebase';
import { doc, setDoc, writeBatch, addDoc, collection } from 'firebase/firestore';
import { LogEntry } from '../types/LogEntry';

export async function fixLogEntry(log: LogEntry): Promise<void> {
  if (!log.id) {
    throw new Error('Missing log ID for fix operation');
  }

  try {
    // Update the log in the ai_logs collection
    const logRef = doc(db, 'ai_logs', log.id);
    await setDoc(logRef, log, { merge: true });
    
    console.log(`✅ AutoDevOps: Successfully updated log ${log.id} in Firebase`);
  } catch (error) {
    console.error(`❌ AutoDevOps: Failed to update log ${log.id}:`, error);
    throw new Error(`Failed to save fixed log: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Function to batch update multiple fixed logs
export async function batchFixLogEntries(logs: LogEntry[]): Promise<void> {
  if (logs.length === 0) {
    console.log('📝 AutoDevOps: No logs to batch update');
    return;
  }

  try {
    const batch = writeBatch(db);
    
    for (const log of logs) {
      if (!log.id) {
        console.warn(`⚠️ AutoDevOps: Skipping log without ID`);
        continue;
      }
      
      const logRef = doc(db, 'ai_logs', log.id);
      batch.set(logRef, log, { merge: true });
    }
    
    await batch.commit();
    console.log(`✅ AutoDevOps: Successfully batch updated ${logs.length} logs`);
  } catch (error) {
    console.error(`❌ AutoDevOps: Failed to batch update logs:`, error);
    throw new Error(`Failed to batch update logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Function to create a new log entry for AutoDevOps actions
export async function createAutoDevOpsLog(action: string, details: any): Promise<void> {
  const autoDevOpsLog: LogEntry = {
    timestamp: new Date().toISOString(),
    eventType: `auto_devops_${action}`,
    status: 'Success',
    processing: 'Processed',
    module: 'SystemManagement',
    triggerType: 'system_event',
    notes: [`AutoDevOps: ${action}`, JSON.stringify(details)],
    autoDevOps: {
      fixedAt: new Date().toISOString(),
      fixedBy: 'AutoDevOps',
      fixRule: action,
      reprocessed: false
    },
    validation: {
      isValid: true,
      errors: [],
      warnings: []
    }
  };

  try {
    const logsRef = collection(db, 'ai_logs');
    await addDoc(logsRef, autoDevOpsLog);
    console.log(`✅ AutoDevOps: Created action log for ${action}`);
  } catch (error) {
    console.error(`❌ AutoDevOps: Failed to create action log for ${action}:`, error);
  }
} 