/**
 * useTaskFilters Hook
 * 
 * Manages filter state and provides filter UI helpers.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { TaskFilters } from '../types/UnifiedTask';
import { TaskStatus, TaskPriority, TaskType, TaskCategory } from '../types/Tasks';

interface UseTaskFiltersResult {
  filters: TaskFilters;
  setFilters: (filters: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => void;
  updateFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  filterCount: number;
}

const defaultFilters: TaskFilters = {};

const STORAGE_KEY = 'unifiedTasksFilters';

export function useTaskFilters(initialFilters?: TaskFilters): UseTaskFiltersResult {
  // Load from localStorage on mount
  const loadFiltersFromStorage = useCallback((): TaskFilters => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (err) {
      console.warn('Failed to load filters from localStorage:', err);
    }
    return initialFilters || defaultFilters;
  }, [initialFilters]);

  const [filters, setFilters] = useState<TaskFilters>(loadFiltersFromStorage);

  // Persist to localStorage whenever filters change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch (err) {
      console.warn('Failed to save filters to localStorage:', err);
    }
  }, [filters]);

  const updateFilter = useCallback(<K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  const hasActiveFilters = useMemo(() => {
    return !!(
      (filters.status && filters.status.length > 0) ||
      (filters.priority && filters.priority.length > 0) ||
      (filters.type && filters.type.length > 0) ||
      (filters.category && filters.category.length > 0) ||
      filters.assignedBy ||
      filters.dueWindow ||
      (filters.sourceType && filters.sourceType.length > 0) ||
      filters.sourceId ||
      (filters.search && filters.search.trim().length > 0)
    );
  }, [filters]);

  const filterCount = useMemo(() => {
    let count = 0;
    if (filters.status && filters.status.length > 0) count++;
    if (filters.priority && filters.priority.length > 0) count++;
    if (filters.type && filters.type.length > 0) count++;
    if (filters.category && filters.category.length > 0) count++;
    if (filters.assignedBy) count++;
    if (filters.dueWindow) count++;
    if (filters.sourceType && filters.sourceType.length > 0) count++;
    if (filters.sourceId) count++;
    if (filters.search && filters.search.trim().length > 0) count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilters,
    updateFilter,
    clearFilters,
    hasActiveFilters,
    filterCount,
  };
}

