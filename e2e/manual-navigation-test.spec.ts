import { test, expect } from '@playwright/test';

test('Reproduce exact navigation flow with hard refresh', async ({ page }) => {
  const results: string[] = [];
  
  results.push('=== NAVIGATION FLOW TEST ===\n');
  
  // Step 1: Open the specific account URL (/accounts/:id)
  results.push('Step 1: Opening http://localhost:3000/accounts/gdfPXsnAvAr0hWA56555');
  await page.goto('http://localhost:3000/accounts/gdfPXsnAvAr0hWA56555');
  await page.waitForLoadState('networkidle');
  
  const initialUrl = page.url();
  const initialHeading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'No heading found');
  results.push(`  URL: ${initialUrl}`);
  results.push(`  Heading: ${initialHeading}`);
  results.push('');
  
  // Step 2: Perform hard refresh
  results.push('Step 2: Performing hard refresh (Cmd+Shift+R)');
  await page.reload({ waitUntil: 'networkidle' });
  
  const afterRefreshUrl = page.url();
  const afterRefreshHeading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'No heading found');
  results.push(`  URL: ${afterRefreshUrl}`);
  results.push(`  Heading: ${afterRefreshHeading}`);
  results.push('');
  
  // Capture console messages
  const consoleMessages: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  
  // Wait a bit for page to settle
  await page.waitForTimeout(1000);
  
  // Step 3: Click Inbox in main nav
  results.push('Step 3: Clicking main nav "Inbox"');
  
  // Try to find and click Inbox link
  const inboxLink = page.locator('nav a:has-text("Inbox"), a:has-text("Inbox")').first();
  await inboxLink.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  
  const afterInboxUrl = page.url();
  const afterInboxHeading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'No heading found');
  const afterInboxContent = await page.locator('main, [role="main"], body').first().textContent().catch(() => '');
  
  results.push(`  URL: ${afterInboxUrl}`);
  results.push(`  Heading: ${afterInboxHeading}`);
  results.push(`  Content changed: ${afterInboxContent !== await page.locator('main, [role="main"], body').first().textContent().catch(() => '')}`);
  results.push('');
  
  // Step 4: Click Companies in main nav
  results.push('Step 4: Clicking main nav "Companies"');
  
  const companiesLink = page.locator('nav a:has-text("Companies"), a:has-text("Companies")').first();
  await companiesLink.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  
  const afterCompaniesUrl = page.url();
  const afterCompaniesHeading = await page.locator('h1, h2, [role="heading"]').first().textContent().catch(() => 'No heading found');
  const afterCompaniesContent = await page.locator('main, [role="main"], body').first().textContent().catch(() => '');
  
  results.push(`  URL: ${afterCompaniesUrl}`);
  results.push(`  Heading: ${afterCompaniesHeading}`);
  results.push(`  Content changed from Inbox: ${afterCompaniesContent !== afterInboxContent}`);
  results.push('');
  
  // Step 5: Capture any console errors/warnings
  if (consoleMessages.length > 0) {
    results.push('Console Messages:');
    consoleMessages.forEach(msg => results.push(`  ${msg}`));
    results.push('');
  }
  
  // Step 6: Analysis
  results.push('=== ANALYSIS ===');
  
  let allPass = true;
  
  // Check if URL changed but content didn't for Inbox click
  if (afterInboxUrl !== afterRefreshUrl && afterInboxHeading === afterRefreshHeading) {
    results.push('❌ FAIL: Inbox click changed URL but content did not update');
    results.push(`  Expected: Content to change when URL changed from ${afterRefreshUrl} to ${afterInboxUrl}`);
    results.push(`  Actual: Heading remained "${afterInboxHeading}"`);
    allPass = false;
  } else if (afterInboxUrl === afterRefreshUrl) {
    results.push('⚠️  WARNING: Inbox click did not change URL');
  } else {
    results.push('✓ PASS: Inbox click changed URL and content');
  }
  
  // Check if URL changed but content didn't for Companies click
  if (afterCompaniesUrl !== afterInboxUrl && afterCompaniesHeading === afterInboxHeading) {
    results.push('❌ FAIL: Companies click changed URL but content did not update');
    results.push(`  Expected: Content to change when URL changed from ${afterInboxUrl} to ${afterCompaniesUrl}`);
    results.push(`  Actual: Heading remained "${afterCompaniesHeading}"`);
    allPass = false;
  } else if (afterCompaniesUrl === afterInboxUrl) {
    results.push('⚠️  WARNING: Companies click did not change URL');
  } else {
    results.push('✓ PASS: Companies click changed URL and content');
  }
  
  results.push('');
  results.push(`=== OVERALL: ${allPass ? 'PASS' : 'FAIL'} ===`);
  
  // Print all results
  console.log('\n' + results.join('\n') + '\n');
  
  // Take a final screenshot
  await page.screenshot({ path: 'test-results/navigation-flow-final.png', fullPage: true });
  
  // Fail the test if we detected issues
  if (!allPass) {
    throw new Error('Navigation flow test failed - see console output for details');
  }
});
