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
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Alert,
  CircularProgress,
  Skeleton,
  Grid,
} from '@mui/material';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReplyIcon from '@mui/icons-material/Reply';
import { Button } from '@mui/material';
import StandardTablePagination from './StandardTablePagination';
import EmailThreadView from './EmailThreadView';

// Types for contact activity items
type ContactActivityItem = {
  id: string;
  type: 'task' | 'email' | 'note' | 'call' | 'meeting' | 'ai_activity';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
  bodySnippet?: string;
  bodyHtml?: string;
  source?: string;
};

interface ContactActivityTabProps {
  contact: any;
  tenantId: string;
}

const getActivityTypeColor = (type: string): string => {
  const colors: { [key: string]: string } = {
    task: '#10B981',      // Green for completed tasks
    note: '#3B82F6',      // Blue for notes
    email: '#F59E0B',     // Orange for emails
    call: '#8B5CF6',      // Purple for calls
    meeting: '#EC4899',   // Pink for meetings
    ai_activity: '#6366F1' // Indigo for AI activities
  };
  return colors[type] || '#6B7280'; // Gray fallback
};

const ContactActivityTab: React.FC<ContactActivityTabProps> = ({ contact, tenantId }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<ContactActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<{ [id: string]: { bodyHtml?: string; bodySnippet?: string } }>({});
  const [expanding, setExpanding] = useState<boolean>(false);
  // Email drawer state
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(null);
  const [emailDrawerOpen, setEmailDrawerOpen] = useState<boolean>(false);
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'email' | 'note'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination (0-based for StandardTablePagination)
  const [page, setPage] = useState<number>(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(20);

  useEffect(() => {
    const load = async () => {
      if (!contact?.id || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const { loadContactActivities } = await import('../utils/activityService');
        const activities = await loadContactActivities(tenantId, contact.id, {
          limit: 200,
          includeTasks: true,
          includeEmails: true,
          includeNotes: true,
          includeAIActivities: false,
          onlyCompletedTasks: true
        });
        
        // Convert to ContactActivityItem format
        const aggregated: ContactActivityItem[] = activities.map(activity => ({
          id: activity.id,
          type: activity.type,
          timestamp: activity.timestamp,
          title: activity.title,
          description: activity.description,
          metadata: activity.metadata
        }));
        
        setItems(aggregated);
        setPage(0);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [contact?.id, tenantId]);

  // Realtime refresh: when a new email_log lands for this contact, reload activities.
  // This ensures the Activity tab updates immediately after sending an email from the drawer.
  useEffect(() => {
    if (!contact?.id || !tenantId) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'email_logs'),
      where('contactId', '==', contact.id),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      () => {
        // Fire-and-forget; load() is defined in the other effect, so re-run it by duplicating minimal logic here.
        (async () => {
          try {
            const { loadContactActivities } = await import('../utils/activityService');
            const activities = await loadContactActivities(tenantId, contact.id, {
              limit: 200,
              includeTasks: true,
              includeEmails: true,
              includeNotes: true,
              includeAIActivities: false,
              onlyCompletedTasks: true,
            });
            const aggregated: ContactActivityItem[] = activities.map((activity) => ({
              id: activity.id,
              type: activity.type,
              timestamp: activity.timestamp,
              title: activity.title,
              description: activity.description,
              metadata: activity.metadata,
            }));
            setItems(aggregated);
            setPage(0);
          } catch (e: any) {
            // Don't clobber the UI on listener errors; just log
            console.warn('ContactActivityTab: failed to refresh activities after email_logs update', e);
          }
        })();
      },
      (err) => {
        console.warn('ContactActivityTab: email_logs listener error', err);
      }
    );
    return () => unsub();
  }, [contact?.id, tenantId]);

  // Derived list after filters
  const filtered = items.filter((it) => {
    if (typeFilter !== 'all' && it.type !== typeFilter) return false;
    if (startDate) {
      const s = new Date(startDate + 'T00:00:00');
      if (it.timestamp < s) return false;
    }
    if (endDate) {
      const e = new Date(endDate + 'T23:59:59');
      if (it.timestamp > e) return false;
    }
    return true;
  });
  const total = filtered.length;
  const pageItems = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  // Open email thread in drawer
  const openEmailThread = async (it: ContactActivityItem) => {
    try {
      // Check if we have threadId directly in metadata (faster path)
      let threadId = it.metadata?.threadId || null;
      
      if (!threadId && it.type === 'email') {
        // Extract emailLogId from activity id (shaped like email_<docId>)
        const emailLogId = it.id.replace(/^email_/, '');
        
        console.log('Opening email from activity:', { emailLogId, activityId: it.id, metadata: it.metadata });
        
        // Get the email_log document to find threadId (gmailThreadId)
        const emailLogRef = doc(db, 'tenants', tenantId, 'email_logs', emailLogId);
        const emailLogDoc = await getDoc(emailLogRef);
        
        if (!emailLogDoc.exists()) {
          console.error('Email log not found:', emailLogId);
          // Toggle expand instead to show any available content
          setExpandedId(expandedId === it.id ? null : it.id);
          return;
        }
        
        const emailLogData = emailLogDoc.data();
        const threadIdFromLog = emailLogData?.threadId;
        const gmailThreadId = emailLogData?.gmailThreadId || threadIdFromLog;
        
        console.log('Email log data:', { threadIdFromLog, gmailThreadId });
        
        if (!user?.uid) {
          alert('You must be logged in to view email threads.');
          return;
        }
        
        const API_BASE_URL = process.env.REACT_APP_FUNCTIONS_URL ||
          'https://us-central1-hrx1-d3beb.cloudfunctions.net';
        
        // Strategy 1: Try threadIdFromLog as document ID (for newer emails)
        if (threadIdFromLog && threadIdFromLog.length > 20) {
          try {
            const testUrl = `${API_BASE_URL}/getEmailThreadApi?threadId=${encodeURIComponent(threadIdFromLog)}&tenantId=${encodeURIComponent(tenantId)}`;
            const testResponse = await fetch(testUrl);
            
            if (testResponse.ok) {
              const testData = await testResponse.json();
              if (testData.success && testData.thread) {
                threadId = threadIdFromLog;
                console.log('Found thread using threadId as document ID:', threadId);
              }
            }
          } catch (e) {
            console.log('threadIdFromLog is not a document ID, will try gmailThreadId lookup');
          }
        }
        
        // Strategy 2: Look up by gmailThreadId using listEmailThreadsApi
        if (!threadId && gmailThreadId) {
          try {
            const listUrl = `${API_BASE_URL}/listEmailThreadsApi?userId=${encodeURIComponent(user.uid)}&tenantId=${encodeURIComponent(tenantId)}&limit=500`;
            const listResponse = await fetch(listUrl);
            
            if (!listResponse.ok) {
              console.error('listEmailThreadsApi failed:', listResponse.status, listResponse.statusText);
              if (threadIdFromLog) {
                console.log('API failed, trying threadIdFromLog directly:', threadIdFromLog);
                threadId = threadIdFromLog;
              } else {
                throw new Error(`Failed to list email threads: ${listResponse.status}`);
              }
            } else {
              const listData = await listResponse.json();
              
              if (listData.success && listData.threads) {
                const matchingThread = listData.threads.find((thread: any) => 
                  thread.gmailThreadId === gmailThreadId || thread.id === gmailThreadId
                );
                
                if (matchingThread) {
                  threadId = matchingThread.id;
                  console.log('Found thread using gmailThreadId via API:', threadId);
                }
              }
            }
          } catch (e: any) {
            console.error('Error looking up thread:', e);
            if (threadIdFromLog && !threadId) {
              console.log('Trying threadIdFromLog as fallback:', threadIdFromLog);
              threadId = threadIdFromLog;
            }
          }
        }
      }
      
      if (!threadId) {
        console.error('No email thread found for activity:', it.id);
        // Show expanded content as fallback
        setExpandedId(expandedId === it.id ? null : it.id);
        return;
      }
      
      console.log('Opening thread:', threadId);
      setSelectedEmailThreadId(threadId);
      setEmailDrawerOpen(true);
    } catch (e: any) {
      console.error('Failed to open email thread:', e);
      // Show expanded content as fallback
      setExpandedId(expandedId === it.id ? null : it.id);
    }
  };

  const handleRowClick = async (it: ContactActivityItem) => {
    // For emails, try to open in EmailThreadView drawer
    if (it.type === 'email') {
      // If already expanded, try opening the drawer
      if (expandedId === it.id) {
        await openEmailThread(it);
      } else {
        // First click expands to show content, can click again or use button to open drawer
        setExpandedId(it.id);
      }
      return;
    }
    
    // For non-email items, use expand behavior
    if (expandedId === it.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(it.id);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', px: 2 }}>
      {/* Filters */}
      <Box sx={{ mb: 2 }}>
        <Grid container spacing={2}>
            <Grid item xs={12} sm={4} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select 
                  value={typeFilter} 
                  label="Type" 
                  onChange={(e) => { setTypeFilter(e.target.value as any); setPage(0); }}
                >
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="task">Tasks</MenuItem>
                  <MenuItem value="email">Emails</MenuItem>
                  <MenuItem value="note">Notes</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField
                type="date"
                size="small"
                fullWidth
                label="Start Date"
                InputLabelProps={{ shrink: true }}
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField
                type="date"
                size="small"
                fullWidth
                label="End Date"
                InputLabelProps={{ shrink: true }}
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              />
            </Grid>
        </Grid>
      </Box>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {/* Results count */}
      <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {total} results
        </Typography>
      </Box>
      
      {loading ? (
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
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 0, 0, 0.02)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              '&:hover': {
                background: 'rgba(0, 0, 0, 0.25)',
              },
            },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}
        >
          <Table size="small" stickyHeader sx={{ width: '100%' }}>
            <TableHead sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: 'background.paper',
            }}>
              <TableRow sx={{ backgroundColor: 'background.paper' }}>
                {['Type', 'Title', 'Description', 'When', ''].map((header) => (
                  <TableCell key={header} sx={{
                    fontWeight: 700,
                    bgcolor: '#FFFFFF',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'rgba(0, 0, 0, 0.85)',
                    py: 1.5
                  }}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
                  <TableBody>
                    {Array.from({ length: 3 }).map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        <TableCell sx={{ py: 2 }}>
                          <Skeleton variant="rectangular" width={60} height={24} sx={{ borderRadius: 1 }} />
                        </TableCell>
                        <TableCell sx={{ py: 2 }}>
                          <Skeleton variant="text" width="80%" height={20} />
                        </TableCell>
                        <TableCell sx={{ py: 2 }}>
                          <Skeleton variant="text" width="60%" height={20} />
                        </TableCell>
                        <TableCell sx={{ py: 2 }}>
                          <Skeleton variant="text" width={120} height={20} />
                        </TableCell>
                        <TableCell sx={{ py: 2 }}>
                          <Skeleton variant="circular" width={24} height={24} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
          ) : filtered.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                No activity yet
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Completed tasks and emails will appear here
              </Typography>
            </Box>
          ) : (
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
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'rgba(0, 0, 0, 0.02)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: '4px',
              '&:hover': {
                background: 'rgba(0, 0, 0, 0.25)',
              },
            },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}
        >
          <Table size="small" stickyHeader sx={{ width: '100%' }}>
            <TableHead sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: 'background.paper',
            }}>
              <TableRow sx={{ backgroundColor: 'background.paper' }}>
                <TableCell sx={{
                  fontWeight: 700,
                  bgcolor: '#FFFFFF',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(0, 0, 0, 0.85)',
                  py: 1.5
                }}>
                  Type
                </TableCell>
                <TableCell sx={{
                  fontWeight: 700,
                  bgcolor: '#FFFFFF',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(0, 0, 0, 0.85)',
                  py: 1.5
                }}>
                  Title
                </TableCell>
                <TableCell sx={{
                  fontWeight: 700,
                  bgcolor: '#FFFFFF',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(0, 0, 0, 0.85)',
                  py: 1.5
                }}>
                  Description
                </TableCell>
                <TableCell sx={{
                  fontWeight: 700,
                  bgcolor: '#FFFFFF',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(0, 0, 0, 0.85)',
                  py: 1.5
                }}>
                  When
                </TableCell>
                <TableCell sx={{
                  fontWeight: 700,
                  bgcolor: '#FFFFFF',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(0, 0, 0, 0.85)',
                  py: 1.5
                }} />
              </TableRow>
            </TableHead>
                <TableBody>
                  {pageItems.map((it) => (
                    <React.Fragment key={it.id}>
                    <TableRow 
                      onClick={() => handleRowClick(it)}
                      sx={{
                        cursor: 'pointer',
                        '&:hover': { 
                          bgcolor: 'action.hover' 
                        },
                        '&:nth-of-type(even)': {
                          bgcolor: 'rgba(0, 0, 0, 0.02)',
                        }
                      }}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <Chip 
                          size="small" 
                          label={it.type} 
                          sx={{
                            fontSize: '0.75rem',
                            height: 24,
                            fontWeight: 600,
                            backgroundColor: getActivityTypeColor(it.type),
                            color: 'white'
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 1, px: 2 }}>
                        <Typography 
                          variant="body2" 
                          sx={{
                            color: 'text.primary',
                            fontWeight: 500
                          }}
                        >
                          {it.title}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography 
                          variant="body2" 
                          color="text.secondary"
                          sx={{
                            maxWidth: 420,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {it.description}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          {it.timestamp?.toLocaleString?.()}
                        </Typography>
                      </TableCell>
                      <TableCell width={48} align="right">
                        {expandedId === it.id ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </TableCell>
                    </TableRow>
                    {expandedId === it.id && (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ bgcolor: 'grey.50' }}>
                          <Box sx={{ p: 2 }}>
                            {/* Show email content if available */}
                            {it.type === 'email' ? (
                              <Box>
                                <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                    {it.metadata?.from && (
                                      <Typography variant="caption" color="text.secondary">
                                        <strong>From:</strong> {it.metadata.from}
                                      </Typography>
                                    )}
                                    {it.metadata?.to && (
                                      <Typography variant="caption" color="text.secondary">
                                        <strong>To:</strong> {Array.isArray(it.metadata.to) ? it.metadata.to.join(', ') : it.metadata.to}
                                      </Typography>
                                    )}
                                    {it.metadata?.subject && (
                                      <Typography variant="caption" color="text.secondary">
                                        <strong>Subject:</strong> {it.metadata.subject}
                                      </Typography>
                                    )}
                                  </Box>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    color="primary"
                                    startIcon={<ReplyIcon />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEmailThread(it);
                                    }}
                                  >
                                    Open Thread
                                  </Button>
                                </Box>
                                {it.metadata?.bodySnippet ? (
                                  <Typography 
                                    variant="body2" 
                                    color="text.secondary"
                                    sx={{ 
                                      whiteSpace: 'pre-wrap',
                                      maxHeight: 200,
                                      overflow: 'auto',
                                      bgcolor: 'white',
                                      p: 1.5,
                                      borderRadius: 1,
                                      border: '1px solid',
                                      borderColor: 'divider'
                                    }}
                                  >
                                    {it.metadata.bodySnippet}
                                  </Typography>
                                ) : (
                                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                    Click "Open Thread" to view the full email content, reply, or forward.
                                  </Typography>
                                )}
                              </Box>
                            ) : it.description ? (
                              <Typography variant="body2" color="text.secondary">
                                {it.description}
                              </Typography>
                            ) : it.metadata?.priority || it.metadata?.taskType || it.metadata?.status ? (
                              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                {it.metadata?.priority && (
                                  <Typography variant="caption" color="text.secondary">
                                    <strong>Priority:</strong> {it.metadata.priority}
                                  </Typography>
                                )}
                                {it.metadata?.taskType && (
                                  <Typography variant="caption" color="text.secondary">
                                    <strong>Type:</strong> {it.metadata.taskType}
                                  </Typography>
                                )}
                                {it.metadata?.status && (
                                  <Typography variant="caption" color="text.secondary">
                                    <strong>Status:</strong> {it.metadata.status}
                                  </Typography>
                                )}
                              </Box>
                            ) : (
                              <Typography variant="body2" color="text.secondary">No additional details</Typography>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
      {/* Pagination Footer */}
      {filtered.length > 0 && (
        <StandardTablePagination
          count={filtered.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      )}

      {/* Email Thread Drawer */}
      {selectedEmailThreadId && (
        <EmailThreadView
          open={emailDrawerOpen}
          onClose={() => {
            setEmailDrawerOpen(false);
            setSelectedEmailThreadId(null);
          }}
          threadId={selectedEmailThreadId}
          tenantId={tenantId}
        />
      )}
    </Box>
  );
};

export default ContactActivityTab;
