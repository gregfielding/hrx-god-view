/**
 * MentionSuggestionsPopover Component
 * 
 * Displays autocomplete suggestions for @mentions.
 */

import React from 'react';
import {
  Popover,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  CircularProgress,
  Box,
} from '@mui/material';
import { MentionOption } from '../types/mentions';

interface MentionSuggestionsPopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  loading: boolean;
  options: MentionOption[];
  onSelect: (opt: MentionOption) => void;
}

export const MentionSuggestionsPopover: React.FC<MentionSuggestionsPopoverProps> = ({
  anchorEl,
  open,
  loading,
  options,
  onSelect,
}) => {
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={() => {}}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{
        '& .MuiPaper-root': {
          minWidth: 220,
          maxWidth: 320,
          maxHeight: 280,
          overflow: 'hidden',
        },
      }}
    >
      <List dense sx={{ maxHeight: 280, overflowY: 'auto', p: 0 }}>
        {loading && (
          <ListItem>
            <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          </ListItem>
        )}
        {!loading && options.length === 0 && (
          <ListItem>
            <ListItemText primary="No matches" sx={{ color: 'text.secondary' }} />
          </ListItem>
        )}
        {!loading &&
          options.map((opt) => (
            <ListItem
              key={opt.id}
              button
              onClick={() => onSelect(opt)}
              sx={{
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <ListItemAvatar>
                <Avatar
                  src={opt.avatarUrl}
                  sx={{ width: 32, height: 32 }}
                >
                  {opt.username[0]?.toUpperCase() || '?'}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={`@${opt.username}`}
                secondary={opt.label}
                primaryTypographyProps={{
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
                secondaryTypographyProps={{
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                }}
              />
            </ListItem>
          ))}
      </List>
    </Popover>
  );
};

