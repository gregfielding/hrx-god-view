import React, { useState, useEffect } from 'react';
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
  TextField,
  Autocomplete,
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
  Divider,
} from '@mui/material';
import {
  Description as ResumeIcon,
  Info as BioIcon,
  Work as WorkHistoryIcon,
  School as CertIcon,
  Badge as LicenseIcon,
} from '@mui/icons-material';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { sendWorkerMessage } from '../../utils/phoneVerificationTwilio';

interface PlacementsTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: JobOrder | null;
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
  isAssignedToShift?: boolean; // Track if worker is assigned to the selected shift
  confirmationStatus?: 'accepted' | 'confirmed'; // Track confirmation status
}

const PlacementsTab: React.FC<PlacementsTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
}) => {
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

      setLoading(true);
      setError(null);
      try {
        let workforceUsers: Worker[] = [];

        if (selectedWorkforce === 'applicants') {
          // Load applicants for this job order AND this specific shift
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const applicationsQuery = query(
            applicationsRef,
            where('jobOrderId', '==', jobOrderId)
          );
          const applicationsSnap = await getDocs(applicationsQuery);
          
          // Filter applications to only those who applied for this specific shift
          const userIds = new Set<string>();
          applicationsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (!data.userId) return;
            
            // Check if this applicant applied for the selected shift
            // Applications can have shiftId (single) or shiftIds (array) or selectedShifts (array)
            const hasShift = 
              data.shiftId === selectedShiftId ||
              (Array.isArray(data.shiftIds) && data.shiftIds.includes(selectedShiftId)) ||
              (Array.isArray(data.selectedShifts) && data.selectedShifts.some((s: any) => 
                s.shiftId === selectedShiftId || s.id === selectedShiftId
              ));
            
            if (hasShift) {
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
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const applicationsQuery = query(
            applicationsRef,
            where('jobOrderId', '==', jobOrderId),
            where('candidate', '==', true)  // Filter for applications marked as candidates
          );
          const applicationsSnap = await getDocs(applicationsQuery);
          
          // Filter candidates to only those who applied for this specific shift
          const candidateUserIds = new Set<string>();
          applicationsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (!data.userId || data.status === 'rejected') return;
            
            // Check if this candidate applied for the selected shift
            // Applications can have shiftId (single) or shiftIds (array) or selectedShifts (array)
            const hasShift = 
              data.shiftId === selectedShiftId ||
              (Array.isArray(data.shiftIds) && data.shiftIds.includes(selectedShiftId)) ||
              (Array.isArray(data.selectedShifts) && data.selectedShifts.some((s: any) => 
                s.shiftId === selectedShiftId || s.id === selectedShiftId
              ));
            
            if (hasShift) {
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
        
        // Check assignment status for each worker if a shift is selected
        if (selectedShiftId && workforceUsers.length > 0) {
          // PRIMARY METHOD: Check assignments collection (source of truth)
          const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
          
          // Query all assignments for this shift
          const assignmentsQuery = query(
            assignmentsRef,
            where('shiftId', '==', selectedShiftId)
          );
          
          try {
            const assignmentsSnapshot = await getDocs(assignmentsQuery);
            const assignmentsMap = new Map<string, { status: string; assignmentId: string }>();
            
            // Build map of userId -> assignment status
            assignmentsSnapshot.docs.forEach(doc => {
              const assignmentData = doc.data();
              const userId = assignmentData.userId || assignmentData.candidateId;
              if (userId) {
                assignmentsMap.set(userId, {
                  status: assignmentData.status || 'proposed',
                  assignmentId: doc.id
                });
              }
            });
            
            // Check each worker's assignment status from assignments collection
            const workersWithAssignments = workforceUsers.map((worker) => {
              const assignment = assignmentsMap.get(worker.id);
              if (assignment) {
                const status = assignment.status;
                let confirmationStatus: 'accepted' | 'confirmed' | undefined = undefined;
                
                // Map assignment statuses to confirmation status
                if (status === 'confirmed' || status === 'active') {
                  confirmationStatus = 'confirmed';
                } else if (status === 'proposed' || status === 'accepted') {
                  confirmationStatus = 'accepted';
                }
                
                return {
                  ...worker,
                  isAssignedToShift: true,
                  confirmationStatus
                };
              }
              
              // If not found in assignments, check applications as fallback
              return { ...worker, isAssignedToShift: false, confirmationStatus: undefined };
            });
            
            setWorkers(workersWithAssignments);
          } catch (assignmentErr: any) {
            console.warn('Error checking assignments collection, falling back to applications:', assignmentErr);
            // Fallback: Keep existing application-based check logic
            setWorkers(workforceUsers);
          }
        } else {
          setWorkers(workforceUsers);
        }
      } catch (err: any) {
        console.error('Error loading workforce:', err);
        setError(err.message || 'Failed to load workforce');
      } finally {
        setLoading(false);
      }
    };

    loadWorkforce();
  }, [tenantId, jobOrderId, selectedWorkforce, selectedShiftId]);

  // Build workforce options based on job order labor pool and visibility settings
  const getWorkforceOptions = () => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'applicants', label: 'Applicants' },
      { value: 'candidates', label: 'Candidates' },
    ];
    
    // Get labor pool groups from job order (preferred)
    // This is the dedicated "Labor Pool" setting for the job order
    const laborPoolGroups = (jobOrder as any)?.laborPoolGroups || [];
    
    // Also check legacy job posting visibility groups for backwards compatibility
    const visibility = jobOrder?.visibility || (jobOrder as any)?.jobsBoardVisibility;
    const restrictedGroups = jobOrder?.restrictedGroups || [];
    
    // Combine both sources of groups (labor pool + posting visibility)
    const allGroupIds = new Set<string>([
      ...laborPoolGroups,
      ...(visibility === 'group_restricted' ? restrictedGroups : [])
    ]);
    
    // Add each unique group to the options
    if (allGroupIds.size > 0) {
      allGroupIds.forEach((groupId: string) => {
        const group = userGroups.find(g => g.id === groupId);
        if (group) {
          options.push({
            value: `group_${groupId}`,
            label: group.groupName
          });
        }
      });
    }
    
    return options;
  };

  // Handle assign to shift
  const handleAssignToShift = async (worker: Worker, shift: Shift | undefined) => {
    if (!shift || !worker.id || !tenantId || !jobOrderId) {
      setError('Missing required information to assign shift');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Find the application document for this worker + job
      // Applications are stored at tenants/{tenantId}/applications/{applicationId}
      // Where applicationId format is: {userId}_{jobId}
      // We need to find applications by userId and jobOrderId (for gig jobs)
      
      // First, get the job posting ID from the job order
      const jobPostingsRef = collection(db, 'tenants', tenantId, 'job_postings');
      const jobPostingsQuery = query(
        jobPostingsRef,
        where('jobOrderId', '==', jobOrderId)
      );
      const jobPostingsSnapshot = await getDocs(jobPostingsQuery);
      
      if (jobPostingsSnapshot.empty) {
        throw new Error('Job posting not found for this job order');
      }
      
      const jobPosting = jobPostingsSnapshot.docs[0];
      const jobPostId = jobPosting.id;
      
      // Try to find existing application
      // Application ID format is: {userId}_{jobId}
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      const applicationId = `${worker.id}_${jobPostId}`;
      let applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
      
      // Check if application exists, if not, also try querying by userId and jobOrderId
      let applicationDoc = await getDoc(applicationRef);
      
      if (!applicationDoc.exists()) {
        // Try to find by userId and jobOrderId
        const applicationQuery = query(
          applicationsRef,
          where('userId', '==', worker.id),
          where('jobOrderId', '==', jobOrderId)
        );
        const applicationSnapshot = await getDocs(applicationQuery);
        
        if (!applicationSnapshot.empty) {
          applicationDoc = applicationSnapshot.docs[0];
          applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationDoc.id);
        } else {
          throw new Error('Application not found. Worker must apply first.');
        }
      }

      // Update application status to "accepted" and ensure shiftId is set
      const updateData: any = {
        status: 'accepted',
        updatedAt: serverTimestamp(),
      };
      
      // Ensure shiftId is set (for tracking which shift was accepted)
      const appData = applicationDoc.data();
      if (appData.shiftId && appData.shiftId !== shift.id) {
        // If there's already a different shiftId, add this one to shiftIds instead
        const existingShiftIds = Array.isArray(appData.shiftIds) ? appData.shiftIds : [];
        if (!existingShiftIds.includes(shift.id)) {
          updateData.shiftIds = [...existingShiftIds, shift.id];
        }
      } else if (!appData.shiftId) {
        updateData.shiftId = shift.id;
      }
      
      await updateDoc(applicationRef, updateData);
      
      // ========================================================================
      // CHECK FOR DUPLICATE ASSIGNMENT BEFORE CREATING
      // ========================================================================
      const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
      const duplicateCheckQuery = query(
        assignmentsRef,
        where('userId', '==', worker.id),
        where('shiftId', '==', shift.id)
      );
      const duplicateSnapshot = await getDocs(duplicateCheckQuery);
      
      if (!duplicateSnapshot.empty) {
        console.warn(`Assignment already exists for worker ${worker.id} on shift ${shift.id}`);
        setError(`Worker ${worker.displayName} is already assigned to this shift.`);
        setLoading(false);
        return;
      }
      
      // ========================================================================
      // CREATE ACTUAL ASSIGNMENT DOCUMENT with all required denormalized fields
      // ========================================================================
      
      // Fetch job order to get company info and location (using canonical path)
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);
      if (!jobOrderSnap.exists()) {
        throw new Error('Job order not found');
      }
      const jobOrderData = jobOrderSnap.data();
      
      // Fetch location details for coords and nickname
      const locationId = jobOrder?.worksiteId || jobOrderData.worksiteId || jobOrderData.locationId;
      if (!locationId) {
        throw new Error('Job order missing location/worksite ID');
      }
      
      const locationRef = doc(db, 'tenants', tenantId, 'locations', locationId);
      const locationSnap = await getDoc(locationRef);
      const locationData = locationSnap.exists() ? locationSnap.data() : {};
      const locationNickname = locationData.nickname || locationData.title || locationId;
      const latitude = locationData.latitude || locationData.lat || null;
      const longitude = locationData.longitude || locationData.lng || null;
      
      if (!latitude || !longitude) {
        console.warn('Location missing coordinates:', locationId);
      }
      
      // Create assignment document with ALL required fields
      await addDoc(collection(db, 'tenants', tenantId, 'assignments'), {
        // Core references
        tenantId,
        jobOrderId,
        shiftId: shift.id,
        candidateId: worker.id,
        userId: worker.id,
        applicationId: applicationDoc.id,
        
        // Status and dates
        status: 'confirmed', // Placements start as confirmed
        startDate: shift.shiftDate || '',
        endDate: shift.shiftDate || '', // Gig jobs typically single-day
        
        // Rates (from shift or job order)
        payRate: (shift as any).payRate || jobOrderData.payRate || 0,
        billRate: (shift as any).billRate || jobOrderData.billRate || 0,
        
        // Timesheet mode
        timesheetMode: jobOrderData.timesheetMode || 'mobile',
        
        // Worker information (denormalized - required)
        firstName: worker.firstName || worker.displayName?.split(' ')[0] || '',
        lastName: worker.lastName || worker.displayName?.split(' ').slice(1).join(' ') || '',
        email: worker.email || '',
        phone: worker.phone || '',
        
        // Company information (denormalized - required)
        companyId: jobOrderData.companyId || '',
        companyName: jobOrderData.companyName || '',
        companyTitle: jobOrderData.companyName || '',
        
        // Location information (denormalized - required)
        locationId: locationId,
        locationIds: [locationId],
        locationNickname: locationNickname,
        worksiteName: locationNickname,
        latitude: latitude,
        longitude: longitude,
        
        // Job information (denormalized - required)
        jobOrderType: jobOrderData.jobType || 'gig',
        jobTitle: (shift as any).defaultJobTitle || jobOrderData.jobTitle || '',
        shiftTitle: (shift as any).shiftTitle || '',
        
        // Audit fields
        createdBy: 'system', // TODO: Get actual current user ID
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        assignedAt: serverTimestamp(),
      });
      
      console.log(`✅ Assignment created for worker ${worker.id} on shift ${shift.id}`);

      // Get shift details for SMS
      const shiftDate: any = shift.shiftDate;
      let formattedDate = '';
      if (shiftDate) {
        let date: Date;
        if (shiftDate instanceof Date) {
          date = shiftDate;
        } else if (typeof shiftDate === 'string') {
          date = new Date(shiftDate);
        } else if (shiftDate?.toDate && typeof shiftDate.toDate === 'function') {
          date = shiftDate.toDate();
        } else {
          date = new Date();
        }
        formattedDate = date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }

      // Format time
      const formatTime = (time: any) => {
        if (!time) return '';
        if (typeof time === 'string') {
          // Handle "HH:MM" format
          const [hour, minute] = time.split(':');
          const hourNum = parseInt(hour, 10);
          const ampm = hourNum >= 12 ? 'PM' : 'AM';
          const displayHour = hourNum % 12 || 12;
          return `${displayHour}:${minute || '00'} ${ampm}`;
        }
        return time.toString();
      };

      const startTime = formatTime(shift.startTime);
      const endTime = shift.endTime ? formatTime(shift.endTime) : '';
      const timeRange = endTime ? `${startTime} to ${endTime}` : startTime;

      // Get job title
      const jobTitle = (shift as any).defaultJobTitle || jobOrder?.jobTitle || 'this position';

      // Get worksite location name
      let worksiteName = '';
      if (jobOrder?.worksiteId && tenantId) {
        try {
          const locationRef = doc(db, 'tenants', tenantId, 'locations', jobOrder.worksiteId);
          const locationDoc = await getDoc(locationRef);
          if (locationDoc.exists()) {
            const locationData = locationDoc.data();
            worksiteName = locationData.nickname || locationData.title || jobOrder.worksiteId;
          }
        } catch (err) {
          console.warn('Failed to fetch worksite name:', err);
        }
      }
      if (!worksiteName && jobOrder?.worksiteName) {
        worksiteName = jobOrder.worksiteName;
      }

      // Get worker's phone number in E.164 format
      let phone: string | null = null;
      if (worker.phone) {
        if (worker.phone.startsWith('+')) {
          phone = worker.phone;
        } else {
          // Format as US number (+1)
          const digits = worker.phone.replace(/\D/g, '');
          if (digits.length === 10) {
            phone = `+1${digits}`;
          } else if (digits.length === 11 && digits.startsWith('1')) {
            phone = `+${digits}`;
          }
        }
      }

      if (!phone) {
        throw new Error('Worker phone number not available');
      }

      // Generate job posting URL
      // The URL should be the public job board detail page
      const baseUrl = window.location.origin;
      const jobUrl = `${baseUrl}/c1/jobs-board/${jobPostId}`;

      // Create SMS message
      const firstName = worker.firstName || worker.displayName?.split(' ')[0] || 'there';
      const message = `Hi ${firstName}, you've been accepted for ${jobTitle} on ${formattedDate} from ${timeRange}${worksiteName ? ` at ${worksiteName}` : ''}. Please confirm your assignment: ${jobUrl}`;

      // Send SMS
      let smsSuccess = false;
      try {
        await sendWorkerMessage(phone, message);
        smsSuccess = true;
      } catch (smsError: any) {
        console.error('Failed to send SMS:', smsError);
        // Don't throw - status update succeeded even if SMS fails
        smsSuccess = false;
      }

      // Refresh confirmed applications count - need to check both shiftId and shiftIds
      if (selectedShiftId) {
        // Query for applications with shiftId
        const shiftIdQuery = query(
          applicationsRef,
          where('status', '==', 'accepted'),
          where('shiftId', '==', selectedShiftId)
        );
        
        // Query for applications with shiftIds array containing this shift
        const shiftIdsQuery = query(
          applicationsRef,
          where('status', '==', 'accepted')
        );
        
        const [shiftIdSnapshot, shiftIdsSnapshot] = await Promise.all([
          getDocs(shiftIdQuery),
          getDocs(shiftIdsQuery)
        ]);
        
        // Count unique applications that match this shift
        const matchingAppIds = new Set<string>();
        shiftIdSnapshot.forEach(doc => matchingAppIds.add(doc.id));
        shiftIdsSnapshot.forEach(doc => {
          const data = doc.data();
          if (Array.isArray(data.shiftIds) && data.shiftIds.includes(selectedShiftId)) {
            matchingAppIds.add(doc.id);
          }
        });
        
        setConfirmedApplicationsCount(matchingAppIds.size);
      }

      // Show success message with SMS status
      if (smsSuccess) {
        setError(null);
        alert(`Successfully assigned ${worker.displayName} to shift. SMS notification sent.`);
      } else {
        setError('Shift assigned, but SMS notification failed. Please notify the worker manually.');
        alert(`Successfully assigned ${worker.displayName} to shift. However, SMS notification failed - please notify the worker manually.`);
      }
      
      // Reload workers to update assignment status
      // Trigger reload by updating selectedShiftId (temporarily) or reloading workforce
      const currentShiftId = selectedShiftId;
      setSelectedShiftId(''); // Clear to trigger reload
      setTimeout(() => {
        setSelectedShiftId(currentShiftId); // Restore to trigger reload with updated data
      }, 100);
      
    } catch (err: any) {
      console.error('Error assigning to shift:', err);
      setError(err.message || 'Failed to assign worker to shift');
    } finally {
      setLoading(false);
    }
  };

  const selectedShift = shifts.find(s => s.id === selectedShiftId);
  const showContent = selectedShiftId && selectedWorkforce && workers.length > 0;

  // Debug: Log shift data to help identify field names
  useEffect(() => {
    if (selectedShift) {
      console.log('Selected Shift Data:', selectedShift);
      console.log('Start Time:', (selectedShift as any).startTime || (selectedShift as any).defaultStartTime);
      console.log('End Time:', (selectedShift as any).endTime || (selectedShift as any).defaultEndTime);
      console.log('Staff Needed:', (selectedShift as any).staffNeeded || (selectedShift as any).totalStaffRequested || (selectedShift as any).workersNeeded);
    }
  }, [selectedShift]);

  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 700, mb: 3 }}>
        Placements for this Job Order
      </Typography>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Select a shift and workforce to view and manage placements
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
              {/* Shift Picker - Shows all upcoming shifts */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Shift</InputLabel>
                  <Select
                    value={selectedShiftId}
                    label="Shift"
                    onChange={(e) => setSelectedShiftId(e.target.value)}
                    disabled={loading || shifts.length === 0}
                  >
                    {shifts.length === 0 ? (
                      <MenuItem disabled>
                        {loading ? 'Loading shifts...' : 'No upcoming shifts available'}
                      </MenuItem>
                    ) : (
                      shifts.map((shift) => {
                        // Format the date for display
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
                            year: 'numeric'
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
              </Grid>

              {/* Workforce Dropdown */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Workforce</InputLabel>
                  <Select
                    value={selectedWorkforce}
                    label="Workforce"
                    onChange={(e) => setSelectedWorkforce(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Select workforce</em>
                    </MenuItem>
                    {getWorkforceOptions().map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

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

        {/* Content Area - Shows selected shift and workers */}
        {!loading && showContent && (
          <Grid container spacing={3}>
            {/* Selected Shift Info */}
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Selected Shift
                  </Typography>
                  {selectedShift && (
                    <Stack spacing={2}>
                      {/* Shift Title */}
                      <Typography variant="body1" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
                        {selectedShift.shiftTitle || 'Shift'}
                      </Typography>
                      
                      {/* Job Title */}
                      {(selectedShift as any).defaultJobTitle && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Job Title
                          </Typography>
                          <Typography variant="body2" fontWeight={500}>
                            {(selectedShift as any).defaultJobTitle}
                          </Typography>
                        </Box>
                      )}
                      
                      {/* Date and Time */}
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          Date & Time
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
                        {(() => {
                          // Check for startTime in various possible field names
                          const startTime = (selectedShift as any).startTime || (selectedShift as any).defaultStartTime;
                          const endTime = (selectedShift as any).endTime || (selectedShift as any).defaultEndTime;
                          
                          if (startTime) {
                            const formatTime = (time: string) => {
                              if (!time) return '';
                              // Handle formats like "08:00", "08:00 AM", "8:00 AM"
                              let hours: string, minutes: string;
                              if (time.includes(' ')) {
                                // Format like "08:00 AM"
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
                              <Typography variant="body2" fontWeight={500} sx={{ mt: 0.5 }}>
                                {formattedEnd ? `${formattedStart} - ${formattedEnd}` : formattedStart}
                              </Typography>
                            );
                          }
                          return null;
                        })()}
                      </Box>
                      
                      {/* Staff Needed */}
                      {(() => {
                        // Check for staffNeeded in various possible field names
                        const staffNeeded = (selectedShift as any).staffNeeded || (selectedShift as any).totalStaffRequested || (selectedShift as any).workersNeeded;
                        if (staffNeeded !== undefined && staffNeeded !== null) {
                          return (
                            <Box>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Staff Needed
                              </Typography>
                              <Typography variant="body2" fontWeight={500}>
                                {staffNeeded}
                              </Typography>
                            </Box>
                          );
                        }
                        return null;
                      })()}
                      
                      {/* Staffing Info */}
                      {(() => {
                        const staffNeeded = (selectedShift as any).staffNeeded || (selectedShift as any).totalStaffRequested || (selectedShift as any).workersNeeded;
                        if (selectedShift.spotsRemaining !== undefined || confirmedApplicationsCount > 0 || staffNeeded !== undefined) {
                          return (
                            <Box>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Staffing
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', flexDirection: 'column' }}>
                                {staffNeeded !== undefined && (
                                  <Chip 
                                    label={`${confirmedApplicationsCount}/${staffNeeded} confirmed`}
                                    size="small"
                                    color={confirmedApplicationsCount >= staffNeeded ? 'success' : confirmedApplicationsCount > 0 ? 'info' : 'default'}
                                    variant="outlined"
                                    sx={{ width: 'fit-content' }}
                                  />
                                )}
                                {selectedShift.spotsRemaining !== undefined && selectedShift.spotsRemaining !== confirmedApplicationsCount && (
                                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                    {selectedShift.spotsRemaining} spots remaining
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          );
                        }
                        return null;
                      })()}
                      
                      {/* Pay Rate */}
                      {(selectedShift as any).payRate && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Pay Rate
                          </Typography>
                          <Typography variant="body2" fontWeight={500}>
                            ${(selectedShift as any).payRate}/hr
                          </Typography>
                        </Box>
                      )}
                      
                      {/* PO Number */}
                      {(selectedShift as any).poNumber && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            PO Number
                          </Typography>
                          <Typography variant="body2">
                            {(selectedShift as any).poNumber}
                          </Typography>
                        </Box>
                      )}
                      
                      {/* Shift Description */}
                      {(selectedShift as any).shiftDescription && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Shift Details
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                            {(selectedShift as any).shiftDescription}
                          </Typography>
                        </Box>
                      )}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Workers List */}
            <Grid item xs={12} md={8}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Available Workers ({workers.length})
                  </Typography>
                  {workers.length === 0 ? (
                    <Alert severity="info">
                      No workers available for the selected workforce option.
                    </Alert>
                  ) : (
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      {workers.map((worker) => {
                        // Generate resume URL from storagePath if needed
                        const getResumeUrl = () => {
                          if (worker.resumeUrl) return worker.resumeUrl;
                          if (worker.resume?.downloadUrl) return worker.resume.downloadUrl;
                          if (worker.resume?.storagePath) {
                            // Generate public URL from storage path
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
                            sx={{
                              p: 2,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                              {/* Left side - Main info */}
                              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <Box>
                                  <Typography variant="body1" fontWeight={500}>
                                    {worker.displayName}
                                  </Typography>
                                  {(worker.city || worker.state) && (
                                    <Typography variant="body2" color="text.secondary">
                                      {[worker.city, worker.state].filter(Boolean).join(', ')}
                                    </Typography>
                                  )}
                                </Box>

                                {/* Contact Info */}
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                                  {worker.email && (
                                    <Typography variant="body2" color="text.secondary">
                                      {worker.email}
                                    </Typography>
                                  )}
                                  {worker.phone && (
                                    <Typography variant="body2" color="text.secondary">
                                      {worker.phone}
                                    </Typography>
                                  )}
                                </Box>

                                {/* Skills and Languages in horizontal layout */}
                                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {/* Skills */}
                                  {worker.skills && worker.skills.length > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                        Skills:
                                      </Typography>
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {worker.skills.slice(0, 4).map((skill, idx) => (
                                          <Chip
                                            key={idx}
                                            label={skill}
                                            size="small"
                                            sx={{ fontSize: '0.7rem', height: 22 }}
                                          />
                                        ))}
                                        {worker.skills.length > 4 && (
                                          <Chip
                                            label={`+${worker.skills.length - 4}`}
                                            size="small"
                                            sx={{ fontSize: '0.7rem', height: 22 }}
                                          />
                                        )}
                                      </Box>
                                    </Box>
                                  )}

                                  {/* Languages */}
                                  {worker.languages && worker.languages.length > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                        Languages:
                                      </Typography>
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {worker.languages.slice(0, 3).map((lang, idx) => (
                                          <Chip
                                            key={idx}
                                            label={lang}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontSize: '0.7rem', height: 22 }}
                                          />
                                        ))}
                                        {worker.languages.length > 3 && (
                                          <Chip
                                            label={`+${worker.languages.length - 3}`}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontSize: '0.7rem', height: 22 }}
                                          />
                                        )}
                                      </Box>
                                    </Box>
                                  )}
                                </Box>

                                {/* AI Scores */}
                                {(worker.aiProfileScore !== undefined || worker.aiJobFitScore !== undefined) && (
                                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    {worker.aiProfileScore !== undefined && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                          Profile:
                                        </Typography>
                                        <Chip
                                          label={worker.aiProfileScore}
                                          size="small"
                                          color={worker.aiProfileScore >= 70 ? 'success' : worker.aiProfileScore >= 50 ? 'warning' : 'default'}
                                          sx={{ fontSize: '0.7rem', height: 22, fontWeight: 600 }}
                                        />
                                      </Box>
                                    )}
                                    {worker.aiJobFitScore !== undefined && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                          Job Fit:
                                        </Typography>
                                        <Chip
                                          label={worker.aiJobFitScore}
                                          size="small"
                                          color={worker.aiJobFitScore >= 70 ? 'success' : worker.aiJobFitScore >= 50 ? 'warning' : 'default'}
                                          sx={{ fontSize: '0.7rem', height: 22, fontWeight: 600 }}
                                        />
                                      </Box>
                                    )}
                                  </Box>
                                )}
                              </Box>

                              {/* Right side - Icons and status */}
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {/* Work Eligibility */}
                                <Chip
                                  label={worker.workEligibility ? 'Eligible' : 'Not Eligible'}
                                  size="small"
                                  color={worker.workEligibility ? 'success' : 'error'}
                                  variant="outlined"
                                  sx={{ fontSize: '0.75rem' }}
                                />

                                {/* Icons */}
                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                  {/* Resume Link */}
                                  {resumeUrl && (
                                    <Tooltip title="View Resume">
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

                                  {/* Bio Tooltip */}
                                  {hasBio && (
                                    <Tooltip
                                      title={
                                        <Box>
                                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Bio</Typography>
                                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxWidth: 300 }}>
                                            {worker.bio}
                                          </Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <IconButton size="small">
                                        <BioIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}

                                  {/* Work History Tooltip */}
                                  {hasWorkHistory && (
                                    <Tooltip
                                      title={
                                        <Box>
                                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Work History</Typography>
                                          <Box sx={{ maxHeight: 300, overflowY: 'auto', maxWidth: 350 }}>
                                            {worker.workHistory?.slice(0, 3).map((job: any, idx: number) => (
                                              <Box key={idx} sx={{ mb: 1 }}>
                                                <Typography variant="body2" fontWeight={600}>
                                                  {job.position || job.title || job.role || 'Position'}
                                                  {job.company && ` at ${job.company}`}
                                                </Typography>
                                                {job.description && (
                                                  <Typography variant="caption" color="text.secondary">
                                                    {job.description.length > 100 
                                                      ? `${job.description.substring(0, 100)}...` 
                                                      : job.description}
                                                  </Typography>
                                                )}
                                              </Box>
                                            ))}
                                            {worker.workHistory && worker.workHistory.length > 3 && (
                                              <Typography variant="caption" color="text.secondary">
                                                +{worker.workHistory.length - 3} more
                                              </Typography>
                                            )}
                                          </Box>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <IconButton size="small">
                                        <WorkHistoryIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}

                                  {/* Certifications */}
                                  {hasCerts && (
                                    <Tooltip title={`${worker.certifications?.length} Certification${(worker.certifications?.length || 0) > 1 ? 's' : ''}`}>
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

                                  {/* Licenses */}
                                  {hasLicenses && (
                                    <Tooltip title={`${worker.licenses?.length} License${(worker.licenses?.length || 0) > 1 ? 's' : ''}`}>
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
                                </Box>

                                {/* Action Button */}
                                <Button 
                                  variant="contained"
                                  color={worker.isAssignedToShift ? "success" : "primary"}
                                  size="small"
                                  onClick={() => handleAssignToShift(worker, selectedShift)}
                                  disabled={!selectedShift || worker.isAssignedToShift}
                                  sx={worker.isAssignedToShift ? {
                                    backgroundColor: worker.confirmationStatus === 'confirmed' ? '#2e7d32' : worker.confirmationStatus === 'accepted' ? '#2196F3' : '#2e7d32',
                                    color: '#fff',
                                    '&:hover': {
                                      backgroundColor: worker.confirmationStatus === 'confirmed' ? '#1b5e20' : worker.confirmationStatus === 'accepted' ? '#1976d2' : '#1b5e20',
                                    },
                                    '&:disabled': {
                                      backgroundColor: worker.confirmationStatus === 'confirmed' ? '#2e7d32' : worker.confirmationStatus === 'accepted' ? '#2196F3' : '#2e7d32',
                                      color: '#fff',
                                    }
                                  } : {}}
                                >
                                  {worker.isAssignedToShift 
                                    ? (worker.confirmationStatus === 'confirmed' 
                                        ? "Confirmed" 
                                        : worker.confirmationStatus === 'accepted' 
                                        ? "Accepted" 
                                        : "Assigned")
                                    : "Assign to Shift"}
                                </Button>
                              </Box>
                            </Paper>
                        );
                      })}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Empty State */}
        {!loading && !showContent && !error && (
          <Alert severity="info">
            Please select a shift and workforce option to view placements.
          </Alert>
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

