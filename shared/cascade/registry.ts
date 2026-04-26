/**
 * Cascading Order Data — field registry.
 *
 * This is the single source of truth for cascade behaviour. The
 * engine in `./resolveCascadedField.ts` (added in O.2) reads this
 * map and dispatches per-field on the declared strategy. Adding a
 * new cascading field = one entry here + tests; no engine change
 * required.
 *
 * Mirrored to `src/shared/cascade/registry.ts` for the CRA bundle.
 * They MUST stay in sync byte-for-byte.
 *
 * See the "Cascading Order Data system" handoff (2026-04-26) §4
 * for the source spec, and §13 for locked open-question answers.
 */

import type { CascadeFieldSpec } from './types';

/**
 * Every cascading field declares ONE strategy. The shape-lock test
 * in `src/shared/cascade/__tests__/registry.test.ts` enforces:
 *
 *  - every entry has a known strategy + non-empty label
 *  - every entry has at least one editable level
 *  - `keyed_list` entries declare `identityKey` AND `itemFields`
 *  - `union_with_remove` entries declare `itemIdentity`
 *  - `level_only` entries have exactly one editable level
 *  - `itemFields` entries recursively pass the same checks
 *
 * Use `satisfies` so `CascadingFieldKey` (below) narrows to the
 * exact set of registered keys for typesafe consumers, while still
 * meeting the `Record<string, CascadeFieldSpec>` contract spec'd
 * in handoff §4.
 */
export const CASCADE_REGISTRY = {
  // -- Single-value fields (replace) ---------------------------------

  scheduler: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo', 'shift'],
    label: 'Scheduler',
  },
  hiringEntityId: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Hiring Entity',
  },
  eVerifyRequired: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'E-Verify Required',
  },
  // AccuSource screening package id (matches Phase B's existing usage; UI label
  // "AccuSource screening package"). The codebase has both `screeningPackageId`
  // and `backgroundCheckPackageId` floating around — `screeningPackageId` is
  // the canonical name (handoff §13.1); the alias is renamed during O.4.
  screeningPackageId: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo'],
    label: 'AccuSource Screening Package',
  },
  // Add-on screenings layered on top of the AccuSource package
  // (healthcare, credentials, etc.). UI dropdown "Additional Screenings".
  additionalScreenings: {
    strategy: 'union_with_remove',
    itemIdentity: 'string_exact',
    editableAt: ['account', 'child', 'jo'],
    label: 'Additional Screenings',
  },

  billingContact: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Billing Contact',
  },
  invoiceAddress: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Invoice Address',
  },

  // -- Stackable fields (union_with_remove + merge_deep) -------------

  // Stacks across all four levels. Slug identity so "Cowboy Boots"
  // and "cowboy_boots" resolve as the same item across levels.
  uniformRequirements: {
    strategy: 'union_with_remove',
    itemIdentity: 'slug',
    editableAt: ['account', 'child', 'jo', 'shift'],
    label: 'Uniform Requirements',
  },
  staffInstructions: {
    strategy: 'merge_deep',
    editableAt: ['account', 'child', 'jo', 'shift'],
    label: 'Staff Instructions',
  },
  customerSpecificRules: {
    strategy: 'merge_deep',
    editableAt: ['account', 'child', 'jo'],
    label: 'Customer-Specific Rules',
  },

  // -- Positions (keyed_list — the hard case) ------------------------

  // Per handoff §5: Account defines the "header" fields (job title,
  // description, markup, rateMode); Child supplies pricing
  // (payRate, futa, suta, wcRate). JO does NOT override position
  // pricing — it selects which positions to use via
  // `selectedPositionIds` below. Hazard-pay scenarios duplicate the
  // position at the Child level under a different positionId.
  positions: {
    strategy: 'keyed_list',
    identityKey: 'positionId',
    editableAt: ['account', 'child'],
    label: 'Positions',
    itemFields: {
      jobTitle: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Job Title',
      },
      jobDescription: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Job Description',
      },
      rateMode: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Rate Mode',
      },
      // Pay/bill/tax rates live exclusively at the location
      // (`child`) tier per handoff §13.3. Engine refuses to honour
      // these at any other level via the `editableAt` guard.
      // `requiredForCompleteness: true` flags these as the gate the
      // auto-JO-creator (handoff §14.1) checks before auto-selecting
      // a position on a generated JO.
      payRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'Pay Rate',
      },
      billRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'Bill Rate',
      },
      markupPercentage: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Markup %',
      },
      futa: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'FUTA',
      },
      suta: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'SUTA',
      },
      workersCompRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: "Workers' Comp",
      },
    },
  },

  // -- JO-only references --------------------------------------------

  // Which positions (defined upstream) are used for THIS job order.
  // No cascade — set on the JO directly. References positionIds
  // from the merged Account+Child set.
  selectedPositionIds: {
    strategy: 'level_only',
    editableAt: ['jo'],
    label: 'Selected Positions',
  },

  // JO-level template that pre-populates the click-to-create-shift
  // form (handoff §14.2). The cascade engine treats this like any
  // other `level_only` field: read from the JO, return as-is, no
  // ancestor walking. The value's structure is documented by the
  // `ShiftTemplate` interface in `./types.ts` — kept off the
  // registry because the engine doesn't need to know about it.
  shiftTemplate: {
    strategy: 'level_only',
    editableAt: ['jo'],
    label: 'Shift Template',
  },
} as const satisfies Record<string, CascadeFieldSpec>;

/**
 * Narrowed key type for typesafe consumers. The engine is generic
 * over this so callers like
 * `resolveCascadedField('uniformRequirements', chain)` get
 * autocomplete + the right return type without runtime checks.
 */
export type CascadingFieldKey = keyof typeof CASCADE_REGISTRY;
