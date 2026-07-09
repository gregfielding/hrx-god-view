import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Detects and recovers from the "URL changes but the view never updates"
 * freeze (seen on the Job Orders table → detail navigation, 2026-07).
 *
 * What we know from live debugging of a frozen session: pushState works
 * (address bar updates), the old page stays fully interactive, no console
 * errors, no render work at all (0 DOM mutations), dispatching popstate does
 * nothing, and every subsequent client-side navigation is dead until a full
 * page load. React Router v7 wraps every navigation state update in
 * React.startTransition, so this fingerprint means the transition lane has
 * permanently stopped flushing while urgent lanes still work. Root cause not
 * yet pinned (React 18 scheduler wedge is the best fit); until it is, this
 * watchdog converts "stuck forever" into one automatic full load of the page
 * the user asked for, and captures a breadcrumb report for diagnosis.
 *
 * How it works:
 * - history.pushState/replaceState are patched once (module scope) and
 *   popstate is observed, recording the last navigation INTENT — but only
 *   when the pathname actually changes, so query-param tweaks written
 *   directly to history (CalendarWidget's ?date=) can't false-positive.
 * - This component re-renders via useLocation() on every ROUTER COMMIT and
 *   records the committed path in an effect. A wedged transition never
 *   commits, so this is the ground-truth "did React actually navigate".
 * - A plain setInterval — a browser macrotask, unaffected by whatever state
 *   React's scheduler is in — checks for an intent that is >5s old, newer
 *   than the last commit, with the address bar disagreeing with the rendered
 *   path. On detection: stash the report in localStorage
 *   ('hrx_nav_watchdog_report'), console.error it, and
 *   window.location.assign() the URL the user wanted.
 *
 * False-positive cost: if a page legitimately takes >5s to commit its first
 * transition render, the user gets a full page load of the same URL they
 * clicked — same outcome as the manual F5 they'd otherwise do.
 */

type NavEvent = { kind: 'intent' | 'commit'; path: string; at: number };

let lastIntent: { url: string; at: number } | null = null;
let lastCommit = { path: '', at: 0 };
let breadcrumbs: NavEvent[] = [];
let patched = false;

const REPORT_KEY = 'hrx_nav_watchdog_report';

function pushCrumb(kind: NavEvent['kind'], path: string) {
  breadcrumbs.push({ kind, path, at: Date.now() });
  if (breadcrumbs.length > 30) breadcrumbs = breadcrumbs.slice(-30);
}

function recordIntent(url: string) {
  try {
    const target = new URL(url, window.location.href);
    if (target.pathname === lastCommit.path) return;
    lastIntent = { url: target.pathname + target.search, at: Date.now() };
    pushCrumb('intent', target.pathname);
  } catch {
    /* unparseable URL — not a navigation we can track */
  }
}

function patchHistoryOnce() {
  if (patched) return;
  patched = true;
  const origPush = History.prototype.pushState;
  const origReplace = History.prototype.replaceState;
  History.prototype.pushState = function (...args) {
    const result = origPush.apply(this, args as any);
    if (args[2] != null) recordIntent(String(args[2]));
    return result;
  };
  History.prototype.replaceState = function (...args) {
    const result = origReplace.apply(this, args as any);
    if (args[2] != null) recordIntent(String(args[2]));
    return result;
  };
  window.addEventListener('popstate', () => {
    recordIntent(window.location.pathname + window.location.search);
  });
}

const NavigationWatchdog: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    patchHistoryOnce();
  }, []);

  // Runs only when React actually commits a navigation — the wedge detector's
  // ground truth.
  useEffect(() => {
    lastCommit = { path: location.pathname, at: Date.now() };
    pushCrumb('commit', location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    // Surface any report captured before a previous auto-recovery so it can
    // be read from the console of the recovered session.
    try {
      const prior = window.localStorage.getItem(REPORT_KEY);
      if (prior) {
        // eslint-disable-next-line no-console
        console.warn('[NavigationWatchdog] recovered from a frozen navigation earlier; report:', prior);
      }
    } catch {
      /* localStorage unavailable */
    }

    const timer = window.setInterval(() => {
      if (!lastIntent) return;
      if (lastCommit.at >= lastIntent.at) return;
      if (Date.now() - lastIntent.at < 5000) return;
      if (window.location.pathname === lastCommit.path) return;

      const report = {
        detectedAt: new Date().toISOString(),
        intended: lastIntent.url,
        renderedPath: lastCommit.path,
        addressBar: window.location.pathname + window.location.search,
        msSinceIntent: Date.now() - lastIntent.at,
        msSincePageLoad: Math.round(performance.now()),
        visibility: document.visibilityState,
        breadcrumbs,
      };
      try {
        window.localStorage.setItem(REPORT_KEY, JSON.stringify(report));
      } catch {
        /* best effort */
      }
      // eslint-disable-next-line no-console
      console.error('[NavigationWatchdog] router never committed navigation — forcing full load', report);
      const target = lastIntent.url;
      lastIntent = null; // fire once
      window.location.assign(target);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
};

export default NavigationWatchdog;
