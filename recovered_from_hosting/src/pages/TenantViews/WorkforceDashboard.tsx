import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  useTheme,
} from '@mui/material';
import {
  People as PeopleIcon,
  PersonAdd as PersonAddIcon,
  PendingActions as PendingIcon,
  IntegrationInstructions as IntegrationIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const WorkforceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  const dashboardItems = [
    {
      title: 'Company Directory',
      description: 'View and manage all company employees',
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      path: '/workforce/company-directory',
      color: theme.palette.primary.main,
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
