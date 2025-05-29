import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase'; // adjust path

import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const [tabIndex, setTabIndex] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');

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

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
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
        <Tab label="Activity Logs" />
        <Tab label="Tenant Associations" />
        <Tab label="Shifts" />
        <Tab label="C1 Insights" />
        <Tab label="Reports & Scores" />
        <Tab label="Settings" />
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {tabIndex === 0 && <ProfileOverview uid={uid} />}
        {/* Future tabs here */}
      </Box>
    </Box>
  );
};

export default UserProfilePage;
