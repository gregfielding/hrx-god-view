# SPA Navigation Test - Quick Start

## Run the automated test

```bash
# Make sure dev server is running on localhost:3000
npm start

# In another terminal, run the Playwright test
npm run e2e -- spa-navigation
```

## What the test does

1. ✅ Navigates to `/recruiter/accounts/gdfPXsnAvAr0hWA56555`
2. ✅ Clicks side-nav links: inbox, companies, contacts, slack, tasks, crm
3. ✅ Verifies shell (sidebar + top bar) persists after each click
4. ✅ Checks for full page reloads (FAIL if detected)
5. ✅ Tests browser back/forward buttons
6. ✅ Reports any `[nav-parity]` console warnings

## Expected output

```
🧪 Starting SPA navigation tests...
📧 Testing navigation to /inbox
✅ /inbox navigation PASS
🏢 Testing navigation to /companies
✅ /companies navigation PASS
👤 Testing navigation to /contacts
✅ /contacts navigation PASS
💬 Testing navigation to /slack
✅ /slack navigation PASS
✅ Testing navigation to /tasks
✅ /tasks navigation PASS
💼 Testing navigation to /crm
✅ /crm navigation PASS
⬅️ Testing browser back navigation
✅ Browser back navigation PASS
➡️ Testing browser forward navigation
✅ Browser forward navigation PASS

📊 Test Summary:
  Total navigations: 8 (including back/forward)
  Full page reloads: 0
  [nav-parity] warnings: 0
  Console errors: 0

✅ All SPA navigation tests PASSED
```

## Manual testing (if automated test fails)

Use `SPA_NAVIGATION_TEST_RESULTS.md` for step-by-step manual validation.

## Troubleshooting

- **"Target page closed"**: Dev server not running on localhost:3000
- **Login fails**: Check E2E_EMAIL and E2E_PASSWORD env vars
- **Navigation fails**: Element selectors may need updating
