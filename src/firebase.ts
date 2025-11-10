import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, setLogLevel, initializeFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getAnalytics } from 'firebase/analytics';

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
      const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
      const settings: any = {
        ignoreUndefinedProperties: true,
      };
      if (isDev) {
        // Force long polling in development to avoid WebChannel terminate noise
        settings.experimentalForceLongPolling = true;
        settings.useFetchStreams = false;
      } else {
        // Production: default transport; allow fetch streams
        settings.useFetchStreams = true;
      }
      return initializeFirestore(app, settings as any);
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

// Initialize Analytics (only in browser environment)
export const analytics = (() => {
  if (typeof window !== 'undefined') {
    try {
      return getAnalytics(app);
    } catch (error) {
      console.warn('Firebase Analytics initialization failed:', error);
      return null;
    }
  }
  return null;
})();

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
