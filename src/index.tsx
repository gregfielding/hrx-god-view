import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';

import './index.css';
import './setupConsoleFilters';
import { installPacClickFallback } from './utils/pacClickFallback';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ThemeModeProvider } from './theme/theme';
import { RootErrorBoundary } from './components/RootErrorBoundary';

// FCM Web Push — avoid SW caching issues on localhost dev.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  window.addEventListener('load', async () => {
    try {
      if (isLocalhost) {
        // In dev, proactively remove stale SW registrations that can serve old bundles.
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs
            .filter((r) => r.scope.includes(window.location.origin))
            .map((r) => r.unregister())
        );
        return;
      }

      await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    } catch (err) {
      console.warn('[SW] firebase-messaging-sw registration failed', err);
    }
  });
}

// Console noise suppression for Firestore internal errors (runs before components mount)
// These are SDK bugs that don't affect functionality - suppress in all environments
{
  const originalError = console.error;
  const originalWarn = console.warn;

  const argContains = (arg: any, needles: string[]): boolean => {
    try {
      if (!arg) return false;
      const s = typeof arg === 'string' ? arg : (arg?.message || arg?.stack || String(arg));
      return needles.some((n) => s.includes(n));
    } catch {
      return false;
    }
  };

  console.error = (...args: any[]) => {
    const needles = [
      'TYPE=terminate',
      'webchannel_blob_es2018.js',
      'google.firestore.v1.Firestore/Write/channel',
      'Firestore/Write/channel',
      'POST https://firestore.googleapis.com',
      'INTERNAL ASSERTION FAILED',
      'Internal assertion failed',
      'internal assertion failed',
      'Unexpected state',
      'unexpected state',
      '__PRIVATE__fail',
      '__PRIVATE_hardAssert',
      'TargetState.Ue',
      'WatchChangeAggregator',
      'ID: ca9',
      'ID: b815',
    ];
    const isTerminateNoise = args.some((a) => argContains(a, needles)) ||
      argContains(args?.map?.(String)?.join(' '), needles);

    const joined = args.map((a) => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ');
    const isAnalyticsQuota =
      joined.includes('QuotaExceededError') ||
      (joined.includes('@firebase/analytics') && joined.includes('QuotaExceeded'));

    if (isTerminateNoise || isAnalyticsQuota) return;
    originalError.apply(console, args as unknown as any);
  };

  console.warn = (...args: any[]) => {
    const message = args[0];
    if (typeof message === 'string' && (
      message.includes('google.maps.places.Autocomplete is not available') ||
      message.includes('Performance warning! LoadScript has been reloaded') ||
      message.includes('Google Maps already loaded outside')
    )) {
      return;
    }
    originalWarn.apply(console, args as unknown as any);
  };

  // Also suppress uncaught errors/unhandled rejections that match the benign Firestore terminate noise
  // and Firestore internal assertion errors (SDK bugs that don't affect functionality)
  const shouldSuppress = (text?: string) => {
    if (!text) return false;
    const textLower = text.toLowerCase();
    return (
      text.includes('TYPE=terminate') ||
      text.includes('https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel') ||
      (text.includes('google.firestore.v1.Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('POST https://firestore.googleapis.com') && text.includes('TYPE=terminate')) ||
      (textLower.includes('firestore') && textLower.includes('internal assertion failed')) ||
      textLower.includes('internal assertion failed') ||
      (textLower.includes('unexpected state') && (textLower.includes('firestore') || textLower.includes('id: ca9') || textLower.includes('id: b815'))) ||
      textLower.includes('__private__fail') ||
      textLower.includes('__private_hardassert') ||
      textLower.includes('targetstate.ue') ||
      textLower.includes('watchchangeaggregator')
    );
  };

  window.addEventListener('error', (event) => {
    try {
      const msg = String(event.message || '');
      const fname = (event as any).filename ? String((event as any).filename) : '';
      const errMsg = (event as any).error?.message ? String((event as any).error?.message) : '';
      if (shouldSuppress(msg) || shouldSuppress(fname) || shouldSuppress(errMsg)) {
        event.preventDefault();
        // CRA's dev error overlay attaches its own listeners; stop propagation so we don't
        // show a full-screen red error for known-benign Firestore SDK internal assertions.
        // (This does not "fix" the SDK bug, but prevents it from taking down the UI.)
        try { (event as any).stopImmediatePropagation?.(); } catch {}
      }
    } catch {}
  }, true);

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason as { name?: string; message?: string; stack?: string } | undefined;
      if (reason && typeof reason === 'object' && reason.name === 'QuotaExceededError') {
        event.preventDefault();
        try {
          (event as any).stopImmediatePropagation?.();
        } catch {}
        return;
      }
      let text = '';
      if (typeof reason === 'string') text = reason;
      else if (reason?.message) text = String(reason.message);
      else if (reason?.stack) text = String(reason.stack);
      else {
        try {
          text = JSON.stringify(reason);
        } catch {
          text = String(reason);
        }
      }
      if (shouldSuppress(String(text)) || String(text).includes('QuotaExceeded')) {
        event.preventDefault();
        try {
          (event as any).stopImmediatePropagation?.();
        } catch {}
      }
    } catch {}
  }, true);
}

// Google Places dropdown click fallback — see src/utils/pacClickFallback.ts.
installPacClickFallback();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// React 18 StrictMode double-invokes effects in development, which can create
// duplicate Firestore listeners and (in rare cases) trigger SDK internal
// assertion crashes (ca9/b815) in the watch stream. Keep dev stable by
// disabling StrictMode locally.
const appTree = (
  <RootErrorBoundary>
    <HelmetProvider>
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>
    </HelmetProvider>
  </RootErrorBoundary>
);

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
root.render(isDev ? appTree : <React.StrictMode>{appTree}</React.StrictMode>);

reportWebVitals();
