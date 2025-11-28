import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
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
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

// Types for contact activity items
type ContactActivityItem = {
  id: string;
  type: 'task' | 'email' | 'note' | 'call' | 'meeting' | 'ai_activity';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
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
  const [items, setItems] = useState<ContactActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<{ [id: string]: { bodyHtml?: string; bodySnippet?: string } }>({});
  const [expanding, setExpanding] = useState<boolean>(false);
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'email' | 'note'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(1);

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
        setPage(1);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    };
    load();
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleRowClick = async (it: ContactActivityItem) => {
    if (expandedId === it.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(it.id);
    // Only fetch email bodies
    if (it.type !== 'email') return;
    if (expandedContent[it.id]) return; // already loaded
    try {
      setExpanding(true);
      const functions = getFunctions();
      const getEmailLogBody = httpsCallable(functions, 'getEmailLogBody');
      // activity id is shaped like email_<docId>
      const emailLogId = it.id.replace(/^email_/, '');
      const resp: any = await getEmailLogBody({ tenantId, emailLogId });
      setExpandedContent(prev => ({ ...prev, [it.id]: { bodyHtml: resp?.data?.bodyHtml, bodySnippet: resp?.data?.bodySnippet } }));
    } catch (e) {
      console.warn('Failed to load email body', e);
    } finally {
      setExpanding(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card>
        <CardHeader 
          title="Contact Activity" 
          titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
          action={
            <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
              {total} results
            </Typography>
          }
        />
        <CardContent sx={{ p: 2 }}>
          {/* Filters */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={4} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select 
                  value={typeFilter} 
                  label="Type" 
                  onChange={(e) => { setTypeFilter(e.target.value as any); setPage(1); }}
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
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
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
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              />
            </Grid>
          </Grid>
          
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? (
            <Box>
              <TableContainer 
                component={Paper} 
                variant="outlined"
                sx={{
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      {['Type', 'Title', 'Description', 'When', ''].map((header) => (
                        <TableCell key={header} sx={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'text.secondary',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid',
                          borderColor: 'divider',
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
            </Box>
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
                overflowX: 'auto',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider'
              }}
            >
              <Table sx={{ minWidth: 1000 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 1.5
                    }}>
                      Type
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 1.5
                    }}>
                      Title
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 1.5
                    }}>
                      Description
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 1.5
                    }}>
                      When
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
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
                          bgcolor: 'grey.50' 
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
                          {it.type === 'email' ? (
                            <Box sx={{ p: 2 }}>
                              {expanding && !expandedContent[it.id] ? (
                                <Box display="flex" justifyContent="center"><CircularProgress size={20} /></Box>
                              ) : expandedContent[it.id]?.bodyHtml ? (
                                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }} dangerouslySetInnerHTML={{ __html: expandedContent[it.id].bodyHtml as string }} />
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  {expandedContent[it.id]?.bodySnippet || 'No content available'}
                                </Typography>
                              )}
                            </Box>
                          ) : (
                            <Box sx={{ p: 2 }}>
                              <Typography variant="body2" color="text.secondary">No additional details</Typography>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {/* Pagination */}
          {filtered.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
              <Button 
                size="small" 
                variant="outlined" 
                disabled={page <= 1} 
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Typography variant="body2" color="text.secondary">
                Page {page} of {totalPages}
              </Typography>
              <Button 
                size="small" 
                variant="outlined" 
                disabled={page >= totalPages} 
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ContactActivityTab;
