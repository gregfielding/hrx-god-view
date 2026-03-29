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

export interface JobBoardSyndicationIconRowProps {
  indeedUrl?: string | null;
  craigslistUrl?: string | null;
  /** Extra spacing above row (default matches job order header) */
  sx?: object;
}

/**
 * Indeed + Craigslist links as circular icon buttons (same visual language as job order header action row).
 */
const JobBoardSyndicationIconRow: React.FC<JobBoardSyndicationIconRowProps> = ({
  indeedUrl,
  craigslistUrl,
  sx = {},
}) => {
  const indeedHref = normalizeJobBoardSyndicationUrl(indeedUrl);
  const clHref = normalizeJobBoardSyndicationUrl(craigslistUrl);
  if (!indeedHref && !clHref) return null;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75, ...sx }}>
      {indeedHref ? (
        <Tooltip title="Open Indeed listing">
          <IconButton
            component="a"
            href={indeedHref}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            aria-label="Open Indeed listing"
            sx={iconButtonSx}
          >
            <Box
              component="img"
              src="https://www.indeed.com/favicon.ico"
              alt=""
              sx={{ width: 20, height: 20, display: 'block' }}
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
            sx={iconButtonSx}
          >
            <Box
              component="img"
              src="https://www.craigslist.org/favicon.ico"
              alt=""
              sx={{ width: 20, height: 20, display: 'block' }}
            />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
};

export default JobBoardSyndicationIconRow;
