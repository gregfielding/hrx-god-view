// /utils/logErrorTypemap.ts - Comprehensive error type mapping and fix strategies

import { LogFixRule } from '../types/LogEntry';

import { inferModuleFromEventType, inferDestinationModules } from './inferModuleFromEventType';

export const logErrorTypemap: LogFixRule[] = [
  // CRITICAL FIXES - Run First
  {
    id: 'missing_timestamp',
    name: 'Fix Missing or Invalid Timestamp',
    condition: (log) => !log.timestamp || log.timestamp.includes('Invalid') || log.timestamp.includes('NaN'),
    fix: (log) => ({
      ...log,
      timestamp: new Date().toISOString(),
      notes: [...(log.notes || []), 'AutoDevOps: Fixed invalid timestamp'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'missing_timestamp',
        reprocessed: false
      }
    }),
    description: 'Fix invalid or missing timestamp',
    priority: 100,
    category: 'critical',
    autoApply: true
  },

  {
    id: 'missing_event_type',
    name: 'Fix Missing Event Type',
    condition: (log) => !log.eventType || log.eventType.trim() === '',
    fix: (log) => ({
      ...log,
      eventType: 'unknown_event',
      notes: [...(log.notes || []), 'AutoDevOps: Added default event type'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'missing_event_type',
        reprocessed: false
      }
    }),
    description: 'Add default event type for missing events',
    priority: 95,
    category: 'critical',
    autoApply: true
  },

  {
    id: 'missing_module',
    name: 'Infer Missing Module',
    condition: (log) => !log.module || log.module === 'Unknown',
    fix: (log) => {
      const inferredModule = inferModuleFromEventType(log.eventType);
      const destinationModules = inferDestinationModules(log.eventType, inferredModule);
      
      return {
        ...log,
        module: inferredModule,
        destinationModules,
        notes: [...(log.notes || []), `AutoDevOps: Module inferred as ${inferredModule}`],
        autoDevOps: {
          ...log.autoDevOps,
          fixedAt: new Date().toISOString(),
          fixedBy: 'AutoDevOps',
          originalStatus: log.status,
          fixRule: 'missing_module',
          reprocessed: false
        }
      };
    },
    description: 'Infer missing module from event type',
    priority: 90,
    category: 'critical',
    autoApply: true
  },

  // WARNING FIXES - Run Second
  {
    id: 'false_error_status',
    name: 'Fix False Error Status',
    condition: (log) => log.status === 'Error' && log.processing === 'Processed' && !log.errorDetails,
    fix: (log) => ({
      ...log,
      status: 'Success',
      notes: [...(log.notes || []), 'AutoDevOps: Corrected false error status'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'false_error_status',
        reprocessed: false
      }
    }),
    description: 'Reclassify false error state',
    priority: 80,
    category: 'warning',
    autoApply: true
  },

  {
    id: 'missing_user_id',
    name: 'Fix Missing User ID',
    condition: (log) => !log.userId && !log.actorId && log.eventType.includes('user'),
    fix: (log) => ({
      ...log,
      userId: 'system_user',
      actorId: 'system_user',
      notes: [...(log.notes || []), 'AutoDevOps: Added system user ID'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'missing_user_id',
        reprocessed: false
      }
    }),
    description: 'Add system user ID for user events',
    priority: 75,
    category: 'warning',
    autoApply: true
  },

  {
    id: 'invalid_field_values',
    name: 'Fix Invalid Field Values',
    condition: (log) => {
      // Check for common invalid values
      const invalidValues = [undefined, null, 'undefined', 'null', 'NaN', ''];
      return (
        (log.oldValue && invalidValues.includes(log.oldValue)) ||
        (log.newValue && invalidValues.includes(log.newValue))
      );
    },
    fix: (log) => ({
      ...log,
      oldValue: log.oldValue === 'undefined' || log.oldValue === 'null' || log.oldValue === 'NaN' ? null : log.oldValue,
      newValue: log.newValue === 'undefined' || log.newValue === 'null' || log.newValue === 'NaN' ? null : log.newValue,
      notes: [...(log.notes || []), 'AutoDevOps: Cleaned invalid field values'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'invalid_field_values',
        reprocessed: false
      }
    }),
    description: 'Clean invalid field values',
    priority: 70,
    category: 'warning',
    autoApply: true
  },

  {
    id: 'missing_trigger_type',
    name: 'Fix Missing Trigger Type',
    condition: (log) => !log.triggerType,
    fix: (log) => {
      let triggerType: 'create' | 'update' | 'delete' | 'field_change' | 'system_event' = 'system_event';
      
      if (log.eventType.includes('create') || log.eventType.includes('add')) {
        triggerType = 'create';
      } else if (log.eventType.includes('update') || log.eventType.includes('change') || log.fieldChanged) {
        triggerType = 'field_change';
      } else if (log.eventType.includes('delete') || log.eventType.includes('remove')) {
        triggerType = 'delete';
      }

      return {
        ...log,
        triggerType,
        notes: [...(log.notes || []), `AutoDevOps: Inferred trigger type as ${triggerType}`],
        autoDevOps: {
          ...log.autoDevOps,
          fixedAt: new Date().toISOString(),
          fixedBy: 'AutoDevOps',
          originalStatus: log.status,
          fixRule: 'missing_trigger_type',
          reprocessed: false
        }
      };
    },
    description: 'Infer missing trigger type',
    priority: 65,
    category: 'warning',
    autoApply: true
  },

  // INFO FIXES - Run Last
  {
    id: 'missing_engines',
    name: 'Add Missing Engines',
    condition: (log) => !log.engines || log.engines.length === 0,
    fix: (log) => {
      const engines = [];
      if (log.module) engines.push(log.module);
      if (log.destinationModules) engines.push(...log.destinationModules);
      
      return {
        ...log,
        engines: [...new Set(engines)],
        notes: [...(log.notes || []), 'AutoDevOps: Added missing engines'],
        autoDevOps: {
          ...log.autoDevOps,
          fixedAt: new Date().toISOString(),
          fixedBy: 'AutoDevOps',
          originalStatus: log.status,
          fixRule: 'missing_engines',
          reprocessed: false
        }
      };
    },
    description: 'Add missing engine references',
    priority: 50,
    category: 'info',
    autoApply: true
  },

  {
    id: 'stale_processing_status',
    name: 'Fix Stale Processing Status',
    condition: (log) => log.processing === 'Pending' && 
      new Date(log.timestamp).getTime() < Date.now() - (24 * 60 * 60 * 1000), // 24 hours old
    fix: (log) => ({
      ...log,
      processing: 'Failed',
      status: 'Error',
      notes: [...(log.notes || []), 'AutoDevOps: Marked stale pending log as failed'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'stale_processing_status',
        reprocessed: false
      }
    }),
    description: 'Mark stale pending logs as failed',
    priority: 40,
    category: 'info',
    autoApply: true
  },

  {
    id: 'missing_validation',
    name: 'Add Validation Status',
    condition: (log) => !log.validation,
    fix: (log) => ({
      ...log,
      validation: {
        isValid: log.status === 'Success' || log.status === 'Fixed',
        errors: log.status === 'Error' ? ['AutoDevOps: Validation added'] : [],
        warnings: []
      },
      notes: [...(log.notes || []), 'AutoDevOps: Added validation status'],
      autoDevOps: {
        ...log.autoDevOps,
        fixedAt: new Date().toISOString(),
        fixedBy: 'AutoDevOps',
        originalStatus: log.status,
        fixRule: 'missing_validation',
        reprocessed: false
      }
    }),
    description: 'Add validation status to logs',
    priority: 30,
    category: 'info',
    autoApply: true
  }
];

// Helper function to get rules by category
export function getRulesByCategory(category: 'critical' | 'warning' | 'info'): LogFixRule[] {
  return logErrorTypemap.filter(rule => rule.category === category);
}

// Helper function to get auto-apply rules
export function getAutoApplyRules(): LogFixRule[] {
  return logErrorTypemap.filter(rule => rule.autoApply);
}

// Helper function to sort rules by priority
export function getSortedRules(): LogFixRule[] {
  return [...logErrorTypemap].sort((a, b) => b.priority - a.priority);
} 