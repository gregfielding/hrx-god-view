/** HRX Fieldglass Sync — popup UI. All real work happens in background.js. */

const el = (id) => document.getElementById(id);

async function isConfigured() {
  const { extensionKey } = await chrome.storage.sync.get({ extensionKey: '' });
  return Boolean(extensionKey);
}

function renderProgress(p) {
  if (!p) return;
  const bar = el('bar');
  const fill = bar.firstElementChild;
  const log = el('log');
  const status = el('status');

  if (p.total > 0) {
    bar.style.display = 'block';
    fill.style.width = `${Math.round(((p.done || 0) / p.total) * 100)}%`;
  }
  if (p.running) {
    status.textContent = `Syncing ${p.done || 0} / ${p.total}…`;
  } else if (p.summary) {
    const s = p.summary;
    status.textContent =
      `Done — ${s.ok} synced, ${s.failed} failed` +
      (s.competitorFlags ? `, ⚠ ${s.competitorFlags} candidate-in-mind` : '');
  }
  if (p.log && p.log.length) {
    log.style.display = 'block';
    log.textContent = p.log.join('\n');
    log.scrollTop = log.scrollHeight;
  }
}

async function poll() {
  const { fgSyncProgress } = await chrome.storage.session.get('fgSyncProgress');
  renderProgress(fgSyncProgress);
  setTimeout(poll, 600);
}

async function init() {
  const configured = await isConfigured();
  el('unconfigured').style.display = configured ? 'none' : 'block';
  el('syncQueue').disabled = !configured;
  el('scanTab').disabled = !configured;

  el('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  el('syncQueue').addEventListener('click', () => {
    el('status').textContent = 'Fetching pending list from HRX…';
    chrome.runtime.sendMessage({ type: 'fg_bulk_queue' }, (resp) => {
      if (resp && !resp.started) el('status').textContent = resp.reason || 'Nothing to sync.';
      else if (resp) el('status').textContent = `Syncing ${resp.count} order(s)…`;
    });
  });

  el('scanTab').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/fieldglass\.cloud\.sap/.test(tab.url || '')) {
      el('status').textContent = 'Open your Fieldglass job-postings list in this tab first.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'fg_collect_links' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        el('status').textContent = 'Could not read this tab — reload it and try again.';
        return;
      }
      const links = resp.links || [];
      if (links.length === 0) {
        el('status').textContent = resp.isDetailPage
          ? 'This is a single order page — it syncs automatically on view.'
          : 'No order links found on this page.';
        return;
      }
      el('status').textContent = `Syncing ${links.length} order(s) from this page…`;
      chrome.runtime.sendMessage({ type: 'fg_bulk_links', links }, () => {});
    });
  });

  poll();
}

init();
