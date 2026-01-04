/**
 * Slack Channels Filters Component
 * 
 * Filter controls for Slack channels: watch status, activity, and search.
 */

import React from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { SlackChannelsFilter } from '../types/slackChannels';

interface SlackChannelsFiltersProps {
  filter: SlackChannelsFilter;
  onChangeFilter: (update: Partial<SlackChannelsFilter>) => void;
  totalCount: number;
  showSearch?: boolean; // If false, don't render search (moved to PageHeader)
}

const SlackChannelsFilters: React.FC<SlackChannelsFiltersProps> = ({
  filter,
  onChangeFilter,
  totalCount,
  showSearch = true,
}) => {
  const chipSx = (selected: boolean) => ({
    textTransform: 'none',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: selected ? 600 : 500,
    px: 2,
    py: 0.75,
    minWidth: 'auto',
    whiteSpace: 'nowrap',
    boxShadow: 'none',
    border: 'none',
    ...(selected
      ? {
          bgcolor: '#0057B8',
          color: '#FFFFFF',
          '&:hover': { bgcolor: '#004a9f' },
        }
      : {
          bgcolor: 'rgba(0, 0, 0, 0.06)',
          color: 'rgba(0, 0, 0, 0.78)',
          '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.10)' },
        }),
  });

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: { xs: 'column', md: 'row' },
      gap: 2,
      alignItems: { xs: 'stretch', md: 'center' },
      justifyContent: showSearch ? 'space-between' : 'flex-start',
      pb: showSearch ? 1.5 : 0,
      mb: showSearch ? 1.5 : 0,
    }}>
      {/* Left: Watch Status and Activity Filters */}
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1, // Inbox chip spacing
        flex: showSearch ? 1 : 'none',
        minWidth: 0,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        pr: 2,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}>
        {/* Watch Filter (Inbox-style chips) */}
        {(['all', 'watched', 'unwatched', 'muted'] as const).map((v) => (
          <Button
            key={v}
            variant="contained"
            onClick={() => onChangeFilter({ watchFilter: v })}
            sx={chipSx(filter.watchFilter === v)}
          >
            {v === 'all' ? 'All' : v === 'watched' ? 'Watched' : v === 'unwatched' ? 'Unwatched' : 'Muted'}
          </Button>
        ))}

        {/* Activity Filter (Inbox-style chips) */}
        {(['all', 'active', 'quiet'] as const).map((v) => (
          <Button
            key={v}
            variant="contained"
            onClick={() => onChangeFilter({ activityFilter: v })}
            sx={chipSx(filter.activityFilter === v)}
          >
            {v === 'all' ? 'Any Activity' : v === 'active' ? 'Active' : 'Quiet'}
          </Button>
        ))}
      </Box>

      {/* Right: Search and Count (only if showSearch is true) */}
      {showSearch && (
        <Box sx={{ 
          display: 'flex', 
          gap: 2, 
          alignItems: 'center',
          width: { xs: '100%', md: 'auto' }
        }}>
          <TextField
            placeholder="Search channels..."
            value={filter.search}
            onChange={(e) => onChangeFilter({ search: e.target.value })}
            size="small"
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
            sx={{ 
              flex: { xs: 1, md: 'none' },
              minWidth: { md: 300 }
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {totalCount} {totalCount === 1 ? 'channel' : 'channels'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SlackChannelsFilters;

