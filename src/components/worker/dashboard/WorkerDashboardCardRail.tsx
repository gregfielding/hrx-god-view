/**
 * Worker Dashboard Card Rail — single swipeable container, one primary card at a time.
 * Renders modular card types; tap or swipe-up opens full page (via onTap → primary action).
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Box, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { AssignmentCard, ApplicationCard, ProfileCompletionCard, JobRecommendationCard } from './cards';
import type { DashboardCardPayload } from './cards';

export interface WorkerDashboardCardRailProps {
  cards: DashboardCardPayload[];
}

function getPrimaryRoute(payload: DashboardCardPayload): string | undefined {
  switch (payload.type) {
    case 'assignment':
      return payload.viewAssignmentTo;
    case 'application':
      return payload.viewJobTo;
    case 'profile':
      return payload.continueProfileTo;
    case 'job':
      return payload.viewJobTo;
    default:
      return undefined;
  }
}

const WorkerDashboardCardRail: React.FC<WorkerDashboardCardRailProps> = ({ cards }) => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || cards.length === 0) return;
    const cardWidth = el.offsetWidth;
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
    const ref = cardRefs.current[i];
    if (ref && ref.scrollIntoView) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, []);

  const handleTap = useCallback(
    (payload: DashboardCardPayload) => {
      const to = getPrimaryRoute(payload);
      if (to) navigate(to);
    },
    [navigate]
  );

  if (cards.length === 0) {
    return null;
  }

  return (
    <Stack spacing={2}>
      <Box
        ref={scrollRef}
        sx={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          gap: 2,
          px: 1,
          py: 1,
          mx: -1,
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.selected' },
        }}
      >
        {cards.map((payload, i) => (
          <Box
            key={payload.id}
            ref={(el) => { cardRefs.current[i] = el as HTMLElement | null; }}
            sx={{
              flex: '0 0 calc(100% - 24px)',
              minWidth: 0,
              maxWidth: 420,
              mx: 'auto',
              scrollSnapAlign: 'center',
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
            {payload.type === 'job' && (
              <JobRecommendationCard payload={payload} onTap={() => handleTap(payload)} />
            )}
          </Box>
        ))}
      </Box>
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
              aria-label={`Card ${i + 1}`}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default WorkerDashboardCardRail;
