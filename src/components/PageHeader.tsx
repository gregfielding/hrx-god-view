/**
 * PageHeader Component
 * 
 * Shared page header pattern for list-based pages (Inbox, Slack Channels, etc.)
 * Provides consistent layout, typography, spacing, and toolbar structure.
 */

import React from 'react';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import { Divider } from '@mui/material';

interface PageHeaderProps {
  title: string | React.ReactNode; // Can be string or custom React element (e.g., with avatar)
  subtitle?: string | React.ReactNode; // Can be string or custom React element (e.g., metadata line)
  titleRightActions?: React.ReactNode; // Optional: actions rendered on the title row (record-style pages)
  filters?: React.ReactNode;     // Left side: filter chips, toggles, etc.
  rightActions?: React.ReactNode; // Right side: search + primary CTA
  showDivider?: boolean;          // Default: true
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  titleRightActions,
  filters,
  rightActions,
  showDivider = true,
}) => {
  const theme = useTheme();
  // Inbox standard: stack the toolbar on md and smaller so filters don't get squeezed/clipped
  const isStackedToolbar = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Box
      sx={{
        px: { xs: 2, md: 3 }, // 16px mobile, 24px desktop
        pt: 2, // 16px top padding
        pb: 0,
      }}
    >
      {/* Title and Subtitle */}
      <Box sx={{ mb: subtitle ? 1 : 2 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'flex-start' },
            justifyContent: { xs: 'flex-start', md: 'space-between' },
            gap: { xs: 1.5, md: 2 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            {typeof title === 'string' ? (
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 600,
                  lineHeight: 1.2,
                  mb: subtitle ? 1 : 0,
                }}
              >
                {title}
              </Typography>
            ) : (
              <Box sx={{ mb: subtitle ? 1 : 0 }}>
                {title}
              </Box>
            )}
          </Box>

          {titleRightActions && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: { xs: 'flex-start', md: 'flex-end' },
                alignItems: 'center',
                gap: 1.5,
                flexShrink: 0,
              }}
            >
              {titleRightActions}
            </Box>
          )}
        </Box>
        {subtitle && (
          typeof subtitle === 'string' ? (
            <Typography
              variant="body2"
              sx={{
                fontSize: '14px',
                fontWeight: 400,
                color: 'rgba(0, 0, 0, 0.55)',
                mt: 1, // 8px spacing from title
              }}
            >
              {subtitle}
            </Typography>
          ) : (
            <Box sx={{ mt: 1 }}>
              {subtitle}
            </Box>
          )
        )}
      </Box>

      {/* Toolbar Row */}
      {(filters || rightActions) && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: isStackedToolbar ? 'column' : 'row',
            alignItems: isStackedToolbar ? 'stretch' : 'center',
            gap: isStackedToolbar ? 1.5 : 2,
            minHeight: '48px',
            mb: 1.5, // 12px spacing to divider
            width: '100%',
            overflow: 'visible',
          }}
        >
          {/* On stacked widths, show actions first (search full width), then filters row */}
          {isStackedToolbar && rightActions && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5, // 12px between search and CTA
                width: '100%',
              }}
            >
              {rightActions}
            </Box>
          )}

          {/* Filters Row (Inbox standard: horizontally scrollable, never clipped) */}
          {filters && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1, // 8px between filter chips (spec)
                flex: isStackedToolbar ? 'none' : '1 1 auto',
                minWidth: 0,
                overflowX: 'auto',
                overflowY: 'hidden',
                WebkitOverflowScrolling: 'touch',
                pr: 2, // ensures last pill never looks clipped at container edge
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              {filters}
            </Box>
          )}

          {/* Right Actions (desktop only) */}
          {!isStackedToolbar && rightActions && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5, // 12px between search and CTA
                flexShrink: 0,
                width: 'auto',
                ml: 'auto', // Push actions to far right on desktop
              }}
            >
              {rightActions}
            </Box>
          )}
        </Box>
      )}

      {/* Divider */}
      {showDivider && (
        <Divider
          sx={{
            mt: 1.5, // 12px spacing from toolbar
            height: '1px',
            backgroundColor: 'rgba(0, 0, 0, 0.08)',
          }}
        />
      )}
    </Box>
  );
};

export default PageHeader;


