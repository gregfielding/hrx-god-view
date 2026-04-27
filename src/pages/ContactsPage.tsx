import React from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import RecruiterContacts from './RecruiterContacts';

/**
 * Canonical Contacts route.
 * - Renders Recruiter Contacts list (standalone contacts view).
 * - Else show access denied.
 */
const ContactsPage: React.FC = () => {
  const { recruiterEnabled } = useAuth();

  if (recruiterEnabled) return <RecruiterContacts />;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Access Denied
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You don't have permission to access Contacts.
      </Typography>
    </Box>
  );
};

export default ContactsPage;


