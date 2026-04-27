/**
 * Group-level hiring configuration for Recruiter user groups.
 * Firestore: `tenants/{tenantId}/userGroups/{groupId}.hiringConfig`
 *
 * Canonical field names align with broader `hiringConfig` usage:
 * - `automation` — hiring flags + queue-after-target (merged; legacy `mode` was split from this).
 * - `targets` — capacity / onboarding targets (legacy alias: `capacity`).
 *
 * Scope: intentionally simpler than job-order hiring — group defaults only.
 * Do not merge job posting overrides, container merge rules, or shift-level staffing here.
 *
 * Orchestrator policy: `functions` `resolveAiHiringPolicyBundle` merges `hiringConfig.quality` + `automation` + `targets`
 * into the same fields as `userGroup.aiHiring` (explicit `aiHiring` wins per-field) for group-scoped applications.
 */

/** @see mergeLegacyHiringConfigKeys — legacy Firestore used `mode` + partial `automation`. */
export type UserGroupHiringAutomation = {
  hiringActive?: boolean;
  autoAdvanceEnabled?: boolean;
  autoOnboardEnabled?: boolean;
  /** After target onboarding reached: keep interviewing; queue qualified for later (v1 intent). */
  queueAfterTargetReached?: boolean;
};

export type UserGroupHiringTargets = {
  targetOnboardingCount?: number;
  maximumAutoAdvances?: number;
  stopWhenTargetReached?: boolean;
};

export type GroupHiringQualityPreset = 'conservative' | 'balanced' | 'aggressive';

/** Nested shape written to Firestore under `hiringConfig` (canonical keys). */
export type UserGroupHiringConfigV1 = {
  /**
   * When true, interview + automation + targets + quality thresholds follow the tenant document unless the group
   * stores explicit overrides. Employment and requirements usually stay group-specific.
   */
  useTenantDefaults?: boolean;
  interview?: {
    workerAiPrescreenRequired?: boolean;
  };
  automation?: UserGroupHiringAutomation;
  employment?: {
    hiringEntityId?: string | null;
    workerType?: 'W2' | '1099';
    employmentType?: 'standard' | 'on_call';
    eVerifyRequired?: boolean;
  };
  requirements?: {
    /**
     * When true, **Hire passed candidates** (on-call) passes this package into `runStartOnCallEmploymentFlow`,
     * same as User → Start on-call employment.
     */
    accusourceScreeningRequired?: boolean;
    accusourcePackageId?: string;
    accusourcePackageName?: string;
    /** À la carte SourceDirect service IDs (same request as package via `orders` on partial profile). */
    accusourceRequestedServiceIds?: string[];
    requiredCertificationIds?: string[];
  };
  quality?: {
    preset?: GroupHiringQualityPreset;
    interviewMinimumScoreToAdvance?: number;
    jobFitMinimumScoreToAdvance?: number;
    minimumJobScoreGateEnabled?: boolean;
    jobFitFailAction?: 'review' | 'hold';
    /** Upper bound on no-show risk score (0–100) to auto-advance; optional. */
    maximumNoShowRiskToAdvance?: number;
  };
  targets?: UserGroupHiringTargets;
};

export const GROUP_HIRING_QUALITY_PRESETS: Record<
  GroupHiringQualityPreset,
  { interviewMinimumScoreToAdvance: number; jobFitMinimumScoreToAdvance: number }
> = {
  conservative: { interviewMinimumScoreToAdvance: 85, jobFitMinimumScoreToAdvance: 72 },
  balanced: { interviewMinimumScoreToAdvance: 75, jobFitMinimumScoreToAdvance: 60 },
  aggressive: { interviewMinimumScoreToAdvance: 65, jobFitMinimumScoreToAdvance: 50 },
};

export const DEFAULT_USER_GROUP_HIRING_CONFIG: UserGroupHiringConfigV1 = {
  interview: { workerAiPrescreenRequired: true },
  automation: {
    hiringActive: false,
    autoAdvanceEnabled: false,
    autoOnboardEnabled: false,
    queueAfterTargetReached: true,
  },
  employment: {
    hiringEntityId: null,
    workerType: 'W2',
    employmentType: 'standard',
    eVerifyRequired: false,
  },
  requirements: {
    accusourceScreeningRequired: false,
    accusourcePackageId: '',
    accusourcePackageName: '',
    accusourceRequestedServiceIds: [],
    requiredCertificationIds: [],
  },
  quality: {
    preset: 'balanced',
    interviewMinimumScoreToAdvance: 75,
    jobFitMinimumScoreToAdvance: 60,
    minimumJobScoreGateEnabled: false,
    jobFitFailAction: 'review',
  },
  targets: {
    targetOnboardingCount: undefined,
    maximumAutoAdvances: undefined,
    stopWhenTargetReached: true,
  },
};

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readPreset(v: unknown): GroupHiringQualityPreset | undefined {
  if (v === 'conservative' || v === 'balanced' || v === 'aggressive') return v;
  return undefined;
}

/**
 * Legacy Firestore documents may use:
 * - `mode` for { hiringActive, autoAdvanceEnabled, autoOnboardEnabled }
 * - `automation` for { queueAfterTargetReached } only
 * - `capacity` instead of `targets`
 *
 * Parsed output always uses merged `automation` + `targets`.
 */
function mergeLegacyHiringConfigKeys(o: Record<string, unknown>): {
  automation: UserGroupHiringAutomation;
  targets: UserGroupHiringTargets;
} {
  const d = DEFAULT_USER_GROUP_HIRING_CONFIG;
  const legacyMode = o.mode as Record<string, unknown> | undefined;
  const autoRaw = o.automation as Record<string, unknown> | undefined;
  const capRaw = (o.targets ?? o.capacity) as Record<string, unknown> | undefined;

  const fromNewAutomation =
    autoRaw &&
    (typeof autoRaw.hiringActive === 'boolean' ||
      typeof autoRaw.autoAdvanceEnabled === 'boolean' ||
      typeof autoRaw.autoOnboardEnabled === 'boolean');

  const automation: UserGroupHiringAutomation = fromNewAutomation
    ? {
        hiringActive:
          typeof autoRaw!.hiringActive === 'boolean' ? autoRaw!.hiringActive : d.automation!.hiringActive,
        autoAdvanceEnabled:
          typeof autoRaw!.autoAdvanceEnabled === 'boolean'
            ? autoRaw!.autoAdvanceEnabled
            : d.automation!.autoAdvanceEnabled,
        autoOnboardEnabled:
          typeof autoRaw!.autoOnboardEnabled === 'boolean'
            ? autoRaw!.autoOnboardEnabled
            : d.automation!.autoOnboardEnabled,
        queueAfterTargetReached:
          typeof autoRaw!.queueAfterTargetReached === 'boolean'
            ? autoRaw!.queueAfterTargetReached
            : d.automation!.queueAfterTargetReached,
      }
    : {
        hiringActive:
          typeof legacyMode?.hiringActive === 'boolean' ? legacyMode.hiringActive : d.automation!.hiringActive,
        autoAdvanceEnabled:
          typeof legacyMode?.autoAdvanceEnabled === 'boolean'
            ? legacyMode.autoAdvanceEnabled
            : d.automation!.autoAdvanceEnabled,
        autoOnboardEnabled:
          typeof legacyMode?.autoOnboardEnabled === 'boolean'
            ? legacyMode.autoOnboardEnabled
            : d.automation!.autoOnboardEnabled,
        queueAfterTargetReached:
          typeof autoRaw?.queueAfterTargetReached === 'boolean'
            ? autoRaw.queueAfterTargetReached
            : d.automation!.queueAfterTargetReached,
      };

  const targets: UserGroupHiringTargets = {
    targetOnboardingCount: num(capRaw?.targetOnboardingCount),
    maximumAutoAdvances: num(capRaw?.maximumAutoAdvances),
    stopWhenTargetReached:
      typeof capRaw?.stopWhenTargetReached === 'boolean'
        ? capRaw.stopWhenTargetReached
        : d.targets!.stopWhenTargetReached,
  };

  return { automation, targets };
}

export function parseUserGroupHiringConfig(raw: unknown): UserGroupHiringConfigV1 {
  const d = DEFAULT_USER_GROUP_HIRING_CONFIG;
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(d)) as UserGroupHiringConfigV1;
  }

  const o = raw as Record<string, unknown>;
  const useTenantDefaults = o.useTenantDefaults === true;
  const interview = o.interview as Record<string, unknown> | undefined;
  const employment = o.employment as Record<string, unknown> | undefined;
  const requirements = o.requirements as Record<string, unknown> | undefined;
  const quality = o.quality as Record<string, unknown> | undefined;

  const { automation, targets } = mergeLegacyHiringConfigKeys(o);

  const reqCerts = requirements?.requiredCertificationIds;
  const certIds = Array.isArray(reqCerts)
    ? reqCerts.map((x) => String(x)).filter(Boolean)
    : d.requirements!.requiredCertificationIds;

  return {
    useTenantDefaults,
    interview: {
      workerAiPrescreenRequired:
        typeof interview?.workerAiPrescreenRequired === 'boolean'
          ? interview.workerAiPrescreenRequired
          : d.interview!.workerAiPrescreenRequired,
    },
    automation,
    employment: {
      hiringEntityId:
        employment?.hiringEntityId === null || typeof employment?.hiringEntityId === 'string'
          ? (employment?.hiringEntityId as string | null)
          : d.employment!.hiringEntityId,
      workerType: employment?.workerType === '1099' ? '1099' : 'W2',
      employmentType: employment?.employmentType === 'on_call' ? 'on_call' : 'standard',
      eVerifyRequired:
        typeof employment?.eVerifyRequired === 'boolean' ? employment.eVerifyRequired : d.employment!.eVerifyRequired,
    },
    requirements: (() => {
      const legacyDrug = requirements?.drugScreenRequired === true;
      const legacyBg = requirements?.backgroundCheckRequired === true;
      const rawPkg =
        typeof requirements?.accusourcePackageId === 'string' ? requirements.accusourcePackageId.trim() : '';
      const hasLegacyPkg = rawPkg.length > 0;

      let accusourceScreeningRequired: boolean;
      if (typeof requirements?.accusourceScreeningRequired === 'boolean') {
        accusourceScreeningRequired = requirements.accusourceScreeningRequired;
      } else {
        accusourceScreeningRequired = legacyDrug || legacyBg || hasLegacyPkg;
      }

      const accusourcePackageId =
        typeof requirements?.accusourcePackageId === 'string'
          ? requirements.accusourcePackageId.trim()
          : d.requirements!.accusourcePackageId;
      const accusourcePackageName =
        typeof requirements?.accusourcePackageName === 'string'
          ? requirements.accusourcePackageName.trim()
          : d.requirements!.accusourcePackageName ?? '';

      const rawSvc = requirements?.accusourceRequestedServiceIds;
      const accusourceRequestedServiceIds = Array.isArray(rawSvc)
        ? rawSvc.map((x) => String(x).trim()).filter(Boolean)
        : d.requirements!.accusourceRequestedServiceIds ?? [];

      return {
        accusourceScreeningRequired,
        accusourcePackageId,
        accusourcePackageName,
        accusourceRequestedServiceIds,
        requiredCertificationIds: certIds,
      };
    })(),
    quality: {
      preset: readPreset(quality?.preset) ?? d.quality!.preset,
      interviewMinimumScoreToAdvance:
        num(quality?.interviewMinimumScoreToAdvance) ?? d.quality!.interviewMinimumScoreToAdvance,
      jobFitMinimumScoreToAdvance:
        num(quality?.jobFitMinimumScoreToAdvance) ?? d.quality!.jobFitMinimumScoreToAdvance,
      minimumJobScoreGateEnabled:
        typeof quality?.minimumJobScoreGateEnabled === 'boolean'
          ? quality.minimumJobScoreGateEnabled
          : d.quality!.minimumJobScoreGateEnabled,
      jobFitFailAction:
        quality?.jobFitFailAction === 'hold'
          ? 'hold'
          : quality?.jobFitFailAction === 'review'
            ? 'review'
            : d.quality!.jobFitFailAction,
      maximumNoShowRiskToAdvance: num(quality?.maximumNoShowRiskToAdvance),
    },
    targets,
  };
}

/**
 * Writes group hiring config. When `useTenantDefaults` is true, persist a compact document so tenant policy is not
 * duplicated in Firestore (group-only fields remain).
 */
export function toFirestoreUserGroupHiringConfig(cfg: UserGroupHiringConfigV1): Record<string, unknown> {
  if (cfg.useTenantDefaults) {
    return {
      useTenantDefaults: true,
      employment: cfg.employment ?? {},
      requirements: cfg.requirements ?? {},
      automation: {
        hiringActive: cfg.automation?.hiringActive ?? false,
        autoOnboardEnabled: cfg.automation?.autoOnboardEnabled ?? false,
        queueAfterTargetReached: cfg.automation?.queueAfterTargetReached ?? true,
      },
    };
  }
  return JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
}

export type UserGroupHiringValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Save-time guardrails for the group hiring control panel.
 */
export function validateUserGroupHiringConfig(cfg: UserGroupHiringConfigV1): UserGroupHiringValidationResult {
  const errors: string[] = [];
  const auto = cfg.automation ?? {};
  const emp = cfg.employment ?? {};
  const qual = cfg.quality ?? {};
  const tgt = cfg.targets ?? {};

  const entity = String(emp.hiringEntityId ?? '').trim();

  if (auto.hiringActive === true && !entity) {
    errors.push('Set a hiring entity ID when hiring is active.');
  }

  if (auto.autoOnboardEnabled === true) {
    if (!entity) {
      errors.push('Set a hiring entity ID when auto-onboarding is enabled.');
    }
    if (emp.workerType !== 'W2' && emp.workerType !== '1099') {
      errors.push('Choose a worker type (W2 or 1099) when auto-onboarding is enabled.');
    }
    if (emp.employmentType !== 'standard' && emp.employmentType !== 'on_call') {
      errors.push('Choose standard or on-call employment when auto-onboarding is enabled.');
    }
  }

  if (tgt.stopWhenTargetReached === true) {
    const n = tgt.targetOnboardingCount;
    if (n === undefined || n === null || !Number.isFinite(n) || n < 1) {
      errors.push('Set a target onboarding count (at least 1) when “stop when target reached” is enabled.');
    }
  }

  if (qual.minimumJobScoreGateEnabled === true) {
    const jf = qual.jobFitMinimumScoreToAdvance;
    if (jf === undefined || jf === null || !Number.isFinite(jf)) {
      errors.push('Set a job-fit minimum score when the job-fit score gate is enabled.');
    }
  }

  const req = cfg.requirements ?? {};
  if (req.accusourceScreeningRequired === true) {
    const pkg = String(req.accusourcePackageId ?? '').trim();
    if (!pkg) {
      errors.push('Select an AccuSource screening package when screening is required.');
    }
  }
  const addOnServices = (req.accusourceRequestedServiceIds ?? []).filter(Boolean);
  if (addOnServices.length > 0 && !String(req.accusourcePackageId ?? '').trim()) {
    errors.push('Select an AccuSource package when additional screening services are selected.');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export type EffectiveBehaviorSummary = {
  lines: string[];
};

/**
 * Human-readable bullets for the “Effective behavior” panel (derived from parsed config).
 */
export function getUserGroupHiringEffectiveBehaviorSummary(cfg: UserGroupHiringConfigV1): EffectiveBehaviorSummary {
  const iv = cfg.interview ?? {};
  const auto = cfg.automation ?? {};
  const emp = cfg.employment ?? {};
  const tgt = cfg.targets ?? {};

  const prescreen = iv.workerAiPrescreenRequired === true ? 'Yes' : 'No';
  const hiringOn = auto.hiringActive === true ? 'Yes' : 'No';
  const onboardOn = auto.autoOnboardEnabled === true ? 'Yes' : 'No';
  const entity = String(emp.hiringEntityId ?? '').trim();
  const entityLine = entity ? entity : 'Not set';

  let stopLine: string;
  if (tgt.stopWhenTargetReached === true) {
    const n = tgt.targetOnboardingCount;
    if (n !== undefined && n !== null && Number.isFinite(n) && n >= 1) {
      stopLine = `Stop automatic hiring after ${n} onboarded worker${n === 1 ? '' : 's'} (when execution exists).`;
    } else {
      stopLine = 'Stop when onboarding target is reached (set a numeric target to finalize).';
    }
  } else {
    stopLine = 'Do not stop solely because an onboarding target was reached.';
  }

  let afterTargetLine: string;
  if (auto.queueAfterTargetReached === true) {
    afterTargetLine =
      'After target: keep interviewing; queue qualified candidates for later release (when execution exists).';
  } else {
    afterTargetLine = 'After target: do not maintain a waiting pool — automatic hiring stops at the cap.';
  }

  return {
    lines: [
      `AI prescreen required: ${prescreen}`,
      `Auto-hiring active: ${hiringOn}`,
      `Auto-onboarding active: ${onboardOn}`,
      `Hiring entity: ${entityLine}`,
      stopLine,
      afterTargetLine,
    ],
  };
}
