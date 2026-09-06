import type { PortalActionErrorCode } from '../../shared/portalActions.ts';

/**
 * Throw this from adapters to control retry/escalation precisely.
 * Anything else that escapes an adapter is classified by `classifyError`.
 */
export class PortalActionFailure extends Error {
  readonly code: PortalActionErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PortalActionErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PortalActionFailure';
    this.code = code;
    this.details = details;
  }
}

export function classifyError(err: unknown): { code: PortalActionErrorCode; message: string } {
  if (err instanceof PortalActionFailure) return { code: err.code, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || /Timeout \d+ms exceeded|timed out/i.test(message)) {
    return { code: 'TIMEOUT', message };
  }
  if (/Target (page|context|browser).*closed|browser has been closed|Target closed|has been closed/i.test(message)) {
    return { code: 'BROWSER_CRASH', message };
  }
  if (/waiting for (locator|selector)|strict mode violation|element\(s\) not found/i.test(message)) {
    return { code: 'SELECTOR_MISSING', message };
  }
  return { code: 'UNKNOWN', message };
}

/** Wrap a promise with a hard timeout that rejects as TIMEOUT. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PortalActionFailure('TIMEOUT', `${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
