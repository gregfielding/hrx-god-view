import React from 'react';
import { RequireRoles } from '../../guards/RequireRoles';
import { ClaimsRole } from '../../contexts/AuthContext';

interface JobOrderGuardProps {
  children: React.ReactNode;
  tenantId?: string;
  action?: 'create' | 'edit' | 'view';
}

/**
 * Guard component for Job Order operations
 * - Create/Edit: Requires Admin role
 * - View: Requires Recruiter, Manager, or Admin role
 */
export const JobOrderGuard: React.FC<JobOrderGuardProps> = ({
  children,
  tenantId,
  action = 'view'
}) => {
  const requiredRoles = action === 'view' 
    ? ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[]
    : ['Admin'] as ClaimsRole[];

  const fallbackMessage = action === 'view'
    ? 'You need Recruiter, Manager, or Admin role to view job orders.'
    : 'You need Admin role to create or edit job orders.';

  return (
    <RequireRoles 
      anyOf={requiredRoles}
      tenantId={tenantId}
      fallback={
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h3>Job Order Access Required</h3>
          <p>{fallbackMessage}</p>
        </div>
      }
    >
      {children}
    </RequireRoles>
  );
};

export default JobOrderGuard;
