/**
 * useTaskMutations Hook
 * 
 * Provides functions for creating, updating, deleting, completing, and snoozing tasks.
 */

import { useState, useCallback } from 'react';
import { doc, updateDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { UnifiedTask, TaskSnoozeOptions } from '../types/UnifiedTask';
import { TaskStatus } from '../types/Tasks';
import { TaskService } from '../utils/taskService';
import { addHours, addDays, startOfTomorrow, addWeeks, parseISO, endOfDay, startOfDay } from 'date-fns';

interface UseTaskMutationsResult {
  completeTask: (taskId: string) => Promise<void>;
  uncompleteTask: (taskId: string) => Promise<void>;
  snoozeTask: (taskId: string, options: TaskSnoozeOptions) => Promise<void>;
  unsnoozeTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  updateTask: (taskId: string, updates: Partial<UnifiedTask>) => Promise<void>;
  loading: boolean;
  error: Error | null;
}

export function useTaskMutations(): UseTaskMutationsResult {
  const { user, activeTenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const effectiveTenantId = activeTenant?.id || (user as any)?.activeTenantId;

  const completeTask = useCallback(async (taskId: string) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      await updateDoc(taskRef, {
        status: 'completed' as TaskStatus,
        completedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  const uncompleteTask = useCallback(async (taskId: string) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      
      // Determine appropriate status based on due date
      const taskDoc = await getDoc(taskRef);
      const taskData = taskDoc.data();
      const dueDate = taskData?.dueDate || taskData?.scheduledDate;
      
      let newStatus: TaskStatus = 'upcoming';
      if (dueDate) {
        const due = parseISO(dueDate);
        const now = new Date();
        if (due < now) {
          newStatus = 'overdue';
        } else if (due.toDateString() === now.toDateString()) {
          newStatus = 'due';
        }
      }

      await updateDoc(taskRef, {
        status: newStatus,
        completedAt: null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  const snoozeTask = useCallback(async (taskId: string, options: TaskSnoozeOptions) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      let snoozedUntil: string;

      switch (options.until) {
        case 'later_today':
          snoozedUntil = endOfDay(new Date()).toISOString();
          break;
        case 'tomorrow':
          snoozedUntil = startOfTomorrow().toISOString();
          break;
        case 'next_week':
          snoozedUntil = addWeeks(startOfDay(new Date()), 1).toISOString();
          break;
        case 'custom':
          if (!options.customDate) {
            throw new Error('Custom date required for custom snooze option');
          }
          // Handle datetime-local format (YYYY-MM-DDTHH:mm)
          snoozedUntil = parseISO(options.customDate).toISOString();
          break;
        default:
          throw new Error('Invalid snooze option');
      }

      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      await updateDoc(taskRef, {
        snoozedUntil,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  const unsnoozeTask = useCallback(async (taskId: string) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      await updateDoc(taskRef, {
        snoozedUntil: null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      await deleteDoc(taskRef);
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  const updateTask = useCallback(async (taskId: string, updates: Partial<UnifiedTask>) => {
    if (!effectiveTenantId || !user?.uid) {
      throw new Error('Missing tenant or user');
    }

    setLoading(true);
    setError(null);

    try {
      const taskRef = doc(db, 'tenants', effectiveTenantId, 'tasks', taskId);
      
      // Remove id from updates if present (can't update document ID)
      const { id, ...updateData } = updates;
      
      await updateDoc(taskRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId, user?.uid]);

  return {
    completeTask,
    uncompleteTask,
    snoozeTask,
    unsnoozeTask,
    deleteTask,
    updateTask,
    loading,
    error,
  };
}

