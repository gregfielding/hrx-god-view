# SPA Navigation Validation - Quick Checklist
**Date:** March 3, 2026  
**Test URL:** http://localhost:3000/recruiter/accounts/gdfPXsnAvAr0hWA56555

---

## Setup (30 seconds)
1. ✅ Dev server running on port 3000
2. Open Chrome/Firefox DevTools (F12)
3. **Console Tab:** Monitor for `[nav-parity]` warnings
4. **Network Tab:** Enable "Preserve log" + Filter by "Doc"
5. Navigate to: http://localhost:3000/recruiter/accounts/gdfPXsnAvAr0hWA56555
6. Login: `g.fielding@c1staffing.com` / `icsttoT3`
7. Clear Network tab after login completes

---

## Test Execution (2 minutes)

### Step 1: Verify Canonical URL Redirect
- [ ] Initial URL: `/recruiter/accounts/gdfPXsnAvAr0hWA56555`
- [ ] After render, URL becomes: `/accounts/gdfPXsnAvAr0hWA56555`
- **Result:** ☐ PASS ☐ FAIL

---

### Step 2: Navigation Tests (4 routes)

| # | Click Navigation Item | Expected URL | Shell Persists? | Warnings? | Result |
|---|-----------------------|--------------|-----------------|-----------|--------|
| 1 | **Inbox** (sidebar)   | `/inbox`     | ☐ Yes ☐ No     | ☐ 0 ☐ N   | ☐ PASS ☐ FAIL |
| 2 | **Companies** (sidebar) | `/companies` | ☐ Yes ☐ No     | ☐ 0 ☐ N   | ☐ PASS ☐ FAIL |
| 3 | **Contacts** (sidebar) | `/contacts`  | ☐ Yes ☐ No     | ☐ 0 ☐ N   | ☐ PASS ☐ FAIL |
| 4 | **Slack** (top bar)   | `/slack`     | ☐ Yes ☐ No     | ☐ 0 ☐ N   | ☐ PASS ☐ FAIL |

**What to verify for each:**
- ✅ Content changes but sidebar/topbar stay visible
- ✅ No white flash (full page reload)
- ✅ No new HTML doc request in Network tab
- ✅ Console shows 0 `[nav-parity]` warnings

---

### Step 3: Browser Back/Forward Tests

#### Back Button Test
1. Click browser **Back** button (or `Cmd+[`)
2. **Verify:**
   - [ ] Previous route content loads
   - [ ] Shell (sidebar + top bar) persists
   - [ ] No full page reload in Network tab
   - [ ] No `[nav-parity]` warnings

**Result:** ☐ PASS ☐ FAIL

#### Forward Button Test
1. Click browser **Forward** button (or `Cmd+]`)
2. **Verify:**
   - [ ] Next route content loads
   - [ ] Shell persists
   - [ ] No full page reload
   - [ ] No `[nav-parity]` warnings

**Result:** ☐ PASS ☐ FAIL

---

## Quick Results Summary

```
NAVIGATION TESTS:          ___/4 PASS
BACK/FORWARD TESTS:        ___/2 PASS
TOTAL:                     ___/6 PASS

[nav-parity] WARNING COUNT: ___

OVERALL STATUS: ☐ PASS  ☐ FAIL
```

---

## Pass/Fail Criteria

### ✅ PASS (Expected Behavior)
- Content updates instantly without white flash
- Sidebar and top bar remain mounted (no flicker)
- URL updates correctly in address bar
- Network tab shows NO new HTML document requests
- Console shows 0 `[nav-parity]` warnings

### ❌ FAIL (Indicates Issue)
- Full page reload (white flash, screen blink)
- New HTML document request in Network tab (Type: "document")
- Sidebar/top bar disappears and reappears
- Console shows `[nav-parity]` warning:
  ```
  [nav-parity] { browserPath: '/inbox', routerPath: '/contacts' }
  ```

---

## Issues Found

### Critical Issues (Full Page Reloads)
```
Route: _______________________________________
Evidence: _____________________________________
```

### Warnings (`[nav-parity]` in Console)
```
Count: ___
Routes affected: ______________________________
Example: ______________________________________
```

---

## Notes
- **Implementation:** React Router v6 SPA with `navigateSafe()` wrapper
- **Parity Check:** Dev-only guard in `Layout.tsx:594-610`
- **Expected:** All tests PASS with 0 warnings

---

**Tested By:** _______________  
**Date:** _______________  
**Browser:** _______________
