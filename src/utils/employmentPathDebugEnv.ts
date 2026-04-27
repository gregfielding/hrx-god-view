/**
 * CRA: set `REACT_APP_EMPLOYMENT_ONBOARDING_PATH_DEBUG=true` in `.env`.
 * Enables extra onboarding path diagnostics in admin + worker UIs.
 */
export function isEmploymentOnboardingPathDebugEnvEnabled(): boolean {
  try {
    return process.env.REACT_APP_EMPLOYMENT_ONBOARDING_PATH_DEBUG === 'true';
  } catch {
    return false;
  }
}
