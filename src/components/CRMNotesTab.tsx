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
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Note as NoteIcon,
  Upload as UploadIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  AutoAwesome as AutoAwesomeIcon,
} from '@mui/icons-material';
import { db } from '../firebase';
import { doc, collection, addDoc, getDocs, query, orderBy, where, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

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
  category: 'general' | 'sales' | 'meeting' | 'follow_up' | 'proposal' | 'negotiation' | 'closing' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  aiReviewed: boolean;
  aiInsights?: string;
  tags?: string[];
  source?: 'location' | 'company' | 'contact' | 'deal';
}

interface CRMNotesTabProps {
  entityId: string;
  entityType: 'contact' | 'company' | 'location' | 'deal';
  entityName: string;
  tenantId: string;
  companyId?: string; // For location notes to filter up to company
}

const CRMNotesTab: React.FC<CRMNotesTabProps> = ({ entityId, entityType, entityName, tenantId, companyId }) => {
  const { currentUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [noteCategory, setNoteCategory] = useState<'general' | 'sales' | 'meeting' | 'follow_up' | 'proposal' | 'negotiation' | 'closing' | 'other'>('general');
  const [notePriority, setNotePriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null });
  const [userRole, setUserRole] = useState<'hrx' | 'agency' | 'customer'>('customer');
  const [aiProcessing, setAiProcessing] = useState(false);

  // Predefined tags for CRM notes
  const availableTags = [
    'Lead', 'Prospect', 'Customer', 'Meeting', 'Call', 'Email', 'Proposal', 
    'Negotiation', 'Closing', 'Follow-up', 'Objection', 'Competitor', 'Budget',
    'Timeline', 'Decision Maker', 'Influencer', 'Technical', 'Business', 'Strategic',
    // Location-specific tags
    ...(entityType === 'location' ? [
      'Facility', 'Equipment', 'Staffing', 'Operations', 'Maintenance', 'Safety',
      'Quality Control', 'Production', 'Logistics', 'Inventory', 'Shipping',
      'Receiving', 'Warehouse', 'Manufacturing', 'Assembly', 'Testing'
    ] : []),
    // Deal-specific tags
    ...(entityType === 'deal' ? [
      'Discovery', 'Qualification', 'Scoping', 'Proposal Drafted', 'Proposal Review',
      'Verbal Agreement', 'Closed Won', 'Closed Lost', 'Onboarding', 'Live Account',
      'Dormant', 'Revenue', 'Probability', 'Close Date', 'Owner', 'Stage Change',
      'Competitive Analysis', 'Value Proposition', 'ROI', 'Contract Terms'
    ] : [])
  ];

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
        // For contacts and companies, load normally
        const notesRef = collection(db, 'tenants', tenantId, `${entityType}_notes`);
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
      setSelectedFiles(Array.from(event.target.files));
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    try {
      setAiProcessing(true);
      
      // Create note data
      const noteData = {
        content: newNote,
        authorId: currentUser?.uid || '',
        authorName: currentUser?.displayName || currentUser?.email || 'Unknown',
        authorRole: userRole,
        timestamp: serverTimestamp(),
        category: noteCategory,
        priority: notePriority,
        tags: selectedTags,
        entityId: entityId,
        entityType: entityType,
        entityName: entityName,
        aiReviewed: false,
        files: [], // TODO: Implement file upload
      };

      // Add note to Firestore
      const notesRef = collection(db, 'tenants', tenantId, `${entityType}_notes`);
      const docRef = await addDoc(notesRef, noteData);

      // Trigger AI review
      try {
        const functions = getFunctions();
        const triggerAIReview = httpsCallable(functions, 'triggerAINoteReview');
        await triggerAIReview({
          noteId: docRef.id,
          entityType: entityType,
          tenantId: tenantId,
          content: newNote,
          category: noteCategory,
          priority: notePriority,
          tags: selectedTags
        });
      } catch (aiError) {
        console.warn('AI review failed:', aiError);
        // Continue without AI review
      }

      // Reset form
      setNewNote('');
      setSelectedFiles([]);
      setSelectedTags([]);
      setNoteCategory('general');
      setNotePriority('medium');

      // Show success message
      setSuccessMessage('Note added successfully and sent for AI review');
      setShowSuccess(true);

      // Reload notes
      await loadNotes();
    } catch (error) {
      console.error('Error adding note:', error);
      setSuccessMessage('Error adding note');
      setShowSuccess(true);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (window.confirm('Are you sure you want to delete this note?')) {
      try {
        const noteRef = doc(db, 'tenants', tenantId, `${entityType}_notes`, noteId);
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
      general: 'default',
      sales: 'primary',
      meeting: 'secondary',
      follow_up: 'info',
      proposal: 'warning',
      negotiation: 'error',
      closing: 'success',
      other: 'default'
    };
    return colors[category] || 'default';
  };

  const getPriorityColor = (priority: string) => {
    const colors: { [key: string]: any } = {
      low: 'success',
      medium: 'warning',
      high: 'error',
      urgent: 'error'
    };
    return colors[priority] || 'default';
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
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          {entityType === 'contact' ? 'Contact' : entityType === 'location' ? 'Location' : 'Company'} Notes
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {entityType === 'location' 
            ? `Add notes about this location. Location-specific notes and company notes tagged for this location will be shown together.`
            : `Add notes, observations, and feedback about this ${entityType}. All notes trigger AI review for insights.`
          }
        </Typography>
      </Box>

      {/* Add New Note Section */}
      <Card sx={{ mb: 3 }}>
        <CardHeader 
          title={
            <Box display="flex" alignItems="center" gap={1}>
              <NoteIcon color="primary" />
              <Typography variant="h6">Add New Note</Typography>
            </Box>
          }
        />
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Note Content"
                multiline
                rows={4}
                fullWidth
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={entityType === 'location' 
                  ? `Enter your note about this location (facility, operations, staffing, etc.)...`
                  : `Enter your note, observation, or feedback about this ${entityType}...`
                }
                variant="outlined"
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value as any)}
                  label="Category"
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="sales">Sales</MenuItem>
                  <MenuItem value="meeting">Meeting</MenuItem>
                  <MenuItem value="follow_up">Follow-up</MenuItem>
                  <MenuItem value="proposal">Proposal</MenuItem>
                  <MenuItem value="negotiation">Negotiation</MenuItem>
                  <MenuItem value="closing">Closing</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
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
                    size="small"
                    variant={selectedTags.includes(tag) ? "filled" : "outlined"}
                    color={selectedTags.includes(tag) ? "primary" : "default"}
                    onClick={() => handleTagToggle(tag)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>
            </Grid>
            
            <Grid item xs={12}>
              <Button
                variant="outlined"
                startIcon={<AttachFileIcon />}
                component="label"
                sx={{ mr: 2 }}
              >
                Attach Files
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={handleFileSelect}
                />
              </Button>
              {selectedFiles.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {selectedFiles.length} file(s) selected
                </Typography>
              )}
            </Grid>
            
            <Grid item xs={12}>
              <Button
                variant="contained"
                color="primary"
                startIcon={aiProcessing ? <AutoAwesomeIcon /> : <AddIcon />}
                onClick={handleAddNote}
                disabled={!newNote.trim() || aiProcessing}
                fullWidth
                size="large"
              >
                {aiProcessing ? 'Processing with AI...' : '+ Add Note & Trigger AI Review'}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Notes History */}
      <Card>
        <CardHeader 
          title={
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="h6">Notes History ({notes.length})</Typography>
            </Box>
          }
        />
        <CardContent>
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
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Content</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Author</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {notes.map((note) => (
                    <TableRow key={note.id}>
                      <TableCell>
                        <Typography variant="body2">
                          {truncateText(note.content)}
                        </Typography>
                        {note.tags && note.tags.length > 0 && (
                          <Box mt={1}>
                            {note.tags.map((tag) => (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant="outlined"
                                sx={{ mr: 0.5, mb: 0.5 }}
                              />
                            ))}
                          </Box>
                        )}
                        {note.files && note.files.length > 0 && (
                          <Box mt={1}>
                            <Chip
                              icon={<AttachFileIcon />}
                              label={`${note.files.length} file(s)`}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                        )}
                        {note.aiInsights && (
                          <Box mt={1}>
                            <Chip
                              icon={<AutoAwesomeIcon />}
                              label="AI Insights Available"
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          </Box>
                        )}
                        {note.source && note.source !== entityType && (
                          <Box mt={1}>
                            <Chip
                              label={`From ${note.source}`}
                              size="small"
                              color="secondary"
                              variant="outlined"
                            />
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={note.category}
                          color={getCategoryColor(note.category)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={note.priority}
                          color={getPriorityColor(note.priority)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                            {note.authorName.charAt(0).toUpperCase()}
                          </Avatar>
                          <Typography variant="body2">
                            {note.authorName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDate(note.timestamp)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5}>
                          <Tooltip title="View Details">
                            <IconButton
                              size="small"
                              onClick={() => setViewNoteDialog({ open: true, note })}
                            >
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteNote(note.id)}
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
                <Box display="flex" gap={1}>
                  <Chip
                    label={viewNoteDialog.note.category}
                    color={getCategoryColor(viewNoteDialog.note.category)}
                  />
                  <Chip
                    label={viewNoteDialog.note.priority}
                    color={getPriorityColor(viewNoteDialog.note.priority)}
                  />
                </Box>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box mb={2}>
                <Typography variant="body1" paragraph>
                  {viewNoteDialog.note.content}
                </Typography>
              </Box>
              
              {viewNoteDialog.note.tags && viewNoteDialog.note.tags.length > 0 && (
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
              )}

              {viewNoteDialog.note.files && viewNoteDialog.note.files.length > 0 && (
                <Box mb={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Attached Files:
                  </Typography>
                  {viewNoteDialog.note.files.map((file, index) => (
                    <Chip
                      key={index}
                      icon={<AttachFileIcon />}
                      label={file.name}
                      variant="outlined"
                      sx={{ mr: 1, mb: 1 }}
                    />
                  ))}
                </Box>
              )}

              {viewNoteDialog.note.aiInsights && (
                <Box mb={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    AI Insights:
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2">
                      {viewNoteDialog.note.aiInsights}
                    </Typography>
                  </Paper>
                </Box>
              )}

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