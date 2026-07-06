/**
 * HRX Fieldglass Sync — HRX-page bridge.
 *
 * Injected into the HRX web app (see manifest matches). Lets the in-app
 * "Sync Sodexo" button trigger the extension without knowing the
 * extension's id: the page posts a window message, this script relays it
 * to the background worker, and progress flows back the same way.
 *
 * Protocol (all messages carry `__hrxFgSync: true`):
 *   page → bridge : HRX_FG_SYNC_PING   → bridge replies READY
 *   page → bridge : HRX_FG_SYNC_START  → background runs Sync Sodexo,
 *                   bridge replies HRX_FG_SYNC_ACK {started, count?, reason?}
 *   bridge → page : HRX_FG_SYNC_PROGRESS {progress} — forwarded from
 *                   chrome.storage.session's fgSyncProgress as it updates.
 */

function post(data) {
  window.postMessage({ __hrxFgSync: true, ...data }, window.location.origin);
}

// Announce presence so the button can render enabled.
post({ type: 'HRX_FG_SYNC_READY' });

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__hrxFgSync !== true) return;
  if (e.data.type === 'HRX_FG_SYNC_PING') {
    post({ type: 'HRX_FG_SYNC_READY' });
    return;
  }
  if (e.data.type === 'HRX_FG_SYNC_START') {
    try {
      chrome.runtime.sendMessage({ type: 'fg_sync_sodexo' }, (resp) => {
        if (chrome.runtime.lastError) {
          post({
            type: 'HRX_FG_SYNC_ACK',
            started: false,
            reason: chrome.runtime.lastError.message,
          });
          return;
        }
        post({ type: 'HRX_FG_SYNC_ACK', ...(resp || {}) });
      });
    } catch (err) {
      post({ type: 'HRX_FG_SYNC_ACK', started: false, reason: String(err) });
    }
  }
});

// Forward live progress (requires the background worker to have called
// chrome.storage.session.setAccessLevel for untrusted contexts).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.fgSyncProgress) return;
  post({ type: 'HRX_FG_SYNC_PROGRESS', progress: changes.fgSyncProgress.newValue });
});
