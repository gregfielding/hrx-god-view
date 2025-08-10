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
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [skillsData, setSkillsData] = useState<any>(null);
  const [tenantId, setCustomerId] = useState<string | null>(null);
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
      { label: 'Overview', index: 0, available: true },
      { label: 'Qualifications', index: 1, available: true },
      { label: 'Assignments', index: 2, available: true },
      { 
        label: 'Background & Vaccination', 
        index: 3, 
        available: isAdmin || isManager || !isWorker 
      },
      { 
        label: 'Reports & Insights', 
        index: 4, 
        available: isAdmin || isManager || !isWorker 
      },
      { 
        label: 'Notes', 
        index: 5, 
        available: isAdmin || isManager || !isWorker 
      },
      { 
        label: 'Activity Log', 
        index: 6, 
        available: isAdmin || isManager || !isWorker 
      },
      { 
        label: 'Privacy & Notifications', 
        index: 7, 
        available: isOwnProfile || isAdmin || isManager 
      },
    ];

    const availableTabs = tabs.filter(tab => tab.available);
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
          setAvatarUrl(data.avatar || '');
          setCustomerId(data.tenantId || null);
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

  return (
    <>
      <Box sx={{ p: 0 }}>
        <UserProfileHeader
          uid={uid}
          firstName={firstName}
          lastName={lastName}
          avatarUrl={avatarUrl}
          onAvatarUpdated={setAvatarUrl}
          showBackButton={user?.uid !== uid}
          onBack={() => navigate(-1)}
        />

        <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
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
          {tabIndex === 0 && <ProfileOverview uid={uid} />}
          {tabIndex === 1 && skillsData && (
            <SkillsTab
              user={skillsData}
              onUpdate={handleSkillsUpdate}
              onetSkills={onetSkills}
              onetJobTitles={onetJobTitles}
            />
          )}
          {tabIndex === 2 && <UserAssignmentsTab userId={uid} />}
          {tabIndex === 3 && <CombinedBackgroundAndVaccinationTab uid={uid} />}
          {tabIndex === 4 && <ReportsAndInsightsTab uid={uid} />}
          {tabIndex === 5 && <NotesTab uid={uid} user={user} />}
          {tabIndex === 6 && <ActivityLogTab uid={uid} user={user} />}
          {tabIndex === 7 && <PrivacySettingsTab uid={uid} />}
          {/* Future tabs here */}
        </Box>
      </Box>
      {/* <ChatUI workerId={uid} tenantId={tenantId || undefined} showFAQ={true} /> */}
    </>
  );
};

export default UserProfilePage;
