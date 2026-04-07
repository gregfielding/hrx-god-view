/**
 * Derives `assignmentReadinessV1` from normalized assignment status + onboarding instance rows
 * (same row rules as `employmentOnboardingPath` / `assignmentRequirementsViewModel` inputs) + screening orders.
 */

import { normalizeAssignmentStatus, isAssignmentTerminalNormalized } from '../utils/assignmentStatusNormalize';
import type { AssignmentReadinessStateV1, AssignmentReadinessSectionRowV1 } from '../types/assignmentReadinessV1';
import {
  type AssignmentRequirementRowLite,
  type OnboardingInstanceLite,
  buildAssignmentRequirementRowsFromInstance,
  openBlockingRowIds,
} from './assignmentReadinessFromInstance';

export type BackgroundCheckLite = {
  id: string;
  hrxStatus: string;
};

function isRowDoneStatus(status: AssignmentRequirementRowLite['status']): boolean {
  return status === 'completed' || status === 'satisfied_by_existing_record' || status === 'not_required';
}

function isPendingConfirmationStatus(rawStatus: string): boolean {
  const n = normalizeAssignmentStatus(rawStatus);
  if (n === 'pending') return true;
  const r = String(rawStatus || '').toLowerCase();
  return r.includes('offered') || r.includes('pending_confirmation');
}

function bgIsTerminalError(hrx: string): boolean {
  return String(hrx || '').toLowerCase() === 'error';
}

function bgIsOpen(hrx: string): boolean {
  const s = String(hrx || '').toLowerCase();
  if (!s || s === 'draft') return true;
  if (bgIsTerminalError(s)) return true;
  if (s === 'completed' || s === 'canceled' || s === 'cancelled') return false;
  return true;
}

function aggregateSectionStatuses(args: {
  inst: OnboardingInstanceLite | null;
  rows: AssignmentRequirementRowLite[];
}): AssignmentReadinessSectionRowV1[] {
  const { inst, rows } = args;

  if (!inst) {
    return [
      { sectionId: 'onboarding_instance', status: 'not_applicable' },
      { sectionId: 'documents', status: 'not_applicable' },
      { sectionId: 'steps', status: 'not_applicable' },
      { sectionId: 'checks', status: 'not_applicable' },
      { sectionId: 'signature_envelopes', status: 'not_applicable' },
    ];
  }

  const instStatus = String(inst.status || '').toLowerCase();
  const instComplete = instStatus === 'completed' || inst.percentComplete >= 100;
  const instBlocked = instStatus === 'blocked' || Boolean(inst.blockedReason);

  const onboardingSection: AssignmentReadinessSectionRowV1['status'] = instBlocked
    ? 'blocked'
    : instComplete
      ? 'complete'
      : 'incomplete';

  const byCat = (cat: AssignmentRequirementRowLite['category']) => rows.filter((r) => r.category === cat);
  const catStatus = (cat: AssignmentRequirementRowLite['category']): AssignmentReadinessSectionRowV1['status'] => {
    const list = byCat(cat);
    if (list.length === 0) return 'not_applicable';
    if (list.some((r) => r.status === 'error')) return 'blocked';
    if (list.some((r) => !isRowDoneStatus(r.status))) return 'incomplete';
    return 'complete';
  };

  const docRows = byCat('document');
  const hasEsign = (inst.resolvedDocuments || []).some(
    (d) => d.required && String(d.mode || '').toLowerCase() === 'esign'
  );
  let envelopeStatus: AssignmentReadinessSectionRowV1['status'] = 'not_applicable';
  if (hasEsign) {
    if (docRows.some((r) => r.status === 'error')) envelopeStatus = 'blocked';
    else if (docRows.some((r) => !isRowDoneStatus(r.status))) envelopeStatus = 'incomplete';
    else envelopeStatus = 'complete';
  }

  return [
    { sectionId: 'onboarding_instance', status: onboardingSection },
    { sectionId: 'documents', status: catStatus('document') },
    { sectionId: 'steps', status: catStatus('step') },
    { sectionId: 'checks', status: catStatus('check') },
    { sectionId: 'signature_envelopes', status: envelopeStatus },
  ];
}

function buildReadinessSummary(args: {
  inst: OnboardingInstanceLite | null;
  openBlockers: number;
  bgOpen: number;
}): string | null {
  const parts: string[] = [];
  if (args.inst) {
    parts.push(`Package ${args.inst.status} · ${args.inst.percentComplete}%`);
  }
  if (args.openBlockers > 0) parts.push(`${args.openBlockers} blocking requirement(s)`);
  if (args.bgOpen > 0) parts.push(`${args.bgOpen} open screening order(s)`);
  return parts.length ? parts.join(' · ') : null;
}

export type AssignmentReadinessDeriveInput = {
  assignmentId: string;
  assignmentStatusRaw: string;
  instance: OnboardingInstanceLite | null;
  envelopeByDocKey: Map<string, string>;
  backgroundChecks: BackgroundCheckLite[];
};

export function deriveAssignmentReadinessPayload(input: AssignmentReadinessDeriveInput): {
  assignmentReadinessState: AssignmentReadinessStateV1;
  assignmentSectionStatuses: AssignmentReadinessSectionRowV1[];
  blockingRequirementIds: string[];
  readinessSummary: string | null;
} {
  const { assignmentId, assignmentStatusRaw, instance, envelopeByDocKey, backgroundChecks } = input;
  const normalized = normalizeAssignmentStatus(assignmentStatusRaw);

  const rows = instance
    ? buildAssignmentRequirementRowsFromInstance({
        assignmentId,
        inst: instance,
        envelopeByDocKey,
      })
    : [];

  const rowBlockers = openBlockingRowIds(rows);
  const bgErrorIds: string[] = [];
  let bgOpenCount = 0;
  for (const b of backgroundChecks) {
    const h = String(b.hrxStatus || '');
    if (bgIsTerminalError(h)) bgErrorIds.push(`bg__${b.id}`);
    if (bgIsOpen(h)) bgOpenCount += 1;
  }

  const blockingRequirementIds = Array.from(new Set([...rowBlockers, ...bgErrorIds]));

  const instBlocked =
    instance &&
    (String(instance.status || '').toLowerCase() === 'blocked' || Boolean(instance.blockedReason));
  const instComplete =
    instance &&
    (String(instance.status || '').toLowerCase() === 'completed' || instance.percentComplete >= 100);

  const allRowsDone = rows.length === 0 || rows.every((r) => isRowDoneStatus(r.status));

  const screeningSection: AssignmentReadinessSectionRowV1 = (() => {
    if (backgroundChecks.length === 0) return { sectionId: 'screening_orders', status: 'not_applicable' };
    if (backgroundChecks.some((b) => bgIsTerminalError(b.hrxStatus))) {
      return { sectionId: 'screening_orders', status: 'blocked' };
    }
    if (backgroundChecks.some((b) => bgIsOpen(b.hrxStatus))) {
      return { sectionId: 'screening_orders', status: 'incomplete' };
    }
    return { sectionId: 'screening_orders', status: 'complete' };
  })();

  let assignmentReadinessState: AssignmentReadinessStateV1;

  if (isAssignmentTerminalNormalized(assignmentStatusRaw)) {
    assignmentReadinessState = normalized === 'cancelled' ? 'canceled' : 'completed';
  } else if (instBlocked) {
    assignmentReadinessState = 'blocked';
  } else if (isPendingConfirmationStatus(assignmentStatusRaw)) {
    assignmentReadinessState = 'pending_confirmation';
  } else if (rowBlockers.length > 0 || bgErrorIds.length > 0) {
    assignmentReadinessState = 'requirements_incomplete';
  } else if (normalized === 'in_progress') {
    if (rowBlockers.length > 0 || bgErrorIds.length > 0) {
      assignmentReadinessState = 'requirements_incomplete';
    } else if (instance && !instComplete && !instBlocked && !allRowsDone) {
      assignmentReadinessState = 'requirements_incomplete';
    } else {
      assignmentReadinessState = 'active';
    }
  } else if (normalized === 'confirmed') {
    if (!instance) {
      assignmentReadinessState = 'not_applicable';
    } else if (rowBlockers.length === 0 && bgErrorIds.length === 0 && (instComplete || allRowsDone)) {
      assignmentReadinessState = 'ready';
    } else {
      assignmentReadinessState = 'requirements_incomplete';
    }
  } else {
    assignmentReadinessState = 'not_applicable';
  }

  const baseSections = aggregateSectionStatuses({ inst: instance, rows });
  const assignmentSectionStatuses = [...baseSections, screeningSection];

  const readinessSummary = buildReadinessSummary({
    inst: instance,
    openBlockers: rowBlockers.length,
    bgOpen: bgOpenCount,
  });

  return {
    assignmentReadinessState,
    assignmentSectionStatuses,
    blockingRequirementIds,
    readinessSummary,
  };
}
