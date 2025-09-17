import React from 'react';
import { RequireRoles } from '../../guards/RequireRoles';
import { ClaimsRole } from '../../contexts/AuthContext';

interface ApplicationGuardProps {
  children: React.ReactNode;
  tenantId?: string;
  action?: 'create' | 'edit' | 'view';
}

/**
 * Guard component for Application operations
 * - Create/Edit: Requires Recruiter, Manager, or Admin role
 * - View: Requires Recruiter, Manager, or Admin role
 */
export const ApplicationGuard: React.FC<ApplicationGuardProps> = ({
  children,
  tenantId,
  action = 'view'
}) => {
  const requiredRoles = ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[];

  const fallbackMessage = 'You need Recruiter, Manager, or Admin role to access applications.';

  return (
    <RequireRoles 
      anyOf={requiredRoles}
      tenantId={tenantId}
      fallback={
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h3>Application Access Required</h3>
          <p>{fallbackMessage}</p>
        </div>
      }
    >
      {children}
    </RequireRoles>
  );
};

export default ApplicationGuard;
