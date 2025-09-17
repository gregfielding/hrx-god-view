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
        const formattedNumber = `JO-${newCount.toString().padStart(4, '0')}`;
        
        await updateDoc(counterRef, { 
          count: increment(1),
          lastFormatted: formattedNumber,
          updatedAt: serverTimestamp()
        });
        
        return { jobOrderSeq: newCount, jobOrderNumber: formattedNumber };
      } else {
        // Initialize counter - use setDoc instead of updateDoc for new documents
        const initialCount = 1;
        const formattedNumber = `JO-${initialCount.toString().padStart(4, '0')}`;
        
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
      
      const jobOrderData: Omit<JobOrder, 'id'> = {
        jobOrderSeq,
        jobOrderNumber,
        ...formData,
        tenantId,
        // Add default values
        status: formData.status || 'open',
        visibility: formData.visibility || 'hidden',
        headcountRequested: formData.headcountRequested || 0,
        headcountFilled: formData.headcountFilled || 0,
        // Use serverTimestamp for consistency
        dateOpened: serverTimestamp(),
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dealId
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

  // Auto-fill job order from deal data
  async createJobOrderFromDeal(tenantId: string, dealId: string, createdBy: string): Promise<string> {
    try {
      // Get deal data
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealDoc = await getDoc(dealRef);
      
      if (!dealDoc.exists()) {
        throw new Error('Deal not found');
      }
      
      const dealData = dealDoc.data();
      
      // Map deal data to job order form data
      const formData: JobOrderFormData = {
        jobOrderName: `${dealData.name || 'Job Order'} - ${new Date().toLocaleDateString()}`,
        jobOrderDescription: dealData.description || '',
        status: 'draft',
        companyId: dealData.companyId || '',
        companyName: dealData.companyName || '',
        companyContacts: [], // Will need to be populated separately
        worksiteId: dealData.locationId || '',
        worksiteName: dealData.locationName || '',
        worksiteAddress: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'USA'
        },
        jobTitle: dealData.jobTitle || '',
        jobDescription: dealData.description || '',
        assignedRecruiters: [],
        payRate: 0,
        billRate: 0,
        workersNeeded: 1,
        timesheetCollectionMethod: 'app_clock_in_out',
        jobsBoardVisibility: 'hidden',
        showPayRate: false,
        showStartDate: true,
        showShiftTimes: true,
        requiredLicenses: [],
        requiredCertifications: [],
        drugScreenRequired: false,
        backgroundCheckRequired: false,
        ppeProvidedBy: 'company',
        onboardingRequirements: []
      };
      
      return await this.createJobOrder(tenantId, formData, createdBy, dealId);
    } catch (error) {
      console.error('Error creating job order from deal:', error);
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
