import * as admin from 'firebase-admin';
import * as sinon from 'sinon';
import { expect } from 'chai';
import * as functions from 'firebase-functions';

// Import the callable under test
import { handleManageAssociations } from '../manageAssociations';

// Helpers to get exported function from the emulator registry
function getCallable(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('firebase-functions');
  return mod.v1?.https?.onCall?.func || mod.https?.onCall?.func || (mod as any)[name];
}

describe('manageAssociations', () => {
  const sandbox = sinon.createSandbox();
  const db = admin.firestore();

  beforeEach(() => {
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('stamps schemaVersion and audit fields on add and does not write legacy deal fields', async () => {
    // Arrange minimal Firestore stubs
    const colStub = sandbox.stub(db, 'collection');
    const userRef: any = { get: sandbox.stub().resolves({ exists: true, data: () => ({ tenantIds: ['t1'], crm_sales: true }) }) };
    const usersCol = { doc: sandbox.stub().returns(userRef) } as any;

    const dealRef: any = { get: sandbox.stub().resolves({ exists: true, data: () => ({}) }) };
    const companyRef: any = { get: sandbox.stub().resolves({ exists: true, data: () => ({ name: 'Acme' }) }) };

    const dealsCol = { doc: sandbox.stub().returns(dealRef) } as any;
    const companiesCol = { doc: sandbox.stub().returns(companyRef) } as any;

    // collection path branching
    colStub.callsFake((path: string) => {
      if (path === 'users') return usersCol;
      if (path === 'tenants/t1/crm_deals') return dealsCol;
      if (path === 'tenants/t1/crm_companies') return companiesCol;
      // default minimal
      return { doc: sandbox.stub().returns({ get: sandbox.stub().resolves({ exists: true, data: () => ({}) }) }) } as any;
    });

    // Batch updates capturing payloads
    const batchUpdateCalls: Array<{ ref: any; data: any }> = [];
    sandbox.stub(db, 'batch').returns({
      update: (ref: any, data: any) => batchUpdateCalls.push({ ref, data }),
      commit: sandbox.stub().resolves(void 0),
    } as any);

    // Act: call function
    const request = {
      data: {
        action: 'add',
        sourceEntityType: 'deal',
        sourceEntityId: 'd1',
        targetEntityType: 'company',
        targetEntityId: 'c1',
        tenantId: 't1'
      },
      auth: { uid: 'u1' }
    };
    const context = { auth: { uid: 'u1' } } as any;
    await handleManageAssociations(request as any, context);

    // Assert: batch updates carry schemaVersion and audit fields; no legacy companyId/companyName writes
    const updates = batchUpdateCalls.map(c => c.data);
    const assocAdd = updates.find(u => Object.keys(u).some(k => k.startsWith('associations.')));
    expect(assocAdd).to.exist;
    const asJson = JSON.stringify(assocAdd);
    expect(asJson).to.contain('schemaVersion');
    expect(asJson).to.contain('addedBy');
    expect(asJson).to.contain('addedAt');
    // Ensure legacy keys not present
    expect(asJson).to.not.contain('"companyId"');
    expect(asJson).to.not.contain('"companyName"');
  });
});


