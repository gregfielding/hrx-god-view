export type AppLanguage = 'en' | 'es';

const LOCAL_KEY = 'hrx_preferred_language';
const LEGACY_LOCAL_KEY = 'hrx_guest_preferred_language';
const SESSION_CHANGED_KEY = 'hrx_language_changed_this_session';

export function detectDefaultLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function readLocalLanguage(): AppLanguage {
  try {
    const local = localStorage.getItem(LOCAL_KEY);
    if (local === 'en' || local === 'es') return local;
    const legacy = localStorage.getItem(LEGACY_LOCAL_KEY);
    if (legacy === 'en' || legacy === 'es') {
      localStorage.setItem(LOCAL_KEY, legacy);
      return legacy;
    }
  } catch {
    // ignore localStorage access failures
  }
  return detectDefaultLanguage();
}

export function writeLocalLanguage(lang: AppLanguage, options?: { markChangedThisSession?: boolean }): void {
  try {
    localStorage.setItem(LOCAL_KEY, lang);
    // Keep backward compatibility with existing callers/readers.
    localStorage.setItem(LEGACY_LOCAL_KEY, lang);
    if (options?.markChangedThisSession) {
      sessionStorage.setItem(SESSION_CHANGED_KEY, '1');
    }
  } catch {
    // ignore localStorage/sessionStorage access failures
  }
}

export function hasLanguageChangedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_CHANGED_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearLanguageChangedThisSession(): void {
  try {
    sessionStorage.removeItem(SESSION_CHANGED_KEY);
  } catch {
    // ignore storage failures
  }
}

