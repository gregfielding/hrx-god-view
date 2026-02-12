import React from 'react';
import { Navigate } from 'react-router-dom';

const C1WorkersIndex: React.FC = () => {
  return <Navigate to="/c1/workers/dashboard" replace />;
};

export default C1WorkersIndex;
