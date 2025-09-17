import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  collectionGroup
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Application, ApplicationFormData, ApplicationFilters, ApplicationSortOptions } from '../../types/phase2';
import { safeToDate } from '../../utils/dateUtils';

export class ApplicationService {
  private static instance: ApplicationService;

  public static getInstance(): ApplicationService {
    if (!ApplicationService.instance) {
      ApplicationService.instance = new ApplicationService();
    }
    return ApplicationService.instance;
  }

  /**
   * Create a new application (standalone or job-linked)
   */
  async createApplication(
    tenantId: string,
    formData: ApplicationFormData,
    createdBy: string
  ): Promise<string> {
    try {
      const applicationData: Omit<Application, 'id'> = {
        ...formData,
        tenantId,
        stageChangedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdBy,
        updatedAt: serverTimestamp(),
        updatedBy: createdBy
      };

      let docRef;
      if (formData.jobOrderId) {
        // Job-linked application
        docRef = await addDoc(
          collection(db, 'tenants', tenantId, 'job_orders', formData.jobOrderId, 'applications'),
          applicationData
        );
      } else {
        // Standalone application (talent pool)
        docRef = await addDoc(
          collection(db, 'tenants', tenantId, 'applications'),
          applicationData
        );
      }

      return docRef.id;
    } catch (error) {
      console.error('Error creating application:', error);
      throw error;
    }
  }

  /**
   * Update an existing application
   */
  async updateApplication(
    tenantId: string,
    applicationId: string,
    updates: Partial<ApplicationFormData>,
    updatedBy: string,
    jobOrderId?: string
  ): Promise<void> {
    try {
      let applicationRef;
      if (jobOrderId) {
        // Job-linked application
        applicationRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications', applicationId);
      } else {
        // Standalone application
        applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      }

      await updateDoc(applicationRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy
      });
    } catch (error) {
      console.error('Error updating application:', error);
      throw error;
    }
  }

  /**
   * Update application stage
   */
  async updateApplicationStage(
    tenantId: string,
    applicationId: string,
    newStage: Application['status'],
    updatedBy: string,
    jobOrderId?: string
  ): Promise<void> {
    try {
      let applicationRef;
      if (jobOrderId) {
        applicationRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications', applicationId);
      } else {
        applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      }

      await updateDoc(applicationRef, {
        status: newStage,
        stageChangedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy
      });
    } catch (error) {
      console.error('Error updating application stage:', error);
      throw error;
    }
  }

  /**
   * Get application by ID
   */
  async getApplication(
    tenantId: string,
    applicationId: string,
    jobOrderId?: string
  ): Promise<Application | null> {
    try {
      let applicationRef;
      if (jobOrderId) {
        applicationRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications', applicationId);
      } else {
        applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      }

      const applicationDoc = await getDoc(applicationRef);
      
      if (applicationDoc.exists()) {
        const data = applicationDoc.data() as Omit<Application, 'id'>;
        return { id: applicationDoc.id, ...data };
      }
      return null;
    } catch (error) {
      console.error('Error getting application:', error);
      throw error;
    }
  }

  /**
   * Get applications with filtering and sorting
   */
  async getApplications(
    tenantId: string,
    filters: ApplicationFilters = {},
    sortOptions: ApplicationSortOptions = { field: 'createdAt', direction: 'desc' },
    limitCount?: number
  ): Promise<Application[]> {
    try {
      // Build base query for collection group (searches both standalone and job-linked)
      let q = query(
        collectionGroup(db, 'applications'),
        where('tenantId', '==', tenantId)
      );

      // Apply filters
      if (filters.status) {
        q = query(q, where('status', '==', filters.status));
      }
      if (filters.jobOrderId) {
        q = query(q, where('jobOrderId', '==', filters.jobOrderId));
      }
      if (filters.source) {
        q = query(q, where('source', '==', filters.source));
      }
      if (filters.rating) {
        q = query(q, where('rating', '==', filters.rating));
      }

      // Apply sorting
      const sortField = sortOptions.field === 'candidate.lastName' ? 'candidate.lastName' : sortOptions.field;
      q = query(q, orderBy(sortField, sortOptions.direction));

      // Apply limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const querySnapshot = await getDocs(q);
      let applications = querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Application, 'id'>;
        return { id: doc.id, ...data };
      });

      // Apply client-side filters that can't be done in Firestore
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        applications = applications.filter(app => 
          app.candidate.firstName.toLowerCase().includes(searchTerm) ||
          app.candidate.lastName.toLowerCase().includes(searchTerm) ||
          app.candidate.email?.toLowerCase().includes(searchTerm) ||
          app.notes?.toLowerCase().includes(searchTerm)
        );
      }

      if (filters.tags && filters.tags.length > 0) {
        applications = applications.filter(app => 
          app.tags && filters.tags!.some(tag => app.tags!.includes(tag))
        );
      }

      return applications;
    } catch (error) {
      console.error('Error getting applications:', error);
      throw error;
    }
  }

  /**
   * Get applications for a specific job order
   */
  async getApplicationsByJobOrder(
    tenantId: string,
    jobOrderId: string,
    status?: Application['status']
  ): Promise<Application[]> {
    try {
      let q = query(
        collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications'),
        orderBy('createdAt', 'desc')
      );

      if (status) {
        q = query(q, where('status', '==', status));
      }

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Application, 'id'>;
        return { id: doc.id, ...data };
      });
    } catch (error) {
      console.error('Error getting applications by job order:', error);
      throw error;
    }
  }

  /**
   * Delete an application
   */
  async deleteApplication(
    tenantId: string,
    applicationId: string,
    jobOrderId?: string
  ): Promise<void> {
    try {
      let applicationRef;
      if (jobOrderId) {
        applicationRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications', applicationId);
      } else {
        applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      }

      await deleteDoc(applicationRef);
    } catch (error) {
      console.error('Error deleting application:', error);
      throw error;
    }
  }

  /**
   * Get application statistics for a tenant
   */
  async getApplicationStats(tenantId: string): Promise<{
    total: number;
    byStatus: Record<Application['status'], number>;
    bySource: Record<string, number>;
  }> {
    try {
      const applications = await this.getApplications(tenantId);
      
      const stats = {
        total: applications.length,
        byStatus: {
          applied: 0,
          screening: 0,
          interview: 0,
          offer: 0,
          hired: 0,
          rejected: 0,
          withdrawn: 0
        } as Record<Application['status'], number>,
        bySource: {} as Record<string, number>
      };

      applications.forEach(app => {
        stats.byStatus[app.status]++;
        if (app.source) {
          stats.bySource[app.source] = (stats.bySource[app.source] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error('Error getting application stats:', error);
      throw error;
    }
  }
}

// Convenience function to get service instance
export const getApplicationService = (): ApplicationService => {
  return ApplicationService.getInstance();
};
