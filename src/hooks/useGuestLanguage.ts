/**
 * Guest (unauthenticated) language preference persisted in localStorage.
 * Used on Jobs Board and other public pages so language choice survives refresh
 * and can drive UI/job content language the same way Firestore preferredLanguage
 * does for logged-in users.
 */

import { useState, useEffect, useCallback } from 'react';
import { readLocalLanguage, writeLocalLanguage } from '../utils/languagePreference';

export type GuestLanguage = 'en' | 'es';

function readStored(): GuestLanguage {
  return readLocalLanguage();
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
    writeLocalLanguage(lang, { markChangedThisSession: true });
  }, []);

  return [language, setLanguage];
}
