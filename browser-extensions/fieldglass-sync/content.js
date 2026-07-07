/**
 * HRX Fieldglass Sync — content script.
 *
 * Runs on every *.fieldglass.cloud.sap page:
 *   - On a job_posting_detail.do page, auto-captures the visible text
 *     after render settles and hands it to the background worker
 *     (passive sync — viewing an order syncs it).
 *   - Answers popup/background requests: collect detail-page links from
 *     the current page (worklist bulk mode) or re-capture on demand.
 *
 * The content script extracts NOTHING itself — HRX's server does the
 * parsing, so SAP layout changes can't break this file.
 */

const DETAIL_PATH = 'job_posting_detail.do';

function pageText() {
  return (document.body && document.body.innerText) || '';
}

function isDetailPage() {
  return window.location.pathname.includes(DETAIL_PATH);
}

/**
 * Unique job_posting_detail.do links on the current page (absolute).
 * Deduped by the `id=` query param with fragments stripped — a detail
 * page carries several self-anchors (#primary-content etc.) that
 * previously counted as 5 separate "orders" (live run, 2026-07-07).
 */
function collectDetailLinks() {
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!href.includes(DETAIL_PATH)) continue;
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch (e) {
      continue;
    }
    url.hash = '';
    const key = url.searchParams.get('id') || url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url.toString());
  }
  return links;
}

// Passive capture: wait for the page to settle, then ship the text once.
if (isDetailPage()) {
  let sent = false;
  const send = () => {
    if (sent) return;
    const text = pageText();
    // SDXOJP id present = the order actually rendered.
    if (!/SDXOJP\d{6,}/.test(text)) return;
    sent = true;
    chrome.runtime.sendMessage({
      type: 'fg_page_capture',
      url: window.location.href,
      text,
    });
  };
  // Two attempts: fast path + a late retry for slow XHR-rendered blocks.
  setTimeout(send, 1500);
  setTimeout(send, 5000);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fg_collect_links') {
    sendResponse({ links: collectDetailLinks(), isDetailPage: isDetailPage() });
    return false;
  }
  if (msg && msg.type === 'fg_get_page_text') {
    sendResponse({ url: window.location.href, text: pageText() });
    return false;
  }
  return false;
});
