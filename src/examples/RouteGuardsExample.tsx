import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { RequireRoles, useRoleGuards } from '../guards/RequireRoles';
import { RecruiterAreaGuard } from '../components/guards/RecruiterAreaGuard';
import { JobOrderGuard } from '../components/guards/JobOrderGuard';
import { ApplicationGuard } from '../components/guards/ApplicationGuard';
import { useAuth } from '../contexts/AuthContext';

// Example components for different protected routes
const RecruiterDashboard: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Recruiter Dashboard</Typography>
    <Typography>This is the main recruiter area with access to job orders and applications.</Typography>
  </Container>
);

const JobOrdersList: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Job Orders</Typography>
    <Typography>List of all job orders. View access for Recruiters, create/edit for Admins only.</Typography>
  </Container>
);

const CreateJobOrder: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Create Job Order</Typography>
    <Typography>Create a new job order. Admin access required.</Typography>
  </Container>
);

const ApplicationsList: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Applications</Typography>
    <Typography>List of all applications. Recruiter, Manager, or Admin access required.</Typography>
  </Container>
);

const CreateApplication: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Create Application</Typography>
    <Typography>Create a new application. Recruiter, Manager, or Admin access required.</Typography>
  </Container>
);

const AdminSettings: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Admin Settings</Typography>
    <Typography>Admin-only settings and configuration.</Typography>
  </Container>
);

const PublicPage: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Public Page</Typography>
    <Typography>This page is accessible to all authenticated users.</Typography>
  </Container>
);

// Navigation component with role-based menu visibility
const Navigation: React.FC = () => {
  const { user, currentClaimsRole, isHRX } = useAuth();
  const { 
    canAccessRecruiterArea, 
    canCreateEditJobOrders, 
    canWriteApplications,
    canAccessSettings 
  } = useRoleGuards();

  if (!user) {
    return null;
  }

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Route Guards Example
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" component={Link} to="/public">
            Public
          </Button>
          
          {/* Recruiter area - only show if user has access */}
          {canAccessRecruiterArea && (
            <Button color="inherit" component={Link} to="/recruiter">
              Recruiter
            </Button>
          )}
          
          {/* Job Orders - only show if user has access */}
          {canAccessRecruiterArea && (
            <Button color="inherit" component={Link} to="/job-orders">
              Job Orders
            </Button>
          )}
          
          {/* Create Job Order - only show if user has admin access */}
          {canCreateEditJobOrders && (
            <Button color="inherit" component={Link} to="/job-orders/create">
              Create Job Order
            </Button>
          )}
          
          {/* Applications - only show if user has access */}
          {canWriteApplications && (
            <Button color="inherit" component={Link} to="/applications">
              Applications
            </Button>
          )}
          
          {/* Create Application - only show if user has access */}
          {canWriteApplications && (
            <Button color="inherit" component={Link} to="/applications/create">
              Create Application
            </Button>
          )}
          
          {/* Admin Settings - only show if user has admin access */}
          {canAccessSettings && (
            <Button color="inherit" component={Link} to="/admin/settings">
              Admin Settings
            </Button>
          )}
        </Box>
        <Box sx={{ ml: 2 }}>
          <Typography variant="body2">
            Role: {currentClaimsRole || 'None'} {isHRX && '(HRX)'}
          </Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

// Main example component
export const RouteGuardsExample: React.FC = () => {
  return (
    <BrowserRouter>
      <Box sx={{ flexGrow: 1 }}>
        <Navigation />
        
        <Routes>
          {/* Public route - accessible to all authenticated users */}
          <Route path="/public" element={<PublicPage />} />
          
          {/* Recruiter area - protected by RecruiterAreaGuard */}
          <Route 
            path="/recruiter" 
            element={
              <RecruiterAreaGuard>
                <RecruiterDashboard />
              </RecruiterAreaGuard>
            } 
          />
          
          {/* Job Orders - view access */}
          <Route 
            path="/job-orders" 
            element={
              <JobOrderGuard action="view">
                <JobOrdersList />
              </JobOrderGuard>
            } 
          />
          
          {/* Create Job Order - admin access required */}
          <Route 
            path="/job-orders/create" 
            element={
              <JobOrderGuard action="create">
                <CreateJobOrder />
              </JobOrderGuard>
            } 
          />
          
          {/* Applications - view access */}
          <Route 
            path="/applications" 
            element={
              <ApplicationGuard action="view">
                <ApplicationsList />
              </ApplicationGuard>
            } 
          />
          
          {/* Create Application - write access required */}
          <Route 
            path="/applications/create" 
            element={
              <ApplicationGuard action="create">
                <CreateApplication />
              </ApplicationGuard>
            } 
          />
          
          {/* Admin Settings - admin only */}
          <Route 
            path="/admin/settings" 
            element={
              <RequireRoles anyOf={['Admin']}>
                <AdminSettings />
              </RequireRoles>
            } 
          />
          
          {/* Default redirect to public page */}
          <Route path="/" element={<Navigate to="/public" replace />} />
          
          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/public" replace />} />
        </Routes>
      </Box>
    </BrowserRouter>
  );
};

export default RouteGuardsExample;
