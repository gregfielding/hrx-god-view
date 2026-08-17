# chrome automation tab throttling

> "claude-in-chrome automation tabs are BACKGROUND tabs (document.hidden) — Chrome throttling starves the HRX SPA (eternal spinners, skeletal sidebar, empty queries); looks exactly like a prod outage but isn't"

Verifying hrxone.com through claude-in-chrome only works reliably when Greg is actively viewing the tab (as during screenshot exchanges). When the automation tab is backgrounded (`document.hidden === true`), Chrome throttles timers/rendering and the HRX SPA half-boots: /users/all spins forever with a skeletal 2-icon sidebar, /crm renders its shell but "No opportunities", typed search inputs appear to clear on remount — all with ZERO console errors and no pending network requests. This perfectly mimics a broken deploy.

**Why:** burned ~20 min on 2026-08-04 chasing a phantom regression (fresh tab reproduced it; Greg's user doc and the deployed bundle hash were both fine). The tell: almost no console output from an app that normally logs constantly, plus `document.hidden === true` via javascript_tool.

**How to apply:** before diagnosing "the deployed app is broken" from automation-tab behavior, check `document.visibilityState` first. For UI verification either (a) verify server-side (replicate the exact Firestore query in a read-only scratch script — conclusive and throttle-proof), or (b) ask Greg to look when he's next in the app. Do NOT front tabs in his real Chrome to defeat throttling — it hijacks his screen mid-work.
