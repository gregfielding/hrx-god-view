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
import MailIcon from '@mui/icons-material/Mail';
import StarIcon from '@mui/icons-material/Star';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import HomeIcon from '@mui/icons-material/Home';
import PeopleIcon from '@mui/icons-material/People';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import NotificationsIcon from '@mui/icons-material/Notifications';
import ForumIcon from '@mui/icons-material/Forum';
import BlockIcon from '@mui/icons-material/Block';
import DraftsIcon from '@mui/icons-material/Drafts';

export type InboxFilter =
  | 'starred'
  | 'sent'
  | 'drafts'
  | 'trash'
  // Gmail category filters
  | 'primary'
  | 'social'
  | 'promotions'
  | 'updates'
  | 'forums'
  | 'spam';

interface InboxFiltersProps {
  activeFilter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  unreadCount?: number;
  starredCount?: number;
  mailboxCounts?: Partial<Record<InboxFilter, number>>; // Badge counts for mailbox/category buttons (Gmail-sourced)
  showCategories?: boolean; // Show Gmail categories (Primary/Social/Promotions/Updates/Forums/Spam)
  orientation?: 'vertical' | 'horizontal'; // Layout orientation
  unreadOnly?: boolean; // Contextual unread toggle within the selected mailbox
  onUnreadOnlyChange?: (unreadOnly: boolean) => void;
}

const InboxFilters: React.FC<InboxFiltersProps> = ({
  activeFilter,
  onFilterChange,
  unreadCount = 0,
  starredCount = 0,
  mailboxCounts,
  showCategories = false,
  orientation = 'vertical',
  unreadOnly = false,
  onUnreadOnlyChange,
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
      id: 'drafts',
      label: 'Drafts',
      icon: <DraftsIcon />,
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
    const isMailboxView =
      showCategories &&
      (['primary', 'social', 'promotions', 'updates', 'forums', 'spam'] as InboxFilter[]).includes(activeFilter);
    const showUnreadToggle = isMailboxView && typeof onUnreadOnlyChange === 'function';

    // Horizontal layout - subtle ghost buttons with segmented control feel
    const pillSx = {
      textTransform: 'none' as const,
      borderRadius: '999px',
      fontSize: '13px',
      px: 1.25,
      py: 0.5,
      minHeight: 30,
      minWidth: 'auto' as const,
      whiteSpace: 'nowrap' as const,
      '& .MuiButton-startIcon': {
        mr: 0.35,
        '& svg': { fontSize: 16 },
      },
    };

    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'row', 
        gap: 0.35, 
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
                  ...pillSx,
                  fontWeight: activeFilter === filter.id ? 600 : 400,
                  color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  bgcolor: activeFilter === filter.id ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                  '&:hover': {
                    bgcolor: activeFilter === filter.id ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                  },
                }}
              >
                {filter.label}
                {typeof mailboxCounts?.[filter.id] === 'number' && mailboxCounts![filter.id]! > 0 && (
                  <Chip
                    label={mailboxCounts![filter.id]! > 99 ? '99+' : mailboxCounts![filter.id]!}
                    size="small"
                    sx={{
                      ml: 0.75,
                      height: '18px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      bgcolor: activeFilter === filter.id ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                      color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      '& .MuiChip-label': { px: 0.5 },
                    }}
                  />
                )}
              </Button>
            ))}

            {showUnreadToggle && (
              <Button
                size="small"
                variant="text"
                startIcon={<MailIcon />}
                onClick={() => onUnreadOnlyChange(!unreadOnly)}
                sx={{
                  ...pillSx,
                  fontWeight: unreadOnly ? 600 : 400,
                  color: unreadOnly ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  bgcolor: unreadOnly ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                  '&:hover': {
                    bgcolor: unreadOnly ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                  },
                }}
              >
                Unread
                {unreadCount > 0 && (
                  <Chip
                    label={unreadCount > 99 ? '99+' : unreadCount}
                    size="small"
                    sx={{
                      ml: 0.75,
                      height: '18px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      bgcolor: unreadOnly ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                      color: unreadOnly ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      '& .MuiChip-label': { px: 0.5 },
                    }}
                  />
                )}
              </Button>
            )}

            <Divider orientation="vertical" flexItem sx={{ mx: 0.35, alignSelf: 'stretch', minHeight: 22 }} />
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
              ...pillSx,
              fontWeight: activeFilter === filter.id ? 600 : 400,
              color: activeFilter === filter.id ? 'white' : 'rgba(0, 0, 0, 0.7)',
              bgcolor: activeFilter === filter.id ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
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

