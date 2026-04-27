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
    if (location.pathname.startsWith('/jobs/job-orders')) return 1;
    if (location.pathname.startsWith('/recruiter/users') || location.pathname.startsWith('/users')) return 2;
    if (location.pathname.startsWith('/companies')) return 3;
    if (location.pathname.startsWith('/contacts')) return 4;
    if (location.pathname.startsWith('/recruiter/user-groups')) return 5;
    if (location.pathname.startsWith('/jobs/jobs-board')) return 6;
    if (location.pathname.startsWith('/recruiter/reports')) return 7;
    return 0;
  };

  const tabValue = getActiveTab();

  const handleTabChange = (newValue: number) => {
    const paths = [
      '/recruiter',
      '/jobs/job-orders',
      '/recruiter/users',
      '/companies',
      '/contacts',
      '/recruiter/user-groups',
      '/jobs/jobs-board',
      '/recruiter/reports',
    ];
    navigate(paths[newValue]);
  };

  // Check if we're on a detail page (route has an ID parameter)
  // Exclude special routes like "/new" or "/edit" which should show the menu
  const isDetailPage = /\/recruiter\/(job-orders|users|companies|contacts|user-groups|jobs-board)\/[^/]+/.test(location.pathname) 
    && !location.pathname.endsWith('/new') 
    && !location.pathname.includes('/edit/');

  return (
    <Box sx={{ p: 0 }}>
      {/* Navigation Menu - Only show on list pages, not detail pages */}
      {!isDetailPage && (
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

          {/* All Users Tab */}
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
              All Users
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

          {/* Companies Tab */}
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
              Companies
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

          {/* Contacts Tab */}
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
            onClick={() => handleTabChange(4)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 4 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 4 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 4 ? 1 : 0
              }}
            >
              Contacts
            </Typography>
            {tabValue === 4 && (
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

          {/* User Groups Tab */}
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
            onClick={() => handleTabChange(5)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 5 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 5 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 5 ? 1 : 0
              }}
            >
              User Groups
            </Typography>
            {tabValue === 5 && (
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

          {/* Jobs Board Tab */}
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
            onClick={() => handleTabChange(6)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 6 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 6 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 6 ? 1 : 0
              }}
            >
              Jobs Board
            </Typography>
            {tabValue === 6 && (
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
            onClick={() => handleTabChange(7)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 7 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 7 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 7 ? 1 : 0
              }}
            >
              Reports
            </Typography>
            {tabValue === 7 && (
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
      )}

      {/* Tab Content - Use Outlet for nested routes */}
      <Outlet />
    </Box>
  );
};

export default RecruiterMain;

