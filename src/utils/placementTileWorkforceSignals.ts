/**
 * Compact job-readiness + requirement match signals for Placements worker pool tiles.
 * Job context comes from `JobOrder`; worker context from `users` screening order arrays + profile certs.
 */
import type { JobOrder } from '../types/recruiter/jobOrder';

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function complianceField(jobOrder: Record<string, unknown>, key: string): unknown {
  const c = jobOrder.compliance;
  if (!c || typeof c !== 'object') return undefined;
  return (c as Record<string, unknown>)[key];
}

/** Same merge idea as `mergeAssignmentScreeningFromJobOrder` but job-order only (no assignment doc). */
export function placementJobOrderScreeningFlags(jobOrder: JobOrder | null | undefined): {
  bgRequired: boolean;
  drugRequired: boolean;
  certCount: number;
} {
  const jo = (jobOrder ?? {}) as Record<string, unknown>;
  const bg =
    Boolean(jo.backgroundCheckRequired ?? jo.showBackgroundChecks) ||
    hasNonEmptyArray(jo.backgroundCheckPackages) ||
    hasNonEmptyArray(complianceField(jo, 'backgroundCheckPackages'));
  const drug =
    Boolean(jo.drugScreenRequired ?? jo.showDrugScreening) ||
    hasNonEmptyArray(jo.drugScreeningPanels) ||
    hasNonEmptyArray(complianceField(jo, 'drugScreeningPanels'));
  const certs = [
    ...(Array.isArray(jo.requiredCertifications) ? jo.requiredCertifications : []),
    ...(Array.isArray(jo.requiredLicenses) ? jo.requiredLicenses : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return {
    bgRequired: bg,
    drugRequired: drug,
    certCount: certs.length,
  };
}

export type ScreeningSignalState = 'ok' | 'pending' | 'issue' | 'na' | 'missing';

function normalizeOrderRow(o: unknown): { status: string; result: string } {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  return {
    status: String(r.status || '').toLowerCase(),
    result: String(r.result || '').toLowerCase(),
  };
}

/**
 * Coarse status from AccuSource-style order history (best-effort; no provider-specific rules).
 */
export function coarseScreeningFromOrders(orders: unknown[] | undefined): ScreeningSignalState {
  if (!orders?.length) return 'missing';
  let anyClear = false;
  let anyIssue = false;
  let anyPending = false;
  for (const o of orders) {
    const { status, result } = normalizeOrderRow(o);
    if (result === 'pass' || result === 'clear' || result === 'negative' || status === 'complete' || status === 'completed') {
      anyClear = true;
    }
    if (result === 'fail' || result === 'positive' || status === 'failed' || result === 'cancelled') {
      anyIssue = true;
    }
    if (
      status.includes('pending') ||
      status === 'ordered' ||
      status === 'in_progress' ||
      status === 'processing' ||
      status === 'incomplete'
    ) {
      anyPending = true;
    }
  }
  if (anyIssue) return 'issue';
  if (anyClear) return 'ok';
  if (anyPending) return 'pending';
  return 'pending';
}

function normalizeToken(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How many job-order-required cert/license strings appear to be satisfied by worker profile entries (fuzzy).
 */
export function placementCertMatchCounts(
  jobOrder: JobOrder | null | undefined,
  workerCerts: unknown[] | undefined,
  workerLicenses: unknown[] | undefined,
): { matched: number; total: number; labels: string[] } {
  const jo = jobOrder ?? ({} as JobOrder);
  const required = [
    ...(Array.isArray(jo.requiredCertifications) ? jo.requiredCertifications : []),
    ...(Array.isArray(jo.requiredLicenses) ? jo.requiredLicenses : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const labels = required.map(normalizeToken);
  if (labels.length === 0) return { matched: 0, total: 0, labels: [] };

  const workerStrings: string[] = [];
  for (const c of workerCerts || []) {
    if (typeof c === 'string') workerStrings.push(normalizeToken(c));
    else if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      workerStrings.push(
        normalizeToken(
          String(o.name || o.certification || o.title || o.label || ''),
        ),
      );
    }
  }
  for (const L of workerLicenses || []) {
    if (typeof L === 'string') workerStrings.push(normalizeToken(L));
    else if (L && typeof L === 'object') {
      const o = L as Record<string, unknown>;
      workerStrings.push(normalizeToken(String(o.type || o.name || o.license || o.label || '')));
    }
  }
  const hay = workerStrings.filter(Boolean);
  let matched = 0;
  for (const req of labels) {
    if (!req) continue;
    const hit = hay.some((h) => {
      if (!h) return false;
      if (h === req) return true;
      if (req.length >= 4 && (h.includes(req) || req.includes(h))) return true;
      return false;
    });
    if (hit) matched += 1;
  }
  return { matched, total: labels.length, labels: required };
}

export type PlacementRequiredCertStatus = { label: string; matched: boolean };

/** Per required cert/license string: whether the worker profile matches (same fuzzy rules as `placementCertMatchCounts`). */
export function placementRequiredCertMatchList(
  jobOrder: JobOrder | null | undefined,
  workerCerts: unknown[] | undefined,
  workerLicenses: unknown[] | undefined,
): PlacementRequiredCertStatus[] {
  const jo = jobOrder ?? ({} as JobOrder);
  const required = [
    ...(Array.isArray(jo.requiredCertifications) ? jo.requiredCertifications : []),
    ...(Array.isArray(jo.requiredLicenses) ? jo.requiredLicenses : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (required.length === 0) return [];

  const workerStrings: string[] = [];
  for (const c of workerCerts || []) {
    if (typeof c === 'string') workerStrings.push(normalizeToken(c));
    else if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      workerStrings.push(
        normalizeToken(String(o.name || o.certification || o.title || o.label || '')),
      );
    }
  }
  for (const L of workerLicenses || []) {
    if (typeof L === 'string') workerStrings.push(normalizeToken(L));
    else if (L && typeof L === 'object') {
      const o = L as Record<string, unknown>;
      workerStrings.push(normalizeToken(String(o.type || o.name || o.license || o.label || '')));
    }
  }
  const hay = workerStrings.filter(Boolean);

  return required.map((raw) => {
    const req = normalizeToken(raw);
    const hit = hay.some((h) => {
      if (!h || !req) return false;
      if (h === req) return true;
      if (req.length >= 4 && (h.includes(req) || req.includes(h))) return true;
      return false;
    });
    return { label: raw, matched: hit };
  });
}
