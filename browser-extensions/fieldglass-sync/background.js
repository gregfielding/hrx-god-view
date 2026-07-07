/**
 * HRX Fieldglass Sync — background service worker.
 *
 * Owns all network work:
 *   - Ingest: POST a captured page's text to fieldglassEnrichmentIngest.
 *   - Bulk sync: pull the pending list from fieldglassEnrichmentQueue (or
 *     a link list scanned from the current tab), fetch each detail page
 *     with the user's live Fieldglass session cookies, and ingest each —
 *     paced at ~1.5s per order so 60 orders take ~2 minutes.
 *
 * Login detection: a fetch that lands on a login page (no SDXOJP id in
 * the HTML) aborts the run with a "log in to Fieldglass first" message.
 *
 * Progress lives in chrome.storage.session so the popup can close and
 * reopen mid-run without losing the log. Badge shows the session total.
 */

const DEFAULTS = {
  baseUrl: 'https://us-central1-hrx1-d3beb.cloudfunctions.net',
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  extensionKey: '',
  worklistUrl: 'https://us.fieldglass.cloud.sap/job_posting_list.do?cl=1',
};

// Let the HRX-page bridge (hrx-bridge.js content script) observe
// fgSyncProgress via chrome.storage.onChanged.
if (chrome.storage.session && chrome.storage.session.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
}

let sessionSynced = 0;
/** postingId → timestamp of last successful passive capture (dedupe). */
const recentCaptures = new Map();
let bulkRunning = false;

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function setProgress(progress) {
  await chrome.storage.session.set({ fgSyncProgress: progress });
}

async function appendLog(line) {
  const { fgSyncProgress } = await chrome.storage.session.get('fgSyncProgress');
  const p = fgSyncProgress || { running: false, log: [] };
  p.log = [...(p.log || []).slice(-199), line];
  await chrome.storage.session.set({ fgSyncProgress: p });
}

function setBadge() {
  chrome.action.setBadgeText({ text: sessionSynced > 0 ? String(sessionSynced) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#8B5CF6' });
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim();
}

async function ingest(config, { text, url, postingId }) {
  const resp = await fetch(`${config.baseUrl}/fieldglassEnrichmentIngest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.extensionKey}`,
    },
    body: JSON.stringify({
      tenantId: config.tenantId,
      pageText: text,
      url,
      ...(postingId ? { postingId } : {}),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.success) {
    const message = (data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data;
}

async function fetchQueue(config) {
  const resp = await fetch(
    `${config.baseUrl}/fieldglassEnrichmentQueue?tenantId=${encodeURIComponent(config.tenantId)}`,
    { headers: { Authorization: `Bearer ${config.extensionKey}` } },
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.success) {
    const message = (data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data.pending || [];
}

/** Tabs opened by the bulk runner — the passive-capture handler ignores
 *  these so each order isn't ingested twice. */
const bulkTabs = new Set();

/**
 * Wait for a tab to finish loading by POLLING chrome.tabs.get — not a
 * bare onUpdated listener. MV3 service workers are killed after ~30s
 * without extension-API activity, and the first live 5-order run froze
 * at 0/5 exactly that way (silent 25s listener wait → worker death →
 * run gone, progress frozen). Each poll call resets Chrome's idle
 * timer, keeping the worker alive through the whole bulk run.
 */
async function waitTabComplete(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete') return;
    } catch (e) {
      return; // tab closed underneath us
    }
    await sleep(1000);
  }
}

/**
 * Fieldglass detail pages are JavaScript-rendered — a plain fetch() gets
 * an empty shell (first live bulk run failed with NO_ORDER_ON_PAGE,
 * 2026-07-07). So bulk mode opens each order in a real background tab,
 * lets SAP's JS render it, reads the text via the content script, and
 * closes the tab. Same proven path as passive capture, just automated.
 */
async function captureDetailPageViaTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  bulkTabs.add(tab.id);
  try {
    await waitTabComplete(tab.id, 25000);
    let lastText = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(1500);
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'fg_get_page_text' });
        lastText = (resp && resp.text) || '';
        if (/SDXOJP\d{6,}/.test(lastText)) return lastText;
      } catch (e) {
        // content script not injected yet — keep polling
      }
    }
    const looksLikeLogin = /sign\s*in|log\s*in|password/i.test(lastText.slice(0, 3000));
    const err = new Error(looksLikeLogin ? 'LOGIN_REQUIRED' : 'NO_ORDER_ON_PAGE');
    err.code = looksLikeLogin ? 'LOGIN_REQUIRED' : 'NO_ORDER_ON_PAGE';
    throw err;
  } finally {
    bulkTabs.delete(tab.id);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // tab already gone
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function postingIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get('id') || url;
  } catch (e) {
    return url;
  }
}

/** Open (or reuse) a Fieldglass tab on the worklist URL and collect all
 *  job_posting_detail.do links via the content script. Returns
 *  { links, tabId } — empty links when the page is a login wall. */
async function openWorklistAndCollectLinks(worklistUrl) {
  // Reuse an existing Fieldglass tab when there is one (keeps the
  // recruiter's logged-in navigation intact); otherwise open one.
  const existing = await chrome.tabs.query({ url: 'https://*.fieldglass.cloud.sap/*' });
  let tab;
  if (existing.length > 0) {
    tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    tab = await chrome.tabs.create({ url: worklistUrl, active: true });
    // Wait for the page to finish loading (up to ~20s).
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 20000);
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(2000); // settle XHR-rendered lists
  }

  // Ask the content script for links; retry briefly (script may still be
  // injecting on a fresh tab).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'fg_collect_links' });
      return { links: (resp && resp.links) || [], tabId: tab.id };
    } catch (e) {
      await sleep(1500);
    }
  }
  return { links: [], tabId: tab.id };
}

/** "Sync Sodexo" — one click from HRX. Merge the HRX pending queue with
 *  whatever orders are linked on the recruiter's Fieldglass worklist,
 *  then bulk-sync the lot. */
async function syncSodexo(sendResponse) {
  const config = await getConfig();
  if (!config.extensionKey) {
    sendResponse({ started: false, reason: 'Extension key not configured (extension options).' });
    return;
  }

  let queueItems = [];
  try {
    const pending = await fetchQueue(config);
    queueItems = pending
      .filter((p) => p.detailUrl)
      .map((p) => ({ url: p.detailUrl, postingId: p.postingId, label: p.title || p.postingId }));
  } catch (err) {
    await appendLog(`✗ HRX queue fetch failed: ${err.message || err}`);
  }

  const { links } = await openWorklistAndCollectLinks(config.worklistUrl);

  const seen = new Set(queueItems.map((i) => postingIdFromUrl(i.url)));
  const scanned = links
    .filter((url) => !seen.has(postingIdFromUrl(url)))
    .map((url) => ({ url, label: url.slice(-24) }));

  const items = [...queueItems, ...scanned];
  if (items.length === 0) {
    const reason =
      'No orders found — if the Fieldglass tab shows a login page, log in and click Sync Sodexo again.';
    await appendLog(reason);
    await setProgress({ running: false, total: 0, done: 0, log: [reason], summary: { ok: 0, failed: 0 } });
    sendResponse({ started: false, reason });
    return;
  }
  sendResponse({ started: true, count: items.length });
  await runBulk(items);
}

/** items: [{url, postingId?, label}] */
async function runBulk(items) {
  if (bulkRunning) return;
  bulkRunning = true;
  const config = await getConfig();
  const summary = { ok: 0, failed: 0, competitorFlags: 0 };
  await setProgress({ running: true, total: items.length, done: 0, log: [] });
  try {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const label = item.label || item.postingId || item.url;
      try {
        // Hard per-item cap — one unresponsive page must never stall the run.
        const text = await Promise.race([
          captureDetailPageViaTab(item.url),
          sleep(75000).then(() => {
            const err = new Error('ITEM_TIMEOUT');
            err.code = 'ITEM_TIMEOUT';
            throw err;
          }),
        ]);
        const result = await ingest(config, {
          text,
          url: item.url,
          postingId: item.postingId,
        });
        summary.ok += 1;
        sessionSynced += 1;
        setBadge();
        const flag = result.candidateInMind ? ' ⚠ candidate-in-mind' : '';
        if (result.candidateInMind) summary.competitorFlags += 1;
        await appendLog(`✓ ${result.postingId || label}${flag}`);
      } catch (err) {
        if (err && err.code === 'LOGIN_REQUIRED') {
          await appendLog('✗ Fieldglass session expired — log in to Fieldglass, then run again.');
          summary.failed += items.length - i;
          break;
        }
        summary.failed += 1;
        await appendLog(`✗ ${label}: ${err.message || err}`);
      }
      const { fgSyncProgress } = await chrome.storage.session.get('fgSyncProgress');
      await setProgress({ ...(fgSyncProgress || {}), running: true, total: items.length, done: i + 1 });
      if (i < items.length - 1) await sleep(1500);
    }
  } finally {
    const { fgSyncProgress } = await chrome.storage.session.get('fgSyncProgress');
    await setProgress({
      ...(fgSyncProgress || {}),
      running: false,
      summary,
      finishedAt: Date.now(),
    });
    bulkRunning = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Passive capture from the content script — dedupe per posting per hour.
  if (msg && msg.type === 'fg_page_capture') {
    // Tabs the bulk runner opened ingest through runBulk directly —
    // ignore their auto-capture so orders aren't ingested twice.
    if (sender && sender.tab && bulkTabs.has(sender.tab.id)) return false;
    (async () => {
      const idMatch = /SDXOJP\d{6,}/.exec(msg.text || '');
      const postingId = idMatch ? idMatch[0] : null;
      if (postingId) {
        const last = recentCaptures.get(postingId) || 0;
        if (Date.now() - last < 60 * 60 * 1000) return;
        recentCaptures.set(postingId, Date.now());
      }
      const config = await getConfig();
      if (!config.extensionKey) return; // not configured yet — stay silent
      try {
        const result = await ingest(config, { text: msg.text, url: msg.url });
        sessionSynced += 1;
        setBadge();
        await appendLog(
          `✓ viewed ${result.postingId}${result.candidateInMind ? ' ⚠ candidate-in-mind' : ''}`,
        );
      } catch (err) {
        if (postingId) recentCaptures.delete(postingId); // allow retry
        await appendLog(`✗ auto-sync ${postingId || ''}: ${err.message || err}`);
      }
    })();
    return false;
  }

  // Popup: bulk over the HRX pending queue.
  if (msg && msg.type === 'fg_bulk_queue') {
    (async () => {
      try {
        const config = await getConfig();
        const pending = await fetchQueue(config);
        const items = pending
          .filter((p) => p.detailUrl)
          .map((p) => ({
            url: p.detailUrl,
            postingId: p.postingId,
            label: p.title || p.postingId,
          }));
        const skipped = pending.length - items.length;
        if (skipped > 0) {
          await appendLog(`${skipped} pending order(s) have no deep link — open those manually.`);
        }
        if (items.length === 0) {
          await setProgress({ running: false, total: 0, done: 0, log: [], summary: { ok: 0, failed: 0 } });
          sendResponse({ started: false, reason: 'Nothing pending with a deep link.' });
          return;
        }
        sendResponse({ started: true, count: items.length });
        await runBulk(items);
      } catch (err) {
        await appendLog(`✗ queue fetch failed: ${err.message || err}`);
        sendResponse({ started: false, reason: String(err.message || err) });
      }
    })();
    return true; // async sendResponse
  }

  // HRX page bridge (hrx-bridge.js) — the "Sync Sodexo" button.
  if (msg && msg.type === 'fg_sync_sodexo') {
    (async () => {
      try {
        await syncSodexo(sendResponse);
      } catch (err) {
        await appendLog(`✗ Sync Sodexo failed: ${err.message || err}`);
        sendResponse({ started: false, reason: String(err.message || err) });
      }
    })();
    return true;
  }

  // Popup: bulk over links scanned from the active tab.
  if (msg && msg.type === 'fg_bulk_links') {
    (async () => {
      const items = (msg.links || []).map((url) => ({ url, label: url.slice(-24) }));
      if (items.length === 0) {
        sendResponse({ started: false, reason: 'No order links on this page.' });
        return;
      }
      sendResponse({ started: true, count: items.length });
      await runBulk(items);
    })();
    return true;
  }

  return false;
});
