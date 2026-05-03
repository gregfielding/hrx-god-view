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

  // §16.2c — promoted to snapshot-on-activation. The scheduler array
  // is "stamped onto new orders" today (per `RECRUITING_ROLE_MODEL.md`
  // §2.2 — the first id becomes `jobOrder.schedulerUid`). With the
  // snapshot trigger now capturing `roles.schedulerIds`, post-edit
  // changes at the parent require Push-to-Active to propagate to
  // existing JOs.
  //
  // V1 caveat (R.16.2c L2): the snapshot captures the array; the
  // live JO field `schedulerUid` (single-uid stamp set at JO
  // creation by `onJobOrderWriteStampScheduler`) is NOT updated by
  // the push. Consumer rewire to honor `snapshot.scheduler` over
  // `jobOrder.schedulerUid` is deferred to R.16.2d if the consumer
  // audit at impl time finds it warranted.
  scheduler: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo', 'shift'],
    label: 'Scheduler',
    propagation: 'snapshot-on-activation',
  },
  // Compliance anchor: changing the hiring entity on a live JO
  // changes which legal entity workers are paid by. Snapshot at
  // activation; admin uses Push-to-Active for explicit propagation.
  hiringEntityId: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Hiring Entity',
    propagation: 'snapshot-on-activation',
  },
  // I-9/E-Verify cohort ruling for the JO. Snapshot at activation
  // so a workforce already past onboarding doesn't suddenly need
  // E-Verify enrolment because Account toggled the flag.
  eVerifyRequired: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'E-Verify Required',
    propagation: 'snapshot-on-activation',
  },
  // §16.1 L3 — added to the registry alongside `workersCompRate`
  // (which lives at the position level). Top-level field on both
  // `RecruiterAccount` and `JobOrder`. Snapshot at activation —
  // changing WC code retroactively could mis-classify in-flight
  // workers' comp claims.
  workersCompCode: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: "Workers' Comp Code",
    propagation: 'snapshot-on-activation',
  },
  // AccuSource screening package id (matches Phase B's existing usage; UI label
  // "AccuSource screening package"). The codebase has both `screeningPackageId`
  // and `backgroundCheckPackageId` floating around — `screeningPackageId` is
  // the canonical name (handoff §13.1); the alias is renamed during O.4.
  //
  // Snapshot at activation: once a JO is open and we've ordered
  // checks against a package, downstream changes to the parent's
  // package shouldn't retroactively re-define what the JO required.
  // R.11 drift detection still fires — see §16.1 L5 for the
  // snapshot-aware update.
  screeningPackageId: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo'],
    label: 'AccuSource Screening Package',
    propagation: 'snapshot-on-activation',
  },
  // Add-on screenings layered on top of the AccuSource package
  // (healthcare, credentials, etc.). UI dropdown "Additional Screenings".
  // Same snapshot rationale as `screeningPackageId`.
  additionalScreenings: {
    strategy: 'union_with_remove',
    itemIdentity: 'string_exact',
    editableAt: ['account', 'child', 'jo'],
    label: 'Additional Screenings',
    propagation: 'snapshot-on-activation',
  },

  // §16.2c — National-account flat markup % (`pricing.flatMarkupPercent`).
  // Applied across all positions when `subAccountsManageOwnPricing`
  // is false. Snapshot at activation so a CSA raising the flat rate
  // post-activation doesn't silently re-bill every active JO under
  // the National. Same financial-blast-radius rationale as the per-
  // position pricing fields. Always captured per L4 — the
  // "subAccountsManageOwnPricing" flag is a UI-mode indicator and
  // doesn't gate snapshot capture.
  pricingFlatMarkupPercent: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Flat Markup %',
    propagation: 'snapshot-on-activation',
  },

  // §16.2c — Required physical capabilities (`orderDefaults.orderDetails.physicalRequirements`,
  // string array). Consumed by worker prescreen + readiness eligibility:
  // a worker hired against "Lifting 50 lbs" shouldn't fail readiness if
  // the CSA later tightens the requirement to "Lifting 75 lbs". Snapshot
  // at activation pins the bar the worker was hired under.
  physicalRequirements: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo'],
    label: 'Physical Requirements',
    propagation: 'snapshot-on-activation',
  },

  // §16.2c — Freeform custom uniform requirements text
  // (`orderDefaults.orderDetails.customUniformRequirements`). Shown on
  // JO header + worker app onboarding screens. Snapshot at activation
  // so a CSA editing the text post-activation doesn't retroactively
  // change what the worker agreed to.
  customUniformRequirements: {
    strategy: 'replace',
    editableAt: ['account', 'child', 'jo'],
    label: 'Custom Uniform Requirements',
    propagation: 'snapshot-on-activation',
  },

  // §16.2c — "Other Attachments" file metadata array
  // (`orderDefaults.staffInstructions.attachments.files`). Shape:
  // `Array<{name?, label?, url?, uploadedAt?}>`. Snapshot at
  // activation captures the document set the JO was activated under;
  // post-activation file additions/removals at the parent require
  // Push-to-Active to propagate. Storage objects themselves are
  // unaffected (only the metadata reference list snapshots).
  //
  // V1 strategy: `replace` (parent value wins outright). Per L3
  // we considered `union_with_remove` (parent + child stack) but
  // deferred — the V1 cascade just isn't stacking attachments
  // today, so `replace` matches current behavior + adds the
  // snapshot freeze.
  attachments: {
    strategy: 'replace',
    editableAt: ['account', 'child'],
    label: 'Other Attachments',
    propagation: 'snapshot-on-activation',
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

  // -- Posting (handoff §15.3) ---------------------------------------

  // Per-section show/hide toggles for the public job board. Cascades
  // Account → Child → JO via merge_deep so a tenant can set "default
  // hide education" at the Account level and override per-JO. The
  // forward-sync trigger (P.2) reads these resolved values into the
  // posting doc; the engine itself does NOT layer `defaults` into the
  // resolved value — they're only consumed by the Account-creation
  // seed flow (handoff §15.3 + decision 2026-04-26 Q3=a).
  //
  // Naming note: registry key is camelCase flat (`postingVisibility`)
  // per decision 2026-04-26 Q2 — matches existing keys like
  // `screeningPackageId`, `shiftTemplate`. Spec text uses dotted
  // `posting.visibility` for the conceptual grouping; the registry
  // is flat. Value shape lives on `PostingVisibility` in `./types.ts`.
  postingVisibility: {
    strategy: 'merge_deep',
    editableAt: ['account', 'child', 'jo'],
    label: 'Posting Visibility',
    defaults: {
      // Compensation & timing
      showPayRate: true,
      showStartDate: true,
      showEndDate: false,
      showShiftTimes: true,
      // Requirements
      showSkills: true,
      showLicensesCerts: true,
      showExperience: false,
      showEducation: false,
      showLanguages: false,
      showPhysicalRequirements: true,
      showUniformRequirements: true,
      showPpe: true,
      // Screening
      showBackgroundChecks: false,
      showDrugScreening: false,
      showAdditionalScreenings: false,
      showEVerify: false,
    },
  },

  // Posting lifecycle policy. Read by:
  //  - `gigJobOrderStatusSync` for auto-publish / auto-unpublish on
  //    open-shift transitions (handoff §15.7).
  //  - The auto-create-posting flow (handoff §14.3 / §15.7) for
  //    `defaultExpirationDays` and `autoAddToUserGroup`.
  //  - The Posting form to seed expiration / max-applications.
  //
  // No `defaults` block — handoff §15.3 deliberately omits them so
  // policy stays opt-in per tenant; the absence of a value means
  // "feature off". `merge_deep` lets descendants explicitly clear an
  // ancestor's setting via `null` (e.g. Child sets
  // `defaultExpirationDays: null` to override Account's 30).
  postingPolicy: {
    strategy: 'merge_deep',
    editableAt: ['account', 'child', 'jo'],
    label: 'Posting Policy',
  },

  // -- Positions (keyed_list — the hard case) ------------------------

  // Per handoff §5: Account defines the "header" fields (job title,
  // description, markup, rateMode); Child supplies pricing
  // (payRate, futa, suta, wcRate). JO does NOT override position
  // pricing — it selects which positions to use via
  // `selectedPositionIds` below. Hazard-pay scenarios duplicate the
  // position at the Child level under a different positionId.
  //
  // Top-level propagation: 'snapshot-on-activation' — at draft→active,
  // the snapshot trigger captures the resolved+filtered positions
  // list (filtered by `selectedPositionIds`) as one blob into
  // `jo.snapshot.positions`. Per-item sub-field propagation policies
  // below are advisory documentation in §16.1; the trigger snapshots
  // the whole list as one unit. See §16.1 L1 for rationale.
  positions: {
    strategy: 'keyed_list',
    identityKey: 'positionId',
    editableAt: ['account', 'child'],
    label: 'Positions',
    propagation: 'snapshot-on-activation',
    itemFields: {
      // Header fields live at account/child; spec §16.3 considers
      // them "live" (editing the title/description on the parent
      // legitimately propagates to draft JOs that haven't activated).
      // Once a JO activates, the snapshot blob carries the title/
      // description forward unchanged — that part is a side-effect
      // of `positions` itself being snapshotted at the parent level.
      jobTitle: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Job Title',
        propagation: 'live',
      },
      jobDescription: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Job Description',
        propagation: 'live',
      },
      // rateMode change retroactively would re-classify how billing
      // computes from pay/bill/markup. Snapshot at activation.
      rateMode: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Rate Mode',
        propagation: 'snapshot-on-activation',
      },
      // Pay/bill/tax rates live exclusively at the location
      // (`child`) tier per handoff §13.3. Engine refuses to honour
      // these at any other level via the `editableAt` guard.
      // `requiredForCompleteness: true` flags these as the gate the
      // auto-JO-creator (handoff §14.1) checks before auto-selecting
      // a position on a generated JO.
      //
      // All five pricing/tax fields snapshot at activation — these
      // are the financial blast-radius fields §16.1 was scoped to
      // protect. Account-level edits to any of them on a CORT
      // National Account would silently re-bill every active JO
      // without §16 in place.
      payRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'Pay Rate',
        propagation: 'snapshot-on-activation',
      },
      billRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'Bill Rate',
        propagation: 'snapshot-on-activation',
      },
      markupPercentage: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Markup %',
        propagation: 'snapshot-on-activation',
      },
      futa: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'FUTA',
        propagation: 'snapshot-on-activation',
      },
      suta: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: 'SUTA',
        propagation: 'snapshot-on-activation',
      },
      workersCompRate: {
        strategy: 'replace',
        editableAt: ['child'],
        requiredForCompleteness: true,
        label: "Workers' Comp",
        propagation: 'snapshot-on-activation',
      },
      /** Compliance / requirements overlay for this title — merges atop account orderDefaults when the position is selected. */
      orderDetails: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Position compliance',
        propagation: 'live',
      },
      screeningPackageId: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Screening package id',
        propagation: 'live',
      },
      screeningPackageName: {
        strategy: 'replace',
        editableAt: ['account', 'child'],
        label: 'Screening package name',
        propagation: 'live',
      },
    },
  },

  // -- JO-only references --------------------------------------------

  // Which positions (defined upstream) are used for THIS job order.
  // No cascade — set on the JO directly. References positionIds
  // from the merged Account+Child set.
  //
  // Snapshot at activation: even though it's `level_only` to begin
  // with, freezing the selection at activation gives Push-to-Active
  // a consistent surface to operate over. Pre-activation edits via
  // the JO form continue to work as before; the snapshot is read-
  // through after activation.
  selectedPositionIds: {
    strategy: 'level_only',
    editableAt: ['jo'],
    label: 'Selected Positions',
    propagation: 'snapshot-on-activation',
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
