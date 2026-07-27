/**
 * HRX Indeed Flex Sync — ISOLATED-world buffer + relay.
 *
 * Receives captured API responses from interceptor.js (MAIN world) via
 * window.postMessage, buffers the current job's job+shifts responses, and
 * when the BOOKED-worker roster arrives assembles the bundle and hands it to
 * the background worker to POST to HRX.
 *
 * Why bundle on the roster response: the portal is single-job-at-a-time, and
 * the roster (`/workers?...booked_agency_shift_ids[]=`) is the payload that
 * carries the value — the positive "who is booked" list. job + shifts have
 * already loaded for the same job by the time it fires.
 *
 * The extension extracts nothing structural — it forwards raw bodies; HRX's
 * server normalizes, so a Flex portal/API change can't break this file.
 */
(() => {
  const buf = { job: null, jobUrl: null, shifts: null, shiftsUrl: null };
  let lastSentKey = '';
  let lastSentAt = 0;

  function agencyIdFromUrl(url) {
    const m = /\/agencies\/(\d+)\//.exec(url || '');
    return m ? m[1] : null;
  }
  function jobIdFromJobUrl(url) {
    const m = /\/jobs\/(\d+)/.exec(url || '');
    return m ? m[1] : null;
  }
  function platformIdFromLocation() {
    const m = /\/platforms\/(\d+)\//.exec(window.location.pathname);
    return m ? m[1] : null;
  }
  function jobIdFromLocation() {
    // Portal URL carries the job id in the path: /job-details/{jobId}
    const m = /\/job-details\/(\d+)/.exec(window.location.pathname);
    return m ? m[1] : null;
  }
  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function jobIdFromBody(body) {
    if (!body || typeof body !== 'object') return null;
    const d = body.data && typeof body.data === 'object' ? body.data : body;
    return d && (d.id || d.job_id || d.jobId) ? String(d.id || d.job_id || d.jobId) : null;
  }

  function assembleAndSend(rosterBody, rosterUrl) {
    // Only the BOOKED roster carries the value; the candidate pool call has
    // no booked ids — ignore it.
    if (!/booked_agency_shift_ids/.test(rosterUrl || '')) return;
    const jobId = jobIdFromBody(buf.job) || jobIdFromJobUrl(buf.jobUrl) || jobIdFromLocation() || param('jobId') || null;
    if (!jobId) return;

    // Debounce duplicate roster fires for the same job within 30s.
    const key = `${jobId}`;
    const now = Date.now();
    if (key === lastSentKey && now - lastSentAt < 30000) return;
    lastSentKey = key;
    lastSentAt = now;

    const envelope = {
      agencyId: agencyIdFromUrl(rosterUrl) || agencyIdFromUrl(buf.jobUrl) || null,
      context: {
        jobId,
        roleId: param('roleId'),
        venueId: param('venueId'),
        platformId: platformIdFromLocation(),
        url: window.location.href,
      },
      job: buf.job,
      shifts: buf.shifts,
      roster: rosterBody,
      capturedAt: now,
    };
    chrome.runtime.sendMessage({ type: 'flex_portal_capture', envelope }, () => void chrome.runtime.lastError);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__hrxFlex !== true) return;
    if (msg.kind === 'job') {
      buf.job = msg.body;
      buf.jobUrl = msg.url;
    } else if (msg.kind === 'shifts') {
      buf.shifts = msg.body;
      buf.shiftsUrl = msg.url;
    } else if (msg.kind === 'workers') {
      assembleAndSend(msg.body, msg.url);
    }
  });
})();
