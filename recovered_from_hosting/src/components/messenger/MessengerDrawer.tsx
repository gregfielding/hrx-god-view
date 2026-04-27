/**
 * Messenger Drawer Component
 * 
 * Main drawer container for the Direct Messenger feature.
 * Contains tabs for Threads and People, and manages the conversation view.
 * 
 * Phase 4: Drawer shell with header, tabs, and content scaffold.
 */

import React, { useEffect, useRef } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Tabs,
  Tab,
  TextField,
  InputAdornment,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useDirectMessenger } from '../../contexts/DirectMessengerContext';
import ThreadsList from './ThreadsList';
import PeopleList from './PeopleList';
import ConversationView from './ConversationView';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface MessengerDrawerProps {
  // Props will be managed by context, but we can accept overrides if needed
}

const MessengerDrawer: React.FC<MessengerDrawerProps> = () => {
  const {
    isOpen,
    pane,
    closeMessenger,
    setPane,
    activeThreadId,
    setActiveThreadId,
    mode,
    setMode,
  } = useDirectMessenger();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  const drawerRef = useRef<HTMLDivElement>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC closes drawer
      if (e.key === 'Escape' && isOpen) {
        closeMessenger();
      }
      // CMD+J / CTRL+J toggles drawer
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        if (isOpen) {
          closeMessenger();
        }
        // Opening is handled by the icon button
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeMessenger]);

  // Focus management: focus search box or first interactive element when drawer opens
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      // Small delay to ensure drawer is fully rendered
      setTimeout(() => {
        const searchInput = drawerRef.current?.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }, 100);
    }
  }, [isOpen]);

  const [searchQuery, setSearchQuery] = React.useState('');

  const handleTabChange = (_event: React.SyntheticEvent, newValue: 'threads' | 'people') => {
    setPane(newValue);
    setSearchQuery(''); // Clear search when switching tabs
  };

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={isOpen}
      onClose={closeMessenger}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '800px' }, // Wider for split view
          minWidth: { xs: '100%', md: '800px' },
          maxWidth: { xs: '100%', md: '800px' },
          height: { xs: '82vh', md: '100vh' },
          maxHeight: { xs: '82vh', md: '100vh' },
          borderRadius: { xs: '24px 24px 0 0', md: 0 },
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          '&:hover': {
            width: { xs: '100%', md: '800px' },
            minWidth: { xs: '100%', md: '800px' },
            maxWidth: { xs: '100%', md: '800px' },
          },
        },
      }}
      ModalProps={{
        keepMounted: true,
      }}
    >
      <Box
        ref={drawerRef}
        role="dialog"
        aria-label="Direct messages"
        sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 1.75,
            borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
            backgroundColor: '#FFFFFF',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '999px',
                background: 'rgba(0, 87, 184, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: '#0057B8' }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Messages
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                Chat with coworkers in real time
              </Typography>
            </Box>
          </Box>

          <IconButton
            aria-label="Close direct messages"
            size="small"
            onClick={closeMessenger}
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Search Bar and Tabs (only for mobile list mode) */}
        {isMobile && mode === 'list' && (
          <>
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                backgroundColor: '#FFFFFF',
                flexShrink: 0,
              }}
            >
              <TextField
                fullWidth
                size="small"
                placeholder={pane === 'threads' ? 'Search conversations...' : 'Search coworkers...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                    backgroundColor: 'grey.50',
                  },
                }}
              />
            </Box>

            {/* Tabs for mobile */}
            <Box
              sx={{
                borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                flexShrink: 0,
                backgroundColor: '#FFFFFF',
              }}
            >
              <Tabs
                value={pane}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                  minHeight: 44,
                  '& .MuiTab-root': {
                    textTransform: 'none',
                    fontSize: 13,
                    fontWeight: 500,
                    minHeight: 44,
                  },
                }}
              >
                <Tab label="People" value="people" />
                <Tab label="Threads" value="threads" />
              </Tabs>
            </Box>
          </>
        )}

        {/* Content Area */}
        {isDesktop ? (
          // Desktop: Split view (list on left, conversation on right)
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              backgroundColor: '#F9FAFB',
            }}
          >
            {/* Left: People List */}
            <Box
              sx={{
                width: '40%',
                borderRight: '1px solid rgba(15, 23, 42, 0.06)',
                backgroundColor: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* People Heading */}
              <Box
                sx={{
                  px: 2.5,
                  py: 1.5,
                  borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                  backgroundColor: '#FFFFFF',
                  flexShrink: 0,
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  People
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  minHeight: 0,
                }}
              >
                <PeopleList searchQuery={searchQuery} />
              </Box>
            </Box>

            {/* Right: Threads/Conversation View */}
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#FFFFFF',
              }}
            >
              {/* Threads Heading */}
              <Box
                sx={{
                  px: 2.5,
                  py: 1.5,
                  borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                  backgroundColor: '#FFFFFF',
                  flexShrink: 0,
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  Threads
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {activeThreadId ? (
                  <ConversationView threadId={activeThreadId} />
                ) : (
                  <ThreadsList searchQuery={searchQuery} />
                )}
              </Box>
            </Box>
          </Box>
        ) : (
          // Mobile: Single view (either list or conversation)
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              backgroundColor: '#F9FAFB',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {mode === 'list' ? (
              <Box
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  minHeight: 0,
                }}
              >
                {pane === 'threads' ? (
                  <ThreadsList searchQuery={searchQuery} />
                ) : (
                  <PeopleList searchQuery={searchQuery} />
                )}
              </Box>
            ) : (
              <ConversationView threadId={activeThreadId} />
            )}
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default MessengerDrawer;

