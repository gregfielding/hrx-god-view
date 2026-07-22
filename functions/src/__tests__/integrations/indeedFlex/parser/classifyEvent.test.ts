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

describe('live format subjects (2026-07-08)', () => {
  it('classifies "bookings have been removed" as cancel_booking', () => {
    expect(
      classifyEvent({ subject: 'Your upcoming bookings have been removed' }),
    ).to.equal('cancel_booking');
  });

  it('classifies "bookings have been changed" via body hint', () => {
    expect(
      classifyEvent({
        subject: 'Some of your upcoming bookings have been changed',
        bodyHint: 'Workers required now: 1 (Decreased by 1 out of 2)',
      }),
    ).to.equal('change_headcount');
    expect(
      classifyEvent({
        subject: 'Some of your upcoming bookings have been changed',
        bodyHint: 'Jul 07, 2026 - 10am EDT - 6:30pm EDT',
      }),
    ).to.equal('change_time');
  });

  it('classifies "details for your Job NNN have changed"', () => {
    expect(
      classifyEvent({ subject: 'Some of the details for your Job 528091 have changed.' }),
    ).to.equal('change_time');
  });
});

describe('PI-5 — info_notice + noise classification', () => {
  const { isNoiseSubject } = require('../../../../integrations/indeedFlex/parser/classifyEvent');
  it('classifies the parse-failure census families as info_notice', () => {
    for (const s of [
      'Worker assignment ended - Al Gaymon, Loader / Crew in Loader / Crew - Distr',
      'Expiring soon: Job request in Hanover, MD – Book workers now #511654',
      'Job request expired – Booking deadline passed #511651',
      'Unfilled shifts expired – Booking deadline passed #528976',
      'Corrections approved',
      'Shamar Holloway has not been accepted to work at CHI - Woodridge Warehouse',
    ]) {
      expect(classifyEvent({ subject: s })).to.equal('info_notice');
    }
  });
  it('flags marketing + misrouted Fieldglass as noise', () => {
    expect(isNoiseSubject('Prepare for upcoming US demand peaks')).to.equal('marketing');
    expect(isNoiseSubject('Your July Agency Update: Kodiak Hub, Rate Changes & Billing')).to.equal('marketing');
    expect(isNoiseSubject('Work Order Revision submitted [Work Order ID: SDXOWO00267978]')).to.equal('misrouted_fieldglass');
    expect(isNoiseSubject('New job request starting soon — Job 509668')).to.equal(null);
  });
});
