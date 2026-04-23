import { expect } from 'chai';
import * as admin from 'firebase-admin';
import {
  coerceWebhookTimestamp,
  computeServiceLineKey,
  extractServiceLinePayloads,
  extractServiceLinePatch,
  mergeServiceLineDocument,
} from '../../integrations/accusource/accusourceWebhookServiceLine';

describe('accusourceWebhookServiceLine', () => {
  it('extractServiceLinePatch reads price, jurisdiction, and timestamps', () => {
    const patch = extractServiceLinePatch({
      service_id: 'CR-2604-00094247',
      service_name: 'County Criminal',
      status: 'Completed',
      amount: 6.3,
      jurisdiction: 'Orange, US-FL',
      completed_at: '2026-04-21T20:44:31.000Z',
      ordered_at: '2026-04-20T22:43:13.000Z',
    });
    expect(patch.serviceName).to.equal('County Criminal');
    expect(patch.status).to.equal('Completed');
    expect(patch.providerPrice).to.equal(6.3);
    expect(patch.jurisdiction).to.equal('Orange, US-FL');
    expect(patch.completedAt).to.be.instanceOf(admin.firestore.Timestamp);
    expect(patch.orderedAt).to.be.instanceOf(admin.firestore.Timestamp);
  });

  it('mergeServiceLineDocument retains prior price when omitted in new patch', () => {
    const receiveNow = admin.firestore.FieldValue.serverTimestamp();
    const prev = {
      serviceName: 'County Criminal',
      status: 'In Progress',
      providerPrice: 6.3,
      updatedAt: receiveNow,
    };
    const patch = extractServiceLinePatch({
      service_name: 'County Criminal',
      status: 'Completed',
    });
    const merged = mergeServiceLineDocument(prev, patch, receiveNow);
    expect(merged.providerPrice).to.equal(6.3);
    expect(merged.status).to.equal('Completed');
  });

  it('extractServiceLinePayloads expands services array for order payload', () => {
    const rows = extractServiceLinePayloads({
      type: 'order_status_change',
      profile_id: '123',
      services: [{ service_id: 'A-1', service_name: 'Test', status: 'Pending', price: 1 }],
    });
    expect(rows).to.have.length(1);
    expect(rows[0].service_id).to.equal('A-1');
  });

  it('computeServiceLineKey prefers service_id', () => {
    expect(computeServiceLineKey({ service_id: 'x' })).to.equal('x');
    expect(computeServiceLineKey({ service_name: 'Foo' })).to.equal('name:Foo');
  });

  it('coerceWebhookTimestamp parses ISO strings', () => {
    const ts = coerceWebhookTimestamp('2026-04-21T20:44:31.000Z');
    expect(ts).to.be.instanceOf(admin.firestore.Timestamp);
  });
});
