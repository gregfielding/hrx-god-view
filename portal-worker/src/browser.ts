/**
 * One persistent Chromium profile per provider so cookies survive restarts
 * and logins are rare. Headed by default (a real window on the worker box
 * is the least bot-like footprint and lets a person rescue a login);
 * PORTAL_HEADLESS=1 for servers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { PortalProvider } from '../../shared/portalActions.ts';
import type { WorkerConfig } from './config.ts';
import { bucket } from './firebase.ts';
import { log } from './logger.ts';

const VIEWPORT = { width: 1440, height: 900 };

export class BrowserManager {
  private contexts = new Map<PortalProvider, BrowserContext>();

  constructor(private readonly config: WorkerConfig) {}

  private async launch(provider: PortalProvider): Promise<BrowserContext> {
    const userDataDir = path.join(this.config.profileDir, provider);
    await fs.mkdir(userDataDir, { recursive: true });
    log.info('launching browser context', { provider, userDataDir, headless: this.config.headless });
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: this.config.headless,
      viewport: VIEWPORT,
      locale: 'en-US',
      timezoneId: 'America/Chicago',
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    ctx.setDefaultTimeout(30_000);
    ctx.setDefaultNavigationTimeout(45_000);
    ctx.on('close', () => {
      log.warn('browser context closed', { provider });
      if (this.contexts.get(provider) === ctx) this.contexts.delete(provider);
    });
    this.contexts.set(provider, ctx);
    return ctx;
  }

  /** A live page for the provider; relaunches the context if it died. */
  async page(provider: PortalProvider): Promise<Page> {
    let ctx = this.contexts.get(provider);
    if (!ctx || ctx.pages().length === 0) {
      if (ctx) {
        await ctx.close().catch(() => undefined);
      }
      ctx = await this.launch(provider);
    }
    const pages = ctx.pages().filter((p) => !p.isClosed());
    return pages[0] ?? (await ctx.newPage());
  }

  /** Force a fresh context (after a crash or a corrupted session). */
  async reset(provider: PortalProvider): Promise<void> {
    const ctx = this.contexts.get(provider);
    this.contexts.delete(provider);
    if (ctx) await ctx.close().catch(() => undefined);
  }

  /**
   * Capture the current page to disk and (when a bucket is configured) to
   * Storage under portal-worker/{tenant}/{label}. Returns a URL a human can
   * open — signed for 7 days — or the local path as a fallback. Never throws.
   */
  async screenshot(provider: PortalProvider, label: string): Promise<string | undefined> {
    try {
      const ctx = this.contexts.get(provider);
      const page = ctx?.pages().find((p) => !p.isClosed());
      if (!page) return undefined;
      const safe = label.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 120);
      const file = `${new Date().toISOString().replace(/[:.]/g, '-')}__${safe}.png`;
      const localDir = path.join(this.config.screenshotDir, provider);
      await fs.mkdir(localDir, { recursive: true });
      const localPath = path.join(localDir, file);
      await page.screenshot({ path: localPath, fullPage: false });

      if (!this.config.storageBucket) return localPath;
      const dest = `portal-worker/${this.config.tenantId}/${provider}/${file}`;
      await bucket().upload(localPath, { destination: dest, contentType: 'image/png' });
      const [url] = await bucket()
        .file(dest)
        .getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      return url;
    } catch (err) {
      log.warn('screenshot failed', { provider, label, err });
      return undefined;
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.contexts.entries()];
    this.contexts.clear();
    await Promise.all(entries.map(([, ctx]) => ctx.close().catch(() => undefined)));
  }
}
