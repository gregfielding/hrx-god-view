import { getFunctions, httpsCallable } from 'firebase/functions';

// Simple in-memory rate limiter per tab/session
const lastSentByKey: Record<string, number> = {};

export type ClientLogPayload = Record<string, any>;

export async function logAIActionClient(payload: ClientLogPayload): Promise<{ skipped?: boolean; reason?: string } | void> {
  try {
    const now = Date.now();
    const key = payload.eventType || payload.action || 'generic';

    // Skip very low urgency
    if (typeof payload.urgencyScore === 'number' && payload.urgencyScore < 6) return { skipped: true, reason: 'low_urgency_client' };

    // 3s debounce per event key
    if (lastSentByKey[key] && (now - lastSentByKey[key]) < 3000) return { skipped: true, reason: 'debounced' };

    // 10% client-side sampling (server also samples)
    const isCritical = typeof payload.urgencyScore === 'number' && payload.urgencyScore >= 9;
    if (!isCritical && Math.random() > 0.1) return { skipped: true, reason: 'sampled_client' };

    const functions = getFunctions();
    const callable = httpsCallable(functions, 'logAIActionCallable');
    await callable(payload);
    lastSentByKey[key] = now;
  } catch (error) {
    // Non-fatal: swallow errors to avoid UX impact
    // eslint-disable-next-line no-console
    console.warn('logAIActionClient skipped due to error', error);
  }
}


