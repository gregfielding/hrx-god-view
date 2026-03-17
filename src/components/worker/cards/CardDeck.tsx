/**
 * CardDeck — reusable one-card-at-a-time deck with Previous / Next / Expand (web interaction model).
 * Use across Dashboard, Find Work, Applications, Assignments, Profile.
 * Preserves same card logic and order as mobile (Flutter uses swipe; web uses these buttons).
 */

import React, { useState, useCallback } from 'react';
import { Box, Stack, Button, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { useT } from '../../../i18n';

export interface CardDeckProps {
  /** Number of cards */
  totalCards: number;
  /** Current 0-based index */
  activeIndex: number;
  /** Set current index */
  onIndexChange: (index: number) => void;
  /** Called when user clicks Expand / View Details — typically navigate to detail */
  onExpand: () => void;
  /** Card content for the active index */
  children: React.ReactNode;
  /** Optional: show "Section X of Y" (e.g. profile) */
  showSectionProgress?: boolean;
  /** Optional: section label for progress (e.g. "Section") */
  sectionLabel?: string;
  /** Optional: disable expand when no selection */
  expandDisabled?: boolean;
  /** Optional: aria label for deck */
  ariaLabel?: string;
}

const CardDeck: React.FC<CardDeckProps> = ({
  totalCards,
  activeIndex,
  onIndexChange,
  onExpand,
  children,
  showSectionProgress = false,
  sectionLabel,
  expandDisabled = false,
  ariaLabel,
}) => {
  const t = useT();
  const canGoPrev = totalCards > 1 && activeIndex > 0;
  const canGoNext = totalCards > 1 && activeIndex < totalCards - 1;

  const goPrev = useCallback(() => {
    if (canGoPrev) onIndexChange(activeIndex - 1);
  }, [canGoPrev, activeIndex, onIndexChange]);

  const goNext = useCallback(() => {
    if (canGoNext) onIndexChange(activeIndex + 1);
  }, [canGoNext, activeIndex, onIndexChange]);

  if (totalCards === 0) return null;

  return (
    <Stack spacing={2} sx={{ width: '100%' }} role="region" aria-label={ariaLabel || t('cardDeck.ariaLabel')}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 280,
          position: 'relative',
        }}
      >
        {children}
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="center"
        spacing={2}
        flexWrap="wrap"
        useFlexGap
      >
        <Button
          variant="outlined"
          size="medium"
          startIcon={<ChevronLeftIcon />}
          onClick={goPrev}
          disabled={!canGoPrev}
          aria-label={t('cardDeck.previous')}
        >
          {t('cardDeck.previous')}
        </Button>
        {showSectionProgress && totalCards > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
            {sectionLabel || t('cardDeck.section')} {activeIndex + 1} {t('cardDeck.of')} {totalCards}
          </Typography>
        )}
        <Button
          variant="outlined"
          size="medium"
          endIcon={<ChevronRightIcon />}
          onClick={goNext}
          disabled={!canGoNext}
          aria-label={t('cardDeck.next')}
        >
          {t('cardDeck.next')}
        </Button>
        <Button
          variant="contained"
          size="medium"
          startIcon={<OpenInFullIcon />}
          onClick={onExpand}
          disabled={expandDisabled}
          aria-label={t('cardDeck.expand')}
        >
          {t('cardDeck.expand')}
        </Button>
      </Stack>
      {/* Dots for quick jump (optional, when many cards) */}
      {totalCards > 1 && totalCards <= 10 && (
        <Stack direction="row" justifyContent="center" spacing={0.75} flexWrap="wrap">
          {Array.from({ length: totalCards }, (_, i) => (
            <Box
              key={i}
              onClick={() => onIndexChange(i)}
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

export default CardDeck;
