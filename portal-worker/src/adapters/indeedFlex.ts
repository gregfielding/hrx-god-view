/**
 * Indeed Flex agency portal (agency.indeedflex.com).
 *
 * Verified 2026-09-06 (unauthenticated): sign-in lives at /o/signin and is
 * email-first — one `input[name=email]` + a Continue button; no CAPTCHA or
 * bot-protection scripts on that step. The second step (password vs emailed
 * code) is not yet observed, so `login` handles a password field when it
 * appears and escalates anything else to needs_human with a screenshot.
 *
 * Booking is NOT implemented yet. The portal runs on a JSON API
 * (flex-core-us.indeed.com/api/v2/agency_portal/agencies/3403/…, see
 * docs/claude/feature_indeed_flex_automation_roadmap.md); the plan is to
 * capture the SPA's own booking request headers and replay them, with UI
 * clicking as the fallback.
 */
import type { Page } from 'playwright';
import type { PortalActionDoc, SmokeTestPayload } from '../../../shared/portalActions.ts';
import { PortalActionFailure } from '../errors.ts';
import { log } from '../logger.ts';
import type { PortalCredentials } from '../secrets.ts';
import type { AdapterContext, PortalAdapter } from './types.ts';

const ORIGIN = 'https://agency.indeedflex.com';
const SIGNIN_PATH = '/o/signin';

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
}
