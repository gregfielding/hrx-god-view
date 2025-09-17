import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

// Input validation schema
const InviteUserInputSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  desiredRole: z.enum(['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer', 'Tenant', 'HRX']),
  securityLevel: z.enum(['1', '2', '3', '4', '5', '6', '7']).optional().default('3'),
  sendPasswordReset: z.boolean().optional().default(true), // Default to password reset
  customMessage: z.string().optional()
});

type InviteUserInput = z.infer<typeof InviteUserInputSchema>;

// Claims structure type
interface TenantRole {
  role: 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer' | 'Tenant' | 'HRX';
  securityLevel: '1' | '2' | '3' | '4' | '5' | '6' | '7';
}

interface CustomClaims {
  hrx?: boolean;
  roles?: {
    [tenantId: string]: TenantRole;
  };
  ver?: number;
  [key: string]: any; // Allow other custom claims
}

/**
 * Admin-only callable Cloud Function to invite a user to a tenant.
 * 
 * Authorization:
 * - Only HRX users (hrx: true in claims) can invite users.
 * - Tenant Admins (role: 'Admin' in target tenant) can invite users to their tenant.
 * 
 * Behavior:
 * - Creates Firebase Auth user if not exists (disabled=false)
 * - Sets claims roles[tenantId] = { role, securityLevel }
 * - Writes lightweight tenants/{tenantId}/pending_invites/{uid} doc with metadata
 * - Sends password reset link or email-link sign-in depending on config
 * - Returns the invite link for UI display
 */
export const inviteUser = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request): Promise<{ inviteLink: string; userExists: boolean; uid: string }> => {
    const { data, auth } = request;
    
    // Validate authentication
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const callerUid = auth.uid;

    // Validate input
    let validatedData: InviteUserInput;
    try {
      validatedData = InviteUserInputSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues.map(e => e.message).join(', ');
        throw new HttpsError('invalid-argument', `Validation error: ${errorMessage}`);
      }
      throw new HttpsError('invalid-argument', 'Invalid input data');
    }

    const { 
      email, 
      firstName, 
      lastName, 
      tenantId, 
      desiredRole, 
      securityLevel,
      sendPasswordReset,
      customMessage 
    } = validatedData;

    try {
      // Get caller's current claims to check permissions
      const callerUser = await admin.auth().getUser(callerUid);
      const callerClaims = (callerUser.customClaims || {}) as CustomClaims;
      const callerIsHRX = !!callerClaims.hrx;

      // Check if caller is Admin in the target tenant
      const callerTenantRole = callerClaims.roles?.[tenantId];
      const callerIsTenantAdmin = callerTenantRole?.role === 'Admin';

      // Authorization check
      if (!callerIsHRX && !callerIsTenantAdmin) {
        throw new HttpsError(
          'permission-denied',
          'Only HRX users or tenant Admins can invite users'
        );
      }

      // Check if user already exists
      let targetUser: admin.auth.UserRecord;
      let userExists = false;
      
      try {
        targetUser = await admin.auth().getUserByEmail(email);
        userExists = true;
        
        // Check if user is already disabled
        if (targetUser.disabled) {
          throw new HttpsError(
            'failed-precondition',
            'User account is disabled. Please contact support.'
          );
        }
      } catch (error) {
        if (error instanceof HttpsError) {
          throw error;
        }
        
        // User doesn't exist, create them
        try {
          targetUser = await admin.auth().createUser({
            email,
            displayName: `${firstName} ${lastName}`,
            disabled: false,
            emailVerified: false
          });
          userExists = false;
        } catch (createError) {
          console.error('Error creating user:', createError);
          throw new HttpsError('internal', 'Failed to create user account');
        }
      }

      const targetUid = targetUser.uid;

      // Get target user's current claims
      const currentClaims = (targetUser.customClaims || {}) as CustomClaims;

      // Build new claims with the tenant role
      const newClaims: CustomClaims = {
        ...currentClaims,
        roles: {
          ...(currentClaims.roles || {}),
          [tenantId]: { role: desiredRole, securityLevel }
        },
        ver: (currentClaims.ver || 0) + 1 // Increment version to force token refresh
      };

      // Set the claims
      await admin.auth().setCustomUserClaims(targetUid, newClaims);

      // Create pending invite document
      const pendingInviteData = {
        email,
        firstName,
        lastName,
        tenantId,
        role: desiredRole,
        securityLevel,
        invitedBy: callerUid,
        invitedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        customMessage: customMessage || null,
        sendPasswordReset,
        // Store the invite link for reference
        inviteLink: sendPasswordReset ? 'password-reset' : 'email-link'
      };

      await admin.firestore()
        .collection('tenants')
        .doc(tenantId)
        .collection('pending_invites')
        .doc(targetUid)
        .set(pendingInviteData);

      // Generate invite link
      let inviteLink: string;
      
      if (sendPasswordReset) {
        // Generate password reset link
        const actionCodeSettings = {
          url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`,
          handleCodeInApp: false
        };
        
        inviteLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);
      } else {
        // Generate email link for sign-in
        const actionCodeSettings = {
          url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`,
          handleCodeInApp: false
        };
        
        inviteLink = await admin.auth().generateSignInWithEmailLink(email, actionCodeSettings);
      }

      // Log the action for audit purposes
      console.log(`User invited: ${callerUid} invited ${email} to ${tenantId} as ${desiredRole} (security: ${securityLevel})`);

      return {
        inviteLink,
        userExists,
        uid: targetUid
      };

    } catch (error) {
      console.error('Error in inviteUser:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      // Handle specific Firebase Auth errors
      if (error instanceof Error) {
        if (error.message.includes('email-already-exists')) {
          throw new HttpsError('already-exists', 'User with this email already exists');
        }
        if (error.message.includes('invalid-email')) {
          throw new HttpsError('invalid-argument', 'Invalid email address');
        }
      }

      throw new HttpsError('internal', 'Failed to invite user');
    }
  }
);
