import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Tabs,
  Tab,
  Paper,
  Container,
  Alert
} from '@mui/material';
import { PersonAdd as PersonAddIcon, GroupAdd as GroupAddIcon } from '@mui/icons-material';
import { RecruiterInviteForm } from '../components/RecruiterInviteForm';
import { WorkforceInviteForm } from '../components/WorkforceInviteForm';
import { InviteUserForm } from '../components/InviteUserForm';
import { useAuth } from '../contexts/AuthContext';

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
      id={`invite-tabpanel-${index}`}
      aria-labelledby={`invite-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

/**
 * Example component demonstrating the unified invite system
 * Shows how both Recruiter and Workforce flows can use the same invite mechanism
 */
export const InviteFlowExample: React.FC = () => {
  const { activeTenant } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [showRecruiterForm, setShowRecruiterForm] = useState(false);
  const [showWorkforceForm, setShowWorkforceForm] = useState(false);
  const [showGeneralForm, setShowGeneralForm] = useState(false);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleRecruiterSuccess = (result: any) => {
    console.log('Recruiter invited successfully:', result);
    setShowRecruiterForm(false);
  };

  const handleWorkforceSuccess = (result: any) => {
    console.log('Worker invited successfully:', result);
    setShowWorkforceForm(false);
  };

  const handleGeneralSuccess = (result: any) => {
    console.log('User invited successfully:', result);
    setShowGeneralForm(false);
  };

  if (!activeTenant) {
    return (
      <Container maxWidth="md">
        <Alert severity="warning">
          Please select a tenant to access the invite system.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Invite Flow Examples
        </Typography>
        
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          This example demonstrates how the unified invite system can be used by both 
          Recruiter and Workforce flows. All flows use the same underlying invite mechanism 
          but with different configurations and UI.
        </Typography>

        <Paper sx={{ mb: 4 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tabValue} onChange={handleTabChange} aria-label="invite flow tabs">
              <Tab 
                label="Recruiter Flow" 
                icon={<PersonAddIcon />} 
                iconPosition="start"
              />
              <Tab 
                label="Workforce Flow" 
                icon={<GroupAddIcon />} 
                iconPosition="start"
              />
              <Tab 
                label="General Flow" 
                icon={<PersonAddIcon />} 
                iconPosition="start"
              />
            </Tabs>
          </Box>

          <TabPanel value={tabValue} index={0}>
            <Typography variant="h6" gutterBottom>
              Recruiter Flow
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The Recruiter flow is designed for inviting team members who will work on 
              recruiting activities. It allows Admin, Recruiter, and Manager roles with 
              appropriate security levels.
            </Typography>

            {!showRecruiterForm ? (
              <Box>
                <Button
                  variant="contained"
                  startIcon={<PersonAddIcon />}
                  onClick={() => setShowRecruiterForm(true)}
                >
                  Invite Recruiter
                </Button>
              </Box>
            ) : (
              <RecruiterInviteForm
                onSuccess={handleRecruiterSuccess}
                onCancel={() => setShowRecruiterForm(false)}
              />
            )}
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <Typography variant="h6" gutterBottom>
              Workforce Flow
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The Workforce flow is designed for inviting workers and customers who will 
              be part of the workforce. It allows Worker and Customer roles with appropriate 
              security levels.
            </Typography>

            {!showWorkforceForm ? (
              <Box>
                <Button
                  variant="contained"
                  startIcon={<GroupAddIcon />}
                  onClick={() => setShowWorkforceForm(true)}
                >
                  Invite Worker
                </Button>
              </Box>
            ) : (
              <WorkforceInviteForm
                onSuccess={handleWorkforceSuccess}
                onCancel={() => setShowWorkforceForm(false)}
              />
            )}
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
            <Typography variant="h6" gutterBottom>
              General Flow
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The General flow provides full flexibility for inviting users with any role. 
              It's useful for administrative purposes or when you need to invite users 
              with specific role requirements.
            </Typography>

            {!showGeneralForm ? (
              <Box>
                <Button
                  variant="contained"
                  startIcon={<PersonAddIcon />}
                  onClick={() => setShowGeneralForm(true)}
                >
                  Invite User
                </Button>
              </Box>
            ) : (
              <InviteUserForm
                title="Invite User"
                subtitle="Send an invitation to join your team"
                defaultRole="Worker"
                allowedRoles={['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer']}
                showRoleSelector={true}
                flowType="general"
                onSuccess={handleGeneralSuccess}
                onCancel={() => setShowGeneralForm(false)}
              />
            )}
          </TabPanel>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Key Features
          </Typography>
          
          <Box component="ul" sx={{ pl: 2 }}>
            <li>
              <Typography variant="body2">
                <strong>Unified Backend:</strong> All flows use the same Cloud Function 
                and service layer
              </Typography>
            </li>
            <li>
              <Typography variant="body2">
                <strong>Flow-Specific Configuration:</strong> Each flow has appropriate 
                defaults for roles, security levels, and messaging
              </Typography>
            </li>
            <li>
              <Typography variant="body2">
                <strong>Claims-Based Authorization:</strong> User roles are set in 
                Firebase custom claims for secure, fast access control
              </Typography>
            </li>
            <li>
              <Typography variant="body2">
                <strong>Pending Invites Tracking:</strong> All invites are tracked in 
                Firestore for audit and management purposes
              </Typography>
            </li>
            <li>
              <Typography variant="body2">
                <strong>Flexible UI:</strong> Forms can be customized for different 
                use cases while maintaining the same underlying functionality
              </Typography>
            </li>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default InviteFlowExample;
