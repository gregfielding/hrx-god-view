/**
 * "Get the app" banner for signed-in workers on the web (Greg 2026-09-11:
 * soft-launch the native app to Android web users once Play Production
 * build 14 is live; iOS later once App Review approves).
 *
 * OFF SWITCH (runtime, no deploy): Firestore doc
 *   tenants/BCiP2bQ9CgVOCTfV6MhD/settings/workerAppBanner
 *   { android: { enabled: true, storeUrl?: "https://play.google.com/…" },
 *     ios:     { enabled: true, storeUrl:  "https://apps.apple.com/…" } }
 * Missing doc, missing field, unreadable doc, or anything but `true` = OFF.
 * Tenant settings are readable by workers assigned to the tenant
 * (firestore.rules isAssignedToTenant), so a worker whose user doc has no C1
 * tenant link simply never sees the banner (fail closed).
 *
 * QA preview (any environment, ignores the switch and dismissal):
 *   add ?appBanner=preview to a /c1/workers page; ?appBanner=off clears it.
 *
 * Pure logic lives here so it is unit-testable; the component is
 * src/components/worker/WorkerAppDownloadBanner.tsx.
 */
import { C1_TENANT_ID_CANONICAL } from './c1TenantIdNormalize';

export type AppBannerPlatform = 'android' | 'ios';

export const WORKER_APP_BANNER_SETTINGS_DOC = `tenants/${C1_TENANT_ID_CANONICAL}/settings/workerAppBanner`;

export const ANDROID_PACKAGE_ID = 'com.c1staffing.worker';

/** Play listing with an install referrer so web-driven installs show in Play's acquisition reports. */
export const DEFAULT_PLAY_STORE_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}` +
  `&referrer=${encodeURIComponent('utm_source=hrxone_web&utm_medium=banner&utm_campaign=worker_app_softlaunch')}`;

/** A dismissal hides the banner for 30 days on that browser. */
export const APP_BANNER_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export const APP_BANNER_PREVIEW_PARAM = 'appBanner';
export const APP_BANNER_PREVIEW_SESSION_KEY = 'worker_app_banner_preview';

export interface PlatformBannerConfig {
  enabled: boolean;
  storeUrl: string | null;
}

export interface WorkerAppBannerConfig {
  android: PlatformBannerConfig;
  ios: PlatformBannerConfig;
}

export const WORKER_APP_BANNER_OFF: WorkerAppBannerConfig = {
  android: { enabled: false, storeUrl: DEFAULT_PLAY_STORE_URL },
  ios: { enabled: false, storeUrl: null },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function httpsUrlWithPrefix(value: unknown, prefix: string): string | null {
  return typeof value === 'string' && value.startsWith(prefix) ? value : null;
}

/** Firestore doc data → config. Only a literal `true` turns a platform on. */
export function parseWorkerAppBannerConfig(data: unknown): WorkerAppBannerConfig {
  const root = asRecord(data);
  const android = asRecord(root?.android);
  const ios = asRecord(root?.ios);
  return {
    android: {
      enabled: android?.enabled === true,
      storeUrl: httpsUrlWithPrefix(android?.storeUrl, 'https://play.google.com/') ?? DEFAULT_PLAY_STORE_URL,
    },
    ios: {
      enabled: ios?.enabled === true,
      storeUrl: httpsUrlWithPrefix(ios?.storeUrl, 'https://apps.apple.com/'),
    },
  };
}

/** Phones and tablets only; desktop gets nothing. iPadOS reports "Macintosh" with touch. */
export function detectAppBannerPlatform(userAgent: string, maxTouchPoints = 0): AppBannerPlatform | null {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPod|iPad/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return null;
}

/**
 * Signed-in worker pages only. Never on the public jobs board, a job
 * posting, or anywhere inside an application (apply wizard, prescreen), so
 * the banner cannot interrupt someone mid-apply.
 */
export function isAppBannerPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  if (!path.startsWith('/c1/workers')) return false;
  if (path.startsWith('/c1/workers/prescreen')) return false;
  return true;
}

export function appBannerDismissKey(uid: string): string {
  return `worker_app_banner_dismissed_until_${uid}`;
}

export interface AppBannerDecisionInput {
  platform: AppBannerPlatform | null;
  config: WorkerAppBannerConfig;
  pathname: string;
  dismissedUntil: number;
  now: number;
  installed: boolean;
  preview: boolean;
}

export interface AppBannerDecision {
  platform: AppBannerPlatform;
  storeUrl: string;
}

export function resolveWorkerAppBanner(input: AppBannerDecisionInput): AppBannerDecision | null {
  const { config, pathname, dismissedUntil, now, installed, preview } = input;
  if (!isAppBannerPath(pathname)) return null;

  if (preview) {
    const platform = input.platform ?? 'android';
    const storeUrl = config[platform].storeUrl ?? (platform === 'android' ? DEFAULT_PLAY_STORE_URL : null);
    return storeUrl ? { platform, storeUrl } : null;
  }

  const { platform } = input;
  if (!platform || installed) return null;
  const platformConfig = config[platform];
  if (!platformConfig.enabled || !platformConfig.storeUrl) return null;
  if (dismissedUntil > now) return null;
  return { platform, storeUrl: platformConfig.storeUrl };
}

// ---------------------------------------------------------------------------
// "Ready to work" moment (step 6, 2026-09-11,
// docs/claude/project_events_onboarding_claim_readiness.md): right after a
// worker finishes payroll setup on the web, the payroll pages show a one-time
// fuller prompt ("You're ready to work — get the app") instead of the slim
// bar. Same switch, platform and store URL as the banner; ignores the 30-day
// banner dismissal but never repeats once seen; skipped when the worker
// already has an iOS/Android push token (the app is installed).
// QA: ?appBanner=ready on a payroll page forces it for that page view.
// ---------------------------------------------------------------------------

/** How long after payroll completion the moment is still "right after". */
export const APP_READY_MOMENT_MS = 7 * 24 * 60 * 60 * 1000;

export const APP_READY_PREVIEW_VALUE = 'ready';

export function appReadyMomentKey(uid: string): string {
  return `worker_app_ready_moment_seen_${uid}`;
}

export function isPayrollPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.startsWith('/c1/workers/earnings') || path.startsWith('/c1/workers/payroll');
}

const ENDED_EMPLOYMENT_STATUSES = new Set(['terminated', 'inactive', 'blocked']);

function timestampMs(value: unknown): number | null {
  if (!value) return null;
  const v = value as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (value instanceof Date) return value.getTime();
  const secs = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
  if (secs != null) return secs * 1000;
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return Date.parse(value);
  return null;
}

/** Latest payroll completion across the worker's live `entity_employments` rows, or null. */
export function latestPayrollCompletionMs(rows: ReadonlyArray<Record<string, unknown>>): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    if (ENDED_EMPLOYMENT_STATUSES.has(String(row.status ?? '').trim().toLowerCase())) continue;
    const ms = timestampMs(row.payrollOnboardingCompletedAt) ?? timestampMs(row.onboardingCompletedAt);
    if (ms != null && (latest == null || ms > latest)) latest = ms;
  }
  return latest;
}

export interface AppReadyMomentInput {
  /** `resolveWorkerAppBanner` with the banner dismissal ignored (dismissedUntil 0). */
  banner: AppBannerDecision | null;
  pathname: string;
  completedAtMs: number | null;
  now: number;
  seen: boolean;
  hasAppPushToken: boolean;
}

export function isAppReadyMoment(input: AppReadyMomentInput): boolean {
  const { banner, pathname, completedAtMs, now, seen, hasAppPushToken } = input;
  if (!banner || !isPayrollPath(pathname) || seen || hasAppPushToken || completedAtMs == null) return false;
  const age = now - completedAtMs;
  return age >= 0 && age <= APP_READY_MOMENT_MS;
}
