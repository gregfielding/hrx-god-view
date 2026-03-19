import type {
  FirestoreReadinessChecklistItem,
  FirestoreReadinessSnapshotV1,
  HomeReadinessViewModel,
  ReadinessChecklistPriority,
  ReadinessChecklistStatus,
} from '../types/homeReadiness';
import type { HomeReadinessLaunchStep } from '../components/worker/home/types';

type TargetIndustry = 'hospitality' | 'industrial';

interface ChecklistDefinition {
  id: string;
  title: string;
  benefit: string;
  priority: ReadinessChecklistPriority;
  launchStep: HomeReadinessLaunchStep;
  weight: number;
  industries: TargetIndustry[];
}

const CHECKLIST_DEFINITIONS: ChecklistDefinition[] = [
  {
    id: 'profile_photo',
    title: 'Add a profile photo',
    benefit: 'Employers are more likely to choose workers with a clear photo.',
    priority: 'required',
    launchStep: 'profile_photo',
    weight: 30,
    industries: ['hospitality', 'industrial'],
  },
  {
    id: 'work_authorization',
    title: 'Confirm work authorization',
    benefit: 'This helps unlock more shift opportunities.',
    priority: 'required',
    launchStep: 'work_authorization',
    weight: 26,
    industries: ['hospitality', 'industrial'],
  },
  {
    id: 'certifications',
    title: 'Add certifications',
    benefit: 'Certifications can unlock better-paying roles.',
    priority: 'high_impact',
    launchStep: 'certifications',
    weight: 16,
    industries: ['hospitality', 'industrial'],
  },
  {
    id: 'skills',
    title: 'Add skills',
    benefit: 'More skills can improve your matches.',
    priority: 'high_impact',
    launchStep: 'skills',
    weight: 10,
    industries: ['hospitality', 'industrial'],
  },
  {
    id: 'resume',
    title: 'Upload a resume',
    benefit: 'Optional, but it can speed up profile setup.',
    priority: 'optional',
    launchStep: 'resume',
    weight: 4,
    industries: ['hospitality', 'industrial'],
  },
];
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null) {
    const row = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof row.toMillis === 'function') {
      const ms = row.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof row.toDate === 'function') {
      const d = row.toDate();
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof row.seconds === 'number') {
      const ms = row.seconds * 1000 + Math.floor((row.nanoseconds || 0) / 1_000_000);
      return Number.isFinite(ms) ? ms : null;
    }
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    const ms = parsed.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isSnapshotStale(snapshot: FirestoreReadinessSnapshotV1): boolean {
  const updatedAtMs = toMillis(snapshot.updatedAt);
  if (updatedAtMs == null) return true;
  return Date.now() - updatedAtMs > SNAPSHOT_STALE_MS;
}

function getIndustryContext(userDoc: Record<string, unknown> | null): TargetIndustry[] {
  const prefs = ((userDoc?.workerProfile as Record<string, unknown> | undefined)?.preferences ||
    {}) as Record<string, unknown>;
  const industriesRaw = Array.isArray(prefs.targetIndustries) ? prefs.targetIndustries : [];
  const industries = industriesRaw
    .map((v) => String(v || '').toLowerCase())
    .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
  return industries.length > 0 ? industries : ['hospitality', 'industrial'];
}

function hasProfilePhoto(userDoc: Record<string, unknown> | null): boolean {
  const photo = String(
    (userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl ||
      userDoc?.avatar ||
      ''
  ).trim();
  return photo.length > 0;
}

function hasWorkAuthorization(userDoc: Record<string, unknown> | null): boolean {
  const attestation = (userDoc?.workEligibilityAttestation as Record<string, unknown> | undefined) || {};
  return (
    (attestation.authorizedToWorkUS !== undefined && attestation.requireSponsorship !== undefined) ||
    typeof userDoc?.workEligibility === 'boolean'
  );
}

function hasCertifications(userDoc: Record<string, unknown> | null): boolean {
  const canonical = (((userDoc?.workerProfile as Record<string, unknown> | undefined)?.credentials ||
    {}) as Record<string, unknown>).certifications;
  const legacy = userDoc?.certifications;
  return (Array.isArray(canonical) && canonical.length > 0) || (Array.isArray(legacy) && legacy.length > 0);
}

function hasSkills(userDoc: Record<string, unknown> | null): boolean {
  const canonical = (userDoc?.workerProfile as Record<string, unknown> | undefined)?.skills;
  const legacy = userDoc?.skills;
  return (Array.isArray(canonical) && canonical.length > 0) || (Array.isArray(legacy) && legacy.length > 0);
}

function hasResume(userDoc: Record<string, unknown> | null): boolean {
  return Boolean((userDoc?.resume as Record<string, unknown> | undefined)?.fileUrl || userDoc?.resumeUrl);
}

function responseExists(userDoc: Record<string, unknown> | null, key: string): boolean {
  const responses = ((((userDoc?.workerProfile as Record<string, unknown> | undefined)?.readiness ||
    {}) as Record<string, unknown>).responses || {}) as Record<string, unknown>;
  const row = responses[key] as Record<string, unknown> | undefined;
  const value = String(row?.value || '').trim();
  return value.length > 0;
}

function resolveChecklistStatus(userDoc: Record<string, unknown> | null, itemId: string): ReadinessChecklistStatus {
  switch (itemId) {
    case 'profile_photo':
      return hasProfilePhoto(userDoc) ? 'complete' : 'missing';
    case 'work_authorization':
      return hasWorkAuthorization(userDoc) ? 'complete' : 'missing';
    case 'certifications':
      if (hasCertifications(userDoc)) return 'complete';
      return responseExists(userDoc, 'certification-food-handler') ? 'in_progress' : 'missing';
    case 'skills':
      if (hasSkills(userDoc)) return 'complete';
      return responseExists(userDoc, 'skills') ? 'in_progress' : 'missing';
    case 'resume':
      if (hasResume(userDoc)) return 'complete';
      return responseExists(userDoc, 'resume') ? 'in_progress' : 'recommended';
    default:
      return 'missing';
  }
}

function buildComputedModel(userDoc: Record<string, unknown> | null): HomeReadinessViewModel {
  const industryContext = getIndustryContext(userDoc);
  const checklist: FirestoreReadinessChecklistItem[] = CHECKLIST_DEFINITIONS
    .map((item, index) => {
      const relevantMatches = item.industries.filter((industry) => industryContext.includes(industry)).length;
      const relevanceScore = item.industries.length > 0 ? relevantMatches / item.industries.length : 1;
      const status = resolveChecklistStatus(userDoc, item.id);
      return {
        id: item.id,
        title: item.title,
        benefit: item.benefit,
        priority: item.priority,
        status,
        launchStep: item.launchStep,
        weight: item.weight,
        industries: item.industries,
        relevanceScore,
        sortOrder: index,
      };
    })
    .sort((a, b) => {
      const completionRank = (a.status === 'complete' ? 1 : 0) - (b.status === 'complete' ? 1 : 0);
      if (completionRank !== 0) return completionRank;
      const priorityRank: Record<ReadinessChecklistPriority, number> = {
        required: 0,
        high_impact: 1,
        optional: 2,
      };
      if (priorityRank[a.priority] !== priorityRank[b.priority]) {
        return priorityRank[a.priority] - priorityRank[b.priority];
      }
      const impactDelta = b.weight * b.relevanceScore - a.weight * a.relevanceScore;
      if (impactDelta !== 0) return impactDelta;
      return a.sortOrder - b.sortOrder;
    });

  const weighted = checklist.map((item) => item.weight * item.relevanceScore);
  const totalWeight = weighted.reduce((sum, n) => sum + n, 0);
  const completedWeight = checklist.reduce(
    (sum, item) => sum + (item.status === 'complete' ? item.weight * item.relevanceScore : 0),
    0
  );
  const readinessPercent = totalWeight > 0 ? clampPercent((completedWeight / totalWeight) * 100) : 0;
  const requiredCount = checklist.filter((item) => item.priority !== 'optional').length;
  const completedCount = checklist.filter((item) => item.status === 'complete' && item.priority !== 'optional').length;
  const orderedNextStepIds = checklist.filter((item) => item.status !== 'complete').map((item) => item.id);

  return {
    readinessPercent,
    completedCount,
    requiredCount,
    orderedChecklist: checklist,
    orderedNextStepIds,
    source: 'computed',
  };
}

export function buildHomeReadinessModel(userDoc: Record<string, unknown> | null): HomeReadinessViewModel {
  const snapshot = ((((userDoc?.workerProfile as Record<string, unknown> | undefined)?.readiness ||
    {}) as Record<string, unknown>).homeSnapshot || null) as FirestoreReadinessSnapshotV1 | null;
  if (
    snapshot &&
    snapshot.version === 1 &&
    !isSnapshotStale(snapshot) &&
    Array.isArray(snapshot.checklist) &&
    snapshot.scoring != null
  ) {
    const validIds = new Set(CHECKLIST_DEFINITIONS.map((item) => item.id));
    const sanitizedChecklist = [...snapshot.checklist]
      .filter((item) => validIds.has(item.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const totalWeight = sanitizedChecklist.reduce((sum, item) => sum + (item.weight || 0) * (item.relevanceScore || 1), 0);
    const completedWeight = sanitizedChecklist.reduce(
      (sum, item) =>
        sum + (item.status === 'complete' ? (item.weight || 0) * (item.relevanceScore || 1) : 0),
      0
    );
    const readinessPercent = totalWeight > 0 ? clampPercent((completedWeight / totalWeight) * 100) : 0;
    const requiredCount = sanitizedChecklist.filter((item) => item.priority !== 'optional').length;
    const completedCount = sanitizedChecklist.filter(
      (item) => item.status === 'complete' && item.priority !== 'optional'
    ).length;

    return {
      readinessPercent,
      completedCount,
      requiredCount,
      orderedChecklist: sanitizedChecklist,
      orderedNextStepIds: sanitizedChecklist.filter((item) => item.status !== 'complete').map((item) => item.id),
      source: 'snapshot',
    };
  }
  return buildComputedModel(userDoc);
}
