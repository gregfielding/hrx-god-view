/**
 * T-2h instructions message — day-of logistics composition (2026-09-03).
 *
 * The structured fields (on-site contact, parking / check-in snippets from
 * the staffInstructions chain) are resolved at dispatch time and must:
 *   - render in priority order inside the SMS budget,
 *   - suppress the free-text detail blob when structured snippets exist,
 *   - keep the legacy detail-blob behavior when they don't,
 *   - localize the labels (ES).
 */
import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  buildCadenceMessage,
  buildOpenShiftMessage,
  renderWeeklyScheduleSummary,
  type CadenceMessagePayload,
} from '../../cadence/cadenceMessages';
import { renderCadenceTemplate } from '../../cadence/sequenceCopyOverrides';

function basePayload(overrides: Partial<CadenceMessagePayload> = {}): CadenceMessagePayload {
  return {
    jobTitle: 'Event Cook',
    companyName: 'Legends',
    locationName: 'Oracle Park',
    locationAddress: '24 Willie Mays Plaza, San Francisco, CA',
    startTime: admin.firestore.Timestamp.fromDate(new Date('2026-09-03T15:00:00-07:00')),
    timezone: 'America/Los_Angeles',
    shiftDescription: 'Bring non-slip shoes and a black polo.',
    ...overrides,
  };
}

describe('buildCadenceMessage assignment_reminder_2h_instructions', () => {
  it('renders contact, check-in, and parking; suppresses the detail blob', () => {
    const msg = buildCadenceMessage(
      'assignment_reminder_2h_instructions',
      basePayload({
        onsiteContactName: 'Maria Lopez',
        onsiteContactRole: 'Catering Lead',
        onsiteContactPhone: '+14155550123',
        checkInText: 'Enter at Gate B, ask security for the catering office.',
        parkingText: 'Lot C on 3rd St — show your shift confirmation.',
      }),
    );
    expect(msg.sms).to.contain('Find Maria Lopez (Catering Lead): +14155550123.');
    expect(msg.sms).to.contain('Check-in: Enter at Gate B');
    expect(msg.sms).to.contain('Parking: Lot C on 3rd St');
    // Structured snippets present → the free-text blob stays out.
    expect(msg.sms).to.not.contain('non-slip shoes');
    expect(msg.body).to.contain('Find Maria Lopez');
    expect(msg.sms.length).to.be.lessThan(420);
  });

  it('keeps the legacy detail blob when no structured snippets exist', () => {
    const msg = buildCadenceMessage('assignment_reminder_2h_instructions', basePayload());
    expect(msg.sms).to.contain('non-slip shoes');
    expect(msg.sms).to.not.contain('Find ');
  });

  it('renders a contact without a phone and localizes ES labels', () => {
    const msg = buildCadenceMessage(
      'assignment_reminder_2h_instructions',
      basePayload({
        onsiteContactName: 'Maria Lopez',
        parkingText: 'Lote C.',
      }),
      'es',
    );
    expect(msg.sms).to.contain('Busca a Maria Lopez.');
    expect(msg.sms).to.contain('Estacionamiento: Lote C.');
    expect(msg.sms).to.not.contain(': undefined');
  });
});

describe('renderWeeklyScheduleSummary', () => {
  it('groups contiguous same-time runs and lists differing days', () => {
    expect(
      renderWeeklyScheduleSummary({ 1: '09:00–17:00', 2: '09:00–17:00', 3: '09:00–17:00', 5: '10:00–14:00' } as never),
    ).to.equal('Mon–Wed 09:00–17:00, Fri 10:00–14:00');
    expect(renderWeeklyScheduleSummary({ 1: '09:00–17:00' } as never, 'es')).to.equal('lun 09:00–17:00');
    expect(renderWeeklyScheduleSummary(undefined)).to.equal('');
  });
});

describe('buildOpenShiftMessage', () => {
  const payload = basePayload({
    weeklySchedule: { 1: '09:00–17:00', 2: '09:00–17:00', 3: '09:00–17:00', 4: '09:00–17:00', 5: '09:00–17:00' },
  });

  it('welcome carries schedule + address + details URL', () => {
    const msg = buildOpenShiftMessage('openshift_welcome', payload, 'en', 'C1 Staffing', 'https://hrxone.com/a/1');
    expect(msg.sms).to.contain("You're on the crew at Oracle Park!");
    expect(msg.sms).to.contain('Schedule: Mon–Fri 09:00–17:00.');
    expect(msg.sms).to.contain('Details: https://hrxone.com/a/1');
  });

  it('digest summarizes the week and falls back to the app pointer', () => {
    const msg = buildOpenShiftMessage('openshift_weekly_digest', payload, 'en', 'C1 Staffing', '');
    expect(msg.sms).to.contain('Your week at Oracle Park: Mon–Fri 09:00–17:00.');
    const bare = buildOpenShiftMessage('openshift_weekly_digest', basePayload(), 'es', 'C1 Staffing', '');
    expect(bare.sms).to.contain('está en la app');
  });
});

describe('renderCadenceTemplate logistics variables', () => {
  it('exposes onsiteContact composition, parking, and checkIn tokens', () => {
    const out = renderCadenceTemplate(
      '{brand}: find {onsiteContact}. Parking: {parking} Check-in: {checkIn} {bogus}',
      {
        brand: 'C1 Staffing',
        onsiteContactName: 'Maria Lopez',
        onsiteContactRole: 'Catering Lead',
        onsiteContactPhone: '+14155550123',
        parking: 'Lot C.',
        checkIn: 'Gate B.',
      },
    );
    expect(out).to.equal('C1 Staffing: find Maria Lopez (Catering Lead): +14155550123. Parking: Lot C. Check-in: Gate B.');
  });
});
