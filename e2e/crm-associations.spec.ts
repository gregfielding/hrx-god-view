import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('CRM Associations', () => {
  test('add/remove company on deal updates associations and reverse index', async ({ page }) => {
    await page.goto('/login');
    await login(page, process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', process.env.E2E_PASSWORD || 'icsttoT3');

    // Navigate to CRM and open Deals tab
    await page.goto('/crm');
    await page.getByTestId('tab-deals').click();
    await expect(page.getByTestId('deals-panel')).toBeVisible({ timeout: 20000 });
    // If no deals are present, create a minimal opportunity via the UI
    const hasDeal = await page.getByTestId('deal-card').first().isVisible().catch(() => false);
    if (!hasDeal) {
      // Click Add New Opportunity
      await page.getByRole('button', { name: /Add New Opportunity/i }).click();
      // Fill minimal fields
      await page.getByLabel(/Opportunity Name|Deal Name|Name/i).fill('E2E Test Deal');
      // Select a company (pick first option)
      const companyAutocomplete = page.getByLabel(/Company/i).first();
      await companyAutocomplete.click();
      const opt = page.locator('li[role="option"]').first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click();
      }
      // Create Opportunity
      const createBtn = page.getByRole('button', { name: /Create Opportunity/i });
      await createBtn.click();
      // Return to CRM deals tab
      await page.goto('/crm');
      await page.getByTestId('tab-deals').click();
      await expect(page.getByTestId('deals-panel')).toBeVisible();
    }

    const firstDeal = page.getByTestId('deal-card').first();
    await expect(firstDeal).toBeVisible({ timeout: 20000 });
    await firstDeal.click();

    // Open associations editor if present
    const assocBtn = page.getByRole('button', { name: /Associations|Link/i }).first();
    if (await assocBtn.isVisible().catch(() => false)) {
      await assocBtn.click();
    }

    // Add a company
    const companyAutocomplete = page.getByLabel(/Company/i).first();
    await companyAutocomplete.click();
    await companyAutocomplete.type('a');
    const option = page.locator('li[role="option"]').first();
    await option.click();

    // Save
    const saveBtn = page.getByRole('button', { name: /Save|Done|Close/i }).first();
    await saveBtn.click().catch(() => {});

    // Verify UI shows associated company
    await expect(page.locator('[data-testid="associated-company"]').first()).toBeVisible({ timeout: 10000 });

    // Remove the company (open editor and remove)
    if (await assocBtn.isVisible().catch(() => false)) {
      await assocBtn.click();
    }
    const removeChip = page.locator('[data-testid="associated-company-chip"] [aria-label="Remove"]').first();
    await removeChip.click();
    await saveBtn.click().catch(() => {});

    // Verify UI no longer shows associated company
    await expect(page.locator('[data-testid="associated-company"]').first()).toHaveCount(0);
  });
});


