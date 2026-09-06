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
import type { PortalActionError, PortalProvider } from '../../shared/portalActions.ts';
import { buildAdapters, type AdapterContext, type PortalAdapter } from './adapters/index.ts';
import { BrowserManager } from './browser.ts';
import { describeConfig, loadConfig, type WorkerConfig } from './config.ts';
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
import { forgetPortalCredentials, getPortalCredentials } from './secrets.ts';
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
    this.heartbeat.start();
    this.heartbeat.setIdle();
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
      const result = await withTimeout(adapter.execute(ctx, doc), this.config.actionTimeoutMs, `action ${doc.action}`);
      await markSucceeded(ref, doc, this.config.workerId, result);
      this.heartbeat.bump('succeeded');
      log.info('action succeeded', { id, result });
    } catch (err) {
      const { code, message } = classifyError(err);
      const details = err instanceof PortalActionFailure ? err.details : undefined;
      const screenshotUrl =
        (details?.screenshot as string | undefined) ?? (await this.browser.screenshot(doc.provider, `${doc.action}-${code}`));
      await this.finishWithError(claimed, { code, message, screenshotUrl });
      if (code === 'BROWSER_CRASH') await this.browser.reset(doc.provider);
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
    return { page, screenshot: (label) => this.browser.screenshot(provider, label) };
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
