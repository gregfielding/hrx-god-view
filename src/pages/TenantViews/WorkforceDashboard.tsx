import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Paper,
  useTheme,
} from '@mui/material';
import {
  People as PeopleIcon,
  Business as BusinessIcon,
  Group as GroupIcon,
  PersonAdd as PersonAddIcon,
  PendingActions as PendingIcon,
  IntegrationInstructions as IntegrationIcon,
  Work as WorkIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const WorkforceDashboard: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [flexModuleEnabled, setFlexModuleEnabled] = useState(false);
  const [staffingModuleEnabled, setStaffingModuleEnabled] = useState(false);
  const [isStaffingCompany, setIsStaffingCompany] = useState(false);

  // Real-time listener for flex module status
  useEffect(() => {
    if (!effectiveTenantId) {
      setFlexModuleEnabled(false);
      return;
    }

    const flexModuleRef = doc(db, 'tenants', effectiveTenantId, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        setFlexModuleEnabled(isEnabled);
      } else {
        setFlexModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to flex module status:', error);
      setFlexModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [effectiveTenantId]);

  // Real-time listener for staffing module status
  useEffect(() => {
    if (!effectiveTenantId) {
      setStaffingModuleEnabled(false);
      return;
    }

    const staffingModuleRef = doc(db, 'tenants', effectiveTenantId, 'modules', 'hrx-staffing');
    const unsubscribe = onSnapshot(staffingModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        setStaffingModuleEnabled(isEnabled);
      } else {
        setStaffingModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to staffing module status:', error);
      setStaffingModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [effectiveTenantId]);

  useEffect(() => {
    if (effectiveTenantId) {
      // Import the function dynamically to avoid circular dependencies
      import('../../utils/staffingCompanies').then(({ isStaffingCompany: checkIfStaffingCompany }) => {
        setIsStaffingCompany(checkIfStaffingCompany(effectiveTenantId));
      });
    }
  }, [effectiveTenantId]);

  const dashboardItems = [
    {
      title: 'Company Directory',
      description: 'View and manage all company employees',
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/company-directory',
      color: theme.palette.primary.main,
    },
    {
      title: 'User Groups',
      description: 'Organize employees into groups and teams',
      icon: <GroupIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/user-groups',
      color: theme.palette.secondary.main,
    },
    {
      title: 'Add Workers',
      description: 'Add new employees to the workforce',
      icon: <PersonAddIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/add-workers',
      color: theme.palette.success.main,
    },
    {
      title: 'Pending Invites',
      description: 'Manage pending employee invitations',
      icon: <PendingIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/pending-invites',
      color: theme.palette.warning.main,
    },
    {
      title: 'Integrations',
      description: 'Connect with external HR systems',
      icon: <IntegrationIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/integrations',
      color: theme.palette.info.main,
    },
  ];

  // Add conditional items based on module status
  if (isStaffingCompany && staffingModuleEnabled) {
    dashboardItems.splice(1, 0, {
      title: 'Hired Staff',
      description: 'Manage staff hired for client assignments',
      icon: <BusinessIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/hired-staff',
      color: theme.palette.primary.dark,
    });
  }

  if (flexModuleEnabled) {
    dashboardItems.splice(isStaffingCompany && staffingModuleEnabled ? 2 : 1, 0, {
      title: 'Flex Workers',
      description: 'Manage flexible and temporary workers',
      icon: <WorkIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/flex-workers',
      color: theme.palette.secondary.dark,
    });
  }

  const handleCardClick = (path: string) => {
    navigate(path);
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h3" gutterBottom>
          Workforce Management
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your workforce, employees, and organizational structure
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {dashboardItems.map((item, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card 
              sx={{ 
                height: '100%',
                transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: theme.shadows[8],
                }
              }}
            >
              <CardActionArea 
                onClick={() => handleCardClick(item.path)}
                sx={{ height: '100%', p: 2 }}
              >
                <CardContent sx={{ textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Box sx={{ color: item.color, mb: 2 }}>
                    {item.icon}
                  </Box>
                  <Typography variant="h6" component="h2" gutterBottom>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default WorkforceDashboard;
