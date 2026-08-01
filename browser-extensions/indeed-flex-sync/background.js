/**
 * HRX Indeed Flex Sync — background service worker.
 *
 * Receives an assembled capture bundle from the content script and POSTs it
 * to `indeedFlexPortalIngest` with the shared extension key. The badge shows
 * this session's synced-job count; the last result is kept in
 * chrome.storage.session for the popup.
 */

const DEFAULTS = {
  baseUrl: 'https://us-central1-hrx1-d3beb.cloudfunctions.net',
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  extensionKey: '',
};

let sessionSynced = 0;
/** jobId → timestamp of last successful ingest (dedupe across tabs). */
const recent = new Map();

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function setBadge() {
  chrome.action.setBadgeText({ text: sessionSynced > 0 ? String(sessionSynced) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#8B5CF6' });
}

async function setStatus(status) {
  await chrome.storage.session.set({ flexSyncStatus: { ...status, at: Date.now() } });
}

async function ingest(config, envelope) {
  const resp = await fetch(`${config.baseUrl}/indeedFlexPortalIngest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.extensionKey}`,
    },
    body: JSON.stringify({ tenantId: config.tenantId, ...envelope }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.success) {
    const message = (data.error && data.error.message) || `HTTP ${resp.status}`;
    const err = new Error(message);
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function ingestTimesheets(config, envelope) {
  const resp = await fetch(`${config.baseUrl}/indeedFlexTimesheetIngest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.extensionKey}`,
    },
    body: JSON.stringify({ tenantId: config.tenantId, ...envelope }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.success) {
    const message = (data.error && data.error.message) || `HTTP ${resp.status}`;
    const err = new Error(message);
    err.status = resp.status;
    throw err;
  }
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'flex_timesheet_capture' && msg.envelope) {
    (async () => {
      const key = `ts:${msg.envelope.url || ''}`;
      const last = recent.get(key) || 0;
      if (Date.now() - last < 60 * 1000) return;
      recent.set(key, Date.now());
      const config = await getConfig();
      if (!config.extensionKey) {
        await setStatus({ ok: false, message: 'Extension key not set (open options).' });
        return;
      }
      try {
        const r = await ingestTimesheets(config, msg.envelope);
        sessionSynced += 1;
        setBadge();
        const gaps = r.noHrxShift + r.workerUnmatched + r.noAssignment;
        await setStatus({
          ok: true,
          message: gaps > 0
            ? `timesheets: ${r.entries} rows — ${gaps} need attention (${r.noHrxShift} job unlinked, ${r.workerUnmatched} worker unknown, ${r.noAssignment} not assigned)`
            : `timesheets: ${r.entries} rows, all matched in HRX`,
        });
      } catch (err) {
        recent.delete(key); // allow retry
        await setStatus({ ok: false, message: `timesheet sync failed: ${err.message || err}` });
      }
    })();
    return false;
  }
  if (msg && msg.type === 'flex_portal_capture' && msg.envelope) {
    (async () => {
      const jobId = msg.envelope.context && msg.envelope.context.jobId;
      // Cross-tab dedupe: same job within 60s is a no-op.
      if (jobId) {
        const last = recent.get(jobId) || 0;
        if (Date.now() - last < 60 * 1000) return;
        recent.set(jobId, Date.now());
      }
      const config = await getConfig();
      if (!config.extensionKey) {
        await setStatus({ ok: false, message: 'Extension key not set (open options).' });
        return;
      }
      try {
        const result = await ingest(config, msg.envelope);
        sessionSynced += 1;
        setBadge();
        const summary = result.matched
          ? `job ${result.flexJobId}: ${result.created} added, ${result.reconfirmed} re-booked, ${result.observedDrops} left roster, ${(result.unmatchedWorkers || []).length} unmatched`
          : `job ${result.flexJobId}: ${result.reason || 'not matched to an HRX shift'}`;
        await setStatus({ ok: true, message: summary, jobId });
      } catch (err) {
        if (jobId) recent.delete(jobId); // allow retry
        await setStatus({ ok: false, message: `sync failed: ${err.message || err}` });
      }
    })();
    return false;
  }
  return false;
});
