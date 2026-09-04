/**
 * Worker tier (Tier 1 = trusted crew, Tier 2 = proven, Tier 3 = general
 * population) — partial activation per Greg 2026-09-04: the tier is a label +
 * audit trail only. NOTHING gates job visibility on it yet; the claim-shift
 * release windows (docs/claude/project_tiered_shift_access.md, 8/31 agreed
 * spec) plug into this same field when the app store launch lands.
 *
 * Storage: `users/{uid}.workerTiers = { global, updatedAt, lastChange }`.
 * ABSENT FIELD MEANS TIER 3 — we deliberately never backfilled 14k user docs;
 * the field is written on first change only. Audit entries ride the existing
 * staff-writable `users/{uid}/activityLogs` (actionType 'security_change'),
 * so history shows up in the profile Activity tab with no new rules or
 * collections. The one-doc `lastChange` summary lets the badge show
 * "Changed to Tier 2 on Sep 4, 2026 by Greg" without a subcollection query.
 */
import { doc, collection, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore';

import { db } from '../firebase';

export type WorkerTier = 1 | 2 | 3;

export type WorkerTierChangeSource = 'manual' | 'auto_threshold' | 'no_show_penalty' | 'earn_back';

export interface WorkerTierLastChange {
  from: WorkerTier;
  to: WorkerTier;
  at: Timestamp | Date | null;
  byId: string;
  byName: string;
  source: WorkerTierChangeSource;
  reason?: string;
}

export const WORKER_TIER_LABELS: Record<WorkerTier, string> = {
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
};

/** Menu subtitles — the internal meaning, kept short. Workers never see tiers. */
export const WORKER_TIER_DESCRIPTIONS: Record<WorkerTier, string> = {
  1: 'Trusted crew — recruiter-promoted only',
  2: 'Proven — earned or promoted',
  3: 'General population (default)',
};

/**
 * Resolve a tier from either a full user doc or a `workerTiers` map.
 * Anything absent/malformed is Tier 3 by definition.
 */
export function resolveWorkerTier(raw: unknown): WorkerTier {
  if (!raw || typeof raw !== 'object') return 3;
  const obj = raw as Record<string, unknown>;
  const tiers = (obj.workerTiers ?? obj) as Record<string, unknown>;
  const g = Number(tiers?.global);
  return g === 1 || g === 2 ? g : 3;
}

export function resolveWorkerTierLastChange(raw: unknown): WorkerTierLastChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const tiers = (obj.workerTiers ?? obj) as Record<string, unknown>;
  const lc = tiers?.lastChange as WorkerTierLastChange | undefined;
  return lc && lc.to ? lc : null;
}

export interface SetWorkerTierOptions {
  userId: string;
  tier: WorkerTier;
  /** Resolved current tier — used for the audit "from" and the no-op guard. */
  previousTier: WorkerTier;
  changedById: string;
  changedByName: string;
  source?: WorkerTierChangeSource;
  reason?: string;
}

/**
 * Set the global tier and append the audit entry in ONE batch (the tier can
 * never land without its log line). Client-permitted for staff by
 * firestore.rules `users` write (securityLevel 5+) and the activityLogs
 * staff-write clause — the same idiom as security-level changes
 * (onboardingHelpers.ts).
 */
export async function setWorkerTierGlobal(opts: SetWorkerTierOptions): Promise<void> {
  const { userId, tier, previousTier, changedById, changedByName, reason } = opts;
  const source = opts.source ?? 'manual';
  if (tier === previousTier) return;

  const lastChange: Record<string, unknown> = {
    from: previousTier,
    to: tier,
    at: serverTimestamp(),
    byId: changedById,
    byName: changedByName,
    source,
  };
  if (reason) lastChange.reason = reason;

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', userId), {
    'workerTiers.global': tier,
    'workerTiers.updatedAt': serverTimestamp(),
    'workerTiers.lastChange': lastChange,
  });

  const sourceText =
    source === 'manual'
      ? ''
      : source === 'auto_threshold'
        ? ' (automatic threshold promotion)'
        : source === 'no_show_penalty'
          ? ' (no-show penalty)'
          : ' (40-hour earn-back)';
  batch.set(doc(collection(db, 'users', userId, 'activityLogs')), {
    action: 'Tier Change',
    actionType: 'security_change',
    description:
      `Tier changed from Tier ${previousTier} to Tier ${tier} by ${changedByName}${sourceText}` +
      (reason ? ` — ${reason}` : ''),
    severity: 'low',
    source: 'web',
    metadata: {
      targetType: 'workerTier',
      from: previousTier,
      to: tier,
      changeSource: source,
      changedById,
      changedByName,
      ...(reason ? { reason } : {}),
    },
    // orderBy drops docs missing the field — always stamp both.
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}
