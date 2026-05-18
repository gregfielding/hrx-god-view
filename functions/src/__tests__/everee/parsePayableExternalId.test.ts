/**
 * `parsePayableExternalId` unit tests (TS.1.P4 Slice 5).
 *
 * The webhook handler's correctness hinges on parsing externalIds back
 * to their originating doc references symmetrically with how the
 * orchestrator built them. If the build-side format and parse-side
 * regex ever drift, every Everee webhook silently no-ops — silent
 * failure mode is the worst kind. Pinning the parser here catches
 * that early.
 *
 * Mirror format spec (matches `evereePayables.ts:buildPayableExternalId`):
 *   Payable     — `{tenantId}::{assignmentId}::{workDate}::{KIND}`
 *   Adjustment  — `{tenantId}::{adjustmentId}`
 */

import { expect } from 'chai';

import { parsePayableExternalId } from '../../integrations/everee/evereeWebhook';

describe('parsePayableExternalId', () => {
  describe('payable form (4 parts)', () => {
    it('parses a well-formed tips externalId', () => {
      const parsed = parsePayableExternalId(
        'BCiP2bQ9CgVOCTfV6MhD::assign123::2026-05-18::TIPS',
      );
      expect(parsed).to.deep.equal({
        kind: 'payable',
        tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
        assignmentId: 'assign123',
        workDate: '2026-05-18',
        payableKind: 'TIPS',
        entryDocId: 'assign123_2026-05-18',
      });
    });

    it('handles all five payable kinds', () => {
      for (const kind of ['TIPS', 'BONUS', 'MEAL_PREMIUM', 'REST_PREMIUM', 'CONTRACTOR']) {
        const parsed = parsePayableExternalId(`t::a::2026-05-18::${kind}`);
        expect(parsed?.kind).to.equal('payable');
        expect((parsed as { payableKind: string }).payableKind).to.equal(kind);
      }
    });

    it('builds entryDocId in the canonical {assignmentId}_{workDate} format', () => {
      const parsed = parsePayableExternalId('t::assignABC::2026-05-18::TIPS');
      expect((parsed as { entryDocId: string }).entryDocId).to.equal('assignABC_2026-05-18');
    });
  });

  describe('adjustment form (2 parts)', () => {
    it('parses a well-formed adjustment externalId', () => {
      expect(parsePayableExternalId('BCiP2bQ9CgVOCTfV6MhD::adj-456')).to.deep.equal({
        kind: 'adjustment',
        tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
        adjustmentId: 'adj-456',
      });
    });
  });

  describe('rejection (null) cases', () => {
    it('returns null for empty / nullish input', () => {
      expect(parsePayableExternalId(null)).to.equal(null);
      expect(parsePayableExternalId(undefined)).to.equal(null);
      expect(parsePayableExternalId('')).to.equal(null);
    });

    it('returns null when a part is empty', () => {
      expect(parsePayableExternalId('t::a::2026-05-18::')).to.equal(null);
      expect(parsePayableExternalId('::a::2026-05-18::TIPS')).to.equal(null);
      expect(parsePayableExternalId('t::::2026-05-18::TIPS')).to.equal(null);
      expect(parsePayableExternalId('t::a::::TIPS')).to.equal(null);
      expect(parsePayableExternalId('t::')).to.equal(null);
      expect(parsePayableExternalId('::adj')).to.equal(null);
    });

    it('returns null when the part count is not 2 or 4', () => {
      // 1 part — unstructured
      expect(parsePayableExternalId('just-a-string')).to.equal(null);
      // 3 parts — invalid
      expect(parsePayableExternalId('a::b::c')).to.equal(null);
      // 5 parts — invalid
      expect(parsePayableExternalId('a::b::c::d::e')).to.equal(null);
    });

    it('returns null for non-string input', () => {
      // The signature accepts string | null | undefined, but a real
      // webhook payload could deliver a number/object due to bad
      // upstream code. Guard at runtime.
      expect(parsePayableExternalId(123 as unknown as string)).to.equal(null);
      expect(parsePayableExternalId({} as unknown as string)).to.equal(null);
    });
  });

  describe('round-trip with `buildPayableExternalId` (cross-file contract)', () => {
    // The parser must inverse the builder. If you update either side,
    // ensure this test still passes — it's the cross-file contract.
    it('parses each kind the builder produces', () => {
      const fixed = {
        tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
        assignmentId: 'assign-xyz',
        workDate: '2026-05-18',
      };
      const kinds: Array<'TIPS' | 'BONUS' | 'MEAL_PREMIUM' | 'REST_PREMIUM' | 'CONTRACTOR'> = [
        'TIPS',
        'BONUS',
        'MEAL_PREMIUM',
        'REST_PREMIUM',
        'CONTRACTOR',
      ];
      for (const kind of kinds) {
        const built = `${fixed.tenantId}::${fixed.assignmentId}::${fixed.workDate}::${kind}`;
        const parsed = parsePayableExternalId(built);
        expect(parsed?.kind).to.equal('payable');
        if (parsed?.kind !== 'payable') continue;
        expect(parsed.tenantId).to.equal(fixed.tenantId);
        expect(parsed.assignmentId).to.equal(fixed.assignmentId);
        expect(parsed.workDate).to.equal(fixed.workDate);
        expect(parsed.payableKind).to.equal(kind);
      }
    });
  });
});
