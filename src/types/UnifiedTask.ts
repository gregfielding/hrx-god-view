/**
 * Unified Task Types
 * 
 * Extends the existing Task interface to support the Unified Tasks Hub.
 * Includes snooze functionality and source tracking.
 */

import { Task, TaskStatus, TaskPriority, TaskType, TaskCategory } from './Tasks';

export interface UnifiedTask extends Task {
  // Snooze functionality
  snoozedUntil?: string; // ISO date string - task is hidden until this date
  
  // Source tracking for unified view
  sourceType?: 'crm' | 'recruiting' | 'onboarding' | 'admin' | 'google_tasks' | 'other';
  sourceId?: string; // ID of the source object (deal, contact, application, etc.)
  sourceName?: string; // Human-readable source name for display
  
  // Recurring task support (extends existing)
  recurringRule?: string; // RRULE format for recurring tasks
  
  // Badges/flags
  isScheduled?: boolean; // Has a scheduled time
  isRecurring?: boolean; // Repeats on a schedule
  isSynced?: boolean; // Synced with Google Tasks/Calendar
  syncSource?: 'google_tasks' | 'google_calendar' | null;
}

export interface TaskGroup {
  label: string;
  tasks: UnifiedTask[];
  collapsed?: boolean; // For completed tasks section
}

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  type?: TaskType[];
  category?: TaskCategory[];
  assignedBy?: string; // User ID
  dueWindow?: 'overdue' | 'today' | 'this_week' | 'next_week' | 'this_month' | 'all';
  sourceType?: UnifiedTask['sourceType'][];
  sourceId?: string;
  search?: string; // Text search in title/description
}

export interface TaskSnoozeOptions {
  until: 'later_today' | 'tomorrow' | 'next_week' | 'custom';
  customDate?: string; // ISO date string for custom option (datetime-local format)
}

