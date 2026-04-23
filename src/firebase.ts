import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, setLogLevel, initializeFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getAnalytics, logEvent as firebaseLogEvent, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export { app };
// Use initializeFirestore in browser to avoid WebChannel (reduces terminate 400 noise)
export const db = (() => {
  try {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      // CRA Fast Refresh can re-evaluate modules and accidentally create multiple Firestore
      // instances. That can trigger rare internal assertion errors in the SDK.
      // Keep a single instance on window to guarantee singleton behavior in dev.
      const w = window as any;
      const existing = w.__HRX_FIRESTORE__ as Firestore | undefined;
      if (existing) return existing;

      const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
      // Firestore can hit rare internal assertion failures in some network environments
      // (especially with flaky HTTP/3 / QUIC). Long-polling is more resilient.
      //
      // IMPORTANT: We force long-polling for all browser sessions because these assertion
      // failures are catastrophic (crash the app) and we've observed them in local dev.
      const settings: any = {
        ignoreUndefinedProperties: true,
        experimentalAutoDetectLongPolling: true,
        experimentalForceLongPolling: true,
        // Keep fetch streams off for stability; they can interact poorly with some proxies.
        useFetchStreams: false,
      };

      const instance = initializeFirestore(app, settings as any);
      w.__HRX_FIRESTORE__ = instance;
      return instance;
    }
    return getFirestore(app);
  } catch {
    // Fallback if initializeFirestore is unavailable
    return getFirestore(app);
  }
})();
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// Dev-only: expose Firebase handles to window for one-off devtools invocations
// (e.g. calling httpsCallable from the console). Safe because these are the
// same handles the app already uses; no additional privileges are granted.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as any;
  w.__HRX__ = { ...(w.__HRX__ || {}), app, auth, functions, db };
}

/**
 * Analytics uses IndexedDB; full disk / strict privacy mode → QuotaExceededError and CRA dev overlay.
 * Local dev: off unless REACT_APP_ENABLE_FIREBASE_ANALYTICS=true (see .env).
 */
function shouldInitializeAnalytics(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV === 'development') {
    return process.env.REACT_APP_ENABLE_FIREBASE_ANALYTICS === 'true';
  }
  return true;
}

// Initialize Analytics (only in browser environment)
export const analytics = (() => {
  if (!shouldInitializeAnalytics()) {
    return null;
  }
  try {
    return getAnalytics(app);
  } catch (error) {
    console.warn('Firebase Analytics initialization failed:', error);
    return null;
  }
})();

/** Best-effort Analytics events — IndexedDB quota (private mode, full disk) can throw QuotaExceededError. */
export function safeLogEvent(
  analyticsInstance: Analytics | null,
  eventName: string,
  eventParams?: Record<string, unknown>
): void {
  if (!analyticsInstance) return;
  try {
    firebaseLogEvent(analyticsInstance, eventName, eventParams as never);
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'QuotaExceededError') return;
    if (process.env.NODE_ENV === 'development') {
      console.warn('Firebase Analytics logEvent failed:', e);
    }
  }
}

// Firestore client logging (opt‑in).
// Enable by appending ?firestoreDebug=1 to the URL or setting
// localStorage.setItem('firestoreDebug','1') and reloading.
try {
  const hasWindow = typeof window !== 'undefined';
  const qp = hasWindow ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const qFlag = (qp.get('firestoreDebug') || '').toLowerCase();
  const lsFlag = hasWindow ? (localStorage.getItem('firestoreDebug') || '').toLowerCase() : '';
  const debugEnabled = qFlag === '1' || qFlag === 'true' || lsFlag === '1' || lsFlag === 'true';
  if (debugEnabled) {
    setLogLevel('debug');
    // eslint-disable-next-line no-console
    console.info('[Firestore] Debug logging enabled (opt-in)');
  } else {
    // Use 'silent' to best-effort suppress SDK logs that bubble to console
    setLogLevel('silent');
  }
} catch {
  // ignore if setLogLevel is unavailable in some environments
}
