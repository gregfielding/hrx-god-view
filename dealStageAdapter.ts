// src/forms/dealStageAdapter.ts
// Phase 3 scaffold: translate registry fieldIds <-> existing deal.stageData.* shape
// Keep Deal Firestore shape unchanged. Centralize all path/alias logic here.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Deal = {
  id: string;
  // current persisted shape — keep as-is
  stageData?: Record<string, any>;
  companyId?: string;
  companyName?: string;
  // ... other legacy fields
};

export type DealDraft = Deal; // same shape for now (immer/draft-friendly)

// ---- Aliases for historical keys (if any) ----
const ALIASES: Record<string, string[]> = {
  jobTitle: ['roleTitle', 'title'],
  experienceLevel: ['expLevel'],
  // add more when discovered
};

// Resolve a canonical fieldId from aliases
function resolveFieldId(fieldId: string): string {
  return fieldId;
}

// ---- Stage path map: where each field traditionally lives ----
// NOTE: Do NOT change Firestore shape; only encode where we read/write.
const PATHS: Record<string, { stage?: string; key?: string; topLevel?: boolean }> = {
  jobTitle: { stage: 'discovery', key: 'jobTitle' },
  experienceLevel: { stage: 'qualification', key: 'experienceLevel' },
  startDate: { stage: 'qualification', key: 'startDate' },
  payRate: { stage: 'qualification', key: 'payRate' },
  workersNeeded: { stage: 'qualification', key: 'workersNeeded' },
  estimatedRevenue: { stage: 'scoping', key: 'estimatedRevenue' },
  notes: { stage: 'discovery', key: 'notes' },
  companyId: { topLevel: true, key: 'companyId' },
  companyName: { topLevel: true, key: 'companyName' },
  worksiteId: { stage: 'qualification', key: 'worksiteId' },
  worksiteName: { stage: 'qualification', key: 'worksiteName' },
  priority: { stage: 'qualification', key: 'priority' },
  shiftType: { stage: 'qualification', key: 'shiftType' },
};

// ---- Coercion helpers (light guards) ----
export function toNumberSafe(v: any): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function toISODate(v: any): string | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return d.toISOString();
}

export function coerceSelect<T extends string>(v: any, allow: readonly T[], fallback: T): T {
  const s = String(v ?? '').toLowerCase() as T;
  return (allow as readonly string[]).includes(s) ? (s as T) : fallback;
}

// ---- Primary association helpers (customize to your data model) ----
export function getPrimaryCompanyId(deal: Deal): string | undefined {
  // Prefer top-level companyId; override here if associations use a different source
  return deal.companyId;
}

export function getPrimaryLocation(deal: Deal): { worksiteId?: string; worksiteName?: string } {
  const stage = deal.stageData?.qualification ?? {};
  return { worksiteId: stage.worksiteId, worksiteName: stage.worksiteName };
}

// ---- Public API ----

export function getValue(fieldId: string, deal: Deal): any {
  const fid = resolveFieldId(fieldId);
  const path = PATHS[fid];
  if (!path) return undefined;

  if (path.topLevel) {
    // @ts-ignore
    return (deal as any)[path.key!];
  }
  const stage = deal.stageData?.[path.stage ?? ''] ?? {};
  return stage?.[path.key!];
}

export function setValue(fieldId: string, value: any, draft: DealDraft): void {
  const fid = resolveFieldId(fieldId);
  const path = PATHS[fid];
  if (!path) return;

  if (path.topLevel) {
    // @ts-ignore
    (draft as any)[path.key!] = value;
    return;
  }
  draft.stageData = draft.stageData ?? {};
  const stageKey = path.stage!;
  draft.stageData[stageKey] = { ...(draft.stageData[stageKey] ?? {}), [path.key!]: value };
}

// ---- Example coercing setters (optional helpers used by forms) ----

export function setNumber(fieldId: string, v: any, draft: DealDraft): void {
  setValue(fieldId, toNumberSafe(v), draft);
}

export function setDateISO(fieldId: string, v: any, draft: DealDraft): void {
  setValue(fieldId, toISODate(v), draft);
}

export function setSelect<T extends string>(fieldId: string, v: any, allow: readonly T[], fallback: T, draft: DealDraft): void {
  setValue(fieldId, coerceSelect<T>(v, allow, fallback), draft);
}

// ---- TODOs for Phase 3 proper ----
// - Add unit tests comparing adapter get/set to legacy reads/writes for 2 real Deal fixtures
// - Move per-stage field lists into src/forms/dealStages/{stage}.ts (export fieldIds + overrides)
// - Wire Deal edit pages to call getValue/setValue via FormRenderer (behind feature flag)
// - Extend PATHS as new fields migrate; keep aliases up-to-date
