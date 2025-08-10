import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('CRM CRUD smoke', () => {
  test('navigates to Customers and renders list', async ({ page }) => {
    await page.goto('/');
    await login(page, process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', process.env.E2E_PASSWORD || 'icsttoT3');
    // Navigate to Customers route if link present
    const customersLink = page.getByRole('link', { name: /Customers|Companies|CRM/i }).first();
    if (await customersLink.isVisible().catch(() => false)) {
      await customersLink.click();
    }
    // Verify a common listing container appears (adjust as app-specific selectors become known)
    await expect(page.locator('table, [role="grid"], [data-testid="customers-list"], [data-testid*="list" i]')).toBeVisible({ timeout: 20000 });
  });
});


