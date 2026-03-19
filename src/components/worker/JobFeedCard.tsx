/**
 * JobFeedCard — single job card for the continuous opportunity feed.
 * Gestures: swipe left → Skip, swipe right → Save, tap → View Details.
 * Buttons below card: Skip | View Details | Save (accessibility).
 */

import React, { useRef, useState, useCallback } from 'react';
import { Box, Card, CardContent, Typography, Button, Stack } from '@mui/material';
import {
  LocationOn,
  AttachMoney,
  Schedule,
  Work,
  ChevronLeft,
  OpenInFull,
  BookmarkBorder,
  Bookmark,
} from '@mui/icons-material';
import { useT } from '../../i18n';
import { emitWorkerCardSignal } from '../../utils/workerCardSignals';
import { getCategoryForTitle } from '../../utils/dashboardCardCategory';
import { CARD_THEMES } from './dashboard/cards/types';
import type { JobCategory } from './dashboard/cards/types';

const SWIPE_THRESHOLD_PX = 80;
const SWIPE_ANIMATION_MS = 200;

export interface JobFeedCardJob {
  id: string;
  tenantId: string;
  postTitle: string;
  jobTitle?: string;
  companyName: string;
  payRate?: number;
  showPayRate?: boolean;
  worksiteAddress?: { city?: string; state?: string };
  worksiteName?: string;
  startDate?: Date | string;
  jobType?: string;
  jobOrderId?: string;
}

export interface JobFeedCardProps {
  job: JobFeedCardJob;
  onSkip: () => void;
  onSave: () => void;
  onViewDetails: () => void;
  isSaved?: boolean;
  /** Optional date/time string for display */
  dateTimeLabel?: string;
  /** Optional computed distance label (e.g., "3.2 miles away") */
  distanceLabel?: string;
}

function formatPay(pay: number | undefined): string {
  if (pay == null || Number.isNaN(pay)) return '';
  return `$${Number(pay).toFixed(2)}/hr`;
}

const JobFeedCard: React.FC<JobFeedCardProps> = ({
  job,
  onSkip,
  onSave,
  onViewDetails,
  isSaved = false,
  dateTimeLabel,
  distanceLabel,
}) => {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartX = useRef(0);

  const category = getCategoryForTitle(job.postTitle) as JobCategory;
  const theme = CARD_THEMES.job[category] || CARD_THEMES.job.default;
  const { bg, contrast } = theme;

  const locationStr =
    job.worksiteAddress?.city && job.worksiteAddress?.state
      ? `${job.worksiteAddress.city}, ${job.worksiteAddress.state}`
      : job.worksiteName || undefined;

  const commitAction = useCallback(
    (action: 'skip' | 'save' | 'view') => {
      if (action === 'skip') {
        emitWorkerCardSignal({ type: 'job_dismissed', entityId: job.id });
        onSkip();
      } else if (action === 'save') {
        emitWorkerCardSignal({ type: 'job_saved', entityId: job.id });
        onSave();
      } else {
        emitWorkerCardSignal({ type: 'job_expanded', entityId: job.id });
        onViewDetails();
      }
    },
    [job.id, onSkip, onSave, onViewDetails]
  );

  const handleSwipeEnd = useCallback(
    (direction: 'left' | 'right' | null) => {
      setDragOffset(0);
      if (direction === 'left') commitAction('skip');
      else if (direction === 'right') commitAction('save');
    },
    [commitAction]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    setDragOffset(dx);
  };

  const handleTouchEnd = () => {
    if (Math.abs(dragOffset) >= SWIPE_THRESHOLD_PX) {
      handleSwipeEnd(dragOffset < 0 ? 'left' : 'right');
    } else {
      setDragOffset(0);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    touchStartX.current = e.clientX;
    const onMouseMove = (e2: MouseEvent) => setDragOffset(e2.clientX - touchStartX.current);
    const onMouseUp = () => {
      if (Math.abs(dragOffset) >= SWIPE_THRESHOLD_PX) {
        handleSwipeEnd(dragOffset < 0 ? 'left' : 'right');
      } else setDragOffset(0);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleCardTap = () => {
    if (Math.abs(dragOffset) > 10) return;
    commitAction('view');
  };

  const payStr = job.showPayRate !== false && job.payRate != null ? formatPay(job.payRate) : null;

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Box
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        sx={{
          touchAction: 'pan-y',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Card
          variant="outlined"
          onClick={handleCardTap}
          sx={{
            width: '100%',
            minHeight: 280,
            borderRadius: 3,
            border: 'none',
            boxShadow: 3,
            backgroundColor: bg,
            color: contrast,
            transform: `translateX(${dragOffset}px)`,
            transition: 'transform 0.1s ease-out',
            '&:active': { opacity: 0.98 },
          }}
        >
          <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="overline" sx={{ color: contrast, opacity: 0.9, fontWeight: 600, fontSize: '0.7rem' }}>
              {t('dashboard.cardLabelNewJobNearYou')}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: contrast, mt: 0.5 }}>
              {job.postTitle}
            </Typography>
            {job.companyName && (
              <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
                {job.companyName}
              </Typography>
            )}
            {dateTimeLabel && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                <Schedule sx={{ fontSize: 16, color: contrast, opacity: 0.9 }} />
                <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
                  {dateTimeLabel}
                </Typography>
              </Box>
            )}
            {locationStr && (
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                <LocationOn sx={{ fontSize: 16, color: contrast, opacity: 0.9 }} />
                <Box>
                  <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
                    {locationStr}
                  </Typography>
                  {distanceLabel ? (
                    <Typography variant="caption" sx={{ color: contrast, opacity: 0.78 }}>
                      {distanceLabel}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            )}
            {payStr && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                <AttachMoney sx={{ fontSize: 18, color: contrast, fontWeight: 700 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast }}>
                  {payStr}
                </Typography>
              </Box>
            )}
            <Typography variant="caption" sx={{ color: contrast, opacity: 0.8, mt: 1, display: 'block' }}>
              {t('jobs.feed.tapForDetails')}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Action buttons for accessibility and non-touch */}
      <Stack direction="row" justifyContent="center" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          size="medium"
          startIcon={<ChevronLeft />}
          onClick={() => commitAction('skip')}
          aria-label={t('jobs.feed.swipeLeftToSkip')}
        >
          {t('jobs.feed.skip')}
        </Button>
        <Button
          variant="contained"
          size="medium"
          startIcon={<OpenInFull />}
          onClick={() => commitAction('view')}
          aria-label={t('jobs.feed.viewDetails')}
        >
          {t('jobs.feed.viewDetails')}
        </Button>
        <Button
          variant="outlined"
          size="medium"
          startIcon={isSaved ? <Bookmark /> : <BookmarkBorder />}
          onClick={() => commitAction('save')}
          color={isSaved ? 'success' : 'primary'}
          aria-label={t('jobs.feed.save')}
        >
          {t('jobs.feed.save')}
        </Button>
      </Stack>
    </Stack>
  );
};

export default JobFeedCard;
