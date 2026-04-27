/**
 * Worker Dashboard Alerts — conditional "must do" items.
 * Spec: HRX Worker Dashboard Layout Spec — Section 2
 */

import React from 'react';
import { Stack, Alert, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export interface DashboardAlert {
  severity: 'warning' | 'info' | 'success';
  message: string;
  ctaLabel: string;
  ctaTo: string;
}

export interface WorkerDashboardAlertsProps {
  alerts: DashboardAlert[];
}

const WorkerDashboardAlerts: React.FC<WorkerDashboardAlertsProps> = ({ alerts }) => {
  const navigate = useNavigate();
  if (alerts.length === 0) return null;
  return (
    <Stack spacing={1}>
      {alerts.map((a, i) => (
        <Alert
          key={i}
          severity={a.severity}
          variant="outlined"
          action={
            <Button color="inherit" size="small" onClick={() => navigate(a.ctaTo)}>
              {a.ctaLabel}
            </Button>
          }
        >
          {a.message}
        </Alert>
      ))}
    </Stack>
  );
};

export default WorkerDashboardAlerts;
