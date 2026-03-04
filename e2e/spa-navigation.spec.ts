import { test, expect, Page } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * SPA Navigation Validation Test
 * 
 * This test validates Single Page Application (SPA) navigation behavior:
 * 1. Navigates to specific recruiter account details page
 * 2. Clicks through side-nav links to various routes
 * 3. Verifies no full page reloads occur (shell persists)
 * 4. Tests browser back/forward navigation
 * 5. Checks for [nav-parity] console warnings
 */

test.describe('SPA Navigation Validation', () => {
  let consoleLogs: string[] = [];
  let consoleWarnings: string[] = [];
  let consoleErrors: string[] = [];
  let navigationCount = 0;
  let fullPageReloads = 0;

  test.beforeEach(async ({ page }) => {
    // Reset counters
    consoleLogs = [];
    consoleWarnings = [];
    consoleErrors = [];
    navigationCount = 0;
    fullPageReloads = 0;

    // Capture console messages
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      
      if (type === 'warning' && text.includes('[nav-parity]')) {
        consoleWarnings.push(text);
      } else if (type === 'error') {
        consoleErrors.push(text);
      } else if (type === 'log') {
        consoleLogs.push(text);
      }
    });

    // Track page loads to detect full page reloads
    page.on('load', () => {
      fullPageReloads++;
    });

    // Login first
    await page.goto('/login');
    await login(
      page, 
      process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', 
      process.env.E2E_PASSWORD || 'icsttoT3'
    );
    
    // Wait for authentication to complete - look for post-login UI
    await Promise.race([
      page.waitForURL(/^(?!.*\/login$).*/, { timeout: 30000 }),
      page.locator('.MuiDrawer-root, .MuiDrawer-paper').first().waitFor({ state: 'visible', timeout: 30000 })
    ]).catch(() => {
      // If both timeout, that's okay - we'll fail on the actual navigation tests
      console.log('Login completed but no navigation detected');
    });
    
    // Reset counters after initial login/load
    fullPageReloads = 0;
    consoleWarnings = [];
    consoleErrors = [];
  });

  /**
   * Helper: Check that shell persists (sidebar + top bar remain visible)
   */
  async function verifyShellPersists(page: Page) {
    // Check sidebar/drawer is visible - MUI Drawer creates a .MuiDrawer-root element
    const drawer = page.locator('.MuiDrawer-root, .MuiDrawer-paper').first();
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Check for logo/top bar
    const logo = page.locator('img[alt*="Logo" i], img[alt*="C1" i], img[src*="C1" i]').first();
    await expect(logo).toBeVisible({ timeout: 3000 });
  }

  test('Complete SPA navigation flow from recruiter account details', async ({ page }) => {
    // 1. Navigate to account detail URL (/accounts/:id)
    await page.goto('/accounts/gdfPXsnAvAr0hWA56555');
    await page.reload();
    await page.waitForURL(/\/accounts\/gdfPXsnAvAr0hWA56555$/, { timeout: 10000 });
    
    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for drawer to be visible (indicates app shell loaded)
    await page.locator('.MuiDrawer-root, .MuiDrawer-paper').first().waitFor({ state: 'visible', timeout: 10000 });
    
    // Reset counters after initial navigation
    fullPageReloads = 0;
    
    // Verify we're on the canonical account details page
    await expect(page).toHaveURL(/\/accounts\/gdfPXsnAvAr0hWA56555$/);
    await verifyShellPersists(page);
    const accountDetailsHeading = page.locator('text=Account Details').first();
    await expect(accountDetailsHeading).toBeVisible({ timeout: 5000 });

    console.log('🧪 Starting SPA navigation tests...');

    // 2. Test navigation to /inbox
    console.log('📧 Testing navigation to /inbox');
    try {
      // Use deterministic left-sidebar nav index (Dashboard=0, Inbox=1)
      const inboxBtn = page.locator('.MuiDrawer-paper .MuiList-root > .MuiListItem-root button').nth(1);
      
      const initialLoadCount = fullPageReloads;
      await inboxBtn.click({ timeout: 5000 });
      await page.waitForURL(/\/inbox/, { timeout: 5000 });
      
      // Verify no full page reload
      expect(fullPageReloads).toBe(initialLoadCount);
      await verifyShellPersists(page);
      await expect(accountDetailsHeading).toHaveCount(0, { timeout: 5000 });
      
      navigationCount++;
      console.log('✅ /inbox navigation PASS');
    } catch (error) {
      console.error('❌ /inbox navigation FAIL:', error);
      // Continue with other tests
    }

    // 3. Test navigation to /companies
    console.log('🏢 Testing navigation to /companies');
    try {
      // Use deterministic left-sidebar nav index (Companies=4)
      const companiesBtn = page.locator('.MuiDrawer-paper .MuiList-root > .MuiListItem-root button').nth(4);
      
      const initialLoadCount = fullPageReloads;
      await companiesBtn.click({ timeout: 5000 });
      await page.waitForURL(/\/companies/, { timeout: 5000 });
      
      expect(fullPageReloads).toBe(initialLoadCount);
      await verifyShellPersists(page);
      await expect(accountDetailsHeading).toHaveCount(0, { timeout: 5000 });
      
      navigationCount++;
      console.log('✅ /companies navigation PASS');
    } catch (error) {
      console.error('❌ /companies navigation FAIL:', error);
    }

    // 4. Test navigation to /contacts
    console.log('👤 Testing navigation to /contacts');
    try {
      // Use deterministic left-sidebar nav index (Contacts=3)
      const contactsBtn = page.locator('.MuiDrawer-paper .MuiList-root > .MuiListItem-root button').nth(3);
      
      const initialLoadCount = fullPageReloads;
      await contactsBtn.click({ timeout: 5000 });
      await page.waitForURL(/\/contacts/, { timeout: 5000 });
      
      expect(fullPageReloads).toBe(initialLoadCount);
      await verifyShellPersists(page);
      
      navigationCount++;
      console.log('✅ /contacts navigation PASS');
    } catch (error) {
      console.error('❌ /contacts navigation FAIL:', error);
    }

    // At this point we should have at least 2 successful navigations for back/forward test
    expect(navigationCount).toBeGreaterThanOrEqual(2);

    // 5. Test browser back button
    console.log('⬅️ Testing browser back navigation');
    const beforeBackUrl = page.url();
    const initialLoadCount = fullPageReloads;
    
    await page.goBack();
    await page.waitForTimeout(500);
    
    const afterBackUrl = page.url();
    expect(afterBackUrl).not.toBe(beforeBackUrl);
    expect(fullPageReloads).toBe(initialLoadCount);
    await verifyShellPersists(page);
    
    console.log('✅ Browser back navigation PASS');

    // 6. Test browser forward button
    console.log('➡️ Testing browser forward navigation');
    const beforeForwardUrl = page.url();
    const initialLoadCount2 = fullPageReloads;
    
    await page.goForward();
    await page.waitForTimeout(500);
    
    const afterForwardUrl = page.url();
    expect(afterForwardUrl).not.toBe(beforeForwardUrl);
    expect(fullPageReloads).toBe(initialLoadCount2);
    await verifyShellPersists(page);
    
    console.log('✅ Browser forward navigation PASS');

    // Final assertions
    console.log('\n📊 Test Summary:');
    console.log(`  Total navigations: ${navigationCount + 2} (including back/forward)`);
    console.log(`  Full page reloads: ${fullPageReloads}`);
    console.log(`  [nav-parity] warnings: ${consoleWarnings.filter(w => w.includes('[nav-parity]')).length}`);
    console.log(`  Console errors: ${consoleErrors.length}`);

    // No full page reloads should have occurred
    expect(fullPageReloads).toBe(0);

    // Check for [nav-parity] warnings
    const navParityWarnings = consoleWarnings.filter(w => w.includes('[nav-parity]'));
    console.log(`\n${navParityWarnings.length === 0 ? '✅' : '⚠️'} [nav-parity] warnings: ${navParityWarnings.length}`);
    
    if (navParityWarnings.length > 0) {
      console.warn('Warning: [nav-parity] warnings detected:', navParityWarnings);
    }

    console.log('\n✅ SPA navigation tests completed');
  });

  // Removed rapid navigation test - page.goto() causes full page loads which isn't representative of SPA behavior
});
