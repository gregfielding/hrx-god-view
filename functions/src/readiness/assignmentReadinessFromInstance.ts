/**
 * Mirrors `src/utils/employmentOnboardingPath.ts` assignment onboarding rows built from
 * `onboarding_instances` + `signature_envelopes` (same status rules for docs/steps/checks).
 * Used for `assignmentReadinessV1` — keep aligned when path logic changes.
 */

export type AssignmentReqRowStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'error'
  | 'satisfied_by_existing_record'
  | 'not_required';

export type AssignmentRequirementRowLite = {
  rowId: string;
  category: 'document' | 'step' | 'check';
  blocking: boolean;
  status: AssignmentReqRowStatus;
};

function isRowDone(status: AssignmentReqRowStatus): boolean {
  return status === 'completed' || status === 'satisfied_by_existing_record' || status === 'not_required';
}

export type OnboardingInstanceLite = {
  status: string;
  percentComplete: number;
  resolvedDocuments: Array<{
    key?: string;
    docKey?: string;
    title?: string;
    required?: boolean;
    blocking?: boolean;
    mode?: string;
  }>;
  resolvedSteps: Array<{ key?: string; title?: string; required?: boolean; blocking?: boolean }>;
  resolvedChecks: Array<{ key?: string; title?: string; required?: boolean; blocking?: boolean }>;
  blockedReason?: string | null;
};

export function buildAssignmentRequirementRowsFromInstance(args: {
  assignmentId: string;
  inst: OnboardingInstanceLite;
  /** docKey → envelope status (Phase 1C). */
  envelopeByDocKey: Map<string, string>;
}): AssignmentRequirementRowLite[] {
  const { assignmentId, inst, envelopeByDocKey } = args;
  const rows: AssignmentRequirementRowLite[] = [];

  const instStatus = String(inst.status || '').toLowerCase();
  const instComplete = instStatus === 'completed';
  const instBlocked = instStatus === 'blocked';

  const pushRow = (
    suffix: string,
    category: AssignmentRequirementRowLite['category'],
    required: boolean,
    blocking: boolean,
    status: AssignmentReqRowStatus
  ) => {
    rows.push({
      rowId: `assignment__${assignmentId}__${suffix}`,
      category,
      blocking: Boolean(blocking) || status === 'error',
      status,
    });
  };

  (inst.resolvedDocuments || []).forEach((d, i) => {
    if (!d.required) return;
    const key = d.key || d.docKey || `doc_${i}`;
    const isEsign = String(d.mode || '').toLowerCase() === 'esign';
    const st = isEsign ? envelopeByDocKey.get(key) : undefined;
    let status: AssignmentReqRowStatus = 'not_started';
    if (st === 'signed' || (!isEsign && instComplete)) {
      status = 'completed';
    } else if (st === 'failed' || st === 'declined') {
      status = 'error';
    } else if (st || instBlocked) {
      status = instBlocked ? 'error' : 'in_progress';
    } else if (!isEsign) {
      status = instComplete ? 'completed' : 'in_progress';
    }
    pushRow(
      `doc__${key}`,
      'document',
      true,
      Boolean(d.blocking) || status === 'error',
      status
    );
  });

  (inst.resolvedSteps || []).forEach((s, i) => {
    if (!s.required) return;
    const status: AssignmentReqRowStatus = instComplete ? 'completed' : instBlocked ? 'error' : 'in_progress';
    pushRow(
      `step__${s.key || i}`,
      'step',
      true,
      Boolean(s.blocking) || status === 'error',
      status
    );
  });

  (inst.resolvedChecks || []).forEach((c, i) => {
    if (!c.required) return;
    const status: AssignmentReqRowStatus = instComplete ? 'completed' : instBlocked ? 'error' : 'in_progress';
    pushRow(
      `check__${c.key || i}`,
      'check',
      true,
      Boolean(c.blocking) || status === 'error',
      status
    );
  });

  return rows;
}

export function openBlockingRowIds(rows: AssignmentRequirementRowLite[]): string[] {
  return rows.filter((r) => r.blocking && !isRowDone(r.status)).map((r) => r.rowId);
}

export function coerceOnboardingInstanceLite(data: Record<string, unknown> | null | undefined): OnboardingInstanceLite | null {
  if (!data || typeof data !== 'object') return null;
  return {
    status: String(data.status || 'unknown'),
    percentComplete: typeof data.percentComplete === 'number' ? data.percentComplete : 0,
    resolvedDocuments: Array.isArray(data.resolvedDocuments) ? (data.resolvedDocuments as OnboardingInstanceLite['resolvedDocuments']) : [],
    resolvedSteps: Array.isArray(data.resolvedSteps) ? (data.resolvedSteps as OnboardingInstanceLite['resolvedSteps']) : [],
    resolvedChecks: Array.isArray(data.resolvedChecks) ? (data.resolvedChecks as OnboardingInstanceLite['resolvedChecks']) : [],
    blockedReason: (data.blockedReason as string | null) ?? null,
  };
}
