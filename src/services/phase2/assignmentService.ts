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
import { 
  Assignment, 
  AssignmentFormData, 
  AssignmentFilters, 
  AssignmentSortOptions,
  ShiftTemplate,
  ShiftTemplateFormData,
  Timesheet,
  AssignmentStatus
} from '../../types/phase2';
import { safeToDate } from '../../utils/dateUtils';

export class AssignmentService {
  private static instance: AssignmentService;

  public static getInstance(): AssignmentService {
    if (!AssignmentService.instance) {
      AssignmentService.instance = new AssignmentService();
    }
    return AssignmentService.instance;
  }

  /**
   * Create a new assignment
   * 
   * @param tenantId - Tenant ID
   * @param jobOrderId - Job Order ID
   * @param formData - Assignment form data (must include all required denormalized fields)
   * @param createdBy - User ID of creator
   * @returns Assignment ID
   * 
   * Required denormalized fields in formData:
   * - firstName, lastName (worker)
   * - companyId, companyName (company)
   * - locationId, locationNickname or worksiteName (location)
   * - latitude, longitude (location coords)
   * - jobOrderType ('career' | 'gig')
   */
  async createAssignment(
    tenantId: string,
    jobOrderId: string,
    formData: AssignmentFormData,
    createdBy: string
  ): Promise<string> {
    try {
      // Validate required denormalized fields
      const requiredFields = [
        'candidateId', 'userId', 'firstName', 'lastName',
        'companyId', 'companyName', 
        'locationId', 'latitude', 'longitude',
        'jobOrderType', 'status', 'startDate', 'payRate', 'timesheetMode'
      ];
      
      const missingFields = requiredFields.filter(field => !(field in formData) || (formData as any)[field] === undefined);
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }
      
      // Ensure locationNickname or worksiteName is present
      if (!(formData as any).locationNickname && !(formData as any).worksiteName) {
        throw new Error('Either locationNickname or worksiteName is required');
      }

      const assignmentData: any = {
        ...formData,
        tenantId,
        jobOrderId,
        createdAt: serverTimestamp(),
        createdBy,
        updatedAt: serverTimestamp(),
        updatedBy: createdBy,
        assignedAt: serverTimestamp(), // Track when assignment was made
      };

      // Use tenant-level assignments collection (not nested under job_orders)
      const docRef = await addDoc(
        collection(db, 'tenants', tenantId, 'assignments'),
        assignmentData
      );

      console.log(`✅ Assignment created: ${docRef.id} for worker ${assignmentData.userId} on job order ${jobOrderId}`);
      return docRef.id;
    } catch (error) {
      console.error('Error creating assignment:', error);
      throw error;
    }
  }

  /**
   * Update an existing assignment
   */
  async updateAssignment(
    tenantId: string,
    assignmentId: string,
    updates: Partial<AssignmentFormData>,
    updatedBy: string
  ): Promise<void> {
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', assignmentId);
      
      await updateDoc(assignmentRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy
      });
    } catch (error) {
      console.error('Error updating assignment:', error);
      throw error;
    }
  }

  /**
   * Update assignment status
   */
  async updateAssignmentStatus(
    tenantId: string,
    assignmentId: string,
    newStatus: AssignmentStatus,
    updatedBy: string
  ): Promise<void> {
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', assignmentId);
      
      await updateDoc(assignmentRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy
      });
    } catch (error) {
      console.error('Error updating assignment status:', error);
      throw error;
    }
  }

  /**
   * Get assignment by ID
   */
  async getAssignment(
    tenantId: string,
    assignmentId: string
  ): Promise<Assignment | null> {
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', assignmentId);
      const assignmentDoc = await getDoc(assignmentRef);
      
      if (assignmentDoc.exists()) {
        const data = assignmentDoc.data() as Omit<Assignment, 'id'>;
        return { id: assignmentDoc.id, ...data };
      }
      return null;
    } catch (error) {
      console.error('Error getting assignment:', error);
      throw error;
    }
  }

  /**
   * Get assignments for a specific job order
   */
  async getAssignmentsByJobOrder(
    tenantId: string,
    jobOrderId: string,
    filters: AssignmentFilters = {},
    sortOptions: AssignmentSortOptions = { field: 'startDate', direction: 'desc' }
  ): Promise<Assignment[]> {
    try {
      // Use tenant-level assignments collection and filter by jobOrderId
      let q = query(
        collection(db, 'tenants', tenantId, 'assignments'),
        where('jobOrderId', '==', jobOrderId)
      );

      // Apply filters
      if (filters.status) {
        q = query(q, where('status', '==', filters.status));
      }
      if (filters.candidateId) {
        q = query(q, where('candidateId', '==', filters.candidateId));
      }
      if (filters.worksite) {
        q = query(q, where('worksite', '==', filters.worksite));
      }
      if (filters.shiftTemplateId) {
        q = query(q, where('shiftTemplateId', '==', filters.shiftTemplateId));
      }

      // Apply sorting
      q = query(q, orderBy(sortOptions.field, sortOptions.direction));

      const querySnapshot = await getDocs(q);
      let assignments = querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Assignment, 'id'>;
        return { id: doc.id, ...data };
      });

      // Apply client-side filters that can't be done in Firestore
      if (filters.dateRange) {
        assignments = assignments.filter(assignment => {
          const startDate = new Date(assignment.startDate);
          const endDate = assignment.endDate ? new Date(assignment.endDate) : new Date('2099-12-31');
          const filterStart = new Date(filters.dateRange!.start);
          const filterEnd = new Date(filters.dateRange!.end);
          
          return (startDate <= filterEnd && endDate >= filterStart);
        });
      }

      return assignments;
    } catch (error) {
      console.error('Error getting assignments by job order:', error);
      throw error;
    }
  }

  /**
   * Get assignments for a specific candidate/user
   */
  async getAssignmentsByCandidate(
    tenantId: string,
    candidateId: string,
    status?: AssignmentStatus
  ): Promise<Assignment[]> {
    try {
      // Use tenant-level assignments collection and filter by userId
      let q = query(
        collection(db, 'tenants', tenantId, 'assignments'),
        where('userId', '==', candidateId),
        orderBy('startDate', 'desc')
      );

      if (status) {
        q = query(q, where('status', '==', status));
      }

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Assignment, 'id'>;
        return { id: doc.id, ...data };
      });
    } catch (error) {
      console.error('Error getting assignments by candidate:', error);
      throw error;
    }
  }

  /**
   * Get all assignments for a tenant (with optional filters)
   */
  async getAllAssignments(
    tenantId: string,
    filters: AssignmentFilters = {},
    sortOptions: AssignmentSortOptions = { field: 'startDate', direction: 'desc' },
    limitCount?: number
  ): Promise<Assignment[]> {
    try {
      // Use tenant-level assignments collection
      let q = query(
        collection(db, 'tenants', tenantId, 'assignments')
      );

      // Apply filters
      if (filters.status) {
        q = query(q, where('status', '==', filters.status));
      }
      if (filters.candidateId) {
        q = query(q, where('userId', '==', filters.candidateId));
      }
      if (filters.jobOrderId) {
        q = query(q, where('jobOrderId', '==', filters.jobOrderId));
      }
      if (filters.worksite) {
        q = query(q, where('worksite', '==', filters.worksite));
      }
      if (filters.shiftTemplateId) {
        q = query(q, where('shiftTemplateId', '==', filters.shiftTemplateId));
      }

      // Apply sorting
      q = query(q, orderBy(sortOptions.field, sortOptions.direction));

      // Apply limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const querySnapshot = await getDocs(q);
      let assignments = querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Assignment, 'id'>;
        return { id: doc.id, ...data };
      });

      // Apply client-side filters
      if (filters.dateRange) {
        assignments = assignments.filter(assignment => {
          const startDate = new Date(assignment.startDate);
          const endDate = assignment.endDate ? new Date(assignment.endDate) : new Date('2099-12-31');
          const filterStart = new Date(filters.dateRange!.start);
          const filterEnd = new Date(filters.dateRange!.end);
          
          return (startDate <= filterEnd && endDate >= filterStart);
        });
      }

      return assignments;
    } catch (error) {
      console.error('Error getting all assignments:', error);
      throw error;
    }
  }

  /**
   * Delete an assignment
   */
  async deleteAssignment(
    tenantId: string,
    assignmentId: string
  ): Promise<void> {
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', assignmentId);
      await deleteDoc(assignmentRef);
    } catch (error) {
      console.error('Error deleting assignment:', error);
      throw error;
    }
  }

  /**
   * Get assignment statistics for a job order
   */
  async getAssignmentStats(tenantId: string, jobOrderId: string): Promise<{
    total: number;
    byStatus: Record<AssignmentStatus, number>;
    activeCount: number;
    completedCount: number;
  }> {
    try {
      const assignments = await this.getAssignmentsByJobOrder(tenantId, jobOrderId);
      
      const stats = {
        total: assignments.length,
        byStatus: {
          proposed: 0,
          confirmed: 0,
          declined: 0,
          active: 0,
          completed: 0,
          ended: 0,
          canceled: 0
        } as Record<AssignmentStatus, number>,
        activeCount: 0,
        completedCount: 0
      };

      assignments.forEach(assignment => {
        stats.byStatus[assignment.status]++;
        if (assignment.status === 'active') {
          stats.activeCount++;
        }
        if (assignment.status === 'completed') {
          stats.completedCount++;
        }
      });

      return stats;
    } catch (error) {
      console.error('Error getting assignment stats:', error);
      throw error;
    }
  }

  // ============================================================================
  // SHIFT TEMPLATE METHODS
  // ============================================================================

  /**
   * Create a new shift template
   */
  async createShiftTemplate(
    tenantId: string,
    formData: ShiftTemplateFormData,
    createdBy: string
  ): Promise<string> {
    try {
      const templateData: Omit<ShiftTemplate, 'id'> = {
        ...formData,
        tenantId,
        createdAt: serverTimestamp(),
        createdBy,
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(
        collection(db, 'tenants', tenantId, 'shift_templates'),
        templateData
      );

      return docRef.id;
    } catch (error) {
      console.error('Error creating shift template:', error);
      throw error;
    }
  }

  /**
   * Get shift templates for a tenant
   */
  async getShiftTemplates(
    tenantId: string,
    jobOrderId?: string
  ): Promise<ShiftTemplate[]> {
    try {
      let q = query(
        collection(db, 'tenants', tenantId, 'shift_templates'),
        orderBy('createdAt', 'desc')
      );

      if (jobOrderId) {
        q = query(q, where('jobOrderId', '==', jobOrderId));
      }

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<ShiftTemplate, 'id'>;
        return { id: doc.id, ...data };
      });
    } catch (error) {
      console.error('Error getting shift templates:', error);
      throw error;
    }
  }

  // ============================================================================
  // TIMESHEET METHODS (STUB)
  // ============================================================================

  /**
   * Get timesheets for an assignment (stub implementation)
   */
  async getTimesheetsForAssignment(
    tenantId: string,
    assignmentId: string
  ): Promise<Timesheet[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'timesheets'),
        where('assignmentId', '==', assignmentId),
        orderBy('periodStart', 'desc')
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data() as Omit<Timesheet, 'id'>;
        return { id: doc.id, ...data };
      });
    } catch (error) {
      console.error('Error getting timesheets for assignment:', error);
      throw error;
    }
  }
}

// Convenience function to get service instance
export const getAssignmentService = (): AssignmentService => {
  return AssignmentService.getInstance();
};
