/**
 * Slack Access Control Utilities
 * 
 * Helper functions for checking if users can access Slack admin features.
 * Only users with securityLevel 5-7 (Staff Manager, Manager, Admin) can access.
 */

import { useAuth } from '../contexts/AuthContext';

/**
 * Check if current user can access Slack admin features
 * Requires securityLevel >= 5 and <= 7
 */
export function canAccessSlackAdmin(securityLevel: string | undefined): boolean {
  if (!securityLevel) return false;
  const level = parseInt(securityLevel, 10);
  return level >= 5 && level <= 7;
}

/**
 * React hook to check Slack admin access
 */
export function useSlackAdminAccess(): boolean {
  const { securityLevel } = useAuth();
  return canAccessSlackAdmin(securityLevel);
}



