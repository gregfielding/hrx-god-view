/**
 * **R.16.2c Phase 4** — Consumer-wrap snapshot precedence tests.
 *
 * Three server-side reads got wrapped with `getEffectiveJobOrderField`
 * for snapshot precedence:
 *
 *   1. `aiPrescreenJobSlice.extractJobSliceFromJobOrder` —
 *      `physicalRequirements`. Flows through to `buildAiInterviewContext`
 *      and `buildDynamicPrescreenQuestions` via `mergePostingAndOrderSlices`,
 *      so a single upstream wrap covers both downstream consumers.
 *
 *   2. `jobRequirementMatcherHelpers.buildPhaseBMatchSpecs` —
 *      `physicalRequirements` (gate for `physical_willingness` spec).
 *
 *   3. `jobRequirementMatcherHelpers.buildPhaseBMatchSpecs` —
 *      `customUniformRequirements` (one of two gates for
 *      `uniform_willingness` spec).
 *
 * The L5 audit deliberately excluded:
 *   - `index.ts:751-754` (`generateJobDescription`) — same deferral
 *     pattern as R.16.2a's `eVerifyRequired` line 793 deferral. Lives
 *     in a 2k+ LoC index.ts; defer to R.16.2d.
 *   - `messaging/assignmentDetailsEmail.ts:412` — assignment-side
 *     read; assignment doc has its own copy that doesn't flow through
 *     the JO snapshot. Defer to broader assignment-side rewire.
 *   - `attachments` / `pricingFlatMarkupPercent` / `scheduler` —
 *     no JO-side server consumers found in the audit. The snapshot is
 *     captured at activation; client-side wraps in Phase 5 cover the UI.
 *
 * Mocha + Chai. Run via:
 *   ./node_modules/mocha/bin/mocha.js -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/r16_2c_consumerWraps.test.ts'
 *
 * @see docs/CASCADE_R16.2c_HANDOFF.md Phase 4
 */

import { expect } from 'chai';

import { extractJobSliceFromJobOrder } from '../workerAiPrescreen/aiPrescreenJobSlice';
import {
  buildPhaseBMatchSpecs,
  type WorkerForMatching,
} from '../readiness/jobRequirementMatcherHelpers';

// ─────────────────────────────────────────────────────────────────────
// Helpers — minimal JO + worker scaffolds
// ─────────────────────────────────────────────────────────────────────

function joWithSnapshot(
  fields: Record<string, unknown>,
  snapshot: Record<string, unknown> | null,
  status = 'open',
): Record<string, unknown> {
  return {
    status,
    ...fields,
    ...(snapshot ? { snapshot: { capturedAt: '2026-04-01T00:00:00.000Z', ...snapshot } } : {}),
  };
}

function makeWorker(): WorkerForMatching {
  return {
    uid: 'worker_test',
    educationLevelV2: null,
    legacyEducationLevel: null,
    languagesV2: null,
    legacyLanguages: null,
    skills: null,
    licenses: null,
    workerAttestations: {
      physicalRequirementWillingness: 'yes',
      customUniformRequirementWillingness: 'yes',
    } as WorkerForMatching['workerAttestations'],
  };
}

const TODAY_ISO = '2026-04-27';
const TODAY_MS = 1_777_852_800_000;

// ─────────────────────────────────────────────────────────────────────
// 1. extractJobSliceFromJobOrder — physicalRequirements snapshot wrap
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — aiPrescreenJobSlice physicalRequirements wrap', () => {
  it('snapshot value wins over live JO field on activated JO', () => {
    const job = joWithSnapshot(
      { jobTitle: 'Forklift Op', physicalRequirements: ['lifting_75_lbs'] },
      { physicalRequirements: ['lifting_50_lbs', 'standing'] },
    );
    const slice = extractJobSliceFromJobOrder(job);
    // Snapshot wins → contains the snapshot's "lifting_50_lbs" not the
    // post-edit "lifting_75_lbs" on the live field.
    expect(slice.physicalRequirements).to.deep.equal(['lifting_50_lbs', 'standing']);
  });

  it('falls back to live JO field when snapshot is absent (draft / pre-§16.1 JO)', () => {
    const job = joWithSnapshot(
      { jobTitle: 'Forklift Op', physicalRequirements: ['lifting_50_lbs'] },
      null,
    );
    const slice = extractJobSliceFromJobOrder(job);
    expect(slice.physicalRequirements).to.deep.equal(['lifting_50_lbs']);
  });

  it('handles snapshot capturing string shape (legacy data)', () => {
    const job = joWithSnapshot(
      { jobTitle: 'Forklift Op', physicalRequirements: ['lifting_75_lbs'] },
      { physicalRequirements: 'Lifting 50 lbs, Standing' },
    );
    const slice = extractJobSliceFromJobOrder(job);
    // `splitPhysicalList` wraps a non-empty string in a single-element
    // array (it doesn't split on commas — that's the matcher's job).
    // The point of this test is that the snapshot's *string* value
    // wins over the live array, regardless of normalization shape.
    expect(slice.physicalRequirements).to.deep.equal(['Lifting 50 lbs, Standing']);
  });

  it('snapshot draft JO does not block fallback (snapshot wins only on non-draft)', () => {
    const job = joWithSnapshot(
      { jobTitle: 'Forklift Op', physicalRequirements: ['lifting_75_lbs'] },
      { physicalRequirements: ['lifting_50_lbs'] },
      'draft',
    );
    const slice = extractJobSliceFromJobOrder(job);
    // On draft, helper falls back to live field per §16.1 L2.
    expect(slice.physicalRequirements).to.deep.equal(['lifting_75_lbs']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. buildPhaseBMatchSpecs — physicalRequirements gate snapshot wrap
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — buildPhaseBMatchSpecs physicalRequirements gate', () => {
  it('seeds physical_willingness when snapshot has the field even if live JO does not', () => {
    const jo = joWithSnapshot(
      { /* live JO field absent */ },
      { physicalRequirements: ['lifting_50_lbs'] },
    );
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    expect(specs.some((s) => s.requirementType === 'physical_willingness')).to.equal(true);
  });

  it('does NOT seed physical_willingness when snapshot has empty array, even if live JO has values (snapshot wins)', () => {
    const jo = joWithSnapshot(
      { physicalRequirements: ['lifting_75_lbs'] },
      { physicalRequirements: [] },
    );
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    // Snapshot's empty array is the authoritative value → gate is closed.
    expect(specs.some((s) => s.requirementType === 'physical_willingness')).to.equal(false);
  });

  it('falls back to live JO field when no snapshot (draft / pre-§16.1)', () => {
    const jo = joWithSnapshot({ physicalRequirements: ['lifting_50_lbs'] }, null);
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    expect(specs.some((s) => s.requirementType === 'physical_willingness')).to.equal(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. buildPhaseBMatchSpecs — customUniformRequirements gate snapshot wrap
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — buildPhaseBMatchSpecs customUniformRequirements gate', () => {
  it('seeds uniform_willingness when snapshot has custom uniform text even if live JO is empty', () => {
    const jo = joWithSnapshot(
      { customUniformRequirements: '' },
      { customUniformRequirements: 'Black slacks, white shirt' },
    );
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    expect(specs.some((s) => s.requirementType === 'uniform_willingness')).to.equal(true);
  });

  it('does NOT seed uniform_willingness when snapshot custom is empty AND no library uniform present (snapshot wins)', () => {
    const jo = joWithSnapshot(
      { customUniformRequirements: 'Live JO text the CSA later added' },
      { customUniformRequirements: '' },
    );
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    // Snapshot's empty string is authoritative; library uniform fields are
    // also absent → gate stays closed.
    expect(specs.some((s) => s.requirementType === 'uniform_willingness')).to.equal(false);
  });

  it('library uniform field still triggers uniform_willingness even with empty snapshot custom (live + snapshot OR semantics)', () => {
    const jo = joWithSnapshot(
      { customUniformRequirements: '', uniformRequirements: ['Hi-vis vest'] },
      { customUniformRequirements: '' },
    );
    const specs = buildPhaseBMatchSpecs({
      jo,
      worker: makeWorker(),
      screeningEval: null,
      todayISO: TODAY_ISO,
      todayMs: TODAY_MS,
    });
    // Library uniform (`uniformRequirements`) isn't yet snapshot-policy
    // and stays live; the OR in the gate fires.
    expect(specs.some((s) => s.requirementType === 'uniform_willingness')).to.equal(true);
  });
});
