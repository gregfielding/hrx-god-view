/**
 * SAP Fieldglass supplier portal (www.us.fieldglass.cloud.sap).
 *
 * Verified 2026-09-06: the sign-in page is a plain form —
 * `input[name=username]` + `input[name=password]` + "Sign In"; no CAPTCHA,
 * no bot-protection scripts. Supplier home is `/desktop.do` (the bare
 * origin renders the sign-in form even with a live session). Session
 * cookies do not survive a browser restart — the worker just logs in again.
 *
 * `fieldglass_sync` = the "Sync Sodexo" pass ported from
 * browser-extensions/fieldglass-sync (HRX pending queue + worklist scan →
 * open each detail page, ship innerText to fieldglassEnrichmentIngest).
 * Adds change detection (SyncState) so unchanged pages skip the paid
 * extraction, and worklist pagination.
 *
 * Candidate submission is NOT implemented yet (needs one recorded walkthrough).
 */
import type { Page } from 'playwright';
import type { FieldglassSyncPayload, PortalActionDoc, SmokeTestPayload } from '../../../shared/portalActions.ts';
import { isBrowserGone, PortalActionFailure } from '../errors.ts';
import { fetchFieldglassQueue, ingestFieldglassPage, HrxApiError } from '../hrxApi.ts';
import { log } from '../logger.ts';
import type { PortalCredentials } from '../secrets.ts';
import { hashPageText, SyncState } from '../syncState.ts';
import type { AdapterContext, PortalAdapter } from './types.ts';

const ORIGIN = 'https://www.us.fieldglass.cloud.sap';
const WORKLIST_URL = `${ORIGIN}/job_posting_list.do?cl=1`;
const DETAIL_PATH = 'job_posting_detail.do';
const POSTING_ID_RE = /SDXOJP\d{6,}/;
const ITEM_PACING_MS = 1_500;
const ITEM_TIMEOUT_MS = 75_000;
/** Re-ingest an unchanged page at least this often so status can't go stale. */
const UNCHANGED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface SyncItem {
  url: string;
  postingId: string | null;
  label: string;
  source: 'targeted' | 'hrx_queue' | 'worklist';
}

interface WorklistLink {
  url: string;
  text: string;
  postingId: string | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Absolute detail URL with the fragment stripped and every query param kept.
 * ☠️ Do NOT drop params: worklist links carry `eType=sql&startFlow=true`
 * (and base64 ids with '+'); without them the detail page renders no
 * posting (2026-09-07, 94/94 failed). Dedupe with `detailKey`, not here.
 */
export function canonicalDetailUrl(url: string): string {
  try {
    const u = new URL(url, ORIGIN);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Dedupe key for a detail link: the raw `id` query value when present, else the URL. */
export function detailKey(url: string): string {
  const m = /[?&]id=([^&#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : canonicalDetailUrl(url);
}

export class FieldglassAdapter implements PortalAdapter {
  readonly provider = 'fieldglass' as const;
  /** `/desktop.do` is the supplier home; the bare origin renders the sign-in form even with a live session (verified 2026-09-06). */
  readonly homeUrl = `${ORIGIN}/desktop.do`;

  async isLoginWall(page: Page): Promise<boolean> {
    const user = page.locator('input[name="username"]');
    const pass = page.locator('input[name="password"]');
    if ((await user.count()) > 0 && (await pass.count()) > 0) return true;
    const title = await page.title().catch(() => '');
    return /sign in/i.test(title);
  }

  async checkSession(ctx: AdapterContext): Promise<boolean> {
    await ctx.page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2_000);
    return !(await this.isLoginWall(ctx.page));
  }

  async login(ctx: AdapterContext, creds: PortalCredentials): Promise<void> {
    const { page } = ctx;
    if (!(await this.isLoginWall(page))) {
      await page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
    }
    // Submit and wait for a DEFINITE outcome (home / error / form again).
    // A fixed 3s wait misread a slow post-login redirect as a rejection
    // (2026-09-07: blank form, no error text); an empty form with no error
    // gets one retry before we escalate.
    let outcome: 'home' | 'error' | 'wall' = 'wall';
    let errorText = '';
    for (let attempt = 0; attempt < 2 && outcome === 'wall'; attempt += 1) {
      const user = page.locator('input[name="username"]');
      await user.waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(attempt === 0 ? 500 : 2_000);
      await user.fill(creds.username);
      await page.locator('input[name="password"]').fill(creds.password);
      const submit = page.getByRole('button', { name: /sign in/i });
      if ((await submit.count()) > 0) await submit.first().click();
      else await page.locator('input[name="password"]').press('Enter');
      const r = await this.awaitLoginOutcome(page, 25_000);
      outcome = r.outcome;
      errorText = r.errorText;
      if (outcome === 'wall') log.warn('fieldglass sign-in form reappeared without an error — retrying once', { attempt });
    }
    if (outcome === 'error') {
      const shot = await ctx.screenshot('fieldglass-login-rejected');
      throw new PortalActionFailure('LOGIN_FAILED', `Fieldglass rejected the bot credentials: ${errorText.slice(0, 160)}`, { screenshot: shot });
    }
    if (outcome === 'wall') {
      const shot = await ctx.screenshot('fieldglass-login-wall-again');
      throw new PortalActionFailure('LOGIN_FAILED', 'Fieldglass sign-in form reappeared twice without an error (slow redirect or session conflict)', {
        screenshot: shot,
      });
    }
    // Positive proof first: the supplier home banner ("Hi, Natalie / Welcome to
    // SAP Fieldglass.") or the left nav. Verified 2026-09-06.
    const homeOk =
      (await page.getByText(/Welcome to SAP Fieldglass/i).count()) > 0 ||
      (await page.getByRole('link', { name: /^My Items$/i }).count()) > 0;
    if (homeOk) {
      log.info('fieldglass login ok');
      return;
    }
    // First-login interstitials (terms of use, forced password change) need a
    // person. Look at HEADINGS only — the footer says "Terms of Use" and the
    // cookie banner says "Accept" on every page, which is not an interstitial.
    const headings = (await page.locator('h1, h2, h3').allInnerTexts().catch(() => [] as string[])).join(' | ');
    if (/terms of use|password/i.test(headings)) {
      const shot = await ctx.screenshot('fieldglass-login-interstitial');
      throw new PortalActionFailure('LOGIN_FAILED', `Fieldglass shows a post-login interstitial: ${headings.slice(0, 120)}`, {
        screenshot: shot,
      });
    }
    log.info('fieldglass login ok (no banner detected, not a login wall)', { url: page.url(), headings: headings.slice(0, 120) });
  }

  /** Poll until the sign-in resolves: the supplier home, an error banner, or the bare form again. */
  private async awaitLoginOutcome(page: Page, timeoutMs: number): Promise<{ outcome: 'home' | 'error' | 'wall'; errorText: string }> {
    const deadline = Date.now() + timeoutMs;
    let sawFormAgain = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const url = page.url();
      const wall = await this.isLoginWall(page).catch(() => false);
      if (!wall && (url.includes('desktop.do') || (await page.getByText(/Welcome to SAP Fieldglass/i).count().catch(() => 0)) > 0)) {
        return { outcome: 'home', errorText: '' };
      }
      if (!wall && !url.includes('fieldglass.cloud.sap/?') && Date.now() > deadline - timeoutMs / 2) {
        // Somewhere inside the app that is not home (e.g. an interstitial) — let the caller inspect.
        return { outcome: 'home', errorText: '' };
      }
      if (wall) {
        const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000);
        const m = /(username or password is incorrect[^\n]*|account (?:is|has been) (?:locked|disabled)[^\n]*|too many[^\n]*attempts[^\n]*)/i.exec(text);
        if (m) return { outcome: 'error', errorText: m[1] };
        const username = await page.locator('input[name="username"]').inputValue().catch(() => '');
        // Our filled value is gone → the page reloaded the form (post-submit) with no error.
        if (username === '') sawFormAgain += 1;
        if (sawFormAgain >= 6) return { outcome: 'wall', errorText: '' };
      }
    }
    return { outcome: 'wall', errorText: '' };
  }

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await ctx.page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1_500);
    if (await this.isLoginWall(ctx.page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'Fieldglass session expired');
  }

  async execute(ctx: AdapterContext, action: PortalActionDoc): Promise<Record<string, unknown>> {
    switch (action.action) {
      case 'smoke_test':
        return this.smokeTest(ctx, action.payload as SmokeTestPayload);
      case 'fieldglass_sync':
        return this.sync(ctx, (action.payload ?? {}) as FieldglassSyncPayload);
      case 'submit_candidate':
      case 'withdraw_candidate':
        throw new PortalActionFailure(
          'NOT_IMPLEMENTED',
          `${action.action} is not implemented for Fieldglass yet (needs the recorded submit flow)`,
        );
      default:
        throw new PortalActionFailure('INVALID_PAYLOAD', `action ${action.action} does not belong to Fieldglass`);
    }
  }

  private async smokeTest(ctx: AdapterContext, payload: SmokeTestPayload): Promise<Record<string, unknown>> {
    const url = payload?.url || this.homeUrl;
    await ctx.page.goto(url, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2_000);
    if (await this.isLoginWall(ctx.page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'landed on the sign-in wall');
    return { url: ctx.page.url(), title: await ctx.page.title(), checkedAt: new Date().toISOString() };
  }

  // --- fieldglass_sync ------------------------------------------------------

  private async sync(ctx: AdapterContext, payload: FieldglassSyncPayload): Promise<Record<string, unknown>> {
    const key = await ctx.extensionKey();
    if (!key) {
      throw new PortalActionFailure('LOGIN_FAILED', 'FIELDGLASS_EXTENSION_KEY is not provisioned on this worker (env or Secret Manager)');
    }
    const targeted = (payload.postingIds ?? []).filter((id) => POSTING_ID_RE.test(id));
    const isTargeted = targeted.length > 0;
    const includeHrxQueue = payload.includeHrxQueue ?? !isTargeted;
    const scanWorklist = payload.scanWorklist ?? !isTargeted;
    const maxPostings = Math.max(1, Math.min(payload.maxPostings ?? 120, 400));
    const startedAt = Date.now();

    // 1. Build the item list: targeted → HRX pending queue → worklist scan.
    // Fieldglass detail links carry an INTERNAL `id`, not the SDXOJP number,
    // so a posting id must be resolved to a real link: HRX's request row
    // (email deep link / last sync URL), else the worklist row that shows
    // the number, else the portal's search box.
    const items = new Map<string, SyncItem>(); // keyed by the link's id param
    const knownIds = new Set<string>();
    const add = (item: SyncItem) => {
      const k = detailKey(item.url);
      if (item.postingId && knownIds.has(item.postingId) && item.source !== 'targeted') return;
      if (!items.has(k)) {
        items.set(k, { ...item, url: canonicalDetailUrl(item.url) });
        if (item.postingId) knownIds.add(item.postingId);
      }
    };
    const unresolved: string[] = [];
    for (const id of targeted) {
      const url = await this.detailUrlFromHrx(ctx, id);
      if (url) add({ url, postingId: id, label: id, source: 'targeted' });
      else unresolved.push(id);
    }
    let hrxQueueCount = 0;
    if (includeHrxQueue) {
      ctx.progress('fetching HRX pending queue');
      try {
        const pending = await fetchFieldglassQueue(ctx.config, key);
        hrxQueueCount = pending.length;
        for (const p of pending) {
          if (p.detailUrl) add({ url: p.detailUrl, postingId: p.postingId, label: p.title || p.postingId, source: 'hrx_queue' });
          else if (!knownIds.has(p.postingId)) unresolved.push(p.postingId);
        }
      } catch (err) {
        if (err instanceof PortalActionFailure) throw err;
        log.warn('HRX queue fetch failed (continuing with worklist)', { err });
      }
    }
    let worklistLinks: WorklistLink[] = [];
    let worklistPages = 0;
    if (scanWorklist || unresolved.length > 0) {
      ctx.progress('scanning worklist');
      const scanned = await this.collectWorklistLinks(ctx);
      worklistLinks = scanned.links;
      worklistPages = scanned.pages;
      for (const link of worklistLinks) {
        const id = link.postingId;
        const wanted = id ? unresolved.indexOf(id) : -1;
        if (wanted >= 0) {
          unresolved.splice(wanted, 1);
          add({ url: link.url, postingId: id, label: id!, source: 'targeted' });
        } else if (scanWorklist) {
          add({ url: link.url, postingId: id, label: id ?? link.url.slice(-24), source: 'worklist' });
        }
      }
    }
    for (const id of [...unresolved]) {
      ctx.progress(`searching portal for ${id}`);
      const url = await this.detailUrlFromSearch(ctx, id);
      if (url) {
        unresolved.splice(unresolved.indexOf(id), 1);
        add({ url, postingId: id, label: id, source: 'targeted' });
      }
    }
    const list = [...items.values()].slice(0, maxPostings);
    if (list.length === 0) {
      return {
        total: 0,
        ok: 0,
        failed: unresolved.length,
        skippedUnchanged: 0,
        hrxQueueCount,
        worklistLinks: worklistLinks.length,
        worklistPages,
        unresolved,
        note: scanWorklist ? 'worklist returned no postings' : 'nothing to sync',
        durationMs: Date.now() - startedAt,
      };
    }

    // 2. Visit each posting; ingest when new/changed/stale/forced.
    const state = new SyncState(ctx.db, ctx.config.tenantId, 'fieldglass_sync');
    await state.load();
    const summary = {
      total: list.length,
      ok: 0,
      failed: 0,
      skippedUnchanged: 0,
      created: 0,
      candidateInMind: 0,
      closed: 0,
      halted: 0,
      hrxQueueCount,
      worklistLinks: worklistLinks.length,
      worklistPages,
      unresolved,
      truncated: items.size > list.length,
      items: [] as Array<Record<string, unknown>>,
    };
    summary.failed += unresolved.length;
    let consecutiveLoginWalls = 0;

    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      ctx.progress(`${i + 1}/${list.length} ${item.label}`);
      const entry: Record<string, unknown> = { postingId: item.postingId, source: item.source };
      try {
        const text = await this.withItemTimeout(this.captureDetailPage(ctx.page, item.url), item.label);
        consecutiveLoginWalls = 0;
        const pageId = POSTING_ID_RE.exec(text)?.[0] ?? item.postingId ?? item.url;
        const hash = hashPageText(text);
        const decision = state.shouldIngest(pageId, hash, { force: payload.force, maxAgeMs: UNCHANGED_MAX_AGE_MS });
        entry.postingId = pageId;
        entry.decision = decision;
        if (decision === 'unchanged') {
          summary.skippedUnchanged += 1;
        } else {
          const result = await ingestFieldglassPage(ctx.config, key, {
            pageText: text,
            url: item.url,
            postingId: item.postingId ?? undefined,
          });
          state.stamp(pageId, hash, result.jobOrder?.action as string | undefined);
          summary.ok += 1;
          if (result.created) summary.created += 1;
          if (result.candidateInMind) summary.candidateInMind += 1;
          const joAction = String(result.jobOrder?.action ?? '');
          if (joAction === 'closed') summary.closed += 1;
          if (joAction === 'halted') summary.halted += 1;
          entry.created = result.created;
          entry.candidateInMind = result.candidateInMind;
          entry.jobOrder = joAction || null;
        }
      } catch (err) {
        if (isBrowserGone(err)) {
          // Shutdown/crash: stop here so the worker can release the action
          // instead of "succeeding" with 90 fast failures (2026-09-07).
          await state.save();
          throw new PortalActionFailure('BROWSER_CRASH', `browser closed mid-sync after ${summary.ok} ok / ${i} visited`, { partial: summary });
        }
        const failure = err instanceof PortalActionFailure ? err : null;
        if (failure?.code === 'LOGIN_REQUIRED') {
          consecutiveLoginWalls += 1;
          if (consecutiveLoginWalls >= 2) {
            await state.save();
            throw new PortalActionFailure('LOGIN_REQUIRED', `Fieldglass session expired mid-sync after ${summary.ok} ok`, {
              partial: summary,
            });
          }
        }
        summary.failed += 1;
        entry.error =
          err instanceof HrxApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message.slice(0, 200) : String(err);
        log.warn('fieldglass sync item failed', { label: item.label, error: entry.error });
      }
      summary.items.push(entry);
      if (i < list.length - 1) await sleep(ITEM_PACING_MS);
      // Persist progress every 10 items so a crash keeps most of the work.
      if (i % 3 === 2) await state.save();
    }
    await state.save();
    const { items: detail, ...rest } = summary;
    log.info('fieldglass sync done', { ...rest, durationMs: Date.now() - startedAt });
    return { ...rest, durationMs: Date.now() - startedAt, items: detail.slice(0, 150) };
  }

  private withItemTimeout<T>(p: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PortalActionFailure('TIMEOUT', `${label}: page did not render in ${ITEM_TIMEOUT_MS}ms`)), ITEM_TIMEOUT_MS);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  /**
   * Open a posting's detail page and return its rendered innerText once the
   * SDXOJP id is visible (SAP renders via JS; a bare fetch gets an empty shell).
   */
  private async captureDetailPage(page: Page, url: string): Promise<string> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    let lastText = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? 1_500 : 1_200);
      if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'detail page redirected to sign-in');
      lastText = await page.locator('body').innerText().catch(() => '');
      if (POSTING_ID_RE.test(lastText)) return lastText;
    }
    throw new PortalActionFailure('SELECTOR_MISSING', `no SDXOJP id rendered on ${url.slice(-40)}`);
  }

  /** HRX already knows this posting's deep link (email) or last sync URL. */
  private async detailUrlFromHrx(ctx: AdapterContext, postingId: string): Promise<string | null> {
    try {
      const snap = await ctx.db.doc(`tenants/${ctx.config.tenantId}/external_shift_requests/fieldglass__${postingId}`).get();
      if (!snap.exists) return null;
      const ev = (snap.get('event') ?? {}) as { detailUrl?: string };
      const en = (snap.get('enrichment') ?? {}) as { sourceUrl?: string };
      const url = ev.detailUrl || en.sourceUrl || null;
      return url && url.includes(DETAIL_PATH) ? url : null;
    } catch (err) {
      log.warn('detailUrlFromHrx failed', { postingId, err });
      return null;
    }
  }

  /** Last resort: the portal's global "Search by ID or text…" box. */
  private async detailUrlFromSearch(ctx: AdapterContext, postingId: string): Promise<string | null> {
    const { page } = ctx;
    try {
      await page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
      const box = page.locator('input[placeholder*="Search" i]').first();
      if ((await box.count()) === 0) return null;
      await box.fill(postingId);
      await box.press('Enter');
      await page.waitForTimeout(3_000);
      // Either we landed on the posting, or a results list links to it.
      if (page.url().includes(DETAIL_PATH)) {
        const text = await page.locator('body').innerText().catch(() => '');
        if (text.includes(postingId)) return canonicalDetailUrl(page.url());
      }
      const links = await this.linksOnPage(page);
      const hit = links.find((l) => l.postingId === postingId) ?? links.find((l) => l.text.includes(postingId));
      if (hit) return hit.url;
      await ctx.screenshot(`fieldglass-search-miss-${postingId}`);
      return null;
    } catch (err) {
      log.warn('detailUrlFromSearch failed', { postingId, err });
      return null;
    }
  }

  /** job_posting_detail.do links on the current page with the row text that names them. */
  private async linksOnPage(page: Page): Promise<WorklistLink[]> {
    const raw = await page.evaluate((detailPath: string) => {
      const out: Array<{ url: string; text: string }> = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') || '';
        if (!href.includes(detailPath)) continue;
        try {
          const u = new URL(href, window.location.href);
          u.hash = '';
          const row = a.closest('tr, li, [role="row"], .row, div');
          const text = `${a.textContent || ''} ${row?.textContent || ''}`.replace(/\s+/g, ' ').slice(0, 400);
          out.push({ url: u.toString(), text });
        } catch {
          /* ignore */
        }
      }
      return out;
    }, DETAIL_PATH);
    return raw.map((r) => ({
      url: canonicalDetailUrl(r.url),
      text: r.text,
      postingId: POSTING_ID_RE.exec(r.text)?.[0] ?? null,
    }));
  }

  /**
   * The supplier worklist, all pages. Collects unique job_posting_detail.do
   * links (deduped by canonical URL, fragments stripped) with the SDXOJP
   * number from their row, and follows a "Next" control while one exists
   * (best effort — the extension only ever read page 1).
   */
  private async collectWorklistLinks(ctx: AdapterContext): Promise<{ links: WorklistLink[]; pages: number }> {
    const { page } = ctx;
    await page.goto(WORKLIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_500);
    if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'worklist redirected to sign-in');

    const seen = new Set<string>();
    const links: WorklistLink[] = [];
    let pages = 0;
    const perPage: number[] = [];
    for (let p = 0; p < 25; p += 1) {
      pages += 1;
      // SAP renders the list via XHR: read only once the link count has been
      // stable for two consecutive polls (2026-09-07: 94 vs 15 links between
      // runs because page 1 was read mid-render).
      let found = await this.linksOnPage(page);
      let stable = 0;
      for (let poll = 0; poll < 20 && stable < 2; poll += 1) {
        await page.waitForTimeout(750);
        const again = await this.linksOnPage(page);
        if (again.length === found.length && again.length > 0) stable += 1;
        else stable = 0;
        found = again;
      }
      perPage.push(found.length);
      let newOnPage = 0;
      for (const link of found) {
        const k = detailKey(link.url);
        if (seen.has(k)) continue;
        seen.add(k);
        links.push(link);
        newOnPage += 1;
      }
      // Pagination: a "Next" link/button that is not disabled.
      const next = page
        .locator('a, button')
        .filter({ hasText: /^\s*(Next|›|»|>)\s*$/ })
        .or(page.locator('[aria-label="Next" i], [title="Next" i], a[rel="next"]'))
        .first();
      const hasNext = (await next.count()) > 0;
      if (!hasNext || newOnPage === 0) break;
      const disabled =
        (await next.getAttribute('disabled').catch(() => null)) !== null ||
        /disabled/i.test((await next.getAttribute('class').catch(() => '')) ?? '') ||
        (await next.getAttribute('aria-disabled').catch(() => null)) === 'true';
      if (disabled) break;
      try {
        const prevFirst = found[0]?.url ?? '';
        await next.click({ timeout: 5_000 });
        // Wait for the list to actually change (XHR re-render), up to ~9s.
        for (let poll = 0; poll < 12; poll += 1) {
          await page.waitForTimeout(750);
          const now = await this.linksOnPage(page);
          if (now.length > 0 && now[0].url !== prevFirst) break;
        }
      } catch {
        break;
      }
    }
    log.info('fieldglass worklist scanned', { links: links.length, pages, perPage });
    await ctx.screenshot(links.length === 0 ? 'fieldglass-worklist-empty' : 'fieldglass-worklist-lastpage');
    return { links, pages };
  }
}
