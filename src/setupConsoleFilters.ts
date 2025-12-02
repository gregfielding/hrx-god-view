// Runs before App mounts to suppress benign dev-only console noise
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

  const isTerminateNoise = (...args: any[]) => {
    const needles = [
      'TYPE=terminate',
      'webchannel_blob_es2018.js',
      'google.firestore.v1.Firestore/Write/channel',
      'Firestore/Write/channel',
      'POST https://firestore.googleapis.com',
      // CSP report-only iframe noise (e.g., Google widgets)
      'Content Security Policy directive: "frame-ancestors',
      'Refused to frame',
      "frame-ancestors 'self'",
      'Report Only',
      // Firebase permission errors that are handled gracefully
      'Missing or insufficient permissions',
      'permission-denied',
      'Error fetching interviews count',
      'Error fetching notes count'
    ];
    return args.some((a) => argContains(a, needles)) || argContains(args?.map?.(String)?.join(' '), needles);
  };

  console.error = (...args: any[]) => {
    if (isTerminateNoise(...args)) return;
    originalError.apply(console, args as unknown as any);
  };

  console.warn = (...args: any[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && (
      msg.includes('google.maps.places.Autocomplete is not available') ||
      msg.includes('Performance warning! LoadScript has been reloaded') ||
      msg.includes('Google Maps already loaded outside') ||
      msg.includes('Content Security Policy directive: "frame-ancestors') ||
      msg.includes('Refused to frame') ||
      msg.includes("frame-ancestors 'self'") ||
      msg.includes('Report Only')
    )) {
      return;
    }
    originalWarn.apply(console, args as unknown as any);
  };

  const shouldSuppress = (text?: string) => {
    if (!text) return false;
    return (
      text.includes('TYPE=terminate') ||
      text.includes('https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel') ||
      (text.includes('google.firestore.v1.Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('Firestore/Write/channel') && text.includes('TYPE=terminate')) ||
      (text.includes('POST https://firestore.googleapis.com') && text.includes('TYPE=terminate')) ||
      text.includes('Content Security Policy directive: "frame-ancestors') ||
      text.includes('Refused to frame') ||
      text.includes("frame-ancestors 'self'") ||
      text.includes('Report Only')
    );
  };

  window.addEventListener('error', (event) => {
    try {
      const msg = String((event as any).message || '');
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

export {};


