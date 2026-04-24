/**
 * Inbox Search Bar Component
 * 
 * Search input with autocomplete suggestions for email inbox
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  TextField,
  InputAdornment,
  IconButton,
  Box,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Divider,
  SxProps,
  Theme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import EmailIcon from '@mui/icons-material/Email';
import PersonIcon from '@mui/icons-material/Person';

interface SearchSuggestion {
  type: 'recent' | 'thread' | 'sender';
  text: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

/**
 * Compact preset sx for the InboxSearchBar wrapper. Use as
 * `<InboxSearchBar sx={compactInboxSearchBarSx} ... />` to render the
 * search bar at the same scale as the small icon controls used in
 * record-page toolbars (32px high, ~240px wide, pill outline).
 */
export const compactInboxSearchBarSx: SxProps<Theme> = {
  width: { xs: '100%', sm: 240 },
  minWidth: { xs: 'auto', sm: 220 },
  maxWidth: { xs: '100%', sm: 260 },
  '& .MuiOutlinedInput-root': {
    borderRadius: '999px',
    height: 32,
    fontSize: '13px',
    backgroundColor: 'background.paper',
  },
  '& .MuiOutlinedInput-input': {
    py: 0,
    fontSize: '13px',
  },
  '& .MuiInputAdornment-root': {
    marginRight: 0.25,
  },
};

interface InboxSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  suggestions?: SearchSuggestion[];
  placeholder?: string;
  disabled?: boolean;
  /**
   * Optional sx overrides applied to the search bar's outer wrapper.
   * Useful for callers that want to constrain the width / min-width of
   * the search input (the default sizing is tuned for the email inbox).
   */
  sx?: SxProps<Theme>;
}

const InboxSearchBar: React.FC<InboxSearchBarProps> = ({
  value,
  onChange,
  onSearch,
  suggestions = [],
  placeholder = 'Search emails...',
  disabled = false,
  sx,
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSuggestions]);

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    // Show suggestions after 2+ characters
    setShowSuggestions(newValue.length >= 2 && suggestions.length > 0);
  };

  const handleClear = () => {
    onChange('');
    setShowSuggestions(false);
    onSearch(''); // Clear the search state
    inputRef.current?.focus();
  };

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    onChange(suggestion.text);
    setShowSuggestions(false);
    onSearch(suggestion.text);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSearch(value);
      setShowSuggestions(false);
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    setFocused(true);
    if (value.length >= 2 && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    // Delay hiding suggestions to allow clicking on them
    setTimeout(() => setShowSuggestions(false), 200);
  };

  // Group suggestions by type
  const recentSearches = suggestions.filter(s => s.type === 'recent');
  const threadSuggestions = suggestions.filter(s => s.type === 'thread');
  const senderSuggestions = suggestions.filter(s => s.type === 'sender');

  // Detect OS for keyboard shortcut display
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutKey = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <Box
      ref={containerRef}
      sx={[
        { position: 'relative', width: '100%', maxWidth: { xs: '100%', sm: 420 }, minWidth: { xs: 'auto', sm: 380 } },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <TextField
        inputRef={inputRef}
        fullWidth
        size="small"
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '24px',
            backgroundColor: 'background.paper',
            boxShadow: focused ? '0 2px 8px rgba(0, 0, 0, 0.1)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
            transition: 'all 0.2s ease',
            '& fieldset': {
              borderColor: focused ? 'primary.main' : 'transparent',
              borderWidth: focused ? 1 : 0,
            },
            '&:hover fieldset': {
              borderColor: 'primary.main',
              borderWidth: 1,
            },
            '&.Mui-focused fieldset': {
              borderColor: 'primary.main',
              borderWidth: 1,
            },
          },
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={handleClear}
                sx={{ p: 0.5 }}
                aria-label="Clear search"
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : !focused && !value ? (
            <InputAdornment position="end">
              <Typography
                variant="caption"
                sx={{
                  color: 'text.disabled',
                  fontSize: '0.7rem',
                  fontFamily: 'monospace',
                  px: 1,
                  py: 0.5,
                  bgcolor: 'rgba(0, 0, 0, 0.04)',
                  borderRadius: 1,
                }}
              >
                {shortcutKey}
              </Typography>
            </InputAdornment>
          ) : null,
        }}
      />

      {/* Suggestions Dropdown */}
      {showSuggestions && (suggestions.length > 0 || recentSearches.length > 0) && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            maxHeight: 400,
            overflow: 'auto',
            zIndex: 1300,
            borderRadius: 2,
          }}
        >
          <List dense sx={{ py: 0.5 }}>
            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <>
                <ListItem sx={{ py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Recent Searches
                  </Typography>
                </ListItem>
                {recentSearches.map((suggestion, index) => (
                  <ListItem key={`recent-${index}`} disablePadding>
                    <ListItemButton onClick={() => handleSuggestionClick(suggestion)}>
                      <ListItemText
                        primary={suggestion.text}
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
                {(threadSuggestions.length > 0 || senderSuggestions.length > 0) && (
                  <Divider sx={{ my: 0.5 }} />
                )}
              </>
            )}

            {/* Matching Threads */}
            {threadSuggestions.length > 0 && (
              <>
                <ListItem sx={{ py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Matching Threads
                  </Typography>
                </ListItem>
                {threadSuggestions.slice(0, 5).map((suggestion, index) => (
                  <ListItem key={`thread-${index}`} disablePadding>
                    <ListItemButton onClick={() => handleSuggestionClick(suggestion)}>
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                        <EmailIcon fontSize="small" color="action" />
                      </Box>
                      <ListItemText
                        primary={suggestion.text}
                        secondary={suggestion.subtitle}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
                {senderSuggestions.length > 0 && <Divider sx={{ my: 0.5 }} />}
              </>
            )}

            {/* Matching Senders */}
            {senderSuggestions.length > 0 && (
              <>
                <ListItem sx={{ py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Matching Senders
                  </Typography>
                </ListItem>
                {senderSuggestions.slice(0, 3).map((suggestion, index) => (
                  <ListItem key={`sender-${index}`} disablePadding>
                    <ListItemButton onClick={() => handleSuggestionClick(suggestion)}>
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                        <PersonIcon fontSize="small" color="action" />
                      </Box>
                      <ListItemText
                        primary={suggestion.text}
                        secondary={suggestion.subtitle}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </>
            )}
          </List>
        </Paper>
      )}
    </Box>
  );
};

export default InboxSearchBar;

