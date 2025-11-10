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

// Helper function to remove undefined values from object
const removeUndefinedValues = (obj: any): any => {
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

// Shift representation for job board (for Gig jobs)
export interface JobBoardShift {
  shiftId: string; // Reference to shifts/{shiftId} in Firestore
  shiftTitle: string; // "Wednesday Cleaners"
  shiftDate: string; // ISO date string "2025-10-28"
  startTime: string; // "08:00" (HH:mm format)
  endTime: string; // "17:30" (HH:mm format)
  staffNeeded: number; // Total positions for this shift
  staffFilled: number; // Currently filled positions (calculated)
  spotsRemaining: number; // staffNeeded - staffFilled (calculated)
  showStaffNeeded?: boolean; // Whether to display staff count on jobs board
  poNumber?: string; // Optional PO number for this shift
  shiftDescription?: string; // Optional shift-specific details
  defaultJobTitle?: string; // Job title for this shift
  payRate?: number; // Pay rate for this shift's job title (from gigPositions)
}

const normalizeAutoAddGroups = (value?: string | string[] | null): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id): id is string => Boolean(id));
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
};

export interface JobsBoardPost {
  id: string;
  jobPostId: string; // Sequential counter like 2002, 2003, 2004
  tenantId: string;
  
  // Posting Details
  postTitle: string; // Title of the posting (may differ from job title)
  jobType: 'gig' | 'career'; // Type of employment
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
  nextShiftDate?: Date; // For Gig jobs: next upcoming shift date
  showStart?: boolean;
  showEnd?: boolean;
  payRate?: number;
  showPayRate: boolean;
  workersNeeded?: number; // Optional for Gig jobs
  showWorkersNeeded?: boolean; // Whether to show workers needed on public posting
  eVerifyRequired: boolean;
  backgroundCheckPackages: string[];
  showBackgroundChecks: boolean;
  drugScreeningPanels: string[];
  showDrugScreening: boolean;
  additionalScreenings: string[];
  showAdditionalScreenings: boolean;
  shift: string[];
  showShift: boolean;
  startTime?: string;
  endTime?: string;
  showStartTime?: boolean;
  showEndTime?: boolean;
  
  // Display Settings
  visibility: 'public' | 'private' | 'restricted';
  restrictedGroups?: string[]; // User group IDs for restricted visibility
  
  // Status
  status: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired';
  postedAt?: Date;
  expiresAt?: Date;
  
  // Links
  jobOrderId?: string; // Optional link to job order
  skills?: string[]; // Required skills for the position
  showSkills?: boolean; // Whether to show skills on public posting
  licensesCerts?: string[]; // Required licenses and certifications
  showLicensesCerts?: boolean; // Whether to show licenses on public posting
  experienceLevels?: string[]; // Required experience levels
  showExperience?: boolean; // Whether to show experience on public posting
  educationLevels?: string[]; // Required education levels
  showEducation?: boolean; // Whether to show education on public posting
  languages?: string[]; // Required languages
  showLanguages?: boolean; // Whether to show languages on public posting
  physicalRequirements?: string[]; // Physical requirements
  showPhysicalRequirements?: boolean; // Whether to show physical requirements on public posting
  uniformRequirements?: string[]; // Uniform/dress code requirements
  showUniformRequirements?: boolean; // Whether to show uniform requirements on public posting
  requiredPpe?: string[]; // Required PPE
  showRequiredPpe?: boolean; // Whether to show PPE requirements on public posting
  autoAddToUserGroups?: string[]; // Optional: auto-add applicants to these user groups
  autoAddToUserGroup?: string; // Legacy single value support
  
  // Shift Selection Model (for Gig jobs only)
  availableShifts?: JobBoardShift[]; // DEPRECATED - Use dynamic shift loading instead
  includeShiftsInPosting?: boolean; // Whether to show shift selection UI (auto-true for Gig with shifts)
  
  // Dynamic Shift Loading (NEW - for evergreen Gig postings)
  usesDynamicShifts?: boolean; // If true, shifts are loaded dynamically from shifts collection
  shiftFilterDays?: number; // Number of days in future to show shifts (default: 30)
  
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
  jobType: 'gig' | 'career';
  jobTitle?: string;
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
  showStart?: boolean;
  showEnd?: boolean;
  payRate?: number | null;
  showPayRate: boolean;
  workersNeeded?: number; // Optional for Gig jobs
  showWorkersNeeded?: boolean; // Whether to show workers needed on public posting
  eVerifyRequired: boolean;
  backgroundCheckPackages: string[];
  showBackgroundChecks: boolean;
  drugScreeningPanels: string[];
  showDrugScreening: boolean;
  additionalScreenings: string[];
  showAdditionalScreenings: boolean;
  shift: string[];
  showShift: boolean;
  startTime?: string;
  endTime?: string;
  showStartTime?: boolean;
  showEndTime?: boolean;
  
  // Display Settings
  visibility: 'public' | 'private' | 'restricted';
  restrictedGroups?: string[];
  
  // Status
  status?: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired';
  
  // Links
  jobOrderId?: string;
  skills?: string[];
  autoAddToUserGroups?: string[];
  autoAddToUserGroup?: string; // Legacy single value support
  
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

  // Fetch shifts for a job order and format for job board
  private async fetchShiftsForJobOrder(tenantId: string, jobOrderId: string): Promise<JobBoardShift[]> {
    try {
      // Fetch job order to get gigPositions for pay rate lookup
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);
      const jobOrderData = jobOrderSnap.exists() ? jobOrderSnap.data() : null;
      const gigPositions = jobOrderData?.gigPositions as Array<{jobTitle: string; payRate: string}> | undefined;
      
      // Use tenant/job_order subcollection path
      const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
      const q = query(shiftsRef);
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        return [];
      }

      // Helper to find pay rate for a job title
      const getPayRateForJobTitle = (jobTitle: string | undefined): number | undefined => {
        if (!jobTitle || !gigPositions) return undefined;
        const position = gigPositions.find(p => p.jobTitle === jobTitle);
        if (position && position.payRate) {
          const rate = parseFloat(position.payRate);
          return isNaN(rate) ? undefined : rate;
        }
        return undefined;
      };

      // Convert Firestore shifts to JobBoardShift format
      const shifts: JobBoardShift[] = snapshot.docs.map(doc => {
        const data = doc.data();
        const defaultJobTitle = data.defaultJobTitle || jobOrderData?.jobTitle;
        const payRate = getPayRateForJobTitle(defaultJobTitle) || jobOrderData?.payRate;
        
        return {
          shiftId: doc.id,
          shiftTitle: data.shiftTitle || 'Unnamed Shift',
          shiftDate: data.shiftDate, // ISO date string
          startTime: data.defaultStartTime, // HH:mm format
          endTime: data.defaultEndTime, // HH:mm format
          staffNeeded: data.totalStaffRequested || 1,
          staffFilled: 0, // TODO: Calculate from assignments in future phase
          spotsRemaining: data.totalStaffRequested || 1, // TODO: Calculate in future phase
          showStaffNeeded: data.showStaffNeeded || false,
          poNumber: data.poNumber,
          shiftDescription: data.shiftDescription,
          defaultJobTitle: defaultJobTitle,
          payRate: payRate,
        };
      });

      // Sort by date
      shifts.sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime());

      return shifts;
    } catch (error) {
      console.error('Error fetching shifts for job order:', error);
      return [];
    }
  }

  /**
   * Fetch active/upcoming shifts for a job order (dynamic loading)
   * Only returns shifts starting today or in the future
   * @param tenantId Tenant ID
   * @param jobOrderId Job Order ID
   * @param filterDays Number of days in future to include (default: 30)
   */
  async fetchActiveShiftsForJobOrder(
    tenantId: string, 
    jobOrderId: string, 
    filterDays = 30
  ): Promise<JobBoardShift[]> {
    try {
      // Fetch job order to get gigPositions for pay rate lookup
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);
      const jobOrderData = jobOrderSnap.exists() ? jobOrderSnap.data() : null;
      const gigPositions = jobOrderData?.gigPositions as Array<{jobTitle: string; payRate: string}> | undefined;
      
      // Get today's date at midnight (local time)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Format as YYYY-MM-DD in local timezone (not UTC)
      const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      // Get cutoff date (today + filterDays)
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() + filterDays);
      const cutoffISO = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
      
      // Use tenant/job_order subcollection path
      const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
      const q = query(shiftsRef);
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        return [];
      }

      // Helper to find pay rate for a job title
      const getPayRateForJobTitle = (jobTitle: string | undefined): number | undefined => {
        if (!jobTitle || !gigPositions) return undefined;
        const position = gigPositions.find(p => p.jobTitle === jobTitle);
        if (position && position.payRate) {
          const rate = parseFloat(position.payRate);
          return isNaN(rate) ? undefined : rate;
        }
        return undefined;
      };

      // Convert and filter shifts
      const shifts: JobBoardShift[] = snapshot.docs
        .map(doc => {
          const data = doc.data();
          const defaultJobTitle = data.defaultJobTitle || jobOrderData?.jobTitle;
          const payRate = getPayRateForJobTitle(defaultJobTitle) || jobOrderData?.payRate;
          
          return {
            shiftId: doc.id,
            shiftTitle: data.shiftTitle || 'Unnamed Shift',
            shiftDate: data.shiftDate, // ISO date string
            startTime: data.defaultStartTime, // HH:mm format
            endTime: data.defaultEndTime, // HH:mm format
            staffNeeded: data.totalStaffRequested || 1,
            staffFilled: 0, // TODO: Calculate from assignments
            spotsRemaining: data.totalStaffRequested || 1, // TODO: Calculate
            showStaffNeeded: data.showStaffNeeded || false,
            poNumber: data.poNumber,
            shiftDescription: data.shiftDescription,
            defaultJobTitle: defaultJobTitle,
            payRate: payRate,
          };
        })
        // Filter: only include shifts >= today and <= cutoff
        .filter(shift => shift.shiftDate >= todayISO && shift.shiftDate <= cutoffISO)
        // Sort by date (earliest first)
        .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));

      return shifts;
    } catch (error) {
      console.error('Error fetching active shifts:', error);
      return [];
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
      
      // Fetch location details if worksiteId exists but worksiteAddress is missing/incomplete
      let worksiteAddress = customData?.worksiteAddress || jobOrder.worksiteAddress || {
        street: '',
        city: '',
        state: '',
        zipCode: '',
      };
      
      // If we have a worksiteId but no proper address, fetch from location document
      if (jobOrder.worksiteId && (!worksiteAddress.city || !worksiteAddress.state)) {
        try {
          const locationRef = doc(db, 'tenants', tenantId, 'locations', jobOrder.worksiteId);
          const locationSnap = await getDoc(locationRef);
          
          if (locationSnap.exists()) {
            const locationData = locationSnap.data();
            worksiteAddress = {
              street: locationData.address?.street || locationData.street || '',
              city: locationData.address?.city || locationData.city || '',
              state: locationData.address?.state || locationData.state || '',
              zipCode: locationData.address?.zipCode || locationData.zipCode || '',
              coordinates: locationData.address?.coordinates || locationData.coordinates || locationData.coords || undefined,
            };
            console.log('✅ Fetched location details for', jobOrder.worksiteId, worksiteAddress);
          }
        } catch (err) {
          console.warn('Could not fetch location details:', err);
        }
      }
      
      // For Gig jobs, use dynamic shift loading (not static)
      const jobType = customData?.jobType || (jobOrder as any).jobType || 'gig';
      const usesDynamicShifts = jobType === 'gig'; // All Gig jobs use dynamic shifts now
      
      // Generate sequential job post ID
      const jobPostId = await this.getNextJobPostId(tenantId);
      
      // Normalize visibility from job order
      let visibility: 'public' | 'private' | 'restricted' = 'public';
      if (jobOrder.jobsBoardVisibility === 'hidden') {
        visibility = 'private';
      } else if (jobOrder.jobsBoardVisibility === 'group_restricted') {
        visibility = 'restricted';
      }
      
      // For Gig jobs, check if gigPositions exist and use first position's job title and pay rate
      const gigPositions = (jobOrder as any).gigPositions as Array<{jobTitle: string; payRate: string; workersNeeded?: number}> | undefined;
      const isGigJob = jobType === 'gig';
      const firstPosition = gigPositions && gigPositions.length > 0 ? gigPositions[0] : null;
      
      // Use job title and pay rate from first position if available, otherwise fall back to job order fields
      const jobTitle = customData?.jobTitle || (isGigJob && firstPosition ? firstPosition.jobTitle : jobOrder.jobTitle);
      const payRate = customData?.payRate !== undefined 
        ? customData.payRate 
        : (isGigJob && firstPosition && firstPosition.payRate 
          ? parseFloat(firstPosition.payRate) || undefined 
          : (jobOrder.showPayRate ? jobOrder.payRate : undefined));
      const autoAddGroups = normalizeAutoAddGroups(
        customData?.autoAddToUserGroups ?? customData?.autoAddToUserGroup
      );
      
      // Create the post data
      const postData: Omit<JobsBoardPost, 'id'> = {
        jobPostId,
        tenantId,
        
        // Posting Details
        postTitle: customData?.postTitle || jobOrder.jobOrderName,
        jobType: customData?.jobType || 'gig', // Default to gig if not specified
        jobTitle: jobTitle,
        jobDescription: customData?.jobDescription || jobOrder.jobOrderDescription || jobOrder.jobDescription || '',
        
        // Company & Location
        companyId: jobOrder.companyId,
        companyName: customData?.companyName || jobOrder.companyName,
        worksiteId: jobOrder.worksiteId,
        worksiteName: customData?.worksiteName || jobOrder.worksiteName,
        worksiteAddress: worksiteAddress, // Use the fetched/resolved address
        
        // Dates & Compensation
        startDate: customData?.startDate ? (typeof customData.startDate === 'string' ? new Date(customData.startDate) : customData.startDate) : jobOrder.startDate,
        endDate: customData?.endDate ? (typeof customData.endDate === 'string' ? new Date(customData.endDate) : customData.endDate) : jobOrder.endDate,
        nextShiftDate: undefined, // Will be set below for Gig jobs
        payRate: payRate,
        showPayRate: customData?.showPayRate !== undefined ? customData.showPayRate : jobOrder.showPayRate,
        workersNeeded: isGigJob ? undefined : (customData?.workersNeeded !== undefined ? customData.workersNeeded : jobOrder.workersNeeded),
        showWorkersNeeded: customData?.showWorkersNeeded !== undefined ? customData.showWorkersNeeded : true, // Default to true if not set
        eVerifyRequired: customData?.eVerifyRequired !== undefined ? customData.eVerifyRequired : jobOrder.eVerifyRequired,
        backgroundCheckPackages: customData?.backgroundCheckPackages !== undefined ? customData.backgroundCheckPackages : jobOrder.backgroundCheckPackages,
        showBackgroundChecks: customData?.showBackgroundChecks !== undefined ? customData.showBackgroundChecks : false,
        drugScreeningPanels: customData?.drugScreeningPanels !== undefined ? customData.drugScreeningPanels : jobOrder.drugScreeningPanels,
        showDrugScreening: customData?.showDrugScreening !== undefined ? customData.showDrugScreening : false,
        additionalScreenings: customData?.additionalScreenings !== undefined ? customData.additionalScreenings : jobOrder.additionalScreenings,
        showAdditionalScreenings: customData?.showAdditionalScreenings !== undefined ? customData.showAdditionalScreenings : false,
        shift: customData?.shift !== undefined ? customData.shift : [],
        showShift: customData?.showShift !== undefined ? customData.showShift : false,
        startTime: customData?.startTime !== undefined ? customData.startTime : undefined,
        endTime: customData?.endTime !== undefined ? customData.endTime : undefined,
        showStartTime: customData?.showStartTime !== undefined ? customData.showStartTime : false,
        showEndTime: customData?.showEndTime !== undefined ? customData.showEndTime : false,
        
        // Display Settings
        visibility: customData?.visibility || visibility,
        restrictedGroups: customData?.restrictedGroups || jobOrder.restrictedGroups,
        
        // Status
        status: 'draft',
        expiresAt: customData?.expiresAt ? (typeof customData.expiresAt === 'string' ? new Date(customData.expiresAt) : customData.expiresAt) : undefined,
        
        // Links
        jobOrderId,
        autoAddToUserGroups: autoAddGroups,
        ...(autoAddGroups.length === 1 ? { autoAddToUserGroup: autoAddGroups[0] } : {}),
        
        // Shift Selection (for Gig jobs - use dynamic loading)
        usesDynamicShifts, // New approach: load shifts at runtime
        shiftFilterDays: 30, // Show shifts for next 30 days
        includeShiftsInPosting: usesDynamicShifts, // Show shift selector if using dynamic shifts
        
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

      // For Gig jobs with dynamic shifts, fetch and set nextShiftDate
      if (usesDynamicShifts && jobOrderId) {
        try {
          const shifts = await this.fetchActiveShiftsForJobOrder(tenantId, jobOrderId, 30);
          if (shifts.length > 0) {
            postData.nextShiftDate = new Date(shifts[0].shiftDate);
          }
        } catch (err) {
          console.warn('Could not fetch next shift date:', err);
        }
      }

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

      const autoAddGroups = normalizeAutoAddGroups(postData.autoAddToUserGroups ?? postData.autoAddToUserGroup);

      const fullPostData: Omit<JobsBoardPost, 'id'> = {
        jobPostId,
        tenantId,
        
        // Posting Details
        postTitle: postData.postTitle,
        jobType: postData.jobType,
        jobTitle: postData.jobTitle,
        jobDescription: postData.jobDescription,
        
        // Company & Location
        ...(postData.companyId && { companyId: postData.companyId }),
        companyName: postData.companyName,
        ...(postData.worksiteId && { worksiteId: postData.worksiteId }),
        worksiteName: postData.worksiteName,
        worksiteAddress: postData.worksiteAddress,
        
        // Dates & Compensation
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(expDate && { expDate }),
        showStart: postData.showStart || false,
        showEnd: postData.showEnd || false,
        ...(postData.payRate !== null && postData.payRate !== undefined && { payRate: postData.payRate }),
        showPayRate: postData.showPayRate,
        ...(postData.workersNeeded !== undefined && { workersNeeded: postData.workersNeeded }),
        ...(postData.showWorkersNeeded !== undefined && { showWorkersNeeded: postData.showWorkersNeeded }),
        eVerifyRequired: postData.eVerifyRequired,
        backgroundCheckPackages: postData.backgroundCheckPackages,
        showBackgroundChecks: postData.showBackgroundChecks,
        drugScreeningPanels: postData.drugScreeningPanels,
        showDrugScreening: postData.showDrugScreening,
        additionalScreenings: postData.additionalScreenings,
        showAdditionalScreenings: postData.showAdditionalScreenings,
        shift: postData.shift,
        showShift: postData.showShift,
        ...(postData.startTime && { startTime: postData.startTime }),
        ...(postData.endTime && { endTime: postData.endTime }),
        showStartTime: postData.showStartTime,
        showEndTime: postData.showEndTime,
        
        // Display Settings
        visibility: postData.visibility,
        restrictedGroups: postData.restrictedGroups,
        
        // Status
        status: postData.status || 'draft',
        ...(postData.status === 'active' && { postedAt: new Date() }),
        ...(expiresAt && { expiresAt }),
        
        // Links
        ...(postData.jobOrderId && { jobOrderId: postData.jobOrderId }),
        skills: postData.skills || [],
        ...(autoAddGroups.length ? { autoAddToUserGroups: autoAddGroups } : {}),
        autoAddToUserGroup: autoAddGroups.length === 1 ? autoAddGroups[0] : undefined,
        
        // Requirements & Additional Info
        requirements: postData.requirements || [],
        ...(postData.benefits && { benefits: postData.benefits }),
        ...(postData.shiftTimes && { shiftTimes: postData.shiftTimes }),
        showShiftTimes: postData.showShiftTimes || false,
        
        // Metrics
        applicationCount: 0,
        ...(postData.maxApplications && { maxApplications: postData.maxApplications }),
        
        // Metadata
        createdBy: createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Clean the data to remove any undefined values before saving to Firestore
      const cleanedPostData = removeUndefinedValues(fullPostData);

      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_postings'), cleanedPostData);
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
      
      // Clean the updates to remove any undefined values before saving to Firestore
      const cleanedUpdates = removeUndefinedValues({
        ...updates,
        updatedAt: new Date()
      });
      
      await updateDoc(postRef, cleanedUpdates);
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
      // First try to get posts with postedAt field
      let q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('status', '==', 'active'),
        where('visibility', 'in', ['public', 'restricted']),
        orderBy('postedAt', 'desc')
      );
      
      let querySnapshot;
      try {
        querySnapshot = await getDocs(q);
      } catch (error: any) {
        // If postedAt field doesn't exist, try ordering by createdAt instead
        if (error.code === 'failed-precondition') {
          console.warn('postedAt field not found, falling back to createdAt ordering');
          q = query(
            collection(db, 'tenants', tenantId, 'job_postings'),
            where('status', '==', 'active'),
            where('visibility', 'in', ['public', 'restricted']),
            orderBy('createdAt', 'desc')
          );
          querySnapshot = await getDocs(q);
        } else {
          throw error;
        }
      }
      
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
  // Sync shifts from job order to existing job posting (for Gig jobs)
  async syncShiftsToPosting(tenantId: string, postId: string, jobOrderId: string): Promise<void> {
    try {
      // Fetch current posting to check if it's a Gig job
      const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
      const postSnap = await getDoc(postRef);
      
      if (!postSnap.exists()) {
        throw new Error('Job posting not found');
      }
      
      const posting = postSnap.data();
      
      // Only sync shifts for Gig jobs
      if (posting.jobType !== 'gig') {
        console.log('Skipping shift sync for non-Gig job');
        return;
      }
      
      // Fetch latest shifts
      const availableShifts = await this.fetchShiftsForJobOrder(tenantId, jobOrderId);
      
      // Update posting with latest shifts
      await updateDoc(postRef, {
        availableShifts,
        includeShiftsInPosting: availableShifts.length > 0,
        updatedAt: new Date()
      });
      
      console.log(`✅ Synced ${availableShifts.length} shifts to posting ${postId}`);
    } catch (error) {
      console.error('Error syncing shifts to posting:', error);
      throw error;
    }
  }

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

  // Get all posts for internal Jobs Board (regardless of status/visibility)
  async getAllPosts(tenantId: string): Promise<JobsBoardPost[]> {
    try {
      let q;
      try {
        // Try ordering by createdAt first
        q = query(
          collection(db, 'tenants', tenantId, 'job_postings'),
          orderBy('createdAt', 'desc')
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => {
          const data = doc.data();
          return Object.assign({ id: doc.id }, data || {}) as JobsBoardPost;
        });
      } catch (error: any) {
        // If createdAt doesn't exist or there's an index issue, get all docs without ordering
        if (error.code === 'failed-precondition') {
          console.warn('createdAt field not found or index missing, getting all posts without ordering');
          const querySnapshot = await getDocs(collection(db, 'tenants', tenantId, 'job_postings'));
          return querySnapshot.docs.map(doc => {
            const data = doc.data();
            return Object.assign({ id: doc.id }, data || {}) as JobsBoardPost;
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error getting all posts:', error);
      throw error;
    }
  }
}
