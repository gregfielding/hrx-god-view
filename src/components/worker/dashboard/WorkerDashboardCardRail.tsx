/**
 * Worker Dashboard Card Rail — mobile swipe / web arrows.
 * Vertical scroll moves between sections; horizontal swipe (mobile) or prev/next (web) within section.
 * Card dimensions: 70vw width (30% peek), 240–280px height, 16px radius, 20px padding.
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Box, Stack, Typography, IconButton } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { AssignmentCard, ApplicationCard, ProfileCompletionCard, JobReadinessCard, JobRecommendationCard, GatewayCard } from './cards';
import type { DashboardCardPayload } from './cards';
import { useT } from '../../../i18n';
import { emitWorkerCardSignal } from '../../../utils/workerCardSignals';

export interface WorkerDashboardCardRailProps {
  cards: DashboardCardPayload[];
  /** Optional section header above the cards (e.g. "3 jobs match your experience and schedule") */
  sectionHeader?: string;
  /** Show prev/next arrow buttons (web). When false, only swipe + dots (mobile). */
  showNavArrows?: boolean;
}

function getPrimaryRoute(payload: DashboardCardPayload): string | undefined {
  switch (payload.type) {
    case 'assignment':
      return payload.viewAssignmentTo;
    case 'application':
      return payload.viewJobTo;
    case 'profile':
      return payload.continueProfileTo;
    case 'job_readiness':
      return payload.fixNowTo;
    case 'job':
      return payload.viewJobTo;
    case 'gateway':
      return payload.seeJobsTo;
    default:
      return undefined;
  }
}

const CARD_WIDTH_VW = 70;
const CARD_GAP_PX = 12;
const SWIPE_THRESHOLD_PX = 60;

const WorkerDashboardCardRail: React.FC<WorkerDashboardCardRailProps> = ({
  cards,
  sectionHeader,
  showNavArrows = false,
}) => {
  const navigate = useNavigate();
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || cards.length === 0) return;
    const cardWidth = el.offsetWidth * (CARD_WIDTH_VW / 100) + CARD_GAP_PX;
    const scrollLeft = el.scrollLeft;
    const index = Math.round(scrollLeft / cardWidth);
    setActiveIndex(Math.min(Math.max(0, index), cards.length - 1));
  }, [cards.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateActiveIndex);
    return () => el.removeEventListener('scroll', updateActiveIndex);
  }, [updateActiveIndex]);

  const goToIndex = useCallback((i: number) => {
    setActiveIndex(i);
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.offsetWidth * (CARD_WIDTH_VW / 100) + CARD_GAP_PX;
    el.scrollTo({ left: i * cardWidth, behavior: 'smooth' });
  }, []);

  const handleTap = useCallback(
    (payload: DashboardCardPayload) => {
      const to = getPrimaryRoute(payload);
      if (to) {
        if (payload.type === 'job') emitWorkerCardSignal({ type: 'job_expanded', entityId: payload.id.replace('job-', '') });
        navigate(to);
      }
    },
    [navigate]
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - touchStartX.current;
      const deltaY = endY - touchStartY.current;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return; // vertical swipe, ignore for card dismiss
      const payload = cards[activeIndex];
      if (payload?.type === 'job') {
        if (deltaX < 0) {
          emitWorkerCardSignal({ type: 'job_dismissed', entityId: payload.id.replace('job-', '') });
          if (activeIndex < cards.length - 1) goToIndex(activeIndex + 1);
        } else {
          emitWorkerCardSignal({ type: 'job_saved', entityId: payload.id.replace('job-', '') });
        }
      } else if (deltaX < 0 && activeIndex < cards.length - 1) {
        goToIndex(activeIndex + 1);
      }
    },
    [activeIndex, cards, goToIndex]
  );

  if (cards.length === 0) {
    return null;
  }

  return (
    <Stack spacing={2}>
      {sectionHeader && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', px: 0.5 }}>
          {sectionHeader}
        </Typography>
      )}
      <Stack direction="row" alignItems="stretch" spacing={0} sx={{ alignItems: 'center' }}>
        {showNavArrows && cards.length > 1 && (
          <IconButton
            size="small"
            onClick={() => goToIndex(Math.max(0, activeIndex - 1))}
            disabled={activeIndex <= 0}
            sx={{ flexShrink: 0 }}
            aria-label={t('cardDeck.previous')}
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <Box
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
            gap: `${CARD_GAP_PX}px`,
            px: showNavArrows ? 1 : '5vw',
            py: 1,
            mx: showNavArrows ? 0 : -1,
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.selected' },
          }}
        >
          {cards.map((payload, i) => (
            <Box
              key={payload.id}
              ref={(el) => { cardRefs.current[i] = el as HTMLElement | null; }}
              sx={{
                flex: `0 0 calc(${CARD_WIDTH_VW}vw - ${CARD_GAP_PX}px)`,
                minWidth: 0,
                scrollSnapAlign: 'center',
                scrollSnapStop: 'always',
              }}
            >
              {payload.type === 'assignment' && (
                <AssignmentCard payload={payload} onTap={() => handleTap(payload)} />
              )}
              {payload.type === 'application' && (
                <ApplicationCard payload={payload} onTap={() => handleTap(payload)} />
              )}
              {payload.type === 'profile' && (
                <ProfileCompletionCard payload={payload} onTap={() => handleTap(payload)} />
              )}
              {payload.type === 'job_readiness' && (
                <JobReadinessCard payload={payload} onTap={() => handleTap(payload)} />
              )}
              {payload.type === 'job' && (
                <JobRecommendationCard payload={payload} onTap={() => handleTap(payload)} showApplyButton={false} />
              )}
              {payload.type === 'gateway' && (
                <GatewayCard payload={payload} onTap={() => handleTap(payload)} />
              )}
            </Box>
          ))}
        </Box>
        {showNavArrows && cards.length > 1 && (
          <IconButton
            size="small"
            onClick={() => goToIndex(Math.min(cards.length - 1, activeIndex + 1))}
            disabled={activeIndex >= cards.length - 1}
            sx={{ flexShrink: 0 }}
            aria-label={t('cardDeck.next')}
          >
            <ChevronRightIcon />
          </IconButton>
        )}
      </Stack>
      {cards.length > 1 && (
        <Stack direction="row" justifyContent="center" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {cards.map((_, i) => (
            <Box
              key={i}
              onClick={() => goToIndex(i)}
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: i === activeIndex ? 'primary.main' : 'action.disabled',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              aria-label={`${t('cardDeck.goToCard')} ${i + 1}`}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default WorkerDashboardCardRail;
