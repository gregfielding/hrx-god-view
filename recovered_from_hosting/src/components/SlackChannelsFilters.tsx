/**
 * Slack Channels Filters Component
 * 
 * Filter controls for Slack channels: watch status, activity, and search.
 */

import React from 'react';
import { Box, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
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
        gap: 0.5, // 4px between filter groups (consistent with Inbox)
        flex: showSearch ? 1 : 'none',
      }}>
        {/* Watch Status Segmented Control */}
        <ToggleButtonGroup
          value={filter.watchFilter}
          exclusive
          onChange={(_, value) => {
            if (value !== null) {
              onChangeFilter({ watchFilter: value });
            }
          }}
          size="small"
          sx={{ 
            height: 36,
            gap: 0, // Remove default spacing within group
            '& .MuiToggleButton-root': {
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: 400,
              px: 1.5, // 12-16px horizontal padding
              py: 0.75, // 6-8px vertical padding
              textTransform: 'none',
              border: 'none',
              bgcolor: 'rgba(0, 0, 0, 0.04)',
              color: 'rgba(0, 0, 0, 0.7)',
              marginLeft: 0, // Remove any default margin
              marginRight: 0,
              '&:not(:first-of-type)': {
                marginLeft: 0.5, // Add consistent spacing between buttons in group
              },
              '&:hover': {
                bgcolor: 'rgba(0, 0, 0, 0.08)',
              },
              '&.Mui-selected': {
                bgcolor: '#0057B8',
                color: 'white',
                fontWeight: 500,
                '&:hover': {
                  bgcolor: '#004a9f',
                },
              },
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="watched">Watched</ToggleButton>
          <ToggleButton value="unwatched">Unwatched</ToggleButton>
          <ToggleButton value="muted">Muted</ToggleButton>
        </ToggleButtonGroup>

        {/* Activity Filter */}
        <ToggleButtonGroup
          value={filter.activityFilter}
          exclusive
          onChange={(_, value) => {
            if (value !== null) {
              onChangeFilter({ activityFilter: value });
            }
          }}
          size="small"
          sx={{ 
            height: 36,
            gap: 0, // Remove default spacing within group
            '& .MuiToggleButton-root': {
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: 400,
              px: 1.5,
              py: 0.75,
              textTransform: 'none',
              border: 'none',
              bgcolor: 'rgba(0, 0, 0, 0.04)',
              color: 'rgba(0, 0, 0, 0.7)',
              marginLeft: 0, // Remove any default margin
              marginRight: 0,
              '&:not(:first-of-type)': {
                marginLeft: 0.5, // Add consistent spacing between buttons in group
              },
              '&:hover': {
                bgcolor: 'rgba(0, 0, 0, 0.08)',
              },
              '&.Mui-selected': {
                bgcolor: '#0057B8',
                color: 'white',
                fontWeight: 500,
                '&:hover': {
                  bgcolor: '#004a9f',
                },
              },
            },
          }}
        >
          <ToggleButton value="all">Any Activity</ToggleButton>
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="quiet">Quiet</ToggleButton>
        </ToggleButtonGroup>
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

