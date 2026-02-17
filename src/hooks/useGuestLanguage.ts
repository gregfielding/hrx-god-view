/**
 * Guest (unauthenticated) language preference persisted in localStorage.
 * Used on Jobs Board and other public pages so language choice survives refresh
 * and can drive UI/job content language the same way Firestore preferredLanguage
 * does for logged-in users.
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'hrx_guest_preferred_language';

export type GuestLanguage = 'en' | 'es';

function detectDefault(): GuestLanguage {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function readStored(): GuestLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'en' || raw === 'es') return raw;
  } catch {
    // ignore
  }
  return detectDefault();
}

/**
 * Returns [language, setLanguage]. Language is persisted to localStorage
 * so it behaves like a session/preference for guests (no Firestore).
 */
export function useGuestLanguage(): [GuestLanguage, (lang: GuestLanguage) => void] {
  const [language, setLanguageState] = useState<GuestLanguage>(readStored);

  // Sync from storage when other tabs or remount might have changed it
  useEffect(() => {
    const stored = readStored();
    setLanguageState(stored);
  }, []);

  const setLanguage = useCallback((lang: GuestLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  return [language, setLanguage];
}
