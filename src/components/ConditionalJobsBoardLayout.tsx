import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Outlet } from 'react-router-dom';
import Layout from './Layout';

/**
 * Conditional layout wrapper for public jobs board
 * - If user is logged in: render with sidebar via Layout
 * - If user is not logged in: render without sidebar
 */
const ConditionalJobsBoardLayout: React.FC = () => {
  const { user } = useAuth();

  // If user is logged in, wrap in Layout to show sidebar
  if (user) {
    return <Layout />;
  }

  // If not logged in, just render the outlet (PublicJobsBoard) without Layout
  return <Outlet />;
};

export default ConditionalJobsBoardLayout;

