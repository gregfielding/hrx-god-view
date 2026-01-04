/**
 * Inbox Filters Component
 * 
 * Filter sidebar for inbox (All, Unread, Starred, Sent, Archived, etc.)
 */

import React from 'react';
import {
  Box,
  Tooltip,
  Badge,
  Divider,
  Button,
  ButtonGroup,
  Chip,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';
import MailIcon from '@mui/icons-material/Mail';
import StarIcon from '@mui/icons-material/Star';
import SendIcon from '@mui/icons-material/Send';
import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteIcon from '@mui/icons-material/Delete';
import HomeIcon from '@mui/icons-material/Home';
import PeopleIcon from '@mui/icons-material/People';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import NotificationsIcon from '@mui/icons-material/Notifications';
import ForumIcon from '@mui/icons-material/Forum';
import BlockIcon from '@mui/icons-material/Block';

export type InboxFilter = 'all' | 'unread' | 'starred' | 'sent' | 'archived' | 'trash' | 'primary' | 'social' | 'promotions' | 'updates' | 'forums' | 'spam';

interface InboxFiltersProps {
  activeFilter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  unreadCount?: number;
  starredCount?: number;
  showCategories?: boolean; // Only show categories when email tab is active
  orientation?: 'vertical' | 'horizontal'; // Layout orientation
}

const InboxFilters: React.FC<InboxFiltersProps> = ({
  activeFilter,
  onFilterChange,
  unreadCount = 0,
  starredCount = 0,
  showCategories = false,
  orientation = 'vertical',
}) => {
  const theme = useTheme();
  const isMdAndUp = useMediaQuery(theme.breakpoints.up('md')); // >= 960px
  // System/Action Filters
  const systemFilters: Array<{
    id: InboxFilter;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      id: 'primary',
      label: 'Inbox',
      icon: <HomeIcon />,
    },
    {
      id: 'unread', // Always use 'unread' filter ID (we changed 'all' to behave like 'unread')
      label: 'Unread', // Always show 'Unread' label (consistent behavior)
      icon: <InboxIcon />,
      count: unreadCount > 0 ? unreadCount : undefined,
    },
    {
      id: 'starred',
      label: 'Starred',
      icon: <StarIcon />,
      count: starredCount,
    },
    {
      id: 'sent',
      label: 'Sent',
      icon: <SendIcon />,
    },
    {
      id: 'archived',
      label: 'Archived',
      icon: <ArchiveIcon />,
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: <DeleteIcon />,
    },
  ];

  // Gmail Categories (only show when email tab is active)
  const categoryFilters: Array<{
    id: InboxFilter;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'primary',
      label: 'Primary',
      icon: <HomeIcon />,
    },
    {
      id: 'social',
      label: 'Social',
      icon: <PeopleIcon />,
    },
    {
      id: 'promotions',
      label: 'Promotions',
      icon: <LocalOfferIcon />,
    },
    {
      id: 'updates',
      label: 'Updates',
      icon: <NotificationsIcon />,
    },
    {
      id: 'forums',
      label: 'Forums',
      icon: <ForumIcon />,
    },
    {
      id: 'spam',
      label: 'Spam',
      icon: <BlockIcon />,
    },
  ];

  if (orientation === 'horizontal') {
    // Horizontal layout - subtle ghost buttons with segmented control feel
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'row', 
        gap: 0.5, 
        alignItems: 'center', 
        flexWrap: 'nowrap', // Never wrap: PageHeader handles horizontal scrolling
      }}>
        {/* Gmail Categories - only show when email tab is active */}
        {showCategories && (
          <>
            {categoryFilters.map((filter) => (
              <Button
                key={filter.id}
                size="small"
                variant="text"
                startIcon={filter.icon}
                onClick={() => onFilterChange(filter.id)}
                sx={{ 
                  textTransform: 'none',
                  borderRadius: '999px', // Pill shape
                  fontSize: '14px',
                  fontWeight: activeFilter === filter.id ? 500 : 400,
                  color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  bgcolor: activeFilter === filter.id ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                  px: 1.5,
                  py: 0.75,
                  minWidth: 'auto',
                  '&:hover': {
                    bgcolor: activeFilter === filter.id ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                  },
                }}
              >
                {filter.label}
              </Button>
            ))}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
          </>
        )}
        
        {/* System Filters - chip style per spec */}
        {systemFilters.map((filter) => (
          <Button
            key={filter.id}
            size="small"
            variant="text"
            startIcon={filter.icon}
            onClick={() => onFilterChange(filter.id)}
            sx={{ 
              textTransform: 'none',
              borderRadius: '999px', // Pill shape
              fontSize: '14px',
              fontWeight: activeFilter === filter.id ? 500 : 400,
              color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
              bgcolor: activeFilter === filter.id ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
              px: 1.5, // 12-16px horizontal padding
              py: 0.75, // 6-8px vertical padding
              minWidth: 'auto',
              '&:hover': {
                bgcolor: activeFilter === filter.id ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
              },
            }}
          >
            {filter.label}
            {filter.count !== undefined && filter.count > 0 && (
              <Chip
                label={filter.count > 99 ? '99+' : filter.count}
                size="small"
                sx={{
                  ml: 0.75,
                  height: '18px',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  bgcolor: activeFilter === filter.id ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                  color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  '& .MuiChip-label': {
                    px: 0.5,
                  },
                }}
              />
            )}
          </Button>
        ))}
      </Box>
    );
  }

  // Vertical layout (original)
  const renderFilter = (filter: typeof systemFilters[0]) => (
    <Tooltip key={filter.id} title={filter.label} arrow placement="right">
      <Box
        onClick={() => onFilterChange(filter.id)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: activeFilter === filter.id ? 'primary.main' : 'text.secondary',
          pr: 1,
          '&:hover': {
            color: 'primary.main',
          },
        }}
      >
        {filter.count !== undefined && filter.count > 0 ? (
          <Badge badgeContent={filter.count} color="primary">
            {filter.icon}
          </Badge>
        ) : (
          filter.icon
        )}
      </Box>
    </Tooltip>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Gmail Categories - only show when email tab is active */}
      {showCategories && (
        <>
          {categoryFilters.map((filter) => (
            <Tooltip key={filter.id} title={filter.label} arrow placement="right">
              <Box
                onClick={() => onFilterChange(filter.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: activeFilter === filter.id ? 'primary.main' : 'text.secondary',
                  pr: 1,
                  '&:hover': {
                    color: 'primary.main',
                  },
                }}
              >
                {filter.icon}
              </Box>
            </Tooltip>
          ))}
          <Divider sx={{ my: 1 }} />
        </>
      )}
      
      {/* System Filters */}
      {systemFilters.map(renderFilter)}
    </Box>
  );
};

export default InboxFilters;

