import React from 'react';
import {
  Box,
  Typography,
} from '@mui/material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

const RecruiterMain: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine active tab based on current path
  const getActiveTab = () => {
    if (location.pathname === '/recruiter' || location.pathname === '/recruiter/') return 0;
    if (location.pathname.startsWith('/recruiter/job-orders')) return 1;
    if (location.pathname.startsWith('/recruiter/applicants')) return 2;
    if (location.pathname.startsWith('/recruiter/reports')) return 3;
    return 0;
  };

  const tabValue = getActiveTab();

  const handleTabChange = (newValue: number) => {
    const paths = ['/recruiter', '/recruiter/job-orders', '/recruiter/applicants', '/recruiter/reports'];
    navigate(paths[newValue]);
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Navigation Menu */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ 
          display: 'flex', 
          gap: { xs: 2, sm: 3.5, md: 4 },
          flexWrap: 'nowrap',
          overflowX: 'auto',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: '#F1F3F5',
          py: 1.5,
          scrollBehavior: 'smooth'
        }}>
          {/* Dashboard Tab */}
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange(0)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 0 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 0 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 0 ? 1 : 0
              }}
            >
              Dashboard
            </Typography>
            {tabValue === 0 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>

          {/* Job Orders Tab */}
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange(1)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 1 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 1 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 1 ? 1 : 0
              }}
            >
              Job Orders
            </Typography>
            {tabValue === 1 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>

          {/* Applicants Tab */}
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange(2)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 2 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 2 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 2 ? 1 : 0
              }}
            >
              Applicants
            </Typography>
            {tabValue === 2 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>

          {/* Reports Tab */}
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange(3)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 3 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 3 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 3 ? 1 : 0
              }}
            >
              Reports
            </Typography>
            {tabValue === 3 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
        </Box>
      </Box>

      {/* Tab Content - Use Outlet for nested routes */}
      <Outlet />
    </Box>
  );
};

export default RecruiterMain;

