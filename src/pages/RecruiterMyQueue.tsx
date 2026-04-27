/**
 * `/jobs/my-queue` — DEPRECATED redirect to the Phase D Workforce surface.
 *
 * @deprecated 2026-04-25. Replaced by `/workforce/employee-readiness`. The
 * data layer (`useEmployeeReadinessItems`, `QueueRow`, `StatusChip`,
 * `normalizeEmployeeItem`, etc.) is now extracted into `src/utils/readinessQueue/`
 * and `src/components/readiness/` so the legacy view's behavior is fully
 * preserved at the new location — there is no functionality that lived only
 * in this file at the moment of the promote.
 *
 * This file is kept (rather than deleted) for one release cycle as a safety
 * net for any code that imports `RecruiterMyQueue` directly. After ~1 week
 * of redirect traffic with no hits via Sentry/console error breadcrumbs,
 * this file can be deleted in a follow-up PR.
 *
 * @see ../pages/Workforce.tsx
 * @see ../pages/WorkforceEmployeeReadiness.tsx
 * @see ../hooks/useEmployeeReadinessItems.ts
 */

import React from 'react';
import { Navigate } from 'react-router-dom';

const RecruiterMyQueue: React.FC = () => {
  return <Navigate to="/workforce/employee-readiness" replace />;
};

export default RecruiterMyQueue;
