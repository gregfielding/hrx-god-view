/**
 * User Inbox Page
 * 
 * Unified inbox for all users to view their messages (Email, SMS, Push)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  ButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Avatar,
  List,
  ListItem,
  ListItemButton,
  Card,
  CardContent,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import ReplyIcon from '@mui/icons-material/Reply';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import FilterListIcon from '@mui/icons-material/FilterList';
import Checkbox from '@mui/material/Checkbox';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useAuth } from '../contexts/AuthContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import ReplyDrawer from '../components/ReplyDrawer';
import EmailThreadView from '../components/EmailThreadView';
import MessageDrawer from '../components/MessageDrawer';
import InboxFilters, { InboxFilter } from '../components/InboxFilters';
import InboxSearchBar from '../components/InboxSearchBar';
import PageHeader from '../components/PageHeader';
import ContactHoverCard from '../components/ContactHoverCard';
import StandardTablePagination from '../components/StandardTablePagination';
import { collection, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useNavigate } from 'react-router-dom';
// Removed unified inbox imports - inbox is now email-only per decoupling spec

interface MessageLog {
  id: string;
  tenantId: string;
  userId: string;
  threadId?: string;
  messageTypeId: string;
  channel: 'email' | 'sms' | 'push';
  direction: 'inbound' | 'outbound';
  fromIdentity: 'system' | 'recruiter' | 'candidate' | 'ai';
  fromUserId?: string;
  contentSent: string;
  contentOriginal?: string;
  language: 'en' | 'es' | null;
  status: string;
  failureReason?: string;
  providerMessageId?: string;
  createdAt: any;
}

interface SmsThread {
  id: string;
  tenantId: string;
  candidateId: string;
  candidateName: string;
  candidatePhoneMasked: string;
  twilioNumber: string;
  status: string;
  lastMessageAt: any;
  lastMessageSnippet?: string;
}

interface ParticipantContact {
  email: string;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
  userId?: string;
  userName?: string;
  dealIds?: string[];
}

interface EmailThread {
  id: string;
  tenantId: string;
  subject: string;
  participants: string[];
  lastMessageAt: any;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: 'active' | 'archived' | 'deleted';
  starred?: boolean;
  labels?: string[]; // Gmail categories: primary, social, promotions, updates, forums, spam
  participantContacts?: ParticipantContact[]; // Enriched contact information
}

const UserInboxPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  
  // Mobile breakpoint detection (per spec: 0-768px mobile, 769-1024px tablet, >1024px desktop)
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // < 600px (MUI sm breakpoint)
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md')); // 600px - 960px
  const isDesktop = useMediaQuery(theme.breakpoints.up('md')); // >= 960px
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md')); // xs and sm screens (< 960px)
  
  const effectiveTenantId = activeTenant?.id || '';
  const [gmailConnected, setGmailConnected] = useState<boolean>(false);
  const [loadingGmailStatus, setLoadingGmailStatus] = useState(true);
  const [activeTab, setActiveTab] = useState<'email'>('email');
  const [allMessageLogs, setAllMessageLogs] = useState<MessageLog[]>([]);
  const [smsThreads, setSmsThreads] = useState<SmsThread[]>([]);
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  // We intentionally avoid “refresh UI” effects during background inbox sync.
  // New threads should simply appear without fading/spinners.
  const [error, setError] = useState<string | null>(null);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean | null>(null);
  const [availableTwilioNumbers, setAvailableTwilioNumbers] = useState<Array<{ phoneNumber: string; sid: string; friendlyName: string }>>([]);
  const [showNumberSelection, setShowNumberSelection] = useState(false);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [replyDrawerOpen, setReplyDrawerOpen] = useState(false);
  const [selectedThread, setSelectedThread] = useState<SmsThread | null>(null);
  const [emailThreadViewOpen, setEmailThreadViewOpen] = useState(false);
  const [selectedEmailThread, setSelectedEmailThread] = useState<EmailThread | null>(null);
  const [autoOpenReply, setAutoOpenReply] = useState(false);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<MessageLog | null>(null);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  // Filter state - default to 'all' so Inbox shows BOTH read and unread (canonical spec)
  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<EmailThread[]>([]);
  const [isBackendSearch, setIsBackendSearch] = useState(false);
  const [searchTotalCount, setSearchTotalCount] = useState(0);
  const [activeFilters, setActiveFilters] = useState<{
    from?: string;
    to?: string;
    subject?: string;
    isUnread?: boolean;
    isStarred?: boolean;
  }>({});
  
  // Contact hover card state
  const [hoveredContactAnchor, setHoveredContactAnchor] = useState<HTMLElement | null>(null);
  const [hoveredContactThread, setHoveredContactThread] = useState<EmailThread | null>(null);
  const [hoverCardOpen, setHoverCardOpen] = useState(false);
  
  // Safe hover state setter that ignores updates when drawer is open
  const setHoveredThreadIdSafe = (id: string | null) => {
    if (!emailThreadViewOpen) {
      setHoveredThreadId(id);
    }
  };

  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Removed unified inbox - inbox is now email-only per decoupling spec

  // Gmail sync function
  const handleSyncGmail = async (silent = false) => {
    if (!user?.uid || !effectiveTenantId) {
      if (!silent) {
      setError('User or tenant not found');
      }
      return;
    }

    // Prevent multiple simultaneous syncs
    if (syncingGmail) {
      return;
    }

    setSyncingGmail(true);
    if (!silent) {
    setError(null);
    setSyncSuccess(null);
    }

    try {
      const syncGmailEmailsFn = httpsCallable(functions, 'syncGmailEmails');
      const result = await syncGmailEmailsFn({
        userId: user.uid,
        tenantId: effectiveTenantId,
        maxResults: silent ? 500 : 5000, // Smaller batch for automatic syncs, full for manual
      });

      const data = result.data as any;
      
      if (data.error) {
        if (!silent) {
        setError(data.message || 'Failed to sync Gmail emails');
        }
        return;
      }

      const syncedCount = data.syncedCount || data.newEmails || 0;
      
      // Refresh email threads after sync
      if (activeTab === 'email') {
        await loadEmailThreads();
      }

      // Only show success message if not silent and there were new emails
      if (!silent) {
      if (syncedCount > 0) {
        setSyncSuccess(`Successfully synced ${syncedCount} email${syncedCount !== 1 ? 's' : ''} from Gmail`);
        // Clear success message after 5 seconds
        setTimeout(() => {
          setSyncSuccess(null);
        }, 5000);
      } else {
        setSyncSuccess('Sync completed. No new emails found in your Gmail inbox.');
        // Clear message after 3 seconds for "no emails" case
        setTimeout(() => {
          setSyncSuccess(null);
        }, 3000);
        }
      }

    } catch (error: any) {
      console.error('Error syncing Gmail emails:', error);
      if (!silent) {
      setError(`Failed to sync Gmail emails: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setSyncingGmail(false);
    }
  };

  // Reset search state when searchQuery becomes empty
  useEffect(() => {
    if (!searchQuery.trim()) {
      setIsSearching(false);
      setIsBackendSearch(false);
      setSearchResults([]);
      setSearchTotalCount(0);
    }
  }, [searchQuery]);

  // Check Gmail connection status
  useEffect(() => {
    const checkGmailStatus = async () => {
      if (!user?.uid) {
        setGmailConnected(false);
        setLoadingGmailStatus(false);
        return;
      }

      setLoadingGmailStatus(true);
      try {
        // Use force=true to bypass rate limiting and sampling for inbox check
        const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');
        const result = await getGmailStatus({ userId: user.uid, force: true });
        const data = result.data as { 
          connected?: boolean; 
          success?: boolean;
          syncStatus?: string;
          rateLimited?: boolean;
          sampled?: boolean;
        };
        
        // Check if Gmail is actually connected (not rate limited or sampled)
        // If rateLimited or sampled, we should still check if tokens exist
        if (data.rateLimited || data.sampled) {
          // If rate limited or sampled, assume connected if we have tokens
          // This prevents showing "Connect Gmail" when it's actually connected
          // We'll verify by checking if we have email threads or by checking user data directly
          setGmailConnected(true); // Optimistically assume connected to avoid false negatives
        } else {
          setGmailConnected(data.connected || false);
        }
      } catch (err) {
        console.error('Error checking Gmail status:', err);
        // On error, don't assume disconnected - might be a temporary issue
        // Check if user has gmailTokens in Firestore as fallback
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const userData = userDoc.data();
          setGmailConnected(!!userData?.gmailTokens?.access_token);
        } catch (fallbackErr) {
          console.error('Error checking Gmail tokens fallback:', fallbackErr);
          setGmailConnected(false);
        }
      } finally {
        setLoadingGmailStatus(false);
      }
    };

    checkGmailStatus();
  }, [user?.uid]);

  // Twilio number check removed - SMS now has dedicated /text-messages page per decoupling spec

  useEffect(() => {
    if (!user?.uid || !effectiveTenantId) return;

    // Inbox is now email-only per decoupling spec
    if (activeTab === 'email') {
      loadEmailThreads();
    }
  }, [user?.uid, effectiveTenantId, activeTab, activeFilter]);

  // Auto-sync Gmail on page load and periodically while email tab is active
  useEffect(() => {
    if (!user?.uid || !effectiveTenantId || !gmailConnected || activeTab !== 'email') {
      return;
    }

    // Auto-sync on initial load (after a short delay to let page render)
    const initialSyncTimer = setTimeout(() => {
      if (!syncingGmail) {
        handleSyncGmail(true); // Silent sync on page load
      }
    }, 2000); // Wait 2 seconds after page load

    // Set up periodic polling (every 30 seconds)
    const pollingInterval = setInterval(() => {
      if (!syncingGmail && activeTab === 'email' && gmailConnected) {
        handleSyncGmail(true); // Silent sync for polling
      }
    }, 30000); // Poll every 30 seconds

    return () => {
      clearTimeout(initialSyncTimer);
      clearInterval(pollingInterval);
    };
  }, [user?.uid, effectiveTenantId, gmailConnected, activeTab, syncingGmail, handleSyncGmail]);

  // Clear hover state when drawer opens to prevent flickering
  useEffect(() => {
    if (emailThreadViewOpen) {
      setHoveredThreadId(null);
    }
  }, [emailThreadViewOpen]);

  // Reset pagination when tab changes
  useEffect(() => {
    setPage(0);
  }, [activeTab]);

  // Close drawer when entering mobile view (drawer will be converted to bottom sheet later)
  useEffect(() => {
    if (isMobile && emailThreadViewOpen) {
      setEmailThreadViewOpen(false);
      setSelectedEmailThread(null);
    }
  }, [isMobile, emailThreadViewOpen]);

  // Clear search when switching tabs or filters
  useEffect(() => {
    if (isSearching) {
      setSearchQuery('');
      setIsSearching(false);
    }
  }, [activeTab, activeFilter]);

  // Simple text highlighting function with soft blue/gray highlight
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query.trim() || !isSearching) return text;
    
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, index) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark 
              key={index} 
              style={{ 
                backgroundColor: 'rgba(37, 99, 235, 0.15)', // Soft blue with low alpha
                padding: '1px 2px', 
                borderRadius: '3px',
                color: 'inherit', // Keep original text color
              }}
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const loadMessageHistory = async () => {
    if (!user?.uid || !effectiveTenantId) return;

    setLoading(true);
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/getUserMessageHistory?tenantId=${encodeURIComponent(effectiveTenantId)}&userId=${encodeURIComponent(user.uid)}&limit=500`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 503 && errorData.code === 'INDEX_BUILDING') {
          setError('Database index is building. Please try again in a few minutes.');
        } else {
          throw new Error(errorData.error || 'Failed to load message history');
        }
        return;
      }

      const data = await response.json();
      setAllMessageLogs(data.messages || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load message history');
    } finally {
      setLoading(false);
    }
  };

  const loadSmsThreads = async () => {
    if (!user?.uid || !effectiveTenantId) return;

    // Only show full page loading on initial load
    if (smsThreads.length === 0) {
    setLoading(true);
    }
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/listThreadsApi?tenantId=${encodeURIComponent(effectiveTenantId)}&candidateId=${encodeURIComponent(user.uid)}&limit=50`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 503 && errorData.error?.code === 'INDEX_BUILDING') {
          setError('Database index is building. Please try again in a few minutes.');
        } else {
          throw new Error(errorData.error?.message || 'Failed to load SMS threads');
        }
        return;
      }

      const data = await response.json();
      if (data.success) {
        setSmsThreads(data.threads || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load SMS threads');
    } finally {
      setLoading(false);
    }
  };

  const loadEmailThreads = async () => {
    if (!user?.uid || !effectiveTenantId) return;

    // Only show a full-page loader on true first load.
    // For filter changes and background refreshes, we do not show any visual refresh state.
    if (emailThreads.length === 0) setLoading(true);
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      // Build query params based on filter
      const params = new URLSearchParams({
        tenantId: effectiveTenantId,
        userId: user.uid,
        limit: '200',
      });

      if (activeFilter === 'unread') {
        params.append('unreadOnly', 'true');
      } else if (activeFilter === 'all') {
        // 'all' shows all active threads (both read and unread)
        // No additional params needed - API returns all active threads by default
      } else if (activeFilter === 'archived') {
        params.append('status', 'archived');
      } else if (activeFilter === 'trash') {
        params.append('status', 'deleted');
      } else if (activeFilter === 'sent') {
        params.append('sentOnly', 'true');
      } else if (activeFilter === 'starred') {
        // Starred filter will be applied client-side
      } else if (['primary', 'social', 'promotions', 'updates', 'forums', 'spam'].includes(activeFilter)) {
        // Gmail category filters
        params.append('category', activeFilter);
      }

      const response = await fetch(
        `${API_BASE_URL}/listEmailThreadsApi?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error('Failed to load email threads');
      }

      const data = await response.json();
      if (data.success) {
        let threads = data.threads || [];
        
        // Apply starred filter client-side
        if (activeFilter === 'starred') {
          threads = threads.filter((t: EmailThread) => t.starred === true);
        }
        
        // Normalize timestamps (lastMessageAt) to avoid invalid dates
        // Backend now returns ISO strings, but normalize for any edge cases
        threads = threads.map((t: any) => {
          const normalizedDate = normalizeTimestamp(t.lastMessageAt);
          // Store normalized date as Date object or null
          return {
            ...t,
            lastMessageAt: normalizedDate,
          };
        });
        
        setEmailThreads(threads);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load email threads');
    } finally {
      setLoading(false);
    }
  };

  const handleReply = (thread: SmsThread) => {
    setSelectedThread(thread);
    setReplyDrawerOpen(true);
  };

  const handleEmailThreadClick = (thread: EmailThread, event?: React.MouseEvent) => {
    // Don't open thread if clicking on checkbox or action button
    if (event) {
      const target = event.target as HTMLElement;
      if (target.closest('input[type="checkbox"]') || 
          target.closest('button') ||
          target.closest('[role="button"]') ||
          target.closest('.MuiIconButton-root')) {
      return;
      }
    }
    setSelectedEmailThread(thread);
    setHoveredThreadId(null); // Clear hover state to prevent flickering
    setAutoOpenReply(false); // Reset auto-reply flag
    setEmailThreadViewOpen(true);
  };

  const handleReplyToThread = (thread: EmailThread, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedEmailThread(thread);
    setHoveredThreadId(null);
    setAutoOpenReply(true); // Set flag to auto-open reply
    setEmailThreadViewOpen(true);
  };

  const handleArchiveThread = async (threadId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user?.uid || !effectiveTenantId) return;

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/archiveEmailThreadApi/${threadId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId, // Include in body as fallback
            tenantId: effectiveTenantId,
            userId: user.uid,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to archive thread');
      }

      // Reload threads
      loadEmailThreads();
    } catch (err: any) {
      setError(err.message || 'Failed to archive thread');
    }
  };

  const handleStarThread = async (threadId: string, starred: boolean, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!effectiveTenantId) return;

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const url = `${API_BASE_URL}/starEmailThreadApi/${threadId}`;
      console.log('Starring thread:', { threadId, starred, url });

      const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          threadId, // Include in body as fallback
            tenantId: effectiveTenantId,
            starred,
          }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Star thread error:', { status: response.status, errorData });
        throw new Error(errorData.error?.message || 'Failed to star thread');
      }

      const result = await response.json();
      console.log('Star thread success:', result);

      // Update local state
      setEmailThreads(prev => prev.map(t => 
        t.id === threadId ? { ...t, starred } : t
      ));
    } catch (err: any) {
      console.error('Star thread exception:', err);
      setError(err.message || 'Failed to star thread');
    }
  };

  const handleMarkAsRead = async (threadId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user?.uid || !effectiveTenantId) return;

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${threadId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: effectiveTenantId,
            userId: user.uid,
            read: true,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to mark as read');
      }

      // Reload threads
      loadEmailThreads();
    } catch (err: any) {
      setError(err.message || 'Failed to mark as read');
    }
  };

  const handleDeleteThread = async (threadId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user?.uid || !effectiveTenantId) return;

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/updateEmailThreadApi?threadId=${threadId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: effectiveTenantId,
            userId: user.uid,
            status: 'deleted',
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete thread');
      }

      // Reload threads
      loadEmailThreads();
    } catch (err: any) {
      setError(err.message || 'Failed to delete thread');
    }
  };

  const handleBulkArchive = async () => {
    if (selectedThreadIds.size === 0 || !user?.uid || !effectiveTenantId) return;

    setBulkActionLoading(true);
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/bulkUpdateEmailThreadsApi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadIds: Array.from(selectedThreadIds),
            tenantId: effectiveTenantId,
            userId: user.uid,
            updates: { status: 'archived' },
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to archive threads');
      }

      setSelectedThreadIds(new Set());
      loadEmailThreads();
    } catch (err: any) {
      setError(err.message || 'Failed to archive threads');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedThreadIds.size === 0 || !user?.uid || !effectiveTenantId) return;

    if (!window.confirm(`Are you sure you want to delete ${selectedThreadIds.size} thread(s)?`)) {
      return;
    }

    setBulkActionLoading(true);
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/bulkUpdateEmailThreadsApi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadIds: Array.from(selectedThreadIds),
            tenantId: effectiveTenantId,
            userId: user.uid,
            updates: { status: 'deleted' },
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete threads');
      }

      setSelectedThreadIds(new Set());
      loadEmailThreads();
    } catch (err: any) {
      setError(err.message || 'Failed to delete threads');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkMarkRead = async () => {
    if (selectedThreadIds.size === 0 || !user?.uid || !effectiveTenantId) return;

    setBulkActionLoading(true);
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/bulkUpdateEmailThreadsApi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadIds: Array.from(selectedThreadIds),
            tenantId: effectiveTenantId,
            userId: user.uid,
            updates: { unreadCount: 0 },
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to mark threads as read');
      }

      // Update local state reactively
      setEmailThreads(prevThreads => 
        prevThreads.map(thread => 
          selectedThreadIds.has(thread.id || '')
            ? { ...thread, unreadCount: 0 }
            : thread
        )
      );

      setSelectedThreadIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Failed to mark threads as read');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkStar = async () => {
    if (selectedThreadIds.size === 0 || !user?.uid || !effectiveTenantId) return;

    // Check if all selected threads are already starred
    const selectedThreads = emailThreads.filter(t => selectedThreadIds.has(t.id || ''));
    const allStarred = selectedThreads.every(t => t.starred);
    const newStarredValue = !allStarred;

    setBulkActionLoading(true);
    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      // Star/unstar each thread individually (bulkUpdateEmailThreadsApi might not support starred)
      const promises = Array.from(selectedThreadIds).map(threadId => 
        fetch(
          `${API_BASE_URL}/starEmailThreadApi`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadId,
              tenantId: effectiveTenantId,
              userId: user.uid,
              starred: newStarredValue,
            }),
          }
        )
      );

      await Promise.all(promises);

      // Update local state reactively
      setEmailThreads(prevThreads => 
        prevThreads.map(thread => 
          selectedThreadIds.has(thread.id || '')
            ? { ...thread, starred: newStarredValue }
            : thread
        )
      );

      setSelectedThreadIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Failed to star/unstar threads');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (!user?.uid || !effectiveTenantId) return;

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      // Get all unread thread IDs
      const unreadThreadIds = filteredEmailThreads
        .filter(thread => thread.unreadCount > 0)
        .map(thread => thread.id)
        .filter((id): id is string => !!id);

      if (unreadThreadIds.length === 0) return;

      // Mark all unread threads as read
      const response = await fetch(
        `${API_BASE_URL}/bulkUpdateEmailThreadsApi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadIds: unreadThreadIds,
            tenantId: effectiveTenantId,
            userId: user.uid,
            updates: { unreadCount: 0 },
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to mark all as read');
      }

      // Update local state reactively
      setEmailThreads(prevThreads => 
        prevThreads.map(thread => 
          unreadThreadIds.includes(thread.id || '')
            ? { ...thread, unreadCount: 0 }
            : thread
        )
      );
    } catch (err: any) {
      setError(err.message || 'Failed to mark all as read');
    }
  };

  // Update a thread's read status in local state (reactive, no reload)
  const updateThreadReadStatus = (threadId: string, unreadCount: number) => {
    setEmailThreads(prevThreads => 
      prevThreads.map(thread => 
        thread.id === threadId 
          ? { ...thread, unreadCount }
          : thread
      )
    );
  };

  const handleToggleSelect = (threadId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedThreadIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    // Only select/deselect visible threads on current page
    const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    const currentVisibleThreadIds = new Set(currentVisibleThreads.map(t => t.id || '').filter(Boolean));
    const allCurrentVisibleSelected = currentVisibleThreadIds.size > 0 && Array.from(currentVisibleThreadIds).every(id => selectedThreadIds.has(id));
    
    if (allCurrentVisibleSelected) {
      // Deselect all visible threads
      setSelectedThreadIds(prev => {
        const newSet = new Set(prev);
        currentVisibleThreadIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      // Select all visible threads
      setSelectedThreadIds(prev => {
        const newSet = new Set(prev);
        currentVisibleThreadIds.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  };

  const handleSelectAllEmails = () => {
    // Select all filtered threads (all emails, not just visible)
    if (selectedThreadIds.size === filteredEmailThreads.length) {
      setSelectedThreadIds(new Set());
    } else {
      setSelectedThreadIds(new Set(filteredEmailThreads.map(t => t.id).filter(Boolean)));
    }
  };

  // Handle Gmail connection
  const handleConnectGmail = async () => {
    if (!user?.uid || !effectiveTenantId) return;
    
    try {
      const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
      const result = await getGmailAuthUrlFn({ 
        userId: user.uid,
        tenantId: effectiveTenantId 
      });
      
      const data = result.data as any;
      if (data.error) {
        setError(`Failed to connect Gmail: ${data.message}`);
        return;
      }
      
      const { authUrl } = data;
      if (!authUrl) {
        setError('No authentication URL received from server');
        return;
      }
      
      // Open Google OAuth URL in new window
      window.open(authUrl, '_blank', 'width=600,height=600');
    } catch (error: any) {
      console.error('Error connecting Gmail:', error);
      setError(`Failed to connect Gmail: ${error.message}`);
    }
  };

  // Handle Twilio number assignment
  const handleAssignTwilioNumber = async (twilioNumberSid: string) => {
    if (!user?.uid || !effectiveTenantId) return;
    
    try {
      const assignRecruiterNumberFn = httpsCallable(functions, 'assignRecruiterNumber');
      const result = await assignRecruiterNumberFn({
        tenantId: effectiveTenantId,
        recruiterId: user.uid,
        twilioNumberSid,
      });
      
      const data = result.data as { success: boolean; error?: string };
      if (data.success) {
        setHasTwilioNumber(true);
        setShowNumberSelection(false);
        setSyncSuccess('Twilio number assigned successfully');
        setTimeout(() => setSyncSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to assign Twilio number');
      }
    } catch (error: any) {
      console.error('Error assigning Twilio number:', error);
      setError(`Failed to assign Twilio number: ${error.message}`);
    }
  };

  // Helper function to get primary contact for a thread
  const getPrimaryContact = (thread: EmailThread): ParticipantContact | null => {
    if (!thread.participantContacts || thread.participantContacts.length === 0) {
      return null;
    }
    
    // Find the first participant that's not the current user
    const otherParticipant = thread.participants.find(p => {
      const normalizedP = p.toLowerCase().trim();
      const normalizedUserEmail = user?.email?.toLowerCase().trim();
      return normalizedP !== normalizedUserEmail;
    }) || thread.participants[0];
    
    if (!otherParticipant) return null;
    
    // Find matching contact
    const normalizedOther = otherParticipant.toLowerCase().trim();
    return thread.participantContacts.find(pc => {
      const normalizedEmail = pc.email.toLowerCase().trim();
      // Also check if email is in the participant string (might be "Name <email>")
      return normalizedEmail === normalizedOther || otherParticipant.toLowerCase().includes(normalizedEmail);
    }) || null;
  };

  // Helper function to get display name for a thread
  const getDisplayName = (thread: EmailThread): string => {
    const contact = getPrimaryContact(thread);
    if (contact) {
      // Prefer contactName or userName
      if (contact.contactName) return contact.contactName;
      if (contact.userName) return contact.userName;
    }
    
    // Fallback to formatSenderName
    const email = thread.participants.find(p => p !== user?.email) || thread.participants[0] || 'Unknown';
    return formatSenderName(email);
  };

  // Helper function to get company name for a thread
  const getCompanyName = (thread: EmailThread): string | null => {
    const contact = getPrimaryContact(thread);
    return contact?.companyName || null;
  };

  // Helper function to get email address for a thread
  const getEmailAddress = (thread: EmailThread): string => {
    const contact = getPrimaryContact(thread);
    if (contact?.email) {
      return contact.email;
    }
    
    // Fallback to participant email
    if (!thread.participants || thread.participants.length === 0) {
      return 'Unknown';
    }
    const email = thread.participants.find(p => p !== user?.email) || thread.participants[0] || 'Unknown';
    // Extract email from "Name <email>" format if needed
    const emailMatch = email.match(/<(.+?)>/);
    return emailMatch ? emailMatch[1] : email;
  };

  // Helper function to get entity type for badges
  const getEntityType = (thread: EmailThread): 'user' | 'crm_contact' | 'both' | null => {
    const contact = getPrimaryContact(thread);
    if (!contact) return null;
    
    const hasUser = !!contact.userId;
    const hasContact = !!contact.contactId;
    
    if (hasUser && hasContact) return 'both';
    if (hasUser) return 'user';
    if (hasContact) return 'crm_contact';
    return null;
  };

  // Parse search query to extract filters
  const parseSearchQuery = (query: string): { text: string; filters: typeof activeFilters } => {
    const filters: typeof activeFilters = {};
    let text = query;

    // Extract from:email@example.com
    const fromMatch = text.match(/\bfrom:([^\s]+)/i);
    if (fromMatch) {
      filters.from = fromMatch[1];
      text = text.replace(/\bfrom:[^\s]+\s*/gi, '').trim();
    }

    // Extract to:email@example.com
    const toMatch = text.match(/\bto:([^\s]+)/i);
    if (toMatch) {
      filters.to = toMatch[1];
      text = text.replace(/\bto:[^\s]+\s*/gi, '').trim();
    }

    // Extract subject:keyword
    const subjectMatch = text.match(/\bsubject:([^\s]+)/i);
    if (subjectMatch) {
      filters.subject = subjectMatch[1];
      text = text.replace(/\bsubject:[^\s]+\s*/gi, '').trim();
    }

    // Extract is:unread
    if (/\bis:unread\b/i.test(text)) {
      filters.isUnread = true;
      text = text.replace(/\bis:unread\b/gi, '').trim();
    }

    // Extract is:starred
    if (/\bis:starred\b/i.test(text)) {
      filters.isStarred = true;
      text = text.replace(/\bis:starred\b/gi, '').trim();
    }

    return { text: text.trim(), filters };
  };

  // Helper function to format sender name from email
  const formatSenderName = (email: string): string => {
    if (!email) return 'Unknown';
    
    // Extract display name if available: "Name <email@domain.com>"
    const nameMatch = email.match(/^(.+?)\s*</);
    if (nameMatch) {
      return nameMatch[1];
    }
    
    // Otherwise use email username, but clean it up
    const username = email.split('@')[0];
    
    // If it's a long system-generated name, truncate
    if (username.length > 20) {
      return username.substring(0, 18) + '...';
    }
    
    // Capitalize first letter if it's lowercase
    return username.charAt(0).toUpperCase() + username.slice(1);
  };

  // Search filtering function
  const matchesSearch = (thread: EmailThread, query: string): boolean => {
    if (!query.trim()) return true;
    
    const searchLower = query.toLowerCase().trim();
    
    // Search in subject
    if (thread.subject?.toLowerCase().includes(searchLower)) return true;
    
    // Search in sender/participants
    const senderMatch = thread.participants?.some(p => {
      const emailLower = p.toLowerCase();
      const nameMatch = formatSenderName(p).toLowerCase().includes(searchLower);
      return emailLower.includes(searchLower) || nameMatch;
    });
    if (senderMatch) return true;
    
    // Search in snippet/preview
    if (thread.lastMessageSnippet?.toLowerCase().includes(searchLower)) return true;
    
    return false;
  };

  // Generate search suggestions from threads
  const generateSearchSuggestions = (query: string) => {
    if (!query || query.length < 2) return [];
    
    const queryLower = query.toLowerCase();
    const suggestions: Array<{
      type: 'recent' | 'thread' | 'sender';
      text: string;
      subtitle?: string;
    }> = [];
    
    // Get unique senders matching query
    const matchingSenders = new Set<string>();
    emailThreads.forEach(thread => {
      thread.participants?.forEach(participant => {
        const senderName = formatSenderName(participant);
        const email = participant.toLowerCase();
        if (
          senderName.toLowerCase().includes(queryLower) ||
          email.includes(queryLower)
        ) {
          matchingSenders.add(`${senderName} <${participant}>`);
        }
      });
    });
    
    // Add sender suggestions (limit to 3)
    Array.from(matchingSenders).slice(0, 3).forEach(sender => {
      suggestions.push({
        type: 'sender',
        text: sender,
      });
    });
    
    // Add thread suggestions (limit to 5)
    emailThreads
      .filter(thread => matchesSearch(thread, query))
      .slice(0, 5)
      .forEach(thread => {
        const sender = formatSenderName(
          thread.participants?.find(p => p !== user?.email) || 
          thread.participants?.[0] || 
          'Unknown'
        );
        suggestions.push({
          type: 'thread',
          text: thread.subject,
          subtitle: sender,
        });
      });
    
    return suggestions;
  };

  // Use search results if backend search is active, otherwise use normal threads
  const threadsToFilter = isBackendSearch ? searchResults : emailThreads;

  // Filter threads based on active filter (for client-side filtering like starred)
  const filteredEmailThreads = threadsToFilter.filter(thread => {
    // If using backend search, don't apply client-side search filter (already filtered)
    if (isBackendSearch) {
      // Backend search already filtered, just apply other filters
    } else if (isSearching && searchQuery.trim()) {
      // Client-side search filter
      if (!matchesSearch(thread, searchQuery)) return false;
    }
    
    // Apply unread-only toggle if active (this is the header toggle button)
    if (showUnreadOnly && thread.unreadCount === 0) return false;
    
    // Apply category/system filters
    if (activeFilter === 'starred' && !thread.starred) return false;
    // Unread filter shows only unread threads. Inbox (all) shows read + unread.
    if (activeFilter === 'unread') {
      if (!thread.unreadCount || thread.unreadCount === 0) return false;
    }
    
    // Apply Gmail category filters
    if (['primary', 'social', 'promotions', 'updates', 'forums', 'spam'].includes(activeFilter)) {
      const threadCategories = thread.labels || [];
      // If thread has no labels, default to 'primary' (Gmail's default category)
      // This handles threads created before category extraction was added
      if (threadCategories.length === 0 && activeFilter === 'primary') {
        return true; // Show uncategorized threads in Primary
      }
      if (!threadCategories.includes(activeFilter)) return false;
    }
    
    return true;
  });

  // Backend search function
  const performBackendSearch = async (query: string) => {
    if (!user?.uid || !effectiveTenantId || !query.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
        'https://us-central1-hrx1-d3beb.cloudfunctions.net';

      const response = await fetch(
        `${API_BASE_URL}/searchEmailThreadsApi?tenantId=${encodeURIComponent(effectiveTenantId)}&userId=${encodeURIComponent(user.uid)}&query=${encodeURIComponent(query)}&limit=200`
      );

      if (!response.ok) {
        throw new Error('Failed to search email threads');
      }

      const data = await response.json();
      if (data.success) {
        let threads = data.threads || [];
        
        // Normalize timestamps
        threads = threads.map((t: any) => {
          const normalizedDate = normalizeTimestamp(t.lastMessageAt);
          return {
            ...t,
            lastMessageAt: normalizedDate,
          };
        });
        
        setSearchResults(threads);
        setSearchTotalCount(data.totalCount || threads.length);
        setIsBackendSearch(true);
        setPage(0);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search email threads');
      // Fallback to client-side search on error
      setIsBackendSearch(false);
    } finally {
      setLoading(false);
    }
  };

  // Handle search
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    const hasQuery = query.trim().length > 0;
    setIsSearching(hasQuery);
    setPage(0);

    // Parse filters from query
    const { text, filters } = parseSearchQuery(query);
    setActiveFilters(filters);

    // Use backend search for better results (searches all threads, not just loaded ones)
    if (hasQuery) {
      await performBackendSearch(query);
    } else {
      // Clear search state and reload normal threads
      setIsBackendSearch(false);
      setSearchResults([]);
      setSearchTotalCount(0);
      setActiveFilters({});
      loadEmailThreads(); // Reload normal inbox
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchQuery('');
    setIsSearching(false);
    setIsBackendSearch(false);
    setSearchResults([]);
    setSearchTotalCount(0);
    setActiveFilters({});
    setPage(0);
    // Reload normal threads
    loadEmailThreads();
  };

  // Remove a specific filter
  const handleRemoveFilter = (filterKey: keyof typeof activeFilters) => {
    const newFilters = { ...activeFilters };
    delete newFilters[filterKey];
    setActiveFilters(newFilters);

    // Rebuild query without the removed filter
    const parts: string[] = [];
    if (newFilters.from) parts.push(`from:${newFilters.from}`);
    if (newFilters.to) parts.push(`to:${newFilters.to}`);
    if (newFilters.subject) parts.push(`subject:${newFilters.subject}`);
    if (newFilters.isUnread) parts.push('is:unread');
    if (newFilters.isStarred) parts.push('is:starred');
    
    const { text } = parseSearchQuery(searchQuery);
    const newQuery = text ? [...parts, text].join(' ') : parts.join(' ');
    
    setSearchQuery(newQuery);
    if (newQuery.trim()) {
      handleSearch(newQuery);
    } else {
      handleClearSearch();
    }
  };

  // Calculate counts for filter badges
  // Sum up total unread messages across all threads (not just count threads)
  const unreadCount = emailThreads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0);
  const starredCount = emailThreads.filter(t => t.starred).length;

  const handleMessageClick = (log: MessageLog) => {
    setSelectedMessage(log);
    setMessageModalOpen(true);
  };

  const normalizeTimestamp = (value: any): Date | null => {
    if (!value) return null;
    try {
      // Firestore Timestamp object (has toDate method)
      if (value && typeof value.toDate === 'function') {
        return value.toDate();
      }
      
      // Already a Date object
      if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
      }
      
      // ISO string or timestamp number
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      
      // Firestore serialized format: { _seconds: number, _nanoseconds: number }
      // or { seconds: number, nanoseconds: number }
      const seconds = value._seconds ?? value.seconds;
      const nanos = value._nanoseconds ?? value.nanoseconds ?? 0;
      if (seconds !== undefined && typeof seconds === 'number') {
        const timestamp = seconds * 1000 + Math.floor(nanos / 1e6);
        const d = new Date(timestamp);
        return isNaN(d.getTime()) ? null : d;
      }
      
      // Try to parse as ISO string if it's an object with a string property
      if (typeof value === 'object' && value !== null) {
        // Check for common date string properties
        const dateStr = value.toISOString?.() || value.toString?.();
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) return d;
        }
      }
      
      return null;
    } catch {
      return null;
    }
  };

  const formatDate = (date: any): string => {
    const d = date instanceof Date ? date : normalizeTimestamp(date);
    if (!d || isNaN(d.getTime())) return 'N/A';
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    if (dateOnly.getTime() === today.getTime()) {
      return `Today — ${timeStr}`;
    } else if (dateOnly.getTime() === yesterday.getTime()) {
      // Return string - styling will be handled in the Typography component
      return `Yesterday — ${timeStr}`;
    } else if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
      // Within last week
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } else if (now.getFullYear() === d.getFullYear()) {
      // This year
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      // Older
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
  };

  const sanitizeSnippet = (text?: string): string => {
    if (!text) return 'No preview';
    
    // Create a temporary DOM element to decode HTML entities
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = text;
    let cleaned = tempDiv.textContent || tempDiv.innerText || text;
    
    // Strip HTML tags (more aggressive - handle style/script tags)
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    
    // Strip hidden content patterns
    cleaned = cleaned.replace(/display:\s*none/gi, '');
    cleaned = cleaned.replace(/visibility:\s*hidden/gi, '');
    
    // Strip markdown links [text](url) -> text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // Strip markdown images ![alt](url)
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
    
    // Strip markdown bold/italic **text** or *text*
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    
    // Strip markdown headers # ## ###
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
    
    // Strip URLs (optional - keeps text cleaner)
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    
    // Normalize whitespace - collapse multiple spaces/newlines to single space
    cleaned = cleaned.replace(/[\s\n\r\t]+/g, ' ').trim();
    
    // Limit length to 1 line (120 chars)
    if (cleaned.length > 120) {
      cleaned = cleaned.substring(0, 120) + '...';
    }
    
    return cleaned || 'No preview';
  };

  const getInitials = (email: string): string => {
    if (!email) return '?';
    // Extract name from email if it's in format "Name <email@domain.com>"
    const nameMatch = email.match(/^(.+?)\s*</);
    if (nameMatch) {
      const name = nameMatch[1];
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    // Otherwise use first two characters of email
    const cleanEmail = email.split('@')[0];
    return cleanEmail.substring(0, 2).toUpperCase();
  };

  const getAvatarColor = (email: string, isUnread: boolean): string => {
    // Generate consistent color based on email
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Use a muted color palette (lower saturation)
    const hue = Math.abs(hash) % 360;
    const saturation = isUnread ? 45 : 30; // Lower saturation
    const lightness = isUnread ? 55 : 50;
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return <EmailIcon fontSize="small" />;
      case 'sms':
        return <SmsIcon fontSize="small" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string): 'default' | 'success' | 'error' | 'warning' => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return 'success';
      case 'failed':
      case 'bounced':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getMessageContent = (log: MessageLog): string => {
    // Prefer contentOriginal, fallback to contentSent
    const content = log.contentOriginal || log.contentSent || '';
    
    // Handle placeholder messages
    if (content.startsWith('Message: ')) {
      return content;
    }
    
    return content;
  };

  const getMessageSubject = (log: MessageLog): string => {
    const content = log.contentOriginal || log.contentSent || '';
    
    // Try to extract subject from contentOriginal (format: "Subject: ...\n\n...")
    if (content.includes('Subject: ')) {
      const subjectMatch = content.match(/Subject: ([^\n]+)/);
      if (subjectMatch) {
        return subjectMatch[1];
      }
    }
    
    return '';
  };


  // Show loading spinner while initializing
  if (loading && allMessageLogs.length === 0 && smsThreads.length === 0 && emailThreads.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ 
      p: 0, 
      display: 'flex', 
      flexDirection: 'column', 
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Page Header with Standardized Layout */}
          {activeTab === 'email' && (
        <PageHeader
          title="Inbox"
          subtitle="View and manage messages from your connected inbox."
          filters={
            <InboxFilters
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              unreadCount={unreadCount}
              starredCount={starredCount}
              showCategories={false}
              orientation="horizontal"
            />
          }
          rightActions={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <InboxSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                suggestions={generateSearchSuggestions(searchQuery)}
                disabled={loading}
              />
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => setMessageDrawerOpen(true)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  px: 2.5,
                  py: 1,
                  height: '40px',
                  fontWeight: 500,
                  fontSize: '14px',
                  bgcolor: '#0057B8',
                  boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                  },
                  whiteSpace: 'nowrap',
                }}
          >
            Compose
          </Button>
        </Box>
          }
        />
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2, mx: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {syncSuccess && (
        <Alert severity="success" sx={{ mb: 2, mx: 2, flexShrink: 0 }} onClose={() => setSyncSuccess(null)}>
          {syncSuccess}
        </Alert>
      )}

      {/* Email Inbox - Email Only (per decoupling spec) */}
      {activeTab === 'email' && (
        <>
          {selectedThreadIds.size > 0 && (
            <Box sx={{ 
              px: 2, 
              py: 1.5, 
              bgcolor: 'action.selected', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1.5,
              flexShrink: 0,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}>
              <Typography variant="body2" sx={{ fontWeight: 500, mr: 1 }}>
                {selectedThreadIds.size} selected
              </Typography>
              {(() => {
                const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                return filteredEmailThreads.length > currentVisibleThreads.length && selectedThreadIds.size < filteredEmailThreads.length;
              })() && (
              <Button
                size="small"
                  variant="outlined"
                  onClick={handleSelectAllEmails}
                  sx={{ textTransform: 'none', mr: 1 }}
                >
                  Select All {filteredEmailThreads.length}
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArchiveIcon />}
                onClick={handleBulkArchive}
                disabled={bulkActionLoading}
                sx={{ textTransform: 'none' }}
              >
                Archive
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
                sx={{ textTransform: 'none' }}
              >
                Delete
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<StarBorderIcon />}
                onClick={handleBulkStar}
                disabled={bulkActionLoading}
                sx={{ textTransform: 'none' }}
              >
                Star
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MarkEmailReadIcon />}
                onClick={handleBulkMarkRead}
                disabled={bulkActionLoading}
                sx={{ textTransform: 'none' }}
              >
                Mark Read
              </Button>
            </Box>
          )}
          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0, flexDirection: 'column' }}>
            <Box 
              sx={{ 
                flex: 1, 
                overflow: 'hidden', 
                px: isMobile ? 1 : 1,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                width: '100%',
              }}
            >
              {/* Search Results Header */}
              {isSearching && searchQuery.trim() && (
                <Box sx={{ px: 2, py: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: activeFilters && Object.keys(activeFilters).length > 0 ? 1 : 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      Search results for: <strong>"{parseSearchQuery(searchQuery).text || searchQuery}"</strong> • Found {isBackendSearch ? searchTotalCount : filteredEmailThreads.length} thread{(isBackendSearch ? searchTotalCount : filteredEmailThreads.length) !== 1 ? 's' : ''}
                      {isBackendSearch && searchTotalCount > filteredEmailThreads.length && (
                        <span> (showing {filteredEmailThreads.length} of {searchTotalCount})</span>
                      )}
                    </Typography>
                    <Button
                      size="small"
                      onClick={handleClearSearch}
                      sx={{ textTransform: 'none' }}
                    >
                      Clear Search
                    </Button>
                  </Box>
                  
                  {/* Filter Chips */}
                  {activeFilters && Object.keys(activeFilters).length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                      {activeFilters.from && (
                        <Chip
                          label={`From: ${activeFilters.from}`}
                          size="small"
                          onDelete={() => handleRemoveFilter('from')}
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                      {activeFilters.to && (
                        <Chip
                          label={`To: ${activeFilters.to}`}
                          size="small"
                          onDelete={() => handleRemoveFilter('to')}
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                      {activeFilters.subject && (
                        <Chip
                          label={`Subject: ${activeFilters.subject}`}
                          size="small"
                          onDelete={() => handleRemoveFilter('subject')}
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                      {activeFilters.isUnread && (
                        <Chip
                          label="Unread"
                          size="small"
                          onDelete={() => handleRemoveFilter('isUnread')}
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                      {activeFilters.isStarred && (
                        <Chip
                          label="Starred"
                          size="small"
                          onDelete={() => handleRemoveFilter('isStarred')}
                          sx={{ fontSize: '0.75rem' }}
                        />
                      )}
                    </Stack>
                  )}
            </Box>
              )}
              
              {/* Show Connect Gmail button if Gmail is not connected */}
              {activeTab === 'email' && !loadingGmailStatus && !gmailConnected && (
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  py: 8, 
                  px: 4,
                  textAlign: 'center'
                }}>
                  <EmailIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                    Connect Your Gmail Account
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400 }}>
                    Connect your Gmail account to view and manage your emails in the inbox.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<EmailIcon />}
                    onClick={handleConnectGmail}
                    sx={{ textTransform: 'none' }}
                  >
                    Connect Gmail
                  </Button>
                </Box>
              )}
              
              {/* Show email list/table only if Gmail is connected */}
              {activeTab === 'email' && gmailConnected && (
                <>
                  {/* Mobile List View */}
                  {isMobile ? (
                    <Box
                      sx={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        width: '100%',
                        px: 1,
                      }}
                    >
                      {filteredEmailThreads.length === 0 ? (
                        <Box sx={{ py: 8, textAlign: 'center' }}>
                          <Stack spacing={2} alignItems="center">
                            {isSearching && searchQuery.trim() ? (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  🔍 No results found
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, px: 2 }}>
                                  No emails match your search for <strong>"{searchQuery}"</strong>
                                </Typography>
                                <Button
                                  variant="outlined"
                                  onClick={handleClearSearch}
                                  sx={{ mt: 2, textTransform: 'none' }}
                                >
                                  Clear Search
                                </Button>
                              </>
                            ) : ['primary', 'social', 'promotions', 'updates', 'forums', 'spam'].includes(activeFilter) ? (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  No emails in this category
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, px: 2 }}>
                                  {emailThreads.length === 0 
                                    ? 'Your inbox is empty. Emails will sync automatically.'
                                    : 'Emails may not be categorized yet. Categories will update automatically as emails sync.'}
                                </Typography>
                              </>
                            ) : (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  🎉 Your inbox is clear
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, px: 2 }}>
                                  Keep an eye here for candidate + client activity.
                                </Typography>
                                <Button
                                  variant="contained"
                                  startIcon={<EditIcon />}
                                  onClick={() => setMessageDrawerOpen(true)}
                                  sx={{ mt: 2, textTransform: 'none' }}
                                >
                                  Compose
                                </Button>
                              </>
                            )}
                          </Stack>
                        </Box>
                      ) : (
                        <>
                          {/* Mobile Table Header */}
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              px: 1.5,
                              py: 1,
                              borderBottom: '1px solid rgba(0,0,0,0.06)',
                              backgroundColor: 'background.paper',
                              position: 'sticky',
                              top: 0,
                              zIndex: 10,
                            }}
                          >
                            <Box sx={{ width: '32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Checkbox
                                indeterminate={(() => {
                                  const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                                  const currentVisibleThreadIds = new Set(currentVisibleThreads.map(t => t.id || '').filter(Boolean));
                                  const allCurrentVisibleSelected = currentVisibleThreadIds.size > 0 && Array.from(currentVisibleThreadIds).every(id => selectedThreadIds.has(id));
                                  return selectedThreadIds.size > 0 && !allCurrentVisibleSelected && selectedThreadIds.size < currentVisibleThreadIds.size;
                                })()}
                                checked={(() => {
                                  const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                                  const currentVisibleThreadIds = new Set(currentVisibleThreads.map(t => t.id || '').filter(Boolean));
                                  return currentVisibleThreadIds.size > 0 && Array.from(currentVisibleThreadIds).every(id => selectedThreadIds.has(id));
                                })()}
                          onChange={handleSelectAll}
                                size="small"
                                sx={{ 
                                  padding: '4px',
                                  '& .MuiSvgIcon-root': { 
                                    fontSize: '18px',
                                  } 
                                }}
                              />
                            </Box>
                            <Box sx={{ width: '40px', flexShrink: 0, mr: 1.5 }} /> {/* Avatar space */}
                            <Typography
                              variant="caption"
                              sx={{
                                flex: 1,
                                fontSize: '11px',
                                fontWeight: 500,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: 'rgba(0, 0, 0, 0.85)',
                              }}
                            >
                              From
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                flex: 2,
                                fontSize: '11px',
                                fontWeight: 500,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: 'rgba(0, 0, 0, 0.85)',
                                ml: 1,
                              }}
                            >
                              Subject
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                width: '80px',
                                flexShrink: 0,
                                fontSize: '11px',
                                fontWeight: 500,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: 'rgba(0, 0, 0, 0.85)',
                                textAlign: 'right',
                                ml: 1,
                              }}
                            >
                              Date
                            </Typography>
                          </Box>
                          <List sx={{ py: 0 }}>
                            {filteredEmailThreads
                              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                              .map((thread) => {
                              const displayName = getDisplayName(thread);
                              const emailAddress = getEmailAddress(thread);
                              const companyName = getCompanyName(thread);
                              const previewText = thread.lastMessageSnippet || '';
                              const truncatedPreview = previewText.length > 80 ? previewText.substring(0, 80) + '...' : previewText;
                              
                              return (
                                <ListItem
                                  key={thread.id}
                                  disablePadding
                                  sx={{
                                    borderBottom: '1px solid',
                                    borderColor: 'rgba(0, 0, 0, 0.06)',
                                    bgcolor: selectedThreadIds.has(thread.id) 
                                      ? 'rgba(0, 87, 184, 0.12)' 
                                      : thread.unreadCount > 0 
                                        ? '#FAFAFA'
                                        : '#FFFFFF',
                                    borderLeft: thread.unreadCount > 0 
                                      ? '3px solid #0057B8' 
                                      : '3px solid transparent',
                                    '&:active': {
                                      bgcolor: selectedThreadIds.has(thread.id) 
                                        ? 'rgba(0, 87, 184, 0.18)' 
                                        : 'rgba(0, 0, 0, 0.02)',
                                    },
                                    transition: 'background-color 150ms ease',
                                  }}
                                >
                                  <ListItemButton
                                    onClick={(e) => handleEmailThreadClick(thread, e)}
                                    sx={{
                                      py: 1.5,
                                      px: 1.5,
                                      minHeight: 72, // Target 72-80px per spec
                                      alignItems: 'flex-start',
                                    }}
                                  >
                                    {/* Checkbox - always visible on mobile */}
                                    <Box
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleSelect(thread.id, e);
                                      }}
                                      sx={{
                                        mr: 1,
                                        mt: 0.5,
                                        opacity: 1, // Always visible on mobile (hover doesn't work on touch devices)
                                        transition: 'opacity 0.15s ease',
                                      }}
                                    >
                                      <Checkbox
                                        checked={selectedThreadIds.has(thread.id)}
                                        onChange={() => {}}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleToggleSelect(thread.id, e);
                                        }}
                                        size="small"
                                        sx={{ 
                                          padding: '4px',
                                          '& .MuiSvgIcon-root': { 
                                            fontSize: '18px',
                                          } 
                                        }}
                                      />
                                    </Box>

                                    {/* Avatar */}
                                    <Avatar
                                      sx={{
                                        width: 40,
                                        height: 40,
                                        fontSize: '14px',
                                        bgcolor: getAvatarColor(displayName, thread.unreadCount > 0),
                                        color: '#fff',
                                        fontWeight: 600,
                                        border: thread.unreadCount > 0 ? '2px solid rgba(37, 99, 235, 0.3)' : 'none',
                                        mr: 1.5,
                                        flexShrink: 0,
                                      }}
                                    >
                                      {getInitials(displayName)}
                                    </Avatar>

                                    {/* Content Area */}
                                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      {/* Top line: Sender name + unread dot + star */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'nowrap' }}>
                                        <Typography
                                          variant="body2"
                                          sx={{
                                            fontSize: '16px',
                                            fontWeight: thread.unreadCount > 0 ? 700 : 600,
                                            color: 'text.primary',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            flex: 1,
                                          }}
                                        >
                                          {isSearching && searchQuery.trim() 
                                            ? highlightText(displayName, searchQuery)
                                            : displayName
                                          }
                                        </Typography>
                                        {thread.unreadCount > 0 && (
                                          <Box
                                            sx={{
                                              width: 8,
                                              height: 8,
                                              borderRadius: '50%',
                                              bgcolor: '#0057B8',
                                              flexShrink: 0,
                                            }}
                                          />
                                        )}
                                        {thread.starred && (
                                          <StarIcon 
                                            fontSize="small" 
                                            sx={{ 
                                              color: 'warning.main',
                                              fontSize: '18px',
                                              flexShrink: 0,
                                            }} 
                                          />
                                        )}
                                      </Box>

                                      {/* Second line: Subject */}
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontSize: '15px',
                                          fontWeight: thread.unreadCount > 0 ? 600 : 500,
                                          color: 'text.primary',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {isSearching && searchQuery.trim() 
                                          ? highlightText(thread.subject, searchQuery)
                                          : thread.subject
                                        }
                                      </Typography>

                                      {/* Third line: Preview + Date */}
                                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            fontSize: '13px',
                                            color: 'text.secondary',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            flex: 1,
                                          }}
                                        >
                                          {truncatedPreview || (companyName || emailAddress)}
                                        </Typography>
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            fontSize: '13px',
                                            color: 'text.secondary',
                                            flexShrink: 0,
                                            ml: 1,
                                          }}
                                        >
                                          {formatDate(thread.lastMessageAt)}
                                        </Typography>
                                      </Box>
                                    </Box>
                                  </ListItemButton>
                                </ListItem>
                              );
                            })}
                          </List>
                        </>
                      )}
                      {/* Mobile Pagination (Inbox-standard) */}
                      {filteredEmailThreads.length > 0 && (
                        <StandardTablePagination
                          count={filteredEmailThreads.length}
                          page={page}
                          onPageChange={(_, newPage) => setPage(newPage)}
                          rowsPerPage={rowsPerPage}
                          onRowsPerPageChange={(e) => {
                            setRowsPerPage(parseInt(e.target.value, 10));
                            setPage(0);
                          }}
                          sx={{ 
                            flexShrink: 0, 
                            px: 1,
                          }}
                        />
                      )}
                    </Box>
                  ) : (
                    /* Desktop Table View */
                    <TableContainer 
                      component={Paper} 
                      variant="outlined" 
                      sx={{ 
                        borderRadius: 2, 
                        position: 'relative',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        overflowY: 'auto',
                        overflowX: 'auto',
                        width: '100%',
                      }}
                    >
                <Table size="medium" stickyHeader sx={{ width: '100%' }}>
                  <TableHead sx={{ 
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    backgroundColor: 'background.paper',
                  }}>
                    <TableRow sx={{ height: '32px', backgroundColor: 'background.paper' }}>
                      <TableCell 
                        padding="checkbox" 
                        width="32px" 
                        sx={{ 
                          padding: '4px 12px', 
                          width: '32px', 
                          minWidth: '32px', 
                          maxWidth: '32px', 
                          height: '32px',
                          backgroundColor: 'background.paper',
                          position: 'sticky',
                          left: 0,
                          zIndex: 11,
                        }}
                      >
                        <Checkbox
                          indeterminate={(() => {
                            const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                            const currentVisibleThreadIds = new Set(currentVisibleThreads.map(t => t.id || '').filter(Boolean));
                            const allCurrentVisibleSelected = currentVisibleThreadIds.size > 0 && Array.from(currentVisibleThreadIds).every(id => selectedThreadIds.has(id));
                            return selectedThreadIds.size > 0 && !allCurrentVisibleSelected && selectedThreadIds.size < currentVisibleThreadIds.size;
                          })()}
                          checked={(() => {
                            const currentVisibleThreads = filteredEmailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                            const currentVisibleThreadIds = new Set(currentVisibleThreads.map(t => t.id || '').filter(Boolean));
                            return currentVisibleThreadIds.size > 0 && Array.from(currentVisibleThreadIds).every(id => selectedThreadIds.has(id));
                          })()}
                          onChange={handleSelectAll}
                          size="small"
                          sx={{ 
                            padding: '4px',
                            '& .MuiSvgIcon-root': { 
                              borderRadius: '4px',
                              fontSize: '18px',
                            } 
                          }}
                        />
                      </TableCell>
                      <TableCell 
                        width="56px" 
                        sx={{ 
                          padding: '4px 12px', 
                          height: '32px',
                          backgroundColor: 'background.paper',
                        }}
                      ></TableCell>
                      <TableCell 
                        sx={{ 
                          padding: '4px 12px', 
                          fontSize: '11px', 
                          fontWeight: 500, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.5px', 
                          color: 'rgba(0, 0, 0, 0.85)', 
                          width: '200px', 
                          minWidth: '200px', 
                          maxWidth: '200px', 
                          height: '32px', 
                          textAlign: 'left',
                          backgroundColor: 'background.paper',
                        }}
                      >
                        From
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          padding: '4px 12px', 
                          fontSize: '11px', 
                          fontWeight: 500, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.5px', 
                          color: 'rgba(0, 0, 0, 0.85)', 
                          width: '400px', 
                          minWidth: '400px', 
                          maxWidth: '400px', 
                          height: '32px', 
                          textAlign: 'left',
                          backgroundColor: 'background.paper',
                        }}
                      >
                        Subject
                      </TableCell>
                      <TableCell 
                        width="140px" 
                        sx={{ 
                          padding: '4px 12px', 
                          fontSize: '11px', 
                          fontWeight: 500, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.5px', 
                          color: 'rgba(0, 0, 0, 0.85)', 
                          textAlign: 'left', 
                          height: '32px',
                          backgroundColor: 'background.paper',
                        }}
                      >
                        Date
                      </TableCell>
                      <TableCell 
                        width="160px" 
                        sx={{ 
                          padding: '4px 12px', 
                          height: '32px',
                          backgroundColor: 'background.paper',
                        }}
                      ></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredEmailThreads.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                          <Stack spacing={2} alignItems="center">
                            {isSearching && searchQuery.trim() ? (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  🔍 No results found
                          </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
                                  No emails match your search for <strong>"{searchQuery}"</strong>
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, mt: 1 }}>
                                  Try:
                                  <br />• Different keywords
                                  <br />• Check spelling
                                  <br />• Use filters (from:, subject:)
                                </Typography>
                                <Button
                                  variant="outlined"
                                  onClick={handleClearSearch}
                                  sx={{ mt: 2, textTransform: 'none' }}
                                >
                                  Clear Search
                                </Button>
                              </>
                            ) : ['primary', 'social', 'promotions', 'updates', 'forums', 'spam'].includes(activeFilter) ? (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  No emails in this category
                          </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
                                  {emailThreads.length === 0 
                                    ? 'Your inbox is empty. Emails will sync automatically.'
                                    : 'Emails may not be categorized yet. Categories will update automatically as emails sync.'}
                                </Typography>
                              </>
                            ) : (
                              <>
                                <Typography variant="h6" sx={{ fontSize: '18px', fontWeight: 500, color: 'text.primary' }}>
                                  🎉 Your inbox is clear
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
                                  Keep an eye here for candidate + client activity.
                                </Typography>
                                <Button
                                  variant="contained"
                                  startIcon={<EditIcon />}
                                  onClick={() => setMessageDrawerOpen(true)}
                                  sx={{ mt: 2 }}
                                >
                                  Compose
                                </Button>
                              </>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEmailThreads
                        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                        .map((thread) => (
                          <TableRow
                            key={thread.id}
                            onMouseEnter={() => setHoveredThreadIdSafe(thread.id)}
                            onMouseLeave={() => setHoveredThreadIdSafe(null)}
                            onClick={(e) => handleEmailThreadClick(thread, e)}
                            sx={{ 
                              cursor: 'pointer', 
                              borderRadius: '4px',
                              mb: 0.25,
                              position: 'relative',
                              height: '44px', // Consistent height - no change for unread (per style guide)
                              // Default row BG: #FAFAFA to #FFFFFF gradient acceptable (per style guide)
                              background: selectedThreadIds.has(thread.id) 
                                ? 'rgba(0, 87, 184, 0.12)' 
                                : thread.unreadCount > 0 
                                  ? 'linear-gradient(to bottom, #FAFAFA, #FFFFFF)' // Gradient for unread (per style guide)
                                  : '#FFFFFF', // Pure white for read
                              borderBottom: '1px solid',
                              borderColor: 'rgba(0, 0, 0, 0.04)',
                              // Left border accent for unread emails
                              borderLeft: thread.unreadCount > 0 
                                ? '3px solid' 
                                : '3px solid transparent',
                              borderLeftColor: thread.unreadCount > 0 ? '#0057B8' : 'transparent',
                              '&:hover': {
                                bgcolor: selectedThreadIds.has(thread.id) 
                                  ? 'rgba(0, 87, 184, 0.18)' 
                                  : 'rgba(0, 0, 0, 0.02)', // Hover: rgba(0,0,0,.02) (per style guide)
                                borderLeftColor: thread.unreadCount > 0 ? '#0057B8' : 'transparent',
                              },
                              transition: 'background-color 150ms ease, border-color 150ms ease', // 150ms transition (per style guide)
                            }}
                          >
                            <TableCell 
                              padding="checkbox" 
                              onClick={(e) => handleToggleSelect(thread.id, e)}
                              sx={{ 
                                py: 0.25,
                                pr: 0,
                                pl: 1,
                                width: '32px',
                                minWidth: '32px',
                                maxWidth: '32px',
                                opacity: hoveredThreadId === thread.id || selectedThreadIds.has(thread.id) ? 1 : 0,
                                transition: 'opacity 0.15s ease',
                              }}
                            >
                              <Checkbox
                                checked={selectedThreadIds.has(thread.id)}
                                onChange={() => {}}
                                onClick={(e) => handleToggleSelect(thread.id, e)}
                                size="small"
                                sx={{ 
                                  padding: '4px',
                                  '& .MuiSvgIcon-root': { 
                                    borderRadius: '4px',
                                    fontSize: '18px',
                                  } 
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 0, width: '56px' }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Avatar 
                                  onMouseEnter={(e) => {
                                    const contact = getPrimaryContact(thread);
                                    if (contact) {
                                      setHoveredContactAnchor(e.currentTarget);
                                      setHoveredContactThread(thread);
                                      setTimeout(() => setHoverCardOpen(true), 200);
                                    }
                                  }}
                                  onMouseLeave={() => {
                                    setHoverCardOpen(false);
                                    setTimeout(() => {
                                      if (!hoverCardOpen) {
                                        setHoveredContactAnchor(null);
                                        setHoveredContactThread(null);
                                      }
                                    }, 100);
                                  }}
                                  sx={{ 
                                    width: 36, 
                                    height: 36, 
                                    fontSize: '13px',
                                    bgcolor: getAvatarColor(
                                      getDisplayName(thread),
                                      thread.unreadCount > 0
                                    ),
                                    color: '#fff',
                                    fontWeight: 600,
                                    border: thread.unreadCount > 0 ? '2px solid rgba(37, 99, 235, 0.3)' : 'none',
                                    cursor: getPrimaryContact(thread) ? 'pointer' : 'default',
                                  }}
                                >
                                  {getInitials(getDisplayName(thread))}
                                </Avatar>
                                {thread.starred && (
                                  <StarIcon 
                                    fontSize="small" 
                                    sx={{ 
                                      color: 'warning.main',
                                      position: 'absolute',
                                      ml: 4.5,
                                      mt: -0.5,
                                      fontSize: '14px',
                                    }} 
                                  />
                                )}
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 1.5, width: '200px', minWidth: '200px', maxWidth: '200px' }}>
                              <Stack spacing={0.25}>
                                <Typography 
                                  variant="body2" 
                                  onMouseEnter={(e) => {
                                    const contact = getPrimaryContact(thread);
                                    if (contact) {
                                      setHoveredContactAnchor(e.currentTarget);
                                      setHoveredContactThread(thread);
                                      setTimeout(() => setHoverCardOpen(true), 200);
                                    }
                                  }}
                                  onMouseLeave={() => {
                                    setHoverCardOpen(false);
                                    setTimeout(() => {
                                      if (!hoverCardOpen) {
                                        setHoveredContactAnchor(null);
                                        setHoveredContactThread(null);
                                      }
                                    }, 100);
                                  }}
                                  sx={{ 
                                    fontSize: '14px',
                                    fontWeight: 500, // Medium for display name
                                    color: 'text.primary',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    lineHeight: 1.3,
                                    cursor: getPrimaryContact(thread) ? 'pointer' : 'default',
                                  }}
                                >
                                  {isSearching && searchQuery.trim() 
                                    ? highlightText(getDisplayName(thread), searchQuery)
                                    : getDisplayName(thread)
                                  }
                                </Typography>
                                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                  {getCompanyName(thread) ? (
                                    <Typography 
                                      variant="caption" 
                                      sx={{ 
                                        fontSize: '12px',
                                        color: 'text.secondary',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        lineHeight: 1.2,
                                      }}
                                    >
                                      {getCompanyName(thread)}
                                    </Typography>
                                  ) : (
                                    <Typography 
                                      variant="caption" 
                                      sx={{ 
                                        fontSize: '12px',
                                        color: 'text.secondary',
                                        opacity: 0.6, // De-emphasize email address (50-65% opacity)
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        lineHeight: 1.2,
                                      }}
                                    >
                                      {getEmailAddress(thread)}
                                    </Typography>
                                  )}
                                  {getEntityType(thread) && (
                                    <Chip
                                      label={getEntityType(thread) === 'both' ? 'User/CRM' : getEntityType(thread) === 'user' ? 'User' : 'CRM'}
                                      size="small"
                                      sx={{
                                        height: '16px',
                                        fontSize: '10px',
                                        fontWeight: 500,
                                        bgcolor: 'rgba(0, 0, 0, 0.06)',
                                        color: 'text.secondary',
                                        '& .MuiChip-label': {
                                          px: 0.75,
                                          py: 0,
                                        },
                                      }}
                                    />
                                  )}
                                </Stack>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 1.5, width: '400px', minWidth: '400px', maxWidth: '400px' }}>
                              <Stack spacing={0.25} sx={{ width: '100%' }}>
                                {/* Subject - Bold, single line */}
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                                {thread.unreadCount > 0 && (
                                  <Box
                                    sx={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                        bgcolor: '#0057B8', // Brand primary color (per style guide)
                                        flexShrink: 0,
                                        mt: 0.25,
                                    }}
                                  />
                                )}
                                  <Typography 
                                    variant="body2" 
                                    component="div"
                                    sx={{ 
                                      fontSize: '14px',
                                      fontWeight: thread.unreadCount > 0 ? 700 : 500, // Bold for unread, medium for read
                                      color: thread.unreadCount > 0 ? 'text.primary' : 'text.primary',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      flex: 1,
                                    }}
                                  >
                                    {isSearching && searchQuery.trim() 
                                      ? highlightText(thread.subject, searchQuery)
                                      : thread.subject
                                    }
                                    {thread.messageCount > 1 && (
                                      <Chip
                                        label={thread.messageCount}
                                        size="small"
                                        sx={{
                                          ml: 0.75,
                                          height: '18px',
                                          fontSize: '10px',
                                          fontWeight: 500,
                                          bgcolor: 'rgba(0, 0, 0, 0.08)',
                                          color: 'text.secondary',
                                          '& .MuiChip-label': {
                                            px: 0.75,
                                            py: 0,
                                          },
                                        }}
                                      />
                                    )}
                                  </Typography>
                              </Stack>
                                {/* Preview - Muted gray, lighter weight */}
                                {thread.lastMessageSnippet && (
                                  <Typography 
                                    variant="caption" 
                                    sx={{ 
                                      fontSize: '12px',
                                      fontWeight: 400,
                                      color: 'text.secondary',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      pl: thread.unreadCount > 0 ? 2.5 : 0, // Align with subject when dot is present
                                    }}
                                  >
                                    {sanitizeSnippet(thread.lastMessageSnippet)}
                              </Typography>
                                )}
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 1.5, width: '140px', textAlign: 'right' }}>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  fontSize: '12px',
                                  fontWeight: 400,
                                  color: 'text.secondary',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                }}
                              >
                                {(() => {
                                  const dateStr = formatDate(thread.lastMessageAt);
                                  // Lower contrast on "Yesterday", keep time stronger
                                  if (dateStr.startsWith('Yesterday')) {
                                    const parts = dateStr.split(' — ');
                                    return (
                                      <>
                                        <span style={{ opacity: 0.65 }}>{parts[0]}</span>
                                        {parts.length > 1 && ` — ${parts[1]}`}
                                      </>
                                    );
                                  }
                                  return dateStr;
                                })()}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 1, width: '160px' }}>
                              <Stack 
                                direction="row" 
                                spacing={0.5} 
                                sx={{ 
                                  opacity: hoveredThreadId === thread.id || selectedThreadIds.has(thread.id) ? 1 : 0,
                                  transition: 'opacity 0.15s ease',
                                  justifyContent: 'flex-end',
                                  alignItems: 'center',
                                }}
                              >
                                <Tooltip title={thread.starred ? 'Unstar (S)' : 'Star (S)'}>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      handleStarThread(thread.id, !thread.starred, e);
                                    }}
                                    sx={{ 
                                      '&:hover': { 
                                        bgcolor: 'action.hover',
                                      } 
                                    }}
                                  >
                                    {thread.starred ? (
                                      <StarIcon fontSize="small" sx={{ color: 'warning.main' }} />
                                    ) : (
                                      <StarBorderIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Archive (E)">
                                    <IconButton
                                      size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      handleArchiveThread(thread.id, e);
                                    }}
                                    sx={{ 
                                      '&:hover': { 
                                        bgcolor: 'action.hover',
                                      } 
                                    }}
                                  >
                                    <ArchiveIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                <Tooltip title="Reply (R)">
                                  <IconButton
                                    size="small"
                                    onClick={(e) => handleReplyToThread(thread, e)}
                                    sx={{ 
                                      '&:hover': { 
                                        bgcolor: 'action.hover',
                                      } 
                                    }}
                                  >
                                    <ReplyIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete">
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      handleDeleteThread(thread.id, e);
                                    }}
                                    sx={{ 
                                      '&:hover': { 
                                        bgcolor: 'error.light',
                                        color: 'error.main',
                                      } 
                                    }}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
                {activeTab === 'email' && gmailConnected && (
              <StandardTablePagination
                count={filteredEmailThreads.length}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                    sx={{ flexShrink: 0 }}
                  />
                )}
                    </TableContainer>
                  )}
                </>
          )}
        </Box>
          </Box>
          </>
      )}

      {/* SMS tab removed - SMS now has dedicated /text-messages page per decoupling spec */}

      {selectedThread && (
        <ReplyDrawer
          open={replyDrawerOpen}
          onClose={() => {
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
          threadId={selectedThread.id}
          tenantId={effectiveTenantId || ''}
          candidateUserId={user?.uid || ''}
          onReplySent={() => {
            loadSmsThreads();
            setReplyDrawerOpen(false);
            setSelectedThread(null);
          }}
        />
      )}

      {selectedEmailThread && (
        <EmailThreadView
          open={emailThreadViewOpen}
          onClose={() => {
            setEmailThreadViewOpen(false);
            setSelectedEmailThread(null);
            setAutoOpenReply(false); // Reset auto-reply flag when drawer closes
          }}
          threadId={selectedEmailThread.id}
          tenantId={effectiveTenantId || ''}
          autoOpenReply={autoOpenReply}
          onThreadUpdated={(threadId, unreadCount) => {
            // Reactively update thread read status without reloading
            updateThreadReadStatus(threadId, unreadCount);
          }}
        />
      )}

      {/* Message Detail Modal */}
      {selectedMessage && (
        <Dialog
          open={messageModalOpen}
          onClose={() => setMessageModalOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center">
                {getChannelIcon(selectedMessage.channel)}
                <Chip
                  label={selectedMessage.channel.toUpperCase()}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={selectedMessage.direction}
                  size="small"
                  color={selectedMessage.direction === 'inbound' ? 'primary' : 'default'}
                  variant="outlined"
                />
                <Chip
                  label={selectedMessage.status}
                  size="small"
                  color={getStatusColor(selectedMessage.status)}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {formatDate(selectedMessage.createdAt)}
              </Typography>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Typography variant="subtitle2">Message Type: {selectedMessage.messageTypeId}</Typography>
              {(selectedMessage.channel === 'email' || selectedMessage.channel === 'push') && (
                <Typography variant="subtitle2">
                  Subject: {getMessageSubject(selectedMessage) || 'No subject'}
                </Typography>
              )}
              <Typography variant="subtitle2">Message Content:</Typography>
              <Paper variant="outlined" sx={{ p: 2, maxHeight: 500, overflowY: 'auto' }}>
                {selectedMessage.channel === 'email' ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: getMessageContent(selectedMessage) || 'No message content available.',
                    }}
                  />
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {getMessageContent(selectedMessage).replace(/<[^>]*>/g, '') || 'No message content available.'}
                  </Typography>
                )}
              </Paper>
              {selectedMessage.providerMessageId && (
                <Typography variant="caption" color="text.secondary">
                  Provider Message ID: {selectedMessage.providerMessageId}
                </Typography>
              )}
              {selectedMessage.failureReason && (
                <Typography variant="caption" color="error">
                  Failure Reason: {selectedMessage.failureReason}
                </Typography>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMessageModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Message Drawer for composing new messages */}
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={[]} // Start with empty recipients - user can add them in the drawer
        tenantId={effectiveTenantId}
        onSend={(result) => {
          if (result.success) {
            // Reload email threads after sending
              loadEmailThreads();
          }
        }}
      />

      {/* Contact Hover Card */}
      {hoveredContactThread && hoveredContactAnchor && (
        <ContactHoverCard
          open={hoverCardOpen}
          anchorEl={hoveredContactAnchor}
          onClose={() => {
            setHoverCardOpen(false);
            setHoveredContactAnchor(null);
            setHoveredContactThread(null);
          }}
          contact={getPrimaryContact(hoveredContactThread) || { email: getEmailAddress(hoveredContactThread) }}
          tenantId={effectiveTenantId || ''}
        />
      )}
    </Box>
  );
};

export default UserInboxPage;

