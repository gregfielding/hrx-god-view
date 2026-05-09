/**
 * **Per-position requirements resolution** — pure, sync, library-only.
 *
 * Slice 1 of three (data + resolver, no UI, no reader rewires) for the
 * gig-position requirements override work. Career JOs don't carry
 * positions at this layer; pass `null` and the resolver returns the JO
 * defaults verbatim.
 *
 * ## Why this helper exists
 *
 * Today every gig position on a JO inherits the JO's flat
 * Compliance & Requirements block (`screeningPackageId`,
 * `licensesCerts`, `additionalScreenings`, `experienceRequired`, etc.).
 * That's wrong for events that mix roles: a Cooks position needs a
 * Food Handler card, but a Janitors position on the same JO does not;
 * a Bartenders position needs an alcohol cert, the rest don't. The
 * fix is to let each `gigPositions[i]` carry an optional
 * `requirements` map of overrides, with the JO's flat fields acting
 * as the inherit-from default.
 *
 * ## Override contract
 *
 * For every overridable key:
 *
 *   - key missing OR value is `undefined` OR value is `null`
 *       → INHERIT the JO default
 *   - any other value (including `''` for strings or `[]` for arrays)
 *       → EXPLICIT OVERRIDE — wins over the JO default
 *
 * The empty-but-explicit case is intentional and meaningful:
 *   - `position.requirements.licensesCerts = []` means "this position
 *     requires no certifications, even though the JO defaults list
 *     some" (e.g. Janitors on a JO whose default certs are for
 *     Cooks).
 *   - `position.requirements.experienceRequired = ''` means "this
 *     position requires no specific experience, even though the JO
 *     default specifies some level."
 *
 * That distinction is what lets a recruiter REMOVE a JO-default cert
 * for one position without affecting siblings.
 *
 * ## What's overridable
 *
 * Per Greg's "wide" scope decision (May 2026):
 *   - screening: `screeningPackageId`, `screeningPackageName`,
 *     `additionalScreenings`
 *   - credentials: `licensesCerts`
 *   - knowledge: `experienceRequired`, `educationRequired`,
 *     `languagesRequired`, `skillsRequired`
 *   - physical/dress: `physicalRequirements`, `ppeRequirements`,
 *     `ppeProvidedBy`, `dressCode`, `customUniformRequirements`
 *
 * What's deliberately NOT overridable per-position:
 *   - `eVerifyRequired` — driven by the hiring entity, JO-level
 *     reflection of an entity-level fact.
 *   - `backgroundCheckRequired`, `drugScreenRequired` — duplicative
 *     with `screeningPackageId` / `additionalScreenings`. Override
 *     the actual screening fields instead.
 *   - `requirementPackId` — the bundled-pack identifier records WHICH
 *     pack the requirements came from. Overrides edit the resolved
 *     set; the pack stays JO-level.
 *
 * ## Career JOs
 *
 * Career JOs flatten one position's pricing onto the JO doc and don't
 * use `gigPositions[]` at this layer. Pass `null` for the position
 * argument and the resolver returns JO defaults verbatim — same shape
 * the legacy readers already produce. Career-side behaviour is
 * unchanged from this PR; the helper just makes the call site
 * symmetric so slice 3 can route every reader through one path.
 *
 * ## Why pure / library-only
 *
 * This is the same posture as `getEffectiveJobOrderField`: pure, sync,
 * no Firestore, no React, no async. Slice 1 ships the helper without
 * rewiring any consumer (Apply gate, orchestrator scoring, onboarding
 * checklist seed, Job Post post-creation default). Slice 3 flips
 * those readers in one focused PR. Keeping the resolver standalone
 * means slice 3 doesn't need to touch the engine again.
 */

/**
 * Keys that may carry a per-position override. The intersection of
 * "JO-level Compliance & Requirements field" and "varies meaningfully
 * by position role" — see file docstring for the rationale.
 */
export type JobOrderRequirementFieldKey =
  | 'screeningPackageId'
  | 'screeningPackageName'
  | 'additionalScreenings'
  | 'licensesCerts'
  | 'experienceRequired'
  | 'educationRequired'
  | 'languagesRequired'
  | 'skillsRequired'
  | 'physicalRequirements'
  | 'ppeRequirements'
  | 'ppeProvidedBy'
  | 'dressCode'
  | 'customUniformRequirements';

/**
 * Per-position override map. Every field is optional. The override
 * contract is documented at the top of this file:
 *   - missing / `undefined` / `null` → inherit the JO default
 *   - anything else (including `''` and `[]`) → explicit override
 *
 * String fields use empty string `''` as the "explicit none" sentinel.
 * Array fields use empty array `[]` as the "explicit none" sentinel.
 */
export type GigPositionRequirementOverrides = {
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  additionalScreenings?: string[] | null;
  licensesCerts?: string[] | null;
  experienceRequired?: string | null;
  educationRequired?: string | null;
  languagesRequired?: string[] | null;
  skillsRequired?: string[] | null;
  physicalRequirements?: string[] | null;
  ppeRequirements?: string[] | null;
  ppeProvidedBy?: string | null;
  dressCode?: string[] | null;
  customUniformRequirements?: string | null;
};

/**
 * Minimal-surface input type for a JO doc passed to the resolver.
 * The resolver only reads JO-level requirement defaults — it does not
 * walk `gigPositions[]` (the caller passes the relevant position
 * separately). Intentionally permissive (each field optional and
 * widened) so Firestore docs, form state, and snapshot blobs all type
 * fit without per-call casting.
 */
export type RequirementsCarrierJobOrder = {
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  additionalScreenings?: string[] | null;
  licensesCerts?: string[] | null;
  experienceRequired?: string | null;
  educationRequired?: string | null;
  languagesRequired?: string[] | null;
  skillsRequired?: string[] | null;
  physicalRequirements?: string[] | null;
  ppeRequirements?: string[] | null;
  ppeProvidedBy?: string | null;
  dressCode?: string[] | null;
  customUniformRequirements?: string | null;
};

/**
 * Minimal-surface input type for a gig position. The resolver only
 * reads `requirements`; identity / pricing / job title fields aren't
 * used here. Other fields can ride along on the actual position
 * object — the caller doesn't need to strip them.
 */
export type RequirementsCarrierPosition = {
  requirements?: GigPositionRequirementOverrides | null;
};

/**
 * Resolved requirement values, one per overridable key. Always
 * concrete (no `null`, no `undefined`) — defaults to `''` or `[]` as
 * appropriate so consumers don't need null-guards. Mirrors the shape
 * of the JO-level Compliance & Requirements form section.
 */
export type EffectiveJobOrderRequirements = {
  screeningPackageId: string;
  screeningPackageName: string;
  additionalScreenings: string[];
  licensesCerts: string[];
  experienceRequired: string;
  educationRequired: string;
  languagesRequired: string[];
  skillsRequired: string[];
  physicalRequirements: string[];
  ppeRequirements: string[];
  ppeProvidedBy: string;
  dressCode: string[];
  customUniformRequirements: string;
};

/**
 * Per-field source attribution after resolution. `'jobOrder'` means
 * the value came from the JO defaults (position inherited or had no
 * override for this field). `'positionOverride'` means the position's
 * `requirements` map carried an explicit value for this field. Used
 * by the Positions-tab UI to render Default vs Override badges.
 */
export type RequirementSource = 'jobOrder' | 'positionOverride';

export type EffectiveJobOrderRequirementsWithSources = {
  values: EffectiveJobOrderRequirements;
  sources: Record<JobOrderRequirementFieldKey, RequirementSource>;
};

/** Truthy override predicate — see override contract above. */
function isOverrideSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  return '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

const STRING_KEYS: ReadonlyArray<
  Extract<
    JobOrderRequirementFieldKey,
    | 'screeningPackageId'
    | 'screeningPackageName'
    | 'experienceRequired'
    | 'educationRequired'
    | 'ppeProvidedBy'
    | 'customUniformRequirements'
  >
> = [
  'screeningPackageId',
  'screeningPackageName',
  'experienceRequired',
  'educationRequired',
  'ppeProvidedBy',
  'customUniformRequirements',
];

const ARRAY_KEYS: ReadonlyArray<
  Extract<
    JobOrderRequirementFieldKey,
    | 'additionalScreenings'
    | 'licensesCerts'
    | 'languagesRequired'
    | 'skillsRequired'
    | 'physicalRequirements'
    | 'ppeRequirements'
    | 'dressCode'
  >
> = [
  'additionalScreenings',
  'licensesCerts',
  'languagesRequired',
  'skillsRequired',
  'physicalRequirements',
  'ppeRequirements',
  'dressCode',
];

/**
 * Returns `true` iff the given position carries an explicit override
 * for `fieldKey` (i.e. would NOT inherit the JO default for this
 * field). `undefined` and `null` always read as inherit; any other
 * value — including `''` for strings and `[]` for arrays — is an
 * explicit override.
 *
 * Used by the Positions-tab UI to decide whether to show a
 * "Reset to default" button next to each field.
 */
export function isPositionRequirementOverridden(
  position: RequirementsCarrierPosition | null | undefined,
  fieldKey: JobOrderRequirementFieldKey,
): boolean {
  if (!position) return false;
  const overrides = position.requirements;
  if (!overrides) return false;
  return isOverrideSet(overrides[fieldKey]);
}

/**
 * Resolves the effective requirement set for a given position on a
 * given JO. Career JOs (or any caller without a position) pass
 * `null` and get JO defaults verbatim.
 *
 * Pure: same `(jo, position)` always returns identical output.
 */
export function resolveJobOrderRequirementsForPosition(
  jo: RequirementsCarrierJobOrder | null | undefined,
  position: RequirementsCarrierPosition | null | undefined,
): EffectiveJobOrderRequirements {
  const joSafe: RequirementsCarrierJobOrder = jo ?? {};
  const overrides: GigPositionRequirementOverrides =
    (position && position.requirements) || {};

  const resolveString = (key: typeof STRING_KEYS[number]): string => {
    const o = overrides[key];
    if (isOverrideSet(o)) return asString(o);
    return asString(joSafe[key]);
  };

  const resolveArray = (key: typeof ARRAY_KEYS[number]): string[] => {
    const o = overrides[key];
    if (isOverrideSet(o)) return asStringArray(o);
    return asStringArray(joSafe[key]);
  };

  return {
    screeningPackageId: resolveString('screeningPackageId'),
    screeningPackageName: resolveString('screeningPackageName'),
    experienceRequired: resolveString('experienceRequired'),
    educationRequired: resolveString('educationRequired'),
    ppeProvidedBy: resolveString('ppeProvidedBy'),
    customUniformRequirements: resolveString('customUniformRequirements'),
    additionalScreenings: resolveArray('additionalScreenings'),
    licensesCerts: resolveArray('licensesCerts'),
    languagesRequired: resolveArray('languagesRequired'),
    skillsRequired: resolveArray('skillsRequired'),
    physicalRequirements: resolveArray('physicalRequirements'),
    ppeRequirements: resolveArray('ppeRequirements'),
    dressCode: resolveArray('dressCode'),
  };
}

/**
 * Same resolution as {@link resolveJobOrderRequirementsForPosition}
 * but also reports per-field source attribution. Use this on the
 * Positions tab where the UI needs to show "Default" vs "Override"
 * badges; use the simpler resolver everywhere else.
 */
export function resolveJobOrderRequirementsForPositionWithSources(
  jo: RequirementsCarrierJobOrder | null | undefined,
  position: RequirementsCarrierPosition | null | undefined,
): EffectiveJobOrderRequirementsWithSources {
  const values = resolveJobOrderRequirementsForPosition(jo, position);
  const sources = {} as Record<JobOrderRequirementFieldKey, RequirementSource>;

  for (const key of STRING_KEYS) {
    sources[key] = isPositionRequirementOverridden(position, key)
      ? 'positionOverride'
      : 'jobOrder';
  }
  for (const key of ARRAY_KEYS) {
    sources[key] = isPositionRequirementOverridden(position, key)
      ? 'positionOverride'
      : 'jobOrder';
  }
  return { values, sources };
}

/**
 * Counts how many fields the position has explicitly overridden.
 * Returns `0` when the position is `null`, has no `requirements`
 * map, or has only inherit-default entries. Drives the
 * "Using job-order defaults" vs "3 overrides" summary line on each
 * position card.
 */
export function countPositionRequirementOverrides(
  position: RequirementsCarrierPosition | null | undefined,
): number {
  if (!position?.requirements) return 0;
  let n = 0;
  for (const key of STRING_KEYS) {
    if (isOverrideSet(position.requirements[key])) n += 1;
  }
  for (const key of ARRAY_KEYS) {
    if (isOverrideSet(position.requirements[key])) n += 1;
  }
  return n;
}

/**
 * All overridable keys, in declaration order. Exposed so the
 * Positions-tab UI can iterate without duplicating the list.
 */
export const ALL_REQUIREMENT_FIELD_KEYS: ReadonlyArray<JobOrderRequirementFieldKey> = [
  ...STRING_KEYS,
  ...ARRAY_KEYS,
];
