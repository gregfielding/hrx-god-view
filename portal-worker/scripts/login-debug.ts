/**
 * Drive one provider's login interactively with a screenshot after every
 * step, using the same persistent profile and credentials the worker uses.
 *   npm run login -- --provider=indeed_flex [--headed]
 * Stop the launchd worker first if it is running (profile lock):
 *   launchctl kill SIGTERM gui/$(id -u)/com.c1staffing.portal-worker
 * Screenshots land in .data/screenshots/<provider>/login-debug-*.png.
 * Credentials are never printed.
 */
import type { PortalProvider } from '../../shared/portalActions.ts';
import { buildAdapters } from '../src/adapters/index.ts';
import { BrowserManager } from '../src/browser.ts';
import { loadConfig } from '../src/config.ts';
import { db as getDb, initFirebase } from '../src/firebase.ts';
import { log } from '../src/logger.ts';
import { getExtensionKey, getPortalCredentials } from '../src/secrets.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const provider = (arg('provider') || 'indeed_flex') as PortalProvider;
  const config = loadConfig();
  if (process.argv.includes('--headed')) config.headless = false;
  config.profileDir = `${config.profileDir}-debug`; // never fight the running worker for its profile
  initFirebase(config);
  const browser = new BrowserManager(config);
  const adapter = buildAdapters([provider]).get(provider)!;
  const page = await browser.page(provider);
  const shot = (label: string) => browser.screenshot(provider, `login-debug-${label}`);
  const ctx = {
    page,
    config,
    db: getDb(),
    screenshot: shot,
    extensionKey: () => getExtensionKey(config, provider),
    progress: (note: string) => log.info('progress', { note }),
  };

  const loggedIn = await adapter.checkSession(ctx);
  log.info('session check', { provider, loggedIn, url: page.url() });
  await shot('00-after-session-check');
  if (loggedIn) {
    log.info('already logged in — nothing to do');
    await browser.closeAll();
    return;
  }

  const creds = await getPortalCredentials(config, provider);
  if (!creds) throw new Error('no credentials available');

  // Step through the login manually so each screen is captured.
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log.info('navigated', { url: f.url() });
  });
  try {
    await adapter.login(ctx, creds);
    log.info('login OK', { url: page.url() });
    await shot('99-logged-in');
  } catch (err) {
    log.error('login failed', { err: (err as Error).message, url: page.url() });
    await shot('98-failed');
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
    log.info('page text at failure', { text });
  }
  await browser.closeAll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
