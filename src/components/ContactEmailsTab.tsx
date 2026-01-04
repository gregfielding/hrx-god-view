/**
 * Contact Emails Tab Component
 * 
 * Displays email threads for a contact using the inbox design
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Avatar,
  CircularProgress,
  Alert,
  Stack,
  Checkbox,
  IconButton,
  Tooltip,
  TablePagination,
  Button,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import EmailIcon from '@mui/icons-material/Email';
import EditIcon from '@mui/icons-material/Edit';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import EmailThreadView from './EmailThreadView';
import MessageDrawer from './MessageDrawer';
import { useAuth } from '../contexts/AuthContext';

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
  labels?: string[];
}

interface ContactEmailsTabProps {
  contact: {
    id: string;
    email?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
  };
  tenantId: string;
}

const ContactEmailsTab: React.FC<ContactEmailsTabProps> = ({ contact, tenantId }) => {
  const { user } = useAuth();
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    loadEmailThreads();
  }, [contact?.email, tenantId]);

  const loadEmailThreads = async () => {
    if (!contact?.email || !tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const threadsRef = collection(db, 'tenants', tenantId, 'emailThreads');
      const allThreads: EmailThread[] = [];

      // First, try to query by participantContactIds (more efficient if available)
      try {
        const contactIdQuery = query(
          threadsRef,
          where('participantContactIds', 'array-contains', contact.id),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc'),
          limit(200)
        );
        const contactIdSnapshot = await getDocs(contactIdQuery);
        const contactIdThreads = contactIdSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as EmailThread[];
        allThreads.push(...contactIdThreads);
      } catch (err) {
        // participantContactIds query might fail if field doesn't exist or no index
        console.warn('Could not query by participantContactIds:', err);
      }

      // Also query by email address (fallback for older threads)
      try {
        const emailQuery = query(
          threadsRef,
          where('participants', 'array-contains', contact.email.toLowerCase()),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc'),
          limit(200)
        );
        const emailSnapshot = await getDocs(emailQuery);
        const emailThreads = emailSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as EmailThread[];
        
        // Merge and deduplicate
        const existingIds = new Set(allThreads.map(t => t.id));
        emailThreads.forEach(thread => {
          if (!existingIds.has(thread.id)) {
            allThreads.push(thread);
          }
        });
      } catch (err) {
        console.warn('Could not query by email:', err);
      }

      // Sort by lastMessageAt and normalize timestamps
      const normalizedThreads = allThreads
        .map(thread => ({
          ...thread,
          lastMessageAt: thread.lastMessageAt?.toDate?.() || thread.lastMessageAt || new Date(),
        }))
        .sort((a, b) => {
          const aTime = a.lastMessageAt instanceof Date ? a.lastMessageAt.getTime() : 0;
          const bTime = b.lastMessageAt instanceof Date ? b.lastMessageAt.getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 200); // Limit to 200 most recent

      setEmailThreads(normalizedThreads);
    } catch (err: any) {
      console.error('Error loading email threads:', err);
      setError(err.message || 'Failed to load email threads');
    } finally {
      setLoading(false);
    }
  };

  const handleThreadClick = (thread: EmailThread) => {
    setSelectedThread(thread);
    setDrawerOpen(true);
  };

  const handleThreadUpdated = (threadId: string, unreadCount: number) => {
    // Update local state when thread is marked as read
    setEmailThreads(prev => prev.map(t => 
      t.id === threadId ? { ...t, unreadCount } : t
    ));
  };

  const formatDate = (date: Date | any): string => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  };

  const getDisplayName = (thread: EmailThread): string => {
    // Get the first participant that's not the contact's email
    const otherParticipants = thread.participants.filter(
      p => p.toLowerCase() !== contact.email?.toLowerCase()
    );
    if (otherParticipants.length > 0) {
      const email = otherParticipants[0];
      return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    return thread.participants[0] || 'Unknown';
  };

  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getAvatarColor = (name: string, isUnread: boolean): string => {
    const colors = [
      '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b',
      '#0288d1', '#00796b', '#fbc02d', '#5e35b1', '#d32f2f',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  const displayThreads = emailThreads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box>
      <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Email Threads
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {emailThreads.length} email thread{emailThreads.length !== 1 ? 's' : ''} with {contact.fullName || contact.firstName || contact.email}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<EditIcon />}
          onClick={() => setMessageDrawerOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Compose Email
        </Button>
      </Box>

      {emailThreads.length === 0 ? (
        <Box sx={{ p: 8, textAlign: 'center' }}>
          <EmailIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            No emails yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Email threads with {contact.email} will appear here
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer 
            component={Paper} 
            variant="outlined" 
            sx={{ borderRadius: 0, overflowX: 'auto' }}
          >
            <Table size="medium">
              <TableHead>
                <TableRow>
                  <TableCell width="56px" sx={{ py: 1.5, px: 0 }}></TableCell>
                  <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', width: '200px' }}>
                    From
                  </TableCell>
                  <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', width: '400px' }}>
                    Subject
                  </TableCell>
                  <TableCell sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary' }}>
                    Preview
                  </TableCell>
                  <TableCell width="140px" sx={{ py: 1.5, px: 1.5, fontSize: '11px', fontWeight: 500, textTransform: 'none', color: 'text.secondary', textAlign: 'right' }}>
                    Date
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayThreads.map((thread) => (
                  <TableRow
                    key={thread.id}
                    onClick={() => handleThreadClick(thread)}
                    sx={{
                      cursor: 'pointer',
                      height: '56px',
                      bgcolor: thread.unreadCount > 0 ? '#F6F8FB' : 'transparent',
                      borderBottom: '1px solid',
                      borderColor: 'rgba(0, 0, 0, 0.06)',
                      borderLeft: thread.unreadCount > 0 ? '3px solid' : '3px solid transparent',
                      borderLeftColor: thread.unreadCount > 0 ? 'primary.main' : 'transparent',
                      '&:hover': {
                        bgcolor: thread.unreadCount > 0 ? '#E8EDF5' : 'rgba(0, 0, 0, 0.02)',
                      },
                    }}
                  >
                    <TableCell sx={{ py: 1.5, px: 0, width: '56px' }}>
                      <Avatar
                        sx={{
                          width: 36,
                          height: 36,
                          fontSize: '13px',
                          bgcolor: getAvatarColor(getDisplayName(thread), thread.unreadCount > 0),
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      >
                        {getInitials(getDisplayName(thread))}
                      </Avatar>
                    </TableCell>
                    <TableCell sx={{ py: 1.5, px: 1.5, width: '200px' }}>
                      <Stack spacing={0.25}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontSize: '14px',
                            fontWeight: thread.unreadCount > 0 ? 600 : 500,
                            color: 'text.primary',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getDisplayName(thread)}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: '12px',
                            color: 'text.secondary',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {thread.participants.find(p => p.toLowerCase() !== contact.email?.toLowerCase()) || ''}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ py: 1.5, px: 1.5, width: '400px' }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '14px',
                          fontWeight: thread.unreadCount > 0 ? 600 : 400,
                          color: 'text.primary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {thread.subject || '(no subject)'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1.5, px: 1.5 }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '13px',
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {thread.lastMessageSnippet || ''}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1.5, px: 1.5, textAlign: 'right' }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '12px',
                          color: 'text.secondary',
                        }}
                      >
                        {formatDate(thread.lastMessageAt)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={emailThreads.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </>
      )}

      {/* Email Thread Drawer */}
      {selectedThread && (
        <EmailThreadView
          open={drawerOpen}
          threadId={selectedThread.id}
          tenantId={tenantId}
          onClose={() => {
            setDrawerOpen(false);
            setSelectedThread(null);
          }}
          onThreadUpdated={handleThreadUpdated}
        />
      )}

      {/* Message Compose Drawer */}
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={contact.email ? [{
          userId: contact.id,
          name: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email,
          email: contact.email,
        }] : []}
        tenantId={tenantId}
        defaultChannels={['email']}
        onSend={() => {
          setMessageDrawerOpen(false);
          loadEmailThreads(); // Reload threads after sending
        }}
      />
    </Box>
  );
};

export default ContactEmailsTab;

