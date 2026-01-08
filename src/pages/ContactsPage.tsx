import React from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { CRMCacheProvider } from '../contexts/CRMCacheContext';
import RecruiterContacts from './RecruiterContacts';
import TenantCRM from './TenantViews/TenantCRM';

/**
 * Canonical Contacts route.
 * - If CRM is enabled, route to CRM Contacts (canonical UI for sales).
 * - Else if Recruiter is enabled, render Recruiter Contacts list.
 * - Else show access denied.
 */
const ContactsPage: React.FC = () => {
  const { crmSalesEnabled, recruiterEnabled } = useAuth();

  // Standalone master table view
  if (crmSalesEnabled) {
    return (
      <CRMCacheProvider>
        <TenantCRM standaloneTab="contacts" />
      </CRMCacheProvider>
    );
  }
  if (recruiterEnabled) return <RecruiterContacts />;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Access Denied
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You don’t have permission to access Contacts.
      </Typography>
    </Box>
  );
};

export default ContactsPage;


