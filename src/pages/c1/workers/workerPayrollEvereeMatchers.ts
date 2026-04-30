/**
 * EE.4 — pure helpers extracted from `WorkerPayrollEvereeTenant.tsx` so
 * they can be unit-tested without dragging React / `react-router-dom` /
 * Firebase imports into the test environment.
 *
 * - `looksLikeOnboardingCompleteMessage` (Layer 1): strict whitelist of
 *   Everee iframe messages that mean "onboarding fully done — stamp
 *   the optimistic UX hint and request `WORKER_HOME` next time".
 * - `isStampWithinTtl` (Layer 3): TTL gate that lets stale optimistic
 *   stamps be ignored automatically when the canonical preflight is
 *   unreachable.
 *
 * The original site for these helpers (the `.tsx` file) re-exports them
 * so existing imports keep working; new call sites should import from
 * here directly.
 */

/**
 * Strict whitelist of "this iframe message means onboarding is fully
 * done, request `WORKER_HOME` next time".
 *
 * The pre-EE.4 matcher used the substring regex
 * `/WORKER_ONBOARDING_COMPLETE|ONBOARDING_COMPLETE|onboarding[._-]?complete/i`,
 * which matched any envelope containing those substrings — including
 * intermediate Everee SDK events like `BANK_ONBOARDING_COMPLETE_STEP_3`,
 * `I9_SECTION_1_ONBOARDING_COMPLETE`, or any free-form payload mentioning
 * the substring "onboarding-complete". A single false positive was
 * enough to deadlock the worker:
 *
 *   1) Stamp `clientObservedOnboardingCompleteAt` on the link doc.
 *   2) Next page load: `detectOnboardingComplete` reads the stamp →
 *      requests `WORKER_HOME` → Everee correctly returns EMB-202
 *      ("Onboarding not yet complete") because the worker's actual
 *      `onboardingStatus` is still `IN_PROGRESS`.
 *   3) The EMB-202 toast lives **inside** the iframe; the host bridge is
 *      broken (separate EMB-102 issue blocked on Everee support), so the
 *      message never reaches our recovery handler. Stamp stays. Deadlock.
 *
 * Policy: prefer false negatives over false positives. Be paranoid about
 * what we accept as a terminal completion event. If we miss a real
 * completion, the server-side preflight on the next page load
 * (`evereeGetMyOnboardingStatus`, EE.4 Layer 2) will catch it and route
 * the worker to `WORKER_HOME` correctly — no harm done. If we accept a
 * false positive, the worker is locked out until someone manually clears
 * the stamp via `evereeAdminClearStaleStamps`.
 */
const EVEREE_TERMINAL_ONBOARDING_EVENTS = new Set<string>([
  'WORKER_ONBOARDING_COMPLETE',
  'WORKER_ONBOARDING_COMPLETED',
  'WORKER_ONBOARDED',
  'ONBOARDING_COMPLETE',
  'ONBOARDING_COMPLETED',
  'ONBOARDING_FINISHED',
]);

const INTERMEDIATE_EVENT_FRAGMENTS = [
  'STEP',
  'SECTION',
  'PROGRESS',
  'STARTED',
  'SAVED',
  'UPDATED',
  'BANK',
  'I9',
  'I_9',
  'DD',
  'DIRECT_DEPOSIT',
  'W4',
  'W_4',
  'W9',
  'W_9',
  'PERSONAL_INFO',
  'TAX',
  'IDENTITY',
  'SETUP',
  'PARTIAL',
  'IN_PROGRESS',
  'INPROGRESS',
];

export function looksLikeOnboardingCompleteMessage(payload: unknown): boolean {
  if (!payload) return false;
  const candidates: string[] = [];
  if (typeof payload === 'string') candidates.push(payload);
  else if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    // Pull from dedicated event-name fields only. `status` / `state` /
    // free-form fields carry intermediate progress and are *not* safe
    // signals of terminal completion.
    for (const k of ['type', 'event', 'eventType', 'name', 'kind']) {
      const v = p[k];
      if (typeof v === 'string') candidates.push(v);
    }
  }
  for (const raw of candidates) {
    const s = String(raw).trim().toUpperCase();
    if (!s) continue;
    if (!EVEREE_TERMINAL_ONBOARDING_EVENTS.has(s)) continue;
    // Exact-match required; defensively reject anything containing
    // intermediate-event fragments even if the exact string happened to
    // pass the whitelist (belt-and-braces — Everee could ship a
    // `WORKER_ONBOARDING_COMPLETE_STEP_4` constant tomorrow).
    if (INTERMEDIATE_EVENT_FRAGMENTS.some((frag) => s.includes(frag))) continue;
    return true;
  }
  return false;
}

/**
 * EE.4 Layer 3 — TTL on the optimistic UX stamps. Past this age the
 * client-observed / API-observed completion stamps are ignored when
 * computing `detectOnboardingComplete`. The Layer 2 server preflight is
 * still canonical (and is what writes `apiObservedOnboardingCompleteAt`),
 * so the only practical effect of the TTL is shortening the recovery
 * window when the server preflight isn't reachable (e.g. callable
 * outage). One hour is enough to cover normal session-renewal cycles
 * without strangling actually-complete workers; the canonical webhook
 * (`onboardingCompletedAt`) is still trusted forever.
 */
export const ONBOARDING_COMPLETE_STAMP_TTL_MS = 60 * 60 * 1000; // 1 hour

export function isStampWithinTtl(value: unknown, ttlMs: number): boolean {
  if (!value) return false;
  // Firestore Timestamp objects have a `.toMillis()`; serverTimestamp
  // sentinels resolve to a Timestamp by the time the client reads them.
  let ms: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) ms = value;
  else if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try {
      ms = (value as { toMillis: () => number }).toMillis();
    } catch {
      ms = null;
    }
  } else if (
    typeof (value as { seconds?: number }).seconds === 'number' &&
    Number.isFinite((value as { seconds: number }).seconds)
  ) {
    // Plain `{ seconds, nanoseconds }` shape (Firestore REST / converted).
    ms = (value as { seconds: number }).seconds * 1000;
  }
  if (ms === null) return false;
  return Date.now() - ms < ttlMs;
}
