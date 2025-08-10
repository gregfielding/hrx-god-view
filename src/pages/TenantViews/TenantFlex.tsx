import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
} from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

import TenantJobOrdersTab from './TenantJobOrdersTab';
import TenantAssignments from './TenantAssignments';
import FlexSettings from './FlexSettings';
import FlexDefaults from './FlexDefaults';
import FlexPositions from './FlexPositions';
import JobOrderDetails from './JobOrderDetails';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`flex-tabpanel-${index}`}
      aria-labelledby={`flex-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 0 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `flex-tab-${index}`,
    'aria-controls': `flex-tabpanel-${index}`,
  };
}

const TenantFlex: React.FC = () => {
  const { tenantId, accessRole, orgType } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [timesheetsEnabled, setTimesheetsEnabled] = useState(false);
  const [selectedJobOrderId, setSelectedJobOrderId] = useState<string | null>(null);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Real-time listener for flex module timesheets setting
  useEffect(() => {
    if (!tenantId) {
      setTimesheetsEnabled(false);
      return;
    }
    
    const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setTimesheetsEnabled(data?.settings?.enableTimesheets || false);
      } else {
        setTimesheetsEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to flex module timesheets setting:', error);
      setTimesheetsEnabled(false);
    });
    
    return () => unsubscribe();
  }, [tenantId]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          No tenant selected. Please select a tenant to continue.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, mt: 0 }}>
        <Typography variant="h4">Flex Management</Typography>
      </Box>

      {/* Tabs */}
      <Paper elevation={1} sx={{ mb: 3 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="flex management tabs"
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
            },
          }}
        >
          <Tab label="Job Orders" {...a11yProps(0)} />
          <Tab label="Assignments" {...a11yProps(1)} />
          {timesheetsEnabled && <Tab label="Timesheets" {...a11yProps(2)} />}
          <Tab label="Positions" {...a11yProps(timesheetsEnabled ? 3 : 2)} />
          <Tab label="Defaults" {...a11yProps(timesheetsEnabled ? 4 : 3)} />
          <Tab label="Settings" {...a11yProps(timesheetsEnabled ? 5 : 4)} />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <TabPanel value={tabValue} index={0}>
          {selectedJobOrderId ? (
            <JobOrderDetails 
              tenantId={tenantId!} 
              jobOrderId={selectedJobOrderId}
              onBack={() => setSelectedJobOrderId(null)}
            />
          ) : (
            <TenantJobOrdersTab onViewJobOrder={setSelectedJobOrderId} />
          )}
        </TabPanel>
        
        <TabPanel value={tabValue} index={1}>
          <TenantAssignments />
        </TabPanel>
        
        {timesheetsEnabled && (
          <TabPanel value={tabValue} index={2}>
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Timesheets
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Timesheet management functionality coming soon.
              </Typography>
            </Box>
          </TabPanel>
        )}
        
        <TabPanel value={tabValue} index={timesheetsEnabled ? 3 : 2}>
          <FlexPositions />
        </TabPanel>
        
        <TabPanel value={tabValue} index={timesheetsEnabled ? 4 : 3}>
          <FlexDefaults />
        </TabPanel>
        
        <TabPanel value={tabValue} index={timesheetsEnabled ? 5 : 4}>
          <FlexSettings />
        </TabPanel>
      </Box>
    </Box>
  );
};

export default TenantFlex; 