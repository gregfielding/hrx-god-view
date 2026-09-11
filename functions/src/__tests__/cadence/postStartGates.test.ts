/**
 * Post-start dispatch gates — the T+15 late check-in, built 2026-09-11 after
 * the 2026-09-07 step shipped without its dispatcher gate (every doc was
 * cancelled as assignment_start_in_past). Pure: no Firestore. The crew under
 * test is CORT Woodridge: 05:00 America/Chicago starts, linked to Indeed Flex
 * only through the shift's time.indeed.com clock-in link.
 */
import { expect } from 'chai';
import {
  CHECKIN_STALE_WINDOW_MS,
  LATE_CHECKIN_FEED_FRESH_AFTER_START_MS,
  LATE_CHECKIN_STALE_WINDOW_MS,
  NOSHOW_STALE_WINDOW_MS,
  decideLateCheckin,
  isFlexClockInUrl,
  lateCheckinPrecheckReason,
  lateCheckinWorkDate,
  postStartStaleWindowMs,
} from '../../cadence/postStartGates';
import { resolveShiftReminderProfileSync } from '../../cadence/shiftReminderProfile';

const TZ = 'America/Chicago';
const MIN = 60 * 1000;
/** Monday 2026-09-14 05:00 CDT (UTC-5). */
const START = new Date('2026-09-14T05:00:00-05:00').getTime();
const ASG = 'CyBf1wPkceyHaj8BntJT__crewMember';
const FLEX_URL = 'https://time.indeed.com/clock-in/8f3a2c';

describe('postStartStaleWindowMs', () => {
  it('lets the T+15 late check-in dispatch after start', () => {
    expect(postStartStaleWindowMs('assignment_late_checkin_15m')).to.equal(LATE_CHECKIN_STALE_WINDOW_MS);
  });

  it('keeps the T+0 and T+30 windows', () => {
    expect(postStartStaleWindowMs('assignment_checkin_0h')).to.equal(CHECKIN_STALE_WINDOW_MS);
    expect(postStartStaleWindowMs('assignment_noshow_check')).to.equal(NOSHOW_STALE_WINDOW_MS);
  });

  it('blocks pre-shift steps once the shift has started', () => {
    for (const type of [
      'assignment_reminder_24h',
      'assignment_reconfirm_4h',
      'assignment_reminder_2h_instructions',
      'assignment_reminder_15m_clockin',
      'career_first_day',
    ]) {
      expect(postStartStaleWindowMs(type), type).to.equal(null);
    }
  });

  it('covers every step a track schedules at or after start', () => {
    const profiles = [
      resolveShiftReminderProfileSync({ tenantProfile: null, assignment: { shiftReminderProfile: 'gig_standard' } }),
      resolveShiftReminderProfileSync({ tenantProfile: null, assignment: { shiftReminderProfile: 'cort_gig' } }),
      resolveShiftReminderProfileSync({ tenantProfile: null, assignment: { jobOrderType: 'career' } }),
    ];
    expect(profiles.map((p) => p.id)).to.deep.equal(['gig_standard', 'cort_gig', 'career_placement']);
    for (const profile of profiles) {
      const postStart = profile.steps.filter((s) => s.offsetHours <= 0);
      expect(postStart.map((s) => s.type), profile.id).to.include('assignment_late_checkin_15m');
      for (const step of postStart) {
        expect(postStartStaleWindowMs(step.type), `${profile.id}:${step.type}`).to.not.equal(null);
      }
    }
  });
});

describe('isFlexClockInUrl', () => {
  it('recognizes Indeed Flex clock-in links', () => {
    expect(isFlexClockInUrl(FLEX_URL)).to.equal(true);
    expect(isFlexClockInUrl('https://example.com/punch?flexJobId=545107')).to.equal(true);
    expect(isFlexClockInUrl('https://example.com/punch?flexRequestId=91')).to.equal(true);
  });

  it('rejects other links and non-strings', () => {
    expect(isFlexClockInUrl('https://cort.example.com/qr/77')).to.equal(false);
    expect(isFlexClockInUrl('')).to.equal(false);
    expect(isFlexClockInUrl(undefined)).to.equal(false);
  });
});

describe('lateCheckinPrecheckReason', () => {
  it('dismisses a day that is already resolved', () => {
    for (const state of ['checked_in', 'no_show', 'cancelled']) {
      expect(lateCheckinPrecheckReason({ cortState: state, flexLinkedAssignment: true, clockInUrl: FLEX_URL })).to.equal(
        `late_checkin_state_${state}`,
      );
    }
    expect(lateCheckinPrecheckReason({ cortState: ' Checked_In ', flexLinkedAssignment: true })).to.equal(
      'late_checkin_state_checked_in',
    );
  });

  it('dismisses when HRX has no clock-in signal for the assignment', () => {
    expect(
      lateCheckinPrecheckReason({ cortState: 'confirmed', flexLinkedAssignment: false, clockInUrl: 'https://cort.example.com/qr/77' }),
    ).to.equal('late_checkin_no_clockin_signal');
    expect(lateCheckinPrecheckReason({ cortState: 'pending', flexLinkedAssignment: false })).to.equal(
      'late_checkin_no_clockin_signal',
    );
  });

  it('passes a Flex-linked assignment', () => {
    expect(lateCheckinPrecheckReason({ cortState: 'confirmed', flexLinkedAssignment: true })).to.equal(null);
  });

  it('passes a crew linked only through the shift clock-in link', () => {
    expect(lateCheckinPrecheckReason({ cortState: 'pending', flexLinkedAssignment: false, clockInUrl: FLEX_URL })).to.equal(null);
    expect(lateCheckinPrecheckReason({ cortState: '', flexLinkedAssignment: false, clockInUrl: FLEX_URL })).to.equal(null);
  });
});

describe('decideLateCheckin', () => {
  const freshCapture = START + 12 * MIN;

  it('stamps a punch on this assignment, even when the feed is stale', () => {
    const row = { id: 'flex-1', hrxAssignmentId: ASG, clockIn: '2026-09-14T04:54:54.317-05:00', status: 'submitted' };
    expect(
      decideLateCheckin({ assignmentId: ASG, rows: [row], feedCapturedAt: START - 60 * MIN, startMs: START }),
    ).to.deep.equal({ kind: 'clocked_in', row });
  });

  it('ignores rows without a clock-in, cancelled rows, and other assignments', () => {
    const rows = [
      { id: 'a', hrxAssignmentId: ASG, clockIn: null, status: 'awaiting_submission' },
      { id: 'b', hrxAssignmentId: ASG, clockIn: '   ', status: 'submitted' },
      { id: 'c', hrxAssignmentId: ASG, clockIn: '2026-09-14T04:58:00-05:00', status: 'Cancelled' },
      { id: 'd', hrxAssignmentId: ASG, clockIn: '2026-09-14T04:58:00-05:00', status: 'no_show' },
      { id: 'e', hrxAssignmentId: 'someOtherShift__worker__2026-09-14', clockIn: '2026-09-14T04:58:00-05:00', status: 'submitted' },
    ];
    expect(decideLateCheckin({ assignmentId: ASG, rows, feedCapturedAt: freshCapture, startMs: START })).to.deep.equal({
      kind: 'send',
    });
  });

  it('holds the text for a punch Flex could not match to any assignment', () => {
    const row = { id: 'flex-2', hrxAssignmentId: null, clockIn: '2026-09-14T04:57:00-05:00', status: 'submitted' };
    expect(decideLateCheckin({ assignmentId: ASG, rows: [row], feedCapturedAt: freshCapture, startMs: START })).to.deep.equal({
      kind: 'clocked_in_unmatched',
      row,
    });
  });

  it('stays silent when the feed has not captured since start + 5 minutes', () => {
    const justBefore = START + LATE_CHECKIN_FEED_FRESH_AFTER_START_MS - 1;
    expect(decideLateCheckin({ assignmentId: ASG, rows: [], feedCapturedAt: justBefore, startMs: START })).to.deep.equal({
      kind: 'feed_stale',
      feedCapturedAtMs: justBefore,
    });
    expect(decideLateCheckin({ assignmentId: ASG, rows: [], feedCapturedAt: null, startMs: START })).to.deep.equal({
      kind: 'feed_stale',
      feedCapturedAtMs: null,
    });
  });

  it('sends when a fresh capture shows no punch (epoch ms or Timestamp)', () => {
    expect(
      decideLateCheckin({ assignmentId: ASG, rows: [], feedCapturedAt: START + LATE_CHECKIN_FEED_FRESH_AFTER_START_MS, startMs: START }),
    ).to.deep.equal({ kind: 'send' });
    expect(
      decideLateCheckin({ assignmentId: ASG, rows: [], feedCapturedAt: { toMillis: () => freshCapture }, startMs: START }),
    ).to.deep.equal({ kind: 'send' });
  });
});

describe('lateCheckinWorkDate', () => {
  it("uses a daily crew doc's own workDate", () => {
    expect(lateCheckinWorkDate('2026-09-14', START, TZ)).to.equal('2026-09-14');
  });

  it('otherwise uses the start date on the worksite calendar', () => {
    // 23:30 CDT on the 13th is already the 14th in UTC.
    const lateEvening = new Date('2026-09-13T23:30:00-05:00').getTime();
    expect(lateCheckinWorkDate(undefined, lateEvening, TZ)).to.equal('2026-09-13');
    expect(lateCheckinWorkDate('', lateEvening, TZ)).to.equal('2026-09-13');
  });
});
