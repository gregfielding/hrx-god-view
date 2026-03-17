/**
 * Swipeable card rail for Job Readiness improvement tasks.
 * Swipe right → complete, swipe left → skip, tap → open full details.
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Box, Stack } from '@mui/material';
import type { ImprovementTask } from '../../../utils/jobReadinessTasks';
import ImprovementTaskCard from './ImprovementTaskCard';

const CARD_WIDTH_VW = 70;
const CARD_GAP_PX = 12;
const SWIPE_THRESHOLD_PX = 60;

export interface JobReadinessCardRailProps {
  tasks: ImprovementTask[];
  onComplete: (taskId: string, value?: string) => void;
  onSkip: (taskId: string) => void;
  onOpenDetails: (task: ImprovementTask) => void;
}

const JobReadinessCardRail: React.FC<JobReadinessCardRailProps> = ({
  tasks,
  onComplete,
  onSkip,
  onOpenDetails,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || tasks.length === 0) return;
    const cardWidth = el.offsetWidth * (CARD_WIDTH_VW / 100) + CARD_GAP_PX;
    const index = Math.round(el.scrollLeft / cardWidth);
    setActiveIndex(Math.min(Math.max(0, index), tasks.length - 1));
  }, [tasks.length]);

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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const advanceOrStay = useCallback(() => {
    if (activeIndex < tasks.length - 1) {
      goToIndex(activeIndex + 1);
    }
  }, [activeIndex, tasks.length, goToIndex]);

  const handleComplete = useCallback(
    (taskId: string, value?: string) => {
      onComplete(taskId, value);
      if (value !== 'upload') advanceOrStay();
    },
    [onComplete, advanceOrStay]
  );

  const handleSkip = useCallback(
    (taskId: string) => {
      onSkip(taskId);
      advanceOrStay();
    },
    [onSkip, advanceOrStay]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - touchStartX.current;
      const deltaY = endY - touchStartY.current;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      const task = tasks[activeIndex];
      if (!task) return;
      if (deltaX > 0) {
        handleComplete(task.id);
      } else {
        handleSkip(task.id);
      }
    },
    [activeIndex, tasks, handleComplete, handleSkip]
  );

  if (tasks.length === 0) return null;

  return (
    <Stack spacing={2}>
      <Box
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        sx={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          gap: `${CARD_GAP_PX}px`,
          px: '5vw',
          py: 1,
          mx: -1,
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.selected' },
        }}
      >
        {tasks.map((task, i) => (
          <Box
            key={task.id}
            sx={{
              flex: `0 0 calc(${CARD_WIDTH_VW}vw - ${CARD_GAP_PX}px)`,
              minWidth: 0,
              scrollSnapAlign: 'center',
              scrollSnapStop: 'always',
            }}
          >
            <ImprovementTaskCard
              task={task}
              onComplete={handleComplete}
              onSkip={handleSkip}
              onTap={() => onOpenDetails(task)}
            />
          </Box>
        ))}
      </Box>
      {tasks.length > 1 && (
        <Stack direction="row" justifyContent="center" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {tasks.map((_, i) => (
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
              aria-label={`Go to card ${i + 1}`}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default JobReadinessCardRail;
