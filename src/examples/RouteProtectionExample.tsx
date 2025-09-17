import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { ProtectedRoute, RouteProtection } from '../utils/routeProtection';
import { useAuth } from '../contexts/AuthContext';

// Example components for different protected routes
const AdminDashboard: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Admin Dashboard</Typography>
    <Typography>This is only visible to Admin users.</Typography>
  </Container>
);

const RecruiterDashboard: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Recruiter Dashboard</Typography>
    <Typography>This is only visible to Recruiter users.</Typography>
  </Container>
);

const ManagerDashboard: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Manager Dashboard</Typography>
    <Typography>This is only visible to Manager users.</Typography>
  </Container>
);

const RecruiterOrManagerDashboard: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Recruiter or Manager Dashboard</Typography>
    <Typography>This is visible to users with either Recruiter OR Manager role.</Typography>
  </Container>
);

const PublicPage: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Public Page</Typography>
    <Typography>This page is accessible to all authenticated users.</Typography>
  </Container>
);

const UnauthorizedPage: React.FC = () => (
  <Container>
    <Typography variant="h4" gutterBottom>Unauthorized</Typography>
    <Typography>You don't have permission to access the requested page.</Typography>
  </Container>
);

// Navigation component
const Navigation: React.FC = () => {
  const { user, currentClaimsRole, isHRX } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Route Protection Example
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" component={Link} to="/public">
            Public
          </Button>
          <Button color="inherit" component={Link} to="/admin">
            Admin
          </Button>
          <Button color="inherit" component={Link} to="/recruiter">
            Recruiter
          </Button>
          <Button color="inherit" component={Link} to="/manager">
            Manager
          </Button>
          <Button color="inherit" component={Link} to="/recruiter-or-manager">
            Recruiter/Manager
          </Button>
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
export const RouteProtectionExample: React.FC = () => {
  return (
    <BrowserRouter>
      <Box sx={{ flexGrow: 1 }}>
        <Navigation />
        
        <Routes>
          {/* Public route - accessible to all authenticated users */}
          <Route path="/public" element={<PublicPage />} />
          
          {/* Admin-only route using ProtectedRoute component */}
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute roles={['Admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Recruiter-only route */}
          <Route 
            path="/recruiter" 
            element={
              <ProtectedRoute roles={['Recruiter']}>
                <RecruiterDashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Manager-only route */}
          <Route 
            path="/manager" 
            element={
              <ProtectedRoute roles={['Manager']}>
                <ManagerDashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Recruiter OR Manager route */}
          <Route 
            path="/recruiter-or-manager" 
            element={
              <ProtectedRoute roles={['Recruiter', 'Manager']}>
                <RecruiterOrManagerDashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Unauthorized page */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          
          {/* Default redirect to public page */}
          <Route path="/" element={<Navigate to="/public" replace />} />
          
          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/public" replace />} />
        </Routes>
      </Box>
    </BrowserRouter>
  );
};

// Example of using HOC approach
export const AdminDashboardHOC = RouteProtection.admin(AdminDashboard);
export const RecruiterDashboardHOC = RouteProtection.recruiter(RecruiterDashboard);
export const ManagerDashboardHOC = RouteProtection.manager(ManagerDashboard);
export const RecruiterOrManagerDashboardHOC = RouteProtection.recruiterOrManager(RecruiterOrManagerDashboard);

// Example of custom role requirements
export const CustomRoleDashboard = RouteProtection.custom(
  () => <div>Custom Role Dashboard</div>,
  ['Admin', 'Recruiter'],
  { requireAll: true } // User must have BOTH Admin AND Recruiter roles
);

export default RouteProtectionExample;
