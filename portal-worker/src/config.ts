import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTAL_PROVIDERS, type PortalProvider } from '../../shared/portalActions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = path.resolve(here, '..');
export const WORKER_VERSION = '0.1.0';

export interface WorkerConfig {
  projectId: string;
  tenantId: string;
  workerId: string;
  enabledProviders: PortalProvider[];
  headless: boolean;
  /** Persistent Chromium profiles live here, one subdir per provider. */
  profileDir: string;
  /** Local failure screenshots (also uploaded to Storage when configured). */
  screenshotDir: string;
  storageBucket: string | null;
  pollMs: number;
  heartbeatMs: number;
  sweepMs: number;
  keepAliveMs: number;
  leaseMs: number;
  /** Minimum gap between two portal actions (human pacing). */
  actionMinGapMs: number;
  /** Per-action hard timeout for the browser work. */
  actionTimeoutMs: number;
  /** Timeout for the long-running *_sync passes (dozens of pages, each with a server-side extraction). */
  syncActionTimeoutMs: number;
  slack: { botToken: string | null; channelId: string | null };
  /** Secret Manager names are `${secretPrefix}-${provider}-username|password`. */
  secretPrefix: string;
  /** Milliseconds a single worker will run before exiting for a clean restart (launchd relaunches). */
  maxUptimeMs: number;
  /** HRX Cloud Functions origin for the courier endpoints (enrichment queue/ingest, Flex ingest). */
  hrxBaseUrl: string;
  /**
   * Recurring full sync passes, one per provider. 0 disables. The worker
   * enqueues a `<provider>_sync` action on this cadence (deduped by time
   * bucket, so several workers share one run) inside `syncHours`.
   */
  fieldglassSyncEveryMs: number;
  indeedFlexSyncEveryMs: number;
  /** Local-hour window [start, end) in `syncTimezone` when scheduled syncs may be enqueued. */
  syncHours: { start: number; end: number };
  syncTimezone: string;
}

function hoursWindow(raw: string | undefined, fallback: { start: number; end: number }) {
  if (!raw) return fallback;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) throw new Error(`PORTAL_SYNC_HOURS must look like "6-20", got ${JSON.stringify(raw)}`);
  return { start: Number(m[1]), end: Number(m[2]) };
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${JSON.stringify(raw)}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig(): WorkerConfig {
  const tenantId = process.env.HRX_TENANT_ID;
  if (!tenantId) throw new Error('HRX_TENANT_ID is required');

  const providersRaw = (process.env.PORTAL_PROVIDERS || PORTAL_PROVIDERS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const enabledProviders = providersRaw.filter((p): p is PortalProvider =>
    (PORTAL_PROVIDERS as readonly string[]).includes(p),
  );
  const unknown = providersRaw.filter((p) => !(PORTAL_PROVIDERS as readonly string[]).includes(p));
  if (unknown.length) throw new Error(`PORTAL_PROVIDERS has unknown providers: ${unknown.join(', ')}`);
  if (!enabledProviders.length) throw new Error('PORTAL_PROVIDERS resolved to an empty list');

  const dataDir = process.env.PORTAL_WORKER_DATA_DIR || path.join(WORKER_ROOT, '.data');

  return {
    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'hrx1-d3beb',
    tenantId,
    workerId: process.env.PORTAL_WORKER_ID || `${os.hostname().split('.')[0]}-${process.pid}`,
    enabledProviders,
    headless: bool('PORTAL_HEADLESS', false),
    profileDir: process.env.PORTAL_PROFILE_DIR || path.join(dataDir, 'profiles'),
    screenshotDir: process.env.PORTAL_SCREENSHOT_DIR || path.join(dataDir, 'screenshots'),
    storageBucket: process.env.PORTAL_STORAGE_BUCKET || null,
    pollMs: int('PORTAL_POLL_MS', 5_000),
    heartbeatMs: int('PORTAL_HEARTBEAT_MS', 30_000),
    sweepMs: int('PORTAL_SWEEP_MS', 60_000),
    keepAliveMs: int('PORTAL_KEEPALIVE_MS', 5 * 60_000),
    leaseMs: int('PORTAL_LEASE_MS', 10 * 60_000),
    actionMinGapMs: int('PORTAL_ACTION_MIN_GAP_MS', 3_000),
    actionTimeoutMs: int('PORTAL_ACTION_TIMEOUT_MS', 4 * 60_000),
    syncActionTimeoutMs: int('PORTAL_SYNC_ACTION_TIMEOUT_MS', 4 * 60 * 60_000),
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN || null,
      channelId: process.env.SLACK_ALERT_CHANNEL_ID || null,
    },
    secretPrefix: process.env.PORTAL_SECRET_PREFIX || 'portal-worker',
    maxUptimeMs: int('PORTAL_MAX_UPTIME_MS', 12 * 60 * 60_000),
    hrxBaseUrl: (process.env.HRX_BASE_URL || 'https://us-central1-hrx1-d3beb.cloudfunctions.net').replace(/\/+$/, ''),
    fieldglassSyncEveryMs: int('PORTAL_FG_SYNC_EVERY_MS', 60 * 60_000),
    indeedFlexSyncEveryMs: int('PORTAL_FLEX_SYNC_EVERY_MS', 60 * 60_000),
    syncHours: hoursWindow(process.env.PORTAL_SYNC_HOURS, { start: 6, end: 21 }),
    syncTimezone: process.env.PORTAL_SYNC_TZ || 'America/Chicago',
  };
}

/** Is `now` inside the scheduled-sync window (local hours in syncTimezone)? */
export function withinSyncHours(c: WorkerConfig, now = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: c.syncTimezone }).format(now),
  );
  const h = hour === 24 ? 0 : hour;
  return h >= c.syncHours.start && h < c.syncHours.end;
}

/** Safe-to-log view (no tokens). */
export function describeConfig(c: WorkerConfig): Record<string, unknown> {
  return {
    projectId: c.projectId,
    tenantId: c.tenantId,
    workerId: c.workerId,
    enabledProviders: c.enabledProviders,
    headless: c.headless,
    profileDir: c.profileDir,
    storageBucket: c.storageBucket,
    pollMs: c.pollMs,
    leaseMs: c.leaseMs,
    keepAliveMs: c.keepAliveMs,
    slackConfigured: Boolean(c.slack.botToken && c.slack.channelId),
    hrxBaseUrl: c.hrxBaseUrl,
    fieldglassSyncEveryMs: c.fieldglassSyncEveryMs,
    indeedFlexSyncEveryMs: c.indeedFlexSyncEveryMs,
    syncHours: `${c.syncHours.start}-${c.syncHours.end} ${c.syncTimezone}`,
  };
}
