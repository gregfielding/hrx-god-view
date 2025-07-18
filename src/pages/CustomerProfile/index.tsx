import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Button } from '@mui/material';
import { useParams, useMatch, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase'; // adjust path

import ProfileOverview from './components/ProfileOverview';
// import AddressTab from './components/AddressTab/AddressTab';
import UserProfileHeader from './components/CustomerProfileHeader';
import ContactsTab from '../CustomerProfile/components/ContactsTab';
import AddCustomerForm from './AddCustomerForm';
import LocationsTab from './components/LocationsTab';
import WorkforceTab from './components/WorkforceTab';
import AISettingsTab from './components/AISettingsTab';
import AITrainingTab from './components/AITrainingTab';
import LocationDetails from './LocationDetails';
import CompanySettingsTab from './components/CompanySettingsTab';
import { useAuth } from '../../contexts/AuthContext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const [tabIndex, setTabIndex] = useState(0);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [tenantId, setTenantId] = useState<string | null>(null);

  const matchLocation = useMatch('/tenants/:uid/locations/:locationId');
  const locationId = matchLocation?.params.locationId;
  const navigate = useNavigate();
  const { orgType, accessRole } = useAuth();

  useEffect(() => {
    const fetchUserData = async () => {
      if (uid) {
        const userRef = doc(db, 'tenants', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setName(data.name || '');
          setAvatarUrl(data.avatar || '');
          setTenantId(data.tenantId || null);
        }
      }
    };
    fetchUserData();
  }, [uid]);

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    navigate(`/tenants/${uid}?tab=${newIndex}`);
  };

  if (uid === 'new') {
    return <AddCustomerForm />;
  }

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No User ID provided</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <UserProfileHeader
          uid={uid}
          name={name}
          avatarUrl={avatarUrl}
          onAvatarUpdated={setAvatarUrl}
        />
        <Button
          variant="outlined"
          onClick={() => navigate('/tenants')}
          sx={{
            color: 'primary.main',
            borderColor: 'primary.main',
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          Back to Customers
        </Button>
      </Box>

      <Tabs
        value={tabIndex}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label="Locations" />
        <Tab label="Departments" />
        {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && <Tab label="Manage Users" />}
        {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && <Tab label="Workforce" />}
        {/* {tenantId && <Tab label="Job Orders" />}
        {tenantId && <Tab label="Shifts" />}
        {tenantId && <Tab label="Timesheets" />} */}
        {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && <Tab label="AI Settings" />}
        {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && <Tab label="Reports & Insights" />}
        
        
        {/* <Tab label="AI Training" />
        <Tab label="Activity Logs" /> */}
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {locationId && tabIndex === 3 ? (
          <LocationDetails
            tenantId={uid}
            locationId={locationId}
            onBack={() => navigate(`/tenants/${uid}?tab=3`)}
          />
        ) : (
          <>
            {tabIndex === 0 && <ProfileOverview tenantId={uid} />}
            {tabIndex === 1 && <LocationsTab tenantId={uid} />}
            {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && tabIndex === 2 &&  <CompanySettingsTab tenantId={uid} />}
            
            {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && tabIndex === 3 && <ContactsTab tenantId={uid} />}
            {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && tabIndex === 4 && <WorkforceTab tenantId={uid} />}
            {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && tabIndex === 5 &&  <AISettingsTab tenantId={uid} />}
            {/* {tabIndex === 9 && <AITrainingTab tenantId={uid} />} */}
            {/* Future tabs here */}
            {/* {tenantId && tabIndex === 5 && <div>Job Orders content here</div>}
            {tenantId && tabIndex === 6 && <div>Shifts content here</div>}
            {tenantId && tabIndex === 7 && <div>Timesheets content here</div>} */}
          </>
        )}
      </Box>
    </Box>
  );
};

export default UserProfilePage;
