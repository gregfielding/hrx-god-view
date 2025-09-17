import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { ClaimsRole } from '../contexts/AuthContext';

// Types for the invite service
export interface InviteUserParams {
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  desiredRole: ClaimsRole;
  securityLevel?: '1' | '2' | '3' | '4' | '5';
  sendPasswordReset?: boolean;
  customMessage?: string;
}

export interface InviteUserResult {
  inviteLink: string;
  userExists: boolean;
  uid: string;
}

export interface InviteOrAttachUserParams {
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  desiredRole: ClaimsRole;
  securityLevel?: '1' | '2' | '3' | '4' | '5';
  sendPasswordReset?: boolean;
  customMessage?: string;
}

/**
 * Client-side service for inviting users to tenants
 * This provides a unified interface for both Recruiter and Workforce flows
 */
export class InviteService {
  private static instance: InviteService;
  private inviteUserFunction: any;

  private constructor() {
    // Initialize the Cloud Function callable
    this.inviteUserFunction = httpsCallable(functions, 'inviteUser');
  }

  public static getInstance(): InviteService {
    if (!InviteService.instance) {
      InviteService.instance = new InviteService();
    }
    return InviteService.instance;
  }

  /**
   * Invite a user to a tenant with the specified role
   * This is the main function that both Recruiter and Workforce flows will use
   */
  public async inviteOrAttachUser(params: InviteOrAttachUserParams): Promise<InviteUserResult> {
    try {
      const result = await this.inviteUserFunction({
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        tenantId: params.tenantId,
        desiredRole: params.desiredRole,
        securityLevel: params.securityLevel || '3',
        sendPasswordReset: params.sendPasswordReset !== false, // Default to true
        customMessage: params.customMessage
      });

      return result.data as InviteUserResult;
    } catch (error: any) {
      console.error('Error inviting user:', error);
      
      // Handle specific error cases
      if (error.code === 'functions/permission-denied') {
        throw new Error('You do not have permission to invite users to this tenant.');
      } else if (error.code === 'functions/already-exists') {
        throw new Error('A user with this email already exists.');
      } else if (error.code === 'functions/invalid-argument') {
        throw new Error('Invalid input data. Please check your email and other fields.');
      } else if (error.code === 'functions/failed-precondition') {
        throw new Error('User account is disabled. Please contact support.');
      } else {
        throw new Error('Failed to invite user. Please try again.');
      }
    }
  }

  /**
   * Invite a user specifically for the Recruiter flow
   * This is a convenience method that sets appropriate defaults
   */
  public async inviteRecruiterUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }): Promise<InviteUserResult> {
    return this.inviteOrAttachUser({
      ...params,
      securityLevel: '3', // Default security level for recruiters
      sendPasswordReset: true, // Always send password reset for recruiters
      customMessage: params.customMessage || 'You have been invited to join our recruiting team.'
    });
  }

  /**
   * Invite a user specifically for the Workforce flow
   * This is a convenience method that sets appropriate defaults
   */
  public async inviteWorkerUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }): Promise<InviteUserResult> {
    return this.inviteOrAttachUser({
      ...params,
      securityLevel: '2', // Lower security level for workers
      sendPasswordReset: true, // Always send password reset for workers
      customMessage: params.customMessage || 'You have been invited to join our workforce.'
    });
  }

  /**
   * Get the invite link for a user (useful for resending invites)
   * This would require a separate Cloud Function to implement
   */
  public async getInviteLink(tenantId: string, uid: string): Promise<string> {
    // This would require implementing a separate Cloud Function
    // For now, we'll throw an error indicating it's not implemented
    throw new Error('Get invite link functionality not yet implemented');
  }

  /**
   * Cancel a pending invite
   * This would require a separate Cloud Function to implement
   */
  public async cancelInvite(tenantId: string, uid: string): Promise<void> {
    // This would require implementing a separate Cloud Function
    // For now, we'll throw an error indicating it's not implemented
    throw new Error('Cancel invite functionality not yet implemented');
  }
}

// Export singleton instance
export const inviteService = InviteService.getInstance();

// Export convenience functions for direct use
export const inviteOrAttachUser = (params: InviteOrAttachUserParams): Promise<InviteUserResult> => {
  return inviteService.inviteOrAttachUser(params);
};

export const inviteRecruiterUser = (params: {
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  desiredRole: ClaimsRole;
  customMessage?: string;
}): Promise<InviteUserResult> => {
  return inviteService.inviteRecruiterUser(params);
};

export const inviteWorkerUser = (params: {
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  desiredRole: ClaimsRole;
  customMessage?: string;
}): Promise<InviteUserResult> => {
  return inviteService.inviteWorkerUser(params);
};

export default inviteService;
