import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button, Paper, Alert, Badge, Avatar, IconButton, Tooltip, Stack, Link as MUILink, Rating, Chip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import MessageIcon from '@mui/icons-material/Message';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import DescriptionIcon from '@mui/icons-material/Description';
import NoteIcon from '@mui/icons-material/Note';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import AddTaskIcon from '@mui/icons-material/AddTask';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InsightsIcon from '@mui/icons-material/Insights';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ContactActionButtons from './components/ContactActionButtons';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, onSnapshot, updateDoc, collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';

import { db, functions } from '../../firebase'; // adjust path
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';
import { useAuth } from '../../contexts/AuthContext';
import { calculateProfileScore } from '../../utils/applicantScoring';
import { userProfileBatcher, flushProfileUpdates } from '../../utils/userProfileBatching';
import { getActiveOnboardingType, isOnboardingInProgress } from './utils/onboardingHelpers';
import { getTaskCompletionPercentage, initializeOnboardingTasks } from './utils/onboardingTasks';
import FavoriteButton from '../../components/FavoriteButton';
import { useFavorites } from '../../hooks/useFavorites';

import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';
import UserGroupsTab from './components/UserGroupsTab';
import SkillsTab, { CombinedBackgroundAndVaccinationTab } from './components/SkillsTab';
import SkillsOnlyTab from './components/SkillsOnlyTab';
import WorkEligibilityTab from './components/WorkEligibilityTab';
import QualificationsTab from './components/QualificationsTab';
import InterviewTab from './components/InterviewTab';
import ScoreTab from './components/ScoreTab';
import ReportsAndInsightsTab from './components/ReportsAndInsightsTab';
import NotesTab from './components/NotesTab';
import ActivityLogTab from './components/ActivityLogTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';
import SystemAccessTab from './components/SystemAccessTab';
import EmailSignatureTab from './components/EmailSignatureTab';
import OnboardingTab from './components/OnboardingTab';
import UserApplicationsTab from './components/UserApplicationsTab';
import MessagesTab from './components/MessagesTab';
import StartOnboardingDialog from './components/StartOnboardingDialog';
import MessageDrawer, { MessageRecipient } from '../../components/MessageDrawer';
import AddUserNoteDialog from './components/AddUserNoteDialog';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import LogActivityDialog from '../../components/LogActivityDialog';
import { logUserActivity } from '../../utils/activityLogger';
import { normalizeScoreSummary, type ScoreSummary, formatOneDecimal } from '../../utils/scoreSummary';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { user, securityLevel, role, tenantId: authTenantId, activeTenant } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites('users');

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
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary | undefined>(undefined);
  const [reviewsCount, setReviewsCount] = useState<number>(0);
  const [createdAt, setCreatedAt] = useState<any>(null);
  const [activeApplicationsCount, setActiveApplicationsCount] = useState<number>(0);
  const [assignmentsCount, setAssignmentsCount] = useState<number>(0);
  const [userGroupsCount, setUserGroupsCount] = useState<number>(0);
  const [notesCount, setNotesCount] = useState<number>(0);
  const [interviewsCount, setInterviewsCount] = useState<number>(0);
  const [employeeOnboardStatus, setEmployeeOnboardStatus] = useState<string | undefined>();
  const [contractorOnboardStatus, setContractorOnboardStatus] = useState<string | undefined>();
  const [onboardingCompletionPct, setOnboardingCompletionPct] = useState<number>(0);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [viewerGmailConnected, setViewerGmailConnected] = useState(false);
  const [smsComposeOpen, setSmsComposeOpen] = useState(false);
  const [viewerHasSmsSender, setViewerHasSmsSender] = useState(false);
  const [quickReviewStars, setQuickReviewStars] = useState<number | null>(null);
  const [showStartOnboardingDialog, setShowStartOnboardingDialog] = useState(false);
  const [showAddUserNoteDialog, setShowAddUserNoteDialog] = useState(false);
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [activityLogRefreshKey, setActivityLogRefreshKey] = useState(0);
  const [headerUserGroups, setHeaderUserGroups] = useState<Array<{ id: string; title: string }>>([]);

  const effectiveTenantIdForMessaging = tenantId || authTenantId || activeTenant?.id || '';

  // Determine if viewer has Gmail connected (for conditional Email icon behavior)
  useEffect(() => {
    let mounted = true;

    const checkViewerGmail = async () => {
      if (!user?.uid) {
        if (mounted) setViewerGmailConnected(false);
        return;
      }

      try {
        const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');
        const result = await getGmailStatus({ userId: user.uid, force: true });
        const data = result.data as any;
        // If rate-limited/sampled, treat as connected to avoid false negatives; MessageDrawer will validate senders.
        const connected = !!data?.connected || !!data?.rateLimited || !!data?.sampled;
        if (mounted) setViewerGmailConnected(connected);
      } catch {
        // Fallback: check tokens on user doc
        try {
          const viewerSnap = await getDoc(doc(db, 'users', user.uid));
          const viewerData: any = viewerSnap.exists() ? viewerSnap.data() : null;
          if (mounted) setViewerGmailConnected(!!viewerData?.gmailTokens?.access_token);
        } catch {
          if (mounted) setViewerGmailConnected(false);
        }
      }
    };

    checkViewerGmail();
    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  // Determine if viewer has a recruiter SMS sender (Twilio number assignment)
  useEffect(() => {
    let mounted = true;

    const checkSmsSender = async () => {
      if (!user?.uid || !effectiveTenantIdForMessaging) {
        if (mounted) setViewerHasSmsSender(false);
        return;
      }

      try {
        const recruiterNumberDoc = await getDoc(
          doc(db, 'tenants', effectiveTenantIdForMessaging, 'recruiterNumbers', user.uid)
        );
        const hasNumber =
          recruiterNumberDoc.exists() &&
          !!(recruiterNumberDoc.data()?.twilioNumber || recruiterNumberDoc.data()?.useMainNumber);
        if (mounted) setViewerHasSmsSender(!!hasNumber);
      } catch {
        if (mounted) setViewerHasSmsSender(false);
      }
    };

    checkSmsSender();
    return () => {
      mounted = false;
    };
  }, [user?.uid, effectiveTenantIdForMessaging]);

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
      { label: 'Score', available: canViewAdminContent && !isWorkforceInternalTeamView }, // Hidden for 0-4
      { label: 'Qualifications', available: !isWorkforceInternalTeamView, count: undefined },
      { label: 'Applications', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: activeApplicationsCount },
      { label: 'Assignments', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: assignmentsCount },
      { label: 'User Groups', available: canViewAdminContent && !isWorkerRoute && !isWorkforceInternalTeamView, count: userGroupsCount },
      { label: 'Onboarding', available: onboardingInProgress && canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Backgrounds', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined }, // Hidden for 0-4
      { label: 'Notes', available: canViewAdminContent && !isWorkforceInternalTeamView, count: notesCount }, // Hidden for 0-4
      { label: 'Messages', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined }, // Hidden for 0-4
      { label: 'Activity Log', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined }, // Hidden for 0-4
      { label: 'Reports & Insights', available: false, count: undefined },
      { label: 'Settings', available: (isAdminViewer && !isWorkerRoute) || isWorkforceInternalTeamView, count: undefined },
    ];

    let availableTabs = tabs.filter(t => t.available);
    // When onboarding is in progress, force the Onboarding tab to the far-left (first position).
    if (onboardingInProgress) {
      const idx = availableTabs.findIndex((t) => t.label === 'Onboarding');
      if (idx > 0) {
        const [onboardingTab] = availableTabs.splice(idx, 1);
        availableTabs = [onboardingTab, ...availableTabs];
      }
    }
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
          // Get effective tenant ID first (target user's tenant, if present)
          const effectiveTenantId = data.activeTenantId || data.tenantId || null;
          // Fallback to viewer tenant when target user has no tenantId set (common for older docs / applicants)
          const tenantForGroups = effectiveTenantId || authTenantId || activeTenant?.id || null;
          
          // Fetch tenant-dependent fields from nested structure first, then fallback to direct fields
          const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
          
          setJobTitle(tenantData.jobTitle || data.jobTitle || data.primaryJobTitle || '');
          setPhone(data.phone || '');
          setEmail(data.email || '');
          // City/State: prefer explicit top-level fields, then addressInfo (single source of truth in ProfileOverview),
          // then legacy address object fallbacks.
          setCity(data.city || data.addressInfo?.city || data.address?.city || '');
          setState(data.state || data.addressInfo?.state || data.address?.state || '');
          setLinkedinUrl(data.linkedinUrl || '');
          setCustomerId(effectiveTenantId || null);
          // Resolve header user groups (ids -> titles)
          try {
            const rawGroupIds =
              (Array.isArray((tenantData as any)?.userGroupIds) ? (tenantData as any).userGroupIds : null) ||
              (Array.isArray((data as any)?.userGroupIds) ? (data as any).userGroupIds : null) ||
              (Array.isArray((data as any)?.tenantIds?.[effectiveTenantId as any]?.userGroupIds)
                ? (data as any).tenantIds[effectiveTenantId as any].userGroupIds
                : null) ||
              [];

            const userGroupIds = Array.from(new Set((rawGroupIds as any[]).filter(Boolean))).slice(0, 25);
            if (userGroupIds.length > 0) {
              // If we can't resolve titles (no tenant), still show IDs so the header isn't blank.
              if (!tenantForGroups) {
                setHeaderUserGroups(userGroupIds.map((id: string) => ({ id, title: id })));
                return;
              }
              const groupDocs = await Promise.all(
                userGroupIds.map(async (groupId: string) => {
                  try {
                    const gSnap = await getDoc(doc(db, 'tenants', tenantForGroups, 'userGroups', groupId));
                    if (!gSnap.exists()) return { id: groupId, title: groupId };
                    const g = gSnap.data() as any;
                    return {
                      id: groupId,
                      title: g?.title || g?.name || groupId,
                    };
                  } catch {
                    return { id: groupId, title: groupId };
                  }
                })
              );
              setHeaderUserGroups(groupDocs.filter(Boolean) as Array<{ id: string; title: string }>);
            } else {
              setHeaderUserGroups([]);
            }
          } catch {
            setHeaderUserGroups([]);
          }
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
          // Denormalized score summary (interviews/reviews/AI)
          setScoreSummary(normalizeScoreSummary((data as any).scoreSummary));
          
          // Set createdAt
          setCreatedAt(data.createdAt || null);
        }
      }
    };
    fetchUserData();
  }, [uid, user, securityLevel]);

  useEffect(() => {
    if (!uid || !canAccessProfile()) return;
    
    // Avoid always-on Firestore listeners on this page (can trigger rare SDK watch-stream crashes).
    // One-time fetch is enough for the profile summary; tab-specific screens can fetch as needed.
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const userRef = doc(db, 'users', uid);
        const docSnap = await getDoc(userRef);
        if (cancelled) return;
        if (!docSnap.exists()) return;

        const data = docSnap.data() as any;
        setScoreSummary(normalizeScoreSummary(data.scoreSummary));

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
          bio: data.professionalBio || data.bio || data.summary || '',
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
            if (dobValue?.toDate && typeof dobValue.toDate === 'function') return dobValue.toDate();
            if (typeof dobValue === 'string' || dobValue instanceof Date) return dobValue;
            if (typeof dobValue === 'number') return new Date(dobValue);
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

        // Compute onboarding completion percentage from onboardingTasks (same logic as OnboardingTab)
        try {
          const activeType = getActiveOnboardingType(data.employeeOnboardStatus, data.contractorOnboardStatus);
          const existingTasks = Array.isArray((data as any).onboardingTasks) ? (data as any).onboardingTasks : [];
          const initializedTasks = activeType ? initializeOnboardingTasks(activeType, existingTasks) : existingTasks;
          setOnboardingCompletionPct(getTaskCompletionPercentage(initializedTasks || []));
        } catch {
          setOnboardingCompletionPct(0);
        }
      } catch (e) {
        console.warn('Failed to fetch user snapshot for profile summary:', e);
      }
    };

    fetchOnce();
    return () => { cancelled = true; };
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

          // Reviews count - from users/{uid}/reviews subcollection (admin-only tab)
          try {
            const reviewsRef = collection(db, 'users', uid, 'reviews');
            const reviewsSnap = await getDocs(reviewsRef);
            setReviewsCount(reviewsSnap.size);
          } catch {
            setReviewsCount(0);
          }
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
  const isRecruiterRoute = pathname.includes('/users/') || 
                          (pathname.includes('/users') && pathname.split('/').length > 3);
  // Check if this is a workforce route (from Company Directory)
  const isWorkforceRoute = pathname.includes('/workforce/users/');
  const useRecordHeader = isWorkforceRoute || isRecruiterRoute;
  // Also check if viewing someone else's profile (not own profile) - treat as recruiter view
  const isViewingOtherProfile = user?.uid !== uid;
  const displayName = `${firstName} ${lastName}${preferredName && preferredName !== firstName ? ` (${preferredName})` : ''}`;
  
  // Determine breadcrumb path based on route
  let breadcrumbPath: Array<{ label: string; href?: string }>;
  if (isRecruiterRoute) {
    breadcrumbPath = [
      { label: 'Recruiter', href: '/recruiter' },
      { label: 'All Users', href: '/users' },
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
  const viewerSecurityLevel = parseInt(securityLevel);
  const isOwnProfile = user?.uid === uid;
  const canViewAdminContent = viewerSecurityLevel >= 5;
  const onboardingInProgress = isOnboardingInProgress(employeeOnboardStatus as any, contractorOnboardStatus as any);
  // Slightly more yellow-orange + used for borders/text. Button gradient is set where needed.
  const onboardingAccent = '#FF9800';
  const onboardingAccentGradient = 'linear-gradient(90deg, #FF8A00 0%, #FFB300 100%)';
  const onboardingAccentGradientHover = 'linear-gradient(90deg, #FB8C00 0%, #FFA000 100%)';

  const coerceToDate = (value: any): Date | null => {
    if (!value) return null;
    try {
      if (typeof value?.toDate === 'function') return value.toDate();
      if (value instanceof Date) return value;
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value?._seconds && typeof value._seconds === 'number') {
        const d = new Date(value._seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    } catch {
      return null;
    }
  };

  const formatShortDate = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getSecurityStatusLabel = (lvl?: string) => {
    switch (lvl) {
      case '7': return 'Admin';
      case '6': return 'Manager';
      case '5': return 'Worker';
      case '4': return 'Hired';
      case '3': return 'Flex';
      case '2': return 'Applicant';
      case '1': return 'Dismissed';
      case '0': return 'Suspended';
      default: return undefined;
    }
  };

  const statusLine = (() => {
    // Onboarding overrides everything else
    if (onboardingInProgress) {
      return { text: `Onboarding: ${onboardingCompletionPct}%`, color: onboardingAccent };
    }

    // Prefer explicit workStatus if it signals a terminal state
    const ws = (workStatus || '').toLowerCase().trim();
    if (ws === 'terminated') return { text: 'Dismissed', color: '#D32F2F' };
    if (ws === 'suspended') return { text: 'Suspended', color: '#D32F2F' };

    const secLabel = getSecurityStatusLabel(targetUserSecurityLevel);

    // If hired, show hire date when available
    if (targetUserSecurityLevel === '4') {
      const hireDate = coerceToDate(skillsData?.startDate);
      return {
        text: hireDate ? `Hired: ${formatShortDate(hireDate)}` : 'Hired',
        color: 'rgba(0, 0, 0, 0.55)',
      };
    }

    if (secLabel) {
      return {
        text: secLabel,
        color: secLabel === 'Dismissed' || secLabel === 'Suspended' ? '#D32F2F' : 'rgba(0, 0, 0, 0.55)',
      };
    }

    if (workStatus) return { text: workStatus, color: 'rgba(0, 0, 0, 0.55)' };
    return { text: null as any, color: 'rgba(0, 0, 0, 0.55)' };
  })();

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  const interviewLine = (() => {
    const lastAt = coerceToDate(scoreSummary?.interviewLastAt);
    const lastScore = scoreSummary?.interviewLastScore10;
    const hasInterview =
      !!lastAt &&
      typeof lastScore === 'number' &&
      !Number.isNaN(lastScore);

    if (!hasInterview) {
      return { text: 'Not Interviewed', color: '#D32F2F' };
    }

    return {
      text: `Interviewed: ${formatShortDate(lastAt)} — ${formatOneDecimal(lastScore)}/10`,
      color: 'rgba(0, 0, 0, 0.55)',
    };
  })();

  const toStringList = (raw: any, opts?: { limit?: number; mapper?: (v: any) => string | null }) => {
    const limit = opts?.limit ?? 12;
    const mapper = opts?.mapper ?? ((v: any) => (typeof v === 'string' ? v : null));
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      const s = mapper(item);
      const trimmed = s ? String(s).trim() : '';
      if (trimmed) out.push(trimmed);
      if (out.length >= limit) break;
    }
    return out;
  };

  const quickBio = String((skillsData as any)?.bio || '').trim();
  const quickSkills = toStringList((skillsData as any)?.skills, {
    limit: 20,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.label || v.name || v.value || v.canonicalId || null;
      return null;
    },
  });
  const quickCerts = toStringList((skillsData as any)?.certifications, {
    limit: 12,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.name || v.fileName || null;
      return null;
    },
  });
  const quickEducation = (() => {
    const edu = toStringList((skillsData as any)?.education, {
      limit: 8,
      mapper: (v) => {
        if (!v) return null;
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.degree || v.program || v.school || null;
        return null;
      },
    });
    const level = String((skillsData as any)?.educationLevel || '').trim();
    return edu.length ? edu : level ? [level] : [];
  })();
  const quickWork = toStringList((skillsData as any)?.workExperience, {
    limit: 8,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') {
        const title = v.jobTitle || v.title || '';
        const employer = v.employer || v.company || '';
        const combined = [title, employer].filter(Boolean).join(' — ');
        return combined || null;
      }
      return null;
    },
  });
  const quickLangs = toStringList((skillsData as any)?.languages, {
    limit: 12,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.language || v.name || null;
      return null;
    },
  });

  const renderQuickChip = (label: string, content: string) => (
    <Tooltip
      arrow
      enterDelay={250}
      title={
        <Box sx={{ p: 1, maxWidth: 420, whiteSpace: 'pre-wrap' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, color: 'white' }}>
            {label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'white' }}>
            {content || '—'}
          </Typography>
        </Box>
      }
    >
      <Chip
        size="small"
        label={label}
        variant="outlined"
        sx={{
          fontWeight: 700,
          cursor: 'help',
          opacity: content ? 1 : 0.5,
        }}
      />
    </Tooltip>
  );

  return (
    <Box className="user-profile-page" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!useRecordHeader && (
        <UserProfileHeader
          uid={uid}
          firstName={firstName}
          lastName={lastName}
          preferredName={preferredName}
          avatarUrl={avatarUrl}
          onAvatarUpdated={setAvatarUrl}
          headerUserGroups={headerUserGroups}
          showBackButton={(isRecruiterRoute || user?.uid !== uid) && !isWorkforceRoute}
          onBack={() => {
            if (isRecruiterRoute) {
              navigate('/users');
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
          scoreSummary={scoreSummary}
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
          onMessageApplicant={() => setMessageDrawerOpen(true)}
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
        )}

        {/* Use Record PageHeader for Workforce + Recruiter record views */}
        {useRecordHeader ? (
          <PageHeader
            title={
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
                  <Avatar
                    src={avatarUrl || undefined}
                    sx={{
                      width: 108,
                      height: 108,
                      bgcolor: 'primary.main',
                      fontSize: '40px',
                      fontWeight: 600,
                      flexShrink: 0,
                      border: onboardingInProgress ? `6px solid ${onboardingAccent}` : undefined,
                      boxSizing: 'border-box',
                    }}
                  >
                    {!avatarUrl && initials}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 108 }}>
                    {/* Line 1: Name */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Typography
                          variant="h6"
                          sx={{
                            fontSize: { xs: '20px', md: '24px' },
                            fontWeight: 600,
                            lineHeight: 1.2,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {`${firstName} ${lastName}`.trim() || 'User Profile'}
                        </Typography>

                          {canViewAdminContent &&
                            uid &&
                            targetUserSecurityLevel &&
                            !['5', '6', '7'].includes(String(targetUserSecurityLevel)) && (
                              <FavoriteButton
                                itemId={uid}
                                favoriteType="users"
                                isFavorite={isFavorite}
                                toggleFavorite={toggleFavorite}
                                size="small"
                                tooltipText={{
                                  favorited: 'Remove from favorites',
                                  notFavorited: 'Add to favorites',
                                }}
                              />
                            )}

                        {canViewAdminContent && (() => {
                          const summary = scoreSummary?.qualityScore ?? scoreSummary?.aiScore ?? profileScore;
                          if (typeof summary !== 'number' || Number.isNaN(summary)) return null;
                          return (
                            <Chip
                              icon={<InsightsIcon sx={{ fontSize: 18 }} />}
                              label={`Score ${Math.round(summary)}`}
                              color="primary"
                              size="small"
                              variant="outlined"
                              sx={{ fontWeight: 700, flexShrink: 0 }}
                            />
                          );
                        })()}
                      </Stack>
                    </Box>
                    {/* Line 2: Contact Action Icons Row */}
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
                  {phone && (
                    <>
                      <Tooltip title={`Call ${phone}`}>
                        <IconButton
                          size="small"
                          component="a"
                          href={`tel:${phone.replace(/\D/g, '')}`}
                          sx={{ 
                            p: 1,
                            color: 'primary.main',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            '&:hover': {
                              color: 'primary.dark',
                              bgcolor: 'primary.light',
                              transform: 'translateY(-1px)',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            },
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <PhoneOutlinedIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Send Message">
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (viewerHasSmsSender) {
                              setSmsComposeOpen(true);
                              return;
                            }
                            const digits = phone.replace(/\D/g, '');
                            if (digits) {
                              window.location.href = `sms:${digits}`;
                            }
                          }}
                          sx={{ 
                            p: 1,
                            color: 'primary.main',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            '&:hover': {
                              color: 'primary.dark',
                              bgcolor: 'primary.light',
                              transform: 'translateY(-1px)',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            },
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <MessageIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                  {email && (
                    <Tooltip
                      title={
                        viewerGmailConnected
                          ? `Email ${email} (send via HRX)`
                          : `Email ${email} (open mail app)`
                      }
                    >
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (viewerGmailConnected) {
                            setEmailComposeOpen(true);
                          } else {
                            window.location.href = `mailto:${email}`;
                          }
                        }}
                        sx={{
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          },
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <EmailOutlinedIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {skillsData?.resume && skillsData.resume.fileName && (
                    <Tooltip title={`View Resume: ${skillsData.resume.fileName}`}>
                      <IconButton
                        size="small"
                        onClick={async () => {
                          const resume = skillsData.resume;
                          if (resume.downloadUrl) {
                            window.open(resume.downloadUrl, '_blank');
                          } else if (resume.storagePath) {
                            const encodedPath = encodeURIComponent(resume.storagePath);
                            const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
                            window.open(publicUrl, '_blank');
                          }
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <DescriptionIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {linkedinUrl && (
                    <Tooltip title="LinkedIn Profile">
                      <IconButton
                        size="small"
                        component="a"
                        href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <LinkedInIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {isAdminView && (
                    <Tooltip title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}>
                      <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setShowAddUserNoteDialog(true);
                          }}
                          sx={{ 
                            p: 1,
                            color: 'primary.main',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            '&:hover': {
                              color: 'primary.dark',
                              bgcolor: 'primary.light',
                              transform: 'translateY(-1px)',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            },
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <NoteIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Badge>
                    </Tooltip>
                  )}
                  {/* Add Task Icon Button */}
                  {isAdminView && (
                    <Tooltip title="Add Task">
                      <IconButton
                        size="small"
                        onClick={() => setShowCreateTaskDialog(true)}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <AddTaskIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {/* Log Activity Icon Button */}
                  {isAdminView && (
                    <Tooltip title="Log Activity">
                      <IconButton
                        size="small"
                        onClick={() => setShowLogActivityDialog(true)}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <CheckCircleIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                    </Stack>
                    {/* Line 3: Metadata subtitle */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      {(city || state) && (
                        <Typography
                          component="span"
                          variant="body2"
                          sx={{
                            fontSize: '14px',
                            fontWeight: 400,
                            color: 'rgba(0, 0, 0, 0.55)',
                          }}
                        >
                          {[city, state].filter(Boolean).join(', ')}
                        </Typography>
                      )}
                      {createdAt && (() => {
                        try {
                          // Handle Firestore Timestamp
                          let date: Date | null = null;
                          if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
                            date = createdAt.toDate();
                          } else if (createdAt instanceof Date) {
                            date = createdAt;
                          } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
                            date = new Date(createdAt);
                          } else if (createdAt?._seconds && typeof createdAt._seconds === 'number') {
                            date = new Date(createdAt._seconds * 1000);
                          }
                          
                          if (date && !isNaN(date.getTime())) {
                            const formattedDate = date.toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric', 
                              year: 'numeric' 
                            });
                            return (
                              <>
                                {(city || state) && (
                                  <Typography component="span" sx={{ color: 'rgba(0, 0, 0, 0.3)' }}>•</Typography>
                                )}
                                <Typography
                                  component="span"
                                  variant="body2"
                                  sx={{
                                    fontSize: '14px',
                                    fontWeight: 400,
                                    color: 'rgba(0, 0, 0, 0.55)',
                                  }}
                                >
                                  Created {formattedDate}
                                </Typography>
                              </>
                            );
                          }
                        } catch {
                          // Silently fail if date parsing fails
                        }
                        return null;
                      })()}
                      {!city && !state && !createdAt && jobTitle && (
                        <Typography
                          component="span"
                          variant="body2"
                          sx={{
                            fontSize: '14px',
                            fontWeight: 400,
                            color: 'rgba(0, 0, 0, 0.55)',
                          }}
                        >
                          {jobTitle}
                        </Typography>
                      )}
                    </Box>
                    {/* Line 4: User groups (member of) */}
                    {headerUserGroups.length > 0 && viewerSecurityLevel >= 4 && viewerSecurityLevel <= 7 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
                        <Typography
                          component="span"
                          variant="body2"
                          sx={{ fontSize: '14px', fontWeight: 500, color: 'rgba(0, 0, 0, 0.55)' }}
                        >
                          Member of:
                        </Typography>
                        {headerUserGroups.map((g, idx) => {
                          const href = `/usergroups/${g.id}`;
                          return (
                            <React.Fragment key={g.id}>
                              {idx > 0 && (
                                <Typography component="span" sx={{ color: 'rgba(0, 0, 0, 0.3)' }}>
                                  ,
                                </Typography>
                              )}
                              <MUILink
                                component="button"
                                onClick={() => navigate(href)}
                                underline="hover"
                                sx={{
                                  fontSize: '14px',
                                  fontWeight: 600,
                                  color: '#0057B8',
                                  cursor: 'pointer',
                                }}
                              >
                                {g.title}
                              </MUILink>
                            </React.Fragment>
                          );
                        })}
                      </Box>
                    )}
                    {/* Line 5: Status (Onboarding/Hired/Dismissed/etc.) */}
                    {!isOwnProfile && viewerSecurityLevel >= 5 && viewerSecurityLevel <= 7 && (statusLine?.text || interviewLine?.text) && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
                        {interviewLine?.text && (
                          <>
                            <Typography
                              component="span"
                              variant="body2"
                              sx={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: interviewLine.color,
                              }}
                            >
                              {interviewLine.text}
                            </Typography>
                            {statusLine?.text && (
                              <Typography component="span" sx={{ color: 'rgba(0, 0, 0, 0.3)' }}>
                                •
                              </Typography>
                            )}
                          </>
                        )}
                        <Typography
                          component="span"
                          variant="body2"
                          sx={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: statusLine.color,
                          }}
                        >
                          {statusLine.text}
                        </Typography>
                      </Box>
                    )}

                    {/* Line 6: Quick profile detail chips (hover for tooltip) */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {renderQuickChip('Bio', quickBio)}
                      {renderQuickChip('Skills', quickSkills.join('\n'))}
                      {renderQuickChip('Certifications', quickCerts.join('\n'))}
                      {renderQuickChip('Education', quickEducation.join('\n'))}
                      {renderQuickChip('Work Experience', quickWork.join('\n'))}
                      {renderQuickChip('Languages', quickLangs.join('\n'))}
                    </Box>

                    {/* Score Stack removed (now shown as a single summary score on the name line) */}
                  </Box>
                </Box>
              </Box>
            }
            titleRightActions={
              canViewAdminContent ? (
                <Tooltip title="Leave a star review" arrow>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                    <Rating
                      // Show existing review average as filled stars; allow click to open add-review flow.
                      value={quickReviewStars ?? scoreSummary?.reviewAvg ?? 0}
                      precision={0.1}
                      onChange={(_, value) => {
                        if (!value) return;
                        setQuickReviewStars(value);
                        setTabValue('Score');
                        const pathname = window.location.pathname;
                        const params = new URLSearchParams(window.location.search);
                        params.delete('tab');
                        params.set('openReview', '1');
                        params.set('stars', String(value));
                        const search = params.toString();
                        navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
                        setTimeout(() => setQuickReviewStars(null), 0);
                      }}
                      size="medium"
                    />
                  </Box>
                </Tooltip>
              ) : null
            }
            subtitle={undefined}
            filters={
              isRecruiterRoute ? (
                <Box display="flex" gap={0.5}>
                  {availableTabs.map((tab, i) => {
                    const isActive = tabValue === tab.label;
                    const hasCount = tab.count !== undefined && tab.count > 0;
                    return (
                      <Button
                        key={`${tab.label}-${i}`}
                        onClick={() => handleTabChange({} as React.SyntheticEvent, tab.label)}
                        variant="text"
                        sx={{
                          textTransform: 'none',
                          borderRadius: '999px',
                          fontSize: '14px',
                          fontWeight: isActive ? 500 : 400,
                          color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                          bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                          px: 1.5,
                          py: 0.75,
                          minWidth: 'auto',
                          whiteSpace: 'nowrap',
                          '&:hover': {
                            bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {tab.label}
                          {hasCount && <Badge badgeContent={tab.count} color="primary" />}
                        </Box>
                      </Button>
                    );
                  })}
                </Box>
              ) : (
                <Box display="flex" gap={0.5}>
                  <Button
                    onClick={() => handleTabChange({} as React.SyntheticEvent, 'Overview')}
                    variant="text"
                    sx={{
                      textTransform: 'none',
                      borderRadius: '999px',
                      fontSize: '14px',
                      fontWeight: tabValue === 'Overview' ? 500 : 400,
                      color: tabValue === 'Overview' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      bgcolor: tabValue === 'Overview' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                      px: 1.5,
                      py: 0.75,
                      minWidth: 'auto',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        bgcolor: tabValue === 'Overview' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                      },
                    }}
                  >
                    Overview
                  </Button>
                  {availableTabs.some((t) => t.label === 'Settings') && (
                    <Button
                      onClick={() => handleTabChange({} as React.SyntheticEvent, 'Settings')}
                      variant="text"
                      sx={{
                        textTransform: 'none',
                        borderRadius: '999px',
                        fontSize: '14px',
                        fontWeight: tabValue === 'Settings' ? 500 : 400,
                        color: tabValue === 'Settings' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                        bgcolor: tabValue === 'Settings' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                        px: 1.5,
                        py: 0.75,
                        minWidth: 'auto',
                        whiteSpace: 'nowrap',
                        '&:hover': {
                          bgcolor: tabValue === 'Settings' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                        },
                      }}
                    >
                      Settings
                    </Button>
                  )}
                </Box>
              )
            }
            rightActions={
              isRecruiterRoute ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate('/users')}
                    variant="outlined"
                    sx={{
                      textTransform: 'none',
                      borderRadius: '999px',
                      fontSize: '14px',
                      fontWeight: 500,
                      px: 1.5,
                      py: 0.75,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Back
                  </Button>

                  {canViewAdminContent && isAdminView && (
                    onboardingInProgress ? (
                      <Button
                        variant="contained"
                        disabled
                        sx={{
                          textTransform: 'none',
                          borderRadius: '999px',
                          fontSize: '14px',
                          fontWeight: 500,
                          px: 1.5,
                          py: 0.75,
                          whiteSpace: 'nowrap',
                          '&.Mui-disabled': {
                            backgroundImage: onboardingAccentGradient,
                            color: '#FFFFFF',
                            opacity: 1,
                          },
                          '&.Mui-disabled:hover': {
                            backgroundImage: onboardingAccentGradientHover,
                            color: '#FFFFFF',
                            opacity: 1,
                          },
                        }}
                      >
                        Onboarding
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        onClick={() => setShowStartOnboardingDialog(true)}
                        sx={{
                          borderColor: 'success.main',
                          color: 'success.main',
                          textTransform: 'none',
                          borderRadius: '999px',
                          fontSize: '14px',
                          fontWeight: 500,
                          px: 1.5,
                          py: 0.75,
                          whiteSpace: 'nowrap',
                          '&:hover': {
                            borderColor: 'success.dark',
                            backgroundColor: 'success.light',
                            color: 'success.dark',
                          },
                        }}
                      >
                        Start Onboarding
                      </Button>
                    )
                  )}
                </Box>
              ) : (
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={() => {
                    if (isWorkforceRoute) {
                      navigate('/workforce/company-directory');
                    } else {
                      navigate(-1);
                    }
                  }}
                  variant="outlined"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: 500,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  Back
                </Button>
              )
            }
          />
        ) : (
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
        )}

        <Box sx={{ mt: 2, px: { xs: 2, md: 3 }, pb: 2 }} className="profile-tab-content">
          {(() => {
            const label = currentLabel;
            if (!label || !availableTabLabels.includes(label)) return null;
            switch (label) {
              case 'Overview':
                return <ProfileOverview uid={uid} onTabChange={(tab: string) => handleTabChange({} as React.SyntheticEvent, tab)} />;
              case 'Interview':
                return <InterviewTab uid={uid} />;
              case 'Score':
                return (
                  <ScoreTab
                    uid={uid}
                    scoreSummary={scoreSummary}
                    fallbackAiScore={profileScore}
                    onGoToInterview={() => handleTabChange({} as React.SyntheticEvent, 'Interview')}
                  />
                );
              case 'Qualifications':
                return <QualificationsTab uid={uid} />;
              case 'Applications':
                return <UserApplicationsTab userId={uid} />;
              case 'Assignments':
                return <UserAssignmentsTab userId={uid} />;
              case 'User Groups':
                return <UserGroupsTab uid={uid} tenantId={tenantId || authTenantId || activeTenant?.id || undefined} />;
              case 'Onboarding':
                return <OnboardingTab uid={uid} tenantId={tenantId || ''} />;
              case 'Backgrounds':
                return <CombinedBackgroundAndVaccinationTab uid={uid} />;
              case 'Reports & Insights':
                return <ReportsAndInsightsTab uid={uid} />;
              case 'Notes':
                return <NotesTab uid={uid} user={user} />;
              case 'Messages':
                return <MessagesTab uid={uid} tenantId={tenantId || undefined} />;
              case 'Activity Log':
                return <ActivityLogTab uid={uid} user={user} refreshTrigger={activityLogRefreshKey} />;
              case 'Settings':
                return <SystemAccessTab uid={uid} />;
              default:
                return null;
            }
          })()}
        </Box>
      </Box>
      {/* <ChatUI workerId={uid} tenantId={tenantId || undefined} showFAQ={true} /> */}

      {/* Message Drawer */}
      {uid && tenantId && (
        <MessageDrawer
          open={messageDrawerOpen}
          onClose={() => setMessageDrawerOpen(false)}
          recipients={[{
            userId: uid,
            name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
            email: email || undefined,
            phone: phone || undefined,
            avatar: avatarUrl || undefined,
          }]}
          tenantId={tenantId}
          onSend={(result) => {
            console.log('Message sent:', result);
            // Could show a success snackbar here
          }}
        />
      )}

      {/* Email Compose Drawer (opens from Email icon when viewer has Gmail connected) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <MessageDrawer
          open={emailComposeOpen}
          onClose={() => setEmailComposeOpen(false)}
          recipients={[
            {
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
              email: email || undefined,
              phone: phone || undefined,
              avatar: avatarUrl || undefined,
            },
          ]}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          defaultChannels={['email']}
        />
      )}

      {/* SMS Compose Drawer (opens from SMS icon when viewer has recruiter SMS sender) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <MessageDrawer
          open={smsComposeOpen}
          onClose={() => setSmsComposeOpen(false)}
          recipients={[
            {
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
              email: email || undefined,
              phone: phone || undefined,
              avatar: avatarUrl || undefined,
            },
          ]}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          defaultChannels={['sms']}
        />
      )}

      {/* Add Note Dialog (opens from Note icon in Record header) */}
      {uid && isAdminView && (
        <AddUserNoteDialog
          open={showAddUserNoteDialog}
          onClose={() => setShowAddUserNoteDialog(false)}
          userId={uid}
          userName={`${firstName} ${lastName}`.trim() || preferredName || 'User'}
          onNoteAdded={() => {
            setNotesCount((c) => c + 1);
            setTabValue('Notes');
          }}
        />
      )}

      {/* Start Onboarding Dialog (Recruiter record view) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <StartOnboardingDialog
          open={showStartOnboardingDialog}
          onClose={() => setShowStartOnboardingDialog(false)}
          userId={uid}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          employeeOnboardStatus={employeeOnboardStatus}
          contractorOnboardStatus={contractorOnboardStatus}
          onOnboardingStarted={async () => {
            const userRef = doc(db, 'users', uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              setEmployeeOnboardStatus(data.employeeOnboardStatus);
              setContractorOnboardStatus(data.contractorOnboardStatus);
            }
          }}
        />
      )}

      {/* Create Task Dialog */}
      {showCreateTaskDialog && uid && (tenantId || authTenantId || activeTenant?.id) && (
        <CreateTaskDialog
          open={showCreateTaskDialog}
          onClose={() => setShowCreateTaskDialog(false)}
          onSubmit={async (taskData) => {
            if (taskSubmitting) return;
            setTaskSubmitting(true);
            setShowCreateTaskDialog(false);
            try {
              // Import TaskService dynamically to avoid circular dependencies
              const { TaskService } = await import('../../utils/taskService');
              const taskService = TaskService.getInstance();
              
              await taskService.createTask({
                ...taskData,
                tenantId: (tenantId || authTenantId || activeTenant?.id) as string,
                createdBy: user?.uid || '',
                // Ensure tasks created from a user profile are assigned to the logged-in viewer by default
                assignedTo: user?.uid || '',
                associations: {
                  ...(taskData?.associations || {}),
                  // Associate this task to the viewed user record (not a CRM contact).
                  // Backend accepts arbitrary association keys; this is a lightweight linkage for future filtering/UI.
                  users: [uid]
                }
              });
            } catch (error) {
              console.error('Error creating task:', error);
            } finally {
              setTaskSubmitting(false);
            }
          }}
          prefilledData={{
            assignedTo: user?.uid || '',
            associations: {
              users: [uid]
            }
          }}
          // In user context we auto-associate; hide CRM-only pickers.
          hideCrmAssociations
          currentUserId={user?.uid || ''}
          loading={taskSubmitting}
        />
      )}

      {/* Log Activity Dialog */}
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={async (taskData) => {
          setLogActivityLoading(true);
          try {
            const { TaskService } = await import('../../utils/taskService');
            const taskService = TaskService.getInstance();
            const result = await taskService.createTask({
              ...taskData,
              tenantId: (tenantId || authTenantId || activeTenant?.id) as string,
              createdBy: user?.uid || '',
              assignedTo: user?.uid || '',
              status: 'completed',
              completedAt: new Date(),
              associations: {
                ...taskData.associations,
                // Associate to the viewed user record (and keep viewer linkage for dashboards)
                users: uid ? [uid] : [],
                salespeople: user?.uid ? [user.uid] : []
              }
            });
            // Save to this user's activity log so it appears in Activity History tab
            if (uid) {
              await logUserActivity({
                userId: uid,
                action: taskData.title || 'Activity logged',
                actionType: 'other',
                description: taskData.description || '',
                severity: (taskData.priority === 'low' || taskData.priority === 'high' ? taskData.priority : 'medium') as 'low' | 'medium' | 'high',
                source: 'web',
                metadata: { taskId: result?.taskId, loggedBy: user?.uid }
              });
              setActivityLogRefreshKey((k) => k + 1);
            }
            setShowLogActivityDialog(false);
          } catch (error) {
            console.error('Error logging activity:', error);
          } finally {
            setLogActivityLoading(false);
          }
        }}
        loading={logActivityLoading}
        // In user context we auto-associate; hide CRM pickers and default to Recruiting.
        hideCrmAssociations
        relatedUser={{ id: uid || '', name: `${firstName} ${lastName}`.trim() || preferredName || 'User' }}
        defaultQuotaCategory="recruiting"
        salespeople={[]}
        contacts={[]}
        preselectContactsFromProps={false}
        currentUserId={user?.uid || ''}
        tenantId={tenantId || authTenantId || activeTenant?.id || ''}
      />
    </Box>
  );
};

export default UserProfilePage;
