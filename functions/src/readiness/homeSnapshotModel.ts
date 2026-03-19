import * as admin from 'firebase-admin';

type TargetIndustry = 'hospitality' | 'industrial';
type ReadinessChecklistPriority = 'required' | 'high_impact' | 'optional';
type ReadinessChecklistStatus = 'missing' | 'in_progress' | 'complete' | 'recommended';
type LaunchStep =
  | 'start'
  | 'profile_photo'
  | 'resume'
  | 'education'
  | 'work_authorization'
  | 'certifications'
  | 'skills'
  | 'work_experience';

interface ChecklistDefinition {
  id: string;
  title: string;
  benefit: string;
  priority: ReadinessChecklistPriority;
  launchStep: LaunchStep;
  weight: number;
  industries: TargetIndustry[];
}

export interface HomeSnapshotChecklistItem {
  id: string;
  title: string;
  benefit: string;
  priority: ReadinessChecklistPriority;
  status: ReadinessChecklistStatus;
  launchStep: LaunchStep;
  weight: number;
  industries: TargetIndustry[];
  relevanceScore: number;
  sortOrder: number;
}

export interface HomeSnapshotScoring {
  readinessPercent: number;
  completedCount: number;
  requiredCount: number;
  totalWeight: number;
  completedWeight: number;
  industryContext: TargetIndustry[];
}

export interface HomeSnapshotV1 {
  version: 1;
  scoring: HomeSnapshotScoring;
  checklist: HomeSnapshotChecklistItem[];
  orderedNextStepIds: string[];
}

export interface ReadinessSignals {
  hasProfilePhoto: boolean;
  hasWorkAuthorization: boolean;
  hasCertifications: boolean;
  hasSkills: boolean;
  hasResume: boolean;
  targetIndustries: TargetIndustry[];
  desiredWorkType: string;
}

const CHECKLIST_DEFINITIONS: ChecklistDefinition[] = [
  {
    id: 'profile_photo',
    title: 'Add a profile photo',
    benefit: 'Employers are more likely to choose workers with a clear photo.',
    priority: 'required',
    launchStep: 'profile_photo',
    weight: 22,
    industries: ['hospitality', 'industrial'],
  },
  {
    id: 'work_authorization',
    title: 'Confirm work authorization',
    benefit: 'This helps unlock more shift opportunities.',
    priority: 'required',
    launchStep: 'work_authorization',
    weight: 28,
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

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function responseExists(userDoc: Record<string, unknown>, key: string): boolean {
  const responses = ((((userDoc.workerProfile as Record<string, unknown> | undefined)?.readiness ||
    {}) as Record<string, unknown>).responses || {}) as Record<string, unknown>;
  const row = responses[key] as Record<string, unknown> | undefined;
  const value = normalizeString(row?.value);
  return value.length > 0;
}

function getIndustryContext(userDoc: Record<string, unknown>): TargetIndustry[] {
  const prefs = ((userDoc.workerProfile as Record<string, unknown> | undefined)?.preferences ||
    {}) as Record<string, unknown>;
  const industriesRaw = Array.isArray(prefs.targetIndustries) ? prefs.targetIndustries : [];
  const industries = industriesRaw
    .map((v) => normalizeString(v).toLowerCase())
    .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
  return industries.length ? industries : ['hospitality', 'industrial'];
}

function hasProfilePhoto(userDoc: Record<string, unknown>): boolean {
  const photo = normalizeString(
    (userDoc.workerProfile as Record<string, unknown> | undefined)?.photoUrl ||
      userDoc.avatar,
  );
  return photo.length > 0;
}

function hasWorkAuthorization(userDoc: Record<string, unknown>): boolean {
  const attestation = (userDoc.workEligibilityAttestation as Record<string, unknown> | undefined) || {};
  return (
    (attestation.authorizedToWorkUS !== undefined && attestation.requireSponsorship !== undefined) ||
    typeof userDoc.workEligibility === 'boolean'
  );
}

function hasCertifications(userDoc: Record<string, unknown>): boolean {
  const canonical = (((userDoc.workerProfile as Record<string, unknown> | undefined)?.credentials ||
    {}) as Record<string, unknown>).certifications;
  const legacy = userDoc.certifications;
  return (Array.isArray(canonical) && canonical.length > 0) || (Array.isArray(legacy) && legacy.length > 0);
}

function hasSkills(userDoc: Record<string, unknown>): boolean {
  const canonical = (userDoc.workerProfile as Record<string, unknown> | undefined)?.skills;
  const legacy = userDoc.skills;
  return (Array.isArray(canonical) && canonical.length > 0) || (Array.isArray(legacy) && legacy.length > 0);
}

function hasResume(userDoc: Record<string, unknown>): boolean {
  return Boolean((userDoc.resume as Record<string, unknown> | undefined)?.fileUrl || userDoc.resumeUrl);
}

function resolveChecklistStatus(userDoc: Record<string, unknown>, itemId: string): ReadinessChecklistStatus {
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

export function extractReadinessSignals(userDoc: Record<string, unknown>): ReadinessSignals {
  const prefs = ((userDoc.workerProfile as Record<string, unknown> | undefined)?.preferences ||
    {}) as Record<string, unknown>;
  return {
    hasProfilePhoto: hasProfilePhoto(userDoc),
    hasWorkAuthorization: hasWorkAuthorization(userDoc),
    hasCertifications: hasCertifications(userDoc),
    hasSkills: hasSkills(userDoc),
    hasResume: hasResume(userDoc),
    targetIndustries: getIndustryContext(userDoc),
    desiredWorkType: normalizeString(prefs.desiredWorkType || userDoc.desiredWorkType).toLowerCase(),
  };
}

export function buildHomeSnapshotV1(userDoc: Record<string, unknown>): HomeSnapshotV1 {
  const industryContext = getIndustryContext(userDoc);
  const checklist = CHECKLIST_DEFINITIONS.map((item, index) => {
    const overlap = item.industries.filter((industry) => industryContext.includes(industry)).length;
    const relevanceScore = item.industries.length > 0 ? overlap / item.industries.length : 1;
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
    } as HomeSnapshotChecklistItem;
  }).sort((a, b) => {
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

  const totalWeight = checklist.reduce((sum, item) => sum + item.weight * item.relevanceScore, 0);
  const completedWeight = checklist.reduce(
    (sum, item) => sum + (item.status === 'complete' ? item.weight * item.relevanceScore : 0),
    0,
  );
  const readinessPercent = totalWeight > 0 ? clampPercent((completedWeight / totalWeight) * 100) : 0;
  const requiredCount = checklist.filter((item) => item.priority !== 'optional').length;
  const completedCount = checklist.filter((item) => item.status === 'complete' && item.priority !== 'optional').length;
  const orderedNextStepIds = checklist.filter((item) => item.status !== 'complete').map((item) => item.id);

  return {
    version: 1,
    scoring: {
      readinessPercent,
      completedCount,
      requiredCount,
      totalWeight,
      completedWeight,
      industryContext,
    },
    checklist,
    orderedNextStepIds,
  };
}

export function buildHomeSnapshotWritePayload(
  snapshot: HomeSnapshotV1,
  triggerReason: string,
): Record<string, unknown> {
  return {
    'workerProfile.readiness.homeSnapshot': {
      ...snapshot,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      triggerReason,
      computedBy: 'syncC1WorkerHomeReadinessSnapshot',
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}
