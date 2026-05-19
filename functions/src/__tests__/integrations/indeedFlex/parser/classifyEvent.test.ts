/**
 * Slice 2 unit tests — subject-based event classification.
 */

import { expect } from 'chai';

import { classifyEvent } from '../../../../integrations/indeedFlex/parser/classifyEvent';

describe('classifyEvent', () => {
  it('classifies new_request from subject', () => {
    expect(classifyEvent({ subject: 'New job request starting soon — Job 509668' })).to.equal(
      'new_request',
    );
  });

  it('classifies cancel_booking from subject', () => {
    expect(classifyEvent({ subject: 'We have removed the following bookings' })).to.equal(
      'cancel_booking',
    );
    expect(classifyEvent({ subject: 'Booking cancellation: shift 12345' })).to.equal(
      'cancel_booking',
    );
  });

  it('classifies no_show from subject', () => {
    expect(classifyEvent({ subject: 'Your assigned worker did not turn up' })).to.equal('no_show');
    expect(classifyEvent({ subject: 'Worker no-show notification' })).to.equal('no_show');
  });

  it('classifies daily_digest_expired from subject', () => {
    expect(classifyEvent({ subject: 'Daily Brief: Allocations & Priorities' })).to.equal(
      'daily_digest_expired',
    );
    expect(classifyEvent({ subject: 'Indeed Flex Daily Brief' })).to.equal('daily_digest_expired');
  });

  it('disambiguates Booking change → change_headcount via body hint', () => {
    expect(
      classifyEvent({
        subject: 'Booking change — Job 509668',
        bodyHint: 'Number of workers required has been updated from 2 to 3',
      }),
    ).to.equal('change_headcount');
  });

  it('disambiguates Booking change → change_time via body hint', () => {
    expect(
      classifyEvent({
        subject: 'Booking change — Job 509668',
        bodyHint: 'Start time has been moved from 9am to 10am',
      }),
    ).to.equal('change_time');
  });

  it('defaults Booking change without hint to change_time', () => {
    expect(classifyEvent({ subject: 'Booking change — Job 509668' })).to.equal('change_time');
  });

  it('returns null on unrecognized subjects', () => {
    expect(classifyEvent({ subject: 'something completely different' })).to.be.null;
    expect(classifyEvent({ subject: '' })).to.be.null;
  });
});
