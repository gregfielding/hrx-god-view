/**
 * Claim Shift fence on the reminder-profile resolver (2026-09-06).
 * Pure sync resolver — no Firestore.
 */
import { expect } from 'chai';
import {
  ASK_LADDER_REMINDER_TYPES,
  applyClaimedFence,
  isClaimedAssignment,
  resolveShiftReminderProfileSync,
} from '../../cadence/shiftReminderProfile';

const types = (p: { steps: Array<{ type: string }> }) => p.steps.map((s) => s.type);

describe('shiftReminderProfile — Claim Shift fence', () => {
  it('isClaimedAssignment reads acquisition === "claimed" (case/space tolerant)', () => {
    expect(isClaimedAssignment({ acquisition: 'claimed' })).to.equal(true);
    expect(isClaimedAssignment({ acquisition: ' Claimed ' })).to.equal(true);
    expect(isClaimedAssignment({ acquisition: 'offered' })).to.equal(false);
    expect(isClaimedAssignment({})).to.equal(false);
    expect(isClaimedAssignment(null)).to.equal(false);
  });

  it('gig_standard tenant + claimed → gig_claimed: confirmation first, ask ladder gone, rest intact', () => {
    const p = resolveShiftReminderProfileSync({
      tenantProfile: 'gig_standard',
      assignment: { acquisition: 'claimed' },
    });
    expect(p.id).to.equal('gig_claimed');
    expect(types(p)).to.deep.equal([
      'gig_claim_confirmation',
      'assignment_reconfirm_4h',
      'assignment_reminder_2h_instructions',
      'assignment_checkin_0h',
      'assignment_noshow_check',
    ]);
    for (const ask of ASK_LADDER_REMINDER_TYPES) expect(types(p)).to.not.include(ask);
  });

  it('cort_gig tenant + claimed → keeps the T-15m clock-in step', () => {
    const p = resolveShiftReminderProfileSync({
      tenantProfile: 'cort_gig',
      assignment: { acquisition: 'claimed' },
    });
    expect(p.id).to.equal('gig_claimed');
    expect(types(p)).to.include('assignment_reminder_15m_clockin');
    expect(types(p)).to.not.include('assignment_reminder_24h');
    expect(types(p)[0]).to.equal('gig_claim_confirmation');
  });

  it('default (two-step) tenant + claimed → the standard claimed set, not a lone 2h reminder', () => {
    const p = resolveShiftReminderProfileSync({ tenantProfile: null, assignment: { acquisition: 'claimed' } });
    expect(p.id).to.equal('gig_claimed');
    expect(types(p)).to.include('assignment_reconfirm_4h');
    expect(types(p)).to.include('assignment_reminder_2h_instructions');
    expect(types(p)).to.not.include('assignment_reminder_2h');
  });

  it('careers and open shifts are never re-routed by the claim fence', () => {
    const career = resolveShiftReminderProfileSync({
      tenantProfile: 'gig_standard',
      assignment: { acquisition: 'claimed', jobOrderType: 'career' },
    });
    expect(career.id).to.equal('career_placement');
    const open = resolveShiftReminderProfileSync({
      tenantProfile: 'gig_standard',
      assignment: { acquisition: 'claimed', isOpenShift: true },
    });
    expect(open.id).to.equal('open_shift');
  });

  it('un-claimed assignments are untouched', () => {
    const p = resolveShiftReminderProfileSync({ tenantProfile: 'gig_standard', assignment: {} });
    expect(p.id).to.equal('gig_standard');
    expect(types(p)).to.include('assignment_reminder_24h');
  });

  it('applyClaimedFence preserves the matched sequenceId (copy overrides still apply)', () => {
    const base = resolveShiftReminderProfileSync({ tenantProfile: 'gig_standard', assignment: {} });
    const out = applyClaimedFence({ acquisition: 'claimed' }, { profile: base, sequenceId: 'seq-oakland' });
    expect(out.sequenceId).to.equal('seq-oakland');
    expect(out.profile.id).to.equal('gig_claimed');
    // Idempotent.
    expect(applyClaimedFence({ acquisition: 'claimed' }, out)).to.deep.equal(out);
  });
});
