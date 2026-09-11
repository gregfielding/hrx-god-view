/**
 * Firestore writes for per-workday confirmation state (planning lives in
 * dailyConfirm.ts). Every writer — SMS reply, app card, Flex punch,
 * dispatcher — moves the day entry and the `cortConfirmation` mirror together
 * inside one transaction, so the mirror can never describe a different state
 * than the map it was computed from.
 */
import * as admin from 'firebase-admin';

import {
  DAILY_CONFIRM_DAY_RETENTION_DAYS,
  addDaysIso,
  buildDailyMirror,
  dayEntriesOf,
  isIsoDate,
  planDailyDaySeeds,
  type DayEntry,
  type WorkDay,
} from './dailyConfirm';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REMINDER_SUBCOLLECTION = 'scheduled_notifications';
const REMINDER_KIND = 'worker_shift_reminder';

function mirrorExtras(data: Record<string, unknown>): Record<string, unknown> {
  const cort = (data.cortConfirmation ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof cort.profileId === 'string') out.profileId = cort.profileId;
  if (typeof cort.sequenceId === 'string') out.sequenceId = cort.sequenceId;
  return out;
}

/** tx.update wants (path, value, path, value, …); build the pairs as we go. */
function updateInTx(
  tx: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  pairs: Array<[string | admin.firestore.FieldPath, unknown]>,
): void {
  if (pairs.length === 0) return;
  const [[firstPath, firstValue], ...rest] = pairs;
  tx.update(ref, firstPath, firstValue, ...rest.flat());
}

export interface DailyDayPatchOptions {
  /** Return false to skip the write (e.g. never downgrade a checked_in day). */
  onlyIfState?: (currentState: string) => boolean;
  /** Create the entry when the day was never seeded (a Flex punch outside the horizon). */
  createIfMissing?: boolean;
  /** Extra top-level assignment fields written in the same transaction. */
  assignmentFields?: Record<string, unknown>;
}

export interface DailyDayPatchResult {
  written: boolean;
  previousState: string;
}

/** Transaction-scoped core, for callers already inside a transaction. */
export function applyDailyDayPatchInTx(
  tx: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  data: Record<string, unknown>,
  workDate: string,
  patch: Record<string, unknown>,
  options: DailyDayPatchOptions = {},
): DailyDayPatchResult {
  const days = dayEntriesOf(data);
  const current = days[workDate];
  const previousState = String(current?.state ?? '').trim().toLowerCase();
  if (!isIsoDate(workDate)) return { written: false, previousState };
  if (!current && !options.createIfMissing) return { written: false, previousState };
  if (options.onlyIfState && !options.onlyIfState(previousState)) return { written: false, previousState };

  const entry: DayEntry = {
    ...(current ?? { state: 'pending' }),
    ...patch,
    workDate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const mirror = buildDailyMirror({ ...days, [workDate]: entry }, Date.now(), mirrorExtras(data));
  const extra = options.assignmentFields ?? {};
  tx.set(
    ref,
    { cortConfirmationDays: { [workDate]: entry }, cortConfirmation: mirror, ...extra },
    {
      mergeFields: [
        new admin.firestore.FieldPath('cortConfirmationDays', workDate),
        'cortConfirmation',
        ...Object.keys(extra),
      ],
    },
  );
  return { written: true, previousState };
}

export async function applyDailyDayPatch(args: {
  tenantId: string;
  assignmentId: string;
  workDate: string;
  patch: Record<string, unknown>;
  options?: DailyDayPatchOptions;
}): Promise<DailyDayPatchResult> {
  const ref = db.doc(`tenants/${args.tenantId}/assignments/${args.assignmentId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { written: false, previousState: '' };
    return applyDailyDayPatchInTx(
      tx,
      ref,
      snap.data() as Record<string, unknown>,
      args.workDate,
      args.patch,
      args.options,
    );
  });
}

/**
 * Seed / refresh / retire per-day entries for the enumerated horizon and
 * recompute the mirror. Existing states are never reset — a confirmed Tuesday
 * stays confirmed through every top-up.
 */
export async function seedDailyConfirmDays(args: {
  tenantId: string;
  assignmentId: string;
  workDays: WorkDay[];
  todayIso: string;
  horizonEndIso: string;
  profileId: string;
  sequenceId: string | null;
  nowMs: number;
}): Promise<void> {
  const { FieldPath, FieldValue, Timestamp } = admin.firestore;
  const ref = db.doc(`tenants/${args.tenantId}/assignments/${args.assignmentId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    const days = dayEntriesOf(data);
    const next: Record<string, DayEntry> = { ...days };
    const pairs: Array<[string | admin.firestore.FieldPath, unknown]> = [];
    const put = (date: string, value: unknown) => pairs.push([new FieldPath('cortConfirmationDays', date), value]);
    const now = FieldValue.serverTimestamp();

    const plan = planDailyDaySeeds({
      existingDays: days,
      workDays: args.workDays,
      todayIso: args.todayIso,
      horizonEndIso: args.horizonEndIso,
      nowMs: args.nowMs,
    });
    for (const day of plan.create) {
      const entry: DayEntry = {
        state: 'pending',
        workDate: day.workDate,
        startAt: Timestamp.fromMillis(day.startMs),
        startTime: day.startTime,
        endTime: day.endTime,
        profileId: args.profileId,
        sequenceId: args.sequenceId,
        createdAt: now,
        updatedAt: now,
      };
      next[day.workDate] = entry;
      put(day.workDate, entry);
    }
    for (const day of plan.refresh) {
      const entry: DayEntry = {
        ...days[day.workDate],
        startAt: Timestamp.fromMillis(day.startMs),
        startTime: day.startTime,
        endTime: day.endTime,
        updatedAt: now,
      };
      next[day.workDate] = entry;
      put(day.workDate, entry);
    }
    for (const date of plan.remove) {
      delete next[date];
      put(date, FieldValue.delete());
    }

    // Before 2026-09-11 a career carried ONE cortConfirmation for its whole
    // run (Woodridge: a Flex punch from 8/31 left each crew member
    // `checked_in` indefinitely). Keep that fact as its own day entry.
    const legacy = data.cortConfirmation as Record<string, unknown> | undefined;
    const legacyDate = (legacy?.checkedInVia as Record<string, unknown> | undefined)?.workDate;
    // One write per field path per transaction — never migrate onto a date
    // this seed already creates, refreshes, or deletes.
    const touched = new Set([...[...plan.create, ...plan.refresh].map((d) => d.workDate), ...plan.remove]);
    if (
      legacy &&
      legacy.dailyConfirm !== true &&
      isIsoDate(legacyDate) &&
      !next[legacyDate] &&
      !touched.has(legacyDate) &&
      legacyDate >= addDaysIso(args.todayIso, -DAILY_CONFIRM_DAY_RETENTION_DAYS)
    ) {
      const entry: DayEntry = {
        ...Object.fromEntries(Object.entries(legacy).filter(([k]) => k !== 'dailyConfirm' && k !== 'workDate')),
        workDate: legacyDate,
        migratedFromSingleState: true,
      };
      next[legacyDate] = entry;
      put(legacyDate, entry);
    }

    pairs.push([
      'cortConfirmation',
      buildDailyMirror(next, args.nowMs, { profileId: args.profileId, sequenceId: args.sequenceId ?? undefined }),
    ]);
    updateInTx(tx, ref, pairs);
  });
}

/**
 * The sequence no longer opts this assignment in (doc deactivated, venue
 * removed, assignment moved): drop still-pending future days and retire the
 * mirror. Answered and past days stay as history.
 */
export async function withdrawDailyConfirm(args: {
  tenantId: string;
  assignmentId: string;
  todayIso: string;
}): Promise<void> {
  const { FieldPath, FieldValue } = admin.firestore;
  const ref = db.doc(`tenants/${args.tenantId}/assignments/${args.assignmentId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    const cort = data.cortConfirmation as Record<string, unknown> | undefined;
    if (cort?.dailyConfirm !== true) return;
    const pairs: Array<[string | admin.firestore.FieldPath, unknown]> = [];
    const dates = Object.keys(dayEntriesOf(data)).sort();
    for (const [date, entry] of Object.entries(dayEntriesOf(data))) {
      if (date >= args.todayIso && String(entry.state ?? '') === 'pending') {
        pairs.push([new FieldPath('cortConfirmationDays', date), FieldValue.delete()]);
      }
    }
    const lastWorkDate = dates.filter((d) => d < args.todayIso).pop() ?? null;
    pairs.push(['cortConfirmation', { dailyConfirm: false, dailyConfirmEndedAt: FieldValue.serverTimestamp(), lastWorkDate }]);
    updateInTx(tx, ref, pairs);
  });
}

/** Cancel one workday's non-terminal reminder docs of the given types. */
export async function cancelDailyRemindersForDay(args: {
  tenantId: string;
  assignmentId: string;
  workDate: string;
  reminderTypes: ReadonlyArray<string>;
  reason: string;
}): Promise<number> {
  const snap = await db
    .collection(`tenants/${args.tenantId}/assignments/${args.assignmentId}/${REMINDER_SUBCOLLECTION}`)
    .where('workDate', '==', args.workDate)
    .get();
  if (snap.empty) return 0;
  const targets = new Set(args.reminderTypes);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let cancelled = 0;
  for (const docSnap of snap.docs) {
    if (docSnap.get('type') !== REMINDER_KIND) continue;
    if (!targets.has(String(docSnap.get('reminderType') ?? ''))) continue;
    const status = String(docSnap.get('status') ?? '').toLowerCase();
    if (status === 'sent' || status === 'failed' || status === 'cancelled') continue;
    batch.set(
      docSnap.ref,
      {
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
        cancelReason: args.reason,
        lastError: args.reason,
        claimedAt: admin.firestore.FieldValue.delete(),
        claimedBy: admin.firestore.FieldValue.delete(),
        claimExpiresAt: admin.firestore.FieldValue.delete(),
        lock: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
    cancelled += 1;
  }
  if (cancelled > 0) await batch.commit();
  return cancelled;
}
