import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Diagnostics', () => {
  test('captures console errors and screenshot after login', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    await page.goto('/login');
    await login(
      page,
      process.env.E2E_EMAIL || 'g.fielding@c1staffing.com',
      process.env.E2E_PASSWORD || 'icsttoT3'
    );
    await expect(page.getByRole('heading', { name: /Welcome to the HRX Dashboard/i })).toBeVisible({ timeout: 20000 });

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach('post-login-screenshot', { body: shot, contentType: 'image/png' });

    // Attach logs for visibility
    await testInfo.attach('console-errors.json', {
      body: Buffer.from(JSON.stringify(consoleErrors, null, 2)),
      contentType: 'application/json',
    });
    await testInfo.attach('page-errors.json', {
      body: Buffer.from(JSON.stringify(pageErrors, null, 2)),
      contentType: 'application/json',
    });

    // Soft assertion: report counts but don't fail unless explicitly desired
    console.log(`Console errors: ${consoleErrors.length}, Page errors: ${pageErrors.length}`);
  });
});


