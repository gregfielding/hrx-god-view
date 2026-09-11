/**
 * Career fence + the narrow daily-confirm opt-in (Greg 2026-09-11, CORT
 * Woodridge) + parent-account matching. Pure selectors — no Firestore.
 */
import { expect } from 'chai';
import {
  careerOptInProblems,
  gigSequenceCandidates,
  resolveFencedProfile,
  resolveShiftReminderProfileSync,
  selectCareerDailyConfirmSequence,
  targetingMatchesAccountAndLocation,
  type SequenceTargeting,
} from '../../cadence/shiftReminderProfile';

const CORT_NATIONAL = 'iNJQeuidEg6nJodNeWjc';
const WOODRIDGE_ACCT = 'autoLoc_6614faf7a49652edd035a90f0b64c2ac';
const WOODRIDGE_LOC = 'WTfwAWmKLGKEkgFyX5B2';
const SECAUCUS_ACCT = 'autoLoc_secaucus';
const LINEAGE = [WOODRIDGE_ACCT, CORT_NATIONAL];

const seq = (over: Partial<SequenceTargeting>): SequenceTargeting => ({
  sequenceId: 'seq',
  active: true,
  accountIds: [],
  locationIds: [],
  workerTypes: ['gig'],
  occurrence: 'every_shift',
  profileId: 'cort_gig',
  includeCareer: false,
  ...over,
});

/** The Woodridge doc this build creates. */
const WOODRIDGE_DAILY = seq({
  sequenceId: 'cort_woodridge_daily',
  accountIds: [WOODRIDGE_ACCT],
  locationIds: [WOODRIDGE_LOC],
  workerTypes: ['career'],
  includeCareer: true,
});
/** The live cort_gig doc's shape: national + every child, gig-only, first_shift. */
const CORT_GIG = seq({ sequenceId: 'cort_gig', accountIds: [CORT_NATIONAL, WOODRIDGE_ACCT], occurrence: 'first_shift' });

const woodridgeCareer = { jobOrderType: 'career', accountId: WOODRIDGE_ACCT, locationId: WOODRIDGE_LOC };

describe('career fence — daily-confirm opt-in', () => {
  it('the Woodridge doc opts Woodridge careers into cort_gig, daily', () => {
    const r = resolveFencedProfile(woodridgeCareer, [CORT_GIG, WOODRIDGE_DAILY], LINEAGE);
    expect(r?.profile.id).to.equal('cort_gig');
    expect(r?.sequenceId).to.equal('cort_woodridge_daily');
    expect(r?.dailyConfirm).to.equal(true);
  });

  it('with no opt-in doc careers keep the quiet placement track — cort_gig lists the account but never opts careers in', () => {
    const r = resolveFencedProfile(woodridgeCareer, [CORT_GIG], LINEAGE);
    expect(r?.profile.id).to.equal('career_placement');
    expect(r?.dailyConfirm).to.equal(undefined);
    expect(resolveFencedProfile(woodridgeCareer, null, [])?.profile.id).to.equal('career_placement');
  });

  it('Open Shift has no exception, even at an opted-in venue', () => {
    const r = resolveFencedProfile({ ...woodridgeCareer, isOpenShift: true }, [WOODRIDGE_DAILY], LINEAGE);
    expect(r?.profile.id).to.equal('open_shift');
  });

  it('gig assignments are not fenced (null → the gig targeting path)', () => {
    expect(resolveFencedProfile({ jobOrderType: 'gig', accountId: WOODRIDGE_ACCT }, [WOODRIDGE_DAILY], LINEAGE)).to.equal(null);
  });

  it('every guard rail is required — never account-wide', () => {
    const variants: Array<[string, SequenceTargeting]> = [
      ['no_locationIds', { ...WOODRIDGE_DAILY, locationIds: [] }],
      ['no_accountIds', { ...WOODRIDGE_DAILY, accountIds: [] }],
      ['includeCareer_not_set', { ...WOODRIDGE_DAILY, includeCareer: false }],
      ['workerTypes_missing_career', { ...WOODRIDGE_DAILY, workerTypes: ['gig'] }],
      ['occurrence_not_every_shift', { ...WOODRIDGE_DAILY, occurrence: 'first_shift' }],
      ['inactive', { ...WOODRIDGE_DAILY, active: false }],
    ];
    for (const [problem, doc] of variants) {
      expect(careerOptInProblems(doc), problem).to.include(problem);
      expect(selectCareerDailyConfirmSequence([doc], woodridgeCareer, LINEAGE), problem).to.equal(null);
      expect(resolveFencedProfile(woodridgeCareer, [doc], LINEAGE)?.profile.id, problem).to.equal('career_placement');
    }
    expect(careerOptInProblems(WOODRIDGE_DAILY)).to.deep.equal([]);
  });

  it('a different venue under the same account stays fenced', () => {
    const other = { ...woodridgeCareer, locationId: 'someOtherVenue' };
    expect(resolveFencedProfile(other, [WOODRIDGE_DAILY], LINEAGE)?.profile.id).to.equal('career_placement');
  });

  it('the opt-in can name the national account — the child matches through its parent', () => {
    const national = { ...WOODRIDGE_DAILY, accountIds: [CORT_NATIONAL] };
    expect(resolveFencedProfile(woodridgeCareer, [national], LINEAGE)?.dailyConfirm).to.equal(true);
    // …but without the lineage (parent unknown) it cannot match.
    expect(resolveFencedProfile(woodridgeCareer, [national], [WOODRIDGE_ACCT])?.profile.id).to.equal('career_placement');
  });

  it('the first valid matching doc wins', () => {
    const standard = { ...WOODRIDGE_DAILY, sequenceId: 'first', profileId: 'gig_standard' as const };
    const r = resolveFencedProfile(woodridgeCareer, [standard, WOODRIDGE_DAILY], LINEAGE);
    expect(r?.sequenceId).to.equal('first');
    expect(r?.profile.id).to.equal('gig_standard');
  });

  it('the sync resolver (no targeting docs) keeps careers and open shifts fenced', () => {
    expect(resolveShiftReminderProfileSync({ tenantProfile: 'cort_gig', assignment: woodridgeCareer }).id).to.equal('career_placement');
    expect(resolveShiftReminderProfileSync({ tenantProfile: 'cort_gig', assignment: { isOpenShift: true } }).id).to.equal('open_shift');
  });
});

describe('sequence targeting — parent-account matching', () => {
  const secaucusGig = { jobOrderType: 'gig', accountId: SECAUCUS_ACCT, locationId: 'secaucusVenue' };

  it('a national-only doc matches a child gig assignment through its parent', () => {
    const nationalOnly = seq({ sequenceId: 'cort_gig', accountIds: [CORT_NATIONAL], occurrence: 'first_shift' });
    expect(targetingMatchesAccountAndLocation(nationalOnly, secaucusGig, [SECAUCUS_ACCT, CORT_NATIONAL])).to.equal(true);
    expect(targetingMatchesAccountAndLocation(nationalOnly, secaucusGig, [SECAUCUS_ACCT])).to.equal(false);
  });

  it('locationIds still narrow inside a parent match', () => {
    const oakland = seq({ accountIds: [CORT_NATIONAL], locationIds: ['oaklandArena'] });
    expect(targetingMatchesAccountAndLocation(oakland, secaucusGig, [SECAUCUS_ACCT, CORT_NATIONAL])).to.equal(false);
  });

  it('career-only docs never become gig candidates; inactive and empty docs never match', () => {
    const lineage = [WOODRIDGE_ACCT, CORT_NATIONAL];
    const gigAtWoodridge = { jobOrderType: 'gig', accountId: WOODRIDGE_ACCT, locationId: WOODRIDGE_LOC };
    const out = gigSequenceCandidates(
      [WOODRIDGE_DAILY, seq({ sequenceId: 'off', active: false, accountIds: [CORT_NATIONAL] }), seq({ sequenceId: 'empty' }), CORT_GIG],
      gigAtWoodridge,
      lineage,
    );
    expect(out.map((t) => t.sequenceId)).to.deep.equal(['cort_gig']);
  });
});
