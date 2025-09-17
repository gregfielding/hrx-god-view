import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

// Input validation schema
const SetTenantRoleInputSchema = z.object({
  targetUid: z.string().min(1, 'targetUid is required'),
  tenantId: z.string().min(1, 'tenantId is required'),
  role: z.enum(['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer', 'Tenant', 'HRX']),
  securityLevel: z.enum(['1', '2', '3', '4', '5', '6', '7']),
  hrx: z.boolean().optional()
});

type SetTenantRoleInput = z.infer<typeof SetTenantRoleInputSchema>;

// Claims structure type
interface TenantRole {
  role: string;
  securityLevel: string;
}

interface CustomClaims {
  hrx?: boolean;
  roles?: Record<string, TenantRole>;
  ver?: number;
}

/**
 * Set tenant role for a user via Firebase custom claims
 * 
 * Security:
 * - Only HRX users (hrx: true) can set any tenant role
 * - Tenant Admins can only set roles within their own tenant
 * - All other users are rejected
 * 
 * Behavior:
 * - Idempotent: safe to call multiple times with same data
 * - Preserves other tenant roles
 * - Updates version number to force token refresh
 */
export const setTenantRole = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request): Promise<CustomClaims> => {
    const { data, auth } = request;
    // Validate authentication
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const callerUid = auth.uid;
    
    // Validate input
    let validatedData: SetTenantRoleInput;
    try {
      validatedData = SetTenantRoleInputSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues.map(e => e.message).join(', ');
        throw new HttpsError('invalid-argument', `Validation error: ${errorMessage}`);
      }
      throw new HttpsError('invalid-argument', 'Invalid input data');
    }

    const { targetUid, tenantId, role, securityLevel, hrx } = validatedData;

    try {
      // Get caller's current claims to check permissions
      const callerUser = await admin.auth().getUser(callerUid);
      const callerClaims = (callerUser.customClaims || {}) as CustomClaims;
      
      // Check if caller is HRX admin
      const callerIsHRX = !!callerClaims.hrx;
      
      // Check if caller is Admin in the target tenant
      const callerTenantRole = callerClaims.roles?.[tenantId];
      const callerIsTenantAdmin = callerTenantRole?.role === 'Admin';

      // Authorization check
      if (!callerIsHRX && !callerIsTenantAdmin) {
        throw new HttpsError(
          'permission-denied',
          'Only HRX users or tenant Admins can set tenant roles'
        );
      }

      // If setting HRX flag, only HRX users can do this
      if (hrx !== undefined && !callerIsHRX) {
        throw new HttpsError(
          'permission-denied',
          'Only HRX users can set the hrx flag'
        );
      }

      // Get target user's current claims
      const targetUser = await admin.auth().getUser(targetUid);
      const currentClaims = (targetUser.customClaims || {}) as CustomClaims;

      // Build new claims object
      const newClaims: CustomClaims = {
        ...currentClaims,
        roles: {
          ...currentClaims.roles,
          [tenantId]: {
            role,
            securityLevel
          }
        },
        ver: (currentClaims.ver || 1) + 1 // Increment version to force token refresh
      };

      // Set HRX flag if provided (only HRX users can do this)
      if (hrx !== undefined && callerIsHRX) {
        newClaims.hrx = hrx;
      }

      // Update custom claims
      await admin.auth().setCustomUserClaims(targetUid, newClaims);

      // Log the action for audit purposes
      console.log(`Role updated: ${callerUid} set ${targetUid} role in ${tenantId} to ${role} (security: ${securityLevel})`);

      return newClaims;

    } catch (error) {
      console.error('Error in setTenantRole:', error);
      
      if (error instanceof HttpsError) {
        throw error;
      }
      
      // Handle specific Firebase Auth errors
      if (error instanceof Error) {
        if (error.message.includes('user-not-found')) {
          throw new HttpsError('not-found', 'Target user not found');
        }
        if (error.message.includes('invalid-uid')) {
          throw new HttpsError('invalid-argument', 'Invalid target user ID');
        }
      }
      
      throw new HttpsError('internal', 'Failed to update tenant role');
    }
  }
);
