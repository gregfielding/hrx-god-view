import type {
  AssignmentReadinessSectionRowV1,
  AssignmentReadinessStateV1,
  AssignmentReadinessSectionStatusV1,
  AssignmentReadinessV1Snapshot,
} from '../types/assignmentReadinessV1';
import { isAssignmentTerminalNormalized } from './assignmentStatusNormalize';

const STATE_LABEL: Record<AssignmentReadinessStateV1, string> = {
  not_applicable: 'Not applicable',
  pending_confirmation: 'Pending confirmation',
  requirements_incomplete: 'Requirements incomplete',
  ready: 'Ready',
  active: 'Active on job',
  blocked: 'Blocked',
  completed: 'Completed',
  canceled: 'Canceled',
};

const SECTION_LABEL: Record<string, string> = {
  onboarding_instance: 'Job onboarding',
  documents: 'Documents',
  steps: 'Steps',
  checks: 'Checks',
  signature_envelopes: 'E-signatures',
  screening_orders: 'Screening',
};

const SECTION_STATUS_LABEL: Record<AssignmentReadinessSectionStatusV1, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  blocked: 'Blocked',
  not_applicable: 'N/A',
};

export function assignmentReadinessStateDisplay(state: string | null | undefined): string {
  const k = String(state || '').trim() as AssignmentReadinessStateV1;
  return (STATE_LABEL[k] ?? k.replace(/_/g, ' ')) || '—';
}

export function assignmentReadinessSectionStatusDisplay(status: string | null | undefined): string {
  const k = String(status || '').trim() as AssignmentReadinessSectionStatusV1;
  return SECTION_STATUS_LABEL[k] ?? String(status || '—');
}

/** Human section title for chips / compact UI (matches persisted `sectionId`). */
export function assignmentReadinessSectionDisplayName(sectionId: string): string {
  const id = String(sectionId || '').trim();
  return SECTION_LABEL[id] ?? id.replace(/_/g, ' ');
}

export function sectionRowById(
  readiness: AssignmentReadinessV1Snapshot | null | undefined,
  sectionId: string
): AssignmentReadinessSectionRowV1 | undefined {
  return readiness?.assignmentSectionStatuses?.find((r) => r.sectionId === sectionId);
}

export function screeningLineFromReadiness(readiness: AssignmentReadinessV1Snapshot | null | undefined): string | null {
  if (!readiness) return null;
  const row = sectionRowById(readiness, 'screening_orders');
  if (!row) {
    return readiness.readinessSummary?.trim() || assignmentReadinessStateDisplay(readiness.assignmentReadinessState);
  }
  return `Screening: ${assignmentReadinessSectionStatusDisplay(row.status)}`;
}

/** Documents + e-sign section statuses only (systems card). */
export function documentsAndSignaturesLineFromReadiness(
  readiness: AssignmentReadinessV1Snapshot | null | undefined
): string | null {
  if (!readiness) return null;
  const doc = sectionRowById(readiness, 'documents');
  const sig = sectionRowById(readiness, 'signature_envelopes');
  const parts: string[] = [];
  if (doc) parts.push(`Documents: ${assignmentReadinessSectionStatusDisplay(doc.status)}`);
  if (sig) parts.push(`E-sign: ${assignmentReadinessSectionStatusDisplay(sig.status)}`);
  return parts.length ? parts.join(' · ') : null;
}

export function packageSectionsSummaryFromReadiness(
  readiness: AssignmentReadinessV1Snapshot | null | undefined
): string | null {
  if (!readiness?.assignmentSectionStatuses?.length) return null;
  const ids = ['onboarding_instance', 'documents', 'steps', 'checks', 'signature_envelopes'];
  const parts = ids
    .map((id) => {
      const row = sectionRowById(readiness, id);
      if (!row) return null;
      const title = SECTION_LABEL[id] ?? id;
      return `${title}: ${assignmentReadinessSectionStatusDisplay(row.status)}`;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

/** True when assignment should not be treated as “current” for staffing / primary pick / live tables. */
export function isAssignmentSummaryTerminal(a: {
  status?: string | null;
  assignmentReadinessV1?: AssignmentReadinessV1Snapshot | null;
}): boolean {
  const st = a.assignmentReadinessV1?.assignmentReadinessState;
  if (st === 'completed' || st === 'canceled') return true;
  return isAssignmentTerminalNormalized(a.status);
}

export function coerceAssignmentReadinessV1FromDoc(
  raw: unknown
): AssignmentReadinessV1Snapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.assignmentReadinessState !== 'string') return null;
  const sections = o.assignmentSectionStatuses;
  if (!Array.isArray(sections)) return null;
  const normalizedRows: AssignmentReadinessSectionRowV1[] = [];
  for (const row of sections) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.sectionId !== 'string' || typeof r.status !== 'string') continue;
    normalizedRows.push({
      sectionId: r.sectionId,
      status: r.status as AssignmentReadinessSectionStatusV1,
    });
  }
  const readinessSummary =
    o.readinessSummary == null || o.readinessSummary === ''
      ? null
      : String(o.readinessSummary);
  const blocking = o.blockingRequirementIds;
  return {
    assignmentReadinessState: o.assignmentReadinessState as AssignmentReadinessStateV1,
    readinessSummary,
    assignmentSectionStatuses: normalizedRows,
    blockingRequirementIds: Array.isArray(blocking)
      ? blocking.filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}
