import * as admin from 'firebase-admin';
import { setTenantRole } from '../../auth/setTenantRole';

// Mock Firebase Admin
const mockGetUser = jest.fn();
const mockSetCustomUserClaims = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    getUser: mockGetUser,
    setCustomUserClaims: mockSetCustomUserClaims
  }))
}));

describe('setTenantRole', () => {
  const mockContext = {
    auth: {
      uid: 'caller-uid',
      token: {}
    }
  };

  // `setTenantRole` is a firebase-functions v2 onCall. The exported value is an
  // HTTP handler `(req, res)` — invoking it with `(data, context)` v1-style
  // explodes with "res.on is not a function". The v2 test surface is `.run()`,
  // which takes a CallableRequest and skips token verification.
  const callSetTenantRole = (data: unknown, context: { auth: unknown } = mockContext) =>
    (setTenantRole as any).run({ data, auth: context.auth, rawRequest: {} });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockClear();
    mockSetCustomUserClaims.mockClear();
  });

  describe('HRX Admin permissions', () => {
    it('should allow HRX admin to set any tenant role', async () => {
      // Mock caller as HRX admin
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: { hrx: true, roles: {} }
      } as any);

      // Mock target user
      mockGetUser.mockResolvedValueOnce({
        uid: 'target-uid',
        customClaims: {}
      } as any);

      // Mock successful claims update
      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

      const result = await callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext);

      // ver is `(currentClaims.ver || 1) + 1` — a user with no prior claims
      // starts at 2, not 1 (ver only exists to change and force token refresh).
      expect(result).toEqual({
        hrx: undefined,
        roles: {
          'tenant-123': {
            role: 'Recruiter',
            securityLevel: '4'
          }
        },
        ver: 2
      });

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('target-uid', {
        hrx: undefined,
        roles: {
          'tenant-123': {
            role: 'Recruiter',
            securityLevel: '4'
          }
        },
        ver: 2
      });
    });

    it('should allow HRX admin to set HRX flag', async () => {
      // Mock caller as HRX admin
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: { hrx: true, roles: {} }
      } as any);

      // Mock target user
      mockGetUser.mockResolvedValueOnce({
        uid: 'target-uid',
        customClaims: {}
      } as any);

      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

      const result = await callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Admin',
        securityLevel: '5',
        hrx: true
      }, mockContext);

      expect(result.hrx).toBe(true);
    });
  });

  describe('Tenant Admin permissions', () => {
    it('should allow tenant admin to set roles within their tenant', async () => {
      // Mock caller as tenant admin
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: {
          roles: {
            'tenant-123': { role: 'Admin', securityLevel: '5' }
          }
        }
      } as any);

      // Mock target user
      mockGetUser.mockResolvedValueOnce({
        uid: 'target-uid',
        customClaims: {}
      } as any);

      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

      const result = await callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Worker',
        securityLevel: '2'
      }, mockContext);

      expect(result.roles?.['tenant-123']).toEqual({
        role: 'Worker',
        securityLevel: '2'
      });
    });

    it('should reject tenant admin trying to set roles in different tenant', async () => {
      // Mock caller as admin in tenant-123
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: {
          roles: {
            'tenant-123': { role: 'Admin', securityLevel: '5' }
          }
        }
      } as any);

      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-456', // Different tenant
        role: 'Worker',
        securityLevel: '2'
      }, mockContext)).rejects.toThrow('Only HRX users or tenant Admins can set tenant roles');
    });
  });

  describe('Non-admin permissions', () => {
    it('should reject non-admin users', async () => {
      // Mock caller as regular user
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: {
          roles: {
            'tenant-123': { role: 'Worker', securityLevel: '2' }
          }
        }
      } as any);

      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext)).rejects.toThrow('Only HRX users or tenant Admins can set tenant roles');
    });

    it('should reject users without any roles', async () => {
      // Mock caller with no roles
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: {}
      } as any);

      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext)).rejects.toThrow('Only HRX users or tenant Admins can set tenant roles');
    });
  });

  describe('Input validation', () => {
    // The schema widened since these were written (roles now include Tenant and
    // HRX; securityLevel runs '1'–'7') and enum errors surface zod's default
    // message wrapped as `Validation error: ...`.
    it('should reject invalid role values', async () => {
      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'InvalidRole' as any,
        securityLevel: '4'
      }, mockContext)).rejects.toThrow(
        "Validation error: Invalid enum value. Expected 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer' | 'Tenant' | 'HRX', received 'InvalidRole'"
      );
    });

    it('should reject invalid security level values', async () => {
      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '9' as any // '6' and '7' became valid when the enum widened
      }, mockContext)).rejects.toThrow(
        "Validation error: Invalid enum value. Expected '1' | '2' | '3' | '4' | '5' | '6' | '7', received '9'"
      );
    });

    it('should reject missing required fields', async () => {
      await expect(callSetTenantRole({
        targetUid: '',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext)).rejects.toThrow('targetUid is required');
    });
  });

  describe('Idempotency and safety', () => {
    it('should not overwrite other tenant roles', async () => {
      // Mock caller as HRX admin
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: { hrx: true, roles: {} }
      } as any);

      // Mock target user with existing roles in other tenants
      mockGetUser.mockResolvedValueOnce({
        uid: 'target-uid',
        customClaims: {
          roles: {
            'tenant-456': { role: 'Manager', securityLevel: '3' },
            'tenant-789': { role: 'Worker', securityLevel: '2' }
          },
          ver: 5
        }
      } as any);

      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

      const result = await callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext);

      expect(result.roles).toEqual({
        'tenant-456': { role: 'Manager', securityLevel: '3' },
        'tenant-789': { role: 'Worker', securityLevel: '2' },
        'tenant-123': { role: 'Recruiter', securityLevel: '4' }
      });

      expect(result.ver).toBe(6); // Should increment version
    });

    it('should be safe to call multiple times with same data', async () => {
      // Mock caller as HRX admin
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: { hrx: true, roles: {} }
      } as any);

      // Mock target user
      mockGetUser.mockResolvedValueOnce({
        uid: 'target-uid',
        customClaims: {
          roles: {
            'tenant-123': { role: 'Recruiter', securityLevel: '4' }
          },
          ver: 3
        }
      } as any);

      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

      // Call with same data
      const result = await callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, mockContext);

      expect(result.roles?.['tenant-123']).toEqual({
        role: 'Recruiter',
        securityLevel: '4'
      });

      expect(result.ver).toBe(4); // Should still increment version
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { auth: null };

      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Recruiter',
        securityLevel: '4'
      }, unauthenticatedContext)).rejects.toThrow('Authentication required');
    });
  });

  describe('HRX flag restrictions', () => {
    it('should reject non-HRX users trying to set HRX flag', async () => {
      // Mock caller as tenant admin (not HRX)
      mockGetUser.mockResolvedValueOnce({
        uid: 'caller-uid',
        customClaims: {
          roles: {
            'tenant-123': { role: 'Admin', securityLevel: '5' }
          }
        }
      } as any);

      await expect(callSetTenantRole({
        targetUid: 'target-uid',
        tenantId: 'tenant-123',
        role: 'Admin',
        securityLevel: '5',
        hrx: true
      }, mockContext)).rejects.toThrow('Only HRX users can set the hrx flag');
    });
  });
});
