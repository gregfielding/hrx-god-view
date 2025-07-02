import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { useParams, useLocation, useMatch, useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

import ProfileOverview from './components/ProfileOverview';
import AddressTab from './components/AddressTab/AddressTab';
import AgencyProfileHeader from './components/AgencyProfileHeader';
import AddAgencyForm from './AddAgencyForm';
import BillingInfoTab from './components/BillingInfoTab';
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

const noop = () => { /* intentionally left blank */ };

const AgencyProfilePage = () => {
  const location = useLocation();
  const { uid } = useParams<{ uid: string }>();
  const matchLocation = useMatch('/agencies/:uid/locations/:locationId');
  const locationId = matchLocation?.params.locationId;
  const matchContact = useMatch('/agencies/:uid/contacts/:contactId');
  const contactId = matchContact?.params.contactId;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  useEffect(() => {
    const fetchAgencyData = async () => {
      if (uid) {
        const agencyRef = doc(db, 'agencies', uid);
        const agencySnap = await getDoc(agencyRef);
        if (agencySnap.exists()) {
          const data = agencySnap.data();
          setName(data.name || '');
          setAvatarUrl(data.avatar || '');
        }
      }
    };
    fetchAgencyData();

    // Set tabIndex from query param on mount and when searchParams changes
    const tabParam = searchParams.get('tab');
    if (tabParam && !locationId) {
      setTabIndex(Number(tabParam));
    }
    // eslint-disable-next-line
  }, [uid, searchParams, locationId]);

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    navigate(`/agencies/${uid}?tab=${newIndex}`);
  };

  if (uid === 'new') {
    return <AddAgencyForm />;
  }

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No Agency ID provided</Typography>
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
        <Tab label="Shifts" />
        <Tab label="Timesheets" />
        {/* <Tab label="Reports & Insights" />
        <Tab label="AI Settings" />
        <Tab label="Activity Logs" /> */}
      </Tabs>

      <Box sx={{ mt: 2 }}>
        {contactId ? (
          <ContactDetails agencyId={uid} contactId={contactId} onBack={() => navigate(`/agencies/${uid}?tab=4`)} />
        ) : locationId ? (
          <LocationDetails agencyId={uid} locationId={locationId} onBack={() => navigate(`/agencies/${uid}?tab=2`)} />
        ) : (
          <>
            {tabIndex === 0 && <ProfileOverview agencyId={uid} />}
            {tabIndex === 1 && <SettingsTab agencyId={uid} />}
            {tabIndex === 2 && <LocationsTab agencyId={uid} />}
            {tabIndex === 3 && <ModulesTab agencyId={uid} />}
            {tabIndex === 4 && <ContactsTab agencyId={uid} />}
            {tabIndex === 5 && <WorkforceTab agencyId={uid} />}
            {tabIndex === 6 && <UserGroupsTab agencyId={uid} />}
            {tabIndex === 7 && <CustomersTab agencyId={uid} />}
            {tabIndex === 8 && <JobOrdersTab agencyId={uid} />}
            {tabIndex === 9 && <AgencyAssignmentsTab agencyId={uid} />}
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