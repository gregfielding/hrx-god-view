import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { useParams, useLocation, useMatch, useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';

import ProfileOverview from './components/ProfileOverview';
import AgencyProfileHeader from './components/AgencyProfileHeader';
import AddAgencyForm from './AddAgencyForm';
import ModulesTab from './components/ModulesTab';
import LocationsTab from './components/LocationsTab';
import LocationDetails from './LocationDetails';
import ContactsTab from './components/ContactsTab';
import ContactDetails from './ContactDetails';
import CustomersTab from './components/CustomersTab';
import WorkforceTab from './components/WorkforceTab';
import UserGroupsTab from './components/UserGroupsTab';
import SettingsTab from './components/SettingsTab';
import JobOrdersTab from './components/JobOrdersTab';
import AgencyAssignmentsTab from './components/AgencyAssignmentsTab';
import AISettingsTab from './components/AISettingsTab';

const noop = () => {
  /* intentionally left blank */
};

const AgencyProfilePage = () => {
  const location = useLocation();
  const { uid } = useParams<{ uid: string }>();
  const matchLocation = useMatch('/tenants/:uid/locations/:locationId');
  const locationId = matchLocation?.params.locationId;
  const matchContact = useMatch('/tenants/:uid/contacts/:contactId');
  const contactId = matchContact?.params.contactId;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  useEffect(() => {
    const fetchTenantData = async () => {
      if (uid) {
        const tenantRef = doc(db, 'tenants', uid);
        const tenantSnap = await getDoc(tenantRef);
        if (tenantSnap.exists()) {
          const data = tenantSnap.data();
          setName(data.name || '');
          setAvatarUrl(data.avatar || '');
        }
      }
    };
    fetchTenantData();

    // Set tabIndex from query param on mount and when searchParams changes
    const tabParam = searchParams.get('tab');
    if (tabParam && !locationId) {
      setTabIndex(Number(tabParam));
    }
    // eslint-disable-next-line
  }, [uid, searchParams, locationId]);

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    navigate(`/tenants/${uid}?tab=${newIndex}`);
  };

  if (uid === 'new') {
    return <AddAgencyForm />;
  }

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No Tenant ID provided</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <AgencyProfileHeader
        uid={uid}
        name={name}
        avatarUrl={avatarUrl}
        onAvatarUpdated={setAvatarUrl}
      />

      <Tabs
        value={contactId ? 4 : locationId ? 2 : tabIndex}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label="Settings" />
        <Tab label="Locations" />
        <Tab label="Modules" />
        <Tab label="Manage Users" />
        <Tab label="Workforce" />
        <Tab label="User Groups" />
        <Tab label="Customers" />
        <Tab label="Job Orders" />
        <Tab label="Assignments" />
        {/* <Tab label="Shifts" /> */}

        <Tab label="AI Settings" />
        <Tab label="Timesheets" />
        {/* <Tab label="Reports & Insights" />
        <Tab label="AI Settings" />
        <Tab label="Activity Logs" /> */}
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {contactId ? (
          <ContactDetails
            tenantId={uid}
            contactId={contactId}
            onBack={() => navigate(`/tenants/${uid}?tab=4`)}
          />
        ) : locationId ? (
          <LocationDetails
            tenantId={uid}
            locationId={locationId}
            onBack={() => navigate(`/tenants/${uid}?tab=2`)}
          />
        ) : (
          <>
            {tabIndex === 0 && <ProfileOverview tenantId={uid} />}
            {tabIndex === 1 && <SettingsTab tenantId={uid} />}
            {tabIndex === 2 && <LocationsTab tenantId={uid} />}
            {tabIndex === 3 && <ModulesTab tenantId={uid} />}
            {tabIndex === 4 && <ContactsTab tenantId={uid} />}
            {tabIndex === 5 && <WorkforceTab tenantId={uid} />}
            {tabIndex === 6 && <UserGroupsTab tenantId={uid} />}
            {tabIndex === 7 && <CustomersTab tenantId={uid} />}
            {tabIndex === 8 && <JobOrdersTab tenantId={uid} />}
            {tabIndex === 9 && <AgencyAssignmentsTab tenantId={uid} />}
            {tabIndex === 10 && <AISettingsTab tenantId={uid} />}
            {/* Future tabs here */}
          </>
        )}
      </Box>
    </Box>
  );
};

export default AgencyProfilePage;

export {};
// ... existing code ...
