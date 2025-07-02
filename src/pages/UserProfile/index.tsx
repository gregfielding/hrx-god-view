import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase'; // adjust path
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';

import ProfileOverview from './components/ProfileOverview';
import AddressTab from './components/AddressTab/AddressTab';
import UserProfileHeader from './components/UserProfileHeader';
import SkillsTab from './components/SkillsTab';
import BackgroundCheckTab from './components/SkillsTab/BackgroundCheckTab';
import VaccinationStatusTab from './components/SkillsTab/VaccinationStatusTab';
import CustomerWorksiteTab from './components/CustomerWorksiteTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const [tabIndex, setTabIndex] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [skillsData, setSkillsData] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      if (uid) {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFirstName(data.firstName || '');
          setLastName(data.lastName || '');
          setAvatarUrl(data.avatar || '');
        }
      }
    };
    fetchUserData();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
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
        });
      }
    });
    return () => unsubscribe();
  }, [uid]);

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
  };

  const handleSkillsUpdate = async (updated: any) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, updated);
  };

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No User ID provided</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <UserProfileHeader
        uid={uid}
        firstName={firstName}
        lastName={lastName}
        avatarUrl={avatarUrl}
        onAvatarUpdated={setAvatarUrl}
        showBackButton
        onBack={() => navigate(-1)}
      />

      <Tabs
        value={tabIndex}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label="Address" />
        <Tab label="Work ID" />
        <Tab label="Background Check" />
        <Tab label="Vaccination Status" />
        <Tab label="Customer (Worksite)" />
        <Tab label="Assignments" />
        <Tab label="Agency" />
        <Tab label="Skill Vault" />
        <Tab label="Shifts" />
        <Tab label="Behavioral IQ" />
        <Tab label="Reports & Insights" />
        <Tab label="Settings" />
        <Tab label="Activity Logs" />
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {tabIndex === 0 && <ProfileOverview uid={uid} />}
        {tabIndex === 1 && <AddressTab uid={uid} />}
        {tabIndex === 2 && skillsData && (
          <SkillsTab
            user={skillsData}
            onUpdate={handleSkillsUpdate}
            onetSkills={onetSkills}
            onetJobTitles={onetJobTitles}
          />
        )}
        {tabIndex === 3 && <BackgroundCheckTab uid={uid} />}
        {tabIndex === 4 && <VaccinationStatusTab uid={uid} />}
        {tabIndex === 6 && <UserAssignmentsTab userId={uid} />}
        {/* Future tabs here */}
      </Box>
    </Box>
  );
};

export default UserProfilePage;
