/**
 * Staff Onboarding hub — `/staff-onboarding`
 * Operational recruiter queues: tax/payroll, E-Verify (C1 Select), background checks.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  StaffOnboardingTaxPayrollTab,
  StaffOnboardingEverifyTab,
  StaffOnboardingBackgroundTab,
} from '../components/staffOnboarding/StaffOnboardingQueueTables';

function TabPanel(props: { children?: React.ReactNode; index: number; value: number }) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} id={`staff-onboarding-tabpanel-${index}`} {...other}>
      {value === index ? (
        <Box sx={{ pt: 2, width: '100%', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{children}</Box>
      ) : null}
    </div>
  );
}

const StaffOnboardingCenter: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0);
  const { activeTenant } = useAuth();

  useEffect(() => {
    if (searchParams.get('tab') === 'background') {
      setTab(2);
    }
  }, [searchParams]);
  const tenantId = activeTenant?.id;

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: '100%',
        px: { xs: 2, sm: 3 },
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Onboarding"
        subtitle="Recruiter queues for tax and payroll milestones, C1 Select E-Verify, and background screening."
      />
      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Onboarding queues">
          <Tab label="Tax and Payroll" id="staff-onboarding-tab-0" />
          <Tab label="E-Verify" id="staff-onboarding-tab-1" />
          <Tab label="Background Checks" id="staff-onboarding-tab-2" />
        </Tabs>
      </Box>
      <TabPanel value={tab} index={0}>
        <StaffOnboardingTaxPayrollTab tenantId={tenantId} />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <StaffOnboardingEverifyTab tenantId={tenantId} />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Open orders and errors are prioritized. Package names reflect AccuSource when available.
        </Typography>
        <StaffOnboardingBackgroundTab tenantId={tenantId} />
      </TabPanel>
    </Box>
  );
};

export default StaffOnboardingCenter;
