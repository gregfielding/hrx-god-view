import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import RecruiterCompanies from './RecruiterCompanies';

/**
 * Canonical Companies route.
 * - If CRM is enabled, route to CRM Companies (canonical UI for sales).
 * - Else if Recruiter is enabled, render Recruiter Companies list.
 * - Else show access denied.
 */
const CompaniesPage: React.FC = () => {
  const { crmSalesEnabled, recruiterEnabled } = useAuth();

  if (crmSalesEnabled) return <Navigate to="/crm?tab=companies" replace />;
  if (recruiterEnabled) return <RecruiterCompanies />;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Access Denied
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You don’t have permission to access Companies.
      </Typography>
    </Box>
  );
};

export default CompaniesPage;


