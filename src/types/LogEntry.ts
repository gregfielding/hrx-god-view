// /types/LogEntry.ts - Comprehensive log entry interface for AutoDevOps

export interface LogEntry {
  id?: string;
  timestamp: string;
  userId?: string;
  actorId?: string;
  targetId?: string;
  eventType: string;
  fieldChanged?: string;
  oldValue?: any;
  newValue?: any;
  triggerType?: 'create' | 'update' | 'delete' | 'field_change' | 'system_event';
  module?: string;
  destinationModules?: string[];
  status: 'Success' | 'Error' | 'Fixed' | 'Unfixable' | 'Pending' | 'Processing';
  processing?: 'Pending' | 'Processed' | 'Failed' | 'Retrying';
  engines?: string[];
  notes?: string[];
  errorDetails?: {
    code: string;
    message: string;
    stack?: string;
  };
  autoDevOps?: {
    fixedAt?: string;
    fixedBy?: string;
    originalStatus?: string;
    fixRule?: string;
    reprocessed?: boolean;
  };
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    sessionId?: string;
    requestId?: string;
  };
  validation?: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface LogFixRule {
  id: string;
  name: string;
  condition: (log: LogEntry) => boolean;
  fix: (log: LogEntry) => LogEntry;
  description: string;
  priority: number; // Higher priority rules run first
  category: 'critical' | 'warning' | 'info';
  autoApply: boolean; // Whether to apply automatically or require review
}

export interface LogFixResult {
  logId: string;
  originalLog: LogEntry;
  fixedLog: LogEntry;
  ruleApplied: string;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface AutoDevOpsStats {
  totalLogsScanned: number;
  logsFixed: number;
  logsUnfixable: number;
  errorsEncountered: number;
  processingTime: number;
  timestamp: string;
} 