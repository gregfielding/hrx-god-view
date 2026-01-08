import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import RecruiterContacts from './RecruiterContacts';

/**
 * Canonical Contacts route.
 * - If CRM is enabled, route to CRM Contacts (canonical UI for sales).
 * - Else if Recruiter is enabled, render Recruiter Contacts list.
 * - Else show access denied.
 */
const ContactsPage: React.FC = () => {
  const { crmSalesEnabled, recruiterEnabled } = useAuth();

  if (crmSalesEnabled) return <Navigate to="/crm?tab=contacts" replace />;
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


