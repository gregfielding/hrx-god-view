import React, { useState } from 'react';
import { Box, Typography, Paper, Tabs, Tab } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import BrandingTab from './BrandingTab';
import RequiredLicensesTab from './CompanyDefaultsTabs/RequiredLicensesTab';
import RequiredCertificationsTab from './CompanyDefaultsTabs/RequiredCertificationsTab';
import ExperienceLevelsTab from './CompanyDefaultsTabs/ExperienceLevelsTab';
import EducationLevelsTab from './CompanyDefaultsTabs/EducationLevelsTab';
import DrugScreeningPanelsTab from './CompanyDefaultsTabs/DrugScreeningPanelsTab';
import BackgroundCheckPackagesTab from './CompanyDefaultsTabs/BackgroundCheckPackagesTab';
import EVerifyTab from './CompanyDefaultsTabs/EVerifyTab';
import PhysicalRequirementsTab from './CompanyDefaultsTabs/PhysicalRequirementsTab';
import LanguagesTab from './CompanyDefaultsTabs/LanguagesTab';
import SkillsTab from './CompanyDefaultsTabs/SkillsTab';
import PPETab from './CompanyDefaultsTabs/PPETab';
import UniformRequirementsTab from './CompanyDefaultsTabs/UniformRequirementsTab';
import InjuryPoliciesTab from './CompanyDefaultsTabs/InjuryPoliciesTab';

const CompanyDefaults: React.FC = () => {
  const { tenantId } = useAuth();
  const [tabValue, setTabValue] = useState(0);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Company Defaults
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Loading tenant information...
        </Typography>
      </Box>
    );
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Company Defaults
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
          aria-label="company defaults tabs"
        >
          <Tab label="Branding" />
          <Tab label="Required Licenses" />
          <Tab label="Required Certifications" />
          <Tab label="Experience Levels" />
          <Tab label="Education Levels" />
          <Tab label="Drug Screening Panels" />
          <Tab label="Background Check Packages" />
          <Tab label="E-Verify" />
          <Tab label="Physical Requirements" />
          <Tab label="Languages" />
          <Tab label="Skills" />
          <Tab label="PPE" />
          <Tab label="Uniform Requirements" />
          <Tab label="Workers Comp Info" />
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
          <RequiredLicensesTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 2 && (
        <Box sx={{ p: 0 }}>
          <RequiredCertificationsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 3 && (
        <Box sx={{ p: 0 }}>
          <ExperienceLevelsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 4 && (
        <Box sx={{ p: 0 }}>
          <EducationLevelsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 5 && (
        <Box sx={{ p: 0 }}>
          <DrugScreeningPanelsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 6 && (
        <Box sx={{ p: 0 }}>
          <BackgroundCheckPackagesTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 7 && (
        <Box sx={{ p: 0 }}>
          <EVerifyTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 8 && (
        <Box sx={{ p: 0 }}>
          <PhysicalRequirementsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 9 && (
        <Box sx={{ p: 0 }}>
          <LanguagesTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 10 && (
        <Box sx={{ p: 0 }}>
          <SkillsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 11 && (
        <Box sx={{ p: 0 }}>
          <PPETab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 12 && (
        <Box sx={{ p: 0 }}>
          <UniformRequirementsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === 13 && (
        <Box sx={{ p: 0 }}>
          <InjuryPoliciesTab tenantId={tenantId} />
        </Box>
      )}
    </Box>
  );
};

export default CompanyDefaults;
