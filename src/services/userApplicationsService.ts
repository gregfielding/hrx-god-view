import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * UserApplicationsService
 * 
 * Simple utility to pull all jobs/shifts that a user has applied to work.
 * 
 * Usage example:
 * ```typescript
 * const service = UserApplicationsService.getInstance();
 * 
 * // Get all applications for a user
 * const applications = await service.getUserApplications(userId);
 * 
 * // Get applications for a specific tenant
 * const tenantApps = await service.getUserApplications(userId, tenantId);
 * 
 * // Get application for a specific shift
 * const shiftApp = await service.getApplicationForShift(userId, shiftId, tenantId, jobOrderId);
 * 
 * // Get all applications for a specific job
 * const jobApps = await service.getApplicationsForJob(userId, jobId, tenantId);
 * ```
 */

export interface UserApplication {
  applicationId: string;
  tenantId: string;
  jobId: string;
  jobOrderId?: string;
  shiftId?: string;
  shiftIds?: string[];
  status: string;
  appliedAt: Date;
  updatedAt: Date;
  
  // Job details (from applicationData or job posting)
  jobTitle: string;
  postTitle: string;
  companyName?: string;
  location?: string;
  payRate?: number;
  startDate?: Date;
  jobType?: 'gig' | 'career';
  
  // Shift details (for gig jobs)
  shiftDate?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  shiftTitle?: string;
}

export class UserApplicationsService {
  private static instance: UserApplicationsService;

  public static getInstance(): UserApplicationsService {
    if (!UserApplicationsService.instance) {
      UserApplicationsService.instance = new UserApplicationsService();
    }
    return UserApplicationsService.instance;
  }

  /**
   * Get all jobs/shifts that a user has applied to
   * @param userId - The user's UID
   * @param tenantId - Optional tenant ID filter (if not provided, returns all applications)
   * @returns Array of user applications with job and shift details
   */
  async getUserApplications(
    userId: string,
    tenantId?: string
  ): Promise<UserApplication[]> {
    try {
      // Get user document to access applicationIds and applicationData
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        return [];
      }

      const userData = userSnap.data();
      const applicationIds: string[] = Array.isArray(userData?.applicationIds)
        ? userData.applicationIds
        : [];
      const applicationDataMap = userData?.applicationData || {};

      if (applicationIds.length === 0) {
        return [];
      }

      const applications: UserApplication[] = [];

      // Process each application
      for (const appId of applicationIds) {
        try {
          // Parse applicationId format: {tenantId}_{jobId}
          const firstUnderscoreIndex = appId.indexOf('_');
          if (firstUnderscoreIndex === -1) continue;

          const appTenantId = appId.substring(0, firstUnderscoreIndex);
          const jobId = appId.substring(firstUnderscoreIndex + 1);

          // Skip if tenant filter is specified and doesn't match
          if (tenantId && appTenantId !== tenantId) {
            continue;
          }

          // Get cached application data from user document
          const cachedData = applicationDataMap[appId] as any;

          // Load full application document
          const appRef = doc(
            db,
            'tenants',
            appTenantId,
            'applications',
            `${userId}_${jobId}`
          );
          const appSnap = await getDoc(appRef);

          if (!appSnap.exists()) {
            // If document doesn't exist, use cached data if available
            if (cachedData) {
              applications.push({
                applicationId: appId,
                tenantId: appTenantId,
                jobId: jobId,
                jobOrderId: cachedData.jobOrderId,
                shiftId: cachedData.shiftId,
                shiftIds: Array.isArray(cachedData.shiftIds)
                  ? cachedData.shiftIds
                  : undefined,
                status: cachedData.status || 'submitted',
                appliedAt: cachedData.appliedAt?.toDate
                  ? cachedData.appliedAt.toDate()
                  : new Date(cachedData.appliedAt || cachedData.updatedAt),
                updatedAt: cachedData.updatedAt?.toDate
                  ? cachedData.updatedAt.toDate()
                  : new Date(cachedData.updatedAt || cachedData.appliedAt),
                jobTitle: cachedData.jobTitle || '',
                postTitle: cachedData.postTitle || cachedData.jobOrderName || '',
                companyName: cachedData.companyName,
                location: cachedData.location,
                payRate: cachedData.payRate,
                startDate: cachedData.startDate?.toDate
                  ? cachedData.startDate.toDate()
                  : cachedData.startDate
                    ? new Date(cachedData.startDate)
                    : undefined,
              });
            }
            continue;
          }

          const appData = appSnap.data();

          // Extract shift information
          const shiftId = appData.shiftId || cachedData?.shiftId;
          const shiftIds = Array.isArray(appData.shiftIds)
            ? appData.shiftIds
            : Array.isArray(cachedData?.shiftIds)
              ? cachedData.shiftIds
              : undefined;

          // Build application object with cached data as fallback
          const application: UserApplication = {
            applicationId: appId,
            tenantId: appTenantId,
            jobId: jobId,
            jobOrderId: appData.jobOrderId || cachedData?.jobOrderId,
            shiftId: shiftId,
            shiftIds: shiftIds,
            status: appData.status || cachedData?.status || 'submitted',
            appliedAt: appData.appliedAt?.toDate
              ? appData.appliedAt.toDate()
              : cachedData?.appliedAt?.toDate
                ? cachedData.appliedAt.toDate()
                : new Date(
                    appData.appliedAt ||
                      cachedData?.appliedAt ||
                      cachedData?.updatedAt ||
                      Date.now()
                  ),
            updatedAt: appData.updatedAt?.toDate
              ? appData.updatedAt.toDate()
              : cachedData?.updatedAt?.toDate
                ? cachedData.updatedAt.toDate()
                : new Date(
                    appData.updatedAt ||
                      cachedData?.updatedAt ||
                      cachedData?.appliedAt ||
                      Date.now()
                  ),
            jobTitle:
              appData.jobTitle ||
              cachedData?.jobTitle ||
              cachedData?.jobOrderName ||
              '',
            postTitle:
              appData.postTitle ||
              cachedData?.postTitle ||
              cachedData?.jobOrderName ||
              '',
            companyName: appData.companyName || cachedData?.companyName,
            location: appData.location || cachedData?.location,
            payRate: appData.payRate || cachedData?.payRate,
            startDate: appData.startDate?.toDate
              ? appData.startDate.toDate()
              : cachedData?.startDate?.toDate
                ? cachedData.startDate.toDate()
                : cachedData?.startDate
                  ? new Date(cachedData.startDate)
                  : undefined,
            jobType: appData.jobType || cachedData?.jobType,
          };

          // For gig jobs with shifts, fetch shift details if shiftId is available
          if (
            (application.jobType === 'gig' || application.jobOrderId) &&
            shiftId &&
            appTenantId &&
            application.jobOrderId
          ) {
            try {
              // Try direct document access to shift
              const shiftDocRef = doc(
                db,
                'tenants',
                appTenantId,
                'job_orders',
                application.jobOrderId,
                'shifts',
                shiftId
              );
              const shiftDoc = await getDoc(shiftDocRef);
              if (shiftDoc.exists()) {
                const shiftData = shiftDoc.data();
                application.shiftDate = shiftData.shiftDate;
                application.shiftStartTime = shiftData.startTime;
                application.shiftEndTime = shiftData.endTime;
                application.shiftTitle = shiftData.shiftTitle || shiftData.title;
              }
            } catch (shiftErr) {
              console.warn(
                `Could not load shift details for ${shiftId}:`,
                shiftErr
              );
            }
          }

          applications.push(application);
        } catch (err) {
          console.error(`Error loading application ${appId}:`, err);
        }
      }

      // Sort by appliedAt date (most recent first)
      applications.sort(
        (a, b) => b.appliedAt.getTime() - a.appliedAt.getTime()
      );

      return applications;
    } catch (error) {
      console.error('Error getting user applications:', error);
      throw error;
    }
  }

  /**
   * Get applications for a specific shift (for gig jobs)
   * @param userId - The user's UID
   * @param shiftId - The shift ID
   * @param tenantId - The tenant ID
   * @param jobOrderId - The job order ID
   * @returns Application if found, null otherwise
   */
  async getApplicationForShift(
    userId: string,
    shiftId: string,
    tenantId: string,
    jobOrderId: string
  ): Promise<UserApplication | null> {
    try {
      const applications = await this.getUserApplications(userId, tenantId);
      return (
        applications.find(
          (app) =>
            app.shiftId === shiftId &&
            app.jobOrderId === jobOrderId &&
            app.tenantId === tenantId
        ) || null
      );
    } catch (error) {
      console.error('Error getting application for shift:', error);
      return null;
    }
  }

  /**
   * Get all applications for a specific job
   * @param userId - The user's UID
   * @param jobId - The job ID (posting ID or job-order-{id})
   * @param tenantId - The tenant ID
   * @returns Array of applications for that job
   */
  async getApplicationsForJob(
    userId: string,
    jobId: string,
    tenantId: string
  ): Promise<UserApplication[]> {
    try {
      const applications = await this.getUserApplications(userId, tenantId);
      return applications.filter(
        (app) => app.jobId === jobId && app.tenantId === tenantId
      );
    } catch (error) {
      console.error('Error getting applications for job:', error);
      return [];
    }
  }
}

