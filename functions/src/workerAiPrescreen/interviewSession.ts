/**
 * Interview session doc — the "started" signal + save/resume store
 * (INT-1 "started" stage + INT-2 resume-where-you-left-off, 2026-08-30).
 *
 * One doc per worker at users/{uid}/prescreen/session:
 *   planFetchedAt     first plan fetch EVER (funnel "started" anchor; never
 *                     overwritten so re-opens don't re-count)
 *   lastPlanFetchAt   most recent open
 *   applicationId / entry   latest interview context
 *   draftAnswers      { [stepId]: answer } — saved as the worker advances
 *   draftMultiAnswers { [stepId]: string[] }
 *   lastStepId / lastStepIndex / totalSteps   progress cursor (drop-off signal)
 *   updatedAt, completedAt (stamped by submit; doc kept for the funnel,
 *                     drafts cleared)
 *
 * Written ONLY server-side (plan callable's saveProgress mode + submit) —
 * firestore.rules has no client access to users/{uid}/prescreen.
 * The collection-group index on planFetchedAt backs the metrics query.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const sessionRef = (uid: string) =>
  db.doc(`users/${uid}/prescreen/session`);

/** Best-effort "interview opened" stamp. First fetch wins for planFetchedAt. */
export async function stampPlanFetch(args: {
  uid: string;
  applicationId: string | null;
  entry: string | null;
  tenantId: string | null;
}): Promise<void> {
  const { uid, applicationId, entry, tenantId } = args;
  try {
    const ref = sessionRef(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const patch: Record<string, unknown> = {
        lastPlanFetchAt: now,
        updatedAt: now,
      };
      if (applicationId) patch.applicationId = applicationId;
      if (entry) patch.entry = entry;
      if (tenantId) patch.tenantId = tenantId;
      if (!snap.exists || !snap.get('planFetchedAt')) {
        patch.planFetchedAt = now;
      }
      tx.set(ref, patch, { merge: true });
    });
  } catch {
    // fail-open: the interview must never break on telemetry
  }
}

export interface SaveProgressInput {
  uid: string;
  lastStepId: string;
  lastStepIndex: number;
  totalSteps: number;
  draftAnswers: Record<string, string>;
  draftMultiAnswers: Record<string, string[]>;
  applicationId: string | null;
}

const MAX_DRAFT_BYTES = 200_000;

/** Persist in-progress answers so a closed tab can resume. */
export async function saveSessionProgress(input: SaveProgressInput): Promise<{ ok: boolean }> {
  const { uid, lastStepId, lastStepIndex, totalSteps, applicationId } = input;
  const draftAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.draftAnswers ?? {})) {
    if (typeof k === 'string' && k.length <= 120 && typeof v === 'string') {
      draftAnswers[k] = v.slice(0, 4000);
    }
  }
  const draftMultiAnswers: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input.draftMultiAnswers ?? {})) {
    if (typeof k === 'string' && k.length <= 120 && Array.isArray(v)) {
      draftMultiAnswers[k] = v.map((x) => String(x).slice(0, 200)).slice(0, 40);
    }
  }
  if (JSON.stringify(draftAnswers).length + JSON.stringify(draftMultiAnswers).length > MAX_DRAFT_BYTES) {
    return { ok: false };
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await sessionRef(uid).set(
    {
      lastStepId: String(lastStepId).slice(0, 120),
      lastStepIndex: Math.max(0, Math.min(200, Math.floor(lastStepIndex))),
      totalSteps: Math.max(0, Math.min(200, Math.floor(totalSteps))),
      draftAnswers,
      draftMultiAnswers,
      ...(applicationId ? { applicationId } : {}),
      updatedAt: now,
      // A saved draft implies the interview is open — cover direct-load paths
      // that skipped the plan fetch stamp.
      lastPlanFetchAt: now,
    },
    { merge: true },
  );
  return { ok: true };
}

/** Read the resumable state (drafts + cursor) for the plan response. */
export async function loadSessionDrafts(uid: string): Promise<{
  lastStepId: string;
  lastStepIndex: number;
  draftAnswers: Record<string, string>;
  draftMultiAnswers: Record<string, string[]>;
  savedAt: number | null;
} | null> {
  try {
    const snap = await sessionRef(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    if (d.completedAt) return null; // finished — nothing to resume
    const draftAnswers = (d.draftAnswers ?? {}) as Record<string, string>;
    const draftMultiAnswers = (d.draftMultiAnswers ?? {}) as Record<string, string[]>;
    if (Object.keys(draftAnswers).length === 0 && Object.keys(draftMultiAnswers).length === 0) {
      return null;
    }
    return {
      lastStepId: String(d.lastStepId ?? ''),
      lastStepIndex: Number(d.lastStepIndex ?? 0),
      draftAnswers,
      draftMultiAnswers,
      savedAt: d.updatedAt?.toMillis?.() ?? null,
    };
  } catch {
    return null;
  }
}

/** Called by submit: mark done + clear drafts (doc kept for funnel queries). */
export async function markSessionCompleted(uid: string): Promise<void> {
  try {
    await sessionRef(uid).set(
      {
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        draftAnswers: admin.firestore.FieldValue.delete(),
        draftMultiAnswers: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    // fail-open
  }
}
