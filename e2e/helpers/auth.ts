import { Page, expect } from '@playwright/test';

export async function login(page: Page, email: string, password: string) {
  // Try a few common entry points
  await page.goto('/login').catch(() => {});
  if (page.url().endsWith('/')) {
    // look for a login link/button on home
    const maybeLogin = page.getByRole('link', { name: /login|sign in/i }).first();
    if (await maybeLogin.isVisible().catch(() => false)) {
      await maybeLogin.click();
    }
  }

  // Fill email
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await emailInput.fill(email);

  // Fill password
  const pwInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();
  await pwInput.fill(password);

  // Submit
  const submit = page.getByRole('button', { name: /sign in|log in|login|continue|submit/i }).first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await pwInput.press('Enter');
  }

  // Wait for redirect or authenticated UI hints
  await Promise.race([
    page.waitForURL(/^(?!.*\/login$).*/, { timeout: 20000 }),
    page.getByRole('heading', { name: /Welcome to the HRX Dashboard/i }).waitFor({ state: 'visible', timeout: 20000 }),
    page.getByRole('link', { name: /Customers/i }).waitFor({ state: 'visible', timeout: 20000 }),
    page.getByRole('button', { name: /Log out/i }).waitFor({ state: 'visible', timeout: 20000 }),
  ]);
}


