import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export interface ActivityLogData {
  userId: string;
  action: string;
  actionType: 'login' | 'logout' | 'profile_update' | 'job_application' | 'assignment_update' | 'document_upload' | 'security_change' | 'notification' | 'other';
  description: string;
  severity: 'low' | 'medium' | 'high';
  source: 'web' | 'mobile' | 'api' | 'system';
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    location?: string;
    deviceType?: string;
    changes?: any;
    targetId?: string;
    targetType?: string;
    [key: string]: any;
  };
}

/**
 * Log a user activity to Firestore
 * @param activityData - The activity data to log
 * @returns Promise<void>
 */
export const logUserActivity = async (activityData: ActivityLogData): Promise<void> => {
  try {
    const { userId, ...logData } = activityData;
    
    await addDoc(collection(db, 'users', userId, 'activityLogs'), {
      ...logData,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error logging user activity:', error);
    // Don't throw error to prevent breaking main functionality
  }
};

/**
 * Log a login activity
 */
export const logLoginActivity = async (userId: string, metadata?: ActivityLogData['metadata']) => {
  await logUserActivity({
    userId,
    action: 'User Login',
    actionType: 'login',
    description: 'User successfully logged into the system',
    severity: 'low',
    source: 'web',
    metadata: {
      ...metadata,
      deviceType: 'web',
    },
  });
};

/**
 * Log a logout activity
 */
export const logLogoutActivity = async (userId: string, metadata?: ActivityLogData['metadata']) => {
  await logUserActivity({
    userId,
    action: 'User Logout',
    actionType: 'logout',
    description: 'User logged out of the system',
    severity: 'low',
    source: 'web',
    metadata: {
      ...metadata,
      deviceType: 'web',
    },
  });
};

/**
 * Log a profile update activity
 */
export const logProfileUpdateActivity = async (
  userId: string, 
  changes: any, 
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Profile Update',
    actionType: 'profile_update',
    description: 'User updated their profile information',
    severity: 'medium',
    source: 'web',
    metadata: {
      ...metadata,
      changes,
      targetType: 'profile',
    },
  });
};

/**
 * Log a job application activity
 */
export const logJobApplicationActivity = async (
  userId: string,
  jobId: string,
  jobTitle: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Job Application',
    actionType: 'job_application',
    description: `User applied for job: ${jobTitle}`,
    severity: 'medium',
    source: 'web',
    metadata: {
      ...metadata,
      targetId: jobId,
      targetType: 'job',
      jobTitle,
    },
  });
};

/**
 * Log an assignment update activity
 */
export const logAssignmentUpdateActivity = async (
  userId: string,
  assignmentId: string,
  action: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Assignment Update',
    actionType: 'assignment_update',
    description: `Assignment ${action}: ${assignmentId}`,
    severity: 'medium',
    source: 'web',
    metadata: {
      ...metadata,
      targetId: assignmentId,
      targetType: 'assignment',
      assignmentAction: action,
    },
  });
};

/**
 * Log a document upload activity
 */
export const logDocumentUploadActivity = async (
  userId: string,
  documentType: string,
  fileName: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Document Upload',
    actionType: 'document_upload',
    description: `User uploaded ${documentType}: ${fileName}`,
    severity: 'medium',
    source: 'web',
    metadata: {
      ...metadata,
      documentType,
      fileName,
      targetType: 'document',
    },
  });
};

/**
 * Log a security change activity
 */
export const logSecurityChangeActivity = async (
  userId: string,
  securityAction: string,
  description: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Security Change',
    actionType: 'security_change',
    description,
    severity: 'high',
    source: 'web',
    metadata: {
      ...metadata,
      securityAction,
      targetType: 'security',
    },
  });
};

/**
 * Log a notification activity
 */
export const logNotificationActivity = async (
  userId: string,
  notificationType: string,
  description: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action: 'Notification',
    actionType: 'notification',
    description,
    severity: 'low',
    source: 'system',
    metadata: {
      ...metadata,
      notificationType,
      targetType: 'notification',
    },
  });
};

/**
 * Log a custom activity
 */
export const logCustomActivity = async (
  userId: string,
  action: string,
  description: string,
  severity: ActivityLogData['severity'] = 'medium',
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId,
    action,
    actionType: 'other',
    description,
    severity,
    source: 'web',
    metadata,
  });
}; 