import React from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAdminShell } from '../hooks/useEffectiveSecurityLevel';

/** Worker privacy UI is not shown to internal shell users (security 5–7). */
const PrivacySettingsAdminShellGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const block = useIsAdminShell();
  if (block) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default PrivacySettingsAdminShellGate;
