import React, { useState } from 'react';
import { Box, Typography, Paper, Tabs, Tab } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import LocationsTab from '../AgencyProfile/components/LocationsTab';
import DivisionsTab from '../AgencyProfile/components/DivisionsTab';
import RegionsTab from '../AgencyProfile/components/RegionsTab';
import DivisionTypesTab from '../AgencyProfile/components/DivisionTypesTab';
import DepartmentsTab from '../AgencyProfile/components/DepartmentsTab';

import OrgChartTab from './OrgChartTab';
import BrandingTab from './BrandingTab';
import CompanyDefaultsTab from './CompanyDefaultsTab';

const TenantSettings: React.FC = () => {
  const { tenantId } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  if (!tenantId) return null;

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Company Setup
        </Typography>
      </Box>
      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="settings tabs"
        >
          <Tab label="Branding" />
          <Tab label="Regions" />
          <Tab label="Division Types" />
          <Tab label="Divisions" />
          <Tab label="Departments" />
          <Tab label="Locations" />
          {/* <Tab label="Org Chart" /> */}
          {/* <Tab label="Defaults" /> */}
          {/* <Tab label="Company Defaults" /> */}
        </Tabs>
      </Paper>
      {/* Tab Panels */}
      {tabValue === 0 && (
        <Box sx={{ p: 0 }}>
          <BrandingTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 1 && (
        <Box sx={{ p: 0 }}>
          <RegionsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 2 && (
        <Box sx={{ p: 0 }}>
          <DivisionTypesTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 3 && (
        <Box sx={{ p: 0 }}>
          <DivisionsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 4 && (
        <Box sx={{ p: 0 }}>
          <DepartmentsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 5 && (
        <Box sx={{ p: 0 }}>
          <LocationsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 6 && (
        <Box sx={{ p: 0 }}>
          <OrgChartTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 7 && (
        <Box sx={{ p: 0 }}>
          <CompanyDefaultsTab tenantId={tenantId} />
        </Box>
      )}
      {/* {tabValue === 7 && (
        <Box sx={{ p: 0 }}>
          <Typography variant="h6">Defaults</Typography>
          <Typography variant="body2" color="text.secondary">(Coming soon: Set your default preferences here.)</Typography>
        </Box>
      )}
      {tabValue === 7 && (
        <Box sx={{ p: 0 }}>
          <Typography variant="h6">Defaults</Typography>
          <Typography variant="body2" color="text.secondary">(Coming soon: Set your default preferences here.)</Typography>
        </Box>
      )} */}
    </Box>
  );
};

export default TenantSettings; 