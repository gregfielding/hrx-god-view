import { useState, useCallback } from 'react';
import { inviteService, InviteOrAttachUserParams, InviteUserResult } from '../services/inviteService';
import { ClaimsRole } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';

export interface UseInviteUserState {
  loading: boolean;
  error: string | null;
  result: InviteUserResult | null;
}

export interface UseInviteUserReturn extends UseInviteUserState {
  inviteUser: (params: InviteOrAttachUserParams) => Promise<void>;
  inviteRecruiterUser: (params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }) => Promise<void>;
  inviteWorkerUser: (params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }) => Promise<void>;
  clearError: () => void;
  clearResult: () => void;
  reset: () => void;
}

/**
 * React hook for inviting users to tenants
 * Provides a clean interface for both Recruiter and Workforce flows
 */
export const useInviteUser = (): UseInviteUserReturn => {
  const { activeTenant } = useAuth();
  const [state, setState] = useState<UseInviteUserState>({
    loading: false,
    error: null,
    result: null
  });

  const inviteUser = useCallback(async (params: InviteOrAttachUserParams) => {
    setState(prev => ({ ...prev, loading: true, error: null, result: null }));
    
    try {
      const result = await inviteService.inviteOrAttachUser(params);
      setState(prev => ({ ...prev, loading: false, result }));
    } catch (error: any) {
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message || 'Failed to invite user' 
      }));
    }
  }, []);

  const inviteRecruiterUser = useCallback(async (params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }) => {
    setState(prev => ({ ...prev, loading: true, error: null, result: null }));
    
    try {
      const result = await inviteService.inviteRecruiterUser(params);
      setState(prev => ({ ...prev, loading: false, result }));
    } catch (error: any) {
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message || 'Failed to invite recruiter user' 
      }));
    }
  }, []);

  const inviteWorkerUser = useCallback(async (params: {
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    desiredRole: ClaimsRole;
    customMessage?: string;
  }) => {
    setState(prev => ({ ...prev, loading: true, error: null, result: null }));
    
    try {
      const result = await inviteService.inviteWorkerUser(params);
      setState(prev => ({ ...prev, loading: false, result }));
    } catch (error: any) {
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message || 'Failed to invite worker user' 
      }));
    }
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const clearResult = useCallback(() => {
    setState(prev => ({ ...prev, result: null }));
  }, []);

  const reset = useCallback(() => {
    setState({
      loading: false,
      error: null,
      result: null
    });
  }, []);

  return {
    ...state,
    inviteUser,
    inviteRecruiterUser,
    inviteWorkerUser,
    clearError,
    clearResult,
    reset
  };
};

export default useInviteUser;
