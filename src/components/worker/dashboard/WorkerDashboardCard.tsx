/**
 * Single smart card for Worker Dashboard — colored background, title, company, date, location, pay, primary action.
 * Supports swipe-down to expand (navigate to detail).
 */

import React, { useRef, useCallback, useState } from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n';
import { formatHourlyPayRateForDisplay } from '../../../utils/hourlyPayDisplay';

export type DashboardCardCategory = 'hospitality' | 'warehouse' | 'events' | 'cleaning' | 'default';

const CATEGORY_COLORS: Record<DashboardCardCategory, { bg: string; contrast: string }> = {
  hospitality: { bg: '#F5E6C8', contrast: '#5D4E37' },
  warehouse: { bg: '#C8DAF5', contrast: '#2C3E5C' },
  events: { bg: '#E0D4F5', contrast: '#3D2E5C' },
  cleaning: { bg: '#C8F5D8', contrast: '#2E5C3D' },
  default: { bg: '#E8E8E8', contrast: '#333' },
};

export interface WorkerDashboardCardItem {
  id: string;
  type: 'job' | 'application' | 'nextShift' | 'profile';
  title: string;
  company?: string;
  dateTime?: string;
  location?: string;
  payRate?: number;
  /** Primary action: label and route (or undefined to hide) */
  primaryAction?: { label: string; to: string };
  category?: DashboardCardCategory;
}

export interface WorkerDashboardCardProps {
  item: WorkerDashboardCardItem;
  onSwipeDown?: (item: WorkerDashboardCardItem) => void;
}

const WorkerDashboardCard: React.FC<WorkerDashboardCardProps> = ({ item, onSwipeDown }) => {
  const navigate = useNavigate();
  const t = useT();
  const touchStartY = useRef<number>(0);
  const [touchActive, setTouchActive] = useState(false);

  const category = item.category ?? 'default';
  const { bg, contrast } = CATEGORY_COLORS[category];
  const payStr = formatHourlyPayRateForDisplay(item.payRate) ?? '';

  const handlePrimary = useCallback(() => {
    if (item.primaryAction?.to) {
      navigate(item.primaryAction.to);
    }
  }, [item.primaryAction, navigate]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      setTouchActive(true);
    },
    []
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchActive || !onSwipeDown || !item.primaryAction?.to) {
        setTouchActive(false);
        return;
      }
      const endY = e.changedTouches[0].clientY;
      const deltaY = endY - touchStartY.current;
      if (deltaY > 60) {
        onSwipeDown(item);
      }
      setTouchActive(false);
    },
    [touchActive, onSwipeDown, item]
  );

  return (
    <Card
      variant="outlined"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      sx={{
        flexShrink: 0,
        width: '100%',
        minHeight: 220,
        borderRadius: 3,
        border: 'none',
        boxShadow: 2,
        backgroundColor: bg,
        color: contrast,
        scrollSnapAlign: 'center',
        scrollSnapStop: 'always',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack spacing={1.25} sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast }}>
            {item.title}
          </Typography>
          {item.company && (
            <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
              {item.company}
            </Typography>
          )}
          {item.dateTime && (
            <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
              {item.dateTime}
            </Typography>
          )}
          {item.location && (
            <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
              {item.location}
            </Typography>
          )}
          {payStr && (
            <Typography variant="body1" sx={{ fontWeight: 600, color: contrast }}>
              {payStr}
            </Typography>
          )}
        </Stack>
        {item.primaryAction && (
          <Button
            variant="contained"
            fullWidth
            onClick={handlePrimary}
            sx={{
              mt: 2,
              bgcolor: contrast,
              color: bg,
              '&:hover': { bgcolor: contrast, opacity: 0.9 },
            }}
          >
            {item.primaryAction.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkerDashboardCard;
export { CATEGORY_COLORS };
