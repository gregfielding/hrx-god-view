/**
 * Slice 2 unit tests — per-type regex extractors.
 *
 * Sample email bodies modeled after the templates from the original
 * Indeed Flex brief + the CORT-style booking-change shape.
 */

import { expect } from 'chai';

import {
  extractCancelBooking,
  extractChangeHeadcount,
  extractChangeTime,
  extractDailyDigestExpired,
  extractDate,
  extractHeadcount,
  extractJobId,
  extractLabeledTime,
  extractNewRequest,
  extractNoShow,
  extractPayRateUsd,
  extractRole,
  extractTimeRange,
  extractVenue,
} from '../../../../integrations/indeedFlex/parser/extractFields';

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

describe('extractJobId', () => {
  it('finds ID: NNNNN', () => {
    expect(extractJobId('Some line\nID: 509668\nMore')).to.equal('509668');
  });

  it('finds Job NNNNN', () => {
    expect(extractJobId('see Job 12345 details')).to.equal('12345');
  });

  it('finds Job ID NNNNN', () => {
    expect(extractJobId('Job ID 987654')).to.equal('987654');
  });

  it('returns undefined when no job id present', () => {
    expect(extractJobId('no number here')).to.be.undefined;
  });

  it('does not match phone numbers or 3-digit ids', () => {
    expect(extractJobId('call 415-555-1234')).to.be.undefined;
    expect(extractJobId('ID: 12')).to.be.undefined;
  });
});

describe('extractDate', () => {
  it('parses ISO format', () => {
    expect(extractDate('Date: 2026-05-21')).to.equal('2026-05-21');
  });

  it('parses US MM/DD/YYYY', () => {
    expect(extractDate('Date: 5/21/2026')).to.equal('2026-05-21');
    expect(extractDate('Date: 05/21/2026')).to.equal('2026-05-21');
  });

  it('parses Mon DD, YYYY', () => {
    expect(extractDate('shift on May 21, 2026 at the venue')).to.equal('2026-05-21');
  });

  it('parses DD Mon YYYY', () => {
    expect(extractDate('shift on 21 May 2026')).to.equal('2026-05-21');
  });

  it('returns undefined when no date present', () => {
    expect(extractDate('no date string')).to.be.undefined;
  });
});

describe('extractLabeledTime', () => {
  it('parses AM/PM short forms', () => {
    expect(extractLabeledTime('Start: 9am', /\bstart/i)).to.equal('09:00');
    expect(extractLabeledTime('End time: 5:30 PM', /\bend\s+time/i)).to.equal('17:30');
  });

  it('parses 24h forms', () => {
    expect(extractLabeledTime('Start time: 09:30', /\bstart\s+time/i)).to.equal('09:30');
  });

  it('handles 12 AM / 12 PM correctly', () => {
    expect(extractLabeledTime('Start: 12am', /\bstart/i)).to.equal('00:00');
    expect(extractLabeledTime('Start: 12pm', /\bstart/i)).to.equal('12:00');
  });

  it('returns undefined on no match', () => {
    expect(extractLabeledTime('no label match', /\bend\s+time/i)).to.be.undefined;
  });
});

describe('extractTimeRange', () => {
  it('parses "9am - 5pm"', () => {
    expect(extractTimeRange('Shift: 9am - 5pm')).to.deep.equal({ start: '09:00', end: '17:00' });
  });

  it('parses "09:00 to 17:30"', () => {
    expect(extractTimeRange('Hours: 09:00 to 17:30')).to.deep.equal({
      start: '09:00',
      end: '17:30',
    });
  });

  it('parses en-dash separator', () => {
    expect(extractTimeRange('9:30am – 5:30pm')).to.deep.equal({ start: '09:30', end: '17:30' });
  });
});

describe('extractVenue / extractRole', () => {
  it('extracts Venue', () => {
    expect(extractVenue('Venue: Café Lavash')).to.equal('Café Lavash');
    expect(extractVenue('Location: Moscone Center')).to.equal('Moscone Center');
  });

  it('strips trailing punctuation', () => {
    expect(extractVenue('Venue: Café Lavash.')).to.equal('Café Lavash');
  });

  it('extracts Role', () => {
    expect(extractRole('Role: Server')).to.equal('Server');
    expect(extractRole('Position: Bartender')).to.equal('Bartender');
  });
});

describe('extractHeadcount', () => {
  it('parses Number of workers', () => {
    expect(extractHeadcount('Number of workers: 5')).to.equal(5);
  });

  it('parses Workers required', () => {
    expect(extractHeadcount('Workers required: 3')).to.equal(3);
  });

  it('returns undefined when no headcount', () => {
    expect(extractHeadcount('no workers mentioned')).to.be.undefined;
  });
});

describe('extractPayRateUsd', () => {
  it('parses $XX.XX/hr', () => {
    expect(extractPayRateUsd('Pay: $22.50/hr')).to.equal(22.5);
    expect(extractPayRateUsd('Rate: $18 per hour')).to.equal(18);
  });

  it('parses "Pay: $25"', () => {
    expect(extractPayRateUsd('Pay rate: $25.00')).to.equal(25);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-type extractors
// ─────────────────────────────────────────────────────────────────────

describe('extractNewRequest', () => {
  it('high-confidence: all fields extracted', () => {
    const body = `
We have a new job request:

ID: 509668
Venue: Moscone Center
Role: Server
Number of workers: 4
Date: 2026-05-21
Shift: 9am - 5pm
Pay: $22.50/hr
`;
    const r = extractNewRequest(body);
    expect(r.event.jobId).to.equal('509668');
    expect(r.event.headcount).to.equal(4);
    expect(r.event.workDate).to.equal('2026-05-21');
    expect(r.event.startTime).to.equal('09:00');
    expect(r.event.endTime).to.equal('17:00');
    expect(r.event.venueName).to.equal('Moscone Center');
    expect(r.event.roleName).to.equal('Server');
    expect(r.event.payRateUsd).to.equal(22.5);
    expect(r.missingFields).to.deep.equal([]);
  });

  it('low-confidence: missing jobId + headcount', () => {
    const body = `
Venue: Moscone Center
Date: 2026-05-21
Shift: 9am - 5pm
`;
    const r = extractNewRequest(body);
    expect(r.missingFields).to.include('jobId');
    expect(r.missingFields).to.include('headcount');
  });
});

describe('extractChangeHeadcount', () => {
  it('parses "from N to M"', () => {
    const body = `
The booking has been updated.
Venue: Caf Lavash
Date: 2026-05-21
Number of workers changed from 2 to 5.
`;
    const r = extractChangeHeadcount(body);
    expect(r.event.previousHeadcount).to.equal(2);
    expect(r.event.newHeadcount).to.equal(5);
    expect(r.event.workDate).to.equal('2026-05-21');
  });

  it('falls back to single headcount', () => {
    const body = `
Venue: Caf Lavash
Date: 2026-05-21
Number of workers: 3
`;
    const r = extractChangeHeadcount(body);
    expect(r.event.newHeadcount).to.equal(3);
  });
});

describe('extractChangeTime', () => {
  it('extracts new start/end times', () => {
    const body = `
Booking change — Job 509668
Venue: Moscone Center
Date: 2026-05-21
New start time: 10am
New end time: 6pm
`;
    const r = extractChangeTime(body);
    expect(r.event.jobId).to.equal('509668');
    expect(r.event.newStartTime).to.equal('10:00');
    expect(r.event.newEndTime).to.equal('18:00');
    expect(r.event.workDate).to.equal('2026-05-21');
  });

  it('captures previous times when present', () => {
    const body = `
Job 509668
Date: 2026-05-21
Previous start time: 9am
Previous end time: 5pm
New start time: 10am
New end time: 6pm
`;
    const r = extractChangeTime(body);
    expect(r.event.previousStartTime).to.equal('09:00');
    expect(r.event.previousEndTime).to.equal('17:00');
    expect(r.event.newStartTime).to.equal('10:00');
    expect(r.event.newEndTime).to.equal('18:00');
  });
});

describe('extractCancelBooking', () => {
  it('extracts worker names from a removed-bookings header', () => {
    const body = `
We have removed the following bookings:

- Tihitna Ade
- Brianna Arnold
- Raesean Austin

Venue: Moscone Center
Date: 2026-05-21
Shift: 9am - 5pm
Reason: client cancellation
`;
    const r = extractCancelBooking(body);
    expect(r.event.workerNames).to.deep.equal(['Tihitna Ade', 'Brianna Arnold', 'Raesean Austin']);
    expect(r.event.venueName).to.equal('Moscone Center');
    expect(r.event.workDate).to.equal('2026-05-21');
    expect(r.event.reason).to.equal('client cancellation');
  });
});

describe('extractNoShow', () => {
  it('extracts the assigned worker name', () => {
    const body = `
Your assigned worker John Smith did not turn up to their shift.
Job 509668
Venue: Moscone Center
Date: 2026-05-21
Shift: 9am - 5pm
`;
    const r = extractNoShow(body);
    expect(r.event.workerName).to.equal('John Smith');
    expect(r.event.jobId).to.equal('509668');
    expect(r.event.workDate).to.equal('2026-05-21');
  });
});

describe('extractDailyDigestExpired', () => {
  it('extracts a list of expired jobs', () => {
    const body = `
Daily Brief: Allocations & Priorities

Job requests expired:
- Job 509668 — Moscone Center
- Job 509669 — Café Lavash
- Job 509670 — Mission District

Other sections...
`;
    const r = extractDailyDigestExpired(body);
    expect(r.event.expiredJobs).to.have.lengthOf(3);
    expect(r.event.expiredJobs[0].jobId).to.equal('509668');
    expect(r.event.expiredJobs[1].jobId).to.equal('509669');
    expect(r.event.expiredJobs[2].jobId).to.equal('509670');
  });

  it('flags missing when no expired section', () => {
    const body = `
Daily Brief: nothing happened today
`;
    const r = extractDailyDigestExpired(body);
    expect(r.event.expiredJobs).to.have.lengthOf(0);
    expect(r.missingFields).to.include('expiredJobs');
  });
});
