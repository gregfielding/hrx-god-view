/**
 * /login front door — phone-first (Greg 2026-08-25).
 *
 * Renders the phone OTP screen by default (workers are ~all logins). A browser
 * whose LAST successful sign-in was email/password (staff, admins) is redirected
 * to /login/email instead, forwarding router state so deep-link redirects
 * (state.from) and post-password-setup messages survive. /login/phone remains a
 * direct alias that never redirects.
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import PhoneLoginPage from './PhoneLoginPage';
import { getLastLoginMethod } from '../utils/lastLoginMethod';

const LoginGate: React.FC = () => {
  const location = useLocation();
  if (getLastLoginMethod() === 'email') {
    return <Navigate to="/login/email" replace state={location.state} />;
  }
  return <PhoneLoginPage />;
};

export default LoginGate;
