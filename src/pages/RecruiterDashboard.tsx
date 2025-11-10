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
  Work as WorkIcon,
  People as PeopleIcon,
  Timeline as TimelineIcon,
  Group as GroupIcon,
  Badge as BadgeIcon,
  Assignment as AssignmentIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';

const RecruiterDashboard: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  const dashboardItems = [
    {
      title: 'Job Orders',
      description: 'Manage and track job orders and requirements',
      icon: <WorkIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/job-orders',
      color: theme.palette.primary.main,
    },
    {
      title: 'Applicants',
      description: 'View and manage candidate applications',
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/applicants',
      color: theme.palette.secondary.main,
    },
    {
      title: 'All Users',
      description: 'Search and filter every worker, candidate, and admin',
      icon: <BadgeIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/users',
      color: theme.palette.info.main,
    },
    {
      title: 'User Groups',
      description: 'Organize staff cohorts and teams',
      icon: <GroupIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/user-groups',
      color: theme.palette.info.main,
    },
    {
      title: 'Jobs Board',
      description: 'Manage and publish job postings',
      icon: <AssignmentIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/jobs-board',
      color: theme.palette.primary.main,
    },
    {
      title: 'Pipeline',
      description: 'Track candidates through the recruitment pipeline',
      icon: <TimelineIcon sx={{ fontSize: 40 }} />,
      path: '/recruiter/pipeline',
      color: theme.palette.success.main,
    },
  ];

  const handleCardClick = (path: string) => {
    navigate(path);
  };

  const breadcrumbItems = [
    {
      label: 'Recruiter',
      href: '/recruiter'
    }
  ];

  return (
    <Box sx={{ p: 0 }}>
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

export default RecruiterDashboard;
