import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase'; // adjust path

import ProfileOverview from './components/ProfileOverview';
import AddressTab from './components/AddressTab/AddressTab';
import UserProfileHeader from './components/TenantProfileHeader';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const [tabIndex, setTabIndex] = useState(0);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  useEffect(() => {
    const fetchUserData = async () => {
      if (uid) {
        const userRef = doc(db, 'tenants', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setName(data.name || '');
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
        name={name}
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
        <Tab label="Modules" />
        <Tab label="Users" />
        <Tab label="Cost Centers" />
        <Tab label="Clients" />
        <Tab label="Users" />
        <Tab label="Job Orders" />
        <Tab label="Shifts" />
        <Tab label="Timesheets" />
        <Tab label="C1 Insights" />
        <Tab label="Reports & Scores" />
        <Tab label="AI Settings" />
        <Tab label="Activity Logs" />
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {tabIndex === 0 && <ProfileOverview tenantId={uid} />}
        {tabIndex === 3 && <AddressTab uid={uid} />}
        {/* Future tabs here */}
      </Box>
    </Box>
  );
};

export default UserProfilePage;
