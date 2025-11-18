import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
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
  IconButton,
  Chip,
  Avatar,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Note as NoteIcon,
  Add as AddIcon,
  AttachFile as AttachFileIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, getDocs, query, orderBy, where, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { db, storage } from '../firebase';
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
  
  // Form state
  const [newNote, setNewNote] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [noteCategory, setNoteCategory] = useState<Note['category']>('general');
  const [notePriority, setNotePriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  
  // Job order specific tags
  const jobOrderTags = [
    'Staffing', 'Compliance', 'Performance', 'Client Feedback', 'Scheduling',
    'Payroll', 'Onboarding', 'Training', 'Safety', 'Quality', 'Attendance'
  ];
  
  // CRM specific tags
  const crmTags = [
    'Lead', 'Prospect', 'Customer', 'Meeting', 'Follow-up', 'Proposal',
    'Negotiation', 'Closing', 'Contract', 'Renewal', 'Issue', 'Opportunity'
  ];
  
  const availableTags = entityType === 'jobOrder' ? jobOrderTags : crmTags;



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



  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const filesArray = Array.from(event.target.files);
      setSelectedFiles(prev => [...prev, ...filesArray]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitNote = async () => {
    if (!newNote.trim() || !currentUser) return;

    setUploading(true);
    setLoading(true);
    try {
      // Upload files if any
      const uploadedFiles = [];
      for (const file of selectedFiles) {
        try {
          const fileName = `${Date.now()}_${file.name}`;
          const storagePath = entityType === 'jobOrder' 
            ? `job_orders/${entityId}/notes/${fileName}`
            : `${entityType}_notes/${entityId}/${fileName}`;
          const storageRef = ref(storage, storagePath);
          await uploadBytes(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);
          uploadedFiles.push({
            name: file.name,
            url: downloadURL,
            type: file.type,
          });
        } catch (error) {
          console.error('Error uploading file:', error);
          setSuccessMessage('Error uploading file(s)');
          setShowSuccess(true);
          return;
        }
      }

      // Create note document
      const noteData = {
        content: newNote.trim(),
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email || 'Unknown',
        authorRole: userRole,
        timestamp: serverTimestamp(),
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        category: noteCategory,
        priority: notePriority,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        aiReviewed: false,
        entityId,
        entityType,
        tenantId,
      };

      const collectionName = entityType === 'jobOrder' ? 'job_order_notes' : `${entityType}_notes`;
      const notesRef = collection(db, 'tenants', tenantId, collectionName);
      await addDoc(notesRef, noteData);

      // Reset form
      setNewNote('');
      setSelectedFiles([]);
      setNoteCategory('general');
      setNotePriority('medium');
      setSelectedTags([]);

      // Reload notes
      await loadNotes();

      setSuccessMessage('Note added successfully');
      setShowSuccess(true);
    } catch (error) {
      console.error('Error adding note:', error);
      setSuccessMessage('Error adding note');
      setShowSuccess(true);
    } finally {
      setUploading(false);
      setLoading(false);
    }
  };

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
    <Box sx={{ px: 0, py: 0 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 0, mb: 0, px: 3 }}>
        <Typography variant="h6" fontWeight={700}>
          {entityType === 'contact' ? 'Contact' : entityType === 'location' ? 'Location' : entityType === 'deal' ? 'Deal' : entityType === 'jobOrder' ? 'Job Order' : 'Company'} Notes History ({notes.length})
        </Typography>
      </Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, px: 3 }}>
        {entityType === 'location' 
          ? 'Add notes about this location. Location notes and company notes tagged for this location will be shown together.'
          : entityType === 'deal'
          ? 'Add notes, observations, and feedback about this deal. All notes trigger AI review for insights.'
          : entityType === 'jobOrder'
          ? 'Add notes, observations, and feedback about this job order. All notes trigger AI review for insights.'
          : `Add notes, observations, and feedback about this ${entityType}. All notes trigger AI review for insights.`}
      </Typography>
      <Divider sx={{ my: 2 }} />

      {/* Add Note Form */}
      <Box sx={{ px: 3, mb: 3 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <NoteIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6">Add New Note</Typography>
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Note Content"
              multiline
              rows={4}
              fullWidth
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={`Enter your note, observation, or feedback about this ${entityType === 'jobOrder' ? 'job order' : entityType}...`}
              variant="outlined"
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value as Note['category'])}
                label="Category"
              >
                {entityType === 'jobOrder' ? (
                  <>
                    <MenuItem value="general">General</MenuItem>
                    <MenuItem value="staffing">Staffing</MenuItem>
                    <MenuItem value="compliance">Compliance</MenuItem>
                    <MenuItem value="performance">Performance</MenuItem>
                    <MenuItem value="client_feedback">Client Feedback</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </>
                ) : (
                  <>
                    <MenuItem value="general">General</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="meeting">Meeting</MenuItem>
                    <MenuItem value="follow_up">Follow-up</MenuItem>
                    <MenuItem value="proposal">Proposal</MenuItem>
                    <MenuItem value="negotiation">Negotiation</MenuItem>
                    <MenuItem value="closing">Closing</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </>
                )}
              </Select>
            </FormControl>
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={notePriority}
                onChange={(e) => setNotePriority(e.target.value as any)}
                label="Priority"
              >
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="subtitle2" gutterBottom>
              Tags (optional)
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {availableTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  onClick={() => {
                    if (selectedTags.includes(tag)) {
                      setSelectedTags(selectedTags.filter(t => t !== tag));
                    } else {
                      setSelectedTags([...selectedTags, tag]);
                    }
                  }}
                  color={selectedTags.includes(tag) ? 'primary' : 'default'}
                  variant={selectedTags.includes(tag) ? 'filled' : 'outlined'}
                  size="small"
                />
              ))}
            </Box>
          </Grid>

          <Grid item xs={12}>
            <Box display="flex" alignItems="center" gap={2}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<AttachFileIcon />}
              >
                Attach Files
                <input
                  type="file"
                  hidden
                  multiple
                  onChange={handleFileSelect}
                />
              </Button>
              {selectedFiles.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {selectedFiles.length} file(s) selected
                </Typography>
              )}
            </Box>
            
            {selectedFiles.length > 0 && (
              <Box mt={1}>
                {selectedFiles.map((file, index) => (
                  <Chip
                    key={index}
                    label={file.name}
                    onDelete={() => removeFile(index)}
                    size="small"
                    sx={{ mr: 1, mb: 1 }}
                  />
                ))}
              </Box>
            )}
          </Grid>

          <Grid item xs={12}>
            <Button
              variant="contained"
              onClick={handleSubmitNote}
              disabled={!newNote.trim() || uploading || loading}
              startIcon={<AddIcon />}
              size="large"
            >
              {uploading ? 'Uploading...' : loading ? 'Adding Note...' : 'Add Note & Trigger AI Review'}
            </Button>
          </Grid>
        </Grid>
      </Box>

      {/* Notes History */}
      <Card sx={{ p: 0, m: 0 }}>
        <CardContent sx={{ p: 0, m: 0 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <Typography>Loading notes...</Typography>
            </Box>
          ) : notes.length === 0 ? (
            <Box textAlign="center" p={3}>
              <Typography variant="body2" color="text.secondary">
                No notes yet. Add the first note above.
              </Typography>
            </Box>
          ) : (
            <TableContainer 
              component={Paper} 
              variant="outlined"
              sx={{
                overflowX: 'auto',
                borderRadius: '8px',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
              }}
            >
              <Table sx={{ minWidth: 1200 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Content
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Author
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Date
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {notes.map((note) => (
                    <TableRow 
                      key={note.id}
                      sx={{
                        height: '48px',
                        '&:hover': {
                          backgroundColor: '#F9FAFB'
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
        </CardContent>
      </Card>

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