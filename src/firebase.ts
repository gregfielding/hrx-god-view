import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

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
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

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
    setLogLevel('error'); // keep console noise low by default
  }
} catch {
  // ignore if setLogLevel is unavailable in some environments
}
