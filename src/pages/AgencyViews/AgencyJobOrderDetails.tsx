import React from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import JobOrderDetails from '../TenantViews/JobOrderDetails';

const AgencyJobOrderDetails: React.FC = () => {
  const { jobOrderId } = useParams<{ jobOrderId: string }>();
  const { tenantId } = useAuth();
  
  if (!jobOrderId || !tenantId) return null;
  
  return <JobOrderDetails tenantId={tenantId} jobOrderId={jobOrderId} />;
};

export default AgencyJobOrderDetails; 