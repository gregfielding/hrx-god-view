/**
 * Pull to Refresh Component
 * 
 * Mobile pull-to-refresh functionality
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, CircularProgress } from '@mui/material';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number; // Distance to pull before triggering refresh (px)
  disabled?: boolean;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  threshold = 80,
  disabled = false,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;

    const container = containerRef.current;
    if (!container) return;

    let touchStartY = 0;
    let scrollTop = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      scrollTop = container.scrollTop;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - touchStartY;

      // Only allow pull-to-refresh when at the top of the scroll
      if (scrollTop === 0 && deltaY > 0 && !isRefreshing) {
        e.preventDefault();
        setIsPulling(true);
        const distance = Math.min(deltaY * 0.5, threshold * 1.5); // Dampen the pull
        setPullDistance(distance);
      }
    };

    const handleTouchEnd = async () => {
      if (isPulling && pullDistance >= threshold && !isRefreshing) {
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
          setIsPulling(false);
        }
      } else {
        // Spring back
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [disabled, isRefreshing, isPulling, pullDistance, threshold, onRefresh]);

  const pullProgress = Math.min(pullDistance / threshold, 1);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        height: '100%',
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Pull to refresh indicator */}
      {isPulling || isRefreshing ? (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: `${Math.max(pullDistance, 60)}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            transform: `translateY(${-60 + Math.min(pullDistance, 60)}px)`,
            transition: isRefreshing ? 'transform 0.2s ease' : 'none',
          }}
        >
          {isRefreshing ? (
            <CircularProgress size={24} />
          ) : (
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pullProgress,
                transform: `rotate(${pullProgress * 180}deg)`,
                transition: 'transform 0.2s ease',
              }}
            >
              ↓
            </Box>
          )}
        </Box>
      ) : null}
      {children}
    </Box>
  );
};

export default PullToRefresh;

