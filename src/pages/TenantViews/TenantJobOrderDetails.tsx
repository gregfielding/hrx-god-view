import React from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import JobOrderDetails from '../AgencyProfile/components/JobOrderDetails';

const TenantJobOrderDetails: React.FC = () => {
  const { jobOrderId } = useParams<{ jobOrderId: string }>();
  const { tenantId } = useAuth();
  if (!tenantId || !jobOrderId) return null;
  return <JobOrderDetails tenantId={tenantId} jobOrderId={jobOrderId} />;
};

export default TenantJobOrderDetails; 