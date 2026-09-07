/**
 * SAP Fieldglass supplier portal (www.us.fieldglass.cloud.sap).
 *
 * Verified 2026-09-06 (unauthenticated): the sign-in page is a plain form —
 * `input[name=username]` + `input[name=password]` + a "Sign In" button, no
 * CAPTCHA, no bot-protection scripts, no login iframe. The old
 * fieldglass.net hosts redirect with a notice; always use the .cloud.sap host.
 *
 * Candidate submission is NOT implemented yet: the job-seeker + submit form
 * flow has to be recorded once against a real posting with Greg (Sodexo may
 * require per-submission attestations). Until then submit_candidate /
 * withdraw_candidate escalate to needs_human.
 */
import type { Page } from 'playwright';
import type { PortalActionDoc, SmokeTestPayload } from '../../../shared/portalActions.ts';
import { PortalActionFailure } from '../errors.ts';
import { log } from '../logger.ts';
import type { PortalCredentials } from '../secrets.ts';
import type { AdapterContext, PortalAdapter } from './types.ts';

const ORIGIN = 'https://www.us.fieldglass.cloud.sap';

export class FieldglassAdapter implements PortalAdapter {
  readonly provider = 'fieldglass' as const;
  readonly homeUrl = `${ORIGIN}/`;

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
    const user = page.locator('input[name="username"]');
    await user.waitFor({ state: 'visible', timeout: 15_000 });
    await user.fill(creds.username);
    await page.locator('input[name="password"]').fill(creds.password);
    const submit = page.getByRole('button', { name: /sign in/i });
    if ((await submit.count()) > 0) await submit.first().click();
    else await page.locator('input[name="password"]').press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    if (await this.isLoginWall(page)) {
      const shot = await ctx.screenshot('fieldglass-login-rejected');
      throw new PortalActionFailure('LOGIN_FAILED', 'Fieldglass rejected the bot credentials', { screenshot: shot });
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

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await ctx.page.goto(this.homeUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1_500);
    if (await this.isLoginWall(ctx.page)) throw new PortalActionFailure('LOGIN_REQUIRED', 'Fieldglass session expired');
  }

  async execute(ctx: AdapterContext, action: PortalActionDoc): Promise<Record<string, unknown>> {
    switch (action.action) {
      case 'smoke_test':
        return this.smokeTest(ctx, action.payload as SmokeTestPayload);
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
}
