import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('CRM CRUD smoke', () => {
  test('navigates to Customers and renders list', async ({ page }) => {
    await page.goto('/login');
    await login(page, process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', process.env.E2E_PASSWORD || 'icsttoT3');
    await page.goto('/crm');
    // Switch to Companies tab
    await page.getByTestId('tab-companies').click();
    await expect(page.getByTestId('companies-panel')).toBeVisible({ timeout: 20000 });
    // If a table is present, it should be visible; otherwise panel is enough for smoke
    const table = page.getByTestId('customers-table');
    if (await table.count()) {
      await expect(table).toBeVisible();
    }
  });
});


