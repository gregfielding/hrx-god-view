/**
 * Prescreen job context: extract from job posting and/or job order, then merge with tenant aiPrescreen rules.
 * Posting is first-class at apply stage; order may be absent or merged when linked.
 */

import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../shared/jobOrder/getEffectiveJobOrderField';

export type PrescreenJobSlice = {
  title: string;
  startTime?: string;
  locationLine?: string;
  requiresDrugScreen: boolean;
  requiresBackgroundCheck: boolean;
  requiresEVerify: boolean;
  physicalRequirements: string[];
  certificationsRequired: string[];
  uniformRequirements: string[];
  companyName?: string;
  hiringEntityId?: string | null;
};

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function formatWorksiteLike(job: Record<string, unknown>): string | undefined {
  const addr = job.worksiteAddress as Record<string, unknown> | undefined;
  if (!addr || typeof addr !== 'object') {
    const name = norm(job.worksiteName || job.locationName);
    const loc = norm(job.location);
    return name || loc || undefined;
  }
  const street = norm(addr.street ?? addr.streetAddress);
  const city = norm(addr.city);
  const state = norm(addr.state);
  const zip = norm(addr.zipCode ?? addr.zip);
  const parts = [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean);
  const joined = parts.join(' — ');
  return joined || norm(job.worksiteName || job.locationName) || undefined;
}

function splitPhysicalList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
  }
  const s = norm(raw);
  if (!s) return [];
  return s
    .split(/[\n;•|]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function splitUniformList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  }
  const s = norm(raw);
  if (!s) return [];
  return s
    .split(/[\n;,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function postingDrugRequired(p: Record<string, unknown>): boolean {
  if (typeof p.drugScreenRequired === 'boolean') return p.drugScreenRequired;
  const show = Boolean(p.showDrugScreening);
  const panels = p.drugScreeningPanels;
  return show && Array.isArray(panels) && panels.length > 0;
}

function postingBackgroundRequired(p: Record<string, unknown>): boolean {
  if (typeof p.backgroundCheckRequired === 'boolean') return p.backgroundCheckRequired;
  const show = Boolean(p.showBackgroundChecks);
  const pkgs = p.backgroundCheckPackages;
  return show && Array.isArray(pkgs) && pkgs.length > 0;
}

function postingStartTime(p: Record<string, unknown>): string | undefined {
  if (Array.isArray(p.shiftTimes) && p.shiftTimes.length > 0) {
    return String(p.shiftTimes[0]).trim() || undefined;
  }
  const st = norm(p.startTime);
  if (st) return st;
  const shift = p.shift;
  if (Array.isArray(shift) && shift.length > 0) return String(shift[0]).trim() || undefined;
  if (typeof shift === 'string' && shift.trim()) return shift.trim();
  return undefined;
}

function postingCerts(p: Record<string, unknown>): string[] {
  const lic = Array.isArray(p.requiredLicenses) ? p.requiredLicenses : [];
  const cert = Array.isArray(p.requiredCertifications) ? p.requiredCertifications : [];
  const merged = (p.licensesCerts as unknown) as unknown;
  if (Array.isArray(merged)) {
    return [...merged, ...lic, ...cert].map((x) => String(x).trim()).filter(Boolean);
  }
  return [...lic, ...cert].map((x) => String(x).trim()).filter(Boolean);
}

/** Extract prescreen slice from **job_postings** document (standalone or merged client shape). */
export function extractJobSliceFromPosting(posting: Record<string, unknown>): PrescreenJobSlice {
  const title =
    norm(posting.jobTitle) || norm(posting.postTitle) || norm((posting as { title?: string }).title) || 'Role';

  return {
    title,
    startTime: postingStartTime(posting),
    locationLine: formatWorksiteLike(posting),
    requiresDrugScreen: postingDrugRequired(posting),
    requiresBackgroundCheck: postingBackgroundRequired(posting),
    requiresEVerify: Boolean(posting.eVerifyRequired),
    physicalRequirements: splitPhysicalList(posting.physicalRequirements),
    certificationsRequired: postingCerts(posting),
    uniformRequirements: splitUniformList(posting.uniformRequirements),
    companyName: norm(posting.companyName) || undefined,
    hiringEntityId: norm(posting.hiringEntityId) || null,
  };
}

/** Extract prescreen slice from **job_orders** document. */
export function extractJobSliceFromJobOrder(job: Record<string, unknown>): PrescreenJobSlice {
  const shiftTimes = Array.isArray(job.shiftTimes) ? job.shiftTimes.map((x) => String(x).trim()).filter(Boolean) : [];
  const certs = Array.isArray(job.requiredCertifications)
    ? job.requiredCertifications.map((x) => String(x).trim()).filter(Boolean)
    : [];

  // R.16.2a — JO-doc reads honour the activation snapshot. Fallback
  // preserves the legacy live read (Boolean/norm) for drafts and
  // pre-§16.1 active JOs without a snapshot. Note `eVerifyRequired`'s
  // sibling read in `extractJobSliceFromPosting` is intentionally NOT
  // wrapped — that's a non-JO doc (posting) and falls under R.16.2b
  // per the Q5 lock.
  //
  // R.16.2c — extends the same pattern to `physicalRequirements`. The
  // raw JO field can be `string` or `string[]`; the snapshot value is
  // captured as whatever the cascade resolved (typically `string[]`).
  // `splitPhysicalList` normalizes both shapes so downstream consumers
  // (`buildAiInterviewContext`, `buildDynamicPrescreenQuestions`)
  // receive a uniform `string[]` either way.
  const joDoc = job as JobOrderForEffectiveRead;
  const { value: eVerify } = getEffectiveJobOrderField<boolean>(joDoc, 'eVerifyRequired', {
    fallback: Boolean(job.eVerifyRequired),
  });
  const { value: hiringEntityId } = getEffectiveJobOrderField<string | null>(
    joDoc,
    'hiringEntityId',
    { fallback: norm(job.hiringEntityId) || null },
  );
  const { value: physicalRaw } = getEffectiveJobOrderField<string | string[]>(
    joDoc,
    'physicalRequirements',
    { fallback: job.physicalRequirements as string | string[] | undefined },
  );

  return {
    title: norm(job.jobTitle) || norm(job.jobOrderName) || 'Role',
    startTime: shiftTimes[0] || undefined,
    locationLine: formatWorksiteLike(job),
    requiresDrugScreen: Boolean(job.drugScreenRequired),
    requiresBackgroundCheck: Boolean(job.backgroundCheckRequired),
    requiresEVerify: Boolean(eVerify ?? false),
    physicalRequirements: splitPhysicalList(physicalRaw),
    certificationsRequired: certs,
    uniformRequirements: splitUniformList(job.uniformRequirements),
    companyName: norm(job.companyName) || undefined,
    hiringEntityId: hiringEntityId ?? null,
  };
}

/**
 * When a job order exists, merge posting + order: **order wins** on scalar conflicts where order is authoritative;
 * combine with OR for screening flags so a posting-level “panel” signal isn’t lost if order flags are false.
 */
export function mergePostingAndOrderSlices(
  posting: PrescreenJobSlice,
  order: PrescreenJobSlice | null,
): PrescreenJobSlice {
  if (!order) return posting;

  return {
    title: order.title || posting.title,
    startTime: order.startTime || posting.startTime,
    locationLine: order.locationLine || posting.locationLine,
    requiresDrugScreen: order.requiresDrugScreen || posting.requiresDrugScreen,
    requiresBackgroundCheck: order.requiresBackgroundCheck || posting.requiresBackgroundCheck,
    requiresEVerify: order.requiresEVerify || posting.requiresEVerify,
    physicalRequirements:
      order.physicalRequirements.length > 0 ? order.physicalRequirements : posting.physicalRequirements,
    certificationsRequired:
      order.certificationsRequired.length > 0 ? order.certificationsRequired : posting.certificationsRequired,
    uniformRequirements:
      order.uniformRequirements.length > 0 ? order.uniformRequirements : posting.uniformRequirements,
    companyName: order.companyName || posting.companyName,
    hiringEntityId: order.hiringEntityId ?? posting.hiringEntityId,
  };
}

export type AiPrescreenPostingOverrides = {
  allowGigPath?: boolean;
};

export type AiPrescreenTenantConfig = {
  allowGigPath?: boolean;
};

/**
 * Resolved tenant `aiPrescreen` policy. When Firestore `tenants/{id}.aiPrescreen` is absent or partial,
 * missing keys use {@link DEFAULT_AI_PRESCREEN_TENANT_POLICY} (matches legacy behavior).
 * Posting-level merge adds {@link resolveMergedAiPrescreenPolicy} (Layer A + C).
 */
export type ResolvedAiPrescreenTenantPolicy = {
  /** When false, dynamic prescreen modules are skipped (automation unchanged). Default true = legacy. */
  enabled: boolean;
  eligibility: {
    requireResumeOrSkill: boolean;
    requirePhone: boolean;
    requireLocation: boolean;
    requireWorkAuthorization: boolean;
  };
  questions: {
    askShiftConfirmation: boolean;
    askLocationConfirmation: boolean;
    askDrugScreenConfirmation: boolean;
    askBackgroundConfirmation: boolean;
    askCertificationConfirmation: boolean;
    askUniformConfirmation: boolean;
    allowGigFallbackQuestion: boolean;
  };
};

export const DEFAULT_AI_PRESCREEN_TENANT_POLICY: ResolvedAiPrescreenTenantPolicy = {
  enabled: true,
  eligibility: {
    requireResumeOrSkill: true,
    requirePhone: true,
    requireLocation: true,
    // 2026-07-09 (Greg): sign-up no longer collects work authorization, so
    // it must not gate interview eligibility by default. I-9 at onboarding
    // is the real verification.
    requireWorkAuthorization: false,
  },
  questions: {
    askShiftConfirmation: true,
    askLocationConfirmation: true,
    askDrugScreenConfirmation: true,
    askBackgroundConfirmation: true,
    askCertificationConfirmation: true,
    askUniformConfirmation: true,
    allowGigFallbackQuestion: true,
  },
};

function readOptionalBool(obj: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  if (!obj) return fallback;
  const v = obj[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Prefer `requireResumeOrSkill`; fall back to legacy `requireResumeOrWorkHistory` in Firestore. */
function readResumeOrSkillEligibility(elig: Record<string, unknown> | undefined, fallback: boolean): boolean {
  if (!elig) return fallback;
  if (typeof elig.requireResumeOrSkill === 'boolean') return elig.requireResumeOrSkill;
  if (typeof elig.requireResumeOrWorkHistory === 'boolean') return elig.requireResumeOrWorkHistory;
  return fallback;
}

/**
 * Merge `tenants/{id}.aiPrescreen` with defaults. Safe for partial or missing config.
 */
export function resolveAiPrescreenTenantPolicy(tenant: Record<string, unknown>): ResolvedAiPrescreenTenantPolicy {
  const base = DEFAULT_AI_PRESCREEN_TENANT_POLICY;
  const raw = tenant.aiPrescreen;
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: base.enabled,
      eligibility: { ...base.eligibility },
      questions: { ...base.questions },
    };
  }
  const o = raw as Record<string, unknown>;
  const elig = o.eligibility && typeof o.eligibility === 'object' ? (o.eligibility as Record<string, unknown>) : undefined;
  const q = o.questions && typeof o.questions === 'object' ? (o.questions as Record<string, unknown>) : undefined;

  return {
    enabled: readOptionalBool(o, 'enabled', base.enabled),
    eligibility: {
      requireResumeOrSkill: readResumeOrSkillEligibility(elig, base.eligibility.requireResumeOrSkill),
      requirePhone: readOptionalBool(elig, 'requirePhone', base.eligibility.requirePhone),
      requireLocation: readOptionalBool(elig, 'requireLocation', base.eligibility.requireLocation),
      requireWorkAuthorization: readOptionalBool(
        elig,
        'requireWorkAuthorization',
        base.eligibility.requireWorkAuthorization,
      ),
    },
    questions: {
      askShiftConfirmation: readOptionalBool(q, 'askShiftConfirmation', base.questions.askShiftConfirmation),
      askLocationConfirmation: readOptionalBool(q, 'askLocationConfirmation', base.questions.askLocationConfirmation),
      askDrugScreenConfirmation: readOptionalBool(q, 'askDrugScreenConfirmation', base.questions.askDrugScreenConfirmation),
      askBackgroundConfirmation: readOptionalBool(q, 'askBackgroundConfirmation', base.questions.askBackgroundConfirmation),
      askCertificationConfirmation: readOptionalBool(
        q,
        'askCertificationConfirmation',
        base.questions.askCertificationConfirmation,
      ),
      askUniformConfirmation: readOptionalBool(q, 'askUniformConfirmation', base.questions.askUniformConfirmation),
      allowGigFallbackQuestion: readOptionalBool(q, 'allowGigFallbackQuestion', base.questions.allowGigFallbackQuestion),
    },
  };
}

const QUESTION_KEYS = [
  'askShiftConfirmation',
  'askLocationConfirmation',
  'askDrugScreenConfirmation',
  'askBackgroundConfirmation',
  'askCertificationConfirmation',
  'askUniformConfirmation',
  'allowGigFallbackQuestion',
] as const;

/**
 * Layer A + C: tenant `aiPrescreen` merged with **job posting** `aiPrescreen` (posting overrides questions + enabled).
 * Eligibility stays tenant-only (see architecture doc).
 */
export function resolveMergedAiPrescreenPolicy(
  tenant: Record<string, unknown>,
  posting?: Record<string, unknown> | null,
): ResolvedAiPrescreenTenantPolicy {
  const base = resolveAiPrescreenTenantPolicy(tenant);
  if (!posting || typeof posting !== 'object') return base;

  const raw = posting.aiPrescreen;
  if (!raw || typeof raw !== 'object') return base;

  const po = raw as Record<string, unknown>;
  const enabled = typeof po.enabled === 'boolean' ? po.enabled : base.enabled;

  const questions = { ...base.questions };
  let q = po.questions;
  if (q && typeof q === 'object') {
    const qo = q as Record<string, unknown>;
    for (const k of QUESTION_KEYS) {
      if (typeof qo[k] === 'boolean') {
        (questions as Record<string, boolean>)[k] = qo[k] as boolean;
      }
    }
  }

  return {
    ...base,
    enabled,
    questions,
  };
}

/** Read optional `aiPrescreen` map on posting or tenant. */
function readPostingOverrides(posting: Record<string, unknown>): AiPrescreenPostingOverrides {
  const raw = posting.aiPrescreen;
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    allowGigPath: typeof o.allowGigPath === 'boolean' ? o.allowGigPath : undefined,
  };
}

function readTenantAiPrescreen(tenant: Record<string, unknown>): AiPrescreenTenantConfig {
  const nested = tenant.aiPrescreen;
  if (nested && typeof nested === 'object') {
    const o = nested as Record<string, unknown>;
    const allow = o.allowGigPath;
    if (typeof allow === 'boolean') return { allowGigPath: allow };
  }
  return {};
}

/**
 * Resolve allowGigPath: **posting.aiPrescreen** → **tenant.aiPrescreen** → **tenant.workerAiPrescreenAllowGigPath**.
 */
export function resolveAllowGigPath(args: {
  tenant: Record<string, unknown>;
  posting: Record<string, unknown>;
}): boolean {
  const post = readPostingOverrides(args.posting);
  if (typeof post.allowGigPath === 'boolean') return post.allowGigPath;

  const tCfg = readTenantAiPrescreen(args.tenant);
  if (typeof tCfg.allowGigPath === 'boolean') return tCfg.allowGigPath;

  return args.tenant.workerAiPrescreenAllowGigPath === true;
}
