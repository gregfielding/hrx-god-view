import React from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import { LoadScript } from '@react-google-maps/api'; // 🔥 Import LoadScript
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import UsersTable from './pages/UsersTable';
import UserProfile from './pages/UserProfile';
import Login from './pages/Login';
import UserOnboarding from './pages/UserOnboarding';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AgenciesTable from './pages/AgenciesTable';
import AgencyProfile from './pages/AgencyProfile';
import AddUserForm from './pages/AddUserForm';
import Customers from './pages/CustomersTable';
import CustomerProfile from './pages/CustomerProfile';
import AddCustomerForm from './pages/CustomerProfile/AddCustomerForm';
import UserGroupDetails from './pages/AgencyProfile/components/UserGroupDetails';
import JobOrderDetails from './pages/AgencyProfile/components/JobOrderDetails';
import AIContextDashboard from './pages/Admin/AIContextDashboard';
import ModulesDashboard from './pages/Admin/ModulesDashboard';

// 🔥 Read the Google Maps API key from environment variables
const googleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY!;

function UserGroupDetailsWrapper() {
  const { agencyId, groupId } = useParams();
  return <UserGroupDetails agencyId={agencyId!} groupId={groupId!} />;
}

function JobOrderDetailsWrapper() {
  const { agencyId, jobOrderId } = useParams();
  return <JobOrderDetails agencyId={agencyId!} jobOrderId={jobOrderId!} />;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <LoadScript googleMapsApiKey={googleMapsApiKey} libraries={['places']}>
          {' '}
          {/* 🔥 Wrap with LoadScript */}
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />

              <Route path="users" element={<UsersTable />} />
              <Route path="users/:uid" element={<UserProfile />} />
              <Route path="users/:uid/onboarding" element={<UserOnboarding />} />
              <Route path="user/new" element={<AddUserForm />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:uid/*" element={<CustomerProfile />} />
              <Route path="customers/:uid/locations/:locationId" element={<CustomerProfile />} />
              <Route path="customer/new" element={<AddCustomerForm />} />
              <Route path="agencies" element={<AgenciesTable />} />
              <Route path="agencies/:uid/*" element={<AgencyProfile />} />
              <Route path="agencies/:agencyId/userGroups/:groupId" element={<UserGroupDetailsWrapper />} />
              <Route path="agencies/:agencyId/jobOrders/:jobOrderId" element={<JobOrderDetailsWrapper />} />
              <Route path="admin/ai-context" element={<AIContextDashboard />} />
              <Route path="admin/modules" element={<ModulesDashboard />} />
            </Route>
          </Routes>
        </LoadScript>{' '}
        {/* 🔥 End LoadScript */}
      </AuthProvider>
    </Router>
  );
}

export default App;
