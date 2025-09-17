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
  Unsubscribe
} from 'firebase/firestore';
import { db } from '../firebase';
import { useFlag } from '../hooks/useFlag';
import { 
  Account, 
  Contact, 
  Location, 
  JobOrder, 
  Candidate, 
  JobBoardPost, 
  Application, 
  Assignment, 
  UserGroup, 
  Task, 
  Counter,
  COLLECTION_PATHS,
  BaseEntity
} from '../types/NewDataModel';

/**
 * Data Access Layer with Feature Flag Support
 * Automatically routes to new or legacy data model based on NEW_DATA_MODEL flag
 */

// ============================================================================
// BASE DATA ACCESS CLASS
// ============================================================================

export class DataAccess<T extends BaseEntity> {
  protected collectionName: string;
  protected legacyCollectionName?: string;

  constructor(collectionName: string, legacyCollectionName?: string) {
    this.collectionName = collectionName;
    this.legacyCollectionName = legacyCollectionName;
  }

  /**
   * Get the appropriate collection path based on feature flag
   */
  protected getCollectionPath(tenantId: string, useNewModel: boolean = true): string {
    if (useNewModel) {
      return `tenants/${tenantId}/${this.collectionName}`;
    } else if (this.legacyCollectionName) {
      return `tenants/${tenantId}/${this.legacyCollectionName}`;
    }
    throw new Error(`No legacy collection defined for ${this.collectionName}`);
  }

  /**
   * Get document reference
   */
  protected getDocRef(tenantId: string, docId: string, useNewModel: boolean = true) {
    return doc(db, this.getCollectionPath(tenantId, useNewModel), docId);
  }

  /**
   * Get collection reference
   */
  protected getCollectionRef(tenantId: string, useNewModel: boolean = true) {
    return collection(db, this.getCollectionPath(tenantId, useNewModel));
  }

  /**
   * Create a new document
   */
  async create(tenantId: string, data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>, useNewModel: boolean = true): Promise<T> {
    try {
      const collectionRef = this.getCollectionRef(tenantId, useNewModel);
      const now = Date.now();
      
      const newData = {
        ...data,
        tenantId,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system', // TODO: Get from auth context
        updatedBy: 'system'
      } as Omit<T, 'id'>;

      const docRef = await addDoc(collectionRef, newData);
      
      return {
        ...newData,
        id: docRef.id
      } as T;
    } catch (error) {
      console.error(`Error creating ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Get a document by ID
   */
  async getById(tenantId: string, docId: string, useNewModel: boolean = true): Promise<T | null> {
    try {
      const docRef = this.getDocRef(tenantId, docId, useNewModel);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as T;
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting ${this.collectionName} by ID:`, error);
      throw error;
    }
  }

  /**
   * Update a document
   */
  async update(tenantId: string, docId: string, data: Partial<T>, useNewModel: boolean = true): Promise<void> {
    try {
      const docRef = this.getDocRef(tenantId, docId, useNewModel);
      
      await updateDoc(docRef, {
        ...data,
        updatedAt: Date.now(),
        updatedBy: 'system' // TODO: Get from auth context
      });
    } catch (error) {
      console.error(`Error updating ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a document
   */
  async delete(tenantId: string, docId: string, useNewModel: boolean = true): Promise<void> {
    try {
      const docRef = this.getDocRef(tenantId, docId, useNewModel);
      await deleteDoc(docRef);
    } catch (error) {
      console.error(`Error deleting ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Query documents
   */
  async query(tenantId: string, constraints: any[] = [], useNewModel: boolean = true): Promise<T[]> {
    try {
      const collectionRef = this.getCollectionRef(tenantId, useNewModel);
      const q = query(collectionRef, ...constraints);
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
    } catch (error) {
      console.error(`Error querying ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Listen to document changes
   */
  listen(tenantId: string, docId: string, callback: (data: T | null) => void, useNewModel: boolean = true): Unsubscribe {
    const docRef = this.getDocRef(tenantId, docId, useNewModel);
    
    return onSnapshot(docRef, (doc) => {
      if (doc.exists()) {
        callback({ id: doc.id, ...doc.data() } as T);
      } else {
        callback(null);
      }
    });
  }

  /**
   * Listen to collection changes
   */
  listenToCollection(tenantId: string, constraints: any[] = [], callback: (data: T[]) => void, useNewModel: boolean = true): Unsubscribe {
    const collectionRef = this.getCollectionRef(tenantId, useNewModel);
    const q = query(collectionRef, ...constraints);
    
    return onSnapshot(q, (querySnapshot) => {
      const data = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
      callback(data);
    });
  }
}

// ============================================================================
// SPECIFIC DATA ACCESS CLASSES
// ============================================================================

export class AccountDataAccess extends DataAccess<Account> {
  constructor() {
    super(COLLECTION_PATHS.ACCOUNTS, 'crm_companies');
  }

  /**
   * Get accounts by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Account[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }

  /**
   * Get accounts by industry
   */
  async getByIndustry(tenantId: string, industry: string, useNewModel: boolean = true): Promise<Account[]> {
    return this.query(tenantId, [where('industry', '==', industry)], useNewModel);
  }

  /**
   * Search accounts by name
   */
  async searchByName(tenantId: string, searchTerm: string, useNewModel: boolean = true): Promise<Account[]> {
    // Note: This is a simple implementation. For production, consider using Algolia or similar
    const allAccounts = await this.query(tenantId, [], useNewModel);
    return allAccounts.filter(account => 
      account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.companyName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
}

export class ContactDataAccess extends DataAccess<Contact> {
  constructor() {
    super(COLLECTION_PATHS.CONTACTS, 'crm_contacts');
  }

  /**
   * Get contacts by account
   */
  async getByAccount(tenantId: string, accountId: string, useNewModel: boolean = true): Promise<Contact[]> {
    return this.query(tenantId, [where('accountId', '==', accountId)], useNewModel);
  }

  /**
   * Get contacts by role
   */
  async getByRole(tenantId: string, role: string, useNewModel: boolean = true): Promise<Contact[]> {
    return this.query(tenantId, [where('role', '==', role)], useNewModel);
  }

  /**
   * Get contacts by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Contact[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }
}

export class LocationDataAccess extends DataAccess<Location> {
  constructor() {
    super(COLLECTION_PATHS.LOCATIONS, 'crm_locations');
  }

  /**
   * Get locations by account
   */
  async getByAccount(tenantId: string, accountId: string, useNewModel: boolean = true): Promise<Location[]> {
    return this.query(tenantId, [where('accountId', '==', accountId)], useNewModel);
  }

  /**
   * Get locations by type
   */
  async getByType(tenantId: string, locationType: string, useNewModel: boolean = true): Promise<Location[]> {
    return this.query(tenantId, [where('locationType', '==', locationType)], useNewModel);
  }
}

export class JobOrderDataAccess extends DataAccess<JobOrder> {
  constructor() {
    super(COLLECTION_PATHS.JOB_ORDERS, 'recruiter_jobOrders');
  }

  /**
   * Get job orders by account
   */
  async getByAccount(tenantId: string, accountId: string, useNewModel: boolean = true): Promise<JobOrder[]> {
    return this.query(tenantId, [where('accountId', '==', accountId)], useNewModel);
  }

  /**
   * Get job orders by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<JobOrder[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }

  /**
   * Get job orders by recruiter
   */
  async getByRecruiter(tenantId: string, recruiterId: string, useNewModel: boolean = true): Promise<JobOrder[]> {
    return this.query(tenantId, [where('recruiterOwnerId', '==', recruiterId)], useNewModel);
  }

  /**
   * Get active job orders
   */
  async getActive(tenantId: string, useNewModel: boolean = true): Promise<JobOrder[]> {
    return this.query(tenantId, [
      where('status', 'in', ['open', 'interviewing', 'offer', 'partially_filled'])
    ], useNewModel);
  }
}

export class CandidateDataAccess extends DataAccess<Candidate> {
  constructor() {
    super(COLLECTION_PATHS.CANDIDATES, 'recruiter_candidates');
  }

  /**
   * Get candidates by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Candidate[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }

  /**
   * Get candidates by skills
   */
  async getBySkills(tenantId: string, skills: string[], useNewModel: boolean = true): Promise<Candidate[]> {
    return this.query(tenantId, [where('skills', 'array-contains-any', skills)], useNewModel);
  }

  /**
   * Get active candidates
   */
  async getActive(tenantId: string, useNewModel: boolean = true): Promise<Candidate[]> {
    return this.query(tenantId, [where('status', '==', 'active')], useNewModel);
  }
}

export class ApplicationDataAccess extends DataAccess<Application> {
  constructor() {
    super(COLLECTION_PATHS.APPLICATIONS, 'recruiter_applications');
  }

  /**
   * Get applications by job order
   */
  async getByJobOrder(tenantId: string, jobOrderId: string, useNewModel: boolean = true): Promise<Application[]> {
    return this.query(tenantId, [where('jobOrderId', '==', jobOrderId)], useNewModel);
  }

  /**
   * Get applications by candidate
   */
  async getByCandidate(tenantId: string, candidateId: string, useNewModel: boolean = true): Promise<Application[]> {
    return this.query(tenantId, [where('candidateId', '==', candidateId)], useNewModel);
  }

  /**
   * Get applications by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Application[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }
}

export class AssignmentDataAccess extends DataAccess<Assignment> {
  constructor() {
    super(COLLECTION_PATHS.ASSIGNMENTS, 'recruiter_assignments');
  }

  /**
   * Get assignments by job order
   */
  async getByJobOrder(tenantId: string, jobOrderId: string, useNewModel: boolean = true): Promise<Assignment[]> {
    return this.query(tenantId, [where('jobOrderId', '==', jobOrderId)], useNewModel);
  }

  /**
   * Get assignments by candidate
   */
  async getByCandidate(tenantId: string, candidateId: string, useNewModel: boolean = true): Promise<Assignment[]> {
    return this.query(tenantId, [where('candidateId', '==', candidateId)], useNewModel);
  }

  /**
   * Get assignments by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Assignment[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }

  /**
   * Get active assignments
   */
  async getActive(tenantId: string, useNewModel: boolean = true): Promise<Assignment[]> {
    return this.query(tenantId, [where('status', '==', 'active')], useNewModel);
  }
}

export class TaskDataAccess extends DataAccess<Task> {
  constructor() {
    super(COLLECTION_PATHS.TASKS, 'tasks');
  }

  /**
   * Get tasks by assignee
   */
  async getByAssignee(tenantId: string, assigneeId: string, useNewModel: boolean = true): Promise<Task[]> {
    return this.query(tenantId, [where('assignedTo', '==', assigneeId)], useNewModel);
  }

  /**
   * Get tasks by status
   */
  async getByStatus(tenantId: string, status: string, useNewModel: boolean = true): Promise<Task[]> {
    return this.query(tenantId, [where('status', '==', status)], useNewModel);
  }

  /**
   * Get tasks by type
   */
  async getByType(tenantId: string, type: string, useNewModel: boolean = true): Promise<Task[]> {
    return this.query(tenantId, [where('type', '==', type)], useNewModel);
  }

  /**
   * Get tasks by due date
   */
  async getByDueDate(tenantId: string, dueDate: string, useNewModel: boolean = true): Promise<Task[]> {
    return this.query(tenantId, [where('dueDate', '==', dueDate)], useNewModel);
  }
}

// ============================================================================
// DATA ACCESS FACTORY
// ============================================================================

export class DataAccessFactory {
  private static instances: Map<string, any> = new Map();

  /**
   * Get data access instance for a specific entity type
   */
  static getInstance(entityType: string): any {
    if (!this.instances.has(entityType)) {
      let instance: any;
      
      switch (entityType) {
        case 'Account':
          instance = new AccountDataAccess();
          break;
        case 'Contact':
          instance = new ContactDataAccess();
          break;
        case 'Location':
          instance = new LocationDataAccess();
          break;
        case 'JobOrder':
          instance = new JobOrderDataAccess();
          break;
        case 'Candidate':
          instance = new CandidateDataAccess();
          break;
        case 'Application':
          instance = new ApplicationDataAccess();
          break;
        case 'Assignment':
          instance = new AssignmentDataAccess();
          break;
        case 'Task':
          instance = new TaskDataAccess();
          break;
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
      
      this.instances.set(entityType, instance);
    }
    
    return this.instances.get(entityType);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get data access instance for accounts
 */
export const getAccountDataAccess = (): AccountDataAccess => {
  return DataAccessFactory.getInstance('Account') as AccountDataAccess;
};

/**
 * Get data access instance for contacts
 */
export const getContactDataAccess = (): ContactDataAccess => {
  return DataAccessFactory.getInstance('Contact') as ContactDataAccess;
};

/**
 * Get data access instance for locations
 */
export const getLocationDataAccess = (): LocationDataAccess => {
  return DataAccessFactory.getInstance('Location') as LocationDataAccess;
};

/**
 * Get data access instance for job orders
 */
export const getJobOrderDataAccess = (): JobOrderDataAccess => {
  return DataAccessFactory.getInstance('JobOrder') as JobOrderDataAccess;
};

/**
 * Get data access instance for candidates
 */
export const getCandidateDataAccess = (): CandidateDataAccess => {
  return DataAccessFactory.getInstance('Candidate') as CandidateDataAccess;
};

/**
 * Get data access instance for applications
 */
export const getApplicationDataAccess = (): ApplicationDataAccess => {
  return DataAccessFactory.getInstance('Application') as ApplicationDataAccess;
};

/**
 * Get data access instance for assignments
 */
export const getAssignmentDataAccess = (): AssignmentDataAccess => {
  return DataAccessFactory.getInstance('Assignment') as AssignmentDataAccess;
};

/**
 * Get data access instance for tasks
 */
export const getTaskDataAccess = (): TaskDataAccess => {
  return DataAccessFactory.getInstance('Task') as TaskDataAccess;
};
