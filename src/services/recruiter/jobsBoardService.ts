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
  serverTimestamp
} from 'firebase/firestore';

import { db } from '../../firebase';
import { JobOrder } from '../../types/recruiter/jobOrder';

export interface JobsBoardPost {
  id: string;
  tenantId: string;
  jobOrderId: string;
  title: string;
  description: string;
  location: string;
  companyName: string;
  payRate?: number;
  showPayRate: boolean;
  startDate?: Date;
  showStartDate: boolean;
  shiftTimes?: string;
  showShiftTimes: boolean;
  requirements: string[];
  benefits?: string;
  visibility: 'hidden' | 'public' | 'group_restricted';
  restrictedGroups?: string[];
  status: 'draft' | 'posted' | 'paused' | 'closed';
  postedAt?: Date;
  expiresAt?: Date;
  applicationCount: number;
  maxApplications?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePostData {
  jobOrderId?: string;
  title: string;
  description: string;
  location: string;
  companyName: string;
  payRate?: number | null;
  showPayRate: boolean;
  startDate?: Date | string | null;
  showStartDate?: boolean;
  shiftTimes?: string;
  showShiftTimes?: boolean;
  requirements?: string[];
  benefits?: string;
  visibility: 'hidden' | 'public' | 'group_restricted' | 'limited' | 'private';
  restrictedGroups?: string[];
  maxApplications?: number;
  expiresAt?: Date;
  sourceType?: 'generic' | 'job_order';
  sourceId?: string | null;
}

export class JobsBoardService {
  private static instance: JobsBoardService;

  public static getInstance(): JobsBoardService {
    if (!JobsBoardService.instance) {
      JobsBoardService.instance = new JobsBoardService();
    }
    return JobsBoardService.instance;
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
      
      // Create the post data
      const postData: Omit<JobsBoardPost, 'id'> = {
        tenantId,
        jobOrderId,
        title: customData?.title || jobOrder.jobOrderName,
        description: customData?.description || jobOrder.jobOrderDescription || '',
        location: customData?.location || jobOrder.worksiteName,
        companyName: customData?.companyName || jobOrder.companyName,
        payRate: customData?.payRate !== undefined ? customData.payRate : (jobOrder.showPayRate ? jobOrder.payRate : undefined),
        showPayRate: customData?.showPayRate !== undefined ? customData.showPayRate : jobOrder.showPayRate,
        startDate: customData?.startDate || jobOrder.startDate,
        showStartDate: customData?.showStartDate !== undefined ? customData.showStartDate : jobOrder.showStartDate,
        shiftTimes: customData?.shiftTimes,
        showShiftTimes: customData?.showShiftTimes !== undefined ? customData.showShiftTimes : jobOrder.showShiftTimes,
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
        visibility: customData?.visibility || jobOrder.jobsBoardVisibility,
        restrictedGroups: customData?.restrictedGroups || jobOrder.restrictedGroups,
        status: 'draft',
        applicationCount: 0,
        maxApplications: customData?.maxApplications,
        expiresAt: customData?.expiresAt,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'jobs_board_posts'), postData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating jobs board post:', error);
      throw error;
    }
  }

  // Create a standalone jobs board post
  async createPost(tenantId: string, postData: CreatePostData, createdBy?: string): Promise<string> {
    try {
      // Normalize visibility values
      let normalizedVisibility: 'hidden' | 'public' | 'group_restricted' = 'public';
      if (postData.visibility === 'private' || postData.visibility === 'hidden') {
        normalizedVisibility = 'hidden';
      } else if (postData.visibility === 'limited' || postData.visibility === 'group_restricted') {
        normalizedVisibility = 'group_restricted';
      } else if (postData.visibility === 'public') {
        normalizedVisibility = 'public';
      }

      // Convert startDate to Date if it's a string
      let startDate: Date | undefined;
      if (postData.startDate) {
        startDate = typeof postData.startDate === 'string' ? new Date(postData.startDate) : postData.startDate;
      }

      const fullPostData: Omit<JobsBoardPost, 'id'> = {
        tenantId,
        jobOrderId: postData.jobOrderId || postData.sourceId || '',
        title: postData.title,
        description: postData.description,
        location: postData.location,
        companyName: postData.companyName,
        payRate: postData.payRate || undefined,
        showPayRate: postData.showPayRate,
        startDate,
        showStartDate: postData.showStartDate !== undefined ? postData.showStartDate : true,
        shiftTimes: postData.shiftTimes,
        showShiftTimes: postData.showShiftTimes !== undefined ? postData.showShiftTimes : false,
        requirements: postData.requirements || [],
        benefits: postData.benefits,
        visibility: normalizedVisibility,
        restrictedGroups: postData.restrictedGroups,
        status: 'draft',
        applicationCount: 0,
        maxApplications: postData.maxApplications,
        expiresAt: postData.expiresAt,
        createdBy: createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'jobs_board_posts'), fullPostData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating jobs board post:', error);
      throw error;
    }
  }

  // Update a jobs board post
  async updatePost(tenantId: string, postId: string, updates: Partial<CreatePostData>): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'jobs_board_posts', postId);
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
      const postRef = doc(db, 'tenants', tenantId, 'jobs_board_posts', postId);
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
        collection(db, 'tenants', tenantId, 'jobs_board_posts'),
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
        collection(db, 'tenants', tenantId, 'jobs_board_posts'),
        where('status', '==', 'posted'),
        where('visibility', 'in', ['public', 'group_restricted']),
        orderBy('postedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      const allPosts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobsBoardPost));
      
      // Filter by group restrictions if user groups are provided
      if (userGroups && userGroups.length > 0) {
        return allPosts.filter(post => {
          if (post.visibility === 'public') return true;
          if (post.visibility === 'group_restricted' && post.restrictedGroups) {
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
        collection(db, 'tenants', tenantId, 'jobs_board_posts'),
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
  async updatePostStatus(tenantId: string, postId: string, status: 'draft' | 'posted' | 'paused' | 'closed'): Promise<void> {
    try {
      const postRef = doc(db, 'tenants', tenantId, 'jobs_board_posts', postId);
      const updateData: Record<string, any> = {
        status,
        updatedAt: new Date()
      };
      
      if (status === 'posted') {
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
      const postRef = doc(db, 'tenants', tenantId, 'jobs_board_posts', postId);
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
      const postRef = doc(db, 'tenants', tenantId, 'jobs_board_posts', postId);
      await deleteDoc(postRef);
    } catch (error) {
      console.error('Error deleting jobs board post:', error);
      throw error;
    }
  }

  // Get posts by visibility
  async getPostsByVisibility(tenantId: string, visibility: 'hidden' | 'public' | 'group_restricted'): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'jobs_board_posts'),
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
  async getPostsByStatus(tenantId: string, status: 'draft' | 'posted' | 'paused' | 'closed'): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'jobs_board_posts'),
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
