/**
 * AG.0 — idempotent upsert for an auto-created user group keyed to (childAccount × jobTitle).
 *
 * Doc id is **deterministic**: `auto_${childAccountId}_${jobTitleSlug}`. Underscores, not colons —
 * Firestore rejects colons in doc ids. The slug strips characters that are illegal or wasteful
 * in a doc id (slashes, whitespace, control chars) and lowercases the result so the same job
 * title spelled differently doesn't fork the group.
 *
 * Idempotency: when a doc at the deterministic id exists, this function returns its id with
 * `created: false` and **never overwrites** recruiter edits made after creation. If a recruiter
 * flipped `useTenantDefaults: false` and customized the policy, the next backfill leaves it alone.
 *
 * Side effects: the group doc is written (when missing), but **NO** attachment to a JO or posting
 * happens here. The caller (`createGigJobOrderForChildAccount` or a backfill flow) is responsible
 * for attaching the returned `groupId` to:
 *   - JO `autoMessagingUserGroupIds` (existing field — see `jobOrderAutoMessaging.ts:232`)
 *   - JO `autoCreatedUserGroupId` (denorm pointer for the auto-attached badge UI)
 *   - Posting `autoAddToUserGroups` (existing applicant-feeder field; copy-down on posting create)
 * Keeping the attach paths in the caller makes them grep-able and trivial to re-run from a
 * backfill callable without round-tripping through this helper.
 *
 * Hiring policy at creation: `hiringConfig: { useTenantDefaults: true }`. Same compact write
 * shape as `toFirestoreUserGroupHiringConfig` uses for new manual groups in tenant-defaults
 * mode (see `src/types/userGroupHiringConfig.ts:351`). The group hiring panel renders inherited-
 * from-tenant policy until a recruiter explicitly overrides.
 *
 * Display name on creation: `{childAccountName} — {jobTitleName}` (em dash). Renames on
 * either side don't update the display name in v1 — punt to a denormalization refresh trigger
 * if/when it bites.
 */

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

/** AG.0 doc-id prefix. Recruiters can grep for this in Firestore to find auto-groups quickly. */
export const AUTO_USER_GROUP_DOC_ID_PREFIX = 'auto_';

/**
 * Slugify a job title for use in a Firestore doc id. Lowercases, collapses whitespace to single
 * underscores, and strips characters Firestore rejects or that look noisy in a doc id (`/`,
 * control chars, the doc-id reserved chars `__`, etc.). Empty / whitespace-only input returns ''.
 */
export function slugifyJobTitleForDocId(input: string | null | undefined): string {
  if (input == null) return '';
  const cleaned = String(input)
    .toLowerCase()
    .normalize('NFKD')
    // Drop anything not alphanumeric, whitespace, or hyphen.
    .replace(/[^a-z0-9\s-]/g, '')
    // Collapse whitespace + hyphens to a single underscore.
    .replace(/[\s-]+/g, '_')
    // Trim leading/trailing underscores.
    .replace(/^_+|_+$/g, '')
    // Firestore disallows ids that match `__.*__`. Belt-and-suspenders strip leading `__`.
    .replace(/^__+/, '');
  return cleaned;
}

/**
 * Build the deterministic doc id for an auto-group. Returns `null` when either input slug is
 * empty (caller should bail rather than write a malformed doc).
 */
export function buildAutoUserGroupDocId(args: {
  childAccountId: string;
  jobTitleId: string;
}): string | null {
  const child = args.childAccountId.trim();
  const title = slugifyJobTitleForDocId(args.jobTitleId);
  if (!child || !title) return null;
  return `${AUTO_USER_GROUP_DOC_ID_PREFIX}${child}_${title}`;
}

/**
 * Build the (childAccountId, jobTitleId) cross-tenant key that audit traces and any future
 * lookup-by-key flows can match against. Stored on `userGroups/{id}.autoKey` for grep-ability;
 * the doc id is sufficient for direct lookup but `autoKey` survives id renames if those ever
 * happen.
 */
export function buildAutoUserGroupKey(args: {
  childAccountId: string;
  jobTitleId: string;
}): string {
  return `${args.childAccountId}:${args.jobTitleId}`;
}

export type EnsureAutoUserGroupParams = {
  tenantId: string;
  childAccountId: string;
  childAccountName: string;
  /**
   * Stable job-title key. AG.0 v1 uses the title string itself (lowercased) since national
   * accounts have a single `defaultGigJobTitle`; if/when titles get a real id, swap this in
   * without changing the doc id format (slug result is identical for ASCII titles).
   */
  jobTitleId: string;
  /** Display string for the group title; preserves capitalization the recruiter typed. */
  jobTitleName: string;
  nationalAccountId?: string | null;
  /**
   * Recruiter uids to copy down as group owners — typically the JO's `assignedRecruiters`.
   * Stored under `recruiterIds`, mirroring the manual-group convention. Omitted/empty
   * leaves the field unset (the group hiring panel falls back to tenant-default recruiters).
   */
  recruiterIds?: string[];
  /** Stamped on `createdBy` / `updatedBy`. Defaults to a system actor literal. */
  createdBy?: string;
  /** Optional Firestore handle. Tests inject a fake; production uses `admin.firestore()`. */
  db?: admin.firestore.Firestore;
};

export type EnsureAutoUserGroupResult = {
  groupId: string;
  /** True only when this call wrote the doc; false on idempotent hit. */
  created: boolean;
};

/** Stamped on `createdBy` / `updatedBy` for traceability. */
export const SYSTEM_ACTOR_AUTO_USER_GROUP = 'system_auto_user_group';

/**
 * Ensure an auto-created user group exists for the given (childAccount × jobTitle) pair.
 * Returns the doc id (deterministic — `auto_${childAccountId}_${jobTitleSlug}`) and whether
 * this call performed the write.
 *
 * Failures (Firestore unavailable, malformed inputs) throw — callers either log + continue
 * (gig JO creation should not abort because the group write hiccupped) or bubble up via a
 * backfill audit row.
 */
export async function ensureAutoUserGroup(
  params: EnsureAutoUserGroupParams,
): Promise<EnsureAutoUserGroupResult> {
  const {
    tenantId,
    childAccountId,
    childAccountName,
    jobTitleId,
    jobTitleName,
    nationalAccountId,
    recruiterIds,
    createdBy,
  } = params;

  if (!tenantId.trim()) throw new Error('ensureAutoUserGroup: tenantId is required');
  if (!childAccountId.trim()) throw new Error('ensureAutoUserGroup: childAccountId is required');
  if (!jobTitleId.trim()) throw new Error('ensureAutoUserGroup: jobTitleId is required');

  const docId = buildAutoUserGroupDocId({ childAccountId, jobTitleId });
  if (!docId) {
    throw new Error(
      `ensureAutoUserGroup: cannot build doc id from childAccountId=${childAccountId} jobTitleId=${jobTitleId}`,
    );
  }

  const db = params.db ?? admin.firestore();
  const groupRef = db.doc(`tenants/${tenantId}/userGroups/${docId}`);
  const existing = await groupRef.get();
  if (existing.exists) {
    return { groupId: docId, created: false };
  }

  const trimmedChildName = (childAccountName || '').trim() || 'Child Account';
  const trimmedTitle = (jobTitleName || jobTitleId).trim() || 'Default Position';
  const displayTitle = `${trimmedChildName} — ${trimmedTitle}`;
  const ownerIds = Array.isArray(recruiterIds)
    ? recruiterIds.filter((id) => typeof id === 'string' && id.trim() !== '')
    : [];
  const actor = (createdBy || '').trim() || SYSTEM_ACTOR_AUTO_USER_GROUP;
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Doc shape kept intentionally close to a manual group create
  // (`RecruiterUserGroups.handleCreate`) plus the AG.0 audit fields and the
  // compact tenant-defaults hiring config write so the hiring panel renders
  // inherited policy on first open without an extra recruiter click.
  await groupRef.set({
    title: displayTitle,
    description: `Auto-created from ${trimmedChildName} for default job title "${trimmedTitle}". Members are auto-added on application; remove this group to opt this venue × title pair out of the auto cascade.`,
    type: 'auto' as const,
    isAutoCreated: true,
    autoKey: buildAutoUserGroupKey({ childAccountId, jobTitleId }),
    autoCreatedFrom: {
      childAccountId,
      jobTitleId,
      jobTitleName: trimmedTitle,
      nationalAccountId: nationalAccountId ?? null,
      createdAt: now,
    },
    memberIds: [],
    members: [], // Legacy compat with older readers (group messaging extracts keys).
    ...(ownerIds.length ? { recruiterIds: ownerIds } : {}),
    hiringConfig: {
      useTenantDefaults: true,
      employment: {},
      requirements: {},
      automation: {
        hiringActive: false,
        autoOnboardEnabled: false,
        queueAfterTargetReached: true,
      },
    },
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  });

  return { groupId: docId, created: true };
}

/**
 * Look up every auto-created user group attached to a given child account.
 *
 * Used by AG.1 (the JO-create trigger) and by the AG.1 backfill callable to find
 * the group(s) to attach to a JO under a given child. v1 returns 0 or 1 result
 * (one default job title per National). Future multi-title fan-out returns N.
 *
 * Implementation: single-field equality query on `autoCreatedFrom.childAccountId`.
 * Firestore auto-indexes nested fields, so no composite index is required. The
 * `limit(10)` cap is a safety guard — v1 fan-out won't exceed 1, future v2
 * fan-out is bounded by the National's title list (small).
 *
 * Result is deduped + sorted ascending by doc id, so callers that need a
 * deterministic "primary" group (e.g. for `autoCreatedUserGroupId`) can
 * always take the first element.
 */
export async function lookupAutoUserGroupsForChild(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  childAccountId: string;
}): Promise<string[]> {
  const { db, tenantId, childAccountId } = args;
  const trimmed = childAccountId.trim();
  if (!tenantId.trim() || !trimmed) return [];

  const snap = await db
    .collection(`tenants/${tenantId}/userGroups`)
    .where('autoCreatedFrom.childAccountId', '==', trimmed)
    .limit(10)
    .get();

  return Array.from(
    new Set(
      snap.docs
        .map((d) => d.id)
        .filter((id) => typeof id === 'string' && id.trim() !== '')
        .sort(),
    ),
  );
}
