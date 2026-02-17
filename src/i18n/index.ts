/**
 * Lightweight static UI i18n for worker portal + jobs board.
 * Loads en.json / es.json from public/i18n/locales. Fallback: es → en → key.
 * Language is set by the app from users/{userId}.preferredLanguage (e.g. WorkerAppBar).
 */

import * as React from 'react';

export type UiLanguage = 'en' | 'es';

type Messages = Record<string, unknown>;

const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL ? process.env.PUBLIC_URL : '';
const cache: Record<UiLanguage, Messages | null> = { en: null, es: null };
let currentLanguage: UiLanguage = 'en';
const listeners = new Set<() => void>();

function getCached(lang: UiLanguage): Messages | null {
  return cache[lang];
}

function setCached(lang: UiLanguage, data: Messages): void {
  cache[lang] = data;
}

export function loadLocale(lang: UiLanguage): Promise<Messages> {
  const existing = getCached(lang);
  if (existing) return Promise.resolve(existing);
  const url = `${base}/i18n/locales/${lang}.json`;
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`i18n load failed: ${r.status}`);
      return r.json();
    })
    .then((data: Messages) => {
      setCached(lang, data);
      return data;
    });
}

/** Preload both locales (e.g. after auth). */
export function preloadLocales(): void {
  loadLocale('en').catch(() => {});
  loadLocale('es').catch(() => {});
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function substituteParams(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    if (params[key] !== undefined) return String(params[key]);
    return `{${key}}`;
  });
}

/**
 * Translate a key. Fallback: current lang → en → key.
 * Placeholders: use {count}, {name}, etc. and pass params.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const tryLang = (lang: UiLanguage): string | undefined => {
    const messages = getCached(lang);
    if (!messages) return undefined;
    const value = getByPath(messages, key);
    return typeof value === 'string' ? value : undefined;
  };
  const value = tryLang(currentLanguage) ?? tryLang('en');
  const raw = value ?? key;
  return substituteParams(raw, params);
}

export function getLanguage(): UiLanguage {
  return currentLanguage;
}

/**
 * Set current UI language (e.g. when user profile preferredLanguage loads or user toggles).
 * Loads the locale if not yet loaded, then notifies listeners so useT() re-renders.
 */
export function setLanguage(lang: UiLanguage): void {
  const prev = currentLanguage;
  currentLanguage = lang;
  const cached = getCached(lang);
  if (cached) {
    if (prev !== lang) listeners.forEach((f) => f());
    return;
  }
  loadLocale(lang).then(
    () => listeners.forEach((f) => f()),
    () => listeners.forEach((f) => f())
  );
}

/**
 * Subscribe to language changes. Use in worker-facing components so they re-render when language changes.
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const handler = () => setTick((n) => n + 1);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return t;
}
