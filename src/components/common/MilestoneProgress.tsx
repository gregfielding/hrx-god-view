import * as React from 'react';
import { Box, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import CheckRounded from '@mui/icons-material/CheckRounded';

export interface MilestoneProgressProps {
  total: number;
  completed: number; // number completed (0..total)
  labels?: string[];
  sticky?: 'top' | 'bottom' | 'none';
  onJump?: (index: number) => void; // allow clicking completed steps to jump
  showPercent?: boolean;
  sx?: any; // style overrides for outer container
}

export default function MilestoneProgress({
  total,
  completed,
  labels,
  sticky = 'top',
  onJump,
  showPercent = true,
  sx,
}: MilestoneProgressProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Colors
  const fg = '#22c55e';
  const track = 'rgba(34, 197, 94, 0.18)';

  // Positioning
  const stickyStyles =
    sticky === 'top'
      ? ({ position: 'sticky' as const, top: 0, borderBottom: 1, borderColor: 'divider' } as const)
      : sticky === 'bottom'
      ? ({ position: 'sticky' as const, bottom: 0, borderTop: 1, borderColor: 'divider' } as const)
      : ({} as const);

  const pct = Math.max(0, Math.min(100, Math.round((completed / Math.max(1, total)) * 100)));

  return (
    <Box
      role="region"
      aria-label="Application progress"
      sx={{ zIndex: 10, bgcolor: 'background.paper', 
        borderTopLeftRadius: { xs: 0, md: 8 },
        borderBottomLeftRadius: { xs: 0, md: 8 },
        borderTopRightRadius: { xs: 0, md: 8 },
        borderBottomRightRadius: { xs: 0, md: 8 },
        px: { xs: 2, md: 4 }, py: 0, ...stickyStyles, ...sx }}
    >
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {showPercent ? `${pct}% complete` : 'Progress'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
          {completed} of {total} sections done
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < completed;
          const isCurrent = i === completed && completed < total;
          const label = labels?.[i] ?? `Step ${i + 1}`;

          const segment = (
            <Box
              tabIndex={0}
              role="button"
              aria-label={`${label}${isDone ? ' completed' : isCurrent ? ' current' : ''}`}
              onClick={() => (isDone && onJump ? onJump(i) : undefined)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && isDone && onJump) onJump(i);
              }}
              sx={{
                height: 12,
                flex: 1,
                borderRadius: 999,
                bgcolor: isDone ? fg : track,
                outline: 'none',
                transition: 'background-color .25s ease, transform .12s ease',
                cursor: isDone && onJump ? 'pointer' : 'default',
                ...(isCurrent && { boxShadow: `0 0 0 2px ${track} inset` }),
                '&:focus-visible': { boxShadow: `0 0 0 3px ${theme.palette.primary.main}66` },
                '&:active': { transform: 'scale(1.01)' },
              }}
            />
          );

          const labelRow = (
            <Box sx={{ mt: 0.75, textAlign: 'center', width: '100%', display: { xs: 'none', lg: 'block' } }}>
              <Typography variant="caption" color={isDone ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'nowrap' }}>
                {isDone ? (
                  <>
                    <CheckRounded fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                    {label}
                  </>
                ) : (
                  label
                )}
              </Typography>
            </Box>
          );

          return (
            <Box key={i} sx={{ flex: 1 }}>
              <Tooltip title={label} placement="top" disableInteractive arrow>
                {segment}
              </Tooltip>
              {labelRow}
            </Box>
          );
        })}
      </Box>

      {isMobile && labels && (
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {labels[Math.min(completed, labels.length - 1)]}
          </Typography>
        </Box>
      )}
    </Box>
  );
}


