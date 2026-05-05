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

/** Lowercase trim for comparing job order workflow status (open, cancelled, on_hold, …). */
export function normalizeJobOrderStatusValue(status: unknown): string {
  return String(status ?? '').trim().toLowerCase();
}

/** Only an Open job order may keep linked board postings live on the public jobs board. */
export function isJobOrderBoardLiveStatus(status: unknown): boolean {
  return normalizeJobOrderStatusValue(status) === 'open';
}

/**
 * Drop top-level keys whose value is `undefined` from a plain object.
 *
 * The Firestore Web SDK rejects `updateDoc()` payloads that contain explicit
 * `undefined` values unless the instance was created with
 * `ignoreUndefinedProperties: true`. We DO set that flag in `firebase.ts`, but
 * relying on it is fragile — e.g. CRA Fast-Refresh can occasionally drop us
 * into the `getFirestore(app)` fallback path where the flag isn't honored,
 * which is what produces "Unsupported field value: undefined" surfacing
 * during shift-edit sync to job postings.
 *
 * Strip explicitly so the shape is correct regardless of the runtime's
 * forgiveness setting. Returns the same nominal type because `T` doesn't
 * track which keys are present at runtime — TS optional-undefined and
 * "missing key" are interchangeable for downstream consumers.
 */
function omitUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Coerce Firestore / legacy values to string[] for multi-select job post fields (handles nested arrays from bad merges). */
export const coerceStringArrayField = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    if (value.length === 1 && Array.isArray(value[0])) {
      return coerceStringArrayField(value[0]);
    }
    return value
      .map((item) =>
        typeof item === 'string' ? item : typeof item === 'number' ? String(item) : ''
      )
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? [t] : [];
  }
  return [];
};

const JOB_POST_STRING_ARRAY_FIELD_KEYS = [
  'skills',
  'licensesCerts',
  'experienceLevels',
  'educationLevels',
  'languages',
  'physicalRequirements',
  'uniformRequirements',
  'requiredPpe',
  'backgroundCheckPackages',
  'drugScreeningPanels',
  'additionalScreenings',
  'shift',
  'restrictedGroups',
  'autoAddToUserGroups',
  'requirements',
  'screeningPackageServiceNames',
] as const;

/** Normalize raw Firestore document data into consistent shapes for the Jobs Board UI. */
export const normalizeJobsBoardPostRecord = (id: string, data: Record<string, unknown>): JobsBoardPost => {
  const out: Record<string, unknown> = { ...data, id };
  for (const key of JOB_POST_STRING_ARRAY_FIELD_KEYS) {
    out[key] = coerceStringArrayField(out[key]);
  }
  const cu = out.customUniformRequirements;
  out.customUniformRequirements = typeof cu === 'string' ? cu : cu != null ? String(cu) : '';
  // Coerce payRate from string/legacy types so public UI gets a proper number (decimals preserved).
  if (out.payRate !== undefined && out.payRate !== null) {
    const raw = out.payRate;
    if (typeof raw === 'string') {
      const n = parseFloat(raw.trim());
      out.payRate = Number.isFinite(n) ? n : null;
    } else if (typeof raw === 'number' && !Number.isFinite(raw)) {
      out.payRate = null;
    }
  }
  const spId = out.screeningPackageId;
  out.screeningPackageId =
    spId == null || spId === '' ? '' : typeof spId === 'string' ? spId.trim() : String(spId).trim();
  const spName = out.screeningPackageName;
  out.screeningPackageName =
    spName == null || spName === ''
      ? ''
      : typeof spName === 'string'
        ? spName.trim()
        : String(spName).trim();
  out.showScreeningPackageOnPost = Boolean(out.showScreeningPackageOnPost);
  return out as unknown as JobsBoardPost;
};

/** Fields that must not be sent back from the job post form (would overwrite server counters / metadata). */
const READ_ONLY_JOB_POST_UPDATE_KEYS = new Set([
  'id',
  'jobPostId',
  'tenantId',
  'createdBy',
  'createdAt',
  'applicationCount',
  'updatedAt',
]);

export const stripReadOnlyJobPostFields = <T extends Record<string, unknown>>(payload: T): Partial<T> => {
  const out = { ...payload } as Record<string, unknown>;
  READ_ONLY_JOB_POST_UPDATE_KEYS.forEach((k) => {
    delete out[k];
  });
  return out as Partial<T>;
};

/** Remove undefined values from object (deep). Firestore rejects undefined at any level. */
const removeUndefinedValues = (obj: any): any => {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedValues(item)).filter((item) => item !== undefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        const cleanedValue = removeUndefinedValues(value);
        if (cleanedValue !== undefined) {
          cleaned[key] = cleanedValue;
        }
      }
    }
    return cleaned;
  }
  return obj;
};

/** Optional i18n for worker-facing shift fields (EN/ES) */
export interface ShiftFieldI18n {
  en?: string;
  es?: string;
}

// Shift representation for job board (for Gig jobs)
export interface JobBoardShift {
  shiftId: string; // Reference to shifts/{shiftId} in Firestore
  shiftTitle: string; // "Wednesday Cleaners"
  shiftDate: string; // ISO date string "2025-10-28" (start date for multi-day)
  endDate?: string; // ISO date string (only for multi-day)
  shiftMode?: 'single' | 'multi';
  /**
   * Optional weekly schedule for multi-day shifts (Career).
   * Keys are JS day-of-week numbers as strings: 0=Sun ... 6=Sat
   */
  weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
  /**
   * Per-date schedule for GIG multi-day shifts. Keys are YYYY-MM-DD.
   * When present, worker views show only dates that have start/end times.
   * workersNeeded is per day for GIG (defaults to 1 if not set).
   */
  dateSchedule?: Record<string, { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }>;
  startTime: string; // "08:00" (HH:mm format)
  endTime: string; // "17:30" (HH:mm format)
  staffNeeded: number; // Total positions for this shift
  staffFilled: number; // Currently filled positions (calculated)
  spotsRemaining: number; // staffNeeded - staffFilled (calculated)
  showStaffNeeded?: boolean; // Whether to display staff count on jobs board
  poNumber?: string; // Optional PO number for this shift
  shiftDescription?: string; // Optional shift-specific details
  /** Optional clock-in URL for workers (assignment + messages). */
  clockInUrl?: string;
  defaultJobTitle?: string; // Job title for this shift
  payRate?: number; // Pay rate for this shift's job title (from gigPositions)
  /** When present, UI should use shiftTitle_i18n[lang] ?? shiftTitle for display */
  shiftTitle_i18n?: ShiftFieldI18n;
  shiftDescription_i18n?: ShiftFieldI18n;
  defaultJobTitle_i18n?: ShiftFieldI18n;
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
  jobDescription: string; // Full job description (public posting body)
  /** Standalone posting only: extra instructions for AI / internal context (not the public body). */
  jobDescriptionPrompt?: string;
  /** Standalone posting only: additional AI instructions (e.g. job-order-style notes). */
  jobOrderPrompt?: string;
  /** External job board listings (optional). */
  craigslistUrl?: string;
  indeedUrl?: string;

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
  /**
   * AccuSource screening package for this posting. Used when hiring / auto-hire so onboarding can resolve
   * which package to order (e.g. auto-start background check). Optional override vs defaults
   * (merge order: job post → linked job order → location → account).
   */
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  showScreeningPackageOnPost?: boolean;
  screeningPackageServiceNames?: string[];
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
  /** For Gig job orders: links this post to a specific position (job title) */
  positionJobTitle?: string;
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
  customUniformRequirements?: string; // Custom uniform requirements text
  showCustomUniformRequirements?: boolean; // Whether to show custom uniform requirements on public posting
  requiredPpe?: string[]; // Required PPE
  showRequiredPpe?: boolean; // Whether to show PPE requirements on public posting
  autoAddToUserGroups?: string[]; // Optional: auto-add applicants to these user groups
  autoAddToUserGroup?: string; // Legacy single value support
  
  // Shift Selection Model (for Gig jobs only)
  availableShifts?: JobBoardShift[]; // DEPRECATED - Use dynamic shift loading instead
  includeShiftsInPosting?: boolean; // Whether to show shift selection UI (auto-true for Gig with shifts)
  
  // Dynamic Shift Loading (NEW - for evergreen Gig postings)
  usesDynamicShifts?: boolean; // If true, shifts are loaded dynamically from shifts collection
  shiftFilterDays?: number; // Number of days in future to show shifts (default: 90 for gigs)
  
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
  jobDescriptionPrompt?: string;
  jobOrderPrompt?: string;
  craigslistUrl?: string;
  indeedUrl?: string;

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
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  showScreeningPackageOnPost?: boolean;
  screeningPackageServiceNames?: string[];
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
  /** For Gig job orders: link this post to a specific position (job title) */
  positionJobTitle?: string;
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
  
  // Additional requirement fields
  skills?: string[];
  showSkills?: boolean;
  licensesCerts?: string[];
  showLicensesCerts?: boolean;
  experienceLevels?: string[];
  showExperience?: boolean;
  educationLevels?: string[];
  showEducation?: boolean;
  languages?: string[];
  showLanguages?: boolean;
  physicalRequirements?: string[];
  showPhysicalRequirements?: boolean;
  uniformRequirements?: string[];
  showUniformRequirements?: boolean;
  customUniformRequirements?: string;
  showCustomUniformRequirements?: boolean;
  requiredPpe?: string[];
  showRequiredPpe?: boolean;
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
      // Jobs Board should show:
      // - Open shifts (normal)
      // - Filled shifts (as "Accepting Backups" in UI)
      // It should NOT show closed/cancelled shifts.
      const shifts: JobBoardShift[] = [];
      snapshot.docs.forEach((d) => {
        const data: any = d.data();
        const status = (data.status || 'open').toLowerCase();
        if (status !== 'open' && status !== 'filled') return;

        const defaultJobTitle = data.defaultJobTitle || jobOrderData?.jobTitle;
        const payRate = getPayRateForJobTitle(defaultJobTitle) || jobOrderData?.payRate;

        const startDate = (data.shiftDate || '').toString();
        const endDate = (data.endDate || '').toString();
        const isMulti = data?.shiftMode === 'multi' && !!endDate && endDate !== startDate;

        shifts.push(omitUndefined<JobBoardShift>({
          shiftId: d.id,
          shiftTitle: data.shiftTitle || 'Unnamed Shift',
          shiftDate: startDate, // ISO date string
          endDate: isMulti ? endDate : undefined,
          shiftMode: isMulti ? 'multi' : 'single',
          weeklySchedule: isMulti ? (data.weeklySchedule || undefined) : undefined,
          dateSchedule: isMulti ? (data.dateSchedule || undefined) : undefined,
          startTime: data.defaultStartTime, // HH:mm format
          endTime: data.defaultEndTime, // HH:mm format
          staffNeeded: data.totalStaffRequested || 1,
          staffFilled: 0, // TODO: Calculate from assignments in future phase
          spotsRemaining: data.totalStaffRequested || 1, // TODO: Calculate in future phase
          showStaffNeeded: data.showStaffNeeded || false,
          poNumber: data.poNumber,
          shiftDescription: data.shiftDescription,
          clockInUrl: typeof data.clockInUrl === 'string' ? data.clockInUrl : undefined,
          defaultJobTitle: defaultJobTitle,
          payRate: payRate,
          shiftTitle_i18n: data.shiftTitle_i18n,
          shiftDescription_i18n: data.shiftDescription_i18n,
          defaultJobTitle_i18n: data.defaultJobTitle_i18n,
        }));
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
   * @param filterDays Number of days in future to include (default: 90 for event gigs)
   * @param positionJobTitle When set (Gig per-position posts), only shifts with matching defaultJobTitle
   */
  async fetchActiveShiftsForJobOrder(
    tenantId: string, 
    jobOrderId: string, 
    filterDays = 30,
    positionJobTitle?: string
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

      // Convert and filter shifts (Open + Filled show on Jobs Board; Closed/Cancelled hidden)
      const shiftsRaw: JobBoardShift[] = [];
      snapshot.docs.forEach((d) => {
        const data: any = d.data();
        const status = (data.status || 'open').toLowerCase();
        if (status !== 'open' && status !== 'filled') return;

        const defaultJobTitle = data.defaultJobTitle || jobOrderData?.jobTitle;
        const payRate = getPayRateForJobTitle(defaultJobTitle) || jobOrderData?.payRate;

        const startDate = (data.shiftDate || '').toString();
        const endDate = (data.endDate || '').toString();
        const isMulti = data?.shiftMode === 'multi' && !!endDate && endDate !== startDate;

        shiftsRaw.push(omitUndefined<JobBoardShift>({
          shiftId: d.id,
          shiftTitle: data.shiftTitle || 'Unnamed Shift',
          shiftDate: startDate, // ISO date string
          endDate: isMulti ? endDate : undefined,
          shiftMode: isMulti ? 'multi' : 'single',
          weeklySchedule: isMulti ? (data.weeklySchedule || undefined) : undefined,
          dateSchedule: isMulti ? (data.dateSchedule || undefined) : undefined,
          startTime: data.defaultStartTime, // HH:mm format
          endTime: data.defaultEndTime, // HH:mm format
          staffNeeded: data.totalStaffRequested || 1,
          staffFilled: 0, // TODO: Calculate from assignments
          spotsRemaining: data.totalStaffRequested || 1, // TODO: Calculate
          showStaffNeeded: data.showStaffNeeded || false,
          poNumber: data.poNumber,
          shiftDescription: data.shiftDescription,
          clockInUrl: typeof data.clockInUrl === 'string' ? data.clockInUrl : undefined,
          defaultJobTitle: defaultJobTitle,
          payRate: payRate,
          shiftTitle_i18n: data.shiftTitle_i18n,
          shiftDescription_i18n: data.shiftDescription_i18n,
          defaultJobTitle_i18n: data.defaultJobTitle_i18n,
        }));
      });

      const shifts = shiftsRaw
        // For Gig per-position posts: only include shifts for this position
        .filter((shift) => !positionJobTitle || shift.defaultJobTitle === positionJobTitle)
        // Multi-day aware overlap filter: include if the shift range overlaps [todayISO, cutoffISO]
        .filter((shift) => {
          const start = (shift.shiftDate || '').toString();
          const end = (shift.endDate || shift.shiftDate || '').toString();
          if (!start) return false;
          return end >= todayISO && start <= cutoffISO;
        })
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
      
      // For Gig jobs, check if gigPositions exist and use first position's job title and pay rate (or customData for per-position)
      const gigPositions = (jobOrder as any).gigPositions as Array<{jobTitle: string; payRate: string; workersNeeded?: number}> | undefined;
      const isGigJob = jobType === 'gig';
      const firstPosition = gigPositions && gigPositions.length > 0 ? gigPositions[0] : null;
      const positionJobTitle = customData?.positionJobTitle;
      const positionForTitle = positionJobTitle && gigPositions ? gigPositions.find(p => p.jobTitle === positionJobTitle) : null;

      // Use job title and pay rate from customData (per-position), first position, or job order fields
      const jobTitle = customData?.jobTitle ?? (positionForTitle ? positionForTitle.jobTitle : (isGigJob && firstPosition ? firstPosition.jobTitle : jobOrder.jobTitle));
      const payRate = customData?.payRate !== undefined
        ? customData.payRate
        : (positionForTitle && positionForTitle.payRate
          ? parseFloat(positionForTitle.payRate) || undefined
          : (isGigJob && firstPosition && firstPosition.payRate
            ? parseFloat(firstPosition.payRate) || undefined
            : (jobOrder.showPayRate ? jobOrder.payRate : undefined)));
      // AG.0 — union-merge JO-level auto-group id (when present) with whatever the
      // recruiter passed via customData. Posting-level `autoAddToUserGroups` stays
      // recruiter-managed (they can remove the auto-group), but the auto-group is
      // attached on every fresh post-from-JO so a re-published posting always
      // re-feeds the group with new applicants. The next sync (`syncJobOrderToLinkedPostings`)
      // re-asserts this same merge.
      const joAutoCreatedUserGroupId =
        typeof (jobOrder as { autoCreatedUserGroupId?: string | null }).autoCreatedUserGroupId === 'string'
          ? (jobOrder as { autoCreatedUserGroupId?: string | null }).autoCreatedUserGroupId!.trim()
          : '';
      const customAutoGroups = normalizeAutoAddGroups(
        customData?.autoAddToUserGroups ?? customData?.autoAddToUserGroup
      );
      const autoAddGroups = joAutoCreatedUserGroupId
        ? Array.from(new Set([...customAutoGroups, joAutoCreatedUserGroupId]))
        : customAutoGroups;
      
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
        // nextShiftDate omitted when undefined - Firestore rejects undefined values
        payRate: payRate,
        showPayRate: customData?.showPayRate !== undefined ? customData.showPayRate : jobOrder.showPayRate,
        workersNeeded: customData?.workersNeeded ?? (isGigJob ? 1 : (jobOrder.workersNeeded ?? 1)),
        showWorkersNeeded: customData?.showWorkersNeeded !== undefined ? customData.showWorkersNeeded : false, // Default to false so workers needed is hidden on job board unless explicitly enabled
        eVerifyRequired: customData?.eVerifyRequired !== undefined ? customData.eVerifyRequired : jobOrder.eVerifyRequired,
        screeningPackageId:
          customData?.screeningPackageId !== undefined
            ? String(customData.screeningPackageId ?? '').trim() || null
            : String(jobOrder.screeningPackageId ?? '').trim() || null,
        screeningPackageName:
          customData?.screeningPackageName !== undefined
            ? String(customData.screeningPackageName ?? '').trim() || null
            : String(jobOrder.screeningPackageName ?? '').trim() || null,
        showScreeningPackageOnPost: customData?.showScreeningPackageOnPost ?? false,
        screeningPackageServiceNames: coerceStringArrayField(
          customData?.screeningPackageServiceNames as unknown
        ),
        backgroundCheckPackages: [],
        showBackgroundChecks: false,
        drugScreeningPanels: [],
        showDrugScreening: false,
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
        ...(positionJobTitle ? { positionJobTitle } : {}),
        autoAddToUserGroups: autoAddGroups,
        ...(autoAddGroups.length === 1 ? { autoAddToUserGroup: autoAddGroups[0] } : {}),
        
        // Shift Selection (for Gig jobs - use dynamic loading)
        usesDynamicShifts, // New approach: load shifts at runtime
        shiftFilterDays: 90, // Show shifts for next 90 days (event gigs often post well in advance)
        includeShiftsInPosting: usesDynamicShifts, // Show shift selector if using dynamic shifts
        
        // Requirements & Additional Info
        requirements: customData?.requirements || [
          ...(Array.isArray(jobOrder.requiredLicenses) ? jobOrder.requiredLicenses : []),
          ...(Array.isArray(jobOrder.requiredCertifications) ? jobOrder.requiredCertifications : []),
          ...(jobOrder.drugScreenRequired ? ['Drug Screen Required'] : []),
          ...(jobOrder.backgroundCheckRequired ? ['Background Check Required'] : []),
          ...(jobOrder.experienceRequired ? [jobOrder.experienceRequired] : []),
          ...(jobOrder.educationRequired ? [jobOrder.educationRequired] : []),
          ...(Array.isArray(jobOrder.languagesRequired) ? jobOrder.languagesRequired : []),
          ...(Array.isArray(jobOrder.skillsRequired) ? jobOrder.skillsRequired : [])
        ].filter(Boolean),
        benefits: customData?.benefits,
        shiftTimes: customData?.shiftTimes ?? (Array.isArray(jobOrder.shiftTimes) ? jobOrder.shiftTimes.join(', ') : (typeof jobOrder.shiftTimes === 'string' ? jobOrder.shiftTimes : undefined)),
        showShiftTimes: customData?.showShiftTimes !== undefined ? customData.showShiftTimes : jobOrder.showShiftTimes,
        
        // Metrics
        applicationCount: 0,
        maxApplications: customData?.maxApplications,
        
        // Metadata
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // For Gig jobs with dynamic shifts, fetch and set nextShiftDate (filter by position when per-position post)
      if (usesDynamicShifts && jobOrderId) {
        try {
          const shifts = await this.fetchActiveShiftsForJobOrder(tenantId, jobOrderId, 90, positionJobTitle);
          if (shifts.length > 0) {
            postData.nextShiftDate = new Date(shifts[0].shiftDate);
          }
        } catch (err) {
          console.warn('Could not fetch next shift date:', err);
        }
      }

      const cleanedPostData = removeUndefinedValues(postData);
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'job_postings'), cleanedPostData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating jobs board post:', error);
      throw error;
    }
  }

  /**
   * Create one jobs board post per gig position for a Gig job order.
   * Call when opening Jobs Board tab for a Gig with no existing postings, or when activating all positions.
   */
  async createPostsForGigJobOrderPositions(tenantId: string, jobOrderId: string, createdBy: string): Promise<string[]> {
    const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
    const jobOrderDoc = await getDoc(jobOrderRef);
    if (!jobOrderDoc.exists()) throw new Error('Job Order not found');
    const jobOrder = { id: jobOrderDoc.id, ...jobOrderDoc.data() } as JobOrder;
    const jobType = (jobOrder as any).jobType || 'gig';
    const gigPositions = (jobOrder as any).gigPositions as Array<{ jobTitle: string; payRate: string; workersNeeded?: number }> | undefined;
    if (jobType !== 'gig' || !gigPositions?.length) return [];
    const ids: string[] = [];
    for (const position of gigPositions) {
      const id = await this.createPostFromJobOrder(tenantId, jobOrderId, createdBy, {
        positionJobTitle: position.jobTitle,
        jobTitle: position.jobTitle,
        payRate: position.payRate ? parseFloat(position.payRate) || undefined : undefined,
      });
      ids.push(id);
    }
    return ids;
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
        ...(typeof postData.jobDescriptionPrompt === 'string' && postData.jobDescriptionPrompt.trim()
          ? { jobDescriptionPrompt: postData.jobDescriptionPrompt.trim() }
          : {}),
        ...(typeof postData.craigslistUrl === 'string' && postData.craigslistUrl.trim()
          ? { craigslistUrl: postData.craigslistUrl.trim() }
          : {}),
        ...(typeof postData.indeedUrl === 'string' && postData.indeedUrl.trim()
          ? { indeedUrl: postData.indeedUrl.trim() }
          : {}),

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
        ...(postData.screeningPackageId !== undefined
          ? {
              screeningPackageId: String(postData.screeningPackageId ?? '').trim() || null,
            }
          : {}),
        ...(postData.screeningPackageName !== undefined
          ? {
              screeningPackageName: String(postData.screeningPackageName ?? '').trim() || null,
            }
          : {}),
        showScreeningPackageOnPost: postData.showScreeningPackageOnPost ?? false,
        screeningPackageServiceNames: coerceStringArrayField(postData.screeningPackageServiceNames),
        backgroundCheckPackages: coerceStringArrayField(postData.backgroundCheckPackages),
        showBackgroundChecks: postData.showBackgroundChecks ?? false,
        drugScreeningPanels: coerceStringArrayField(postData.drugScreeningPanels),
        showDrugScreening: postData.showDrugScreening ?? false,
        additionalScreenings: coerceStringArrayField(postData.additionalScreenings),
        showAdditionalScreenings: postData.showAdditionalScreenings ?? false,
        shift: coerceStringArrayField(postData.shift),
        showShift: postData.showShift ?? false,
        ...(postData.startTime && { startTime: postData.startTime }),
        ...(postData.endTime && { endTime: postData.endTime }),
        showStartTime: postData.showStartTime,
        showEndTime: postData.showEndTime,
        
        // Display Settings
        visibility: postData.visibility,
        restrictedGroups: coerceStringArrayField(postData.restrictedGroups),
        
        // Status
        status: postData.status || 'draft',
        ...(postData.status === 'active' && { postedAt: new Date() }),
        ...(expiresAt && { expiresAt }),
        
        // Links
        ...(postData.jobOrderId && { jobOrderId: postData.jobOrderId }),
        ...(postData.positionJobTitle && { positionJobTitle: postData.positionJobTitle }),
        skills: coerceStringArrayField(postData.skills),
        showSkills: postData.showSkills ?? false,
        licensesCerts: coerceStringArrayField(postData.licensesCerts),
        showLicensesCerts: postData.showLicensesCerts ?? false,
        experienceLevels: coerceStringArrayField(postData.experienceLevels),
        showExperience: postData.showExperience ?? false,
        educationLevels: coerceStringArrayField(postData.educationLevels),
        showEducation: postData.showEducation ?? false,
        languages: coerceStringArrayField(postData.languages),
        showLanguages: postData.showLanguages ?? false,
        physicalRequirements: coerceStringArrayField(postData.physicalRequirements),
        showPhysicalRequirements: postData.showPhysicalRequirements ?? false,
        uniformRequirements: coerceStringArrayField(postData.uniformRequirements),
        showUniformRequirements: postData.showUniformRequirements ?? false,
        customUniformRequirements:
          typeof postData.customUniformRequirements === 'string'
            ? postData.customUniformRequirements
            : postData.customUniformRequirements != null
              ? String(postData.customUniformRequirements)
              : '',
        showCustomUniformRequirements: postData.showCustomUniformRequirements ?? false,
        requiredPpe: coerceStringArrayField(postData.requiredPpe),
        showRequiredPpe: postData.showRequiredPpe ?? false,
        ...(autoAddGroups.length ? { autoAddToUserGroups: autoAddGroups } : {}),
        autoAddToUserGroup: autoAddGroups.length === 1 ? autoAddGroups[0] : undefined,
        
        // Requirements & Additional Info
        requirements: coerceStringArrayField(postData.requirements),
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

      // When connecting this post to a job order, backfill jobOrderId on existing applications
      // so they show as job order applicants and any logic that queries by jobOrderId sees them.
      const newJobOrderId = updates.jobOrderId;
      if (newJobOrderId && typeof newJobOrderId === 'string') {
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        const q = query(applicationsRef, where('jobId', '==', postId));
        const snap = await getDocs(q);
        await Promise.all(
          snap.docs.map((d) =>
            updateDoc(d.ref, { jobOrderId: newJobOrderId, updatedAt: new Date() })
          )
        );
        if (snap.docs.length > 0) {
          console.log(`Backfilled jobOrderId on ${snap.docs.length} application(s) for post ${postId}`);
        }
      }
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
        return normalizeJobsBoardPostRecord(postDoc.id, (postDoc.data() || {}) as Record<string, unknown>);
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
      return querySnapshot.docs.map((d) =>
        normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
      );
    } catch (error) {
      console.error('Error getting jobs board posts:', error);
      throw error;
    }
  }

  // Get public jobs board posts (for public job board)
  async getPublicPosts(tenantId: string, userGroups?: string[]): Promise<JobsBoardPost[]> {
    try {
      // First, try to get all posts (without status filter) to see what we have
      let allPostsQuery = query(
        collection(db, 'tenants', tenantId, 'job_postings')
      );
      
      let allPostsSnapshot;
      try {
        // Try ordering by createdAt first
        allPostsQuery = query(
          collection(db, 'tenants', tenantId, 'job_postings'),
          orderBy('createdAt', 'desc')
        );
        allPostsSnapshot = await getDocs(allPostsQuery);
      } catch (error: any) {
        // If createdAt doesn't exist or index is missing, get all without ordering
        if (error.code === 'failed-precondition') {
          console.warn('createdAt field not found or index missing, getting all posts without ordering');
          allPostsQuery = query(collection(db, 'tenants', tenantId, 'job_postings'));
          allPostsSnapshot = await getDocs(allPostsQuery);
        } else {
          console.error('Error fetching all posts:', error);
          throw error;
        }
      }
      
      const allPosts = allPostsSnapshot.docs.map((d) =>
        normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
      );
      
      // Debug: Log all posts to see their status and visibility
      console.log(`📊 Found ${allPosts.length} total job postings for tenant ${tenantId}`);
      const statusCounts: Record<string, number> = {};
      const visibilityCounts: Record<string, number> = {};
      allPosts.forEach(post => {
        statusCounts[post.status || 'undefined'] = (statusCounts[post.status || 'undefined'] || 0) + 1;
        visibilityCounts[post.visibility || 'undefined'] = (visibilityCounts[post.visibility || 'undefined'] || 0) + 1;
      });
      console.log('📊 Status breakdown:', statusCounts);
      console.log('📊 Visibility breakdown:', visibilityCounts);
      
      // Filter for active posts with public or restricted visibility
      const filteredPosts = allPosts.filter(post => {
        const isActive = post.status === 'active';
        const isPublicOrRestricted = post.visibility === 'public' || post.visibility === 'restricted';
        return isActive && isPublicOrRestricted;
      });
      
      console.log(`✅ Filtered to ${filteredPosts.length} active public/restricted posts`);
      
      // Drop active posts whose parent job order is not Open (fixes stale posting docs)
      const jobOrderIdSet = new Set<string>();
      for (const post of filteredPosts) {
        const raw = (post as JobsBoardPost).jobOrderId;
        const jid = typeof raw === 'string' ? raw.trim() : '';
        if (jid) jobOrderIdSet.add(jid);
      }
      const jobOrderIds = Array.from(jobOrderIdSet);
      const jobOrderOpenById = new Map<string, boolean>();
      if (jobOrderIds.length > 0) {
        await Promise.all(
          jobOrderIds.map(async (jid) => {
            try {
              const joRef = doc(db, 'tenants', tenantId, 'job_orders', jid);
              const joSnap = await getDoc(joRef);
              if (!joSnap.exists()) {
                jobOrderOpenById.set(jid, false);
                return;
              }
              jobOrderOpenById.set(jid, isJobOrderBoardLiveStatus((joSnap.data() as Record<string, unknown>)?.status));
            } catch {
              jobOrderOpenById.set(jid, false);
            }
          })
        );
      }
      const filteredByJobOrderStatus = filteredPosts.filter((post) => {
        if (!post.jobOrderId) return true;
        return jobOrderOpenById.get(post.jobOrderId) === true;
      });

      // Filter by group restrictions if user groups are provided
      if (userGroups && userGroups.length > 0) {
        const groupFiltered = filteredByJobOrderStatus.filter(post => {
          if (post.visibility === 'public') return true;
          if (post.visibility === 'restricted' && post.restrictedGroups) {
            return post.restrictedGroups.some(groupId => userGroups.includes(groupId));
          }
          return false;
        });
        console.log(`✅ After group filtering: ${groupFiltered.length} posts`);
        return groupFiltered;
      }
      
      // If no user groups provided, only return public posts
      const publicOnly = filteredByJobOrderStatus.filter(post => post.visibility === 'public');
      console.log(`✅ Public only (no user groups): ${publicOnly.length} posts`);
      return publicOnly;
    } catch (error) {
      console.error('Error getting public jobs board posts:', error);
      throw error;
    }
  }

  // Get posts by job order; optionally filter to the post for a specific position (Gig per-position posts)
  async getPostsByJobOrder(tenantId: string, jobOrderId: string, positionJobTitle?: string): Promise<JobsBoardPost[]> {
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'job_postings'),
        where('jobOrderId', '==', jobOrderId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      let posts = querySnapshot.docs.map((d) =>
        normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
      );
      if (positionJobTitle != null) {
        posts = posts.filter((p) => p.positionJobTitle === positionJobTitle);
      }
      return posts;
    } catch (error) {
      console.error('Error getting posts by job order:', error);
      throw error;
    }
  }

  /**
   * Keep jobs board posting `status` aligned with job order workflow:
   * - Any status other than Open → pause linked postings that are still `active` (idempotent).
   * - Transition to Open → set all linked postings to `active` (legacy behavior when reopening an order).
   */
  async syncLinkedJobPostingsToJobOrderStatus(
    tenantId: string,
    jobOrderId: string,
    newJobOrderStatus: unknown,
    previousJobOrderStatus?: unknown
  ): Promise<void> {
    const newN = normalizeJobOrderStatusValue(newJobOrderStatus);
    const prevN = normalizeJobOrderStatusValue(previousJobOrderStatus);

    const posts = await this.getPostsByJobOrder(tenantId, jobOrderId);
    if (posts.length === 0) return;

    if (newN !== 'open') {
      for (const post of posts) {
        if (post.status === 'active') {
          await this.updatePostStatus(tenantId, post.id, 'paused');
        }
      }
      return;
    }

    if (prevN !== 'open') {
      for (const post of posts) {
        await this.updatePostStatus(tenantId, post.id, 'active');
      }
    }
  }

  /**
   * Admin repair: pause every `active` job posting that references a job order whose status is not Open
   * (including missing job order docs). Standalone posts without `jobOrderId` are left unchanged.
   */
  async repairPauseActivePostsLinkedToNonOpenJobOrders(tenantId: string): Promise<{
    activePostsScanned: number;
    activePostsWithJobOrder: number;
    paused: number;
    errors: string[];
  }> {
    const activeQuery = query(
      collection(db, 'tenants', tenantId, 'job_postings'),
      where('status', '==', 'active')
    );
    const snapshot = await getDocs(activeQuery);
    const posts = snapshot.docs.map((d) =>
      normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
    );

    const withOrder = posts.filter((p) => Boolean(p.jobOrderId && String(p.jobOrderId).trim()));
    const uniqueOrderIds = [...new Set(withOrder.map((p) => p.jobOrderId as string))];

    const statusByOrderId = new Map<string, unknown>();
    await Promise.all(
      uniqueOrderIds.map(async (jobOrderId) => {
        try {
          const joRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
          const joSnap = await getDoc(joRef);
          statusByOrderId.set(jobOrderId, joSnap.exists() ? (joSnap.data() as Record<string, unknown>)?.status : null);
        } catch {
          statusByOrderId.set(jobOrderId, null);
        }
      })
    );

    const errors: string[] = [];
    let paused = 0;

    for (const post of withOrder) {
      const jid = String(post.jobOrderId).trim();
      const raw = statusByOrderId.get(jid);
      if (isJobOrderBoardLiveStatus(raw)) continue;

      try {
        await this.updatePostStatus(tenantId, post.id, 'paused');
        paused += 1;
      } catch (e: any) {
        errors.push(`${post.id}: ${e?.message || String(e)}`);
      }
    }

    return {
      activePostsScanned: posts.length,
      activePostsWithJobOrder: withOrder.length,
      paused,
      errors,
    };
  }

  /**
   * Sync current job order dates and shifts to all linked job postings.
   * Call after updating job order start/end dates or after adding/editing/deleting shifts
   * so the stored posting documents stay in sync (public board also enriches at read time).
   */
  async syncJobOrderToLinkedPostings(tenantId: string, jobOrderId: string): Promise<void> {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);
      if (!jobOrderSnap.exists()) return;

      const jobOrderData = jobOrderSnap.data() as Record<string, unknown>;
      const posts = await this.getPostsByJobOrder(tenantId, jobOrderId);
      if (posts.length === 0) return;

      const startDate = jobOrderData.startDate ?? null;
      const endDate = jobOrderData.endDate ?? null;
      // AG.0 — re-assert the JO's auto-group on every sync so a recruiter who
      // accidentally cleared `autoAddToUserGroups` on the posting gets it back
      // (manual additions are preserved via union-merge below).
      const joAutoGroupId =
        typeof jobOrderData.autoCreatedUserGroupId === 'string'
          ? (jobOrderData.autoCreatedUserGroupId as string).trim()
          : '';

      for (const post of posts) {
        const postRef = doc(db, 'tenants', tenantId, 'job_postings', post.id);
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
          ...(startDate != null && { startDate }),
          ...(endDate != null && { endDate }),
        };
        if (joAutoGroupId) {
          const existingGroups = normalizeAutoAddGroups(
            (post as { autoAddToUserGroups?: string[]; autoAddToUserGroup?: string })
              .autoAddToUserGroups ??
              (post as { autoAddToUserGroup?: string }).autoAddToUserGroup,
          );
          if (!existingGroups.includes(joAutoGroupId)) {
            updateData.autoAddToUserGroups = [...existingGroups, joAutoGroupId];
            // Mirror the legacy single-value field only when it was the sole group;
            // otherwise leave it (the array is the canonical reader anyway).
            if (existingGroups.length === 0) {
              updateData.autoAddToUserGroup = joAutoGroupId;
            }
          }
        }
        await updateDoc(postRef, updateData);
        if (post.jobType === 'gig') {
          await this.syncShiftsToPosting(tenantId, post.id, jobOrderId);
        }
      }
    } catch (error) {
      console.error('Error syncing job order to linked postings:', error);
      // Non-fatal: public board enriches at read time
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
      return querySnapshot.docs.map((d) =>
        normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
      );
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
      return querySnapshot.docs.map((d) =>
        normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
      );
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
        return querySnapshot.docs.map((d) =>
          normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
        );
      } catch (error: any) {
        // If createdAt doesn't exist or there's an index issue, get all docs without ordering
        if (error.code === 'failed-precondition') {
          console.warn('createdAt field not found or index missing, getting all posts without ordering');
          const querySnapshot = await getDocs(collection(db, 'tenants', tenantId, 'job_postings'));
          return querySnapshot.docs.map((d) =>
            normalizeJobsBoardPostRecord(d.id, (d.data() || {}) as Record<string, unknown>)
          );
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
