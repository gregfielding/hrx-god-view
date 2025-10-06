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
  setDoc
} from 'firebase/firestore';

import { db } from '../../firebase';
import { JobOrder } from '../../types/recruiter/jobOrder';

export interface JobsBoardPost {
  id: string;
  jobPostId: string; // Sequential counter like 2002, 2003, 2004
  tenantId: string;
  
  // Posting Details
  postTitle: string; // Title of the posting (may differ from job title)
  jobTitle: string; // Actual job title
  jobDescription: string; // Full job description
  
  // Company & Location
  companyId?: string;
  companyName: string;
  worksiteId?: string;
  worksiteName: string; // Location nickname
  worksiteAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  
  // Dates & Compensation
  startDate?: Date;
  endDate?: Date;
  expDate?: Date;
  payRate?: number;
  showPayRate: boolean;
  
  // Display Settings
  visibility: 'public' | 'private' | 'restricted';
  restrictedGroups?: string[]; // User group IDs for restricted visibility
  
  // Status
  status: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired';
  postedAt?: Date;
  expiresAt?: Date;
  
  // Links
  jobOrderId?: string; // Optional link to job order
  autoAddToUserGroup?: string; // Optional: auto-add applicants to this user group
  
  // Requirements & Additional Info
  requirements?: string[];
  benefits?: string;
  shiftTimes?: string;
  showShiftTimes?: boolean;
  
  // Metrics
  applicationCount: number;
  maxApplications?: number;
  
  // Metadata
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePostData {
  // Posting Details
  postTitle: string;
  jobTitle: string;
  jobDescription: string;
  
  // Company & Location
  companyId?: string;
  companyName: string;
  worksiteId?: string;
  worksiteName: string;
  worksiteAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  
  // Dates & Compensation
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  expDate?: Date | string | null;
  payRate?: number | null;
  showPayRate: boolean;
  
  // Display Settings
  visibility: 'public' | 'private' | 'restricted';
  restrictedGroups?: string[];
  
  // Links
  jobOrderId?: string;
  autoAddToUserGroup?: string;
  
  // Requirements & Additional Info
  requirements?: string[];
  benefits?: string;
  shiftTimes?: string;
  showShiftTimes?: boolean;
  
  // Expiration
  maxApplications?: number;
  expiresAt?: Date | string | null;
}

export class JobsBoardService {
  private static instance: JobsBoardService;

  public static getInstance(): JobsBoardService {
    if (!JobsBoardService.instance) {
      JobsBoardService.instance = new JobsBoardService();
    }
    return JobsBoardService.instance;
  }

  // Generate next sequential job post ID
  private async getNextJobPostId(tenantId: string): Promise<string> {
    try {
      const counterRef = doc(db, 'tenants', tenantId, 'counters', 'jobPosts');
      const counterDoc = await getDoc(counterRef);
      
      let nextSeq = 2001; // Start at 2001
      if (counterDoc.exists()) {
        nextSeq = (counterDoc.data().current || 2000) + 1;
      }
      
      // Update or create the counter
      if (counterDoc.exists()) {
        await updateDoc(counterRef, { current: nextSeq, updatedAt: serverTimestamp() });
      } else {
        await setDoc(counterRef, { current: nextSeq, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      
      return nextSeq.toString();
    } catch (error) {
      console.error('Error generating job post ID:', error);
      // Fallback to timestamp-based ID
      return `JP${Date.now()}`;
    }
  }

  // Create a jobs board post from a job order
  async createPostFromJobOrder(tenantId: string, jobOrderId: string, createdBy: string, customData?: Partial<CreatePostData>): Promise<string> {
    try {
      // Get the job order data
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderDoc = await getDoc(jobOrderRef);
      
      if (!jobOrderDoc.exists()) {
        throw new Error('Job Order not found');
      }
      
      const jobOrder = { id: jobOrderDoc.id, ...jobOrderDoc.data() } as JobOrder;
      
      // Generate sequential job post ID
      const jobPostId = await this.getNextJobPostId(tenantId);
      
      // Normalize visibility from job order
      let visibility: 'public' | 'private' | 'restricted' = 'public';
      if (jobOrder.jobsBoardVisibility === 'hidden') {
        visibility = 'private';
      } else if (jobOrder.jobsBoardVisibility === 'group_restricted') {
        visibility = 'restricted';
      }
      
      // Create the post data
      const postData: Omit<JobsBoardPost, 'id'> = {
        jobPostId,
        tenantId,
        
        // Posting Details
        postTitle: customData?.postTitle || jobOrder.jobOrderName,
        jobTitle: customData?.jobTitle || jobOrder.jobTitle,
        jobDescription: customData?.jobDescription || jobOrder.jobOrderDescription || jobOrder.jobDescription || '',
        
        // Company & Location
        companyId: jobOrder.companyId,
        companyName: customData?.companyName || jobOrder.companyName,
        worksiteId: jobOrder.worksiteId,
        worksiteName: customData?.worksiteName || jobOrder.worksiteName,
        worksiteAddress: customData?.worksiteAddress || jobOrder.worksiteAddress || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
        },
        
        // Dates & Compensation
        startDate: customData?.startDate ? (typeof customData.startDate === 'string' ? new Date(customData.startDate) : customData.startDate) : jobOrder.startDate,
        endDate: customData?.endDate ? (typeof customData.endDate === 'string' ? new Date(customData.endDate) : customData.endDate) : jobOrder.endDate,
        payRate: customData?.payRate !== undefined ? customData.payRate : (jobOrder.showPayRate ? jobOrder.payRate : undefined),
        showPayRate: customData?.showPayRate !== undefined ? customData.showPayRate : jobOrder.showPayRate,
        
        // Display Settings
        visibility: customData?.visibility || visibility,
        restrictedGroups: customData?.restrictedGroups || jobOrder.restrictedGroups,
        
        // Status
        status: 'draft',
        expiresAt: customData?.expiresAt ? (typeof customData.expiresAt === 'string' ? new Date(customData.expiresAt) : customData.expiresAt) : undefined,
        
        // Links
        jobOrderId,
        autoAddToUserGroup: customData?.autoAddToUserGroup,
        
        // Requirements & Additional Info
        requirements: customData?.requirements || [
          ...jobOrder.requiredLicenses,
          ...jobOrder.requiredCertifications,
          ...(jobOrder.drugScreenRequired ? ['Drug Screen Required'] : []),
          ...(jobOrder.backgroundCheckRequired ? ['Background Check Required'] : []),
          ...(jobOrder.experienceRequired ? [jobOrder.experienceRequired] : []),
          ...(jobOrder.educationRequired ? [jobOrder.educationRequired] : []),
          ...(jobOrder.languagesRequired || []),
          ...(jobOrder.skillsRequired || [])
        ].filter(Boolean),
        benefits: customData?.benefits,
        shiftTimes: customData?.shiftTimes || jobOrder.shiftTimes?.join(', '),
        showShiftTimes: customData?.showShiftTimes !== undefined ? customData.showShiftTimes : jobOrder.showShiftTimes,
        
        // Metrics
        applicationCount: 0,
        maxApplications: customData?.maxApplications,
        
        // Metadata
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_postings'), postData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating jobs board post:', error);
      throw error;
    }
  }

  // Create a standalone jobs board post
  async createPost(tenantId: string, postData: CreatePostData, createdBy?: string): Promise<string> {
    try {
      // Generate sequential job post ID
      const jobPostId = await this.getNextJobPostId(tenantId);

      // Convert dates to Date objects if they're strings
      let startDate: Date | undefined;
      if (postData.startDate) {
        startDate = typeof postData.startDate === 'string' ? new Date(postData.startDate) : postData.startDate;
      }

      let endDate: Date | undefined;
      if (postData.endDate) {
        endDate = typeof postData.endDate === 'string' ? new Date(postData.endDate) : postData.endDate;
      }

      let expDate: Date | undefined;
      if (postData.expDate) {
        expDate = typeof postData.expDate === 'string' ? new Date(postData.expDate) : postData.expDate;
      }

      let expiresAt: Date | undefined;
      if (postData.expiresAt) {
        expiresAt = typeof postData.expiresAt === 'string' ? new Date(postData.expiresAt) : postData.expiresAt;
      }

      const fullPostData: Omit<JobsBoardPost, 'id'> = {
        jobPostId,
        tenantId,
        
        // Posting Details
        postTitle: postData.postTitle,
        jobTitle: postData.jobTitle,
        jobDescription: postData.jobDescription,
        
        // Company & Location
        companyId: postData.companyId,
        companyName: postData.companyName,
        worksiteId: postData.worksiteId,
        worksiteName: postData.worksiteName,
        worksiteAddress: postData.worksiteAddress,
        
        // Dates & Compensation
        startDate,
        endDate,
        expDate,
        payRate: postData.payRate || undefined,
        showPayRate: postData.showPayRate,
        
        // Display Settings
        visibility: postData.visibility,
        restrictedGroups: postData.restrictedGroups,
        
        // Status
        status: 'draft',
        expiresAt,
        
        // Links
        jobOrderId: postData.jobOrderId,
        autoAddToUserGroup: postData.autoAddToUserGroup,
        
        // Requirements & Additional Info
        requirements: postData.requirements,
        benefits: postData.benefits,
        shiftTimes: postData.shiftTimes,
        showShiftTimes: postData.showShiftTimes,
        
        // Metrics
        applicationCount: 0,
        maxApplications: postData.maxApplications,
        
        // Metadata
        createdBy: createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_postings'), fullPostData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating jobs board post:', error);
      throw error;
    }
  }

  // Update a jobs board post
  async updatePost(tenantId: string, postId: string, updates: Partial<CreatePostData>): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      await updateDoc(postRef, {
        ...updates,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating jobs board post:', error);
      throw error;
    }
  }

  // Get a jobs board post by ID
  async getPost(tenantId: string, postId: string): Promise<JobsBoardPost | null> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      const postDoc = await getDoc(postRef);
      
      if (postDoc.exists()) {
        return { id: postDoc.id, ...postDoc.data() } as JobsBoardPost;
      }
      return null;
    } catch (error) {
      console.error('Error getting jobs board post:', error);
      throw error;
    }
  }

  // Get all jobs board posts for a tenant
  async getPosts(tenantId: string, limitCount?: number): Promise<JobsBoardPost[]> {
    try {
      let q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        orderBy('createdAt', 'desc')
      );
      
      if (limitCount) {
        q = query(q, limit(limitCount));
      }
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
    } catch (error) {
      console.error('Error getting jobs board posts:', error);
      throw error;
    }
  }

  // Get public jobs board posts (for public job board)
  async getPublicPosts(tenantId: string, userGroups?: string[]): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('status', '==', 'active'),
        where('visibility', 'in', ['public', 'restricted']),
        orderBy('postedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      const allPosts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
      
      // Filter by group restrictions if user groups are provided
      if (userGroups && userGroups.length > 0) {
        return allPosts.filter(post => {
          if (post.visibility === 'public') return true;
          if (post.visibility === 'restricted' && post.restrictedGroups) {
            return post.restrictedGroups.some(groupId => userGroups.includes(groupId));
          }
          return false;
        });
      }
      
      // If no user groups provided, only return public posts
      return allPosts.filter(post => post.visibility === 'public');
    } catch (error) {
      console.error('Error getting public jobs board posts:', error);
      throw error;
    }
  }

  // Get posts by job order
  async getPostsByJobOrder(tenantId: string, jobOrderId: string): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('jobOrderId', '==', jobOrderId),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
    } catch (error) {
      console.error('Error getting posts by job order:', error);
      throw error;
    }
  }

  // Update post status
  async updatePostStatus(tenantId: string, postId: string, status: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired'): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      const updateData: Record<string, any> = {
        status,
        updatedAt: new Date()
      };
      
      if (status === 'active') {
        updateData.postedAt = new Date();
      }
      
      await updateDoc(postRef, updateData);
    } catch (error) {
      console.error('Error updating post status:', error);
      throw error;
    }
  }

  // Increment application count
  async incrementApplicationCount(tenantId: string, postId: string): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      await updateDoc(postRef, {
        applicationCount: serverTimestamp(), // This will be handled by a cloud function
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error incrementing application count:', error);
      throw error;
    }
  }

  // Delete a jobs board post
  async deletePost(tenantId: string, postId: string): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      await deleteDoc(postRef);
    } catch (error) {
      console.error('Error deleting jobs board post:', error);
      throw error;
    }
  }

  // Get posts by visibility
  async getPostsByVisibility(tenantId: string, visibility: 'public' | 'private' | 'restricted'): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('visibility', '==', visibility),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
    } catch (error) {
      console.error('Error getting posts by visibility:', error);
      throw error;
    }
  }

  // Get posts by status
  async getPostsByStatus(tenantId: string, status: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired'): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('status', '==', status),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
    } catch (error) {
      console.error('Error getting posts by status:', error);
      throw error;
    }
  }
}
