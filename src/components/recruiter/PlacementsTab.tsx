import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Link,
  TextField,
  Checkbox,
} from '@mui/material';
import {
  Description as ResumeIcon,
  Info as BioIcon,
  Work as WorkHistoryIcon,
  School as CertIcon,
  Badge as LicenseIcon,
  Lock as LockedIcon,
  LockOpen as UnlockedIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  Check as CheckIcon,
  Error as ErrorIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  Email as EmailIcon,
  Sms as SmsIcon,
} from '@mui/icons-material';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { format } from 'date-fns';

import { db, functions } from '../../firebase';
import { getCalendarDayLocal } from '../../utils/dateUtils';
import MessageDrawer, { type MessageRecipient } from '../MessageDrawer';
import { useAuth } from '../../contexts/AuthContext';
import { logAssignmentUpdateActivity } from '../../utils/activityLogger';
import { JobOrder } from '../../types/recruiter/jobOrder';

interface PlacementsTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: JobOrder | null;
  onJobOrderUpdated?: () => void;
}

interface Shift {
  id: string;
  shiftDate: string;
  startTime?: string;
  endTime?: string;
  shiftTitle?: string;
  spotsRemaining?: number;
  staffNeeded?: number;
}

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  displayName?: string;
  city?: string;
  state?: string;
  workEligibility?: boolean;
  resumeUrl?: string;
  resume?: {
    storagePath?: string;
    downloadUrl?: string;
    fileName?: string;
  };
  skills?: string[];
  languages?: string[];
  bio?: string;
  workHistory?: any[];
  employmentHistory?: any[];
  certifications?: any[];
  licenses?: any[];
  aiProfileScore?: number;
  aiJobFitScore?: number;
  isAssignedToShift?: boolean; // In Assignments column (placed or assigned)
  isPlacementOnly?: boolean;   // Placed but not yet offered - no Assignment, no messages
  assignmentStatus?: string;
  assignmentId?: string;
  confirmationStatus?: 'accepted' | 'confirmed'; // Track confirmation status
  /** Assignment start date (YYYY-MM-DD); when set, shown on tile instead of city/state */
  assignmentStartDate?: string;
  assignmentEndDate?: string;
  /** When the offer (or last reminder) was sent; ms since epoch for display */
  assignmentOfferSentAt?: number;
  /** When status is confirmed, ms when the worker confirmed (accepted) the assignment */
  assignmentConfirmedAt?: number;
}

const WORKER_DRAG_MIME = 'application/x-hrx-worker-id';

const PlacementsTab: React.FC<PlacementsTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  onJobOrderUpdated,
}) => {
  // Only present in hrx-god-view workspace build (Assign All + Export + Preview Email)
  if (typeof console !== 'undefined' && console.log) {
    console.log('[PlacementsTab] Loaded WITH Preview Email button (run from /Users/gregfielding/hrx-god-view)');
  }
  const { user } = useAuth();
  // Generate a unique storage key for this job order
  const storageKey = `placements_filters_${tenantId}_${jobOrderId}`;
  
  // Helper to load persisted filters from localStorage
  const loadPersistedFilters = (): { shiftId: string; workforce: string } => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          shiftId: parsed.shiftId || '',
          workforce: parsed.workforce || 'applicants',
        };
      }
    } catch (err) {
      console.error('Error loading persisted filters:', err);
    }
    // Default values: Applicants as default workforce
    return { shiftId: '', workforce: 'applicants' };
  };

  // Load initial state from localStorage
  const persistedFilters = loadPersistedFilters();
  
  // Filter state (removed date picker - will show all upcoming shifts)
  const [selectedShiftId, setSelectedShiftId] = useState<string>(persistedFilters.shiftId);
  const [selectedWorkforce, setSelectedWorkforce] = useState<string>(persistedFilters.workforce);
  
  // Data state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [isAssignmentDragOver, setIsAssignmentDragOver] = useState(false);
  const [isWorkerPoolDragOver, setIsWorkerPoolDragOver] = useState(false);
  const [assignmentStatusByUserId, setAssignmentStatusByUserId] = useState<Map<string, string>>(new Map());
  const [assignmentStartDateByUserId, setAssignmentStartDateByUserId] = useState<Map<string, string>>(new Map());
  const [assignmentOfferSentAtByUserId, setAssignmentOfferSentAtByUserId] = useState<Map<string, number>>(new Map());
  const [assignmentConfirmedAtByUserId, setAssignmentConfirmedAtByUserId] = useState<Map<string, number>>(new Map());
  const [placementUserIds, setPlacementUserIds] = useState<Set<string>>(new Set());
  const [userGroups, setUserGroups] = useState<Array<{ id: string; groupName: string }>>([]);
  const [confirmedApplicationsCount, setConfirmedApplicationsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendLoadingAssignmentId, setResendLoadingAssignmentId] = useState<string | null>(null);
  const [resendCooldownUntilByAssignmentId, setResendCooldownUntilByAssignmentId] = useState<Record<string, number>>({});
  const [confirmingPlacementUserId, setConfirmingPlacementUserId] = useState<string | null>(null);
  const [cancelAssignmentWorker, setCancelAssignmentWorker] = useState<Worker | null>(null);
  const [previewEmailOpen, setPreviewEmailOpen] = useState(false);
  const [previewEmailSubject, setPreviewEmailSubject] = useState<string>('');
  const [previewEmailHtml, setPreviewEmailHtml] = useState<string>('');
  const [previewEmailLoading, setPreviewEmailLoading] = useState(false);
  const [previewEmailError, setPreviewEmailError] = useState<string | null>(null);

  // Helper function to extract full profile data from user document
  const extractWorkerData = (userData: any, userId: string): Worker => {
    // Extract city/state from various possible locations
    const city = userData.city || 
                userData.addressInfo?.city || 
                userData.address?.city || 
                '';
    const state = userData.state || 
                userData.addressInfo?.state || 
                userData.address?.state || 
                '';
    
    // Extract resume URL (could be in multiple places)
    const resumeUrl = userData.resumeUrl || 
                     userData.resume?.downloadUrl || 
                     '';
    const resume = userData.resume || null;
    
    // Extract skills and languages (ensure arrays)
    const skills = Array.isArray(userData.skills) ? userData.skills : [];
    const languages = Array.isArray(userData.languages) ? userData.languages : [];
    
    // Extract bio (could be from parsed resume or direct field)
    const bio = userData.bio || 
               userData.parsedResume?.parsedData?.bio || 
               '';
    
    // Extract work history
    const workHistory = userData.workHistory || 
                       userData.employmentHistory || 
                       userData.parsedResume?.parsedData?.experience || 
                       [];
    
    // Extract certifications and licenses
    const certifications = Array.isArray(userData.certifications) ? userData.certifications : [];
    const licenses = Array.isArray(userData.licenses) ? userData.licenses : [];
    
    // Extract AI scores
    const aiProfileScore = userData.aiProfileScore || 
                          userData.parsedResume?.parsedData?.aiAnalysis?.overallScore || 
                          undefined;
    const aiJobFitScore = userData.aiJobFitScore || undefined;
    
    return {
      id: userId,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      email: userData.email,
      phone: userData.phone,
      displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      city,
      state,
      workEligibility: userData.workEligibility !== false, // Default to true if not explicitly false
      resumeUrl,
      resume,
      skills,
      languages,
      bio,
      workHistory,
      employmentHistory: userData.employmentHistory || [],
      certifications,
      licenses,
      aiProfileScore,
      aiJobFitScore,
    };
  };

  // State for modals
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [selectedResume, setSelectedResume] = useState<{ url: string; fileName?: string } | null>(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [selectedCerts, setSelectedCerts] = useState<any[]>([]);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [selectedLicenses, setSelectedLicenses] = useState<any[]>([]);
  const [assignmentIdByUserId, setAssignmentIdByUserId] = useState<Map<string, string>>(new Map());
  // Assignments column: workers placed/assigned/confirmed/declined for this shift (from Firestore only, not filtered by Workforce)
  const [assignmentWorkersList, setAssignmentWorkersList] = useState<Worker[]>([]);
  const lastAssignmentShiftIdRef = useRef<string | null>(null); // clear list only when shift changes, not when workforce changes
  // Track optimistically added placement IDs so onSnapshot doesn't overwrite them before Firestore confirms
  const pendingPlacementAddsRef = useRef<Set<string>>(new Set());
  // Track optimistically cancelled assignments so UI updates immediately before Firestore propagates
  const [pendingAssignmentCancels, setPendingAssignmentCancels] = useState<Set<string>>(new Set());

  // Load user groups for workforce dropdown
  useEffect(() => {
    const loadUserGroups = async () => {
      if (!tenantId) return;
      
      try {
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const groupsSnap = await getDocs(groupsRef);
        const groups = groupsSnap.docs.map(doc => {
          const d = doc.data();
          const groupName = d.groupName || d.name || d.title || doc.id;
          return { id: doc.id, groupName };
        });
        setUserGroups(groups);
      } catch (err) {
        console.error('Error loading user groups:', err);
      }
    };
    
    loadUserGroups();
  }, [tenantId]);

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shiftId: selectedShiftId,
        workforce: selectedWorkforce,
      }));
    } catch (err) {
      console.error('Error saving filters to localStorage:', err);
    }
  }, [selectedShiftId, selectedWorkforce, storageKey]);

  // Load confirmed applications count for selected shift
  useEffect(() => {
    const loadConfirmedApplications = async () => {
      if (!tenantId || !selectedShiftId) {
        setConfirmedApplicationsCount(0);
        return;
      }

      try {
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        // Query applications for this shift with status 'confirmed' (worker has confirmed)
        // Applications can have either shiftId (single) or shiftIds (array)
        const q1 = query(
          applicationsRef,
          where('shiftId', '==', selectedShiftId),
          where('status', '==', 'confirmed')
        );
        const q2 = query(
          applicationsRef,
          where('shiftIds', 'array-contains', selectedShiftId),
          where('status', '==', 'confirmed')
        );
        
        const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        // Count unique applications that match this shift and are confirmed
        const uniqueAppIds = new Set<string>();
        snapshot1.docs.forEach(doc => uniqueAppIds.add(doc.id));
        snapshot2.docs.forEach(doc => {
          const data = doc.data();
          if (Array.isArray(data.shiftIds) && data.shiftIds.includes(selectedShiftId)) {
            uniqueAppIds.add(doc.id);
          }
        });
        
        setConfirmedApplicationsCount(uniqueAppIds.size);
      } catch (err: any) {
        console.error('Error loading confirmed applications:', err);
        // Don't show error, just set to 0
        setConfirmedApplicationsCount(0);
      }
    };

    loadConfirmedApplications();
  }, [tenantId, selectedShiftId]);

  // Load all upcoming shifts (from today forward)
  useEffect(() => {
    const loadShifts = async () => {
      if (!tenantId || !jobOrderId) {
        setShifts([]);
        setSelectedShiftId('');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // Today's date in recruiter's local timezone (YYYY-MM-DD) for consistent "from today" filter
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        // Load job order to get pay rate information (using canonical path)
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderSnap = await getDoc(jobOrderRef);
        const jobOrderData = jobOrderSnap.exists() ? jobOrderSnap.data() : null;
        const gigPositions = (jobOrderData as any)?.gigPositions as Array<{jobTitle: string; payRate: string | number}> | undefined;
        const defaultPayRate = jobOrderData?.payRate as number | undefined;
        
        // Helper to get pay rate for a shift
        const getPayRateForShift = (shift: any): number | undefined => {
          // First, check if shift already has payRate
          if (shift.payRate !== undefined && shift.payRate !== null) {
            const rate = typeof shift.payRate === 'number' ? shift.payRate : parseFloat(String(shift.payRate));
            return isNaN(rate) ? undefined : rate;
          }
          
          // If shift has defaultJobTitle, look it up in gigPositions
          if (shift.defaultJobTitle && gigPositions) {
            const position = gigPositions.find(p => p.jobTitle === shift.defaultJobTitle);
            if (position && position.payRate) {
              const rate = typeof position.payRate === 'number' ? position.payRate : parseFloat(String(position.payRate));
              return isNaN(rate) ? undefined : rate;
            }
          }
          
          // Fall back to job order's default pay rate
          return defaultPayRate;
        };
        
        // Query all shifts for this job order
        // For gig jobs, shifts are in tenants/{tenantId}/job_orders/{jobOrderId}/shifts
        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
        const [shiftsSnap, assignmentsSnap, placementsSnap] = await Promise.all([
          getDocs(shiftsRef),
          getDocs(query(collection(db, 'tenants', tenantId, 'assignments'), where('jobOrderId', '==', jobOrderId))),
          getDocs(query(collection(db, 'tenants', tenantId, 'placements'), where('jobOrderId', '==', jobOrderId))),
        ]);
        
        // Collect shiftIds that have placements or assignments (active shifts — show even if date is past)
        const activeShiftIds = new Set<string>();
        assignmentsSnap.docs.forEach((d) => {
          const sid = (d.data() as { shiftId?: string })?.shiftId;
          if (sid) activeShiftIds.add(sid);
        });
        placementsSnap.docs.forEach((d) => {
          const sid = (d.data() as { shiftId?: string })?.shiftId;
          if (sid) activeShiftIds.add(sid);
        });
        
        // Filter shifts from today forward and enrich with pay rate
        const allShifts = shiftsSnap.docs.map(doc => {
          const shiftData: any = {
            id: doc.id,
            ...doc.data()
          } as Shift;
          
          // Enrich shift with pay rate if not present
          if (!shiftData.payRate) {
            const payRate = getPayRateForShift(shiftData);
            if (payRate !== undefined) {
              shiftData.payRate = payRate;
            }
          }
          
          return shiftData;
        });
        
        // Filter: include shifts from today forward OR shifts that have placements/assignments (active).
        // Use local-timezone calendar day so "today" and shift dates are consistent.
        const upcomingShifts = allShifts.filter(shift => {
          const isActive = activeShiftIds.has(shift.id);
          if (isActive) return true; // Always show shifts with placements or assignments
          const shiftDateStr = getCalendarDayLocal(shift.shiftDate);
          if (!shiftDateStr) return false;
          return shiftDateStr >= todayStr;
        }).sort((a, b) => {
          const dateA = getCalendarDayLocal(a.shiftDate);
          const dateB = getCalendarDayLocal(b.shiftDate);
          return dateA.localeCompare(dateB);
        });
        
        setShifts(upcomingShifts);
        
        // Reset selected shift if it's not in the new list
        if (selectedShiftId && !upcomingShifts.find(s => s.id === selectedShiftId)) {
          setSelectedShiftId('');
        }
      } catch (err: any) {
        console.error('Error loading shifts:', err);
        setError(err.message || 'Failed to load shifts');
      } finally {
        setLoading(false);
      }
    };

    loadShifts();
  }, [tenantId, jobOrderId, selectedShiftId]);

  // Load workforce based on selected option
  useEffect(() => {
    const loadWorkforce = async () => {
      if (!tenantId || !jobOrderId || !selectedWorkforce) {
        setWorkers([]);
        return;
      }
      if (selectedWorkforce === 'choose_group') {
        setWorkers([]);
        setLoading(false);
        return;
      }

      const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
      const isGig = jobType === 'gig';
      // Normalize legacy persisted values for Gig: applicants -> shift_applicants, candidates -> shift_candidates
      const workforce =
        isGig && selectedWorkforce === 'applicants'
          ? 'shift_applicants'
          : isGig && selectedWorkforce === 'candidates'
            ? 'shift_candidates'
            : selectedWorkforce;

      setLoading(true);
      setError(null);
      try {
        let workforceUsers: Worker[] = [];

        const isCareerJob = jobType === 'career';
        const hasShiftMetadata = (applicationData: any) =>
          Boolean(
            applicationData?.shiftId ||
              (Array.isArray(applicationData?.shiftIds) && applicationData.shiftIds.length > 0) ||
              (Array.isArray(applicationData?.selectedShifts) && applicationData.selectedShifts.length > 0),
          );

        const matchesSelectedShift = (applicationData: any) =>
          applicationData.shiftId === selectedShiftId ||
          (Array.isArray(applicationData.shiftIds) && applicationData.shiftIds.includes(selectedShiftId)) ||
          (Array.isArray(applicationData.selectedShifts) &&
            applicationData.selectedShifts.some((s: any) => s.shiftId === selectedShiftId || s.id === selectedShiftId));

        const loadApplicationDocs = async (): Promise<Array<{ id: string; data: any }>> => {
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const byOrderSnap = await getDocs(
            query(applicationsRef, where('jobOrderId', '==', jobOrderId)),
          );
          let docs = byOrderSnap.docs;

          // Phase 2 / career: applications nested under job order
          if (docs.length === 0) {
            const nestedRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'applications');
            const nestedSnap = await getDocs(nestedRef);
            docs = nestedSnap.docs;
          }

          if (docs.length === 0) {
            const jobPostingsSnap = await getDocs(
              query(collection(db, 'tenants', tenantId, 'job_postings'), where('jobOrderId', '==', jobOrderId)),
            );
            const jobPostIds = jobPostingsSnap.docs.map((d) => d.id).filter(Boolean).slice(0, 10);

            if (jobPostIds.length > 0) {
              const byJobIdSnap = await getDocs(
                query(applicationsRef, where('jobId', 'in', jobPostIds)),
              );
              docs = byJobIdSnap.docs;

              if (docs.length === 0) {
                const byPostIdSnap = await getDocs(
                  query(applicationsRef, where('postId', 'in', jobPostIds)),
                );
                docs = byPostIdSnap.docs;
              }
            }
          }

          return docs.map((d) => ({ id: d.id, data: d.data() }));
        };

        // Career applicants are not shift-specific: show all in the labor pool regardless of selected shift.
        // Gig applicants are shift-specific: filter by selected shift when using shift_applicants / shift_candidates.
        const includeApplicantByShift = (data: any) => {
          if (isCareerJob) return true;
          const hasShift = matchesSelectedShift(data);
          const allowWithoutShift = !hasShiftMetadata(data);
          return hasShift || allowWithoutShift;
        };

        if (workforce === 'all_applicants' || workforce === 'shift_applicants') {
          const applicationDocs = await loadApplicationDocs();
          const userIds = new Set<string>();
          const filterByShift = workforce === 'shift_applicants';
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            if (data.candidate === true) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            if (filterByShift && !includeApplicantByShift(data)) return;
            userIds.add(data.userId);
          });
          const userPromises = Array.from(userIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return extractWorkerData(userSnap.data(), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'all_candidates' || workforce === 'shift_candidates') {
          const applicationDocs = await loadApplicationDocs();
          const candidateUserIds = new Set<string>();
          const filterByShift = workforce === 'shift_candidates';
          applicationDocs.forEach(({ data }) => {
            if (!data.userId || data.candidate !== true) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            if (filterByShift && !includeApplicantByShift(data)) return;
            candidateUserIds.add(data.userId);
          });
          const userPromises = Array.from(candidateUserIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return extractWorkerData(userSnap.data(), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'applicants') {
          // Non-Gig: applicants for this job order and selected shift
          const applicationDocs = await loadApplicationDocs();
          const userIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            if (data.candidate === true) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            if (!includeApplicantByShift(data)) return;
            userIds.add(data.userId);
          });
          const userPromises = Array.from(userIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return extractWorkerData(userSnap.data(), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'candidates') {
          const applicationDocs = await loadApplicationDocs();
          const candidateUserIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId || data.candidate !== true) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            if (!includeApplicantByShift(data)) return;
            candidateUserIds.add(data.userId);
          });
          const userPromises = Array.from(candidateUserIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return extractWorkerData(userSnap.data(), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (selectedWorkforce.startsWith('group_')) {
          // Load users from selected group
          const groupId = selectedWorkforce.replace('group_', '');
          const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
          const groupSnap = await getDoc(groupRef);
          
          if (groupSnap.exists()) {
            const groupData = groupSnap.data();
            const memberIds = groupData.memberIds || groupData.members || [];
            
            // Load user documents with full profile data
            const userPromises = memberIds.map(async (userId: string): Promise<Worker | null> => {
              const userRef = doc(db, 'users', userId);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                return extractWorkerData(userSnap.data(), userId);
              }
              return null;
            });
            
            const users = await Promise.all(userPromises);
            workforceUsers = users.filter((u): u is Worker => u !== null);
          }
        }
        
        // Assignment status is now applied from real-time shift listener below.
        setWorkers(workforceUsers);
      } catch (err: any) {
        console.error('Error loading workforce:', err);
        setError(err.message || 'Failed to load workforce');
      } finally {
        setLoading(false);
      }
    };

    loadWorkforce();
  }, [tenantId, jobOrderId, selectedWorkforce, selectedShiftId, jobOrder]);

  // Real-time assignment status map for the selected shift.
  useEffect(() => {
    if (!tenantId || !selectedShiftId) {
      setAssignmentStatusByUserId(new Map());
      setAssignmentIdByUserId(new Map());
      setAssignmentStartDateByUserId(new Map());
      setAssignmentOfferSentAtByUserId(new Map());
      setAssignmentConfirmedAtByUserId(new Map());
      return;
    }

    const toMs = (v: unknown): number | undefined => {
      if (v == null) return undefined;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
      if (typeof v === 'object' && typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().getTime();
      if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; }
      return undefined;
    };

    const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
    const assignmentsQuery = query(assignmentsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      assignmentsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextStatus = new Map<string, string>();
        const nextIds = new Map<string, string>();
        const nextStartDates = new Map<string, string>();
        const nextOfferSentAt = new Map<string, number>();
        const nextConfirmedAt = new Map<string, number>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || data?.candidateId || '');
          const status = String(data?.status || 'proposed').toLowerCase();
          if (!userId) return;
          nextStatus.set(userId, status);
          nextIds.set(userId, docSnap.id);
          const startDate = data?.startDate;
          if (typeof startDate === 'string' && startDate) nextStartDates.set(userId, startDate.split('T')[0]);
          else if (startDate?.toDate) nextStartDates.set(userId, startDate.toDate().toISOString().split('T')[0]);
          const reminderMs = toMs(data?.lastReminderSentAt);
          const assignedMs = toMs(data?.assignedAt);
          const offerSentMs = reminderMs ?? assignedMs;
          if (offerSentMs != null) nextOfferSentAt.set(userId, offerSentMs);
          const confirmedMs = toMs(data?.confirmedAt);
          if (confirmedMs != null) nextConfirmedAt.set(userId, confirmedMs);
        });
        setAssignmentStatusByUserId(nextStatus);
        setAssignmentIdByUserId(nextIds);
        setAssignmentStartDateByUserId(nextStartDates);
        setAssignmentOfferSentAtByUserId(nextOfferSentAt);
        setAssignmentConfirmedAtByUserId(nextConfirmedAt);
      },
      (err) => {
        console.warn('Assignments onSnapshot error:', err);
      },
    );

    return () => unsubscribe();
  }, [tenantId, selectedShiftId]);

  // Real-time placements (placed but not yet assigned - no Assignment created, no messages sent).
  useEffect(() => {
    if (!tenantId || !selectedShiftId) {
      setPlacementUserIds(new Set());
      return;
    }

    const placementsRef = collection(db, 'tenants', tenantId, 'placements');
    const placementsQuery = query(placementsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      placementsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const ids = new Set<string>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || '');
          if (userId) {
            ids.add(userId);
            pendingPlacementAddsRef.current.delete(userId); // Confirmed by server
          }
        });
        // Merge in optimistically added IDs so we don't overwrite with stale snapshot (race with local write)
        pendingPlacementAddsRef.current.forEach((id) => ids.add(id));
        setPlacementUserIds(ids);
        // Clear pending cancels for workers now confirmed as placed by server
        setPendingAssignmentCancels((prev) => {
          if (prev.size === 0) return prev;
          const stillPending = new Set(prev);
          ids.forEach((id) => stillPending.delete(id));
          return stillPending.size === prev.size ? prev : stillPending;
        });
      },
      (err) => {
        console.warn('Placements onSnapshot error:', err);
      },
    );

    return () => unsubscribe();
  }, [tenantId, selectedShiftId]);

  // Assignments column shows all workers for this shift (placements + assignments), independent of Workforce selection
  const assignedUserIds = useMemo(() => {
    const ids = new Set<string>(placementUserIds);
    assignmentStatusByUserId.forEach((_, uid) => ids.add(uid));
    pendingAssignmentCancels.forEach((uid) => ids.add(uid));
    return ids;
  }, [placementUserIds, assignmentStatusByUserId, pendingAssignmentCancels]);

  // Load user docs for everyone in Assignments; clear list only when *shift* changes, not when workforce changes
  useEffect(() => {
    if (!selectedShiftId) {
      setAssignmentWorkersList([]);
      lastAssignmentShiftIdRef.current = null;
      return;
    }
    if (lastAssignmentShiftIdRef.current !== selectedShiftId) {
      setAssignmentWorkersList([]);
      lastAssignmentShiftIdRef.current = selectedShiftId;
    }
    if (assignedUserIds.size === 0) {
      return; // Keep current list when workforce changes; only refresh when we have ids for this shift
    }
    let cancelled = false;
    const load = async () => {
      const userIds = Array.from(assignedUserIds);
      const userPromises = userIds.map(async (userId): Promise<Worker | null> => {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists() || cancelled) return null;
        const base = extractWorkerData(userSnap.data(), userId);
        const isPendingCancel = pendingAssignmentCancels.has(userId);
        const assignmentStatus = isPendingCancel ? undefined : assignmentStatusByUserId.get(userId);
        const hasPlacement = placementUserIds.has(userId);
        const hasAssignment = Boolean(assignmentStatus);
        const isPlacementOnly = hasPlacement && !hasAssignment;
        const confirmationStatus: 'accepted' | 'confirmed' | undefined =
          assignmentStatus && (assignmentStatus === 'confirmed' || assignmentStatus === 'active')
            ? 'confirmed'
            : assignmentStatus
              ? 'accepted'
              : undefined;
        return {
          ...base,
          isAssignedToShift: true,
          isPlacementOnly,
          assignmentStatus,
          assignmentId: assignmentIdByUserId.get(userId),
          confirmationStatus,
          assignmentStartDate: assignmentStartDateByUserId.get(userId),
          assignmentOfferSentAt: assignmentOfferSentAtByUserId.get(userId),
          assignmentConfirmedAt: assignmentConfirmedAtByUserId.get(userId),
        };
      });
      const list = await Promise.all(userPromises);
      if (cancelled) return;
      const valid = list.filter((w): w is Worker => w !== null);
      const statusRank = (w: Worker) =>
        w.confirmationStatus === 'confirmed' ? 2 : w.assignmentStatus ? 1 : 0;
      valid.sort((a, b) => {
        const aPlace = a.isPlacementOnly ? 0 : 1;
        const bPlace = b.isPlacementOnly ? 0 : 1;
        if (aPlace !== bPlace) return aPlace - bPlace;
        return statusRank(b) - statusRank(a);
      });
      setAssignmentWorkersList(valid);
      lastAssignmentShiftIdRef.current = selectedShiftId;
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedShiftId, assignedUserIds, placementUserIds, assignmentStatusByUserId, assignmentIdByUserId, assignmentStartDateByUserId, assignmentOfferSentAtByUserId, assignmentConfirmedAtByUserId, pendingAssignmentCancels]);

  const workforceOptions = useMemo(() => getWorkforceOptions(), [jobOrder, userGroups]);
  const safeSelectedShiftId = shifts.some((s) => s.id === selectedShiftId) ? selectedShiftId : '';
  // For Gig, map legacy persisted 'applicants'/'candidates' to shift_applicants/shift_candidates
  const normalizedWorkforce =
    String((jobOrder as any)?.jobType || '').toLowerCase() === 'gig' && selectedWorkforce === 'applicants'
      ? 'shift_applicants'
      : String((jobOrder as any)?.jobType || '').toLowerCase() === 'gig' && selectedWorkforce === 'candidates'
        ? 'shift_candidates'
        : selectedWorkforce;
  const safeSelectedWorkforce = workforceOptions.some((o) => o.value === normalizedWorkforce) ? normalizedWorkforce : (workforceOptions[0]?.value ?? '');

  // When workforce options change (e.g. job is Gig), sync selection if current value is no longer valid
  useEffect(() => {
    const valid = workforceOptions.some((o) => o.value === selectedWorkforce);
    if (!valid && workforceOptions.length > 0 && selectedWorkforce !== 'choose_group') {
      setSelectedWorkforce(workforceOptions[0].value);
    }
  }, [workforceOptions, selectedWorkforce]);

  const handleRemoveGroupFromWorkforce = async (groupValue: string) => {
    if (!groupValue.startsWith('group_') || !tenantId || !jobOrderId) return;
    const groupId = groupValue.replace('group_', '');
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const job = jobOrder as any;
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (job?.placementsLastGroup?.id === groupId) {
        updates.placementsLastGroup = null;
      }
      const laborPoolGroups = Array.isArray(job?.laborPoolGroups) ? job.laborPoolGroups.filter((id: string) => id !== groupId) : [];
      const restrictedGroups = Array.isArray(job?.restrictedGroups) ? job.restrictedGroups.filter((id: string) => id !== groupId) : [];
      if (laborPoolGroups.length !== (job?.laborPoolGroups?.length ?? 0)) updates.laborPoolGroups = laborPoolGroups;
      if (restrictedGroups.length !== (job?.restrictedGroups?.length ?? 0)) updates.restrictedGroups = restrictedGroups;
      await updateDoc(jobOrderRef, updates);
      if (selectedWorkforce === groupValue) setSelectedWorkforce('choose_group');
      onJobOrderUpdated?.();
    } catch (err) {
      console.error('Error removing group from workforce:', err);
      setError((err as Error)?.message ?? 'Failed to remove group');
    }
  };

  // Build workforce options. For Gigs: All Applicants, All Candidates, Shift Applicants, Shift Candidates, then groups.
  // For non-Gigs: Applicants, Candidates, then groups.
  function getWorkforceOptions() {
    const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
    const isGig = jobType === 'gig';

    const options: Array<{ value: string; label: string }> = isGig
      ? [
          { value: 'all_applicants', label: 'All Applicants' },
          { value: 'all_candidates', label: 'All Candidates' },
          { value: 'shift_applicants', label: 'Shift Applicants' },
          { value: 'shift_candidates', label: 'Shift Candidates' },
        ]
      : [
          { value: 'applicants', label: 'Applicants' },
          { value: 'candidates', label: 'Candidates' },
        ];

    // Add last group selected via "Choose Group" (stored on job order for quick re-select)
    const lastGroup = (jobOrder as any)?.placementsLastGroup;
    if (lastGroup?.id && lastGroup?.groupName) {
      const alreadyAdded = options.some((o) => o.value === `group_${lastGroup.id}`);
      if (!alreadyAdded) {
        options.push({
          value: `group_${lastGroup.id}`,
          label: lastGroup.groupName,
        });
      }
    }
    
    // Get labor pool groups from job order (preferred)
    const laborPoolGroups = (jobOrder as any)?.laborPoolGroups || [];
    const visibility = jobOrder?.visibility || (jobOrder as any)?.jobsBoardVisibility;
    const restrictedGroups = jobOrder?.restrictedGroups || [];
    const allGroupIds = new Set<string>([
      ...laborPoolGroups,
      ...(visibility === 'group_restricted' ? restrictedGroups : []),
    ]);
    
    // Add labor pool groups not already in options
      allGroupIds.forEach((groupId: string) => {
      if (options.some((o) => o.value === `group_${groupId}`)) return;
      const group = userGroups.find((g) => g.id === groupId);
        if (group) {
        options.push({ value: `group_${groupId}`, label: group.groupName });
        }
      });
    
    options.push({ value: 'choose_group', label: 'Choose Group' });
    return options;
  }

  const assignWorkersToShift = async (workerIds: string[]) => {
    if (!selectedShift || !tenantId || !jobOrderId || workerIds.length === 0) {
      setError('Missing required information to assign shift');
      return;
    }

    try {
      setError(null);

      const assignFn = httpsCallable(functions, 'placementsCreateAssignments');
      const response = await assignFn({
        tenantId,
        jobOrderId,
        shiftId: selectedShift.id,
        userIds: workerIds,
        sourceType: selectedWorkforce || 'manual',
        sourceId: selectedWorkforce.startsWith('group_') ? selectedWorkforce.replace('group_', '') : null,
      });

      const data = response.data as any;
      const created = Array.isArray(data?.created) ? data.created : [];
      const createdCount = created.length;
      const skipped = Array.isArray(data?.skipped) ? data.skipped : [];

      if (createdCount === 0 && skipped.length > 0) {
        setError(`No assignments created. ${skipped.map((s: any) => s.reason).join(', ')}`);
      } else {
        setError(null);
        created.forEach((entry: { userId: string; assignmentId: string }) => {
          if (entry?.userId && entry?.assignmentId) {
            logAssignmentUpdateActivity(entry.userId, entry.assignmentId, 'placed').catch((e) =>
              console.warn('Failed to log assignment placed activity:', e)
            );
          }
        });
      }
    } catch (err: any) {
      console.error('Error assigning workers to shift:', err);
      setError(err?.message || 'Failed to assign worker(s) to shift');
    }
  };

  // Handle assign to shift (create new assignment from pool)
  const handleAssignToShift = async (worker: Worker, shift: Shift | undefined) => {
    if (!shift || !worker.id) return;
    await assignWorkersToShift([worker.id]);
  };

  // Handle offering position: create Assignment (sends accept/decline message) and remove placement.
  const handleConfirmPlacement = async (worker: Worker) => {
    if (!worker.isPlacementOnly || !selectedShift) return;
    if (confirmingPlacementUserId) return;
    setConfirmingPlacementUserId(worker.id);
    try {
      setError(null);
      await assignWorkersToShift([worker.id]);
      await deletePlacement(worker);
    } catch (err: any) {
      console.error('Error offering position:', err);
      setError(err?.message || 'Failed to offer position');
    } finally {
      setConfirmingPlacementUserId(null);
    }
  };

  // Cancel assignment and revert to Placed state. Worker is notified (SMS/email/push).
  const handleCancelAssignment = async (worker: Worker) => {
    if (worker.isPlacementOnly || !worker.assignmentId || !selectedShiftId || !jobOrderId) return;
    setCancelAssignmentWorker(null);
    try {
      setError(null);
      setPendingAssignmentCancels((prev) => new Set([...prev, worker.id]));
      const cancelFn = httpsCallable(functions, 'placementsCancelAssignment');
      await cancelFn({
        tenantId,
        assignmentId: worker.assignmentId,
        shiftId: selectedShiftId,
        userId: worker.id,
      });
    } catch (err: any) {
      console.error('Error cancelling assignment:', err);
      setError(err?.message || 'Failed to cancel assignment');
      setPendingAssignmentCancels((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
    }
  };

  const RESEND_COOLDOWN_MS = 15000;
  const handleResendOffer = async (worker: Worker) => {
    if (!worker.assignmentId || !tenantId) return;
    const aid = worker.assignmentId;
    if (resendLoadingAssignmentId === aid) return;
    const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
    if (Date.now() < cooldownUntil) return;
    try {
      setResendLoadingAssignmentId(aid);
      setError(null);
      const resendFn = httpsCallable(functions, 'resendAssignmentOffer');
      await resendFn({ tenantId, assignmentId: aid });
      setResendCooldownUntilByAssignmentId((prev) => ({ ...prev, [aid]: Date.now() + RESEND_COOLDOWN_MS }));
    } catch (err: any) {
      console.error('Error resending offer:', err);
      setError(err?.message || 'Failed to resend offer');
    } finally {
      setResendLoadingAssignmentId(null);
    }
  };

  const selectedShift = shifts.find(s => s.id === selectedShiftId);
  const showContent = true; // Grid always visible; Workforce selector is in Worker Pool card, Shift selector is in Shift Details card
  // Assignments column: all workers placed/assigned/confirmed/declined for this shift (from Firestore, not filtered by Workforce)
  const assignedWorkers = assignmentWorkersList;
  // Exclude cancelled (and canceled) from the list so they are not shown
  const displayedAssignedWorkers = useMemo(
    () =>
      assignedWorkers.filter(
        (w) => w.assignmentStatus !== 'cancelled' && w.assignmentStatus !== 'canceled',
      ),
    [assignedWorkers],
  );
  const placedOnlyWorkers = useMemo(
    () => assignedWorkers.filter((w) => w.isPlacementOnly),
    [assignedWorkers],
  );
  const [assignAllBusy, setAssignAllBusy] = useState(false);

  // Selection and bulk messaging for assignees (same pattern as Applications tab)
  const [selectedAssignmentWorkerIds, setSelectedAssignmentWorkerIds] = useState<Set<string>>(new Set());
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const isAllAssignmentsSelected =
    displayedAssignedWorkers.length > 0 &&
    selectedAssignmentWorkerIds.size === displayedAssignedWorkers.length;
  const isSomeAssignmentsSelected = selectedAssignmentWorkerIds.size > 0;
  const handleSelectAllAssignments = () => {
    if (isAllAssignmentsSelected) {
      setSelectedAssignmentWorkerIds(new Set());
    } else {
      setSelectedAssignmentWorkerIds(new Set(displayedAssignedWorkers.map((w) => w.id)));
    }
  };
  const handleSelectOneAssignment = (workerId: string) => {
    setSelectedAssignmentWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };
  const bulkAssignmentRecipients = useMemo(() => {
    const selected = displayedAssignedWorkers.filter((w) =>
      selectedAssignmentWorkerIds.has(w.id),
    );
    const recipients: MessageRecipient[] = selected.map((w) => ({
      userId: w.id,
      name: w.displayName || [w.firstName, w.lastName].filter(Boolean).join(' ').trim() || w.id,
      email: w.email,
      phone: w.phone,
    }));
    const recipientUserIds = selected.map((w) => w.id);
    return { recipients, recipientUserIds };
  }, [displayedAssignedWorkers, selectedAssignmentWorkerIds]);
  const handleAssignAll = async () => {
    if (placedOnlyWorkers.length === 0 || !selectedShift) return;
    setAssignAllBusy(true);
    try {
      setError(null);
      await assignWorkersToShift(placedOnlyWorkers.map((w) => w.id));
      for (const worker of placedOnlyWorkers) {
        await deletePlacement(worker);
      }
    } catch (err: any) {
      console.error('Error assigning all:', err);
      setError(err?.message ?? 'Failed to offer positions');
    } finally {
      setAssignAllBusy(false);
    }
  };
  // Worker Pool: current workforce selection minus anyone already in Assignments (so they don't appear in both)
  const availableWorkers = useMemo(
    () => workers.filter((w) => !assignedUserIds.has(w.id)),
    [workers, assignedUserIds],
  );
  const staffingTarget = useMemo(() => {
    if (!selectedShift) return null;
    const value =
      (selectedShift as any).staffNeeded ??
      (selectedShift as any).totalStaffRequested ??
      (selectedShift as any).workersNeeded;
    return value === undefined || value === null ? null : Number(value);
  }, [selectedShift]);
  const staffingFilled = useMemo(
    () => assignedWorkers.filter((w) => w.confirmationStatus === 'confirmed').length,
    [assignedWorkers],
  );

  // Shift start date for display (YYYY-MM-DD in recruiter's local timezone for same-day comparison)
  const shiftStartDateStr = useMemo(() => {
    if (!selectedShift) return '';
    return getCalendarDayLocal((selectedShift as any).shiftDate);
  }, [selectedShift]);

  // Same-day shift IDs (other shifts on the same calendar day as the selected shift) for double-book protection.
  // Uses recruiter's local timezone so "same day" is consistent (e.g. Saturday 10 PM and Saturday 2 PM are same day).
  const getShiftDateStr = (shift: Shift | undefined) => {
    if (!shift) return '';
    return getCalendarDayLocal((shift as any).shiftDate);
  };
  const sameDayShiftIds = useMemo(() => {
    if (!shiftStartDateStr || !selectedShiftId) return [];
    return shifts
      .filter((s) => s.id !== selectedShiftId && getShiftDateStr(s) === shiftStartDateStr)
      .map((s) => s.id);
  }, [shifts, selectedShiftId, shiftStartDateStr]);

  // Map: userId -> list of { shiftId, shiftTitle, type } for same-day placements/assignments (double-book warning)
  const [sameDayConflictByUserId, setSameDayConflictByUserId] = useState<Map<string, Array<{ shiftId: string; shiftTitle: string; type: 'placement' | 'assigned' | 'confirmed' }>>>(new Map());
  useEffect(() => {
    if (!tenantId || !jobOrderId || sameDayShiftIds.length === 0) {
      setSameDayConflictByUserId(new Map());
      return;
    }
    let cancelled = false;
    const run = async () => {
      const conflicts = new Map<string, Array<{ shiftId: string; shiftTitle: string; type: 'placement' | 'assigned' | 'confirmed' }>>();
      const shiftTitleById = new Map<string, string>(shifts.map((s) => [s.id, (s as any).shiftTitle || s.shiftTitle || 'Shift']));

      const placementsRef = collection(db, 'tenants', tenantId, 'placements');
      const placementsQuery = query(
        placementsRef,
        where('jobOrderId', '==', jobOrderId),
        where('shiftId', 'in', sameDayShiftIds.slice(0, 30)),
      );
      const placementsSnap = await getDocs(placementsQuery);
      placementsSnap.docs.forEach((d) => {
        const data = d.data() as { userId?: string; shiftId?: string };
        const uid = data?.userId;
        const shiftId = data?.shiftId;
        if (!uid || !shiftId) return;
        const list = conflicts.get(uid) ?? [];
        list.push({ shiftId, shiftTitle: shiftTitleById.get(shiftId) ?? 'Shift', type: 'placement' });
        conflicts.set(uid, list);
      });

      const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
      const assignmentQueries = sameDayShiftIds.slice(0, 30).map((shiftId) =>
        query(
          assignmentsRef,
          where('shiftId', '==', shiftId),
          where('status', 'in', ['proposed', 'confirmed', 'active']),
        ),
      );
      const assignmentSnaps = await Promise.all(assignmentQueries.map((q) => getDocs(q)));
      assignmentSnaps.forEach((snap, idx) => {
        const shiftId = sameDayShiftIds[idx];
        const shiftTitle = shiftTitleById.get(shiftId) ?? 'Shift';
        snap.docs.forEach((d) => {
          const data = d.data() as { userId?: string; candidateId?: string; status?: string };
          const uid = data?.userId || data?.candidateId;
          if (!uid) return;
          const status = (data?.status || '').toLowerCase();
          const type: 'placement' | 'assigned' | 'confirmed' = status === 'confirmed' || status === 'active' ? 'confirmed' : 'assigned';
          const list = conflicts.get(uid) ?? [];
          if (!list.some((x) => x.shiftId === shiftId)) list.push({ shiftId, shiftTitle, type });
          conflicts.set(uid, list);
        });
      });

      if (!cancelled) setSameDayConflictByUserId(conflicts);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, jobOrderId, sameDayShiftIds, shifts]);

  const formatDateDisplay = (yyyyMmDd: string) => {
    if (!yyyyMmDd) return '';
    const d = new Date(yyyyMmDd + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleExportAssignmentsCsv = () => {
    if (!selectedShift || displayedAssignedWorkers.length === 0) return;
    const shift = selectedShift as any;
    const job = jobOrder as any;
    const shiftName = shift.shiftTitle ?? 'Shift';
    const shiftDateStr = shiftStartDateStr || getShiftDateStr(selectedShift);
    const shiftStartTime = shift.defaultStartTime ?? shift.startTime ?? '';
    const jobTitle = shift.defaultJobTitle ?? shift.jobTitle ?? job?.jobTitle ?? '';
    const payRate =
      shift.payRate != null
        ? String(shift.payRate)
        : job?.payRate != null
          ? String(job.payRate)
          : '';
    const worksiteNickname = job?.worksiteName ?? '';
    const addr = job?.worksiteAddress;
    const worksiteAddress = addr
      ? [addr.street, addr.city, addr.state, addr.zipCode ?? addr.zip]
        .filter(Boolean)
        .join(', ')
      : '';

    const escapeCsv = (v: string) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[",\r\n]/.test(s) ? `"${s}"` : s;
    };

    const header = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'shift name',
      'shift start date',
      'shift start time',
      'job title',
      'pay rate',
      'worksite location nickname',
      'worksite location address',
    ];
    const rows = displayedAssignedWorkers.map((w) => [
      escapeCsv(w.firstName),
      escapeCsv(w.lastName),
      escapeCsv(w.email ?? ''),
      escapeCsv(w.phone ?? ''),
      escapeCsv(shiftName),
      escapeCsv(shiftDateStr),
      escapeCsv(shiftStartTime),
      escapeCsv(jobTitle),
      escapeCsv(payRate),
      escapeCsv(worksiteNickname),
      escapeCsv(worksiteAddress),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assignments-${shiftDateStr || 'export'}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewEmail = async () => {
    const firstWithAssignment = displayedAssignedWorkers.find((w) => assignmentIdByUserId.get(w.id));
    const assignmentId = firstWithAssignment ? assignmentIdByUserId.get(firstWithAssignment.id) : null;
    if (!tenantId || !assignmentId) {
      setPreviewEmailError('Add at least one assignment (place a worker and click "Offer position") to preview the confirmation email.');
      setPreviewEmailOpen(true);
      setPreviewEmailSubject('');
      setPreviewEmailHtml('');
      return;
    }
    setPreviewEmailError(null);
    setPreviewEmailLoading(true);
    setPreviewEmailOpen(true);
    setPreviewEmailSubject('');
    setPreviewEmailHtml('');
    try {
      const preview = httpsCallable<{ tenantId: string; assignmentId: string }, { subject: string; html: string }>(
        functions,
        'previewAssignmentDetailsEmail'
      );
      const { data } = await preview({ tenantId, assignmentId });
      setPreviewEmailSubject(data.subject ?? '');
      setPreviewEmailHtml(data.html ?? '');
    } catch (err: any) {
      setPreviewEmailError(err?.message ?? 'Failed to load email preview.');
    } finally {
      setPreviewEmailLoading(false);
    }
  };

  const [editStartDateWorker, setEditStartDateWorker] = useState<Worker | null>(null);
  const [editStartDateValue, setEditStartDateValue] = useState('');
  const [editStartDateSaving, setEditStartDateSaving] = useState(false);
  const handleOpenEditStartDate = (worker: Worker) => {
    const current = worker.assignmentStartDate || shiftStartDateStr || '';
    setEditStartDateWorker(worker);
    setEditStartDateValue(current || '');
  };
  const handleSaveStartDate = async () => {
    if (!editStartDateWorker?.assignmentId || !tenantId || !editStartDateValue.trim()) {
      setEditStartDateWorker(null);
      return;
    }
    setEditStartDateSaving(true);
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', editStartDateWorker.assignmentId);
      await updateDoc(assignmentRef, {
        startDate: editStartDateValue.trim().split('T')[0],
        updatedAt: serverTimestamp(),
      });
      setEditStartDateWorker(null);
    } catch (err: any) {
      console.error('Error updating assignment start date:', err);
      setError(err?.message ?? 'Failed to update start date');
    } finally {
      setEditStartDateSaving(false);
    }
  };

  const handleWorkerDragStart = (event: React.DragEvent, workerId: string) => {
    event.dataTransfer.setData(WORKER_DRAG_MIME, workerId);
    // Keep plain text for browser compatibility, but we only read the custom MIME on drop.
    event.dataTransfer.setData('text/plain', workerId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleAssignmentsDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsAssignmentDragOver(true);
  };

  const [doubleBookConfirmWorker, setDoubleBookConfirmWorker] = useState<Worker | null>(null);

  const handleAssignmentsDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsAssignmentDragOver(false);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const worker = availableWorkers.find((w) => w.id === workerId);
    if (worker) {
      tryPlaceWorker(worker);
    }
  };

  const tryPlaceWorker = (worker: Worker) => {
    const conflicts = sameDayConflictByUserId.get(worker.id);
    if (conflicts && conflicts.length > 0) {
      setDoubleBookConfirmWorker(worker);
      return;
    }
    createPlacement(worker);
  };

  const createPlacement = async (worker: Worker) => {
    if (!tenantId || !selectedShiftId || !jobOrderId || !user?.uid) {
      setError('Missing required information to place worker');
      return;
    }
    setDoubleBookConfirmWorker(null);
    const placementId = `${selectedShiftId}__${worker.id}`;
    try {
      setError(null);
      pendingPlacementAddsRef.current.add(worker.id);
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
      const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
      await setDoc(placementRef, {
        tenantId,
        jobOrderId,
        shiftId: selectedShiftId,
        userId: worker.id,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('Error placing worker:', err);
      setError(err?.message || 'Failed to place worker');
      pendingPlacementAddsRef.current.delete(worker.id);
      setPlacementUserIds((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
    }
  };

  const deletePlacement = async (worker: Worker) => {
    if (!tenantId || !selectedShiftId) return;
    if (!worker.isPlacementOnly) return;
    const placementId = `${selectedShiftId}__${worker.id}`;
    try {
      setError(null);
      // Optimistic update: remove from Assignments immediately
      setPlacementUserIds((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
      const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
      await deleteDoc(placementRef);
    } catch (err: any) {
      console.error('Error removing placement:', err);
      setError(err?.message || 'Failed to remove placement');
      // Revert optimistic update on error
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
    }
  };

  const handleUnplaceToWorkerPool = async (worker: Worker) => {
    if (!worker.isPlacementOnly) return;
    await deletePlacement(worker);
  };

  const handleWorkerPoolDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsWorkerPoolDragOver(true);
  };

  const handleWorkerPoolDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsWorkerPoolDragOver(false);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const assignedWorker = assignedWorkers.find((w) => w.id === workerId);
    if (assignedWorker) {
      handleUnplaceToWorkerPool(assignedWorker);
    }
  };

  // Guard against browser default drop navigation (e.g. cid:, mailto:, file:).
  useEffect(() => {
    const preventWindowDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', preventWindowDropNavigation);
    window.addEventListener('drop', preventWindowDropNavigation);
    return () => {
      window.removeEventListener('dragover', preventWindowDropNavigation);
      window.removeEventListener('drop', preventWindowDropNavigation);
    };
  }, []);

  return (
    <Box
      onDragOverCapture={(event) => {
        // Prevent browser default drop navigation (e.g., cid: URLs).
        event.preventDefault();
      }}
      onDropCapture={(event) => {
        // Keep drops in-app and avoid page-level navigation.
        event.preventDefault();
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', mb: 2 }}>
        {showContent && shifts.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Shift</InputLabel>
            <Select
              value={safeSelectedShiftId}
              label="Shift"
              onChange={(e) => setSelectedShiftId(e.target.value)}
              disabled={loading}
            >
              <MenuItem value="">
                <em>Select shift</em>
              </MenuItem>
              {shifts.map((shift) => {
                const dv = shift.shiftDate as string | Date | { toDate?: () => Date };
                let dateStr = '';
                if (typeof dv === 'string') dateStr = dv.split('T')[0];
                else if (dv instanceof Date) dateStr = dv.toISOString().split('T')[0];
                else if (dv && typeof (dv as { toDate?: () => Date }).toDate === 'function') dateStr = (dv as { toDate: () => Date }).toDate().toISOString().split('T')[0];
                const formatted = dateStr ? format(new Date(dateStr), 'EEE, MMM d, yyyy') : 'Unknown date';
                const jobTitle = (shift as any).defaultJobTitle ?? (shift as any).jobTitle ?? (jobOrder as any)?.jobTitle ?? '';
                return (
                  <MenuItem key={shift.id} value={shift.id}>
                    <Box>
                      <Typography variant="body2">{shift.shiftTitle || 'Shift'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatted} {jobTitle ? `• ${jobTitle}` : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}
        {selectedShift && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {(() => {
              const startTime = (selectedShift as any).defaultStartTime ?? (selectedShift as any).startTime ?? '';
              const endTime = (selectedShift as any).defaultEndTime ?? (selectedShift as any).endTime ?? '';
              const formatTimeStr = (t: string) => {
                if (!t) return '';
                const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
                if (!m) return t;
                const hour = parseInt(m[1], 10);
                const min = m[2];
                if (m[3]) return `${hour}:${min} ${m[3]}`;
                const ampm = hour >= 12 ? 'PM' : 'AM';
                const displayHour = hour % 12 || 12;
                return `${displayHour}:${min} ${ampm}`;
              };
              const staffReq = (selectedShift as any).totalStaffRequested ?? (selectedShift as any).staffNeeded ?? (selectedShift as any).workersNeeded;
              const overstaff = (selectedShift as any).overstaffCount ?? (selectedShift as any).overstaff ?? 0;
              const scheduleStr = startTime && endTime ? `${formatTimeStr(startTime)} – ${formatTimeStr(endTime)}` : null;
              return (
                <>
                  {scheduleStr && (
                    <Typography variant="body2" color="text.secondary">
                      {scheduleStr}
                    </Typography>
                  )}
                  {typeof staffReq === 'number' && (
                    <Typography variant="body2" color="text.secondary">
                      Staff: {staffReq}
                      {typeof overstaff === 'number' && overstaff > 0 ? ` (+${overstaff} overstaff)` : ''}
                    </Typography>
                  )}
                </>
              );
            })()}
          </Box>
        )}
      </Box>

      {/* Error Message */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Content Area - two column board */}
        {showContent && (
          <Grid container spacing={3}>
            {/* Left: Assignments */}
            <Grid item xs={12} lg={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: '16px', '&:last-child': { pb: '16px' }, overflow: 'visible' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 0.5, overflow: 'visible' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '0 1 auto' }}>
                      {selectedShiftId && displayedAssignedWorkers.length > 0 && (
                        <Checkbox
                          indeterminate={isSomeAssignmentsSelected && !isAllAssignmentsSelected}
                          checked={isAllAssignmentsSelected}
                          onChange={handleSelectAllAssignments}
                          size="small"
                          aria-label="select all assignees"
                        />
                      )}
                      <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
                        Assignments ({displayedAssignedWorkers.length})
                        <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary', fontWeight: 400 }} title="New UI with Preview Email">
                          (updated)
                        </Typography>
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto', ml: 'auto' }}>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        disabled={placedOnlyWorkers.length === 0 || !selectedShiftId || assignAllBusy}
                        onClick={handleAssignAll}
                      >
                        {assignAllBusy ? 'Offering…' : 'Assign All'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={displayedAssignedWorkers.length === 0 || !selectedShiftId}
                        onClick={handleExportAssignmentsCsv}
                      >
                        Export
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EmailIcon />}
                        disabled={!selectedShiftId}
                        onClick={handlePreviewEmail}
                        title="Preview the confirmation email workers receive (staff details, parking, check-in, attachments)"
                      >
                        Preview Email
                      </Button>
                    </Box>
                  </Box>
                  {isSomeAssignmentsSelected && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        px: 0,
                        py: 1,
                        mb: 0.5,
                        borderBottom: 1,
                        borderColor: 'divider',
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {selectedAssignmentWorkerIds.size} selected
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EmailIcon />}
                        onClick={() => {
                          setBulkDrawerChannel('email');
                          setBulkDrawerOpen(true);
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        Bulk Email
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SmsIcon />}
                        onClick={() => {
                          setBulkDrawerChannel('sms');
                          setBulkDrawerOpen(true);
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        Bulk SMS
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setSelectedAssignmentWorkerIds(new Set())}
                      >
                        Clear selection
                      </Button>
                    </Box>
                  )}
                  <Box
                    onDragOver={handleAssignmentsDragOver}
                    onDragLeave={() => setIsAssignmentDragOver(false)}
                    onDrop={handleAssignmentsDrop}
                    sx={{
                      borderRadius: 1,
                      border: '1px dashed',
                      borderColor: isAssignmentDragOver ? 'primary.main' : 'divider',
                      bgcolor: isAssignmentDragOver ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.02)',
                      minHeight: 220,
                      p: 1,
                      transition: 'all 0.15s ease',
                      boxShadow: isAssignmentDragOver ? 2 : 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Drag workers here to place them (no message sent). Click Placed chip to offer position.
                    </Typography>
                    {!selectedShiftId ? (
                      <Alert severity="info" sx={{ py: 2 }}>
                        Select a shift to view placements.
                      </Alert>
                    ) : (
                    <Stack spacing={1}>
                      {displayedAssignedWorkers.map((worker) => {
                        const isPlacementOnly = Boolean(worker.isPlacementOnly);
                        const isDeclined = worker.assignmentStatus === 'declined';
                        const isCancelled = worker.assignmentStatus === 'cancelled' || worker.assignmentStatus === 'canceled';
                        // Placed = placement only (no offer sent). Assigned = offer sent, awaiting response. Confirmed = worker accepted. Declined/Cancelled = worker or system cancelled.
                        const isConfirmed = worker.assignmentStatus && ['confirmed', 'active'].includes(worker.assignmentStatus);
                        const offeringThis = isPlacementOnly && confirmingPlacementUserId === worker.id;
                        const statusLabel = offeringThis ? 'Offering…' : isPlacementOnly ? 'Placed' : isDeclined ? 'Declined' : isCancelled ? 'Cancelled' : isConfirmed ? 'Confirmed' : 'Assigned';
                        const canDragBackToPool = isPlacementOnly && !offeringThis; // Only placement-only (no Assignment) can be dragged back
                        return (
                          <Paper
                            key={worker.id}
                            variant="outlined"
                            draggable={canDragBackToPool}
                            onDragStart={(event) => handleWorkerDragStart(event, worker.id)}
                            sx={{
                              p: 0.5,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 1,
                              cursor: canDragBackToPool ? 'grab' : 'default',
                            }}
                          >
                            <Checkbox
                              checked={selectedAssignmentWorkerIds.has(worker.id)}
                              onChange={() => handleSelectOneAssignment(worker.id)}
                              size="small"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${worker.displayName}`}
                              sx={{ py: 0, px: 0.5 }}
                            />
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>
                                {worker.displayName}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  Starts: {formatDateDisplay(worker.assignmentStartDate || shiftStartDateStr) || '—'}
                                </Typography>
                                {!isPlacementOnly && worker.assignmentId && (
                                  <Tooltip title="Edit start date">
                                    <IconButton
                                      size="small"
                                      sx={{ p: 0, color: 'text.secondary' }}
                                      onClick={(e) => { e.stopPropagation(); handleOpenEditStartDate(worker); }}
                                      aria-label="Edit start date"
                                    >
                                      <EditIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </Box>
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {!isPlacementOnly && !isDeclined && !isCancelled && (
                                  <Tooltip title="Remove assignment (revert to Placed, worker will be notified)">
                                    <IconButton
                                      size="small"
                                      onClick={() => setCancelAssignmentWorker(worker)}
                                      sx={{ color: 'error.main' }}
                                      aria-label="Cancel assignment"
                                    >
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                                <Tooltip title={offeringThis ? 'Sending offer…' : isPlacementOnly ? 'Click to offer position (sends accept/decline message)' : isDeclined ? 'Worker declined this assignment' : isCancelled ? 'Assignment was cancelled' : undefined}>
                                  <Chip
                                    size="small"
                                    label={statusLabel}
                                    color={isPlacementOnly ? 'info' : isDeclined || isCancelled ? 'error' : undefined}
                                    icon={
                                      offeringThis ? (
                                        <CircularProgress size={14} color="inherit" sx={{ color: 'white' }} />
                                      ) : isPlacementOnly ? (
                                        <UnlockedIcon fontSize="small" />
                                      ) : isDeclined || isCancelled ? (
                                        <ErrorIcon fontSize="small" />
                                      ) : isConfirmed ? (
                                        <CheckIcon fontSize="small" />
                                      ) : (
                                        <LockedIcon fontSize="small" />
                                      )
                                    }
                                    onClick={isPlacementOnly && !offeringThis ? () => handleConfirmPlacement(worker) : undefined}
                                    disabled={offeringThis}
                                    sx={{
                                      ...(isPlacementOnly && !offeringThis && {
                                        cursor: 'pointer',
                                        zIndex: 50,
                                        position: 'relative',
                                        '&:hover': { opacity: 0.9 },
                                      }),
                                      ...(offeringThis && {
                                        cursor: 'wait',
                                        opacity: 0.95,
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...((isDeclined || isCancelled) && {
                                        bgcolor: 'error.main',
                                        color: 'white',
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...(isConfirmed && {
                                        bgcolor: 'success.main',
                                        color: 'white',
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...(!isPlacementOnly && !isConfirmed && !isDeclined && !isCancelled && {
                                        bgcolor: '#e8f5e9', // Light green (Material green 50)
                                        color: 'success.main',
                                        '& .MuiChip-icon': { color: 'success.main' },
                                      }),
                                    }}
                                  />
                                </Tooltip>
                              </Box>
                              {!isPlacementOnly && !isDeclined && !isCancelled && (worker.assignmentConfirmedAt != null || worker.assignmentOfferSentAt != null) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    {isConfirmed
                                      ? worker.assignmentConfirmedAt != null
                                        ? `Confirmed ${new Date(worker.assignmentConfirmedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                        : worker.assignmentOfferSentAt != null
                                          ? `Confirmed (offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
                                          : 'Confirmed'
                                      : worker.assignmentOfferSentAt != null
                                        ? `Offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                        : null}
                                  </Typography>
                                  {!isConfirmed && worker.assignmentOfferSentAt != null && (() => {
                                    const aid = worker.assignmentId ?? '';
                                    const loading = resendLoadingAssignmentId === aid;
                                    const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
                                    const inCooldown = Date.now() < cooldownUntil;
                                    const disabled = loading || inCooldown;
                                    return (
                                      <Tooltip title={inCooldown ? 'Please wait before resending' : 'Resend offer (SMS + push + email)'}>
                                        <span>
                                          <IconButton
                                            size="small"
                                            sx={{ p: 0, color: 'text.secondary' }}
                                            onClick={() => handleResendOffer(worker)}
                                            disabled={disabled}
                                            aria-label="Resend offer"
                                          >
                                            <RefreshIcon
                                              sx={{
                                                fontSize: 14,
                                                ...(loading && {
                                                  animation: 'spin 0.8s linear infinite',
                                                  '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
                                                }),
                                              }}
                                            />
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                    );
                                  })()}
                                </Box>
                              )}
                            </Box>
                          </Paper>
                        );
                      })}
                      {displayedAssignedWorkers.length === 0 && (
                        <Alert severity="info">
                          No workers placed or assigned yet.
                        </Alert>
                      )}
                    </Stack>
                  )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Right: Worker Pool */}
            <Grid item xs={12} lg={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: '16px', '&:last-child': { pb: '16px' } }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Worker Pool ({availableWorkers.length})
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1, flexWrap: 'wrap' }}>
                    <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                      <InputLabel>Workforce</InputLabel>
                      <Select
                        value={safeSelectedWorkforce}
                        label="Workforce"
                        onChange={(e) => setSelectedWorkforce(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>Select workforce</em>
                        </MenuItem>
                        {workforceOptions.map((option) => {
                          const isGroup = option.value.startsWith('group_');
                          return (
                            <MenuItem key={option.value} value={option.value}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                                <span>{option.label}</span>
                                {isGroup && (
                                  <Tooltip title="Remove group from list">
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveGroupFromWorkforce(option.value);
                                      }}
                                      sx={{ color: 'error.main', p: 0.25 }}
                                      aria-label="Remove group"
                                    >
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    {selectedWorkforce.startsWith('group_') && (
                      <Tooltip title="Clear group selection">
                        <IconButton
                          size="small"
                          onClick={() => setSelectedWorkforce('choose_group')}
                          sx={{ mt: 0.5 }}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {safeSelectedWorkforce === 'choose_group' && (
                    <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                      <InputLabel id="placements-group-select-label" shrink>Group</InputLabel>
                      <Select
                        labelId="placements-group-select-label"
                        value=""
                        label="Group"
                        displayEmpty
                        renderValue={(v) => (v === '' ? 'Select a group' : userGroups.find((g) => g.id === v)?.groupName ?? v)}
                        onChange={async (e) => {
                          const groupId = e.target.value as string;
                          if (!groupId) return;
                          const group = userGroups.find((g) => g.id === groupId);
                          if (!group) return;
                          setSelectedWorkforce(`group_${groupId}`);
                          try {
                            const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
                            await updateDoc(jobOrderRef, {
                              placementsLastGroup: { id: groupId, groupName: group.groupName },
                              updatedAt: serverTimestamp(),
                            });
                            onJobOrderUpdated?.();
                          } catch (err) {
                            console.error('Error saving placements last group:', err);
                          }
                        }}
                      >
                        <MenuItem value="">
                          <em>Select a group</em>
                        </MenuItem>
                        {userGroups.map((g) => (
                          <MenuItem key={g.id} value={g.id}>
                            {g.groupName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Drag into Assignments to place. Drop Placed workers here to unplace.
                  </Typography>

                  <Box
                    onDragOver={handleWorkerPoolDragOver}
                    onDragLeave={() => setIsWorkerPoolDragOver(false)}
                    onDrop={handleWorkerPoolDrop}
                    sx={{
                      borderRadius: 1,
                      border: '1px dashed',
                      borderColor: isWorkerPoolDragOver ? 'warning.main' : 'divider',
                      bgcolor: isWorkerPoolDragOver ? 'rgba(255, 152, 0, 0.08)' : 'rgba(0,0,0,0.02)',
                      minHeight: 220,
                      p: 1,
                      transition: 'all 0.15s ease',
                      boxShadow: isWorkerPoolDragOver ? 2 : 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Drop Placed workers here to unplace
                    </Typography>
                  {!safeSelectedWorkforce ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a workforce to view workers.
                    </Alert>
                  ) : safeSelectedWorkforce === 'choose_group' ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a group above to view its members.
                    </Alert>
                  ) : !selectedShiftId ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a shift to view worker pool.
                    </Alert>
                  ) : loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                      <CircularProgress size={28} />
                    </Box>
                  ) : availableWorkers.length === 0 ? (
                    <Alert severity="info">
                      No available workers for the selected workforce option.
                    </Alert>
                  ) : (
                    <Stack spacing={1}>
                      {availableWorkers.map((worker) => {
                        const getResumeUrl = () => {
                          if (worker.resumeUrl) return worker.resumeUrl;
                          if (worker.resume?.downloadUrl) return worker.resume.downloadUrl;
                          if (worker.resume?.storagePath) {
                            return `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(worker.resume.storagePath)}?alt=media`;
                          }
                          return null;
                        };

                        const resumeUrl = getResumeUrl();
                        const hasBio = worker.bio && worker.bio.trim().length > 0;
                        const hasWorkHistory = worker.workHistory && worker.workHistory.length > 0;
                        const hasCerts = worker.certifications && worker.certifications.length > 0;
                        const hasLicenses = worker.licenses && worker.licenses.length > 0;

                        return (
                          <Paper
                            key={worker.id}
                            variant="outlined"
                            draggable
                            onDragStart={(event) => handleWorkerDragStart(event, worker.id)}
                            sx={{
                              p: 0.5,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 1,
                              cursor: 'grab',
                            }}
                          >
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>
                                    {worker.displayName}
                                  </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {[worker.city, worker.state].filter(Boolean).join(', ') || worker.email || worker.phone || 'No contact info'}
                                    </Typography>
                              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                                          <Chip
                                            size="small"
                                  label={worker.workEligibility ? 'Eligible' : 'Not eligible'}
                                  color={worker.workEligibility ? 'success' : 'error'}
                                  variant="outlined"
                                  sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                                          />
                                {!!worker.skills?.length && (
                                          <Chip
                                            size="small"
                                    label={`${worker.skills.length} skills`}
                                    sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                                  />
                                )}
                                {!!worker.languages?.length && (
                                          <Chip
                                            size="small"
                                            variant="outlined"
                                    label={`${worker.languages.length} langs`}
                                    sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                                          />
                                        )}
                                      </Box>
                                    </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                  {sameDayConflictByUserId.get(worker.id)?.length ? (
                                    <Tooltip
                                      title={
                                        <Box>
                                          <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                                            Already on a shift this day
                                          </Typography>
                                          {sameDayConflictByUserId.get(worker.id)?.map((c, i) => (
                                            <Typography key={i} variant="caption" display="block">
                                              {c.shiftTitle} ({c.type === 'placement' ? 'Placed' : c.type === 'assigned' ? 'Assigned' : 'Confirmed'})
                                            </Typography>
                                          ))}
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <WarningIcon fontSize="small" sx={{ color: 'warning.main' }} />
                                    </Tooltip>
                                  ) : null}
                                  {resumeUrl && (
                                <Tooltip title="View resume">
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          setSelectedResume({ url: resumeUrl, fileName: worker.resume?.fileName });
                                          setResumeModalOpen(true);
                                        }}
                                      >
                                        <ResumeIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {hasBio && (
                                    <Tooltip
                                      title={
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxWidth: 320 }}>
                                            {worker.bio}
                                          </Typography>
                                      }
                                      arrow
                                    >
                                      <IconButton size="small">
                                        <BioIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {hasWorkHistory && (
                                    <Tooltip
                                      title={
                                    <Box sx={{ maxWidth: 340 }}>
                                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Work History</Typography>
                                            {worker.workHistory?.slice(0, 3).map((job: any, idx: number) => (
                                        <Typography key={idx} variant="caption" display="block">
                                          {job.position || job.title || job.role || 'Position'}{job.company ? ` at ${job.company}` : ''}
                                                </Typography>
                                      ))}
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <IconButton size="small">
                                        <WorkHistoryIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {hasCerts && (
                                <Tooltip title={`${worker.certifications?.length} cert${(worker.certifications?.length || 0) > 1 ? 's' : ''}`}>
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          setSelectedCerts(worker.certifications || []);
                                          setCertModalOpen(true);
                                        }}
                                      >
                                        <CertIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {hasLicenses && (
                                <Tooltip title={`${worker.licenses?.length} license${(worker.licenses?.length || 0) > 1 ? 's' : ''}`}>
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          setSelectedLicenses(worker.licenses || []);
                                          setLicenseModalOpen(true);
                                        }}
                                      >
                                        <LicenseIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                <Button 
                                variant="outlined"
                                  size="small"
                                  onClick={() => handleAssignToShift(worker, selectedShift)}
                                disabled={!selectedShift}
                                sx={{
                                  minWidth: 72,
                                  height: 28,
                                  px: 1.25,
                                  fontSize: '0.75rem',
                                  lineHeight: 1,
                                }}
                              >
                                Assign
                                </Button>
                              </Box>
                            </Paper>
                        );
                      })}
                    </Stack>
                  )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Resume Modal */}
        <Dialog
          open={resumeModalOpen}
          onClose={() => setResumeModalOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            Resume {selectedResume?.fileName && `- ${selectedResume.fileName}`}
          </DialogTitle>
          <DialogContent>
            {selectedResume?.url && (
              <iframe
                src={selectedResume.url}
                style={{ width: '100%', height: '600px', border: 'none' }}
                title="Resume Viewer"
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResumeModalOpen(false)}>Close</Button>
            {selectedResume?.url && (
              <Button
                variant="contained"
                onClick={() => window.open(selectedResume.url, '_blank')}
                startIcon={<ResumeIcon />}
              >
                Open in New Tab
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* Certifications Modal */}
        <Dialog
          open={certModalOpen}
          onClose={() => setCertModalOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Certifications</DialogTitle>
          <DialogContent>
            {selectedCerts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No certifications available.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {selectedCerts.map((cert: any, idx: number) => (
                  <Card key={idx} variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {cert.name || cert.certification || cert}
                      </Typography>
                      {cert.issuer && (
                        <Typography variant="body2" color="text.secondary">
                          Issuer: {cert.issuer}
                        </Typography>
                      )}
                      {cert.issueDate && (
                        <Typography variant="body2" color="text.secondary">
                          Issue Date: {typeof cert.issueDate === 'string' ? cert.issueDate : new Date(cert.issueDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {cert.expirationDate && (
                        <Typography variant="body2" color="text.secondary">
                          Expires: {typeof cert.expirationDate === 'string' ? cert.expirationDate : new Date(cert.expirationDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {cert.url && (
                        <Link href={cert.url} target="_blank" rel="noopener">
                          View Certificate
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCertModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Licenses Modal */}
        <Dialog
          open={licenseModalOpen}
          onClose={() => setLicenseModalOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Licenses</DialogTitle>
          <DialogContent>
            {selectedLicenses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No licenses available.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {selectedLicenses.map((license: any, idx: number) => (
                  <Card key={idx} variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {license.type || license.name || license.license || license}
                      </Typography>
                      {license.number && (
                        <Typography variant="body2" color="text.secondary">
                          Number: {license.number}
                        </Typography>
                      )}
                      {license.state && (
                        <Typography variant="body2" color="text.secondary">
                          State: {license.state}
                        </Typography>
                      )}
                      {license.expirationDate && (
                        <Typography variant="body2" color="text.secondary">
                          Expires: {typeof license.expirationDate === 'string' ? license.expirationDate : new Date(license.expirationDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {license.url && (
                        <Link href={license.url} target="_blank" rel="noopener">
                          View License
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLicenseModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Confirm remove assignment */}
        <Dialog open={!!cancelAssignmentWorker} onClose={() => setCancelAssignmentWorker(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Remove assignment?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              This will revert {cancelAssignmentWorker?.displayName ?? 'this worker'} to <strong>Placed</strong>. The worker will be notified that the assignment was cancelled (SMS / email / push).
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelAssignmentWorker(null)}>Cancel</Button>
            <Button variant="contained" color="error" onClick={() => cancelAssignmentWorker && handleCancelAssignment(cancelAssignmentWorker)}>
              Remove assignment
            </Button>
          </DialogActions>
        </Dialog>

        {/* Preview confirmation email (staff details, parking, check-in, attachments) */}
        <Dialog
          open={previewEmailOpen}
          onClose={() => { setPreviewEmailOpen(false); setPreviewEmailError(null); }}
          maxWidth="md"
          fullWidth
          PaperProps={{ sx: { maxHeight: '90vh' } }}
        >
          <DialogTitle>Preview: Confirmation Email</DialogTitle>
          <DialogContent>
            {previewEmailLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {previewEmailError && (
              <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setPreviewEmailError(null)}>
                {previewEmailError}
              </Alert>
            )}
            {!previewEmailLoading && previewEmailSubject && (
              <>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Subject</Typography>
                <Typography variant="body1" sx={{ mb: 2, fontWeight: 600 }}>{previewEmailSubject}</Typography>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Body (staff details, parking, check-in instructions; attachments appear as links below)</Typography>
                <Box
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 2,
                    maxHeight: 400,
                    overflow: 'auto',
                    bgcolor: 'grey.50',
                  }}
                >
                  <Box component="div" dangerouslySetInnerHTML={{ __html: previewEmailHtml }} />
                </Box>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setPreviewEmailOpen(false); setPreviewEmailError(null); }}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Double-book warning: worker already placed/assigned/confirmed on same day */}
        <Dialog open={!!doubleBookConfirmWorker} onClose={() => setDoubleBookConfirmWorker(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Already working this day</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {doubleBookConfirmWorker?.displayName ?? 'This worker'} is already placed, assigned, or confirmed on another shift this day:
            </Typography>
            <Stack component="ul" sx={{ pl: 2, m: 0 }}>
              {doubleBookConfirmWorker && sameDayConflictByUserId.get(doubleBookConfirmWorker.id)?.map((c, i) => (
                <Typography key={i} component="li" variant="body2" color="text.secondary">
                  {c.shiftTitle} ({c.type === 'placement' ? 'Placed' : c.type === 'assigned' ? 'Assigned' : 'Confirmed'})
                </Typography>
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Placing them on this shift as well may double-book them. Do you want to place anyway?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDoubleBookConfirmWorker(null)}>Cancel</Button>
            <Button variant="contained" onClick={() => doubleBookConfirmWorker && createPlacement(doubleBookConfirmWorker)}>
              Place anyway
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit assignment start date */}
        <Dialog open={!!editStartDateWorker} onClose={() => setEditStartDateWorker(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Start date</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {editStartDateWorker?.displayName}
            </Typography>
            <TextField
              type="date"
              label="Start date"
              value={editStartDateValue}
              onChange={(e) => setEditStartDateValue(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: '9999-12-31' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditStartDateWorker(null)}>Cancel</Button>
            <Button variant="contained" onClick={handleSaveStartDate} disabled={editStartDateSaving || !editStartDateValue.trim()}>
              {editStartDateSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>

        <MessageDrawer
          open={bulkDrawerOpen}
          onClose={() => setBulkDrawerOpen(false)}
          recipients={bulkAssignmentRecipients.recipients}
          tenantId={tenantId}
          bulkSystemMode={true}
          recipientUserIds={bulkAssignmentRecipients.recipientUserIds}
          defaultChannels={[bulkDrawerChannel]}
          onSend={() => {
            setSelectedAssignmentWorkerIds(new Set());
            setBulkDrawerOpen(false);
          }}
        />
      </Box>
  );
};

export default PlacementsTab;

