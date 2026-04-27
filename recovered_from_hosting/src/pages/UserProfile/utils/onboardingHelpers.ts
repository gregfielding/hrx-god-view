// Helper functions for onboarding status management and security level transitions

import { doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { logSecurityChangeActivity } from '../../../utils/activityLogger';
import type { OnboardingStatus, OnboardingType } from './onboardingTasks';
import { areRequiredTasksComplete, initializeOnboardingTasks } from './onboardingTasks';

/**
 * Start onboarding for a user
 */
export const startOnboarding = async (
  userId: string,
  tenantId: string,
  type: OnboardingType,
  jobOrderId?: string,
  startedBy?: string
): Promise<void> => {
  const userRef = doc(db, 'users', userId);
  
  const updateData: any = {
    [`${type}OnboardStatus`]: 'In Progress' as OnboardingStatus,
    [`${type}OnboardingStartedAt`]: serverTimestamp(),
    [`${type}OnboardingStartedBy`]: startedBy || null,
    updatedAt: serverTimestamp(),
  };

  if (jobOrderId) {
    updateData.onboardingJobOrderId = jobOrderId;
  }

  if (type === 'employee') {
    updateData.onboardingType = 'employee';
  } else {
    updateData.onboardingType = 'contractor';
  }

  // Get existing user data to preserve existing tasks
  const userSnap = await getDoc(userRef);
  const existingTasks = userSnap.exists() ? (userSnap.data().onboardingTasks || []) : [];
  
  // Initialize tasks for this onboarding type
  const initializedTasks = initializeOnboardingTasks(type, existingTasks);
  updateData.onboardingTasks = initializedTasks;

  await updateDoc(userRef, updateData);
};

/**
 * Cancel onboarding
 */
export const cancelOnboarding = async (
  userId: string,
  tenantId: string,
  type: OnboardingType,
  cancelledBy?: string
): Promise<void> => {
  const userRef = doc(db, 'users', userId);
  
  await updateDoc(userRef, {
    [`${type}OnboardStatus`]: 'Cancelled' as OnboardingStatus,
    [`${type}OnboardingCancelledAt`]: serverTimestamp(),
    [`${type}OnboardingCancelledBy`]: cancelledBy || null,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Complete onboarding and update security level
 */
export const completeOnboarding = async (
  userId: string,
  tenantId: string,
  type: OnboardingType,
  completedBy?: string
): Promise<void> => {
  const userRef = doc(db, 'users', userId);
  
  // Determine new security level based on onboarding type
  // Employee: 2 → 4 (Hired Staff)
  // Contractor: 2 → 3 (Flex)
  const newSecurityLevel = type === 'employee' ? '4' : '3';
  
  // Get current user data to check current security level
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error('User document not found');
  }
  
  const userData = userSnap.data();
  const currentSecurityLevel = userData.tenantIds?.[tenantId]?.securityLevel || userData.securityLevel || '2';
  
  // Update onboarding status
  const updateData: any = {
    [`${type}OnboardStatus`]: 'Completed' as OnboardingStatus,
    [`${type}OnboardingCompletedAt`]: serverTimestamp(),
    [`${type}OnboardingCompletedBy`]: completedBy || null,
    updatedAt: serverTimestamp(),
  };
  
  // Update security level in tenantIds map
  if (!updateData.tenantIds) {
    updateData.tenantIds = userData.tenantIds || {};
  }
  
  if (!updateData.tenantIds[tenantId]) {
    updateData.tenantIds[tenantId] = userData.tenantIds?.[tenantId] || {};
  }
  
  updateData.tenantIds[tenantId].securityLevel = newSecurityLevel;
  updateData.tenantIds[tenantId].role = type === 'employee' ? 'Hired Staff' : 'Flex';
  updateData.tenantIds[tenantId].updatedAt = serverTimestamp();
  
  // Also update the root securityLevel for backward compatibility
  if (!userData.tenantIds || Object.keys(userData.tenantIds).length === 0) {
    updateData.securityLevel = newSecurityLevel;
    updateData.role = type === 'employee' ? 'Hired Staff' : 'Flex';
  }
  
  await updateDoc(userRef, updateData);
  
  // Log security level change
  if (currentSecurityLevel !== newSecurityLevel) {
    await logSecurityChangeActivity(
      userId,
      `Security level changed from ${currentSecurityLevel} to ${newSecurityLevel}`,
      `Onboarding completed: ${type} onboarding. Security level updated.`,
      {
        tenantId,
        previousLevel: currentSecurityLevel,
        newLevel: newSecurityLevel,
        completedBy,
      }
    );
  }
};

/**
 * Check if user is currently being onboarded
 */
export const isOnboardingInProgress = (
  employeeOnboardStatus?: OnboardingStatus,
  contractorOnboardStatus?: OnboardingStatus
): boolean => {
  return employeeOnboardStatus === 'In Progress' || contractorOnboardStatus === 'In Progress';
};

/**
 * Get the active onboarding type
 */
export const getActiveOnboardingType = (
  employeeOnboardStatus?: OnboardingStatus,
  contractorOnboardStatus?: OnboardingStatus
): OnboardingType | null => {
  if (employeeOnboardStatus === 'In Progress') return 'employee';
  if (contractorOnboardStatus === 'In Progress') return 'contractor';
  return null;
};

