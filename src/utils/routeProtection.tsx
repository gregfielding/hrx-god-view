import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { RequireRoles } from '../components/RequireRoles';
import { ClaimsRole } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles: ClaimsRole[];
  tenantId?: string;
  requireAll?: boolean;
  redirectTo?: string;
}

/**
 * Route protection component that redirects unauthorized users
 * This is useful for protecting entire routes in React Router
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  roles,
  tenantId,
  requireAll = false,
  redirectTo = '/unauthorized'
}) => {
  const location = useLocation();
  const { user, loading } = useAuth();

  // Show loading while auth is being determined
  if (loading) {
    return <div>Loading...</div>;
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <RequireRoles 
      roles={roles} 
      tenantId={tenantId} 
      requireAll={requireAll}
      fallback={<Navigate to={redirectTo} state={{ from: location }} replace />}
    >
      {children}
    </RequireRoles>
  );
};

/**
 * Higher-order component for protecting routes
 * Usage: export default withRouteProtection(Component, ['Admin'])
 */
export const withRouteProtection = (
  Component: React.ComponentType<any>,
  roles: ClaimsRole[],
  options?: {
    tenantId?: string;
    requireAll?: boolean;
    redirectTo?: string;
  }
) => {
  return (props: any) => (
    <ProtectedRoute 
      roles={roles} 
      tenantId={options?.tenantId}
      requireAll={options?.requireAll}
      redirectTo={options?.redirectTo}
    >
      <Component {...props} />
    </ProtectedRoute>
  );
};

/**
 * Route configuration helper
 * This can be used to define protected routes in your routing configuration
 */
export const createProtectedRoute = (
  path: string,
  component: React.ComponentType<any>,
  roles: ClaimsRole[],
  options?: {
    tenantId?: string;
    requireAll?: boolean;
    redirectTo?: string;
  }
) => {
  const Component = component; // Create a capitalized reference
  return {
    path,
    element: (
      <ProtectedRoute 
        roles={roles} 
        tenantId={options?.tenantId}
        requireAll={options?.requireAll}
        redirectTo={options?.redirectTo}
      >
        <Component />
      </ProtectedRoute>
    )
  };
};

/**
 * Route protection utilities for common scenarios
 */
export const RouteProtection = {
  // Admin-only routes
  admin: (component: React.ComponentType<any>, tenantId?: string) =>
    withRouteProtection(component, ['Admin'], { tenantId }),

  // Recruiter-only routes
  recruiter: (component: React.ComponentType<any>, tenantId?: string) =>
    withRouteProtection(component, ['Recruiter'], { tenantId }),

  // Manager-only routes
  manager: (component: React.ComponentType<any>, tenantId?: string) =>
    withRouteProtection(component, ['Manager'], { tenantId }),

  // Recruiter OR Manager routes
  recruiterOrManager: (component: React.ComponentType<any>, tenantId?: string) =>
    withRouteProtection(component, ['Recruiter', 'Manager'], { tenantId }),

  // Admin OR Recruiter routes
  adminOrRecruiter: (component: React.ComponentType<any>, tenantId?: string) =>
    withRouteProtection(component, ['Admin', 'Recruiter'], { tenantId }),

  // Custom role requirements
  custom: (
    component: React.ComponentType<any>, 
    roles: ClaimsRole[], 
    options?: { tenantId?: string; requireAll?: boolean }
  ) => withRouteProtection(component, roles, options)
};

export default ProtectedRoute;
