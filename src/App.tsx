import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LoadScript } from '@react-google-maps/api'; // 🔥 Import LoadScript
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import UsersTable from './pages/UsersTable';
import UserProfile from './pages/UserProfile';
import Login from './pages/Login';
import UserOnboarding from './pages/UserOnboarding';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// 🔥 Read the Google Maps API key from environment variables
const googleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY!;

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
        </LoadScript>{' '}
        {/* 🔥 End LoadScript */}
      </AuthProvider>
    </Router>
  );
}

export default App;
