import { updateDoc } from 'firebase/firestore';
import { useCallback, useRef } from 'react';

export function useDebouncedDocUpdate(delayMs = 500) {
  const timerRef = useRef<any>(null);

  const debouncedUpdate = useCallback(async (ref: any, data: Record<string, any>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return new Promise<void>((resolve) => {
      timerRef.current = setTimeout(async () => {
        try { await updateDoc(ref, data); } finally { resolve(); }
      }, delayMs);
    });
  }, [delayMs]);

  return debouncedUpdate;
}


