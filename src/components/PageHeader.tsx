/**
 * PageHeader Component
 * 
 * Shared page header pattern for list-based pages (Inbox, Slack Channels, etc.)
 * Provides consistent layout, typography, spacing, and toolbar structure.
 */

import React from 'react';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import { Divider } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

interface PageHeaderProps {
  /** When true, skips the title + subtitle row (toolbar row unchanged). */
  hideHeading?: boolean;
  title: string | React.ReactNode; // Can be string or custom React element (e.g., with avatar)
  subtitle?: string | React.ReactNode; // Can be string or custom React element (e.g., with metadata line)
  titleRightActions?: React.ReactNode; // Optional: actions rendered on the title row (record-style pages)
  filters?: React.ReactNode;     // Left side: filter chips, toggles, etc.
  rightActions?: React.ReactNode; // Right side: search + primary CTA
  showDivider?: boolean;          // Default: true
  /** Tighter padding and toolbar height (e.g. user record header + tab strip). */
  dense?: boolean;
  /**
   * When set (with `showDivider`), vertical gap between the toolbar row and the
   * divider uses this single margin on the divider only (`theme.spacing` units).
   * Omit to keep the default `dense`/non-`dense` toolbar `mb` + divider `mt`.
   */
  toolbarDividerSpacing?: number;
  /** Merged onto the root container (after defaults; can override `pt`, etc.). */
  sx?: SxProps<Theme>;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  hideHeading = false,
  title,
  subtitle,
  titleRightActions,
  filters,
  rightActions,
  showDivider = true,
  dense = false,
  toolbarDividerSpacing,
  sx,
}) => {
  const theme = useTheme();
  // Inbox standard: stack the toolbar on md and smaller so filters don't get squeezed/clipped
  const isStackedToolbar = useMediaQuery(theme.breakpoints.down('md'));

  const rootSx: SxProps<Theme> = {
    px: { xs: 2, md: 3 }, // 16px mobile, 24px desktop
    pt: dense ? 0.875 : 2,
    pb: 0,
    ...(sx && typeof sx === 'object' && !Array.isArray(sx) ? sx : {}),
  };

  return (
    <Box sx={rootSx}>
      {/* Title and Subtitle */}
      {!hideHeading && (
      <Box sx={{ mb: subtitle ? (dense ? 0.5 : 1) : dense ? 0.65 : 2 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'flex-start' },
            justifyContent: { xs: 'flex-start', md: 'space-between' },
            gap: { xs: dense ? 1 : 1.25, md: dense ? 1.25 : 2 },
          }}
        >
          <Box
            sx={{
              minWidth: 0,
              // Critical: allow custom title nodes (that implement their own
              // "title left / actions right" layout) to actually span the row.
              // Without flex-grow, width: '100%' inside the title node can end
              // up constrained and the "right" cluster appears centered.
              flex: { xs: 'none', md: '1 1 auto' },
            }}
          >
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
              <Box sx={{ mb: subtitle ? (dense ? 0.75 : 1) : dense ? 0.5 : 0 }}>
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
                gap: dense ? 0.75 : 1.5,
                flexShrink: 0,
                pt: dense ? 0.25 : 0,
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
                mt: dense ? 0.75 : 1, // 8px spacing from title
              }}
            >
              {subtitle}
            </Typography>
          ) : (
            <Box sx={{ mt: dense ? 0.75 : 1 }}>
              {subtitle}
            </Box>
          )
        )}
      </Box>
      )}

      {/* Toolbar Row */}
      {(filters || rightActions) && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: isStackedToolbar ? 'column' : 'row',
            alignItems: isStackedToolbar ? 'stretch' : 'center',
            gap: isStackedToolbar ? (dense ? 1 : 1.25) : dense ? 1 : 2,
            minHeight: dense ? 36 : 48,
            mb:
              showDivider && toolbarDividerSpacing === undefined
                ? dense
                  ? 0.65
                  : 1.5
                : 0,
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
                justifyContent: 'flex-end',
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
            mt:
              toolbarDividerSpacing !== undefined
                ? toolbarDividerSpacing
                : dense
                  ? 0.65
                  : 1.5,
            height: '1px',
            backgroundColor: 'rgba(0, 0, 0, 0.08)',
          }}
        />
      )}
    </Box>
  );
};

export default PageHeader;


