import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button, Paper, Alert } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase'; // adjust path
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';
import { useAuth } from '../../contexts/AuthContext';

import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';
import SkillsTab, { CombinedBackgroundAndVaccinationTab } from './components/SkillsTab';
import ReportsAndInsightsTab from './components/ReportsAndInsightsTab';
import NotesTab from './components/NotesTab';
import ActivityLogTab from './components/ActivityLogTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';
import PrivacySettingsTab from './components/PrivacySettingsTab';
import UserGroupsTab from './components/UserGroupsTab';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { user, securityLevel, role } = useAuth();
  
  // Debug logging
  console.log('UserProfile Debug:', {
    currentUserUid: user?.uid,
    targetUserUid: uid,
    securityLevel,
    role,
    isOwnProfile: user?.uid === uid
  });
  
  const [tabIndex, setTabIndex] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredName, setPreferredName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [skillsData, setSkillsData] = useState<any>(null);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
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
  const navigate = useNavigate();

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

  // Define which tabs are available based on user role
  const getAvailableTabs = () => {
    const isOwnProfile = user?.uid === uid;
    const isWorker = securityLevel === '5';
    const isManager = securityLevel === '6';
    const isAdmin = securityLevel === '7';
    // Debug logging to understand what's happening
    console.log('Tab availability check:', {
      securityLevel,
      isWorker,
      isManager,
      isAdmin,
      isOwnProfile
    });

    const tabs = [
      { label: 'Overview', available: true },
      { 
        label: 'Qualifications', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'Assignments', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'Background & Vaccination', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'Reports & Insights', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'Notes', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'Activity Log', 
        available: parseInt(securityLevel) <= 4 
      },
      { 
        label: 'User Groups', 
        available: isAdmin || isManager 
      },
      { 
        label: 'Privacy & Notifications', 
        available: isOwnProfile || isAdmin || isManager 
      },
    ];

    const availableTabs = tabs
      .filter(tab => tab.available)
      .map((tab, index) => ({ ...tab, index }));
    
    console.log('Available tabs:', availableTabs.map(t => `${t.label} (${t.index})`));
    
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

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
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

  const availableTabs = getAvailableTabs();
  const currentTab = availableTabs.find(tab => tab.index === tabIndex);
  
  // If current tab is not available, reset to first available tab
  if (!currentTab && availableTabs.length > 0) {
    setTabIndex(availableTabs[0].index);
  }

  // Create breadcrumb path for workforce navigation
  const breadcrumbPath = [
    { label: 'Workforce', href: '/workforce' },
    { label: 'Company Directory', href: '/workforce/company-directory' },
    { label: `${firstName} ${lastName}${preferredName && preferredName !== firstName ? ` (${preferredName})` : ''}` }
  ];

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
          showBackButton={user?.uid !== uid}
          onBack={() => navigate(-1)}
          jobTitle={jobTitle}
          phone={phone}
          email={email}
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
          showBreadcrumbs={user?.uid !== uid}
          breadcrumbPath={breadcrumbPath}
        />

        <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
          <Tabs
            value={tabIndex}
            onChange={handleTabChange}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            aria-label="user profile tabs"
          >
            {availableTabs.map((tab) => (
              <Tab key={tab.index} label={tab.label} />
            ))}
          </Tabs>
        </Paper>

        <Box sx={{ mt: 2 }}>
          {(() => {
            const availableTabs = getAvailableTabs();
            const currentTab = availableTabs.find(tab => tab.index === tabIndex);
            
            if (!currentTab) return null;
            
            switch (currentTab.label) {
              case 'Overview':
                return <ProfileOverview uid={uid} />;
              case 'Qualifications':
                return skillsData && (
                  <SkillsTab
                    user={skillsData}
                    onUpdate={handleSkillsUpdate}
                    onetSkills={onetSkills}
                    onetJobTitles={onetJobTitles}
                  />
                );
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
