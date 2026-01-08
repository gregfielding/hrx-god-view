import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Avatar,
  Alert,
  Snackbar,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Skeleton,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { doc, collection, getDocs, query, orderBy, where, deleteDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';


interface Note {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorRole: 'hrx' | 'agency' | 'customer';
  timestamp: Date;
  files?: Array<{
    name: string;
    url: string;
    type: string;
  }>;
  category: 'general' | 'sales' | 'meeting' | 'follow_up' | 'proposal' | 'negotiation' | 'closing' | 'other' | 'staffing' | 'compliance' | 'performance' | 'client_feedback';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  aiReviewed: boolean;
  aiInsights?: string;
  tags?: string[];
  source?: 'location' | 'company' | 'contact' | 'deal' | 'jobOrder';
}

interface CRMNotesTabProps {
  entityId: string;
  entityType: 'contact' | 'company' | 'location' | 'deal' | 'jobOrder';
  entityName: string;
  tenantId: string;
  companyId?: string; // For location notes to filter up to company
}

const CRMNotesTab: React.FC<CRMNotesTabProps> = ({ entityId, entityType, entityName, tenantId, companyId }) => {
  const { currentUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null });
  const [userRole, setUserRole] = useState<'hrx' | 'agency' | 'customer'>('customer');
  
  // Form state removed - using Add Note dialog from layout instead



  useEffect(() => {
    loadNotes();
    determineUserRole();
  }, [entityId]);

  const determineUserRole = () => {
    if (currentUser?.email?.includes('hrx')) {
      setUserRole('hrx');
    } else if (currentUser?.tenantId) {
      setUserRole('agency');
    } else {
      setUserRole('customer');
    }
  };

  const loadNotes = async () => {
    try {
      setLoading(true);
      let notesData: Note[] = [];

      if (entityType === 'location' && companyId) {
        // For locations, load both location-specific notes and company notes with location tag
        const locationNotesRef = collection(db, 'tenants', tenantId, 'location_notes');
        const locationNotesQuery = query(
          locationNotesRef,
          where('entityId', '==', entityId),
          orderBy('timestamp', 'desc')
        );
        const locationNotesSnapshot = await getDocs(locationNotesQuery);
        const locationNotes = locationNotesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate() || new Date(),
          source: 'location'
        })) as Note[];

        // Load company notes that are tagged for this location
        const companyNotesRef = collection(db, 'tenants', tenantId, 'company_notes');
        const companyNotesQuery = query(
          companyNotesRef,
          where('entityId', '==', companyId),
          orderBy('timestamp', 'desc')
        );
        const companyNotesSnapshot = await getDocs(companyNotesQuery);
        const companyNotes = companyNotesSnapshot.docs
          .map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              timestamp: data.timestamp?.toDate() || new Date(),
              source: 'company'
            } as Note;
          })
          .filter(note => note.tags && note.tags.includes(`Location: ${entityName}`));

        // Combine and sort by timestamp
        notesData = [...locationNotes, ...companyNotes].sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      } else {
        // For contacts, companies, deals, and job orders, load normally
        const collectionName = entityType === 'jobOrder' ? 'job_order_notes' : `${entityType}_notes`;
        const notesRef = collection(db, 'tenants', tenantId, collectionName);
        const notesQuery = query(
          notesRef,
          where('entityId', '==', entityId),
          orderBy('timestamp', 'desc')
        );
        const notesSnapshot = await getDocs(notesQuery);
        notesData = notesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate() || new Date(),
          source: entityType
        })) as Note[];
      }

      setNotes(notesData);
    } catch (error) {
      console.error('Error loading notes:', error);
    } finally {
      setLoading(false);
    }
  };



  // Form functions removed - using Add Note dialog from layout instead

  const handleDeleteNote = async (noteId: string) => {
    if (window.confirm('Are you sure you want to delete this note?')) {
      try {
        const collectionName = entityType === 'jobOrder' ? 'job_order_notes' : `${entityType}_notes`;
        const noteRef = doc(db, 'tenants', tenantId, collectionName, noteId);
        await deleteDoc(noteRef);
        await loadNotes();
        setSuccessMessage('Note deleted successfully');
        setShowSuccess(true);
      } catch (error) {
        console.error('Error deleting note:', error);
        setSuccessMessage('Error deleting note');
        setShowSuccess(true);
      }
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: any } = {
      general: 'primary',
      sales: 'primary',
      meeting: 'secondary',
      follow_up: 'info',
      proposal: 'warning',
      negotiation: 'error',
      closing: 'success',
      other: 'primary'
    };
    return colors[category] || 'primary';
  };

  const getPriorityColor = (priority: string) => {
    const colors: { [key: string]: any } = {
      low: 'success',
      medium: 'warning',
      high: 'error',
      urgent: 'error'
    };
    return colors[priority] || 'primary';
  };

  const truncateText = (text: string, maxLength = 100) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Notes Table with Fixed Header */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {loading ? (
          <TableContainer 
            component={Paper} 
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'auto',
              borderRadius: 0,
              border: '1px solid #EAEEF4',
              boxShadow: 'none',
              // Inbox-standard scrollbar
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
            <Table stickyHeader sx={{ minWidth: 1200 }}>
              <TableHead>
                <TableRow sx={{ height: '32px', backgroundColor: 'background.paper' }}>
                  {['Content', 'Author', 'Date', 'Actions'].map((header) => (
                    <TableCell key={header} sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 1,
                      backgroundColor: 'background.paper',
                    }}>
                      {header}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 3 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`} sx={{ bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA' }}>
                    <TableCell sx={{ py: 1.5 }}>
                      <Skeleton variant="text" width="100%" height={20} />
                      <Skeleton variant="text" width="60%" height={16} sx={{ mt: 0.5 }} />
                    </TableCell>
                    <TableCell sx={{ py: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="text" width={100} height={20} />
                      </Box>
                    </TableCell>
                    <TableCell sx={{ py: 1.5 }}>
                      <Skeleton variant="text" width={120} height={20} />
                    </TableCell>
                    <TableCell sx={{ py: 1.5 }}>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="circular" width={32} height={32} />
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : notes.length === 0 ? (
          <Box textAlign="center" py={8} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                No notes yet
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Use the "Add Note" button to create your first note
              </Typography>
            </Box>
          </Box>
        ) : (
          <TableContainer 
            component={Paper}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'auto',
              borderRadius: 0,
              border: '1px solid #EAEEF4',
              boxShadow: 'none',
              // Inbox-standard scrollbar
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
            <Table stickyHeader sx={{ minWidth: 1200 }}>
              <TableHead>
                <TableRow sx={{ height: '32px', backgroundColor: 'background.paper' }}>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    py: 1,
                    backgroundColor: 'background.paper',
                  }}>
                    Content
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    py: 1,
                    backgroundColor: 'background.paper',
                  }}>
                    Author
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    py: 1,
                    backgroundColor: 'background.paper',
                  }}>
                    Date
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    py: 1,
                    backgroundColor: 'background.paper',
                  }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notes.map((note, index) => (
                  <TableRow 
                    key={note.id}
                    sx={{
                      bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                      '&:hover': {
                        bgcolor: 'action.hover'
                      }
                    }}
                  >
                      <TableCell 
                        sx={{ py: 1, px: 2, cursor: 'pointer' }}
                        onClick={() => setViewNoteDialog({ open: true, note })}
                      >
                        <Typography sx={{
                          variant: "body2",
                          color: "#111827",
                          fontSize: '0.9375rem',
                          fontWeight: 600,
                          mb: 1
                        }}>
                          {truncateText(note.content)}
                        </Typography>
                        {note.tags && note.tags.length > 0 && (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                            {note.tags.map((tag) => (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.75rem',
                                  height: 20,
                                  '& .MuiChip-label': {
                                    px: 1
                                  }
                                }}
                              />
                            ))}
                          </Box>
                        )}
                        {note.files && note.files.length > 0 && (
                          <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
                            <Chip
                              label={`${note.files.length} file(s)`}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontSize: '0.75rem',
                                height: 20,
                                '& .MuiChip-label': {
                                  px: 1
                                }
                              }}
                            />
                          </Box>
                        )}
                        {/* AI Insights indicator removed */}
                        {note.source && note.source !== entityType && (
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Chip
                              label={`From ${note.source}`}
                              size="small"
                              color="secondary"
                              variant="outlined"
                              sx={{
                                fontSize: '0.75rem',
                                height: 20,
                                '& .MuiChip-label': {
                                  px: 1
                                }
                              }}
                            />
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Avatar sx={{ 
                            width: 32, 
                            height: 32, 
                            fontSize: '12px',
                            fontWeight: 600
                          }}>
                            {note.authorName.charAt(0).toUpperCase()}
                          </Avatar>
                          <Typography sx={{
                            variant: "body2",
                            color: "#374151",
                            fontSize: '0.875rem',
                            fontWeight: 500
                          }}>
                            {note.authorName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem'
                        }}>
                          {formatDate(note.timestamp)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Box display="flex" gap={1}>
                          <Tooltip title="View Note">
                            <IconButton
                              size="small"
                              onClick={() => setViewNoteDialog({ open: true, note })}
                            >
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete Note">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNote(note.id);
                              }}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* View Note Dialog */}
      <Dialog
        open={viewNoteDialog.open}
        onClose={() => setViewNoteDialog({ open: false, note: null })}
        maxWidth="md"
        fullWidth
      >
        {viewNoteDialog.note && (
          <>
            <DialogTitle>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Note Details</Typography>
                {/* <Box display="flex" gap={1}>
                  <Chip
                    label={viewNoteDialog.note.category}
                    color={getCategoryColor(viewNoteDialog.note.category)}
                  />
                  <Chip
                    label={viewNoteDialog.note.priority}
                    color={getPriorityColor(viewNoteDialog.note.priority)}
                  />
                </Box> */}
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box mb={2}>
                <Typography variant="body1" paragraph>
                  {viewNoteDialog.note.content}
                </Typography>
              </Box>
              
              {/* {viewNoteDialog.note.tags && viewNoteDialog.note.tags.length > 0 && (
                <Box mb={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Tags:
                  </Typography>
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {viewNoteDialog.note.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" />
                    ))}
                  </Box>
                </Box>
              )} */}

              {viewNoteDialog.note.files && viewNoteDialog.note.files.length > 0 && (
                <Box mb={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Attached Files:
                  </Typography>
                  {viewNoteDialog.note.files.map((file, index) => (
                    <Chip
                      key={index}
                      label={file.name}
                      variant="outlined"
                      component="a"
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      clickable
                      sx={{ mr: 1, mb: 1 }}
                    />
                  ))}
                </Box>
              )}

              {/* AI Insights section removed */}

              <Divider sx={{ my: 2 }} />
              
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                  <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                    {viewNoteDialog.note.authorName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {viewNoteDialog.note.authorName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(viewNoteDialog.note.timestamp)}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewNoteDialog({ open: false, note: null })}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Success/Error Snackbar */}
      <Snackbar
        open={showSuccess}
        autoHideDuration={4000}
        onClose={() => setShowSuccess(false)}
      >
        <Alert
          onClose={() => setShowSuccess(false)}
          severity={successMessage.includes('Error') ? 'error' : 'success'}
          sx={{ width: '100%' }}
        >
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CRMNotesTab; 