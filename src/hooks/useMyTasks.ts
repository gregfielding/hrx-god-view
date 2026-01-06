/**
 * useMyTasks Hook
 * 
 * Fetches all tasks assigned to the current user across all sources.
 * Supports real-time updates and filtering.
 */

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { UnifiedTask, TaskFilters } from '../types/UnifiedTask';
import { TaskStatus } from '../types/Tasks';
import { isPast, isToday, isFuture, addDays, parseISO, startOfDay, endOfDay } from 'date-fns';

interface UseMyTasksOptions {
  filters?: TaskFilters;
  includeCompleted?: boolean;
  limit?: number;
}

interface UseMyTasksResult {
  tasks: UnifiedTask[];
  groupedTasks: {
    overdue: UnifiedTask[];
    today: UnifiedTask[];
    upcoming: UnifiedTask[];
    snoozed: UnifiedTask[];
    completed: UnifiedTask[];
  };
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useMyTasks(options: UseMyTasksOptions = {}): UseMyTasksResult {
  const { user, activeTenant } = useAuth();
  const { filters = {}, includeCompleted = false, limit } = options;
  
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const effectiveTenantId = activeTenant?.id || (user as any)?.activeTenantId;

  useEffect(() => {
    if (!user?.uid || !effectiveTenantId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build Firestore query
      const tasksRef = collection(db, 'tenants', effectiveTenantId, 'tasks');
      
      // Base query: tasks assigned to current user
      // Note: Firestore requires a composite index for multiple orderBy clauses
      // For now, we'll use a single orderBy and sort in memory if needed
      let q = query(
        tasksRef,
        where('assignedTo', '==', user.uid),
        orderBy('scheduledDate', 'asc')
      );

      // Apply filters
      if (filters.status && filters.status.length > 0) {
        // Note: Firestore 'in' queries are limited to 10 values
        if (filters.status.length <= 10) {
          q = query(q, where('status', 'in', filters.status));
        }
      }

      if (filters.priority && filters.priority.length > 0 && filters.priority.length <= 10) {
        q = query(q, where('priority', 'in', filters.priority));
      }

      if (filters.type && filters.type.length > 0 && filters.type.length <= 10) {
        q = query(q, where('type', 'in', filters.type));
      }

      if (filters.assignedBy) {
        q = query(q, where('createdBy', '==', filters.assignedBy));
      }

      if (filters.sourceType && filters.sourceType.length > 0 && filters.sourceType.length <= 10) {
        q = query(q, where('sourceType', 'in', filters.sourceType));
      }

      if (filters.sourceId) {
        // This would need to check associations or sourceId field
        // For now, we'll filter in memory
      }

      // Subscribe to real-time updates
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const allTasks: UnifiedTask[] = [];
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            const task: UnifiedTask = {
              id: doc.id,
              ...data,
              // Ensure snoozedUntil is properly typed
              snoozedUntil: data.snoozedUntil || undefined,
              sourceType: data.sourceType || 'other',
              sourceId: data.sourceId || undefined,
              sourceName: data.sourceName || undefined,
            } as UnifiedTask;

            // Filter out completed tasks if not included
            if (!includeCompleted && task.status === 'completed') {
              return;
            }

            // Filter by snooze status
            if (task.snoozedUntil) {
              const snoozeDate = parseISO(task.snoozedUntil);
              if (isFuture(snoozeDate)) {
                // Task is still snoozed, include it in snoozed group but not active groups
                allTasks.push(task);
                return;
              }
            }

            // Apply text search filter
            if (filters.search) {
              const searchLower = filters.search.toLowerCase();
              const matchesTitle = task.title?.toLowerCase().includes(searchLower);
              const matchesDescription = task.description?.toLowerCase().includes(searchLower);
              if (!matchesTitle && !matchesDescription) {
                return;
              }
            }

            // Filter by sourceId if specified
            if (filters.sourceId) {
              const hasSourceMatch = 
                task.sourceId === filters.sourceId ||
                task.associations?.deals?.includes(filters.sourceId) ||
                task.associations?.contacts?.includes(filters.sourceId) ||
                task.associations?.companies?.includes(filters.sourceId);
              if (!hasSourceMatch) {
                return;
              }
            }

            allTasks.push(task);
          });

          // Apply due window filter
          let filteredTasks = allTasks;
          if (filters.dueWindow) {
            const now = new Date();
            const today = startOfDay(now);
            const nextWeek = addDays(today, 7);
            const nextMonth = addDays(today, 30);

            filteredTasks = allTasks.filter((task) => {
              if (!task.dueDate && !task.scheduledDate) return false;
              
              const dueDate = task.dueDate ? parseISO(task.dueDate) : parseISO(task.scheduledDate);
              
              switch (filters.dueWindow) {
                case 'overdue':
                  return isPast(dueDate) && !isToday(dueDate);
                case 'today':
                  return isToday(dueDate);
                case 'this_week':
                  return isFuture(dueDate) && dueDate <= nextWeek;
                case 'next_week':
                  return dueDate > nextWeek && dueDate <= addDays(nextWeek, 7);
                case 'this_month':
                  return dueDate <= nextMonth;
                case 'all':
                default:
                  return true;
              }
            });
          }

          // Apply limit if specified
          if (limit && filteredTasks.length > limit) {
            filteredTasks = filteredTasks.slice(0, limit);
          }

          setTasks(filteredTasks);
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching tasks:', err);
          setError(err);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.error('Error setting up task subscription:', err);
      setError(err as Error);
      setLoading(false);
    }
  }, [user?.uid, effectiveTenantId, JSON.stringify(filters), includeCompleted, limit]);

  // Group tasks by status
  const groupedTasks = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const twoWeeksFromNow = addDays(today, 14);

    const overdue: UnifiedTask[] = [];
    const todayTasks: UnifiedTask[] = [];
    const upcoming: UnifiedTask[] = [];
    const snoozed: UnifiedTask[] = [];
    const completed: UnifiedTask[] = [];

    tasks.forEach((task) => {
      // Check if task is snoozed
      if (task.snoozedUntil) {
        const snoozeDate = parseISO(task.snoozedUntil);
        if (isFuture(snoozeDate)) {
          snoozed.push(task);
          return;
        }
      }

      // Completed tasks
      if (task.status === 'completed') {
        completed.push(task);
        return;
      }

      // Get due date (prefer dueDate, fallback to scheduledDate)
      const dueDate = task.dueDate 
        ? parseISO(task.dueDate) 
        : task.scheduledDate 
        ? parseISO(task.scheduledDate) 
        : null;

      if (!dueDate) {
        // No due date, put in upcoming
        upcoming.push(task);
        return;
      }

      // Overdue
      if (isPast(dueDate) && !isToday(dueDate)) {
        overdue.push(task);
        return;
      }

      // Today
      if (isToday(dueDate)) {
        todayTasks.push(task);
        return;
      }

      // Upcoming (next 14 days)
      if (isFuture(dueDate) && dueDate <= twoWeeksFromNow) {
        upcoming.push(task);
        return;
      }

      // Beyond 14 days, still put in upcoming
      upcoming.push(task);
    });

    // Sort each group
    const sortByDueDate = (a: UnifiedTask, b: UnifiedTask) => {
      const aDate = a.dueDate ? parseISO(a.dueDate) : a.scheduledDate ? parseISO(a.scheduledDate) : new Date(0);
      const bDate = b.dueDate ? parseISO(b.dueDate) : b.scheduledDate ? parseISO(b.scheduledDate) : new Date(0);
      return aDate.getTime() - bDate.getTime();
    };

    overdue.sort(sortByDueDate);
    todayTasks.sort(sortByDueDate);
    upcoming.sort(sortByDueDate);
    snoozed.sort((a, b) => {
      const aSnooze = a.snoozedUntil ? parseISO(a.snoozedUntil).getTime() : 0;
      const bSnooze = b.snoozedUntil ? parseISO(b.snoozedUntil).getTime() : 0;
      return aSnooze - bSnooze;
    });
    completed.sort((a, b) => {
      const aCompleted = a.completedAt ? parseISO(a.completedAt).getTime() : 0;
      const bCompleted = b.completedAt ? parseISO(b.completedAt).getTime() : 0;
      return bCompleted - aCompleted; // Most recent first
    });

    return { overdue, today: todayTasks, upcoming, snoozed, completed };
  }, [tasks]);

  const refresh = () => {
    // Force re-fetch by updating a dependency
    // The useEffect will handle the actual refresh
    setLoading(true);
  };

  return {
    tasks,
    groupedTasks,
    loading,
    error,
    refresh,
  };
}

