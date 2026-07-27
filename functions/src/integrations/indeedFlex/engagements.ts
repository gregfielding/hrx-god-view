/**
 * Flex engagement layer (PI-7 continuity, 2026-07-27).
 *
 * Indeed Flex fragments a genuinely CONTINUOUS engagement (one worker at one
 * venue) into a chain of separate job IDs — one ends, a new one opens for
 * the same work, at irregular intervals. HRX saw that as a series of
 * unconnected gig assignments, so tenure / "is this person ongoing" / the
 * Career view / reliability all lost the thread, and any lifecycle end
 * risked falsely ending continuous work.
 *
 * The engagement layer sits ABOVE the per-shift assignments (which stay
 * exactly as they are — payroll untouched, Greg 2026-07-27). One engagement
 * doc per (account, worker); each Flex placement upserts it. When a worker
 * recurs at the same account within CONTINUITY_WINDOW_DAYS, the engagement is
 * marked `continuous` — the signal that reporting reads and the never-auto-
 * end guard respects. Conservative by design: `continuous` only ever turns
 * ON, never off; nothing here ends an engagement — that stays a deliberate
 * human act.
 *
 * Doc: tenants/{t}/flex_engagements/{accountId}__{userId}.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** A new placement within this many days of the last one at the same
 *  account = the same continuous engagement (Flex rolls "every few weeks"). */
export const CONTINUITY_WINDOW_DAYS = 30;

const MAX_JOB_CHAIN = 30;

export function engagementId(accountId: string, userId: string): string {
  return `${accountId}__${userId}`;
}

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

/** Whole-day gap between two yyyy-mm-dd dates (abs). null if unparseable. */
function dayGap(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(a));
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(b));
  if (!pa || !pb) return null;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round(Math.abs(ta - tb) / 86400000);
}

export interface PlacementSignal {
  userId: string;
  accountId: string;
  flexJobId: string;
  /** yyyy-mm-dd of the booked shift day. */
  date: string;
  workerName?: string;
  accountName?: string;
  jobTitle?: string;
}

export interface EngagementUpsertResult {
  engagementId: string;
  isNew: boolean;
  continuous: boolean;
  /** True when THIS placement flipped continuous on (a fresh recurrence). */
  becameContinuous: boolean;
  placementCount: number;
}

/**
 * Record one Flex placement against its (account, worker) engagement and
 * detect continuity by recurrence. Idempotent-ish: re-recording the same
 * flexJobId won't grow the chain, and `continuous` never reverts.
 */
export async function upsertEngagementForPlacement(
  tenantId: string,
  p: PlacementSignal,
  opts?: { dryRun?: boolean; windowDays?: number },
): Promise<EngagementUpsertResult> {
  const window = opts?.windowDays ?? CONTINUITY_WINDOW_DAYS;
  const userId = trim(p.userId);
  const accountId = trim(p.accountId);
  const date = trim(p.date);
  const flexJobId = trim(p.flexJobId);
  const id = engagementId(accountId, userId);
  const ref = db.doc(`tenants/${tenantId}/flex_engagements/${id}`);
  const snap = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (!snap.exists) {
    const doc: Record<string, unknown> = {
      engagementId: id,
      tenantId,
      userId,
      accountId,
      workerName: trim(p.workerName) || null,
      accountName: trim(p.accountName) || null,
      jobTitle: trim(p.jobTitle) || null,
      status: 'active',
      continuous: false,
      placementCount: 1,
      firstSeenDate: date || null,
      lastSeenDate: date || null,
      firstFlexJobId: flexJobId || null,
      currentFlexJobId: flexJobId || null,
      flexJobIds: flexJobId ? [flexJobId] : [],
      source: 'indeed_flex',
      createdAt: now,
      updatedAt: now,
    };
    if (!opts?.dryRun) await ref.set(doc);
    return { engagementId: id, isNew: true, continuous: false, becameContinuous: false, placementCount: 1 };
  }

  const cur = snap.data() ?? {};
  const wasContinuous = cur.continuous === true;
  const lastSeen = trim(cur.lastSeenDate);
  const firstSeen = trim(cur.firstSeenDate);
  const chain: string[] = Array.isArray(cur.flexJobIds) ? cur.flexJobIds.map(trim).filter(Boolean) : [];

  // Recurrence: a placement within the window of the last one = continuous.
  const gap = lastSeen && date ? dayGap(lastSeen, date) : null;
  const isRecurrence = gap !== null && gap <= window && (flexJobId ? !chain.includes(flexJobId) || flexJobId !== trim(cur.currentFlexJobId) : true);
  const becameContinuous = !wasContinuous && isRecurrence;
  const continuous = wasContinuous || isRecurrence;

  const newLast = !lastSeen || (date && date > lastSeen) ? date || lastSeen : lastSeen;
  const newFirst = !firstSeen || (date && date < firstSeen) ? date || firstSeen : firstSeen;
  const newChain = flexJobId && !chain.includes(flexJobId) ? [...chain, flexJobId].slice(-MAX_JOB_CHAIN) : chain;
  // Current Flex job = the one tied to the newest placement date.
  const currentFlexJobId = date && (!lastSeen || date >= lastSeen) ? flexJobId || trim(cur.currentFlexJobId) : trim(cur.currentFlexJobId);
  const placementCount = Number(cur.placementCount ?? 0) + 1;

  const patch: Record<string, unknown> = {
    status: 'active', // a live placement means active (revives a human-ended one that's demonstrably working again)
    continuous,
    placementCount,
    lastSeenDate: newLast || null,
    firstSeenDate: newFirst || null,
    currentFlexJobId: currentFlexJobId || null,
    flexJobIds: newChain,
    workerName: trim(p.workerName) || cur.workerName || null,
    accountName: trim(p.accountName) || cur.accountName || null,
    jobTitle: trim(p.jobTitle) || cur.jobTitle || null,
    updatedAt: now,
  };
  if (becameContinuous) patch.becameContinuousAt = now;
  if (!opts?.dryRun) await ref.set(patch, { merge: true });

  return { engagementId: id, isNew: false, continuous, becameContinuous, placementCount };
}

/** Read engagements for a tenant, optionally continuous-only / by account. */
export async function listFlexEngagements(
  tenantId: string,
  opts?: { accountId?: string; continuousOnly?: boolean },
): Promise<Array<Record<string, unknown>>> {
  let q: FirebaseFirestore.Query = db.collection(`tenants/${tenantId}/flex_engagements`);
  if (opts?.accountId) q = q.where('accountId', '==', opts.accountId);
  if (opts?.continuousOnly) q = q.where('continuous', '==', true);
  const snap = await q.limit(1000).get();
  return snap.docs.map((d) => d.data());
}

/**
 * Is this worker part of a CONTINUOUS engagement at this account? The
 * never-auto-end guard consumers (sweeps, future drop handling) call this
 * before ending/cancelling a Flex-sourced assignment.
 */
export async function isContinuousEngagement(
  tenantId: string,
  accountId: string,
  userId: string,
): Promise<boolean> {
  if (!accountId || !userId) return false;
  const snap = await db.doc(`tenants/${tenantId}/flex_engagements/${engagementId(accountId, userId)}`).get();
  return snap.exists && snap.data()?.continuous === true;
}
