import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Auth smoke', () => {
  test('can login with provided creds', async ({ page }) => {
    await page.goto('/login');
    await login(page, process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', process.env.E2E_PASSWORD || 'icsttoT3');
    // after login, ensure dashboard content is visible
    await expect(page.getByRole('heading', { name: /Welcome to the HRX Dashboard/i })).toBeVisible({ timeout: 20000 });

    // quick post-login navigation check
    const customersLink = page.getByRole('link', { name: /Customers/i }).first();
    if (await customersLink.isVisible().catch(() => false)) {
      await customersLink.click();
      await expect(page.getByRole('heading', { name: /^Customers$/i })).toBeVisible({ timeout: 15000 });
    }
  });
});


