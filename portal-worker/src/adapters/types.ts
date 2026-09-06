import type { Page } from 'playwright';
import type { PortalActionDoc, PortalProvider } from '../../../shared/portalActions.ts';
import type { PortalCredentials } from '../secrets.ts';

export interface AdapterContext {
  page: Page;
  /** Capture the current page; returns a human-openable URL/path when it works. */
  screenshot: (label: string) => Promise<string | undefined>;
}

/**
 * One adapter per portal. Adapters throw PortalActionFailure for anything
 * that should change queue status (LOGIN_FAILED, NOT_IMPLEMENTED, …) and let
 * Playwright errors propagate (the worker classifies them).
 */
export interface PortalAdapter {
  readonly provider: PortalProvider;
  /** Cheap page that proves the session (loaded by keepAlive / smoke_test). */
  readonly homeUrl: string;
  /** True when the current page is a sign-in wall. Must not navigate. */
  isLoginWall(page: Page): Promise<boolean>;
  /** Navigate home and report whether we are signed in. */
  checkSession(ctx: AdapterContext): Promise<boolean>;
  /** Perform the sign-in from the login wall. Throws PortalActionFailure('LOGIN_FAILED') when it can't. */
  login(ctx: AdapterContext, creds: PortalCredentials): Promise<void>;
  /** Light touch that keeps the server session alive (called every keepAliveMs). */
  keepAlive(ctx: AdapterContext): Promise<void>;
  /** Execute a claimed action. The worker has already ensured a logged-in session. */
  execute(ctx: AdapterContext, action: PortalActionDoc): Promise<Record<string, unknown>>;
}
