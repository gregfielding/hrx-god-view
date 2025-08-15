import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CardContent,
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
} from '@mui/material';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Note as NoteIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, getDocs, query, orderBy, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';


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
  category: 'general' | 'performance' | 'behavior' | 'compliance' | 'training' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  aiReviewed: boolean;
  aiInsights?: string;
  tags?: string[];
}

interface NotesTabProps {
  uid: string;
  user: any;
}

const NotesTab: React.FC<NotesTabProps> = ({ uid, user }) => {
  const { currentUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [noteCategory, setNoteCategory] = useState<'general' | 'performance' | 'behavior' | 'compliance' | 'training' | 'other'>('general');
  const [notePriority, setNotePriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null });
  const [userRole, setUserRole] = useState<'hrx' | 'agency' | 'customer'>('customer');

  // Predefined tags for easy selection
  const availableTags = [
    'Attendance', 'Performance', 'Skills', 'Training', 'Compliance', 
    'Behavior', 'Communication', 'Teamwork', 'Leadership', 'Technical',
    'Safety', 'Quality', 'Customer Service', 'Initiative', 'Reliability'
  ];

  useEffect(() => {
    loadNotes();
    determineUserRole();
  }, [uid]);

  const determineUserRole = () => {
    if (currentUser?.email?.includes('hrx')) {
      setUserRole('hrx');
    } else if (user?.tenantId) {
      setUserRole('agency');
    } else {
      setUserRole('customer');
    }
  };

  const loadNotes = async () => {
    setLoading(true);
    try {
      const notesRef = collection(db, 'users', uid, 'notes');
      const q = query(notesRef, orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const notesData: Note[] = [];
      querySnapshot.forEach((doc) => {
        notesData.push({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp.toDate(),
        } as Note);
      });
      
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
    if (!newNote.trim()) return;

    setLoading(true);
    try {
      // Upload files if any
      const uploadedFiles = [];
      for (const file of selectedFiles) {
        // In a real implementation, you'd upload to Firebase Storage
        // For now, we'll simulate the upload
        uploadedFiles.push({
          name: file.name,
          url: `https://storage.googleapis.com/example/${file.name}`,
          type: file.type,
        });
      }

      // Create note document
      const noteData = {
        content: newNote,
        authorId: currentUser?.uid || '',
        authorName: currentUser?.displayName || currentUser?.email || 'Unknown',
        authorRole: userRole,
        timestamp: new Date(),
        files: uploadedFiles,
        category: noteCategory,
        priority: notePriority,
        tags: selectedTags,
        aiReviewed: false,
        aiInsights: '',
      };

      const notesRef = collection(db, 'users', uid, 'notes');
      const docRef = await addDoc(notesRef, noteData);

      // Log the note creation
      await logNoteCreation(docRef.id, noteData);

      // Trigger AI review
      await triggerAIReview(uid, 'note_created', {
        noteId: docRef.id,
        content: newNote,
        category: noteCategory,
        priority: notePriority,
        tags: selectedTags,
      });

      // Reset form
      setNewNote('');
      setSelectedFiles([]);
      setNoteCategory('general');
      setNotePriority('medium');
      setSelectedTags([]);

      // Reload notes
      await loadNotes();

      setSuccessMessage('Note added successfully and AI review triggered');
      setShowSuccess(true);
    } catch (error) {
      console.error('Error adding note:', error);
      setSuccessMessage('Error adding note');
      setShowSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  const logNoteCreation = async (noteId: string, noteData: any) => {
    try {
      const functions = getFunctions();
      const logAIAction = httpsCallable(functions, 'logAIAction');
      
      await logAIAction({
        actionType: 'note_created',
        sourceModule: 'NotesTab',
        userId: uid,
        targetId: noteId,
        targetType: 'note',
        aiRelevant: true,
        contextType: 'worker_notes',
        urgencyScore: noteData.priority === 'urgent' ? 8 : noteData.priority === 'high' ? 6 : 4,
        eventType: 'worker.note.created',
        reason: `Note created: ${noteData.category} - ${noteData.priority} priority`,
        success: true,
        latencyMs: 0,
        versionTag: 'v1',
        metadata: {
          noteCategory: noteData.category,
          notePriority: noteData.priority,
          authorRole: noteData.authorRole,
          hasFiles: noteData.files?.length > 0,
          tags: noteData.tags,
        }
      });
    } catch (error) {
      console.error('Error logging note creation:', error);
    }
  };

  const triggerAIReview = async (workerId: string, triggerType: string, context: any) => {
    try {
      const functions = getFunctions();
      const logAIAction = httpsCallable(functions, 'logAIAction');
      
      // Log the AI review trigger instead of calling a non-existent function
      await logAIAction({
        actionType: 'ai_review_triggered',
        sourceModule: 'NotesTab',
        userId: workerId,
        targetId: workerId,
        targetType: 'worker_profile',
        aiRelevant: true,
        contextType: 'worker_notes',
        urgencyScore: context.priority === 'urgent' ? 8 : context.priority === 'high' ? 6 : 4,
        eventType: 'worker.ai_review.triggered',
        reason: `AI review triggered by ${triggerType}`,
        success: true,
        latencyMs: 0,
        versionTag: 'v1',
        metadata: {
          triggerType,
          context,
          reviewType: 'worker_profile_update',
          priority: context.priority || 'medium',
        }
      });
      
      console.log('AI review trigger logged successfully. The AI engine processor will handle the review.');
    } catch (error) {
      console.error('Error triggering AI review:', error);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;

    try {
      await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
      await loadNotes();
      setSuccessMessage('Note deleted successfully');
      setShowSuccess(true);
    } catch (error) {
      console.error('Error deleting note:', error);
      setSuccessMessage('Error deleting note');
      setShowSuccess(true);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      case 'low': return 'default';
      default: return 'default';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'performance': return 'primary';
      case 'behavior': return 'warning';
      case 'compliance': return 'error';
      case 'training': return 'success';
      case 'general': return 'primary';
      default: return 'primary';
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const truncateText = (text: string, maxLength = 100) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" gutterBottom>
        Worker Notes
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        Add notes, observations, and feedback about this worker. All notes trigger AI review for insights.
      </Typography>

      {/* Add Note Form */}
      <Box sx={{ pt: 3, pb: 3, mb: 3, borderRadius: 2 }}>
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
                placeholder="Enter your note, observation, or feedback about this worker..."
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
                  <MenuItem value="performance">Performance</MenuItem>
                  <MenuItem value="behavior">Behavior</MenuItem>
                  <MenuItem value="compliance">Compliance</MenuItem>
                  <MenuItem value="training">Training</MenuItem>
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
                disabled={!newNote.trim() || loading}
                startIcon={<AddIcon />}
                size="large"
              >
                {loading ? 'Adding Note...' : 'Add Note & Trigger AI Review'}
              </Button>
            </Grid>
          </Grid>
        </Box>

      {/* Notes Table */}
      <Box sx={{ pt: 3, pb: 3, mb: 3, borderRadius: 2 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <NoteIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6">Notes History ({notes.length})</Typography>
        </Box>
        <CardContent>
          {loading ? (
            <Typography>Loading notes...</Typography>
          ) : notes.length === 0 ? (
            <Typography color="text.secondary">No notes yet. Add the first note above.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Content</TableCell>
                    <TableCell>Author</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>AI Status</TableCell>
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
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Avatar sx={{ width: 24, height: 24 }}>
                            <PersonIcon fontSize="small" />
                          </Avatar>
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              {note.authorName}
                            </Typography>
                            <Chip
                              label={note.authorRole}
                              size="small"
                              variant="outlined"
                              color="primary"
                            />
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={note.category}
                          size="small"
                          color={getCategoryColor(note.category)}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={note.priority}
                          size="small"
                          color={getPriorityColor(note.priority)}
                        />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <ScheduleIcon fontSize="small" color="action" />
                          <Typography variant="body2">
                            {formatDate(note.timestamp)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={note.aiReviewed ? 'Reviewed' : 'Pending'}
                          size="small"
                          color={note.aiReviewed ? 'success' : 'warning'}
                        />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={1}>
                          <Tooltip title="View full note">
                            <IconButton
                              size="small"
                              onClick={() => setViewNoteDialog({ open: true, note })}
                            >
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete note">
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteNote(note.id)}
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

              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                  <Avatar sx={{ width: 32, height: 32 }}>
                    <PersonIcon />
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

      <Snackbar
        open={showSuccess}
        autoHideDuration={6000}
        onClose={() => setShowSuccess(false)}
      >
        <Alert onClose={() => setShowSuccess(false)} severity="success">
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default NotesTab; 