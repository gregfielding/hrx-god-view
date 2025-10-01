import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  addDoc,
  writeBatch,
  onSnapshot,
  Unsubscribe,
  increment
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  JobOrder, 
  Application, 
  UserGroup, 
  JobBoardPost,
  PHASE1_COLLECTION_PATHS,
  JobOrderStatus,
  ApplicationStatus,
  JobBoardPostStatus
} from '../types/Phase1Types';
import { getNextCounterValue } from './counters';

/**
 * Phase 1 Data Access Layer
 * Implements the simplified structure from phase1-groundwork.md
 */

// ============================================================================
// JOB ORDERS DATA ACCESS
// ============================================================================

export class Phase1JobOrderDataAccess {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Create a new job order
   */
  async create(data: Omit<JobOrder, 'id' | 'jobOrderNumber' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>): Promise<JobOrder> {
    try {
      // Get next job order number
      const counterResult = await getNextCounterValue(
        this.tenantId,
        'jobOrderNumber',
        '',
        '',
        4
      );

      const now = Date.now();
      const newJobOrder: Omit<JobOrder, 'id'> = {
        ...data,
        tenantId: this.tenantId,
        jobOrderNumber: counterResult.value,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system', // TODO: Get from auth context
        updatedBy: 'system'
      };

      const jobOrderRef = doc(collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS));
      await setDoc(jobOrderRef, newJobOrder);

      return {
        id: jobOrderRef.id,
        ...newJobOrder
      };
    } catch (error) {
      console.error('Error creating job order:', error);
      throw error;
    }
  }

  /**
   * Get job order by ID
   */
  async getById(jobOrderId: string): Promise<JobOrder | null> {
    try {
      const jobOrderRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS, jobOrderId);
      const jobOrderDoc = await getDoc(jobOrderRef);
      
      if (jobOrderDoc.exists()) {
        return { id: jobOrderDoc.id, ...jobOrderDoc.data() } as JobOrder;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting job order:', error);
      throw error;
    }
  }

  /**
   * Update job order
   */
  async update(jobOrderId: string, data: Partial<JobOrder>): Promise<void> {
    try {
      const jobOrderRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS, jobOrderId);
      
      await updateDoc(jobOrderRef, {
        ...data,
        updatedAt: Date.now(),
        updatedBy: 'system' // TODO: Get from auth context
      });
    } catch (error) {
      console.error('Error updating job order:', error);
      throw error;
    }
  }

  /**
   * Delete job order
   */
  async delete(jobOrderId: string): Promise<void> {
    try {
      const jobOrderRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS, jobOrderId);
      await deleteDoc(jobOrderRef);
    } catch (error) {
      console.error('Error deleting job order:', error);
      throw error;
    }
  }

  /**
   * Get job orders by status
   */
  async getByStatus(status: JobOrderStatus): Promise<JobOrder[]> {
    try {
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS);
      const q = query(jobOrdersRef, where('status', '==', status), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JobOrder[];
    } catch (error) {
      console.error('Error getting job orders by status:', error);
      throw error;
    }
  }

  /**
   * Get job orders by company
   */
  async getByCompany(companyId: string): Promise<JobOrder[]> {
    try {
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS);
      const q = query(jobOrdersRef, where('companyId', '==', companyId), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JobOrder[];
    } catch (error) {
      console.error('Error getting job orders by company:', error);
      throw error;
    }
  }

  /**
   * Get job orders by recruiter
   */
  async getByRecruiter(recruiterId: string): Promise<JobOrder[]> {
    try {
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS);
      const q = query(jobOrdersRef, where('recruiterId', '==', recruiterId), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JobOrder[];
    } catch (error) {
      console.error('Error getting job orders by recruiter:', error);
      throw error;
    }
  }

  /**
   * Get all job orders
   */
  async getAll(): Promise<JobOrder[]> {
    try {
      const jobOrdersRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS);
      const q = query(jobOrdersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JobOrder[];
    } catch (error) {
      console.error('Error getting all job orders:', error);
      throw error;
    }
  }

  /**
   * Listen to job order changes
   */
  listen(jobOrderId: string, callback: (jobOrder: JobOrder | null) => void): Unsubscribe {
    const jobOrderRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS, jobOrderId);
    
    return onSnapshot(jobOrderRef, (doc) => {
      if (doc.exists()) {
        callback({ id: doc.id, ...doc.data() } as JobOrder);
      } else {
        callback(null);
      }
    });
  }

  /**
   * Listen to all job orders
   */
  listenToAll(callback: (jobOrders: JobOrder[]) => void): Unsubscribe {
    const jobOrdersRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.JOB_ORDERS);
    const q = query(jobOrdersRef, orderBy('createdAt', 'desc'));
    
    return onSnapshot(q, (querySnapshot) => {
      const jobOrders = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JobOrder[];
      callback(jobOrders);
    });
  }
}

// ============================================================================
// APPLICATIONS DATA ACCESS
// ============================================================================

export class Phase1ApplicationDataAccess {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Create a new application
   */
  async create(data: Omit<Application, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>): Promise<Application> {
    try {
      const now = Date.now();
      const newApplication: Omit<Application, 'id'> = {
        ...data,
        tenantId: this.tenantId,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system', // TODO: Get from auth context
        updatedBy: 'system'
      };

      const applicationRef = doc(collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS));
      await setDoc(applicationRef, newApplication);

      return {
        id: applicationRef.id,
        ...newApplication
      };
    } catch (error) {
      console.error('Error creating application:', error);
      throw error;
    }
  }

  /**
   * Get application by ID
   */
  async getById(applicationId: string): Promise<Application | null> {
    try {
      const applicationRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS, applicationId);
      const applicationDoc = await getDoc(applicationRef);
      
      if (applicationDoc.exists()) {
        return { id: applicationDoc.id, ...applicationDoc.data() } as Application;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting application:', error);
      throw error;
    }
  }

  /**
   * Update application
   */
  async update(applicationId: string, data: Partial<Application>): Promise<void> {
    try {
      const applicationRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS, applicationId);
      
      await updateDoc(applicationRef, {
        ...data,
        updatedAt: Date.now(),
        updatedBy: 'system' // TODO: Get from auth context
      });
    } catch (error) {
      console.error('Error updating application:', error);
      throw error;
    }
  }

  /**
   * Get applications by job order
   */
  async getByJobOrder(jobOrderId: string): Promise<Application[]> {
    try {
      const applicationsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS);
      const q = query(applicationsRef, where('jobOrderId', '==', jobOrderId), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Application[];
    } catch (error) {
      console.error('Error getting applications by job order:', error);
      throw error;
    }
  }

  /**
   * Get applications by candidate
   */
  async getByCandidate(candidateId: string): Promise<Application[]> {
    try {
      const applicationsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS);
      const q = query(applicationsRef, where('candidateId', '==', candidateId), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Application[];
    } catch (error) {
      console.error('Error getting applications by candidate:', error);
      throw error;
    }
  }

  /**
   * Get applications by status
   */
  async getByStatus(status: ApplicationStatus): Promise<Application[]> {
    try {
      const applicationsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS);
      const q = query(applicationsRef, where('status', '==', status), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Application[];
    } catch (error) {
      console.error('Error getting applications by status:', error);
      throw error;
    }
  }

  /**
   * Get standalone applications (not linked to job order)
   */
  async getStandalone(): Promise<Application[]> {
    try {
      const applicationsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.APPLICATIONS);
      const q = query(applicationsRef, where('jobOrderId', '==', null), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Application[];
    } catch (error) {
      console.error('Error getting standalone applications:', error);
      throw error;
    }
  }
}

// ============================================================================
// USER GROUPS DATA ACCESS
// ============================================================================

export class Phase1UserGroupDataAccess {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Create a new user group
   */
  async create(data: Omit<UserGroup, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>): Promise<UserGroup> {
    try {
      const now = Date.now();
      const newUserGroup: Omit<UserGroup, 'id'> = {
        ...data,
        tenantId: this.tenantId,
        memberCount: data.members.length,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system', // TODO: Get from auth context
        updatedBy: 'system'
      };

      const userGroupRef = doc(collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS));
      await setDoc(userGroupRef, newUserGroup);

      return {
        id: userGroupRef.id,
        ...newUserGroup
      };
    } catch (error) {
      console.error('Error creating user group:', error);
      throw error;
    }
  }

  /**
   * Get user group by ID
   */
  async getById(userGroupId: string): Promise<UserGroup | null> {
    try {
      const userGroupRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS, userGroupId);
      const userGroupDoc = await getDoc(userGroupRef);
      
      if (userGroupDoc.exists()) {
        return { id: userGroupDoc.id, ...userGroupDoc.data() } as UserGroup;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting user group:', error);
      throw error;
    }
  }

  /**
   * Update user group
   */
  async update(userGroupId: string, data: Partial<UserGroup>): Promise<void> {
    try {
      const userGroupRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS, userGroupId);
      
      // Update member count if members array changed
      const updateData = { ...data };
      if (data.members) {
        updateData.memberCount = data.members.length;
      }
      
      await updateDoc(userGroupRef, {
        ...updateData,
        updatedAt: Date.now(),
        updatedBy: 'system' // TODO: Get from auth context
      });
    } catch (error) {
      console.error('Error updating user group:', error);
      throw error;
    }
  }

  /**
   * Add member to user group
   */
  async addMember(userGroupId: string, memberId: string): Promise<void> {
    try {
      const userGroupRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS, userGroupId);
      
      // Get current user group
      const userGroupDoc = await getDoc(userGroupRef);
      if (!userGroupDoc.exists()) {
        throw new Error('User group not found');
      }
      
      const currentData = userGroupDoc.data() as UserGroup;
      const currentMembers = currentData.members || [];
      
      if (!currentMembers.includes(memberId)) {
        await updateDoc(userGroupRef, {
          members: [...currentMembers, memberId],
          memberCount: currentMembers.length + 1,
          updatedAt: Date.now(),
          updatedBy: 'system' // TODO: Get from auth context
        });
      }
    } catch (error) {
      console.error('Error adding member to user group:', error);
      throw error;
    }
  }

  /**
   * Remove member from user group
   */
  async removeMember(userGroupId: string, memberId: string): Promise<void> {
    try {
      const userGroupRef = doc(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS, userGroupId);
      
      // Get current user group
      const userGroupDoc = await getDoc(userGroupRef);
      if (!userGroupDoc.exists()) {
        throw new Error('User group not found');
      }
      
      const currentData = userGroupDoc.data() as UserGroup;
      const currentMembers = currentData.members || [];
      
      if (currentMembers.includes(memberId)) {
        const updatedMembers = currentMembers.filter(id => id !== memberId);
        await updateDoc(userGroupRef, {
          members: updatedMembers,
          memberCount: updatedMembers.length,
          updatedAt: Date.now(),
          updatedBy: 'system' // TODO: Get from auth context
        });
      }
    } catch (error) {
      console.error('Error removing member from user group:', error);
      throw error;
    }
  }

  /**
   * Get all user groups
   */
  async getAll(): Promise<UserGroup[]> {
    try {
      const userGroupsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS);
      const q = query(userGroupsRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserGroup[];
    } catch (error) {
      console.error('Error getting all user groups:', error);
      throw error;
    }
  }

  /**
   * Get user groups by creator
   */
  async getByCreator(createdBy: string): Promise<UserGroup[]> {
    try {
      const userGroupsRef = collection(db, 'tenants', this.tenantId, PHASE1_COLLECTION_PATHS.USER_GROUPS);
      const q = query(userGroupsRef, where('createdBy', '==', createdBy), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserGroup[];
    } catch (error) {
      console.error('Error getting user groups by creator:', error);
      throw error;
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Get Phase 1 job order data access instance
 */
export const getPhase1JobOrderDataAccess = (tenantId: string): Phase1JobOrderDataAccess => {
  return new Phase1JobOrderDataAccess(tenantId);
};

/**
 * Get Phase 1 application data access instance
 */
export const getPhase1ApplicationDataAccess = (tenantId: string): Phase1ApplicationDataAccess => {
  return new Phase1ApplicationDataAccess(tenantId);
};

/**
 * Get Phase 1 user group data access instance
 */
export const getPhase1UserGroupDataAccess = (tenantId: string): Phase1UserGroupDataAccess => {
  return new Phase1UserGroupDataAccess(tenantId);
};
