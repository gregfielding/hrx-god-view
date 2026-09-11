/**
 * setTenantRole — mocha/chai/sinon port (2026-09-06).
 *
 * This file was written for jest (`jest.mock('firebase-admin')`, `toEqual`,
 * `rejects.toThrow`) but the functions package runs mocha, so `npm test`
 * died on `ReferenceError: jest is not defined` before any other suite ran.
 * The module under test does `import * as admin from 'firebase-admin'` and
 * calls `admin.auth()` at call time, so stubbing `auth` on the shared module
 * object is enough — no module-loader mocking needed.
 */

import * as admin from 'firebase-admin';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { setTenantRole } from '../../auth/setTenantRole';

describe('setTenantRole', () => {
  // `admin.auth` lives on the namespace prototype (not stubbable as an own
  // property), but the Auth instance is a per-app singleton, so stubbing its
  // methods is reliable. setup.ts initialises the demo app before this runs.
  let getUser: sinon.SinonStub;
  let setCustomUserClaims: sinon.SinonStub;

  const mockContext = {
    auth: {
      uid: 'caller-uid',
      token: {},
    },
  };

  // `setTenantRole` is a firebase-functions v2 onCall. The exported value is an
  // HTTP handler `(req, res)` — invoking it with `(data, context)` v1-style
  // explodes with "res.on is not a function". The v2 test surface is `.run()`,
  // which takes a CallableRequest and skips token verification.
  const callSetTenantRole = (data: unknown, context: { auth: unknown } = mockContext): Promise<any> =>
    (setTenantRole as any).run({ data, auth: context.auth, rawRequest: {} });

  async function expectRejects(p: Promise<unknown>, message: string): Promise<void> {
    try {
      await p;
    } catch (e: any) {
      expect(String(e?.message ?? e)).to.include(message);
      return;
    }
    throw new Error(`expected rejection containing "${message}"`);
  }

  // beforeEach/afterEach (not before/after): the package's ambient test
  // globals come from @types/jest, which has no mocha-style `before`.
  beforeEach(() => {
    const auth = admin.auth() as any;
    getUser = sinon.stub(auth, 'getUser');
    setCustomUserClaims = sinon.stub(auth, 'setCustomUserClaims');
  });

  afterEach(() => {
    getUser.restore();
    setCustomUserClaims.restore();
  });

  describe('HRX Admin permissions', () => {
    it('should allow HRX admin to set any tenant role', async () => {
      getUser.onFirstCall().resolves({ uid: 'caller-uid', customClaims: { hrx: true, roles: {} } });
      getUser.onSecondCall().resolves({ uid: 'target-uid', customClaims: {} });
      setCustomUserClaims.resolves(undefined);

      const result = await callSetTenantRole(
        { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
        mockContext,
      );

      // ver is `(currentClaims.ver || 1) + 1` — a user with no prior claims
      // starts at 2, not 1 (ver only exists to change and force token refresh).
      // `hrx` is carried as an explicit undefined; chai's deep-equal (unlike
      // jest's toEqual) treats a present-but-undefined key as a difference, so
      // compare through a JSON round trip that drops it.
      const dropUndefined = (o: unknown) => JSON.parse(JSON.stringify(o));
      const expected = {
        roles: { 'tenant-123': { role: 'Recruiter', securityLevel: '4' } },
        ver: 2,
      };
      expect(dropUndefined(result)).to.deep.equal(expected);
      expect(result.hrx).to.equal(undefined);
      expect(setCustomUserClaims.calledOnce).to.equal(true);
      expect(setCustomUserClaims.firstCall.args[0]).to.equal('target-uid');
      expect(dropUndefined(setCustomUserClaims.firstCall.args[1])).to.deep.equal(expected);
    });

    it('should allow HRX admin to set HRX flag', async () => {
      getUser.onFirstCall().resolves({ uid: 'caller-uid', customClaims: { hrx: true, roles: {} } });
      getUser.onSecondCall().resolves({ uid: 'target-uid', customClaims: {} });
      setCustomUserClaims.resolves(undefined);

      const result = await callSetTenantRole(
        { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Admin', securityLevel: '5', hrx: true },
        mockContext,
      );

      expect(result.hrx).to.equal(true);
    });
  });

  describe('Tenant Admin permissions', () => {
    it('should allow tenant admin to set roles within their tenant', async () => {
      getUser.onFirstCall().resolves({
        uid: 'caller-uid',
        customClaims: { roles: { 'tenant-123': { role: 'Admin', securityLevel: '5' } } },
      });
      getUser.onSecondCall().resolves({ uid: 'target-uid', customClaims: {} });
      setCustomUserClaims.resolves(undefined);

      const result = await callSetTenantRole(
        { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Worker', securityLevel: '2' },
        mockContext,
      );

      expect(result.roles?.['tenant-123']).to.deep.equal({ role: 'Worker', securityLevel: '2' });
    });

    it('should reject tenant admin trying to set roles in different tenant', async () => {
      getUser.onFirstCall().resolves({
        uid: 'caller-uid',
        customClaims: { roles: { 'tenant-123': { role: 'Admin', securityLevel: '5' } } },
      });

      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-456', role: 'Worker', securityLevel: '2' },
          mockContext,
        ),
        'Only HRX users or tenant Admins can set tenant roles',
      );
    });
  });

  describe('Non-admin permissions', () => {
    it('should reject non-admin users', async () => {
      getUser.onFirstCall().resolves({
        uid: 'caller-uid',
        customClaims: { roles: { 'tenant-123': { role: 'Worker', securityLevel: '2' } } },
      });

      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
          mockContext,
        ),
        'Only HRX users or tenant Admins can set tenant roles',
      );
    });

    it('should reject users without any roles', async () => {
      getUser.onFirstCall().resolves({ uid: 'caller-uid', customClaims: {} });

      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
          mockContext,
        ),
        'Only HRX users or tenant Admins can set tenant roles',
      );
    });
  });

  describe('Input validation', () => {
    // The schema widened since these were written (roles now include Tenant and
    // HRX; securityLevel runs '1'–'7') and enum errors surface zod's default
    // message wrapped as `Validation error: ...`.
    it('should reject invalid role values', async () => {
      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'InvalidRole', securityLevel: '4' },
          mockContext,
        ),
        "Validation error: Invalid enum value. Expected 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer' | 'Tenant' | 'HRX', received 'InvalidRole'",
      );
    });

    it('should reject invalid security level values', async () => {
      await expectRejects(
        callSetTenantRole(
          // '6' and '7' became valid when the enum widened
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '9' },
          mockContext,
        ),
        "Validation error: Invalid enum value. Expected '1' | '2' | '3' | '4' | '5' | '6' | '7', received '9'",
      );
    });

    it('should reject missing required fields', async () => {
      await expectRejects(
        callSetTenantRole(
          { targetUid: '', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
          mockContext,
        ),
        'targetUid is required',
      );
    });
  });

  describe('Idempotency and safety', () => {
    it('should not overwrite other tenant roles', async () => {
      getUser.onFirstCall().resolves({ uid: 'caller-uid', customClaims: { hrx: true, roles: {} } });
      getUser.onSecondCall().resolves({
        uid: 'target-uid',
        customClaims: {
          roles: {
            'tenant-456': { role: 'Manager', securityLevel: '3' },
            'tenant-789': { role: 'Worker', securityLevel: '2' },
          },
          ver: 5,
        },
      });
      setCustomUserClaims.resolves(undefined);

      const result = await callSetTenantRole(
        { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
        mockContext,
      );

      expect(result.roles).to.deep.equal({
        'tenant-456': { role: 'Manager', securityLevel: '3' },
        'tenant-789': { role: 'Worker', securityLevel: '2' },
        'tenant-123': { role: 'Recruiter', securityLevel: '4' },
      });
      expect(result.ver).to.equal(6); // Should increment version
    });

    it('should be safe to call multiple times with same data', async () => {
      getUser.onFirstCall().resolves({ uid: 'caller-uid', customClaims: { hrx: true, roles: {} } });
      getUser.onSecondCall().resolves({
        uid: 'target-uid',
        customClaims: { roles: { 'tenant-123': { role: 'Recruiter', securityLevel: '4' } }, ver: 3 },
      });
      setCustomUserClaims.resolves(undefined);

      const result = await callSetTenantRole(
        { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
        mockContext,
      );

      expect(result.roles?.['tenant-123']).to.deep.equal({ role: 'Recruiter', securityLevel: '4' });
      expect(result.ver).to.equal(4); // Should still increment version
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Recruiter', securityLevel: '4' },
          { auth: null },
        ),
        'Authentication required',
      );
    });
  });

  describe('HRX flag restrictions', () => {
    it('should reject non-HRX users trying to set HRX flag', async () => {
      getUser.onFirstCall().resolves({
        uid: 'caller-uid',
        customClaims: { roles: { 'tenant-123': { role: 'Admin', securityLevel: '5' } } },
      });

      await expectRejects(
        callSetTenantRole(
          { targetUid: 'target-uid', tenantId: 'tenant-123', role: 'Admin', securityLevel: '5', hrx: true },
          mockContext,
        ),
        'Only HRX users can set the hrx flag',
      );
    });
  });
});
