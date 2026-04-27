/**
 * useMentionAutocomplete Hook
 * 
 * Powers @mention autocomplete with debounced search and caching.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { MentionOption } from '../types/mentions';

interface UseMentionAutocompleteResult {
  options: MentionOption[];
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  selectOption: (opt: MentionOption) => void;
  reset: () => void;
}

const mentionSearch = httpsCallable<{ query: string; limit?: number }, { users: Array<{
  id: string;
  fullName: string;
  username: string;
  email: string;
  avatarUrl?: string;
  slackUsername?: string;
}> }>(functions, 'mentionSearch');

// Cache for recent search results
const searchCache = new Map<string, MentionOption[]>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

/**
 * Hook that powers @mention autocomplete.
 * - Debounces search
 * - Caches recent results
 */
export function useMentionAutocomplete(
  initialQuery = ''
): UseMentionAutocompleteResult {
  const [query, setQuery] = useState(initialQuery);
  const [options, setOptions] = useState<MentionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const selectCallbackRef = useRef<((opt: MentionOption) => void) | null>(null);

  // Debounced search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setOptions([]);
      setLoading(false);
      return;
    }

    const trimmedQuery = searchQuery.trim().toLowerCase();
    
    // Check cache
    const cached = searchCache.get(trimmedQuery);
    const cacheTime = cacheTimestamps.get(trimmedQuery);
    const now = Date.now();
    
    if (cached && cacheTime && now - cacheTime < CACHE_TTL_MS) {
      setOptions(cached);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const result = await mentionSearch({ query: trimmedQuery, limit: 20 });
      const users = result.data.users || [];
      
      const mentionOptions: MentionOption[] = users.map(user => ({
        id: user.id,
        username: user.username,
        label: user.fullName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      }));

      // Update cache
      searchCache.set(trimmedQuery, mentionOptions);
      cacheTimestamps.set(trimmedQuery, now);

      setOptions(mentionOptions);
    } catch (error: any) {
      console.error('Error searching mentions:', error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(query);
    }, 300); // 300ms debounce

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  const selectOption = useCallback((opt: MentionOption) => {
    if (selectCallbackRef.current) {
      selectCallbackRef.current(opt);
    }
  }, []);

  const reset = useCallback(() => {
    setQuery('');
    setOptions([]);
    setLoading(false);
  }, []);

  // Expose callback setter for MentionTextField
  useEffect(() => {
    (selectOption as any).setCallback = (callback: (opt: MentionOption) => void) => {
      selectCallbackRef.current = callback;
    };
  }, [selectOption]);

  return {
    options,
    loading,
    query,
    setQuery,
    selectOption,
    reset,
  };
}

