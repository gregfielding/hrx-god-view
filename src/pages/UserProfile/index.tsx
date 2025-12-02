import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button, Paper, Alert, Badge } from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc, collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';

import { db } from '../../firebase'; // adjust path
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';
import { useAuth } from '../../contexts/AuthContext';
import { calculateProfileScore } from '../../utils/applicantScoring';
import { userProfileBatcher, flushProfileUpdates } from '../../utils/userProfileBatching';
import { isOnboardingInProgress } from './utils/onboardingHelpers';

import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';
import SkillsTab, { CombinedBackgroundAndVaccinationTab } from './components/SkillsTab';
import SkillsOnlyTab from './components/SkillsOnlyTab';
import WorkEligibilityTab from './components/WorkEligibilityTab';
import QualificationsTab from './components/QualificationsTab';
import InterviewTab from './components/InterviewTab';
import ReportsAndInsightsTab from './components/ReportsAndInsightsTab';
import NotesTab from './components/NotesTab';
import ActivityLogTab from './components/ActivityLogTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';
import SystemAccessTab from './components/SystemAccessTab';
import OnboardingTab from './components/OnboardingTab';
import UserApplicationsTab from './components/UserApplicationsTab';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { user, securityLevel, role, tenantId: authTenantId, activeTenant } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Initialize profile batcher and flush on navigation
  useEffect(() => {
    userProfileBatcher.initialize();
    
    // Flush on component unmount (navigation away)
    return () => {
      flushProfileUpdates(true);
    };
  }, []);
  
  // Debug logging
  console.log('UserProfile Debug:', {
    currentUserUid: user?.uid,
    targetUserUid: uid,
    securityLevel,
    role,
    isOwnProfile: user?.uid === uid
  });
  
  const [tabValue, setTabValue] = useState<string>('Overview');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredName, setPreferredName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [skillsData, setSkillsData] = useState<any>(null);
  const [eVerifyOrders, setEVerifyOrders] = useState<Array<{ id: string; dateSubmitted: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [backgroundCheckOrders, setBackgroundCheckOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [drugScreeningOrders, setDrugScreeningOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [additionalScreeningOrders, setAdditionalScreeningOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [linkedinUrl, setLinkedinUrl] = useState<string>('');
  const [tenantId, setCustomerId] = useState<string | null>(null);
  const [workStatus, setWorkStatus] = useState<string>('');
  const [employmentType, setEmploymentType] = useState<string>('');
  const [departmentName, setDepartmentName] = useState<string>('');
  const [locationName, setLocationName] = useState<string>('');
  const [divisionName, setDivisionName] = useState<string>('');
  const [regionName, setRegionName] = useState<string>('');
  const [managerName, setManagerName] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');
  const [targetUserSecurityLevel, setTargetUserSecurityLevel] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [profileScore, setProfileScore] = useState<number | undefined>(undefined);
  const [createdAt, setCreatedAt] = useState<any>(null);
  const [activeApplicationsCount, setActiveApplicationsCount] = useState<number>(0);
  const [assignmentsCount, setAssignmentsCount] = useState<number>(0);
  const [userGroupsCount, setUserGroupsCount] = useState<number>(0);
  const [notesCount, setNotesCount] = useState<number>(0);
  const [interviewsCount, setInterviewsCount] = useState<number>(0);
  const [employeeOnboardStatus, setEmployeeOnboardStatus] = useState<string | undefined>();
  const [contractorOnboardStatus, setContractorOnboardStatus] = useState<string | undefined>();

  // Check if user has access to this profile
  const canAccessProfile = () => {
    console.log('Access check:', {
      currentUserUid: user?.uid,
      targetUserUid: uid,
      securityLevel,
      isOwnProfile: user?.uid === uid
    });
    
    // HRX users and admins can access any profile (security levels 5 and above)
    if (parseInt(securityLevel) >= 5) {
      console.log('✅ Access granted: HRX/Admin user');
      return true;
    }
    
    // Users can always access their own profile
    if (user?.uid === uid) {
      console.log('✅ Access granted: Own profile');
      return true;
    }
    
    // Managers can access profiles within their tenant (security level 4)
    if (parseInt(securityLevel) >= 4) {
      console.log('✅ Access granted: Manager user');
      return true;
    }
    
    // Workers can only access their own profile
    console.log('❌ Access denied: Insufficient permissions');
    return false;
  };

  // Define which tabs are available based on user role (returns ordered labels)
  const getAvailableTabs = () => {
    const isOwnProfile = user?.uid === uid;
    const viewerSecurityLevel = parseInt(securityLevel);
    const isAdminViewer = viewerSecurityLevel >= 5;
    const isManager = securityLevel === '6';
    const isAdmin = securityLevel === '7';
    
    // Check if we're on the /c1/ route (worker view) or /users/ route (admin view)
    const pathname = window.location.pathname;
    const isWorkerRoute = pathname.includes('/c1/users/');
    const isWorkforceRoute = pathname.includes('/workforce/users/');
    
    // Check if target user is internal team member (security levels 5-7)
    const targetUserLevel = parseInt(targetUserSecurityLevel || '0');
    const isInternalTeamMember = targetUserLevel >= 5 && targetUserLevel <= 7;
    
    // For internal team members (5-7) viewed from Workforce route, only show Overview and System Access
    const isWorkforceInternalTeamView = isWorkforceRoute && isInternalTeamMember;
    
    // Determine if the current viewer can see admin-specific content (securityLevel 5-7)
    const canViewAdminContent = viewerSecurityLevel >= 5;
    
    // Debug logging to understand what's happening
    console.log('Tab availability check:', {
      securityLevel,
      viewerSecurityLevel,
      isAdminViewer,
      isWorkerRoute,
      isWorkforceRoute,
      isOwnProfile,
      targetUserSecurityLevel,
      targetUserLevel,
      isInternalTeamMember,
      isWorkforceInternalTeamView
    });

    // Check if onboarding is in progress
    const onboardingInProgress = isOnboardingInProgress(employeeOnboardStatus as any, contractorOnboardStatus as any);
    
    const tabs = [
      { label: 'Overview', available: true, count: undefined },
      { label: 'Interview', available: canViewAdminContent && !isWorkforceInternalTeamView, count: interviewsCount }, // Hidden for 0-4
      { label: 'Qualifications', available: !isWorkforceInternalTeamView, count: undefined },
      { label: 'Applications', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: activeApplicationsCount },
      { label: 'Assignments', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: assignmentsCount },
      { label: 'Onboarding', available: onboardingInProgress && canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Backgrounds', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined }, // Hidden for 0-4
      { label: 'Notes', available: canViewAdminContent && !isWorkforceInternalTeamView, count: notesCount }, // Hidden for 0-4
      { label: 'Activity Log', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined }, // Hidden for 0-4
      { label: 'Reports & Insights', available: false, count: undefined },
      { label: 'Settings', available: (isAdminViewer && !isWorkerRoute) || isWorkforceInternalTeamView, count: undefined },
    ];

    const availableTabs = tabs.filter(t => t.available);
    console.log('Available tabs:', availableTabs.map(t => t.label));
    return availableTabs;
  };

  useEffect(() => {
    // Check access permissions
    if (!canAccessProfile()) {
      setAccessDenied(true);
      return;
    }

    const fetchUserData = async () => {
      if (uid) {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFirstName(data.firstName || '');
          setLastName(data.lastName || '');
          setPreferredName(data.preferredName || '');
          setAvatarUrl(data.avatar || '');
          // Get effective tenant ID first
          const effectiveTenantId = data.activeTenantId || data.tenantId || null;
          
          // Fetch tenant-dependent fields from nested structure first, then fallback to direct fields
          const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
          
          setJobTitle(tenantData.jobTitle || data.jobTitle || data.primaryJobTitle || '');
          setPhone(data.phone || '');
          setEmail(data.email || '');
          setCity(data.city || data.address?.city || '');
          setState(data.state || data.address?.state || '');
          setLinkedinUrl(data.linkedinUrl || '');
          setCustomerId(effectiveTenantId || null);
          // Provide sensible defaults so header chips render consistently
          setWorkStatus(tenantData.workStatus || data.workStatus || 'Active');
          setEmploymentType(tenantData.employmentType || data.employmentType || 'Full-Time');
          setTargetUserSecurityLevel(tenantData.securityLevel || data.securityLevel || '5');
          // Resolve department/location/division names from nested structure first
          // Handle both old and new field names for backward compatibility
          const deptId: string | undefined = tenantData.departmentId || tenantData.department || data.departmentId;
          const locId: string | undefined = tenantData.locationId || data.locationId;
          const divId: string | undefined = tenantData.divisionId || data.divisionId;

          // Default from already present human-readable fields
          if (data.department && !deptId) {
            setDepartmentName(data.department);
          } else if (effectiveTenantId && deptId) {
            try {
              const deptDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'departments', deptId));
              setDepartmentName(deptDoc.exists() ? (deptDoc.data() as any).name || '' : '');
            } catch (e) {
              setDepartmentName('');
            }
          } else {
            setDepartmentName('');
          }

          if (data.locationName && !locId) {
            setLocationName(data.locationName);
          } else if (effectiveTenantId && locId) {
            try {
              const locDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'locations', locId));
              if (locDoc.exists()) {
                const l = locDoc.data() as any;
                setLocationName(l.nickname || l.name || '');
              } else {
                setLocationName('');
              }
            } catch (e) {
              setLocationName('');
            }
          } else {
            setLocationName('');
          }

          // Fetch division information
          if (effectiveTenantId && divId) {
            try {
              const divDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'divisions', divId));
              setDivisionName(divDoc.exists() ? (divDoc.data() as any).name || '' : '');
            } catch (e) {
              setDivisionName('');
            }
          } else {
            setDivisionName('');
          }

          // Fetch region information - check nested tenantIds first, then fallback to location
          let regionId: string | undefined = undefined;
          
          // First check nested tenantIds structure (handle both old and new field names)
          if (effectiveTenantId && data.tenantIds?.[effectiveTenantId]) {
            const tenantData = data.tenantIds[effectiveTenantId];
            regionId = tenantData.regionId || tenantData.region;
            if (regionId) {
              console.log('Found regionId in nested tenantIds:', regionId);
            }
          }
          // Fallback to direct field
          else if (data.regionId) {
            regionId = data.regionId;
            console.log('Found regionId in direct field:', regionId);
          }
          // Fallback to location-based lookup
          else if (effectiveTenantId && data.locationId) {
            try {
              // First get the location document
              const locationDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'locations', data.locationId));
              if (locationDoc.exists()) {
                const locationData = locationDoc.data() as any;
                
                // Try different possible region field locations in the location document
                regionId = locationData?.primaryContacts?.region || 
                          locationData?.region || 
                          locationData?.regionId;
                console.log('Found regionId through location:', regionId);
              }
            } catch (e) {
              console.warn('Error fetching region through location:', e);
            }
          }
          
          // Get region name if we found a regionId
          if (effectiveTenantId && regionId) {
            try {
              const regionDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'regions', regionId));
              setRegionName(regionDoc.exists() ? (regionDoc.data() as any).name || '' : '');
            } catch (e) {
              console.warn('Error fetching region document:', e);
              setRegionName('');
            }
          } else {
            setRegionName('');
          }

          // Fetch manager information from nested structure first
          const managerIdValue = tenantData.managerId || data.managerId;
          if (managerIdValue) {
            setManagerId(managerIdValue);
            try {
              const managerDoc = await getDoc(doc(db, 'users', managerIdValue));
              if (managerDoc.exists()) {
                const managerData = managerDoc.data();
                setManagerName(`${managerData.firstName || ''} ${managerData.lastName || ''}`.trim());
              } else {
                setManagerName('');
              }
            } catch (e) {
              setManagerName('');
            }
          } else {
            setManagerId('');
            setManagerName('');
          }
          
          // Calculate profile score
          const score = calculateProfileScore(data);
          setProfileScore(score);
          
          // Set createdAt
          setCreatedAt(data.createdAt || null);
        }
      }
    };
    fetchUserData();
  }, [uid, user, securityLevel]);

  useEffect(() => {
    if (!uid || !canAccessProfile()) return;
    
    // Fetch skills data for SkillsTab
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Fetch E-Verify orders
        const eVerifyOrdersArray = Array.isArray(data.eVerifyOrders) ? data.eVerifyOrders : [];
        setEVerifyOrders(eVerifyOrdersArray.map((o: any) => ({
          id: o.id || '',
          dateSubmitted: o.dateSubmitted || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Background Check orders
        const bgOrders = Array.isArray(data.backgroundCheckOrders) ? data.backgroundCheckOrders : [];
        setBackgroundCheckOrders(bgOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Drug Screening orders
        const drugOrders = Array.isArray(data.drugScreeningOrders) ? data.drugScreeningOrders : [];
        setDrugScreeningOrders(drugOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Additional Screening orders
        const addlOrders = Array.isArray(data.additionalScreeningOrders) ? data.additionalScreeningOrders : [];
        setAdditionalScreeningOrders(addlOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        setSkillsData({
          primaryJobTitle: data.primaryJobTitle || '',
          certifications: data.certifications || [],
          skills: data.skills || [],
          languages: data.languages || [],
          yearsExperience: data.yearsExperience || '',
          educationLevel: data.educationLevel || '',
          backgroundCheckStatus: data.backgroundCheckStatus || '',
          vaccinationStatus: data.vaccinationStatus || '',
          specialTraining: data.specialTraining || '',
          resume: data.resume || null,
          education: data.education || [],
          workExperience: data.workExperience || data.workHistory || [],
          // New fields from the schema
          preferredName: data.preferredName || '',
          // Check both 'dob' and 'dateOfBirth' fields for backward compatibility
          dateOfBirth: (() => {
            const dobValue = data.dob || data.dateOfBirth;
            if (!dobValue) return null;
            // Handle Firestore Timestamp
            if (dobValue?.toDate && typeof dobValue.toDate === 'function') {
              return dobValue.toDate();
            }
            // Handle string or Date
            if (typeof dobValue === 'string' || dobValue instanceof Date) {
              return dobValue;
            }
            // Handle timestamp number
            if (typeof dobValue === 'number') {
              return new Date(dobValue);
            }
            return dobValue;
          })(),
          gender: data.gender || '',
          employmentType: data.employmentType || 'Full-Time',
          departmentId: data.departmentId || '',
          divisionId: data.divisionId || '',
          locationId: data.locationId || '',
          managerId: data.managerId || '',
          startDate: data.startDate || null,
          workStatus: data.workStatus || 'Active',
          workerId: data.workerId || '',
          union: data.union || '',
          workEligibility: data.workEligibility !== false,
          emergencyContact: data.emergencyContact || null,
          transportMethod: data.transportMethod || null,
        });
        
        // Load onboarding status
        setEmployeeOnboardStatus(data.employeeOnboardStatus);
        setContractorOnboardStatus(data.contractorOnboardStatus);
      }
    });
    return () => unsubscribe();
  }, [uid, user, securityLevel]);

  // Fetch counts for tabs
  useEffect(() => {
    if (!uid || !canAccessProfile()) return;

    const fetchCounts = async () => {
      try {
        // Applications count - from user's applicationIds array
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const applicationIds = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];
          setActiveApplicationsCount(applicationIds.length);

          // User Groups count - from user's userGroupIds array
          const userGroupIds = Array.isArray(userData?.userGroupIds) ? userData.userGroupIds : [];
          setUserGroupsCount(userGroupIds.length);
        }

        // Assignments count
        try {
          const assignmentsQuery = query(
            collection(db, 'assignments'),
            where('userId', '==', uid)
          );
          const assignmentsSnapshot = await getDocs(assignmentsQuery);
          setAssignmentsCount(assignmentsSnapshot.size);
        } catch (error: any) {
          // Silently handle permission errors for lower-level users
          if (error?.code === 'permission-denied' || 
              error?.code === 'PERMISSION_DENIED' || 
              error?.message?.includes('Missing or insufficient permissions')) {
            setAssignmentsCount(0);
          } else {
            console.error('Error fetching assignments count:', error);
          }
          setAssignmentsCount(0);
        }

        // Only fetch notes and interviews counts if viewer has admin access (securityLevel >= 5)
        const viewerSecurityLevel = typeof securityLevel === 'number' ? securityLevel : parseInt(securityLevel || '0', 10);
        const canViewAdminContent = viewerSecurityLevel >= 5;

        // Notes count - from users/{uid}/notes subcollection
        if (canViewAdminContent) {
          try {
            const notesRef = collection(db, 'users', uid, 'notes');
            const notesSnapshot = await getDocs(notesRef);
            setNotesCount(notesSnapshot.size);
          } catch (error: any) {
            // Silently handle permission errors - Firestore rules may restrict access
            const isPermissionError = 
              error?.code === 'permission-denied' || 
              error?.code === 'PERMISSION_DENIED' ||
              error?.message?.includes('Missing or insufficient permissions') ||
              error?.message?.includes('permission');
            if (!isPermissionError) {
              console.error('Error fetching notes count:', error);
            }
            setNotesCount(0);
          }
        } else {
          setNotesCount(0);
        }

        // Interviews count - from users/{uid}/interviews subcollection
        if (canViewAdminContent) {
          try {
            const interviewsRef = collection(db, 'users', uid, 'interviews');
            const interviewsSnapshot = await getDocs(interviewsRef);
            setInterviewsCount(interviewsSnapshot.size);
          } catch (error: any) {
            // Silently handle permission errors - Firestore rules may restrict access
            const isPermissionError = 
              error?.code === 'permission-denied' || 
              error?.code === 'PERMISSION_DENIED' ||
              error?.message?.includes('Missing or insufficient permissions') ||
              error?.message?.includes('permission');
            if (!isPermissionError) {
              console.error('Error fetching interviews count:', error);
            }
            setInterviewsCount(0);
          }
        } else {
          setInterviewsCount(0);
        }
      } catch (error) {
        console.error('Error fetching counts:', error);
      }
    };

    fetchCounts();
  }, [uid, securityLevel]);

  // Handle tab query parameter - must be before early returns
  const availableTabs = getAvailableTabs();
  const availableTabLabels = availableTabs.map(t => t.label);
  
  // Validate current tab is still available, reset if needed - MUST be before early returns (hook rules)
  useEffect(() => {
    if (availableTabLabels.length > 0 && (!tabValue || !availableTabLabels.includes(tabValue))) {
      setTabValue(availableTabLabels[0]);
    }
  }, [availableTabLabels, tabValue]);
  
  useEffect(() => {
    // Removed Certs tab handling
  }, [searchParams, availableTabLabels]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: string) => {
    // Only change local state; do not navigate to a different route which
    // causes a remount and resets the tab for worker (level 2) users.
    setTabValue(newValue);

    // Update URL with search params if needed
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    params.delete('tab');
    const search = params.toString();
    navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
  };

  // Handler for tab change from header components (e.g., document icons)
  const handleHeaderTabChange = (tabLabel: string) => {
    const tabs = getAvailableTabs();
    const tabLabels = tabs.map(t => t.label);
    if (tabLabels.includes(tabLabel)) {
      setTabValue(tabLabel);
      // Update URL if needed
      const pathname = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      params.delete('tab');
      const search = params.toString();
      navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
    }
  };

  const handleSkillsUpdate = async (updated: any) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    
    // Filter out undefined values to prevent Firestore errors
    const cleanData = Object.fromEntries(
      Object.entries(updated).filter(([_, value]) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && value === '') return false;
        return true;
      })
    );
    
    await updateDoc(userRef, cleanData);
  };

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No User ID provided</Typography>
      </Box>
    );
  }

  if (accessDenied) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6">Access Denied</Typography>
          <Typography variant="body1">
            You don&apos;t have permission to view this profile.
          </Typography>
        </Alert>
        <Button variant="contained" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </Button>
      </Box>
    );
  }

  const currentLabel = tabValue;

  // Create breadcrumb path based on current route
  const pathname = window.location.pathname;
  // Check if this is a recruiter route - more robust check
  const isRecruiterRoute = pathname.includes('/recruiter/users/') || 
                          (pathname.includes('/recruiter/users') && pathname.split('/').length > 3);
  // Check if this is a workforce route (from Company Directory)
  const isWorkforceRoute = pathname.includes('/workforce/users/');
  // Also check if viewing someone else's profile (not own profile) - treat as recruiter view
  const isViewingOtherProfile = user?.uid !== uid;
  const displayName = `${firstName} ${lastName}${preferredName && preferredName !== firstName ? ` (${preferredName})` : ''}`;
  
  // Determine breadcrumb path based on route
  let breadcrumbPath: Array<{ label: string; href?: string }>;
  if (isRecruiterRoute) {
    breadcrumbPath = [
      { label: 'Recruiter', href: '/recruiter' },
      { label: 'All Users', href: '/recruiter/users' },
      { label: displayName },
    ];
  } else if (isWorkforceRoute) {
    breadcrumbPath = [
      { label: 'Workforce', href: '/workforce' },
      { label: 'Company Directory', href: '/workforce/company-directory' },
      { label: displayName },
    ];
  } else {
    breadcrumbPath = [
      { label: 'Workforce', href: '/workforce' },
      { label: 'Company Directory', href: '/workforce/company-directory' },
      { label: displayName },
    ];
  }

  const isAdminView = parseInt(securityLevel) >= 5;

  return (
    <Box className="user-profile-page">
      <Box sx={{ p: 0 }}>
        <UserProfileHeader
          uid={uid}
          firstName={firstName}
          lastName={lastName}
          preferredName={preferredName}
          avatarUrl={avatarUrl}
          onAvatarUpdated={setAvatarUrl}
          showBackButton={isRecruiterRoute || isWorkforceRoute || user?.uid !== uid}
          onBack={() => {
            if (isRecruiterRoute) {
              navigate('/recruiter/users');
            } else if (isWorkforceRoute) {
              navigate('/workforce/company-directory');
            } else {
              navigate(-1);
            }
          }}
          jobTitle={jobTitle}
          phone={phone}
          email={email}
          createdAt={createdAt}
          city={city}
          state={state}
          linkedinUrl={linkedinUrl}
          canEditAvatar={user?.uid === uid || parseInt(securityLevel) >= 4}
          workStatus={workStatus}
          securityLevel={targetUserSecurityLevel}
          employmentType={employmentType}
          departmentName={departmentName}
          locationName={locationName}
          divisionName={divisionName}
          regionName={regionName}
          managerName={managerName}
          managerId={managerId}
          showBreadcrumbs={isRecruiterRoute || isWorkforceRoute || user?.uid !== uid}
          breadcrumbPath={breadcrumbPath}
          isAdminView={isAdminView}
          profileScore={profileScore}
          resume={skillsData?.resume || null}
          certifications={skillsData?.certifications || []}
          education={skillsData?.education || []}
          workExperience={skillsData?.workExperience || []}
          workEligibility={skillsData?.workEligibility}
          backgroundCheckStatus={skillsData?.backgroundCheckStatus}
          vaccinationStatus={skillsData?.vaccinationStatus}
          yearsExperience={skillsData?.yearsExperience}
          primarySkills={(() => {
            try {
              if (!Array.isArray(skillsData?.skills)) return [];
              
              const skillNames: string[] = [];
              
              for (const item of skillsData.skills) {
                // Skip language objects - they have 'language', 'proficiency', 'isNative' keys
                if (item && typeof item === 'object') {
                  // Check for language object structure
                  if (('language' in item) || (('proficiency' in item) && ('isNative' in item))) {
                    continue; // Skip language objects completely
                  }
                  // Extract skill name from skill object (must have 'name' key)
                  if ('name' in item) {
                    const skillName = item.name || item.canonicalId || '';
                    if (skillName && typeof skillName === 'string') {
                      const trimmed = String(skillName).trim();
                      if (trimmed) {
                        skillNames.push(trimmed);
                      }
                    }
                  }
                } else if (typeof item === 'string') {
                  // Direct string skill
                  const trimmed = item.trim();
                  if (trimmed) {
                    skillNames.push(trimmed);
                  }
                }
                
                // Limit to 5 skills
                if (skillNames.length >= 5) break;
              }
              
              // Final safety check - ensure all items are strings
              return skillNames.filter((name): name is string => typeof name === 'string' && name.length > 0);
            } catch (error) {
              console.error('Error extracting primary skills:', error);
              return [];
            }
          })()}
          languages={(() => {
            try {
              if (!Array.isArray(skillsData?.languages)) return [];
              
              const languageNames: string[] = [];
              
              for (const lang of skillsData.languages) {
                if (typeof lang === 'string') {
                  languageNames.push(lang);
                } else if (lang && typeof lang === 'object' && 'language' in lang) {
                  // Extract language from object
                  const langName = lang.language || String(lang);
                  if (langName && typeof langName === 'string') {
                    languageNames.push(langName.trim());
                  }
                }
                
                // Limit to top 5 languages
                if (languageNames.length >= 5) break;
              }
              
              return languageNames.filter((name): name is string => typeof name === 'string' && name.length > 0);
            } catch (error) {
              console.error('Error extracting languages:', error);
              return [];
            }
          })()}
          eVerifyOrders={eVerifyOrders}
          backgroundCheckOrders={backgroundCheckOrders}
          drugScreeningOrders={drugScreeningOrders}
          additionalScreeningOrders={additionalScreeningOrders}
          behavioralTraits={(() => {
            try {
              // Extract behavioral traits from traitsProfile if available
              const traitsProfile = skillsData?.traitsProfile;
              if (traitsProfile && typeof traitsProfile === 'object') {
                // Check for common trait fields
                const traits: string[] = [];
                
                // If traitsProfile has a traits array
                if (Array.isArray(traitsProfile.traits)) {
                  traits.push(...traitsProfile.traits.slice(0, 5).filter((t: any) => typeof t === 'string'));
                }
                
                // If traitsProfile has individual trait fields
                if (traitsProfile.topTraits && Array.isArray(traitsProfile.topTraits)) {
                  traits.push(...traitsProfile.topTraits.slice(0, 5).filter((t: any) => typeof t === 'string'));
                }
                
                return traits.slice(0, 5);
              }
              
              return [];
            } catch (error) {
              console.error('Error extracting behavioral traits:', error);
              return [];
            }
          })()}
          educationLevel={skillsData?.educationLevel}
          activeApplicationsCount={activeApplicationsCount}
          resumeCompleteness={skillsData?.resume ? 100 : 0}
          onTabChange={handleHeaderTabChange}
          emergencyContact={skillsData?.emergencyContact || null}
          dateOfBirth={skillsData?.dateOfBirth || null}
          onEditProfile={() => {
            // Scroll to overview and focus on edit mode - could be enhanced later
            setTabValue('Overview');
          }}
          onAddNote={() => {
            setTabValue('Notes');
          }}
          onSendApplicationLink={() => {
            // TODO: Implement send application link functionality
            console.log('Send application link');
          }}
          onPrintProfile={() => {
            window.print();
          }}
          onCreateAssignment={() => {
            setTabValue('Assignments');
          }}
          onCallNow={phone ? () => {
            window.location.href = `tel:${phone.replace(/\D/g, '')}`;
          } : undefined}
          onMessageApplicant={phone ? () => {
            const digits = phone.replace(/\D/g, '');
            const smsNumber = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phone;
            window.open(`sms:${smsNumber}`, '_blank');
          } : undefined}
          onViewTimeline={() => {
            setTabValue('Activity Log');
          }}
          hasPhone={!!phone}
          employeeOnboardStatus={employeeOnboardStatus}
          contractorOnboardStatus={contractorOnboardStatus}
          tenantId={tenantId || authTenantId || activeTenant?.id || undefined}
          onOnboardingStarted={async () => {
            // Reload onboarding status from Firestore
            const userRef = doc(db, 'users', uid!);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              setEmployeeOnboardStatus(data.employeeOnboardStatus);
              setContractorOnboardStatus(data.contractorOnboardStatus);
            }
          }}
        />

        <Paper 
          elevation={1} 
          sx={{ 
            mb: 3, 
            borderRadius: 1,
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            aria-label="user profile tabs"
          >
            {availableTabs.map((tab, i) => {
              const hasCount = tab.count !== undefined && tab.count > 0;
              return (
                <Tab
                  key={i}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {tab.label}
                      {hasCount && (
                        <Badge badgeContent={tab.count} color="primary" />
                      )}
                    </Box>
                  }
                  value={tab.label}
                />
              );
            })}
          </Tabs>
        </Paper>

        <Box sx={{ mt: 2 }} className="profile-tab-content">
          {(() => {
            const label = currentLabel;
            if (!label || !availableTabLabels.includes(label)) return null;
            switch (label) {
              case 'Overview':
                return <ProfileOverview uid={uid} onTabChange={(tab: string) => handleTabChange({} as React.SyntheticEvent, tab)} />;
              case 'Interview':
                return <InterviewTab uid={uid} />;
              case 'Qualifications':
                return <QualificationsTab uid={uid} />;
              case 'Applications':
                return <UserApplicationsTab userId={uid} />;
              case 'Assignments':
                return <UserAssignmentsTab userId={uid} />;
              case 'Onboarding':
                return <OnboardingTab uid={uid} tenantId={tenantId || ''} />;
              case 'Backgrounds':
                return <CombinedBackgroundAndVaccinationTab uid={uid} />;
              case 'Reports & Insights':
                return <ReportsAndInsightsTab uid={uid} />;
              case 'Notes':
                return <NotesTab uid={uid} user={user} />;
              case 'Activity Log':
                return <ActivityLogTab uid={uid} user={user} />;
              case 'Settings':
                return <SystemAccessTab uid={uid} />;
              default:
                return null;
            }
          })()}
        </Box>
      </Box>
      {/* <ChatUI workerId={uid} tenantId={tenantId || undefined} showFAQ={true} /> */}
    </Box>
  );
};

export default UserProfilePage;
