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

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
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
}

const WORKER_DRAG_MIME = 'application/x-hrx-worker-id';

const PlacementsTab: React.FC<PlacementsTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  onJobOrderUpdated,
}) => {
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
          workforce: parsed.workforce || '',
        };
      }
    } catch (err) {
      console.error('Error loading persisted filters:', err);
    }
    // Default values
    return { shiftId: '', workforce: '' };
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
  const [placementUserIds, setPlacementUserIds] = useState<Set<string>>(new Set());
  const [userGroups, setUserGroups] = useState<Array<{ id: string; groupName: string }>>([]);
  const [confirmedApplicationsCount, setConfirmedApplicationsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // Track optimistically added placement IDs so onSnapshot doesn't overwrite them before Firestore confirms
  const pendingPlacementAddsRef = useRef<Set<string>>(new Set());

  // Load user groups for workforce dropdown
  useEffect(() => {
    const loadUserGroups = async () => {
      if (!tenantId) return;
      
      try {
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const groupsSnap = await getDocs(groupsRef);
        const groups = groupsSnap.docs.map(doc => ({
          id: doc.id,
          groupName: doc.data().groupName || doc.data().name || doc.id
        }));
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
        // Get today's date in YYYY-MM-DD format
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
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
        const shiftsSnap = await getDocs(shiftsRef);
        
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
        
        // Filter for shifts from today forward
        const upcomingShifts = allShifts.filter(shift => {
          const shiftDate: any = shift.shiftDate;
          if (!shiftDate) return false;
          
          // Handle both YYYY-MM-DD strings and Date objects/Timestamps
          let shiftDateStr: string;
          if (typeof shiftDate === 'string') {
            shiftDateStr = shiftDate.split('T')[0];
          } else if (shiftDate && typeof shiftDate === 'object') {
            // Check for Firestore Timestamp first
            if ('toDate' in shiftDate && typeof shiftDate.toDate === 'function') {
              // Firestore Timestamp
              shiftDateStr = shiftDate.toDate().toISOString().split('T')[0];
            } else if (shiftDate instanceof Date) {
              // Date object
              shiftDateStr = shiftDate.toISOString().split('T')[0];
            } else {
              return false;
            }
          } else {
            return false;
          }
          
          // Include shifts from today forward
          return shiftDateStr >= todayStr;
        }).sort((a, b) => {
          // Sort by date ascending (earliest first)
          const dateA = typeof a.shiftDate === 'string' ? a.shiftDate : a.shiftDate?.toDate?.()?.toISOString?.() || '';
          const dateB = typeof b.shiftDate === 'string' ? b.shiftDate : b.shiftDate?.toDate?.()?.toISOString?.() || '';
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

      setLoading(true);
      setError(null);
      try {
        let workforceUsers: Worker[] = [];

        const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
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

        if (selectedWorkforce === 'applicants') {
          // Load applicants for this job order AND this specific shift
          const applicationDocs = await loadApplicationDocs();
          
          // Filter applications to only those who applied for this specific shift
          const userIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            
            const hasShift = matchesSelectedShift(data);
            // Career applications often don't carry explicit shift linkage; allow them.
            const allowCareerWithoutShift = isCareerJob && !hasShiftMetadata(data);
            if (hasShift || allowCareerWithoutShift) {
              userIds.add(data.userId);
            }
          });
          
          // Load user documents with full profile data
          const userPromises = Array.from(userIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              return extractWorkerData(userSnap.data(), userId);
            }
            return null;
          });
          
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
          
        } else if (selectedWorkforce === 'candidates') {
          // Load candidates for this job order AND this specific shift
          // Candidates are applicants who have been marked as candidates (shortlist)
          const applicationDocs = await loadApplicationDocs();
          
          // Filter candidates to only those who applied for this specific shift
          const candidateUserIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId || data.candidate !== true) return;
            const status = String(data.status || 'submitted').toLowerCase();
            if (['withdrawn', 'deleted', 'rejected', 'waitlisted'].includes(status)) return;
            
            const hasShift = matchesSelectedShift(data);
            const allowCareerWithoutShift = isCareerJob && !hasShiftMetadata(data);
            if (hasShift || allowCareerWithoutShift) {
              candidateUserIds.add(data.userId);
            }
          });
          
          // Load user documents with full profile data
          const userPromises = Array.from(candidateUserIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              return extractWorkerData(userSnap.data(), userId);
            }
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
      return;
    }

    const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
    const assignmentsQuery = query(assignmentsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      assignmentsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextStatus = new Map<string, string>();
        const nextIds = new Map<string, string>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || data?.candidateId || '');
          const status = String(data?.status || 'proposed').toLowerCase();
          if (!userId) return;
          if (['declined', 'canceled', 'cancelled'].includes(status)) return;
          nextStatus.set(userId, status);
          nextIds.set(userId, docSnap.id);
        });
        setAssignmentStatusByUserId(nextStatus);
        setAssignmentIdByUserId(nextIds);
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
      },
      (err) => {
        console.warn('Placements onSnapshot error:', err);
      },
    );

    return () => unsubscribe();
  }, [tenantId, selectedShiftId]);

  const workforceOptions = useMemo(() => getWorkforceOptions(), [jobOrder, userGroups]);
  const safeSelectedShiftId = shifts.some((s) => s.id === selectedShiftId) ? selectedShiftId : '';
  const safeSelectedWorkforce = workforceOptions.some((o) => o.value === selectedWorkforce) ? selectedWorkforce : '';

  // Build workforce options: Applicants, Candidates, [last used group from Choose Group], labor pool groups, Choose Group
  function getWorkforceOptions() {
    const options: Array<{ value: string; label: string }> = [
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
      const createdCount = Array.isArray(data?.created) ? data.created.length : 0;
      const skipped = Array.isArray(data?.skipped) ? data.skipped : [];

      if (createdCount === 0 && skipped.length > 0) {
        setError(`No assignments created. ${skipped.map((s: any) => s.reason).join(', ')}`);
      } else {
        setError(null);
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
    try {
      setError(null);
      await assignWorkersToShift([worker.id]);
      await deletePlacement(worker);
    } catch (err: any) {
      console.error('Error offering position:', err);
      setError(err?.message || 'Failed to offer position');
    }
  };

  const selectedShift = shifts.find(s => s.id === selectedShiftId);
  const showContent = true; // Grid always visible; Workforce selector is in Worker Pool card, Shift selector is in Shift Details card
  // Placed = placement only (no Assignment). Assigned = has Assignment (offered, worker may accept/decline).
  const workersWithAssignmentState = useMemo(
    () =>
      workers.map((worker) => {
        const assignmentStatus = assignmentStatusByUserId.get(worker.id);
        const hasPlacement = placementUserIds.has(worker.id);
        const hasAssignment = Boolean(assignmentStatus);

        if (!hasPlacement && !hasAssignment) {
          return {
            ...worker,
            isAssignedToShift: false,
            isPlacementOnly: false,
            assignmentStatus: undefined,
            assignmentId: undefined,
            confirmationStatus: undefined,
          };
        }

        const confirmationStatus: 'accepted' | 'confirmed' | undefined =
          assignmentStatus && (assignmentStatus === 'confirmed' || assignmentStatus === 'active')
            ? 'confirmed'
            : assignmentStatus
              ? 'accepted'
              : undefined;
        return {
          ...worker,
          isAssignedToShift: true,
          isPlacementOnly: hasPlacement && !hasAssignment,
          assignmentStatus: assignmentStatus,
          assignmentId: assignmentIdByUserId.get(worker.id),
          confirmationStatus,
        };
      }),
    [workers, assignmentStatusByUserId, assignmentIdByUserId, placementUserIds],
  );
  const assignedWorkers = useMemo(
    () => workersWithAssignmentState.filter((worker) => worker.isAssignedToShift),
    [workersWithAssignmentState],
  );
  const unassignedWorkers = useMemo(
    () => workersWithAssignmentState.filter((worker) => !worker.isAssignedToShift),
    [workersWithAssignmentState],
  );
  const availableWorkers = unassignedWorkers;
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

  // Debug: Log shift data to help identify field names
  useEffect(() => {
    if (selectedShift) {
      console.log('Selected Shift Data:', selectedShift);
      console.log('Start Time:', (selectedShift as any).startTime || (selectedShift as any).defaultStartTime);
      console.log('End Time:', (selectedShift as any).endTime || (selectedShift as any).defaultEndTime);
      console.log('Staff Needed:', (selectedShift as any).staffNeeded || (selectedShift as any).totalStaffRequested || (selectedShift as any).workersNeeded);
    }
  }, [selectedShift]);

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

  const handleAssignmentsDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsAssignmentDragOver(false);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const worker = availableWorkers.find((w) => w.id === workerId);
    if (worker) {
      createPlacement(worker);
    }
  };

  const createPlacement = async (worker: Worker) => {
    if (!tenantId || !selectedShiftId || !jobOrderId || !user?.uid) {
      setError('Missing required information to place worker');
      return;
    }
    const placementId = `${selectedShiftId}__${worker.id}`;
    try {
      setError(null);
      // Optimistic update: show in Assignments immediately; track so onSnapshot doesn't overwrite
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
      // Revert optimistic update on error
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
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 700, mb: 1 }}>
        Placements for this Job Order
      </Typography>

      {/* Error Message */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Loading State */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Content Area - three column board */}
        {!loading && showContent && (
          <Grid container spacing={3}>
            {/* Left: Shift Details */}
            <Grid item xs={12} lg={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Shift Details
                  </Typography>
                  <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                    <InputLabel>Shift</InputLabel>
                    <Select
                      value={safeSelectedShiftId}
                      label="Shift"
                      onChange={(e) => setSelectedShiftId(e.target.value)}
                      disabled={loading || shifts.length === 0}
                    >
                      <MenuItem value="">
                        <em>Select shift</em>
                      </MenuItem>
                      {shifts.length === 0 ? (
                        <MenuItem disabled>
                          {loading ? 'Loading shifts...' : 'No upcoming shifts available'}
                        </MenuItem>
                      ) : (
                        shifts.map((shift) => {
                          const shiftDate: any = shift.shiftDate;
                          let formattedDate = '';
                          if (shiftDate) {
                            let date: Date;
                            if (typeof shiftDate === 'string') {
                              date = new Date(shiftDate);
                            } else if (shiftDate?.toDate && typeof shiftDate.toDate === 'function') {
                              date = shiftDate.toDate();
                            } else if (shiftDate instanceof Date) {
                              date = shiftDate;
                            } else {
                              date = new Date();
                            }
                            formattedDate = date.toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            });
                          }
                          return (
                            <MenuItem key={shift.id} value={shift.id}>
                              <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="body2" fontWeight={600}>
                                    {formattedDate}
                                  </Typography>
                                  {shift.spotsRemaining !== undefined && (
                                    <Chip
                                      size="small"
                                      label={`${shift.spotsRemaining} spots`}
                                      sx={{ ml: 1 }}
                                      color={shift.spotsRemaining > 0 ? 'success' : 'default'}
                                    />
                                  )}
                                </Box>
                                <Typography variant="caption" color="text.secondary">
                                  {shift.shiftTitle || 'Shift'} • {shift.startTime || ''} {shift.endTime ? `to ${shift.endTime}` : ''}
                                </Typography>
                              </Box>
                            </MenuItem>
                          );
                        })
                      )}
                    </Select>
                  </FormControl>
                  {selectedShift && (
                    <Stack spacing={1.25}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {selectedShift.shiftTitle || 'Shift'}
                      </Typography>
                      {(selectedShift as any).defaultJobTitle && (
                        <Typography variant="body2" color="text.secondary">
                          {(selectedShift as any).defaultJobTitle}
                        </Typography>
                      )}
                      <Paper variant="outlined" sx={{ p: 0.5, bgcolor: 'grey.50' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Date
                        </Typography>
                        <Typography variant="body2">
                          {(() => {
                            const shiftDate: any = selectedShift.shiftDate;
                            if (shiftDate) {
                              let date: Date;
                              if (typeof shiftDate === 'string') {
                                date = new Date(shiftDate);
                              } else if (shiftDate?.toDate && typeof shiftDate.toDate === 'function') {
                                date = shiftDate.toDate();
                              } else if (shiftDate instanceof Date) {
                                date = shiftDate;
                              } else {
                                return 'Unknown date';
                              }
                              return date.toLocaleDateString('en-US', { 
                                weekday: 'short', 
                                month: 'short', 
                                day: 'numeric',
                                year: 'numeric'
                              });
                            }
                            return 'No date';
                          })()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                          Time
                        </Typography>
                        {(() => {
                          const startTime = (selectedShift as any).startTime || (selectedShift as any).defaultStartTime;
                          const endTime = (selectedShift as any).endTime || (selectedShift as any).defaultEndTime;
                          if (startTime) {
                            const formatTime = (time: string) => {
                              if (!time) return '';
                              let hours: string, minutes: string;
                              if (time.includes(' ')) {
                                const parts = time.split(' ');
                                [hours, minutes] = parts[0].split(':');
                                const ampm = parts[1] || (parseInt(hours, 10) >= 12 ? 'PM' : 'AM');
                                const hour = parseInt(hours, 10);
                                const displayHour = hour % 12 || 12;
                                return `${displayHour}:${minutes || '00'} ${ampm}`;
                              } else {
                                // Format like "08:00"
                                [hours, minutes] = time.split(':');
                                const hour = parseInt(hours, 10);
                                const ampm = hour >= 12 ? 'PM' : 'AM';
                                const displayHour = hour % 12 || 12;
                                return `${displayHour}:${minutes || '00'} ${ampm}`;
                              }
                            };
                            const formattedStart = formatTime(startTime);
                            const formattedEnd = endTime ? formatTime(endTime) : null;
                            return (
                              <Typography variant="body2" fontWeight={600}>
                                {formattedEnd ? `${formattedStart} - ${formattedEnd}` : formattedStart}
                              </Typography>
                            );
                          }
                          return null;
                        })()}
                      </Paper>

                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {staffingTarget !== null && (
                          <Chip
                            size="small"
                            label={`${staffingFilled}/${staffingTarget} confirmed`}
                            color={staffingFilled >= staffingTarget ? 'success' : staffingFilled > 0 ? 'info' : 'default'}
                            variant="outlined"
                          />
                        )}
                        {selectedShift.spotsRemaining !== undefined && (
                          <Chip
                            size="small"
                            label={`${selectedShift.spotsRemaining} open`}
                            color={selectedShift.spotsRemaining > 0 ? 'warning' : 'success'}
                            variant="outlined"
                          />
                        )}
                        {confirmedApplicationsCount > 0 && (
                          <Chip
                            size="small"
                            label={`${confirmedApplicationsCount} app confirmed`}
                            variant="outlined"
                          />
                        )}
                      </Stack>

                      {(selectedShift as any).payRate && (
                        <Typography variant="body2">
                          Pay: <strong>${(selectedShift as any).payRate}/hr</strong>
                        </Typography>
                      )}

                      {(selectedShift as any).poNumber && (
                        <Typography variant="body2" color="text.secondary">
                          PO: {(selectedShift as any).poNumber}
                        </Typography>
                      )}

                      {(selectedShift as any).shiftDescription && (
                        <Tooltip
                          title={
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>
                              {(selectedShift as any).shiftDescription}
                            </Typography>
                          }
                          arrow
                        >
                          <Typography variant="caption" color="text.secondary" sx={{ cursor: 'help' }}>
                            Hover for shift notes
                          </Typography>
                        </Tooltip>
                      )}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Center: Assignments */}
            <Grid item xs={12} lg={4}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Assignments ({assignedWorkers.length})
                  </Typography>
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
                      {assignedWorkers.map((worker) => {
                        const isPlacementOnly = Boolean(worker.isPlacementOnly);
                        // Placed = placement only (no offer sent). Assigned = offer sent, awaiting response. Confirmed = worker accepted.
                        const isOfferPending = worker.assignmentStatus && ['proposed', 'accepted'].includes(worker.assignmentStatus);
                        const isConfirmed = worker.assignmentStatus && ['confirmed', 'active'].includes(worker.assignmentStatus);
                        const statusLabel = isPlacementOnly ? 'Placed' : isConfirmed ? 'Confirmed' : 'Assigned';
                        const statusColor = isPlacementOnly ? 'info' : isConfirmed ? 'success' : 'primary';
                        const canDragBackToPool = isPlacementOnly; // Only placement-only (no Assignment) can be dragged back
                        const useUnlockedIcon = isPlacementOnly; // Placement-only = unlocked; Assigned/Confirmed = locked
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
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>
                                {worker.displayName}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {[worker.city, worker.state].filter(Boolean).join(', ') || 'Location unavailable'}
                              </Typography>
                            </Box>
                            <Tooltip title={isPlacementOnly ? 'Click to offer position (sends accept/decline message)' : undefined}>
                              <Chip
                                size="small"
                                label={statusLabel}
                                color={statusColor}
                                icon={useUnlockedIcon ? <UnlockedIcon fontSize="small" /> : <LockedIcon fontSize="small" />}
                                onClick={isPlacementOnly ? () => handleConfirmPlacement(worker) : undefined}
                                sx={{
                                  ...(isPlacementOnly && {
                                    cursor: 'pointer',
                                    zIndex: 50,
                                    position: 'relative',
                                    '&:hover': { opacity: 0.9 },
                                  }),
                                }}
                              />
                            </Tooltip>
                          </Paper>
                        );
                      })}
                      {assignedWorkers.length === 0 && (
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
            <Grid item xs={12} lg={5}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
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
                        {workforceOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
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
                      <InputLabel>Group</InputLabel>
                      <Select
                        value=""
                        label="Group"
                        displayEmpty
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
      </Box>
  );
};

export default PlacementsTab;

