import React from 'react';
import { RequireRoles } from '../../guards/RequireRoles';

interface RecruiterAreaGuardProps {
  children: React.ReactNode;
  tenantId?: string;
}

/**
 * Guard component for the Recruiter area
 * Requires Recruiter, Manager, or Admin role
 */
export const RecruiterAreaGuard: React.FC<RecruiterAreaGuardProps> = ({
  children,
  tenantId
}) => {
  return (
    <RequireRoles 
      anyOf={['Recruiter', 'Manager', 'Admin']}
      tenantId={tenantId}
      fallback={
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h3>Recruiter Area Access Required</h3>
          <p>You need Recruiter, Manager, or Admin role to access this area.</p>
        </div>
      }
    >
      {children}
    </RequireRoles>
  );
};

export default RecruiterAreaGuard;
