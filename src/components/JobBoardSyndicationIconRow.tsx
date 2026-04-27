import React from 'react';
import { Stack, Tooltip, IconButton, Box } from '@mui/material';
import { normalizeJobBoardSyndicationUrl } from '../utils/jobBoardSyndicationUrls';

const iconButtonSx = {
  p: 1,
  color: 'primary.main',
  bgcolor: 'action.hover',
  borderRadius: 1,
  '&:hover': {
    color: 'primary.dark',
    bgcolor: 'primary.light',
    transform: 'translateY(-1px)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  transition: 'all 0.2s ease',
} as const;

const inlineIconButtonSx = {
  p: 0.375,
  color: 'primary.main',
  bgcolor: 'action.hover',
  borderRadius: 0.75,
  '&:hover': {
    color: 'primary.dark',
    bgcolor: 'primary.light',
  },
  transition: 'background-color 0.15s ease',
} as const;

export interface JobBoardSyndicationIconRowProps {
  indeedUrl?: string | null;
  craigslistUrl?: string | null;
  /** Extra spacing above row (default matches job order header) */
  sx?: object;
  /** Smaller controls for table caption rows (no top margin) */
  inline?: boolean;
}

/**
 * Indeed + Craigslist links as circular icon buttons (same visual language as job order header action row).
 */
const JobBoardSyndicationIconRow: React.FC<JobBoardSyndicationIconRowProps> = ({
  indeedUrl,
  craigslistUrl,
  sx = {},
  inline = false,
}) => {
  const indeedHref = normalizeJobBoardSyndicationUrl(indeedUrl);
  const clHref = normalizeJobBoardSyndicationUrl(craigslistUrl);
  if (!indeedHref && !clHref) return null;

  const btnSx = inline ? inlineIconButtonSx : iconButtonSx;
  const imgSize = inline ? 16 : 20;
  const stackSpacing = inline ? 0.5 : 1;
  const defaultMt = inline ? 0 : 0.75;

  return (
    <Stack
      direction="row"
      spacing={stackSpacing}
      sx={{ alignItems: 'center', mt: defaultMt, flexShrink: 0, ...sx }}
    >
      {indeedHref ? (
        <Tooltip title="Open Indeed listing">
          <IconButton
            component="a"
            href={indeedHref}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            aria-label="Open Indeed listing"
            sx={btnSx}
            onClick={(e) => e.stopPropagation()}
          >
            <Box
              component="img"
              src="https://www.indeed.com/favicon.ico"
              alt=""
              sx={{ width: imgSize, height: imgSize, display: 'block' }}
            />
          </IconButton>
        </Tooltip>
      ) : null}
      {clHref ? (
        <Tooltip title="Open Craigslist listing">
          <IconButton
            component="a"
            href={clHref}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            aria-label="Open Craigslist listing"
            sx={btnSx}
            onClick={(e) => e.stopPropagation()}
          >
            <Box
              component="img"
              src="https://www.craigslist.org/favicon.ico"
              alt=""
              sx={{ width: imgSize, height: imgSize, display: 'block' }}
            />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
};

export default JobBoardSyndicationIconRow;
