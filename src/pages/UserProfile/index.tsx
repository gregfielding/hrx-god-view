import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button, Paper, Alert } from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase'; // adjust path
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';
import { useAuth } from '../../contexts/AuthContext';
import { calculateProfileScore } from '../../utils/applicantScoring';
import { userProfileBatcher, flushProfileUpdates } from '../../utils/userProfileBatching';

import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';
import SkillsTab, { CombinedBackgroundAndVaccinationTab } from './components/SkillsTab';
import SkillsOnlyTab from './components/SkillsOnlyTab';
import EducationTab from './components/EducationTab';
import WorkExperienceTab from './components/WorkExperienceTab';
import WorkEligibilityTab from './components/WorkEligibilityTab';
import ResumeTab from './components/ResumeTab';
import QualificationsTab from './components/QualificationsTab';
import PreferencesTab from './components/PreferencesTab';
import LicensesAndCertsTab from './components/LicensesAndCertsTab';
import ReportsAndInsightsTab from './components/ReportsAndInsightsTab';
import NotesTab from './components/NotesTab';
import ActivityLogTab from './components/ActivityLogTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';
import PrivacySettingsTab from './components/PrivacySettingsTab';
import UserGroupsTab from './components/UserGroupsTab';
import SystemAccessTab from './components/SystemAccessTab';
import UserApplicationsTab from './components/UserApplicationsTab';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { user, securityLevel, role } = useAuth();
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

    const tabs = [
      { label: 'Overview', available: true },
      { label: 'Work Eligibility', available: !isWorkforceInternalTeamView },
      { label: 'Resumé', available: !isWorkforceInternalTeamView },
      { label: 'Skills', available: !isWorkforceInternalTeamView },
      { label: 'Education', available: !isWorkforceInternalTeamView },
      { label: 'Work Experience', available: !isWorkforceInternalTeamView },
      { label: 'Qualifications', available: !isWorkforceInternalTeamView },
      { label: 'Preferences', available: !isWorkforceInternalTeamView },
      { label: 'Licenses & Certs', available: !isWorkforceInternalTeamView },
      { label: 'Applications', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'Assignments', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'Background & Vaccination', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'Reports & Insights', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'Notes', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'Activity Log', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'User Groups', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView },
      { label: 'System Access', available: (isAdminViewer && !isWorkerRoute) || isWorkforceInternalTeamView },
      { label: 'Privacy & Notifications', available: ((isOwnProfile || isAdminViewer) && !isWorkerRoute) && !isWorkforceInternalTeamView },
    ];

    const availableTabLabels = tabs.filter(t => t.available).map(t => t.label);
    console.log('Available tabs:', availableTabLabels);
    return availableTabLabels;
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
          setCustomerId(data.tenantId || null);
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
          // New fields from the schema
          preferredName: data.preferredName || '',
          dateOfBirth: data.dateOfBirth || null,
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
      }
    });
    return () => unsubscribe();
  }, [uid, user, securityLevel]);

  // Handle tab query parameter - must be before early returns
  const availableTabs = getAvailableTabs();
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'licenses') {
      const hasLicenses = availableTabs.includes('Licenses & Certs');
      if (hasLicenses) setTabValue('Licenses & Certs');
    }
  }, [searchParams, availableTabs]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: string) => {
    // Only change local state; do not navigate to a different route which
    // causes a remount and resets the tab for worker (level 2) users.
    setTabValue(newValue);

    // Keep the current pathname exactly as-is and only update the search param
    // when Licenses & Certs is selected, so deep links still work.
    const selectedLabel = newValue;
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (selectedLabel === 'Licenses & Certs') {
      params.set('tab', 'licenses');
    } else {
      params.delete('tab');
    }
    const search = params.toString();
    navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
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
  
  // If current tab is not available, reset to first available tab
  if ((!currentLabel || !availableTabs.includes(currentLabel)) && availableTabs.length > 0) {
    setTabValue(availableTabs[0]);
  }

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
    <>
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
        />

        <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            aria-label="user profile tabs"
          >
            {availableTabs.map((label, i) => (
              <Tab key={i} label={label} value={label} />
            ))}
          </Tabs>
        </Paper>

        <Box sx={{ mt: 2 }}>
          {(() => {
            const label = currentLabel;
            if (!label || !availableTabs.includes(label)) return null;
            switch (label) {
              case 'Overview':
                return <ProfileOverview uid={uid} />;
              case 'Work Eligibility':
                return skillsData && (
                  <WorkEligibilityTab
                    user={skillsData}
                    onUpdate={handleSkillsUpdate}
                  />
                );
              case 'Resumé':
                return <ResumeTab uid={uid} />;
              case 'Skills':
                return <SkillsOnlyTab uid={uid} />;
              case 'Education':
                return <EducationTab uid={uid} />;
              case 'Work Experience':
                return <WorkExperienceTab uid={uid} />;
              case 'Qualifications':
                return <QualificationsTab uid={uid} />;
              case 'Preferences':
                return <PreferencesTab uid={uid} />;
              case 'Licenses & Certs':
                return <LicensesAndCertsTab uid={uid} />;
              case 'Applications':
                return <UserApplicationsTab userId={uid} />;
              case 'Assignments':
                return <UserAssignmentsTab userId={uid} />;
              case 'Background & Vaccination':
                return <CombinedBackgroundAndVaccinationTab uid={uid} />;
              case 'Reports & Insights':
                return <ReportsAndInsightsTab uid={uid} />;
              case 'Notes':
                return <NotesTab uid={uid} user={user} />;
              case 'Activity Log':
                return <ActivityLogTab uid={uid} user={user} />;
              case 'User Groups':
                return <UserGroupsTab uid={uid} />;
              case 'System Access':
                return <SystemAccessTab uid={uid} />;
              case 'Privacy & Notifications':
                return <PrivacySettingsTab uid={uid} />;
              default:
                return null;
            }
          })()}
        </Box>
      </Box>
      {/* <ChatUI workerId={uid} tenantId={tenantId || undefined} showFAQ={true} /> */}
    </>
  );
};

export default UserProfilePage;
