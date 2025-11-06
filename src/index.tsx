import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';

import './index.css';
import './setupConsoleFilters';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ThemeModeProvider } from './theme/theme';

// Development-only console noise suppression (runs before components mount)
if (process.env.NODE_ENV === 'development') {
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
    ];
    const isTerminateNoise = args.some((a) => argContains(a, needles)) ||
      argContains(args?.map?.(String)?.join(' '), needles);

    if (isTerminateNoise) return;
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
  const shouldSuppress = (text?: string) => {
    if (!text) return false;
    return (
      text.includes('TYPE=terminate') ||
      text.includes('https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel') ||
      (text.includes('google.firestore.v1.Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('POST https://firestore.googleapis.com') && text.includes('TYPE=terminate'))
    );
  };

  window.addEventListener('error', (event) => {
    try {
      const msg = String(event.message || '');
      const fname = (event as any).filename ? String((event as any).filename) : '';
      const errMsg = (event as any).error?.message ? String((event as any).error?.message) : '';
      if (shouldSuppress(msg) || shouldSuppress(fname) || shouldSuppress(errMsg)) {
        event.preventDefault();
      }
    } catch {}
  }, true);

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      let text = '';
      if (typeof reason === 'string') text = reason;
      else if (reason?.message) text = String(reason.message);
      else if (reason?.stack) text = String(reason.stack);
      else {
        try { text = JSON.stringify(reason); } catch { text = String(reason); }
      }
      if (shouldSuppress(String(text))) {
        event.preventDefault();
      }
    } catch {}
  }, true);
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>
    </HelmetProvider>
  </React.StrictMode>
);

reportWebVitals();
