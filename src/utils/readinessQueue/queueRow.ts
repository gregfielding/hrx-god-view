/**
 * Canonical row shape + normalizers for the readiness queue surfaces.
 *
 * **Provenance:** extracted verbatim from `src/pages/RecruiterMyQueue.tsx`
 * (the in-production "My Queue" Phase 1 readiness UI). Greg's 2026-04-25
 * directive on the Workforce promote PR was: don't reinvent a parallel
 * shape, lift the one already in production. Spec §11 hard rule: "Don't
 * invent a new readiness data shape."
 *
 * `QueueRow` unifies both `EmployeeReadinessItem` and
 * `AssignmentReadinessItem` for display. Anything Workforce / matrix-drawer
 * code consumes should consume this — never the raw firestore types
 * directly, so when the underlying data model evolves we have one place to
 * adapt.
 *
 * @see src/shared/employeeReadinessItemV1.ts
 * @see src/shared/assignmentReadinessItemV1.ts
 * @see src/shared/actionItemOwnership.ts
 */

import type { EmployeeReadinessItem } from '../../types/employeeReadinessItemV1';
import type { AssignmentReadinessItem } from '../../types/assignmentReadinessItemV1';
import type {
  ActionItemOwnershipHistoryEntry,
  ActionItemOwnershipPrimarySource,
} from '../../types/actionItemOwnership';

/** Discriminator + reverse-lookup context for the underlying firestore doc. */
export type QueueRowKind = 'employee' | 'assignment';

/**
 * The shape Workforce, the worker × entity matrix drawer (D.2), and the I-9
 * §2 callable surface (D.3) all consume. Field set is intentionally a
 * superset of either underlying item type so a single render path covers
 * both — kind-specific fields (`assignmentId`, `hiringEntityId`) are
 * optional accordingly.
 */
export type QueueRow = {
  id: string;
  kind: QueueRowKind;
  tenantId: string;
  workerUid: string;
  /** For assignment items; undefined for employee items. */
  assignmentId?: string;
  /** For employee items; undefined for assignment items. */
  hiringEntityId?: string;
  hiringEntityName?: string;
  /** Shared. */
  requirementType: string;
  requirementLabel?: string;
  status:
    | 'incomplete'
    | 'in_progress'
    | 'complete_pass'
    | 'complete_fail'
    | 'needs_review'
    | 'expired'
    | 'blocked'
    | 'not_applicable'
    /** @deprecated legacy pre-§6e value; treat as complete_pass. */
    | 'complete';
  actor: 'worker' | 'recruiter' | 'vendor' | 'system';
  blocking: boolean;
  /** Ownership scalars — kept flat so table sort/filter is cheap. */
  primaryRecruiterId: string | null;
  visibleRecruiterIds: string[];
  primarySource: ActionItemOwnershipPrimarySource;
  history: ActionItemOwnershipHistoryEntry[];
  /** Origin attribution (audit / debug). */
  sourceKind?: string;
  sourceRef?: string;
  /**
   * **R.8** — Vendor case id (`everify_cases/{id}`, `backgroundChecks/{id}`,
   * etc.). Lifted from `EmployeeReadinessItem.externalRef` so the matrix
   * cell can deep-link straight into the right vendor drawer (R.5 / R.6)
   * without re-fetching the underlying item.
   *
   * Not populated for assignment items.
   */
  externalRef?: string;
  /** Optional row-level deep link surfaced by the row's CTA. */
  ctaTarget?: {
    kind: string;
    path: string;
    label?: string;
  };
  createdAtMs: number;
  updatedAtMs: number;
  /** Denormalized worker display info — populated post-snapshot via a
   *  best-effort batched fetch (see `loadWorkerNames`). Falls back to uid. */
  workerName?: string;
  workerAvatar?: string;
  /** Denormalized owner display info — same batched fetch as worker name.
   *  Only set when `primaryRecruiterId` is non-null. */
  ownerName?: string;
  ownerAvatar?: string;
};

/** Composite key suitable for `Map<string, QueueRow>` deduping across both kinds. */
export function queueRowKey(row: Pick<QueueRow, 'kind' | 'id'>): string {
  return `${row.kind}:${row.id}`;
}

export function normalizeEmployeeItem(id: string, data: EmployeeReadinessItem): QueueRow {
  return {
    id,
    kind: 'employee',
    tenantId: data.tenantId,
    workerUid: data.workerUid,
    hiringEntityId: data.hiringEntityId,
    hiringEntityName: data.hiringEntityName,
    requirementType: data.requirementType,
    requirementLabel: data.requirementLabel,
    status: data.status,
    actor: data.actor,
    blocking: data.blocking,
    primaryRecruiterId: data.ownership?.primaryRecruiterId ?? null,
    visibleRecruiterIds: Array.isArray(data.ownership?.visibleRecruiterIds)
      ? data.ownership.visibleRecruiterIds
      : [],
    primarySource: (data.ownership?.primarySource ?? 'unassigned') as ActionItemOwnershipPrimarySource,
    history: normalizeOwnershipHistory(data.ownership?.history),
    sourceKind: data.source?.kind,
    sourceRef: data.source?.ref,
    externalRef: typeof data.externalRef === 'string' ? data.externalRef : undefined,
    ctaTarget: data.ctaTarget,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt),
  };
}

export function normalizeAssignmentItem(id: string, data: AssignmentReadinessItem): QueueRow {
  return {
    id,
    kind: 'assignment',
    tenantId: data.tenantId,
    workerUid: data.workerUid,
    assignmentId: data.assignmentId,
    requirementType: data.requirementType,
    requirementLabel: data.requirementLabel,
    status: data.status,
    actor: data.actor,
    blocking: data.blocking,
    primaryRecruiterId: data.ownership?.primaryRecruiterId ?? null,
    visibleRecruiterIds: Array.isArray(data.ownership?.visibleRecruiterIds)
      ? data.ownership.visibleRecruiterIds
      : [],
    primarySource: (data.ownership?.primarySource ?? 'unassigned') as ActionItemOwnershipPrimarySource,
    history: normalizeOwnershipHistory(data.ownership?.history),
    sourceKind: data.source?.kind,
    sourceRef: data.source?.ref,
    ctaTarget: data.ctaTarget,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt),
  };
}

export function normalizeOwnershipHistory(raw: unknown): ActionItemOwnershipHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h) => {
    const entry = h as Record<string, unknown>;
    const at = entry.at;
    return {
      at: typeof at === 'string' ? at : new Date(toMs(at)).toISOString(),
      actorUid: String(entry.actorUid ?? 'system'),
      action: entry.action as ActionItemOwnershipHistoryEntry['action'],
      from: (entry.from as string | null | undefined) ?? undefined,
      to: (entry.to as string | null | undefined) ?? undefined,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
    };
  });
}

/**
 * Tolerant timestamp parser. Items in production may have ISO strings,
 * Firestore Timestamps, or plain numbers depending on the writer (Phase A
 * triggers vs Phase B seed vs manual migration scripts).
 */
export function toMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Human-friendly secondary label for a row (the "Context" column in
 * RecruiterMyQueue, repurposed for Workforce's hiring-entity column on
 * employee items and a JO summary on assignment items).
 */
export function contextLabel(row: QueueRow): string {
  if (row.kind === 'employee') {
    return row.hiringEntityName || row.hiringEntityId || 'Employee onboarding';
  }
  return row.assignmentId ? `Assignment ${row.assignmentId.slice(0, 8)}…` : 'Assignment';
}
