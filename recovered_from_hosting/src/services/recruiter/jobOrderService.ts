import { 
  collection, 
  doc, 
  addDoc, 
  setDoc,
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit,
  increment,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { JobOrder, JobOrderFormData, JobApplication, Candidate, Employee } from '../../types/recruiter/jobOrder';

export class JobOrderService {
  private static instance: JobOrderService;

  public static getInstance(): JobOrderService {
    if (!JobOrderService.instance) {
      JobOrderService.instance = new JobOrderService();
    }
    return JobOrderService.instance;
  }

  // Generate next job order number for tenant
  async getNextJobOrderNumber(tenantId: string): Promise<{ jobOrderSeq: number; jobOrderNumber: string }> {
    try {
      const counterRef = doc(db, 'tenants', tenantId, 'counters', 'jobOrderNumber');
      const counterDoc = await getDoc(counterRef);
      
      if (counterDoc.exists()) {
        const currentCount = counterDoc.data().count || 0;
        const newCount = currentCount + 1;
        const formattedNumber = newCount.toString().padStart(4, '0');
        
        await updateDoc(counterRef, { 
          count: increment(1),
          lastFormatted: formattedNumber,
          updatedAt: serverTimestamp()
        });
        
        return { jobOrderSeq: newCount, jobOrderNumber: formattedNumber };
      } else {
        // Initialize counter - use setDoc instead of updateDoc for new documents
        const initialCount = 1;
        const formattedNumber = initialCount.toString().padStart(4, '0');
        
        await setDoc(counterRef, { 
          count: initialCount,
          lastFormatted: formattedNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        
        return { jobOrderSeq: initialCount, jobOrderNumber: formattedNumber };
      }
    } catch (error) {
      console.error('Error getting next job order number:', error);
      throw error;
    }
  }

  // Create new job order
  async createJobOrder(tenantId: string, formData: JobOrderFormData, createdBy: string, dealId?: string): Promise<string> {
    try {
      const { jobOrderSeq, jobOrderNumber } = await this.getNextJobOrderNumber(tenantId);
      
      // Create job order with unified structure
      const jobOrderData = {
        // Job Order specific fields
        jobOrderSeq,
        jobOrderNumber,
        jobOrderName: formData.jobOrderName || 'New Job Order',
        jobTitle: formData.jobTitle || '',
        status: formData.status || 'open',
        tenantId,
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dealId,
        
        // If this is created from a deal, include the deal data
        // Otherwise, create a minimal deal structure for consistency
        deal: dealId ? null : {
          id: null,
          name: formData.jobOrderName || 'New Job Order',
          companyId: formData.companyId || '',
          companyName: formData.companyName || '',
          locationId: formData.worksiteId || '',
          locationName: formData.worksiteName || '',
          stage: 'draft',
          status: 'open',
          estimatedRevenue: 0,
          closeDate: null,
          owner: createdBy,
          tags: [],
          notes: '',
          stageData: {},
          associations: {
            companies: formData.companyId ? [formData.companyId] : [],
            locations: formData.worksiteId ? [formData.worksiteId] : [],
            contacts: [],
            salespeople: [],
            deals: [],
            tasks: []
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      };

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_orders'), jobOrderData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating job order:', error);
      throw error;
    }
  }

  // Update job order
  async updateJobOrder(tenantId: string, jobOrderId: string, updates: Partial<JobOrderFormData>): Promise<void> {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await updateDoc(jobOrderRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating job order:', error);
      throw error;
    }
  }

  // Get job order by ID
  async getJobOrder(tenantId: string, jobOrderId: string): Promise<JobOrder | null> {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
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

  // Get job orders by tenant
  async getJobOrders(tenantId: string, limitCount?: number): Promise<JobOrder[]> {
    try {
      let q = query(
        collection(db, 'tenants', tenantId, 'job_orders'),
        orderBy('createdAt', 'desc')
      );
      
      if (limitCount) {
        q = query(q, limit(limitCount));
      }
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobOrder));
    } catch (error) {
      console.error('Error getting job orders:', error);
      throw error;
    }
  }

  // Get job orders by status
  async getJobOrdersByStatus(tenantId: string, status: string): Promise<JobOrder[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_orders'),
        where('status', '==', status),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobOrder));
    } catch (error) {
      console.error('Error getting job orders by status:', error);
      throw error;
    }
  }

  // Get job orders by deal ID
  async getJobOrdersByDeal(tenantId: string, dealId: string): Promise<JobOrder[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_orders'),
        where('dealId', '==', dealId),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobOrder));
    } catch (error) {
      console.error('Error getting job orders by deal:', error);
      throw error;
    }
  }

  // Delete job order
  async deleteJobOrder(tenantId: string, jobOrderId: string): Promise<void> {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await deleteDoc(jobOrderRef);
    } catch (error) {
      console.error('Error deleting job order:', error);
      throw error;
    }
  }

  // Auto-fill job order from deal data - creates one job order per job title
  async createJobOrderFromDeal(tenantId: string, dealId: string, createdBy: string): Promise<string[]> {
    try {
      // Get deal data
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealDoc = await getDoc(dealRef);
      
      if (!dealDoc.exists()) {
        throw new Error('Deal not found');
      }
      
      const dealData = { id: dealDoc.id, ...dealDoc.data() } as any;
      const stageData = dealData.stageData || {};
      const discoveryData = stageData.discovery || {};
      
      // Get job titles from discovery stage data
      const jobTitles = discoveryData.jobTitles || [];
      
      if (jobTitles.length === 0) {
        throw new Error('No job titles found in deal. Please complete the Discovery stage with job titles.');
      }
      
      const createdJobOrderIds: string[] = [];
      
      // Create one job order for each job title
      for (const jobTitle of jobTitles) {
        // Use mapping to produce flat fields + initialSnapshot
        const { mapDealToJobOrder } = await import('../../mappings/dealToJobOrder');
        const { SCHEMA_VERSION } = await import('../../fields/registry');
        const mapped = mapDealToJobOrder({ ...dealData, jobTitle });

        // Helper function to remove undefined values
        const removeUndefinedValues = (obj: any): any => {
          if (obj === null || obj === undefined) return obj;
          if (Array.isArray(obj)) {
            return obj.map(removeUndefinedValues).filter(item => item !== undefined);
          }
          if (typeof obj === 'object') {
            const cleaned: any = {};
            for (const [key, value] of Object.entries(obj)) {
              if (value !== undefined) {
                cleaned[key] = removeUndefinedValues(value);
              }
            }
            return cleaned;
          }
          return obj;
        };

        // Create job order with unified structure - FLATTENED
        const jobOrderData: any = {
          // Job Order specific fields
          jobOrderSeq: 0, // Will be set by getNextJobOrderNumber
          jobOrderNumber: '', // Will be set by getNextJobOrderNumber
          jobOrderName: `${jobTitle} - ${dealData.name || 'Job Order'}`,
          jobTitle: jobTitle,
          status: 'draft',
          tenantId,
          createdBy,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          dealId,

          // Flattened mapping outputs (cleaned of undefined values)
          ...removeUndefinedValues(mapped.flat),
          // Registry versioning (Phase 1)
          schemaVersion: SCHEMA_VERSION,
          initialSnapshot: removeUndefinedValues(mapped.initialSnapshot),
          
          // Copy stageData to top level for easy access
          stageData: dealData.stageData || {},
          
          // Copy deal data with associations for job order reference
          deal: {
            id: dealData.id,
            name: dealData.name,
            companyId: dealData.companyId,
            companyName: dealData.companyName,
            locationId: dealData.locationId,
            locationName: dealData.locationName,
            stage: dealData.stage,
            status: dealData.status,
            estimatedRevenue: dealData.estimatedRevenue,
            closeDate: dealData.closeDate,
            owner: dealData.owner,
            tags: dealData.tags || [],
            notes: dealData.notes || '',
            stageData: dealData.stageData || {},
            associations: dealData.associations || {},
            createdAt: dealData.createdAt,
            updatedAt: dealData.updatedAt
          }
        };
        
        // Get next job order number
        const { jobOrderSeq, jobOrderNumber } = await this.getNextJobOrderNumber(tenantId);
        
        // Update the job order data with the generated number
        jobOrderData.jobOrderSeq = jobOrderSeq;
        jobOrderData.jobOrderNumber = jobOrderNumber;
        
        // Create the job order document
        const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_orders'), jobOrderData);
        createdJobOrderIds.push(docRef.id);
      }
      
      return createdJobOrderIds;
    } catch (error) {
      console.error('Error creating job orders from deal:', error);
      throw error;
    }
  }

  // Application Management
  async createApplication(tenantId: string, applicationData: Omit<JobApplication, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_applications'), {
        ...applicationData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error creating application:', error);
      throw error;
    }
  }

  async getApplicationsByJobOrder(tenantId: string, jobOrderId: string): Promise<JobApplication[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_applications'),
        where('jobOrderId', '==', jobOrderId),
        orderBy('appliedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobApplication));
    } catch (error) {
      console.error('Error getting applications:', error);
      throw error;
    }
  }

  // Candidate Management
  async createCandidate(tenantId: string, candidateData: Omit<Candidate, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'candidates'), {
        ...candidateData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error creating candidate:', error);
      throw error;
    }
  }

  async getCandidatesByJobOrder(tenantId: string, jobOrderId: string): Promise<Candidate[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'candidates'),
        where('jobOrderId', '==', jobOrderId),
        orderBy('assignedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Candidate));
    } catch (error) {
      console.error('Error getting candidates:', error);
      throw error;
    }
  }

  // Employee Management
  async createEmployee(tenantId: string, employeeData: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'employees'), {
        ...employeeData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error creating employee:', error);
      throw error;
    }
  }

  async getEmployeesByJobOrder(tenantId: string, jobOrderId: string): Promise<Employee[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'employees'),
        where('jobOrderId', '==', jobOrderId),
        orderBy('startDate', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
    } catch (error) {
      console.error('Error getting employees:', error);
      throw error;
    }
  }
}
