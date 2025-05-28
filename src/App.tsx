import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import UsersTable from './pages/UsersTable';
import UserProfile from './pages/UserProfile';
import Login from './pages/Login';
import UserOnboarding from './pages/UserOnboarding';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute requiredRole="god">
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="users" element={<UsersTable />} />
            <Route path="users/:uid" element={<UserProfile />} />
            <Route path="users/:uid/onboarding" element={<UserOnboarding />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
