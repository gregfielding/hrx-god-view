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

import { buildCadenceMessage, type CadenceMessagePayload } from '../../cadence/cadenceMessages';

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
