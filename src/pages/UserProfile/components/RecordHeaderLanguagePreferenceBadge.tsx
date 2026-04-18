import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';

export type RecordHeaderLanguagePreferenceBadgeProps = {
  language: 'en' | 'es';
};

/**
 * Compact EN / ES pill matching {@link RecordHeaderActionIcon} shells (Firestore `users.preferredLanguage`).
 */
const RecordHeaderLanguagePreferenceBadge: React.FC<RecordHeaderLanguagePreferenceBadgeProps> = ({
  language,
}) => {
  const label = language === 'es' ? 'ES' : 'EN';
  return (
    <Tooltip
      title={
        language === 'es' ? 'Preferred message language: Español' : 'Preferred message language: English'
      }
      arrow
      placement="top"
      enterDelay={280}
      componentsProps={recordHeaderTooltipComponentsProps}
    >
      <Box
        component="span"
        role="img"
        aria-label={language === 'es' ? 'Preferred language Español' : 'Preferred language English'}
        sx={(theme) => ({
          // Match `recordHeaderActionIconButtonSx` (text label instead of icon)
          p: 0.3125,
          width: 26,
          height: 26,
          boxSizing: 'border-box',
          color: 'text.secondary',
          bgcolor: theme.palette.mode === 'dark' ? 'action.hover' : 'rgba(0, 0, 0, 0.035)',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          userSelect: 'none',
          transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
          '&:hover': {
            color: 'primary.main',
            bgcolor: theme.palette.action.hover,
            borderColor: theme.palette.divider,
          },
        })}
      >
        {label}
      </Box>
    </Tooltip>
  );
};

export default RecordHeaderLanguagePreferenceBadge;
