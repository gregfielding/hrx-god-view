import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const TenantWorkforce: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to the new workforce dashboard
    navigate('/workforce', { replace: true });
  }, [navigate]);

  return null; // This component will redirect immediately
};

export default TenantWorkforce;
