/**
 * **R.11** — Pure-logic unit tests for screening-package drift detection.
 *
 * Two pure decision units exercised here:
 *
 *   1. `classifyServiceSetDrift` — set-comparison primitive that decides
 *      `'less_strict' | 'more_strict' | 'incomparable'`.
 *   2. `decideDriftPerCheckAction` — per-check sweep decision unit that
 *      sequences in-flight gating, the already-aligned shortcut, and the
 *      service-set classification.
 *
 * I/O orchestration (Firestore queries, AccuSource catalog reads, batch
 * writes) is covered by the deploy runbook's manual staging smoke per
 * `docs/READINESS_R11_HANDOFF.md` § Verification gate. This file pins
 * the boundary semantics so future plumbing changes can't silently shift
 * what we stamp.
 *
 * Mocha + Chai per `functions/package.json` test script.
 *
 * @see docs/READINESS_R11_HANDOFF.md L3.R11
 */

import { expect } from 'chai';

import { classifyServiceSetDrift } from '../../compliance/screeningAutomationShared';
import {
  decideDriftPerCheckAction,
  type DecideDriftPerCheckArgs,
} from '../../readiness/onJobOrderWriteDetectScreeningPackageDrift';

// ─────────────────────────────────────────────────────────────────────────
// classifyServiceSetDrift — pure set-comparison primitive
// ─────────────────────────────────────────────────────────────────────────

describe('classifyServiceSetDrift — equal sets', () => {
  it('classifies equal sets as less_strict (degenerate; already-aligned shortcut would catch this earlier)', () => {
    const result = classifyServiceSetDrift(['1', '2', '3'], ['1', '2', '3']);
    expect(result.kind).to.equal('less_strict');
    expect(result.missingFromExisting).to.deep.equal([]);
    expect(result.extraInExisting).to.deep.equal([]);
  });

  it('is order-independent (sets, not lists)', () => {
    const a = classifyServiceSetDrift(['3', '1', '2'], ['1', '2', '3']);
    expect(a.kind).to.equal('less_strict');
    const b = classifyServiceSetDrift(['1', '2', '3'], ['3', '1', '2']);
    expect(b.kind).to.equal('less_strict');
  });

  it('dedupes service ids before comparison (catalog-row hygiene)', () => {
    const result = classifyServiceSetDrift(['1', '1', '2'], ['1', '2', '2']);
    expect(result.kind).to.equal('less_strict');
  });
});

describe('classifyServiceSetDrift — less_strict (new ⊂ existing)', () => {
  it('new is a strict subset of existing — older check covers everything new wants', () => {
    const result = classifyServiceSetDrift(['1', '2'], ['1', '2', '3', '4']);
    expect(result.kind).to.equal('less_strict');
    expect(result.missingFromExisting).to.deep.equal([]);
    expect(result.extraInExisting).to.have.members(['3', '4']);
    expect(result.reason).to.match(/strict subset/i);
  });

  it('new is empty set vs non-empty existing — incomparable (catalog miss), not less_strict', () => {
    // A new package with no service ids in the catalog is "we don't
    // know what it requires", not "it requires nothing". Conservative.
    const result = classifyServiceSetDrift([], ['1', '2']);
    expect(result.kind).to.equal('incomparable');
    expect(result.reason).to.match(/no serviceIds/i);
  });
});

describe('classifyServiceSetDrift — more_strict (new ⊄ existing)', () => {
  it('new adds at least one service the existing check does not cover', () => {
    const result = classifyServiceSetDrift(['1', '2', '3'], ['1', '2']);
    expect(result.kind).to.equal('more_strict');
    expect(result.missingFromExisting).to.deep.equal(['3']);
  });

  it('disjoint sets (catalog rebuild) → more_strict; every new service is missing', () => {
    const result = classifyServiceSetDrift(['10', '11'], ['1', '2']);
    expect(result.kind).to.equal('more_strict');
    expect(result.missingFromExisting).to.have.members(['10', '11']);
  });

  it('reports the count of services missing from the existing check in the reason', () => {
    const result = classifyServiceSetDrift(['1', '2', '3', '4'], ['1']);
    expect(result.kind).to.equal('more_strict');
    expect(result.missingFromExisting).to.have.members(['2', '3', '4']);
    expect(result.reason).to.include('3 service');
  });
});

describe('classifyServiceSetDrift — incomparable (fail-safe-in-the-visible-direction)', () => {
  it('null existing → incomparable (legacy check missing requestedServices)', () => {
    const result = classifyServiceSetDrift(['1', '2'], null);
    expect(result.kind).to.equal('incomparable');
    expect(result.reason).to.match(/Existing check has no requestedServices/i);
  });

  it('empty-array existing → incomparable (same legacy case via different stamp)', () => {
    const result = classifyServiceSetDrift(['1', '2'], []);
    expect(result.kind).to.equal('incomparable');
  });

  it('whitespace-only existing entries are treated as empty → incomparable', () => {
    const result = classifyServiceSetDrift(['1'], ['', '   ']);
    expect(result.kind).to.equal('incomparable');
  });

  it('null new → incomparable (catalog miss on new package)', () => {
    const result = classifyServiceSetDrift(null, ['1', '2']);
    expect(result.kind).to.equal('incomparable');
    expect(result.reason).to.match(/No serviceIds resolvable/i);
  });

  it('both null → incomparable', () => {
    const result = classifyServiceSetDrift(null, null);
    expect(result.kind).to.equal('incomparable');
  });

  it('non-array inputs (defensive against malformed Firestore data) → incomparable', () => {
    // TS-side guard, but runtime data may surface as something unexpected.
    const result = classifyServiceSetDrift(
      'not-an-array' as unknown as ReadonlyArray<string>,
      ['1'],
    );
    expect(result.kind).to.equal('incomparable');
  });
});

describe('classifyServiceSetDrift — return-shape invariants', () => {
  it('missingFromExisting is non-empty only when kind === more_strict', () => {
    expect(classifyServiceSetDrift(['1'], ['1', '2']).missingFromExisting).to.deep.equal([]);
    expect(classifyServiceSetDrift(['1', '2', '3'], ['1']).missingFromExisting.length).to.be.greaterThan(0);
    expect(classifyServiceSetDrift(null, ['1']).missingFromExisting).to.deep.equal([]);
    expect(classifyServiceSetDrift(['1'], null).missingFromExisting).to.deep.equal([]);
  });

  it('extraInExisting is non-empty only when kind === less_strict and existing has extras', () => {
    expect(classifyServiceSetDrift(['1'], ['1']).extraInExisting).to.deep.equal([]);
    expect(classifyServiceSetDrift(['1'], ['1', '2']).extraInExisting).to.deep.equal(['2']);
    expect(classifyServiceSetDrift(['1', '2'], ['1']).extraInExisting).to.deep.equal([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// decideDriftPerCheckAction — per-check sweep decision unit
// ─────────────────────────────────────────────────────────────────────────

function args(over: Partial<DecideDriftPerCheckArgs>): DecideDriftPerCheckArgs {
  return {
    hrxStatus: 'in_progress',
    markedCompleteOutsideHrx: false,
    expired: false,
    requestedPackageId: 'pkg_old',
    requestedServices: ['1', '2'],
    newPackageId: 'pkg_new',
    newPackageServiceIds: ['1', '2', '3'],
    ...over,
  };
}

describe('decideDriftPerCheckAction — in-flight gating (R.11 spec definition)', () => {
  it('skips a completed check (hrxStatus=completed)', () => {
    const result = decideDriftPerCheckAction(args({ hrxStatus: 'completed' }));
    expect(result.kind).to.equal('skip_not_in_flight');
  });

  it('skips a canceled check (hrxStatus=canceled)', () => {
    const result = decideDriftPerCheckAction(args({ hrxStatus: 'canceled' }));
    expect(result.kind).to.equal('skip_not_in_flight');
  });

  it('skips a markedCompleteOutsideHrx check', () => {
    const result = decideDriftPerCheckAction(
      args({ hrxStatus: 'in_progress', markedCompleteOutsideHrx: true }),
    );
    expect(result.kind).to.equal('skip_not_in_flight');
  });

  it('skips an R.10 expired check (terminal for drift purposes)', () => {
    const result = decideDriftPerCheckAction(args({ expired: true }));
    expect(result.kind).to.equal('skip_not_in_flight');
  });

  it('does NOT skip a draft / submitted / awaiting_applicant check (still in-flight)', () => {
    expect(decideDriftPerCheckAction(args({ hrxStatus: 'draft' })).kind).to.not.equal(
      'skip_not_in_flight',
    );
    expect(decideDriftPerCheckAction(args({ hrxStatus: 'submitted' })).kind).to.not.equal(
      'skip_not_in_flight',
    );
    expect(decideDriftPerCheckAction(args({ hrxStatus: 'awaiting_applicant' })).kind).to.not.equal(
      'skip_not_in_flight',
    );
  });
});

describe('decideDriftPerCheckAction — already-aligned shortcut (idempotency)', () => {
  it('skips when requestedPackageId === newPackageId (re-fire / re-save)', () => {
    const result = decideDriftPerCheckAction(
      args({ requestedPackageId: 'pkg_x', newPackageId: 'pkg_x' }),
    );
    expect(result.kind).to.equal('skip_already_aligned');
  });

  it('trims whitespace before comparison (legacy hygiene)', () => {
    const result = decideDriftPerCheckAction(
      args({ requestedPackageId: '  pkg_x ', newPackageId: 'pkg_x' }),
    );
    expect(result.kind).to.equal('skip_already_aligned');
  });

  it('does NOT short-circuit when only one side is set (null/empty mismatch)', () => {
    const result = decideDriftPerCheckAction(
      args({ requestedPackageId: '', newPackageId: 'pkg_new' }),
    );
    // Falls through to service-set comparison — empty existing services
    // would normally yield 'less_strict' if newPackageServiceIds is empty
    // too. With our defaults (newServiceIds non-empty, existing services
    // non-empty), this is more_strict via classifyServiceSetDrift's
    // missingFromExisting logic.
    expect(result.kind).to.not.equal('skip_already_aligned');
  });
});

describe('decideDriftPerCheckAction — service-set classification', () => {
  it('skip_less_strict when new is a subset of existing (older check exceeds new)', () => {
    const result = decideDriftPerCheckAction(
      args({ newPackageServiceIds: ['1'], requestedServices: ['1', '2'] }),
    );
    expect(result.kind).to.equal('skip_less_strict');
    if (result.kind === 'skip_less_strict') {
      expect(result.reason).to.match(/strict subset/i);
    }
  });

  it('stamp_drift / more_strict when new adds services the existing check does not cover', () => {
    const result = decideDriftPerCheckAction(
      args({ newPackageServiceIds: ['1', '2', '3'], requestedServices: ['1', '2'] }),
    );
    expect(result.kind).to.equal('stamp_drift');
    if (result.kind === 'stamp_drift') {
      expect(result.driftKind).to.equal('more_strict');
    }
  });

  it('stamp_drift / incomparable when existing requestedServices is null (legacy check)', () => {
    const result = decideDriftPerCheckAction(
      args({ requestedServices: null, newPackageServiceIds: ['1'] }),
    );
    expect(result.kind).to.equal('stamp_drift');
    if (result.kind === 'stamp_drift') {
      expect(result.driftKind).to.equal('incomparable');
    }
  });

  it('stamp_drift / incomparable when newPackageServiceIds is null (catalog miss)', () => {
    const result = decideDriftPerCheckAction(
      args({ newPackageServiceIds: null, requestedServices: ['1'] }),
    );
    expect(result.kind).to.equal('stamp_drift');
    if (result.kind === 'stamp_drift') {
      expect(result.driftKind).to.equal('incomparable');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// pickEffectiveScreeningPackageId — §16.1 L5 snapshot-precedence helper
// ─────────────────────────────────────────────────────────────────────────

import { pickEffectiveScreeningPackageId } from '../../readiness/onJobOrderWriteDetectScreeningPackageDrift';

describe('pickEffectiveScreeningPackageId — §16.1 L5 snapshot precedence', () => {
  it('falls back to live screeningPackageId for pre-activation JOs (no snapshot)', () => {
    // Pre-§16.1 / draft JOs: snapshot is absent, so the trigger should
    // continue to fingerprint on the live field exactly like before.
    const eff = pickEffectiveScreeningPackageId({
      screeningPackageId: 'PKG_LIVE',
    });
    expect(eff).to.equal('PKG_LIVE');
  });

  it('returns null when neither snapshot nor live field is set', () => {
    expect(pickEffectiveScreeningPackageId(null)).to.equal(null);
    expect(pickEffectiveScreeningPackageId({})).to.equal(null);
    expect(pickEffectiveScreeningPackageId({ screeningPackageId: '' })).to.equal(null);
  });

  it('prefers snapshot.screeningPackageId once the JO is snapshotted (post-activation)', () => {
    // Once a JO is activated, the snapshot is the source of truth.
    // Live-field edits are ignored by drift detection just like every
    // other consumer (per §16 propagation policy).
    const eff = pickEffectiveScreeningPackageId({
      screeningPackageId: 'PKG_LIVE_EDIT', // someone touched the form
      snapshot: {
        capturedAt: '<<server_ts>>',
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    });
    expect(eff).to.equal('PKG_FROZEN');
  });

  it('treats snapshot without capturedAt as not-yet-activated (defensive)', () => {
    // A partially-written snapshot blob (e.g. mid-Push-to-Active
    // transaction) shouldn't accidentally short-circuit drift to a
    // missing value. Require capturedAt to count as "snapshotted".
    const eff = pickEffectiveScreeningPackageId({
      screeningPackageId: 'PKG_LIVE',
      snapshot: { capturedBy: 'trigger', screeningPackageId: 'PKG_PARTIAL' },
    });
    expect(eff).to.equal('PKG_LIVE');
  });

  it('returns null from snapshot when the snapshot intentionally captured no package (cascade had none)', () => {
    // Activation captured a JO whose cascade chain had no
    // screeningPackageId at any level. Snapshot value is null. Drift
    // detection then compares null↔null and short-circuits — exactly
    // what we want (no drift, no audit noise).
    const eff = pickEffectiveScreeningPackageId({
      screeningPackageId: 'PKG_LIVE_AFTER_ACTIVATION',
      snapshot: {
        capturedAt: '<<server_ts>>',
        capturedBy: 'trigger',
        // screeningPackageId omitted entirely — engine returned undefined
      },
    });
    expect(eff).to.equal(null);
  });
});

describe('decideDriftPerCheckAction — gating order matters', () => {
  it('completed beats already-aligned (terminal status wins)', () => {
    // Spec: in-flight gate before any other comparison.
    const result = decideDriftPerCheckAction(
      args({
        hrxStatus: 'completed',
        requestedPackageId: 'same',
        newPackageId: 'same',
      }),
    );
    expect(result.kind).to.equal('skip_not_in_flight');
  });

  it('already-aligned beats service-set comparison (idempotency wins)', () => {
    // Even when the catalog just got rebuilt and serviceIds differ, if
    // the package id is the same, we treat it as already-aligned.
    const result = decideDriftPerCheckAction(
      args({
        requestedPackageId: 'pkg_x',
        newPackageId: 'pkg_x',
        requestedServices: ['1', '2'],
        newPackageServiceIds: ['1', '2', '3'], // would otherwise be more_strict
      }),
    );
    expect(result.kind).to.equal('skip_already_aligned');
  });

  it('expired check beats already-aligned (R.10 terminal)', () => {
    const result = decideDriftPerCheckAction(
      args({
        expired: true,
        requestedPackageId: 'same',
        newPackageId: 'same',
      }),
    );
    expect(result.kind).to.equal('skip_not_in_flight');
  });
});
