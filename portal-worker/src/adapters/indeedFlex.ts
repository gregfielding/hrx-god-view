/**
 * Indeed Flex agency portal (agency.indeedflex.com).
 *
 * Verified 2026-09-06: sign-in at /o/signin is email-first (Continue) then a
 * password page ("Signing in as …"); no CAPTCHA or bot-protection scripts.
 * Sessions persist in the Chromium profile.
 *
 * `indeed_flex_sync` = the courier pass ported from
 * browser-extensions/indeed-flex-sync: while Playwright drives the SPA, we
 * tap the portal's own JSON API responses (flex-core-us.indeed.com/api/v2/
 * agency_portal/…) — job, agency_shifts, the BOOKED roster, timesheet
 * entries — and forward the raw bodies to HRX's ingest endpoints, which do
 * all normalizing. Nothing is extracted here, so a portal UI change cannot
 * break the payloads; only the navigation can.
 *
 * `accept_job_request` (2026-09-07) = the "You have been allocated 1 job by
 * Indeed" flow observed in Greg's session: jobs list row (status New, action
 * "Respond") → /allocations/{allocationId}/platforms/{platformId} page with one
 * row per day ("Workers Accepted/Requested" number input, defaults to the
 * requested headcount) → "Confirm" (or "Decline All"). Confirm commits C1 to
 * fill the headcount, so the action verifies the row flipped to In Progress /
 * Book Workers afterwards and queues a targeted sync.
 *
 * Booking (`book_worker`) is NOT implemented yet.
 */
import type { Page, Response } from 'playwright';
import type { AcceptJobRequestPayload, CapturePagePayload, IndeedFlexSyncPayload, PortalActionDoc, SmokeTestPayload } from '../../../shared/portalActions.ts';
import { enqueuePortalAction } from '../enqueue.ts';
import { isBrowserGone, PortalActionFailure } from '../errors.ts';
import { HrxApiError, ingestFlexPortalCapture, ingestFlexTimesheets, type FlexPortalEnvelope } from '../hrxApi.ts';
import { log } from '../logger.ts';
import type { PortalCredentials } from '../secrets.ts';
import { hashPageText, SyncState } from '../syncState.ts';
import type { AdapterContext, PortalAdapter } from './types.ts';

const ORIGIN = 'https://agency.indeedflex.com';
const SIGNIN_PATH = '/o/signin';
const JOBS_LIST_URL =
  `${ORIGIN}/jobs?allocationTime=365&approvalStatus=select_all_option&clientId=select_all_option` +
  `&payRate=select_all_option&roleId=select_all_option&statusId=select_all_option&venueId=select_all_option`;
const TIMESHEETS_URL = `${ORIGIN}/o/timesheets`;
const API_RE = /flex-core-us\.indeed\.com\/api\/v2\/agency_portal\//;
const JOB_PACING_MS = 2_000;
const JOB_TIMEOUT_MS = 45_000;
const UNCHANGED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Fallback platform id from Greg's portal URLs (docs/claude/feature_indeed_flex_automation_roadmap.md). */
const DEFAULT_PLATFORM_ID = '2590';

type ApiKind = 'jobs_list' | 'job' | 'shifts' | 'workers' | 'timesheets' | null;

function classify(url: string): ApiKind {
  if (!API_RE.test(url)) return null;
  if (/\/jobs\/\d+(\?|$)/.test(url)) return 'job';
  if (/\/jobs(\?|$)/.test(url)) return 'jobs_list';
  if (/\/agency_shifts\b/.test(url)) return 'shifts';
  if (/\/workers\b/.test(url)) return 'workers';
  if (/\/timesheets\/entries(\?|$)/.test(url)) return 'timesheets';
  return null;
}

interface JobRef {
  jobId: string;
  platformId: string | null;
  roleId: string | null;
  venueId: string | null;
  status: string | null;
  title: string | null;
  client: string | null;
  /** Ready-made detail link when the list gave us one. */
  href: string | null;
}

interface Capture {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

/** Walk any JSON shape and return objects that look like jobs on a jobs list. */
function jobsFromListBody(body: unknown): JobRef[] {
  const out: JobRef[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const id = str(o.id ?? o.job_id ?? o.jobId);
    const venue = (o.venue ?? {}) as Record<string, unknown>;
    const role = (o.role ?? {}) as Record<string, unknown>;
    const client = (o.client ?? o.platform ?? {}) as Record<string, unknown>;
    const looksLikeJob = id && (o.venue_id !== undefined || venue.id !== undefined || o.role_id !== undefined || role.id !== undefined);
    if (looksLikeJob && !seen.has(id)) {
      seen.add(id);
      const status = o.status;
      out.push({
        jobId: id,
        platformId: str(o.platform_id ?? client.platform_id ?? client.id ?? o.client_id),
        roleId: str(o.role_id ?? role.id),
        venueId: str(o.venue_id ?? venue.id),
        status: typeof status === 'object' && status ? str((status as Record<string, unknown>).name ?? (status as Record<string, unknown>).label) : str(status),
        title: str(role.title ?? o.title ?? o.role_title),
        client: str(client.display_name ?? client.name ?? o.client_display_name),
        href: null,
      });
      return;
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  visit(body, 0);
  return out;
}

export class IndeedFlexAdapter implements PortalAdapter {
  readonly provider = 'indeed_flex' as const;
  readonly homeUrl = `${ORIGIN}/`;

  async isLoginWall(page: Page): Promise<boolean> {
    if (page.url().includes(SIGNIN_PATH)) return true;
    const email = page.locator('input[name="email"]');
    if ((await email.count()) === 0) return false;
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    return /provide your email|sign in|log in/i.test(text);
  }

  async checkSession(ctx: AdapterContext): Promise<boolean> {
    await ctx.page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2_500);
    return !(await this.isLoginWall(ctx.page));
  }

  async login(ctx: AdapterContext, creds: PortalCredentials): Promise<void> {
    const { page } = ctx;
    if (!(await this.isLoginWall(page))) {
      await page.goto(`${ORIGIN}${SIGNIN_PATH}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
    }
    const email = page.locator('input[name="email"]');
    await email.waitFor({ state: 'visible', timeout: 15_000 });
    await email.fill(creds.username);
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForTimeout(3_000);
    await ctx.screenshot('flex-login-step2');

    const password = page.locator('input[type="password"]');
    if ((await password.count()) > 0) {
      await password.first().fill(creds.password);
      const filledLen = await password.first().inputValue().then((v) => v.length);
      log.info('flex password step', { url: page.url(), filledLen, expectedLen: creds.password.length });
      await page.waitForTimeout(500);
      const cont = page.getByRole('button', { name: /continue|sign in/i });
      if ((await cont.count()) > 0) await cont.first().click();
      else await password.first().press('Enter');
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
      if (await this.isLoginWall(page)) {
        const shot = await ctx.screenshot('flex-login-rejected');
        throw new PortalActionFailure('LOGIN_FAILED', 'Indeed Flex rejected the bot credentials', { screenshot: shot });
      }
      log.info('indeed flex login ok');
      return;
    }

    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    const shot = await ctx.screenshot('flex-login-second-step');
    if (/code|verification|check your email|magic link/i.test(text)) {
      throw new PortalActionFailure(
        'LOGIN_FAILED',
        'Indeed Flex asked for an emailed code; unattended code entry is not wired yet',
        { screenshot: shot },
      );
    }
    throw new PortalActionFailure('LOGIN_FAILED', 'Indeed Flex sign-in second step not recognised', {
      screenshot: shot,
    });
  }

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await ctx.page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1_500);
    if (await this.isLoginWall(ctx.page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'Indeed Flex session expired');
  }

  async execute(ctx: AdapterContext, action: PortalActionDoc): Promise<Record<string, unknown>> {
    switch (action.action) {
      case 'smoke_test':
        return this.smokeTest(ctx, action.payload as SmokeTestPayload);
      case 'indeed_flex_sync':
        return this.sync(ctx, (action.payload ?? {}) as IndeedFlexSyncPayload);
      case 'accept_job_request':
        return this.acceptJobRequest(ctx, (action.payload ?? {}) as AcceptJobRequestPayload);
      case 'capture_page':
        return this.capturePage(ctx, (action.payload ?? {}) as CapturePagePayload);
      case 'book_worker':
      case 'unbook_worker':
        throw new PortalActionFailure(
          'NOT_IMPLEMENTED',
          `${action.action} is not implemented for Indeed Flex yet (adapter slice pending)`,
        );
      default:
        throw new PortalActionFailure('INVALID_PAYLOAD', `action ${action.action} does not belong to Indeed Flex`);
    }
  }

  private async smokeTest(ctx: AdapterContext, payload: SmokeTestPayload): Promise<Record<string, unknown>> {
    const url = payload?.url || this.homeUrl;
    await ctx.page.goto(url, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2_000);
    if (await this.isLoginWall(ctx.page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'landed on the sign-in wall');
    return { url: ctx.page.url(), title: await ctx.page.title(), checkedAt: new Date().toISOString() };
  }

  // --- accept_job_request ---------------------------------------------------

  /** The "Tell us what you think of Indeed Flex" survey modal steals clicks on the jobs list. */
  private async dismissSurvey(page: Page): Promise<void> {
    const dialog = page.getByRole('dialog').filter({ hasText: /tell us what you think|how was your experience/i });
    if ((await dialog.count()) === 0) return;
    const close = dialog.getByRole('button', { name: /close|dismiss/i }).first();
    if ((await close.count()) > 0) await close.click().catch(() => undefined);
    else await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }

  /** The jobs-list row that carries this job id (cells are text, so match the id exactly). */
  private jobRow(page: Page, jobId: string) {
    return page.locator('tr, [role="row"]').filter({ has: page.getByText(jobId, { exact: true }) }).first();
  }

  private async acceptJobRequest(ctx: AdapterContext, payload: AcceptJobRequestPayload): Promise<Record<string, unknown>> {
    const jobId = String(payload.flexJobId ?? '').trim();
    if (!/^\d+$/.test(jobId)) throw new PortalActionFailure('INVALID_PAYLOAD', `accept_job_request needs a numeric flexJobId (got "${payload.flexJobId}")`);
    const wantHeadcount = payload.acceptHeadcount != null ? Math.max(0, Math.floor(Number(payload.acceptHeadcount))) : null;
    if (wantHeadcount != null && !Number.isFinite(wantHeadcount)) throw new PortalActionFailure('INVALID_PAYLOAD', 'acceptHeadcount must be a number');
    const { page } = ctx;
    const startedAt = Date.now();

    // 1. Jobs list → the row for this job.
    ctx.progress(`accept ${jobId}: loading jobs list`);
    await page.goto(JOBS_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'jobs list redirected to sign-in');
    await this.dismissSurvey(page);
    await this.scrollToLoadAll(page);
    const row = this.jobRow(page, jobId);
    if ((await row.count()) === 0) {
      const shot = await ctx.screenshot(`flex-accept-${jobId}-row-missing`);
      throw new PortalActionFailure('SELECTOR_MISSING', `job ${jobId} is not on the jobs list (expired, withdrawn, or outside the 365-day window)`, { screenshot: shot });
    }
    const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const respond = row.getByRole('button', { name: /respond/i }).or(row.getByRole('link', { name: /respond/i })).first();
    if ((await respond.count()) === 0) {
      // Already answered (In Progress / Book Workers) → idempotent success; anything else is a real stop.
      if (/book workers|in progress/i.test(rowText)) {
        log.info('flex accept: job already accepted', { jobId, rowText: rowText.slice(0, 200) });
        return { jobId, alreadyAccepted: true, rowText: rowText.slice(0, 300), checkedAt: new Date().toISOString() };
      }
      const shot = await ctx.screenshot(`flex-accept-${jobId}-no-respond`);
      throw new PortalActionFailure('PORTAL_REJECTED', `job ${jobId} has no Respond action (row: ${rowText.slice(0, 160)})`, { screenshot: shot });
    }

    // 2. Respond → allocation page.
    ctx.progress(`accept ${jobId}: opening allocation`);
    await row.scrollIntoViewIfNeeded().catch(() => undefined);
    await respond.click();
    await page.waitForURL(/\/allocations\//, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    const allocationUrl = page.url();
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (!/\/allocations\//.test(allocationUrl) || !bodyText.includes(jobId)) {
      const shot = await ctx.screenshot(`flex-accept-${jobId}-allocation-unexpected`);
      throw new PortalActionFailure('SELECTOR_MISSING', `Respond did not open the allocation page for ${jobId} (at ${allocationUrl})`, { screenshot: shot });
    }
    const confirm = page.getByRole('button', { name: /^confirm$/i }).first();
    if ((await confirm.count()) === 0) {
      const shot = await ctx.screenshot(`flex-accept-${jobId}-no-confirm`);
      throw new PortalActionFailure('SELECTOR_MISSING', `allocation page for ${jobId} has no Confirm button`, { screenshot: shot });
    }

    // 3. Headcount per day (portal default = requested). Only touch it when asked.
    // One "Accepted workers" number input per day row. The portal defaults it
    // to the requested headcount; only touch it when the caller asked for a
    // different number, and never block on an input that isn't editable
    // (2026-09-07: a hidden/readonly second input made `fill` time out for
    // 30s × 3 attempts and sent request 546477 to needs_human).
    const inputs = page.locator('input[type="number"][aria-label*="ccepted"], input[type="number"]');
    const dayRows = await inputs.count();
    const before: Array<{ accepted: string; requested: string | null; note?: string }> = [];
    for (let i = 0; i < dayRows; i += 1) {
      const inp = inputs.nth(i);
      const visible = await inp.isVisible().catch(() => false);
      const editable = visible && (await inp.isEditable().catch(() => false));
      const current = await inp.inputValue().catch(() => '');
      const requested = await inp.evaluate((el) => {
        const t = el.parentElement?.parentElement?.textContent ?? '';
        return /\/\s*(\d+)/.exec(t)?.[1] ?? (el as HTMLInputElement).max ?? null;
      }).catch(() => null);
      if (!visible) continue;
      let note: string | undefined;
      if (wantHeadcount != null && String(wantHeadcount) !== current) {
        if (!editable) note = 'not editable — left portal default';
        else {
          try {
            await inp.fill(String(wantHeadcount), { timeout: 5_000 });
            await inp.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(() => undefined);
          } catch {
            note = 'fill failed — left portal default';
          }
        }
      }
      before.push({ accepted: await inp.inputValue().catch(() => current), requested, ...(note ? { note } : {}) });
    }
    const shotBefore = await ctx.screenshot(`flex-accept-${jobId}-before-confirm`);
    const summary: Record<string, unknown> = {
      jobId,
      allocationUrl,
      dayRows,
      headcounts: before,
      requestedHeadcount: wantHeadcount,
      screenshotBefore: shotBefore ?? null,
      header: /allocated[^.]{0,120}/i.exec(bodyText)?.[0] ?? null,
    };
    if (payload.dryRun) {
      log.info('flex accept: dry run — not confirming', { jobId, allocationUrl });
      await page.goto(JOBS_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      return { ...summary, dryRun: true, confirmed: false, elapsedMs: Date.now() - startedAt };
    }

    // 4. Confirm (+ any "are you sure" dialog).
    ctx.progress(`accept ${jobId}: confirming`);
    await confirm.click();
    await page.waitForTimeout(1_500);
    const dialog = page.getByRole('dialog').or(page.locator('[role="alertdialog"]'));
    if ((await dialog.count()) > 0) {
      const again = dialog.getByRole('button', { name: /confirm|yes|accept|continue|ok/i }).first();
      if ((await again.count()) > 0) {
        summary.secondaryConfirm = (await again.innerText().catch(() => '')).trim();
        await again.click();
        await page.waitForTimeout(1_500);
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    const afterText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const portalError = /something went wrong|error|could not|unable to/i.exec(afterText)?.[0] ?? null;
    summary.screenshotAfter = (await ctx.screenshot(`flex-accept-${jobId}-after-confirm`)) ?? null;

    // 5. Verify on the jobs list: Respond gone, row now In Progress / Book Workers.
    ctx.progress(`accept ${jobId}: verifying`);
    await page.goto(JOBS_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await this.dismissSurvey(page);
    await this.scrollToLoadAll(page);
    const rowAfter = this.jobRow(page, jobId);
    const rowAfterText = (await rowAfter.count()) > 0 ? (await rowAfter.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() : '';
    const stillRespond = (await rowAfter.count()) > 0 && (await rowAfter.getByRole('button', { name: /respond/i }).count()) > 0;
    const verified = !stillRespond && /book workers|in progress/i.test(rowAfterText);
    summary.rowAfter = rowAfterText.slice(0, 300);
    summary.verified = verified;
    summary.elapsedMs = Date.now() - startedAt;
    if (!verified) {
      const shot = await ctx.screenshot(`flex-accept-${jobId}-unverified`);
      throw new PortalActionFailure(
        'PORTAL_REJECTED',
        `Confirm did not flip job ${jobId} to In Progress${portalError ? ` (portal said: ${portalError})` : ''}; row now: ${rowAfterText.slice(0, 160) || '(missing)'}`,
        { screenshot: shot, ...summary },
      );
    }
    log.info('flex accept: confirmed', { jobId, headcounts: before, allocationUrl });

    // 6. Pull the accepted job into HRX right away (rosters/shifts) instead of waiting for the hourly pass.
    try {
      const sync = await enqueuePortalAction(ctx.db, {
        tenantId: ctx.config.tenantId,
        action: 'indeed_flex_sync',
        payload: { flexJobIds: [jobId], includeTimesheets: false, force: true, reason: `accept_job_request:${jobId}` },
        createdBy: { kind: 'system', id: `portal-worker:${ctx.config.workerId}` },
        priority: 20,
        force: true,
      });
      summary.followUpSyncId = sync.id;
    } catch (err) {
      summary.followUpSyncError = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
    return { ...summary, confirmed: true };
  }

  // --- capture_page (adapter-building explorer) ------------------------------

  private async dumpInteractive(page: Page): Promise<unknown[]> {
    return page.evaluate(() => {
      const out: unknown[] = [];
      const els = document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="button"], [role="checkbox"], [role="option"]');
      let i = 0;
      for (const el of Array.from(els)) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const e = el as HTMLElement & { href?: string; type?: string; value?: string; placeholder?: string; name?: string; disabled?: boolean; checked?: boolean };
        out.push({
          i: i++,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          text: (e.innerText || e.getAttribute('aria-label') || e.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          href: e.href ? String(e.href).slice(0, 160) : undefined,
          type: e.type,
          name: e.name || undefined,
          value: e.value !== undefined && e.value !== '' ? String(e.value).slice(0, 40) : undefined,
          disabled: e.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
          checked: e.checked || el.getAttribute('aria-checked') === 'true' || undefined,
          testid: el.getAttribute('data-testid') || undefined,
        });
        if (out.length >= 250) break;
      }
      return out;
    });
  }

  private async capturePage(ctx: AdapterContext, payload: CapturePagePayload): Promise<Record<string, unknown>> {
    const { page } = ctx;
    let url = payload.url;
    if (!url && payload.flexJobId) {
      await page.goto(JOBS_LIST_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      await this.dismissSurvey(page);
      await this.scrollToLoadAll(page);
      const dom = await this.jobsFromDom(page);
      const job = dom.find((j) => j.jobId === payload.flexJobId) ?? { jobId: payload.flexJobId, platformId: null, roleId: null, venueId: null, status: null, title: null, client: null, href: null };
      const u = new URL(this.detailUrl(job, null));
      for (const [k, v] of Object.entries(payload.params ?? {})) u.searchParams.set(k, v);
      url = u.toString();
    }
    if (!url) throw new PortalActionFailure('INVALID_PAYLOAD', 'capture_page needs url or flexJobId');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'capture landed on sign-in');
    await this.dismissSurvey(page);
    const steps: Array<Record<string, unknown>> = [];
    for (const name of payload.clicks ?? []) {
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const target = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).or(page.getByRole('tab', { name: re })).or(page.getByText(re)).first();
      const found = (await target.count()) > 0;
      if (found) {
        await target.click({ timeout: 10_000 }).catch((e) => steps.push({ click: name, error: String(e).slice(0, 120) }));
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1_200);
      }
      steps.push({ click: name, found, url: page.url() });
    }
    if (payload.typeInto?.text) {
      const hint = payload.typeInto.placeholderOrLabel;
      const box = hint ? page.getByPlaceholder(new RegExp(hint, 'i')).or(page.getByLabel(new RegExp(hint, 'i'))).first() : page.getByRole('textbox').first();
      if ((await box.count()) > 0) {
        await box.fill(payload.typeInto.text);
        await page.waitForTimeout(payload.settleMs ?? 2_000);
        steps.push({ typed: payload.typeInto.text });
      } else steps.push({ typed: payload.typeInto.text, error: 'no textbox' });
    }
    await page.waitForTimeout(payload.settleMs ?? 2_000);
    const shot = await ctx.screenshot(`capture-${payload.flexJobId ?? 'page'}`);
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 8_000);
    const interactive = await this.dumpInteractive(page);
    return { url: page.url(), title: await page.title(), steps, screenshot: shot ?? null, text, interactive };
  }

  // --- indeed_flex_sync -----------------------------------------------------

  private async sync(ctx: AdapterContext, payload: IndeedFlexSyncPayload): Promise<Record<string, unknown>> {
    const key = await ctx.extensionKey();
    if (!key) {
      throw new PortalActionFailure('LOGIN_FAILED', 'INDEED_FLEX_EXTENSION_KEY is not provisioned on this worker (env or Secret Manager)');
    }
    const { page } = ctx;
    const startedAt = Date.now();
    const includeRosters = payload.includeRosters ?? true;
    const includeTimesheets = payload.includeTimesheets ?? true;
    const maxJobs = Math.max(1, Math.min(payload.maxJobs ?? 60, 300));
    const wanted = new Set((payload.flexJobIds ?? []).map(String));

    // Tap every agency-portal API response for the whole run.
    const captures: Capture[] = [];
    let authHeaders: Record<string, string> | null = null;
    const onResponse = async (res: Response) => {
      const url = res.url();
      const kind = classify(url);
      if (!kind) return;
      try {
        const body = await res.json();
        captures.push({ url, body, headers: {} });
        if (!authHeaders) {
          const h = await res.request().allHeaders();
          const picked: Record<string, string> = {};
          for (const name of ['authorization', 'x-csrf-token', 'x-requested-with', 'accept']) if (h[name]) picked[name] = h[name];
          if (picked.authorization) authHeaders = picked;
        }
      } catch {
        /* non-JSON or streamed — ignore */
      }
    };
    page.on('response', onResponse);
    const state = new SyncState(ctx.db, ctx.config.tenantId, 'indeed_flex_sync');
    await state.load();

    const summary = {
      jobsListed: 0,
      jobsVisited: 0,
      rostersIngested: 0,
      rostersSkippedUnchanged: 0,
      rosterFailures: 0,
      jobsWithoutRoster: 0,
      timesheetPages: 0,
      timesheetRows: 0,
      timesheetFailures: 0,
      timesheetAttention: 0,
      apiUrlsSeen: [] as string[],
      items: [] as Array<Record<string, unknown>>,
    };

    try {
      // 1. Jobs list → JobRefs (API body preferred, DOM links as fallback).
      // A timesheets-only pass (clock-in watch) skips it entirely — the
      // timesheets view's own entries call supplies the auth header.
      const needJobs = includeRosters || wanted.size > 0;
      let targets: JobRef[] = [];
      if (needJobs) {
      ctx.progress('loading jobs list');
      await page.goto(JOBS_LIST_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
      if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'jobs list redirected to sign-in');
      await this.scrollToLoadAll(page);
      let jobs = this.jobsFromCaptures(captures);
      const domJobs = await this.jobsFromDom(page);
      jobs = this.mergeJobRefs(jobs, domJobs);
      summary.jobsListed = jobs.length;
      log.info('flex jobs list', { fromApi: this.jobsFromCaptures(captures).length, fromDom: domJobs.length, merged: jobs.length });
      // Publish the portal's own view of every job (status New / In Progress /
      // Completed, client) so HRX can tell an accepted request from one still
      // waiting — Natalie's brief and list_flex_requests read this doc.
      try {
        const byJob: Record<string, unknown> = {};
        for (const j of jobs) byJob[j.jobId] = { status: j.status ?? null, client: j.client ?? null, title: j.title ?? null, seenAt: new Date().toISOString() };
        await ctx.db.collection('tenants').doc(ctx.config.tenantId).collection('portal_state').doc('indeed_flex_jobs').set({ jobs: byJob, count: jobs.length, updatedAt: new Date().toISOString(), workerId: ctx.config.workerId }, { merge: true });
      } catch (err) {
        log.warn('flex jobs list publish failed', { error: err instanceof Error ? err.message : String(err) });
      }

      targets = jobs;
      if (wanted.size > 0) {
        targets = jobs.filter((j) => wanted.has(j.jobId));
        for (const id of wanted) {
          if (!targets.some((j) => j.jobId === id)) {
            targets.push({ jobId: id, platformId: null, roleId: null, venueId: null, status: null, title: null, client: null, href: null });
          }
        }
      } else if (!payload.includeCompleted) {
        targets = jobs.filter((j) => !/completed|cancel/i.test(j.status ?? ''));
      }
      targets = targets.slice(0, maxJobs);
      }

      // 2. Each job: open the booked-workers view, wait for the roster call, ship the bundle.
      if (includeRosters) {
        for (let i = 0; i < targets.length; i += 1) {
          const job = targets[i];
          ctx.progress(`job ${i + 1}/${targets.length} ${job.jobId}`);
          const entry: Record<string, unknown> = { jobId: job.jobId, client: job.client, status: job.status };
          try {
            const envelope = await this.withTimeout(this.captureJobBundle(page, captures, job), JOB_TIMEOUT_MS, `job ${job.jobId}`);
            summary.jobsVisited += 1;
            if (!envelope) {
              summary.jobsWithoutRoster += 1;
              entry.note = 'no booked-roster response observed';
            } else {
              const hash = hashPageText(JSON.stringify({ j: envelope.job, s: envelope.shifts, r: envelope.roster }));
              const decision = state.shouldIngest(`job:${job.jobId}`, hash, { force: payload.force, maxAgeMs: UNCHANGED_MAX_AGE_MS });
              entry.decision = decision;
              if (decision === 'unchanged') {
                summary.rostersSkippedUnchanged += 1;
              } else {
                const r = await ingestFlexPortalCapture(ctx.config, key, envelope);
                state.stamp(`job:${job.jobId}`, hash, r.matched ? 'matched' : r.reason);
                summary.rostersIngested += 1;
                entry.matched = r.matched ?? null;
                entry.created = r.created ?? null;
                entry.reconfirmed = r.reconfirmed ?? null;
                entry.observedDrops = r.observedDrops ?? null;
                entry.unmatched = Array.isArray(r.unmatchedWorkers) ? r.unmatchedWorkers.length : null;
                entry.reason = r.reason ?? null;
              }
            }
          } catch (err) {
            if (err instanceof PortalActionFailure && err.code === 'LOGIN_REQUIRED') throw err;
            if (isBrowserGone(err)) {
              await state.save();
              throw new PortalActionFailure('BROWSER_CRASH', `browser closed mid-sync after ${summary.rostersIngested} ingested`, { partial: summary });
            }
            summary.rosterFailures += 1;
            entry.error = err instanceof HrxApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message.slice(0, 200) : String(err);
            log.warn('flex job sync failed', { jobId: job.jobId, error: entry.error });
          }
          summary.items.push(entry);
          if (i % 3 === 2) await state.save();
          if (i < targets.length - 1) await sleep(JOB_PACING_MS);
        }
      }

      // 3. Timesheets: the view's own entries pages, then a replayed wider window when the API lets us.
      if (includeTimesheets) {
        ctx.progress('timesheets');
        const before = captures.length;
        await page.goto(TIMESHEETS_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(2_500);
        const pages = new Map<string, unknown>();
        for (const c of captures.slice(before)) if (classify(c.url) === 'timesheets') pages.set(c.url, c.body);

        // Replay for the requested window via the SPA's own auth headers.
        const daysBack = Math.max(1, Math.min(payload.timesheetDaysBack ?? 7, 60));
        const sample = [...pages.keys()][0] ?? captures.map((c) => c.url).find((u) => classify(u) === 'timesheets');
        if (sample && authHeaders) {
          const replayed = await this.replayTimesheetWindow(page, sample, authHeaders, daysBack);
          for (const [url, body] of replayed) pages.set(url, body);
          if (replayed.size > 0) log.info('flex timesheets replayed', { pages: replayed.size, daysBack });
        }
        for (const [url, body] of pages) {
          const rows = Array.isArray(body) ? body.length : 0;
          const hash = hashPageText(JSON.stringify(body));
          const decision = state.shouldIngest(`ts:${url.replace(/[?&]page=\d+/, '')}:${rows}`, hash, { force: payload.force, maxAgeMs: UNCHANGED_MAX_AGE_MS });
          if (decision === 'unchanged') continue;
          try {
            const r = await ingestFlexTimesheets(ctx.config, key, { url, entries: body, capturedAt: Date.now() });
            state.stamp(`ts:${url.replace(/[?&]page=\d+/, '')}:${rows}`, hash);
            summary.timesheetPages += 1;
            summary.timesheetRows += r.entries ?? rows;
            summary.timesheetAttention += (r.workerUnmatched ?? 0) + (r.noAssignment ?? 0);
          } catch (err) {
            summary.timesheetFailures += 1;
            log.warn('flex timesheet ingest failed', { url: url.slice(0, 160), err });
          }
        }
      }
    } finally {
      page.off('response', onResponse);
      await state.save();
    }

    summary.apiUrlsSeen = [...new Set(captures.map((c) => c.url.replace(/\?.*$/, '')))].slice(0, 20);
    const { items, ...rest } = summary;
    log.info('flex sync done', { ...rest, durationMs: Date.now() - startedAt });
    return { ...rest, durationMs: Date.now() - startedAt, items: items.slice(0, 150) };
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PortalActionFailure('TIMEOUT', `${label} exceeded ${ms}ms`)), ms);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  /** Infinite-scroll / lazy lists: scroll until the height stops growing (max 15 rounds). */
  private async scrollToLoadAll(page: Page): Promise<void> {
    let last = -1;
    for (let i = 0; i < 15; i += 1) {
      const h = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return document.body.scrollHeight;
      });
      if (h === last) break;
      last = h;
      await page.waitForTimeout(1_200);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  private jobsFromCaptures(captures: Capture[]): JobRef[] {
    const out = new Map<string, JobRef>();
    for (const c of captures) {
      if (classify(c.url) !== 'jobs_list') continue;
      for (const j of jobsFromListBody(c.body)) if (!out.has(j.jobId)) out.set(j.jobId, j);
    }
    return [...out.values()];
  }

  /** Detail links rendered on the jobs list (View / Book Workers), with their row's text. */
  private async jobsFromDom(page: Page): Promise<JobRef[]> {
    const raw = await page.evaluate(() => {
      const out: Array<{ href: string; row: string }> = [];
      for (const a of Array.from(document.querySelectorAll('a[href*="/job-details/"]'))) {
        const href = (a as HTMLAnchorElement).href;
        const row = a.closest('tr, [role="row"], li, div')?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? '';
        out.push({ href, row });
      }
      return out;
    });
    const out = new Map<string, JobRef>();
    for (const { href, row } of raw) {
      try {
        const u = new URL(href);
        const jobId = /\/job-details\/(\d+)/.exec(u.pathname)?.[1];
        if (!jobId || out.has(jobId)) continue;
        out.set(jobId, {
          jobId,
          platformId: /\/platforms\/(\d+)\//.exec(u.pathname)?.[1] ?? null,
          roleId: u.searchParams.get('roleId'),
          venueId: u.searchParams.get('venueId'),
          status: /completed/i.test(row) ? 'Completed' : /in progress/i.test(row) ? 'In Progress' : /\bnew\b/i.test(row) ? 'New' : null,
          title: null,
          client: null,
          href,
        });
      } catch {
        /* ignore */
      }
    }
    return [...out.values()];
  }

  private mergeJobRefs(api: JobRef[], dom: JobRef[]): JobRef[] {
    const byId = new Map<string, JobRef>();
    for (const j of dom) byId.set(j.jobId, j);
    for (const j of api) {
      const d = byId.get(j.jobId);
      byId.set(j.jobId, {
        ...j,
        platformId: j.platformId ?? d?.platformId ?? null,
        roleId: j.roleId ?? d?.roleId ?? null,
        venueId: j.venueId ?? d?.venueId ?? null,
        status: j.status ?? d?.status ?? null,
        href: d?.href ?? null,
      });
    }
    return [...byId.values()];
  }

  private detailUrl(job: JobRef, fallbackPlatform: string | null): string {
    if (job.href) {
      const u = new URL(job.href);
      u.searchParams.set('workers', 'booked');
      return u.toString();
    }
    const platform = job.platformId ?? fallbackPlatform ?? DEFAULT_PLATFORM_ID;
    const u = new URL(`${ORIGIN}/platforms/${platform}/job-details/${job.jobId}`);
    if (job.roleId) u.searchParams.set('roleId', job.roleId);
    if (job.venueId) u.searchParams.set('venueId', job.venueId);
    u.searchParams.set('workers', 'booked');
    return u.toString();
  }

  /**
   * Open the job's booked-workers view and assemble {job, shifts, roster}
   * from the API responses the SPA makes. Returns null when no booked-roster
   * call was observed (e.g. a job with no shifts).
   */
  private async captureJobBundle(page: Page, captures: Capture[], job: JobRef): Promise<FlexPortalEnvelope | null> {
    const start = captures.length;
    const url = this.detailUrl(job, null);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 20_000;
    let roster: Capture | undefined;
    while (Date.now() < deadline) {
      roster = captures.slice(start).find((c) => classify(c.url) === 'workers' && /booked_agency_shift_ids/.test(c.url));
      if (roster) break;
      // The roster tab may need a click when the query param is ignored.
      if (Date.now() > deadline - 12_000) {
        const tab = page.getByRole('tab', { name: /booked/i }).or(page.getByRole('button', { name: /booked workers/i })).first();
        if ((await tab.count()) > 0) await tab.click({ timeout: 2_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(700);
    }
    if (await this.isLoginWall(page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'job page redirected to sign-in');
    if (!roster) return null;
    const since = captures.slice(start);
    const jobCap = since.find((c) => classify(c.url) === 'job' && new RegExp(`/jobs/${job.jobId}(\\?|$)`).test(c.url)) ?? since.find((c) => classify(c.url) === 'job');
    const shiftsCap = since.find((c) => classify(c.url) === 'shifts');
    const agencyId = /\/agencies\/(\d+)\//.exec(roster.url)?.[1] ?? (jobCap ? /\/agencies\/(\d+)\//.exec(jobCap.url)?.[1] : undefined) ?? null;
    const u = new URL(page.url());
    return {
      agencyId,
      context: {
        jobId: job.jobId,
        roleId: u.searchParams.get('roleId') ?? job.roleId,
        venueId: u.searchParams.get('venueId') ?? job.venueId,
        platformId: /\/platforms\/(\d+)\//.exec(u.pathname)?.[1] ?? job.platformId,
        url: page.url(),
      },
      job: jobCap?.body ?? null,
      shifts: shiftsCap?.body ?? null,
      roster: roster.body,
      capturedAt: Date.now(),
    };
  }

  /**
   * Re-issue the timesheets entries request for [today-daysBack, today] with
   * the SPA's own auth headers, paging until a short page. Returns url→body.
   * Silently returns empty when the API refuses (we still have the view's pages).
   */
  private async replayTimesheetWindow(page: Page, sampleUrl: string, headers: Record<string, string>, daysBack: number): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    try {
      const base = new URL(sampleUrl);
      const end = new Date();
      const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      base.searchParams.set('start_date', iso(start));
      base.searchParams.set('end_date', iso(end));
      base.searchParams.set('per_page', '100');
      for (let p = 1; p <= 30; p += 1) {
        base.searchParams.set('page', String(p));
        const res = await page.context().request.get(base.toString(), { headers, timeout: 30_000 });
        if (!res.ok()) {
          log.info('timesheet replay refused', { status: res.status() });
          break;
        }
        const body = (await res.json()) as unknown;
        const rows = Array.isArray(body) ? body.length : 0;
        if (rows === 0) break;
        out.set(base.toString(), body);
        if (rows < 100) break;
      }
    } catch (err) {
      log.info('timesheet replay failed (using view pages only)', { err });
    }
    return out;
  }
}
