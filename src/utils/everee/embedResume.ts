/**
 * Resume marker for the Everee payroll-setup embed dialog.
 *
 * Why: workers uploading I-9 documents on phones routinely lose the page —
 * opening the camera/file picker gets the tab evicted and the SPA reloads
 * on return. The embed dialog's open-state lived only in React state, so
 * the worker landed back on the checklist with the dialog closed and had
 * to find the button again ("back to the beginning" reports, 2026-08-13).
 *
 * A sessionStorage marker survives same-tab reloads (including iOS Safari
 * tab resurrection). The dialog sets it while a session is live and clears
 * it on any intentional exit (close, dismiss, complete); the checklist
 * auto-reopens the dialog when a fresh marker for the same worker/entity
 * is present after a reload. Server-side, sessions minted <4min ago are
 * reused (evereeCreateOnboardingSession), so a quick reload resumes the
 * SAME Everee session rather than restarting the flow.
 */

const TTL_MS = 30 * 60 * 1000; // 30min — stale markers never auto-open

const keyFor = (tenantId: string, entityId: string, userId: string): string =>
  `hrx_everee_embed_resume__${tenantId}__${entityId}__${userId}`;

interface ResumeMark {
  at: number;
}

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null; // storage blocked (private mode edge cases) — feature just no-ops
  }
};

export function markEvereeEmbedOpen(tenantId: string, entityId: string, userId: string): void {
  const s = storage();
  if (!s || !tenantId || !entityId || !userId) return;
  try {
    s.setItem(keyFor(tenantId, entityId, userId), JSON.stringify({ at: Date.now() } as ResumeMark));
  } catch {
    /* quota/blocked — no-op */
  }
}

export function clearEvereeEmbedMark(tenantId: string, entityId: string, userId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(keyFor(tenantId, entityId, userId));
  } catch {
    /* no-op */
  }
}

/** True when this tab had the embed open recently and the page reloaded out from under it. */
export function shouldResumeEvereeEmbed(
  tenantId: string,
  entityId: string,
  userId: string,
): boolean {
  const s = storage();
  if (!s || !tenantId || !entityId || !userId) return false;
  try {
    const raw = s.getItem(keyFor(tenantId, entityId, userId));
    if (!raw) return false;
    const mark = JSON.parse(raw) as ResumeMark;
    if (!mark || typeof mark.at !== 'number') return false;
    if (Date.now() - mark.at > TTL_MS) {
      s.removeItem(keyFor(tenantId, entityId, userId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
