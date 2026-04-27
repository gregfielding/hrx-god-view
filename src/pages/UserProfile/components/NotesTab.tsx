import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
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
  Alert,
  Snackbar,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { doc, collection, getDocs, query, orderBy, deleteDoc } from 'firebase/firestore';

import { db } from '../../../firebase';

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

const NotesTab: React.FC<NotesTabProps> = ({ uid }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState<{ open: boolean; note: Note | null }>({ open: false, note: null });

  useEffect(() => {
    loadNotes();
  }, [uid]);

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card>
        <CardHeader 
          title={`Notes (${notes.length})`}
          titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
        />
        <CardContent sx={{ p: 2 }}>
          {loading ? (
            <Typography>Loading notes...</Typography>
          ) : notes.length === 0 ? (
            <Typography color="text.secondary">
              No notes yet. Use the Add Note button in the header.
            </Typography>
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