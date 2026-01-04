import React, { useState } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  Container,
  Alert,
  Snackbar
} from '@mui/material';

import { useAuth } from '../contexts/AuthContext';
import ResumeUpload from '../components/ResumeUpload';
import ResumeHistory from '../components/ResumeHistory';

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
      id={`resume-tabpanel-${index}`}
      aria-labelledby={`resume-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `resume-tab-${index}`,
    'aria-controls': `resume-tabpanel-${index}`,
  };
}

const ResumeManagement: React.FC = () => {
  const { user } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info'
  });

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleResumeParsed = (parsedData: any) => {
    setNotification({
      open: true,
      message: 'Resume parsed successfully! Your profile has been updated.',
      severity: 'success'
    });
    
    // Switch to history tab to show the new resume
    setTabValue(1);
  };

  const handleCloseNotification = () => {
    setNotification(prev => ({ ...prev, open: false }));
  };

  if (!user) {
    return (
      <Container maxWidth="lg">
        <Alert severity="error">
          You must be logged in to access resume management.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 3 }}>
        <Typography variant="h4" gutterBottom>
          Resume Management
        </Typography>
        
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Upload your resume to automatically extract skills, education, experience, and other information to update your profile.
        </Typography>

        <Paper sx={{ width: '100%' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange} 
              aria-label="resume management tabs"
            >
              <Tab label="Upload Resume" {...a11yProps(0)} />
              <Tab label="Resume History" {...a11yProps(1)} />
            </Tabs>
          </Box>

          <TabPanel value={tabValue} index={0}>
            <ResumeUpload
              userId={user.uid}
              onResumeParsed={handleResumeParsed}
            />
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <ResumeHistory userId={user.uid} />
          </TabPanel>
        </Paper>
      </Box>

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleCloseNotification}
      >
        <Alert 
          onClose={handleCloseNotification} 
          severity={notification.severity}
          sx={{ width: '100%' }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default ResumeManagement; 