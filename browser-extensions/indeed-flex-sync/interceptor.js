/**
 * HRX Indeed Flex Sync — MAIN-world API interceptor.
 *
 * Content scripts run in an ISOLATED world and cannot see the page's own
 * `window.fetch`, so this file is injected into the MAIN world (manifest
 * `world: "MAIN"`) where the Flex SPA lives. It wraps fetch + XHR, and for
 * each agency-portal API response it forwards the URL + parsed JSON body to
 * the isolated content script via window.postMessage. It reads nothing else
 * and mutates nothing — a pure tap on the responses the SPA already fetches,
 * so no re-auth and no extra load on Indeed.
 */
(() => {
  const API_RE = /flex-core-us\.indeed\.com\/api\/v2\/agency_portal\//;

  function classify(url) {
    if (/\/jobs\/\d+\?/.test(url) || /\/jobs\/\d+$/.test(url)) return 'job';
    if (/\/agency_shifts\b/.test(url)) return 'shifts';
    if (/\/workers\b/.test(url)) return 'workers';
    // Timesheets view rows (one per worker-per-shift-day). The (\?|$)
    // anchor keeps the sibling /entries/count and /entries/worker_names
    // calls out — they carry no row data.
    if (/\/timesheets\/entries(\?|$)/.test(url)) return 'timesheets';
    return null;
  }

  function forward(url, bodyText) {
    const kind = classify(url);
    if (!kind) return;
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      return;
    }
    window.postMessage({ __hrxFlex: true, kind, url, body }, window.location.origin);
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const req = args[0];
    const url = (req && typeof req === 'object' && req.url) || String(req);
    const p = origFetch.apply(this, args);
    if (API_RE.test(url)) {
      p.then((res) => {
        try {
          res.clone().text().then((t) => forward(url, t)).catch(() => {});
        } catch (e) {
          /* opaque/streamed — ignore */
        }
      }).catch(() => {});
    }
    return p;
  };

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__hrxUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__hrxUrl && API_RE.test(this.__hrxUrl)) {
      this.addEventListener('load', function () {
        try {
          const t = this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response);
          forward(this.__hrxUrl, t);
        } catch (e) {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, args);
  };
})();
