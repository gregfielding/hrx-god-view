/**
 * **Mirror of `shared/actionItemOwnership.ts`** — CRA client/jest copy. Keep
 * byte-for-byte in sync (types only, no runtime code diverges).
 *
 * Canonical recruiter-ownership shape carried by every action item in the
 * system — Employee Readiness items, Assignment Readiness items, onboarding
 * pipeline tasks, vendor callbacks, and any future action-queue surface.
 *
 * Decisions encoded here come from `recruiter-ownership-model.md`
 * (single primary + visibility list, most-specific-wins hierarchy, sticky
 * primary with re-derived visibility, tenant-default Unassigned pool). Update
 * that doc before widening this type.
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Dates are ISO-8601
 * strings. Callers convert to Firestore Timestamp on write.
 */

export const ACTION_ITEM_OWNERSHIP_VERSION = 1;

/** Which association tier produced the current `primaryRecruiterId`. Audit/debug only. */
export type ActionItemOwnershipPrimarySource =
  /** From `jobOrder.assignedRecruiters`. */
  | 'job_order'
  /** From `account.associations.recruiterIds`. */
  | 'account'
  /** From `userGroup.groupManagerIds` on one of the worker's groups. */
  | 'user_group'
  /** From `tenants/{tid}/messagingConfig/ownershipDefaults.defaultRecruiterId`. */
  | 'tenant_default'
  /** No anchor matched — item lives in the tenant's Unassigned pool (when enabled). */
  | 'unassigned'
  /** A human reassigned / claimed; not derived from hierarchy. */
  | 'manual';

/** Every change to `primaryRecruiterId` logs an entry for audit. Oldest first. */
export type ActionItemOwnershipHistoryEntry = {
  /** ISO-8601 timestamp. Convert to Firestore Timestamp on write. */
  at: string;
  /** `'system'` when a trigger / resolver writes; otherwise the acting user's uid. */
  actorUid: string | 'system';
  action:
    | 'assigned'
    | 'reassigned'
    | 'claimed'
    | 'released'
    | 'rederived_visibility';
  /** Previous `primaryRecruiterId` — null if coming from unassigned pool. */
  from?: string | null;
  /** New `primaryRecruiterId` — null if moving back to pool. */
  to?: string | null;
  /** Free-text reason surfaced in the reassign UI. */
  reason?: string;
};

/**
 * Ownership record embedded on every action item. Centrally written by the
 * resolver (`resolveOwnership`) and updated by UI reassign / claim flows.
 *
 * Contract:
 *   - `primaryRecruiterId` null ⇒ item is in the Unassigned pool.
 *   - `visibleRecruiterIds` always includes `primaryRecruiterId` when non-null.
 *   - `visibleRecruiterIds` is re-derived on upstream changes; primary is sticky.
 *   - `history` is append-only; never mutate existing entries.
 */
export type ActionItemOwnership = {
  /** Accountable recruiter. `null` means the item is in the Unassigned pool. */
  primaryRecruiterId: string | null;
  /** Everyone allowed to see + claim this item in their queue. Includes `primaryRecruiterId` when set. */
  visibleRecruiterIds: string[];
  /** Which tier produced the current primary. */
  primarySource: ActionItemOwnershipPrimarySource;
  /** Audit trail. Append-only. Oldest first. */
  history: ActionItemOwnershipHistoryEntry[];
  /**
   * Optional: ISO-8601 timestamp of the most recent activity by the primary.
   * Used by the orphan digest to surface pool items that have sat un-claimed;
   * NOT used for time-based escalation on owned items (ownership doc §9 #4:
   * escalation is event-driven — block the next confirmation instead).
   */
  staleSince?: string;
};

/** Input context for `resolveOwnership`. All fields optional — resolver walks what's present. */
export type ResolveOwnershipInput = {
  /** Tenant scope. Required. Ownership is always tenant-scoped. */
  tenantId: string;
  /** The worker the item concerns. Required. */
  workerUid: string;
  /** Job order context when the item originates from a shift / placement / application. */
  jobOrder?: {
    id: string;
    /** `tenants/{tid}/jobOrders/{id}.assignedRecruiters` */
    assignedRecruiters: string[];
    /** Account the JO belongs to, when known. Used for per-recruiter fallback. */
    accountId?: string;
    /** Associations on the job order — may carry `isPrimary` flags per recruiter. */
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  };
  /** Account context (either direct on the item or resolved through the JO). */
  account?: {
    id: string;
    /** `tenants/{tid}/accounts/{id}.associations.recruiterIds` */
    recruiterIds: string[];
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  };
  /** User-group memberships relevant to the worker (+ their `groupManagerIds`). */
  userGroups?: Array<{
    id: string;
    /** `tenants/{tid}/userGroups/{id}.groupManagerIds` */
    groupManagerIds: string[];
    recruiterAssociations?: ActionItemOwnershipAssociation[];
  }>;
  /** Tenant default fallback; read from `tenants/{tid}/messagingConfig/ownershipDefaults`. */
  tenantDefaults?: {
    defaultRecruiterId?: string | null;
    unassignedPoolEnabled?: boolean;
  };
  /**
   * For tie-breaking within a tier — the function consults these first.
   * Lets an account flag "Greg is primary here" even if 3 recruiters are attached.
   */
  tieBreakers?: {
    /** Stable sort seed for deterministic `stable_hash` fallback. Default: the item's id. */
    stableSeed?: string;
  };
};

/**
 * Per-recruiter association metadata. Added at the item or parent doc level so
 * we can mark one of several recruiters as primary without introducing a
 * separate "lead recruiter" role. Unset `isPrimary` ⇒ fall through to the
 * stable-hash tie-breaker.
 */
export type ActionItemOwnershipAssociation = {
  recruiterId: string;
  isPrimary?: boolean;
};

/** Result of `resolveOwnership`. Fields match the fields we write onto the item. */
export type ResolveOwnershipResult = {
  primaryRecruiterId: string | null;
  visibleRecruiterIds: string[];
  primarySource: ActionItemOwnershipPrimarySource;
};
