/**
 * Slack Channels Filters Component
 * 
 * Filter controls for Slack channels: My Channels / All Channels
 */

import React from 'react';
import { Box, Button } from '@mui/material';

export type SlackChannelFilterType = 'myChannels' | 'all';

interface SlackChannelsFiltersProps {
  filter: SlackChannelFilterType;
  onChangeFilter: (filter: SlackChannelFilterType) => void;
}

const SlackChannelsFilters: React.FC<SlackChannelsFiltersProps> = ({
  filter,
  onChangeFilter,
}) => {
  const chipSx = (selected: boolean) => ({
    textTransform: 'none',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: selected ? 500 : 400,
    color: selected ? 'white' : 'rgba(0, 0, 0, 0.7)',
    bgcolor: selected ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
    px: 1.5,
    py: 0.75,
    minWidth: 'auto',
    whiteSpace: 'nowrap',
    '&:hover': {
      bgcolor: selected ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
    },
  });

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'row',
      gap: 0.5,
      alignItems: 'center',
    }}>
      <Button
        variant="text"
        onClick={() => onChangeFilter('myChannels')}
        sx={chipSx(filter === 'myChannels')}
      >
        My Channels
      </Button>
      <Button
        variant="text"
        onClick={() => onChangeFilter('all')}
        sx={chipSx(filter === 'all')}
      >
        All Channels
      </Button>
    </Box>
  );
};

export default SlackChannelsFilters;