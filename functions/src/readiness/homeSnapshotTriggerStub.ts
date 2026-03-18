import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const READINESS_TRIGGER_VERSION = 1;

type ReadinessDomain =
  | 'profile_photo'
  | 'work_authorization'
  | 'availability'
  | 'certifications'
  | 'skills'
  | 'resume'
  | 'target_industries';

const DOMAIN_PATH_PREFIXES: Record<ReadinessDomain, string[]> = {
  profile_photo: ['workerProfile.photoUrl', 'avatar'],
  work_authorization: [
    'workEligibilityAttestation.authorizedToWorkUS',
    'workEligibilityAttestation.requireSponsorship',
    'workEligibility',
  ],
  availability: [
    'workerProfile.preferences.scheduleIntentOptions',
    'workerProfile.preferences.desiredWorkType',
  ],
  certifications: ['workerProfile.credentials.certifications', 'certifications'],
  skills: ['workerProfile.skills', 'skills'],
  resume: ['resume.fileUrl', 'resumeUrl'],
  target_industries: ['workerProfile.preferences.targetIndustries', 'workerProfile.preferences.desiredWorkType'],
};

function normalizeSecurityLevel(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function isWorkerSecurityLevel(level: number | null): boolean {
  return level === null || level <= 4;
}

function isC1WorkerScope(userDoc: Record<string, unknown>): {
  inScope: boolean;
  tenantId: string | null;
  resolvedSecurityLevel: number | null;
} {
  const activeTenantId = String(userDoc.activeTenantId || '').trim();
  const tenantId = String(userDoc.tenantId || '').trim();
  const tenantIds = (userDoc.tenantIds as Record<string, unknown> | undefined) || {};
  const inC1 = activeTenantId === C1_TENANT_ID || tenantId === C1_TENANT_ID || tenantIds[C1_TENANT_ID] != null;

  const directSecurity = normalizeSecurityLevel(userDoc.securityLevel);
  const tenantSecurity = normalizeSecurityLevel(
    (tenantIds[C1_TENANT_ID] as Record<string, unknown> | undefined)?.securityLevel,
  );
  const resolved = tenantSecurity ?? directSecurity;

  return {
    inScope: inC1 && isWorkerSecurityLevel(resolved),
    tenantId: inC1 ? C1_TENANT_ID : null,
    resolvedSecurityLevel: resolved,
  };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function areEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function collectChangedPaths(
  beforeValue: unknown,
  afterValue: unknown,
  basePath = '',
  out = new Set<string>(),
): Set<string> {
  if (areEqual(beforeValue, afterValue)) return out;

  const beforeIsObj = isObjectLike(beforeValue);
  const afterIsObj = isObjectLike(afterValue);
  if (!beforeIsObj || !afterIsObj) {
    if (basePath) out.add(basePath);
    return out;
  }

  const keys = new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]);
  for (const key of keys) {
    const nextPath = basePath ? `${basePath}.${key}` : key;
    const b = beforeValue[key];
    const a = afterValue[key];
    if (Array.isArray(b) || Array.isArray(a)) {
      if (!areEqual(b, a)) out.add(nextPath);
      continue;
    }
    if (isObjectLike(b) && isObjectLike(a)) {
      collectChangedPaths(b, a, nextPath, out);
      continue;
    }
    if (!areEqual(b, a)) out.add(nextPath);
  }
  return out;
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || prefix.startsWith(`${path}.`);
}

function analyzeReadinessDomainChanges(changedPaths: string[]): {
  affectedDomains: ReadinessDomain[];
  matchedFieldPrefixes: string[];
  triggerReasons: string[];
  recomputeWouldBeRequired: boolean;
} {
  const affectedDomains: ReadinessDomain[] = [];
  const matchedPrefixSet = new Set<string>();

  (Object.keys(DOMAIN_PATH_PREFIXES) as ReadinessDomain[]).forEach((domain) => {
    const prefixes = DOMAIN_PATH_PREFIXES[domain];
    const hit = changedPaths.some((path) => {
      const matchedPrefix = prefixes.find((prefix) => pathMatchesPrefix(path, prefix));
      if (matchedPrefix) {
        matchedPrefixSet.add(matchedPrefix);
        return true;
      }
      return false;
    });
    if (hit) affectedDomains.push(domain);
  });

  const triggerReasons = affectedDomains.map((domain) => `${domain}_changed`);
  return {
    affectedDomains,
    matchedFieldPrefixes: Array.from(matchedPrefixSet).sort(),
    triggerReasons,
    recomputeWouldBeRequired: affectedDomains.length > 0,
  };
}

export const logC1WorkerReadinessDomainChanges = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 1,
    retry: false,
  },
  async (event) => {
    const uid = event.params.uid as string;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    if (!after) return;

    const scope = isC1WorkerScope(after);
    if (!scope.inScope) return;

    const changedPaths = Array.from(collectChangedPaths(before || {}, after)).sort();
    const analysis = analyzeReadinessDomainChanges(changedPaths);
    const triggerReasons = before ? analysis.triggerReasons : ['worker_created', ...analysis.triggerReasons];

    logger.info('readiness_domain_change_detected', {
      version: READINESS_TRIGGER_VERSION,
      functionName: 'logC1WorkerReadinessDomainChanges',
      uid,
      tenantId: scope.tenantId,
      workerSecurityLevel: scope.resolvedSecurityLevel,
      triggerPath: 'users/{uid}',
      triggerReasons,
      recomputeWouldBeRequired: analysis.recomputeWouldBeRequired,
      readinessDomainsAffected: analysis.affectedDomains,
      changedFieldPrefixes: analysis.matchedFieldPrefixes,
      changedPathsSample: changedPaths.slice(0, 50),
      changedPathsCount: changedPaths.length,
      snapshotWriteEnabled: false,
    });
  },
);
