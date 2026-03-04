import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Account Detail Navigation Flow Test', () => {
  test('reproduce exact flow: account detail -> hard refresh -> inbox -> companies', async ({ page }) => {
    const timeline: Array<{
      step: string;
      url: string;
      heading: string;
      contentChanged: boolean;
      consoleErrors: string[];
      consoleWarnings: string[];
      timestamp: string;
    }> = [];

    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    // Capture console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        consoleErrors.push(text);
      } else if (type === 'warning') {
        consoleWarnings.push(text);
      }
    });

    console.log('\n=== STARTING NAVIGATION FLOW TEST ===\n');

    // Step 0: Login first
    console.log('STEP 0: Login');
    await page.goto('/login');
    await login(page, process.env.E2E_EMAIL || 'g.fielding@c1staffing.com', process.env.E2E_PASSWORD || 'icsttoT3');
    console.log('  Login completed');

    // Clear console logs from login
    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    // Step 1: Navigate to account detail page (/accounts/:id)
    console.log('\nSTEP 1: Navigate to http://localhost:3000/accounts/gdfPXsnAvAr0hWA56555');
    await page.goto('http://localhost:3000/accounts/gdfPXsnAvAr0hWA56555');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Let page settle

    const step1Url = page.url();
    // Try multiple heading selectors
    const step1Heading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    
    console.log(`  URL: ${step1Url}`);
    console.log(`  Heading: ${step1Heading}`);
    console.log(`  Console Errors: ${consoleErrors.length}`);
    console.log(`  Console Warnings: ${consoleWarnings.length}`);

    timeline.push({
      step: '1. Initial Navigation',
      url: step1Url,
      heading: step1Heading,
      contentChanged: true,
      consoleErrors: [...consoleErrors],
      consoleWarnings: [...consoleWarnings],
      timestamp: new Date().toISOString()
    });

    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    // Step 2: Hard refresh (Cmd+Shift+R equivalent)
    console.log('\nSTEP 2: Perform hard refresh (bypass cache)');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Let page settle

    const step2Url = page.url();
    const step2Heading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    const step2ContentChanged = step2Heading !== step1Heading;

    console.log(`  URL: ${step2Url}`);
    console.log(`  Heading: ${step2Heading}`);
    console.log(`  Content Changed: ${step2ContentChanged}`);
    console.log(`  Console Errors: ${consoleErrors.length}`);
    console.log(`  Console Warnings: ${consoleWarnings.length}`);

    timeline.push({
      step: '2. Hard Refresh',
      url: step2Url,
      heading: step2Heading,
      contentChanged: step2ContentChanged,
      consoleErrors: [...consoleErrors],
      consoleWarnings: [...consoleWarnings],
      timestamp: new Date().toISOString()
    });

    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    // Step 3: Click main nav Inbox
    console.log('\nSTEP 3: Click main nav "Inbox"');
    
    // Try multiple selectors to find Inbox link
    const inboxSelector = 'nav a[href*="inbox"], nav a:has-text("Inbox"), [role="navigation"] a:has-text("Inbox"), a:has-text("Inbox")';
    
    const inboxLink = page.locator(inboxSelector).first();
    await expect(inboxLink).toBeVisible({ timeout: 5000 });
    
    const beforeInboxUrl = page.url();
    const beforeInboxHeading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    
    await inboxLink.click();
    await page.waitForTimeout(2000); // Let page settle
    
    const step3Url = page.url();
    const step3Heading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    const step3ContentChanged = step3Heading !== beforeInboxHeading;

    console.log(`  Before Click - URL: ${beforeInboxUrl}`);
    console.log(`  Before Click - Heading: ${beforeInboxHeading}`);
    console.log(`  After Click - URL: ${step3Url}`);
    console.log(`  After Click - Heading: ${step3Heading}`);
    console.log(`  Content Changed: ${step3ContentChanged}`);
    console.log(`  URL Changed: ${step3Url !== beforeInboxUrl}`);
    console.log(`  Console Errors: ${consoleErrors.length}`);
    console.log(`  Console Warnings: ${consoleWarnings.length}`);

    timeline.push({
      step: '3. Click Inbox',
      url: step3Url,
      heading: step3Heading,
      contentChanged: step3ContentChanged,
      consoleErrors: [...consoleErrors],
      consoleWarnings: [...consoleWarnings],
      timestamp: new Date().toISOString()
    });

    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    // Step 4: Click main nav Companies
    console.log('\nSTEP 4: Click main nav "Companies"');
    
    const companiesSelector = 'nav a[href*="companies"], nav a:has-text("Companies"), [role="navigation"] a:has-text("Companies"), a:has-text("Companies")';
    
    const companiesLink = page.locator(companiesSelector).first();
    await expect(companiesLink).toBeVisible({ timeout: 5000 });
    
    const beforeCompaniesUrl = page.url();
    const beforeCompaniesHeading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    
    await companiesLink.click();
    await page.waitForTimeout(2000); // Let page settle
    
    const step4Url = page.url();
    const step4Heading = await page.locator('h1, h2, h3, [role="heading"]').first().textContent({ timeout: 5000 }).catch(() => 'NO_HEADING_FOUND');
    const step4ContentChanged = step4Heading !== beforeCompaniesHeading;

    console.log(`  Before Click - URL: ${beforeCompaniesUrl}`);
    console.log(`  Before Click - Heading: ${beforeCompaniesHeading}`);
    console.log(`  After Click - URL: ${step4Url}`);
    console.log(`  After Click - Heading: ${step4Heading}`);
    console.log(`  Content Changed: ${step4ContentChanged}`);
    console.log(`  URL Changed: ${step4Url !== beforeCompaniesUrl}`);
    console.log(`  Console Errors: ${consoleErrors.length}`);
    console.log(`  Console Warnings: ${consoleWarnings.length}`);

    timeline.push({
      step: '4. Click Companies',
      url: step4Url,
      heading: step4Heading,
      contentChanged: step4ContentChanged,
      consoleErrors: [...consoleErrors],
      consoleWarnings: [...consoleWarnings],
      timestamp: new Date().toISOString()
    });

    // Generate detailed report
    console.log('\n=== DETAILED TIMELINE REPORT ===\n');
    
    timeline.forEach((entry, index) => {
      console.log(`\n--- ${entry.step} ---`);
      console.log(`URL: ${entry.url}`);
      console.log(`Heading/Title: ${entry.heading}`);
      console.log(`Content Changed: ${entry.contentChanged}`);
      console.log(`Timestamp: ${entry.timestamp}`);
      
      if (entry.consoleErrors.length > 0) {
        console.log(`Console Errors (${entry.consoleErrors.length}):`);
        entry.consoleErrors.forEach(err => console.log(`  - ${err}`));
      }
      
      if (entry.consoleWarnings.length > 0) {
        console.log(`Console Warnings (${entry.consoleWarnings.length}):`);
        entry.consoleWarnings.forEach(warn => console.log(`  - ${warn}`));
      }
    });

    // Analysis
    console.log('\n=== PASS/FAIL ANALYSIS ===\n');
    
    const issues: string[] = [];
    
    // Check Step 3: Inbox click
    const step3Entry = timeline[2];
    const urlChangedInbox = step3Entry.url !== timeline[1].url;
    const contentChangedInbox = step3Entry.contentChanged;
    
    if (urlChangedInbox && !contentChangedInbox) {
      issues.push('STEP 3 (Inbox): URL changed but content did NOT change - FAIL');
      console.log('❌ STEP 3 (Inbox): URL changed but content did NOT change - FAIL');
    } else if (urlChangedInbox && contentChangedInbox) {
      console.log('✅ STEP 3 (Inbox): URL and content both changed - PASS');
    } else if (!urlChangedInbox) {
      console.log('⚠️  STEP 3 (Inbox): URL did not change');
    }
    
    // Check Step 4: Companies click
    const step4Entry = timeline[3];
    const urlChangedCompanies = step4Entry.url !== timeline[2].url;
    const contentChangedCompanies = step4Entry.contentChanged;
    
    if (urlChangedCompanies && !contentChangedCompanies) {
      issues.push('STEP 4 (Companies): URL changed but content did NOT change - FAIL');
      console.log('❌ STEP 4 (Companies): URL changed but content did NOT change - FAIL');
    } else if (urlChangedCompanies && contentChangedCompanies) {
      console.log('✅ STEP 4 (Companies): URL and content both changed - PASS');
    } else if (!urlChangedCompanies) {
      console.log('⚠️  STEP 4 (Companies): URL did not change');
    }
    
    // Check for console errors at critical steps
    if (step3Entry.consoleErrors.length > 0) {
      issues.push(`STEP 3 (Inbox): ${step3Entry.consoleErrors.length} console error(s) detected`);
      console.log(`⚠️  STEP 3 (Inbox): ${step3Entry.consoleErrors.length} console error(s) detected`);
    }
    
    if (step4Entry.consoleErrors.length > 0) {
      issues.push(`STEP 4 (Companies): ${step4Entry.consoleErrors.length} console error(s) detected`);
      console.log(`⚠️  STEP 4 (Companies): ${step4Entry.consoleErrors.length} console error(s) detected`);
    }
    
    console.log('\n=== SUMMARY ===\n');
    if (issues.length === 0) {
      console.log('✅ ALL CHECKS PASSED - Navigation flow working correctly');
    } else {
      console.log('❌ ISSUES DETECTED:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    console.log('\n=== END OF REPORT ===\n');
    
    // Fail test if issues found
    if (issues.length > 0) {
      throw new Error(`Navigation flow has ${issues.length} issue(s):\n${issues.join('\n')}`);
    }
  });
});
