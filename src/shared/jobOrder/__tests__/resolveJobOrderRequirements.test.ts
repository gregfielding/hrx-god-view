/**
 * Tests for `resolveJobOrderRequirementsForPosition` and friends.
 *
 * Pure helpers — no Firestore, no React, no async. Tests cover the
 * override contract documented at the top of
 * `../resolveJobOrderRequirements.ts`:
 *   - missing / undefined / null position field → inherit JO default
 *   - empty string / empty array → explicit "no requirement" override
 *   - non-empty value → explicit override
 *   - career-style call (`position = null`) → JO defaults verbatim
 *   - source attribution (`jobOrder` vs `positionOverride`)
 *   - override count predicate
 *
 * Jest (CRA `npm test`).
 */

import {
  ALL_REQUIREMENT_FIELD_KEYS,
  countPositionRequirementOverrides,
  isPositionRequirementOverridden,
  resolveJobOrderRequirementsForPosition,
  resolveJobOrderRequirementsForPositionWithSources,
  type GigPositionRequirementOverrides,
  type RequirementsCarrierJobOrder,
  type RequirementsCarrierPosition,
} from '../resolveJobOrderRequirements';

const JO_DEFAULTS: RequirementsCarrierJobOrder = {
  screeningPackageId: 'pkg_default',
  screeningPackageName: 'Default Screening',
  additionalScreenings: ['TB Test'],
  licensesCerts: ['Food Handler'],
  experienceRequired: 'entry',
  educationRequired: 'high_school',
  languagesRequired: ['English'],
  skillsRequired: ['Customer Service'],
  physicalRequirements: ['Standing'],
  ppeRequirements: ['Slip-resistant shoes'],
  ppeProvidedBy: 'company',
  dressCode: ['Black pants', 'White shirt'],
  customUniformRequirements: 'Hair net required',
};

describe('resolveJobOrderRequirementsForPosition — career-style call (no position)', () => {
  it('returns JO defaults verbatim when position is null', () => {
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, null);
    expect(out.screeningPackageId).toBe('pkg_default');
    expect(out.licensesCerts).toEqual(['Food Handler']);
    expect(out.dressCode).toEqual(['Black pants', 'White shirt']);
    expect(out.experienceRequired).toBe('entry');
  });

  it('returns JO defaults verbatim when position is undefined', () => {
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, undefined);
    expect(out.licensesCerts).toEqual(['Food Handler']);
  });

  it('coerces missing JO and missing position to safe empty values', () => {
    const out = resolveJobOrderRequirementsForPosition(null, null);
    expect(out.screeningPackageId).toBe('');
    expect(out.licensesCerts).toEqual([]);
    expect(out.experienceRequired).toBe('');
    expect(out.dressCode).toEqual([]);
  });
});

describe('resolveJobOrderRequirementsForPosition — inherit semantics', () => {
  it('inherits every field when position has no `requirements` map at all', () => {
    const position: RequirementsCarrierPosition = {};
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['Food Handler']);
    expect(out.experienceRequired).toBe('entry');
    expect(out.dressCode).toEqual(['Black pants', 'White shirt']);
  });

  it('inherits every field when `requirements` is an empty object', () => {
    const position: RequirementsCarrierPosition = { requirements: {} };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['Food Handler']);
    expect(out.experienceRequired).toBe('entry');
  });

  it('treats `undefined` field on the override map as inherit', () => {
    const overrides: GigPositionRequirementOverrides = {
      licensesCerts: undefined,
      experienceRequired: undefined,
    };
    const position: RequirementsCarrierPosition = { requirements: overrides };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['Food Handler']);
    expect(out.experienceRequired).toBe('entry');
  });

  it('treats `null` field on the override map as inherit (UI-clear semantics)', () => {
    const overrides: GigPositionRequirementOverrides = {
      licensesCerts: null,
      experienceRequired: null,
      screeningPackageId: null,
    };
    const position: RequirementsCarrierPosition = { requirements: overrides };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['Food Handler']);
    expect(out.experienceRequired).toBe('entry');
    expect(out.screeningPackageId).toBe('pkg_default');
  });
});

describe('resolveJobOrderRequirementsForPosition — explicit overrides', () => {
  it('replaces an inherited array with an explicit non-empty override', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: ['Food Handler', 'Bartender (TIPS)'],
      },
    };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['Food Handler', 'Bartender (TIPS)']);
    // unrelated fields still inherit
    expect(out.experienceRequired).toBe('entry');
  });

  it('treats `[]` as an explicit "no requirement" override (Janitors removing the JO Food Handler default)', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: [],
      },
    };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual([]);
    // JO had a default, but the position explicitly cleared it
    expect(JO_DEFAULTS.licensesCerts).toEqual(['Food Handler']);
  });

  it('treats `\'\'` as an explicit "no value" override for string fields', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        experienceRequired: '',
        ppeProvidedBy: '',
      },
    };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.experienceRequired).toBe('');
    expect(out.ppeProvidedBy).toBe('');
    // unrelated fields inherit
    expect(out.educationRequired).toBe('high_school');
  });

  it('mixes overrides and inherited fields cleanly within one position', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: ['CPR'],
        // additionalScreenings inherits → ['TB Test']
        experienceRequired: '2_years',
        // educationRequired inherits → 'high_school'
        skillsRequired: [],
      },
    };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['CPR']);
    expect(out.additionalScreenings).toEqual(['TB Test']);
    expect(out.experienceRequired).toBe('2_years');
    expect(out.educationRequired).toBe('high_school');
    expect(out.skillsRequired).toEqual([]);
    expect(out.languagesRequired).toEqual(['English']);
  });

  it('drops non-string array entries on coercion (defensive)', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: ['CPR', 42 as unknown as string, null as unknown as string, 'BLS'],
      },
    };
    const out = resolveJobOrderRequirementsForPosition(JO_DEFAULTS, position);
    expect(out.licensesCerts).toEqual(['CPR', 'BLS']);
  });
});

describe('isPositionRequirementOverridden', () => {
  it('returns false when position is null / undefined', () => {
    expect(isPositionRequirementOverridden(null, 'licensesCerts')).toBe(false);
    expect(isPositionRequirementOverridden(undefined, 'licensesCerts')).toBe(false);
  });

  it('returns false when requirements map is missing', () => {
    expect(isPositionRequirementOverridden({}, 'licensesCerts')).toBe(false);
  });

  it('returns false when override key is undefined or null', () => {
    expect(
      isPositionRequirementOverridden(
        { requirements: { licensesCerts: undefined } },
        'licensesCerts',
      ),
    ).toBe(false);
    expect(
      isPositionRequirementOverridden(
        { requirements: { licensesCerts: null } },
        'licensesCerts',
      ),
    ).toBe(false);
  });

  it('returns true for empty array (explicit "no requirement")', () => {
    expect(
      isPositionRequirementOverridden(
        { requirements: { licensesCerts: [] } },
        'licensesCerts',
      ),
    ).toBe(true);
  });

  it('returns true for empty string (explicit "no value")', () => {
    expect(
      isPositionRequirementOverridden(
        { requirements: { experienceRequired: '' } },
        'experienceRequired',
      ),
    ).toBe(true);
  });

  it('returns true for non-empty values', () => {
    expect(
      isPositionRequirementOverridden(
        { requirements: { licensesCerts: ['CPR'] } },
        'licensesCerts',
      ),
    ).toBe(true);
  });
});

describe('countPositionRequirementOverrides', () => {
  it('returns 0 for null / empty positions', () => {
    expect(countPositionRequirementOverrides(null)).toBe(0);
    expect(countPositionRequirementOverrides(undefined)).toBe(0);
    expect(countPositionRequirementOverrides({})).toBe(0);
    expect(countPositionRequirementOverrides({ requirements: {} })).toBe(0);
  });

  it('counts only explicit overrides, not inherited / null fields', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: ['CPR'], // override
        skillsRequired: [], // override (explicit empty)
        experienceRequired: undefined, // inherit
        educationRequired: null, // inherit
        languagesRequired: ['English'], // override
      },
    };
    expect(countPositionRequirementOverrides(position)).toBe(3);
  });
});

describe('resolveJobOrderRequirementsForPositionWithSources', () => {
  it('attributes every field to `jobOrder` when nothing is overridden', () => {
    const out = resolveJobOrderRequirementsForPositionWithSources(JO_DEFAULTS, {});
    for (const key of ALL_REQUIREMENT_FIELD_KEYS) {
      expect(out.sources[key]).toBe('jobOrder');
    }
    expect(out.values.licensesCerts).toEqual(['Food Handler']);
  });

  it('attributes only overridden fields to `positionOverride`', () => {
    const position: RequirementsCarrierPosition = {
      requirements: {
        licensesCerts: ['CPR'],
        experienceRequired: '',
      },
    };
    const out = resolveJobOrderRequirementsForPositionWithSources(JO_DEFAULTS, position);
    expect(out.sources.licensesCerts).toBe('positionOverride');
    expect(out.sources.experienceRequired).toBe('positionOverride');
    expect(out.sources.educationRequired).toBe('jobOrder');
    expect(out.sources.skillsRequired).toBe('jobOrder');
    expect(out.values.licensesCerts).toEqual(['CPR']);
    expect(out.values.experienceRequired).toBe('');
    expect(out.values.skillsRequired).toEqual(['Customer Service']);
  });

  it('every overridable key appears in the sources map', () => {
    const out = resolveJobOrderRequirementsForPositionWithSources(JO_DEFAULTS, null);
    const sourceKeys = Object.keys(out.sources).sort();
    const expected = [...ALL_REQUIREMENT_FIELD_KEYS].sort();
    expect(sourceKeys).toEqual(expected);
  });
});
