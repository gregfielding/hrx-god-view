/**
 * Pick primary `entity_employments` row + matching `worker_onboarding` pipeline for recruiter table
 * breakdown (aligned with Employment tab / employmentMinimalChecklistModel).
 */

import type {
  EntityEmploymentRecord,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';

export function pickPrimaryEntityEmploymentDoc(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
): { id: string; data: Record<string, unknown> } | null {
  if (docs.length === 0) return null;
  const priority = (k: string) => {
    const key = k.toLowerCase();
    if (key === 'select') return 0;
    if (key === 'workforce') return 1;
    if (key === 'events') return 2;
    return 3;
  };
  return [...docs].sort((a, b) => {
    const ak = priority(String(a.data.entityKey || ''));
    const bk = priority(String(b.data.entityKey || ''));
    if (ak !== bk) return ak - bk;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

export function findWorkerOnboardingForEntityEmployment(
  uid: string,
  ee: Record<string, unknown>,
  pipelines: WorkerOnboardingPipeline[],
): WorkerOnboardingPipeline | null {
  if (!pipelines.length) return null;
  const pid = String(ee.onboardingPipelineId || '').trim();
  if (pid) {
    const byId = pipelines.find((p) => p.id === pid);
    if (byId) return byId;
  }
  const ek = String(ee.entityKey || '').toLowerCase();
  const want = `${uid}__${ek}`;
  const byComposite = pipelines.find((p) => p.id === want);
  if (byComposite) return byComposite;
  return pipelines.find((p) => String(p.entityKey || '').toLowerCase() === ek) || null;
}

export function entityEmploymentRecordFromRaw(id: string, data: Record<string, unknown>): EntityEmploymentRecord {
  return { id, ...(data as object) } as EntityEmploymentRecord;
}

export function normalizeEntityKeyForPayroll(entityKeyRaw: string | undefined): 'select' | 'workforce' | 'events' {
  const k = String(entityKeyRaw || '').toLowerCase();
  if (k === 'workforce') return 'workforce';
  if (k === 'events') return 'events';
  return 'select';
}
