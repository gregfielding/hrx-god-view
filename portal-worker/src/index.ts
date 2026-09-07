/**
 * HRX portal worker — main loop.
 *
 *   poll  → claim one runnable action → ensure logged-in session for its
 *   provider → run the adapter with a hard timeout → succeeded / errored
 *   per shared policy → repeat.
 *
 * Side loops: heartbeat (worker doc + integration_health), lease sweeper,
 * per-provider keep-alive (keeps portal sessions warm), and a max-uptime
 * exit so launchd restarts the process on a schedule.
 */
import { portalSyncBucket, type PortalActionError, type PortalActionType, type PortalProvider } from '../../shared/portalActions.ts';
import { buildAdapters, type AdapterContext, type PortalAdapter } from './adapters/index.ts';
import { BrowserManager } from './browser.ts';
import { describeConfig, loadConfig, withinSyncHours, type WorkerConfig } from './config.ts';
import { enqueuePortalAction } from './enqueue.ts';
import { classifyError, PortalActionFailure, withTimeout } from './errors.ts';
import { db as getDb, initFirebase, type Firestore } from './firebase.ts';
import { Heartbeat } from './heartbeat.ts';
import { errorMessage, log } from './logger.ts';
import {
  claimNext,
  describeAction,
  markErrored,
  markRunning,
  markSucceeded,
  releaseForShutdown,
  renewLease,
  sweepExpiredLeases,
  type ClaimedAction,
} from './queue.ts';
import { forgetPortalCredentials, getExtensionKey, getPortalCredentials } from './secrets.ts';
import { SlackNotifier } from './slack.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Worker {
  private readonly db: Firestore;
  private readonly adapters: Map<PortalProvider, PortalAdapter>;
  private readonly browser: BrowserManager;
  private readonly heartbeat: Heartbeat;
  private readonly slack: SlackNotifier;
  private stopping = false;
  private current: ClaimedAction | null = null;
  private lastActionFinishedAt = 0;
  private lastKeepAliveAt = new Map<PortalProvider, number>();
  private lastSweepAt = 0;
  private lastScheduledSyncAt = new Map<string, number>();
  private readonly startedAt = Date.now();

  constructor(private readonly config: WorkerConfig) {
    initFirebase(config);
    this.db = getDb();
    this.adapters = buildAdapters(config.enabledProviders);
    this.browser = new BrowserManager(config);
    this.heartbeat = new Heartbeat(this.db, config);
    this.slack = new SlackNotifier(config);
  }

  async run(): Promise<void> {
    log.info('portal worker starting', describeConfig(this.config));
    this.heartbeat.setIdle();
    this.heartbeat.start();
    await this.slack.notify(`:large_green_circle: portal worker \`${this.config.workerId}\` started (${this.config.enabledProviders.join(', ')})`);

    while (!this.stopping) {
      try {
        await this.tick();
      } catch (err) {
        log.error('tick failed', { err });
      }
      if (Date.now() - this.startedAt > this.config.maxUptimeMs) {
        log.info('max uptime reached — exiting for a clean restart');
        break;
      }
      await sleep(this.config.pollMs);
    }
    await this.shutdown();
  }

  private async tick(): Promise<void> {
    if (Date.now() - this.lastSweepAt > this.config.sweepMs) {
      this.lastSweepAt = Date.now();
      await sweepExpiredLeases(this.db, this.config.tenantId, this.config.workerId);
    }

    await this.scheduleSyncsDue();

    const sinceLast = Date.now() - this.lastActionFinishedAt;
    if (sinceLast < this.config.actionMinGapMs) return;

    const claimed = await claimNext(
      this.db,
      this.config.tenantId,
      this.config.workerId,
      this.config.enabledProviders,
      this.config.leaseMs,
    );
    if (claimed) {
      await this.execute(claimed);
      this.lastActionFinishedAt = Date.now();
      return;
    }

    await this.keepAliveDue();
  }

  private async execute(claimed: ClaimedAction): Promise<void> {
    const { id, ref, doc } = claimed;
    this.current = claimed;
    this.heartbeat.setBusy(id, doc.provider, doc.action);
    log.info('claimed action', { id, ...describeAction(doc) });

    const adapter = this.adapters.get(doc.provider);
    if (!adapter) {
      await this.finishWithError(claimed, { code: 'INVALID_PAYLOAD', message: `provider ${doc.provider} not enabled on this worker` });
      return;
    }

    const lease = setInterval(() => {
      renewLease(ref, this.config.workerId, this.config.leaseMs).catch((err) => log.warn('lease renew failed', { err }));
    }, Math.max(15_000, this.config.leaseMs / 3));

    try {
      await markRunning(ref, doc, this.config.workerId);
      const ctx = await this.context(doc.provider);
      await withTimeout(this.ensureSession(adapter, ctx), this.config.actionTimeoutMs, 'session');
      const timeoutMs = doc.action.endsWith('_sync') ? this.config.syncActionTimeoutMs : this.config.actionTimeoutMs;
      const result = await withTimeout(adapter.execute(ctx, doc), timeoutMs, `action ${doc.action}`);
      await markSucceeded(ref, doc, this.config.workerId, result);
      this.heartbeat.bump('succeeded');
      log.info('action succeeded', { id, result });
    } catch (err) {
      if (this.stopping) {
        // We pulled the browser out from under the adapter on purpose —
        // hand the action back untouched instead of counting an attempt.
        await releaseForShutdown(ref, doc, this.config.workerId).catch((e) => log.warn('release failed', { e }));
        this.current = null;
        log.info('action released for shutdown', { id });
        clearInterval(lease);
        this.heartbeat.setIdle();
        return;
      }
      const { code, message } = classifyError(err);
      const details = err instanceof PortalActionFailure ? err.details : undefined;
      const screenshotUrl =
        (details?.screenshot as string | undefined) ?? (await this.browser.screenshot(doc.provider, `${doc.action}-${code}`));
      await this.finishWithError(claimed, { code, message, screenshotUrl });
      // A timed-out adapter promise is still running against the page —
      // tear the context down so it dies instead of fighting the next action.
      if (code === 'BROWSER_CRASH' || code === 'TIMEOUT') await this.browser.reset(doc.provider);
    } finally {
      clearInterval(lease);
      this.current = null;
      this.heartbeat.setIdle();
    }
  }

  private async finishWithError(
    claimed: ClaimedAction,
    err: { code: PortalActionError['code']; message: string; screenshotUrl?: string },
  ): Promise<void> {
    const error: PortalActionError = { ...err, at: new Date().toISOString(), message: errorMessage(err.message) };
    const next = await markErrored(claimed.ref, claimed.doc, this.config.workerId, error);
    log.warn('action errored', { id: claimed.id, code: error.code, next, message: error.message });
    if (next === 'needs_human') {
      this.heartbeat.bump('needsHuman');
      await this.slack.notify(
        `:rotating_light: portal action needs a human — \`${claimed.doc.provider}/${claimed.doc.action}\` (${claimed.id})\n` +
          `${error.code}: ${error.message}` +
          (error.screenshotUrl ? `\nscreenshot: ${error.screenshotUrl}` : ''),
      );
    } else if (next === 'failed') {
      this.heartbeat.bump('failed');
    }
  }

  private async context(provider: PortalProvider): Promise<AdapterContext> {
    const page = await this.browser.page(provider);
    return {
      page,
      config: this.config,
      db: this.db,
      screenshot: (label) => this.browser.screenshot(provider, label),
      extensionKey: () => getExtensionKey(this.config, provider),
      progress: (note) => {
        this.heartbeat.setBusyNote(note);
        log.debug('progress', { provider, note });
      },
    };
  }

  /**
   * Recurring full sync passes (`fieldglass_sync` / `indeed_flex_sync`).
   * The action id carries a 15-minute bucket, so two workers (or a worker
   * restart) within the same window collapse onto one queue row.
   */
  private async scheduleSyncsDue(): Promise<void> {
    const plan: Array<{
      key: string;
      provider: PortalProvider;
      action: PortalActionType;
      everyMs: number;
      window: { start: number; end: number };
      payload: Record<string, unknown>;
      keyParts: string[];
      priority: number;
    }> = [
      {
        key: 'fieldglass_full', provider: 'fieldglass', action: 'fieldglass_sync', everyMs: this.config.fieldglassSyncEveryMs,
        window: this.config.syncHours, payload: { reason: 'scheduled' }, keyParts: ['full', portalSyncBucket(Date.now())], priority: 150,
      },
      {
        key: 'flex_full', provider: 'indeed_flex', action: 'indeed_flex_sync', everyMs: this.config.indeedFlexSyncEveryMs,
        window: this.config.syncHours, payload: { reason: 'scheduled' }, keyParts: ['full', portalSyncBucket(Date.now())], priority: 150,
      },
      // Clock-in watch (2026-09-07): timesheets only, every 10 min, wide hours.
      // Feeds clock-ins/outs into the Timesheet Grid + real check-ins.
      {
        key: 'flex_timesheets', provider: 'indeed_flex', action: 'indeed_flex_sync', everyMs: this.config.indeedFlexTimesheetsEveryMs,
        window: this.config.timesheetWatchHours,
        payload: { includeRosters: false, includeTimesheets: true, timesheetDaysBack: 1, reason: 'clock_in_watch' },
        keyParts: ['timesheets', portalSyncBucket(Date.now(), 10)], priority: 120,
      },
    ];
    for (const item of plan) {
      if (item.everyMs <= 0 || !this.adapters.has(item.provider)) continue;
      const last = this.lastScheduledSyncAt.get(item.key) ?? 0;
      if (Date.now() - last < item.everyMs) continue;
      if (!withinSyncHours(this.config, new Date(), item.window)) continue;
      this.lastScheduledSyncAt.set(item.key, Date.now());
      try {
        const res = await enqueuePortalAction(this.db, {
          tenantId: this.config.tenantId,
          action: item.action,
          payload: item.payload,
          createdBy: { kind: 'system', id: `portal-worker:${this.config.workerId}` },
          keyParts: item.keyParts,
          priority: item.priority, // behind any targeted/manual work
        });
        log.info('scheduled sync', { key: item.key, id: res.id, created: res.created, existingStatus: res.existingStatus ?? null });
      } catch (err) {
        log.warn('scheduled sync enqueue failed', { key: item.key, err });
      }
    }
  }

  /**
   * Make sure the provider session is signed in, logging in from the bot
   * credentials when needed. No credentials → LOGIN_FAILED (needs_human).
   */
  private async ensureSession(adapter: PortalAdapter, ctx: AdapterContext): Promise<void> {
    const provider = adapter.provider;
    const ok = await adapter.checkSession(ctx);
    if (ok) {
      this.heartbeat.setSession(provider, { state: 'logged_in' });
      this.slack.clear(`login:${provider}`);
      return;
    }
    const creds = await getPortalCredentials(this.config, provider);
    if (!creds) {
      this.heartbeat.setSession(provider, { state: 'login_required', note: 'no credentials provisioned' });
      await this.slack.alertOnce(
        `login:${provider}`,
        `:key: ${provider} needs a login and this worker has no bot credentials — sign in on the worker box or provision the secret`,
      );
      throw new PortalActionFailure('LOGIN_FAILED', `${provider} session expired and no bot credentials are provisioned`);
    }
    try {
      await adapter.login(ctx, creds);
      this.heartbeat.setSession(provider, { state: 'logged_in', note: `logged in from ${creds.source}` });
      this.slack.clear(`login:${provider}`);
      await this.slack.notify(`:unlock: ${provider}: bot account signed in on \`${this.config.workerId}\``);
    } catch (err) {
      forgetPortalCredentials(provider);
      this.heartbeat.setSession(provider, { state: 'login_failed', note: errorMessage(err) });
      await this.slack.alertOnce(`login:${provider}`, `:x: ${provider} login failed on \`${this.config.workerId}\`: ${errorMessage(err)}`);
      throw err;
    }
  }

  /** Keep every open portal session warm; only touches contexts that exist. */
  private async keepAliveDue(): Promise<void> {
    for (const [provider, adapter] of this.adapters) {
      const state = this.heartbeat.getSession(provider)?.state;
      if (state !== 'logged_in') continue; // nothing to keep alive until a session exists
      const last = this.lastKeepAliveAt.get(provider) ?? 0;
      if (Date.now() - last < this.config.keepAliveMs) continue;
      this.lastKeepAliveAt.set(provider, Date.now());
      try {
        await adapter.keepAlive(await this.context(provider));
        this.heartbeat.setSession(provider, { state: 'logged_in', note: 'keep-alive ok' });
      } catch (err) {
        const { code } = classifyError(err);
        log.warn('keep-alive failed', { provider, code, message: errorMessage(err) });
        this.heartbeat.setSession(provider, { state: code === 'LOGIN_REQUIRED' ? 'login_required' : 'browser_error', note: errorMessage(err) });
        if (code === 'BROWSER_CRASH') await this.browser.reset(provider);
      }
    }
  }

  async requestStop(signal: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    log.info('stop requested', { signal, inFlight: this.current?.id ?? null });
    // Abort any in-flight browser work immediately: closing the contexts
    // makes the adapter's next page call throw, execute() sees `stopping`
    // and releases the action. Without this a 90-minute sync pass would
    // hold up the restart.
    if (this.current) await this.browser.closeAll();
  }

  private async shutdown(): Promise<void> {
    if (this.current) {
      await releaseForShutdown(this.current.ref, this.current.doc, this.config.workerId).catch((err) =>
        log.warn('release on shutdown failed', { err }),
      );
    }
    await this.browser.closeAll();
    await this.heartbeat.stop();
    await this.slack.notify(`:black_circle: portal worker \`${this.config.workerId}\` stopped`);
    log.info('portal worker stopped');
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const worker = new Worker(config);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => void worker.requestStop(sig));
  }
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { reason }));
  await worker.run();
  process.exit(0);
}

main().catch((err) => {
  log.error('fatal', { err });
  process.exit(1);
});
