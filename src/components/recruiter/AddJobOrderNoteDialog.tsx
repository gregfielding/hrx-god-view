import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  AutoAwesome as AutoAwesomeIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface AddJobOrderNoteDialogProps {
  open: boolean;
  onClose: () => void;
  jobOrderId: string;
  jobOrderName: string;
  tenantId: string;
  onNoteAdded?: () => void;
}

const AddJobOrderNoteDialog: React.FC<AddJobOrderNoteDialogProps> = ({
  open,
  onClose,
  jobOrderId,
  jobOrderName,
  tenantId,
  onNoteAdded
}) => {
  const { currentUser } = useAuth();
  const [noteContent, setNoteContent] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setSelectedFiles(Array.from(event.target.files));
    }
  };

  const handleAddNote = async () => {
    if (!noteContent.trim() || !currentUser) return;

    setAiProcessing(true);
    setError('');

    try {
      // Create note data - matches the structure used in CRMNotesTab for job orders
      const noteData = {
        content: noteContent.trim(),
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email || 'Unknown User',
        authorRole: 'hrx' as const,
        timestamp: serverTimestamp(),
        category: 'general' as const,
        priority: 'medium' as const,
        aiReviewed: false,
        entityId: jobOrderId,
        entityType: 'jobOrder',
        tenantId,
        ...(selectedFiles.length > 0 && { files: selectedFiles.map(f => ({ name: f.name, type: f.type })) })
      };

      // Add note to Firestore - tenants/{tenantId}/job_order_notes collection
      const notesRef = collection(db, 'tenants', tenantId, 'job_order_notes');
      await addDoc(notesRef, noteData);

      // Reset form
      setNoteContent('');
      setSelectedFiles([]);
      
      // Close dialog and notify parent
      onClose();
      if (onNoteAdded) {
        onNoteAdded();
      }

    } catch (err: any) {
      console.error('Error adding note:', err);
      setError(err.message || 'Failed to add note. Please try again.');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleClose = () => {
    if (!aiProcessing) {
      setNoteContent('');
      setSelectedFiles([]);
      setError('');
      onClose();
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Add New Note</Typography>
          <IconButton onClick={handleClose} disabled={aiProcessing}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Add notes, observations, and feedback about this job order. All notes trigger AI review for insights.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Note Content */}
            <TextField
              label="Note Content"
              multiline
              rows={4}
              fullWidth
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Enter your note, observation, or feedback about this job order..."
              variant="outlined"
              disabled={aiProcessing}
            />

            {/* File Attachment */}
            <Box>
              <Button
                variant="outlined"
                startIcon={<AttachFileIcon />}
                component="label"
                disabled={aiProcessing}
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
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {selectedFiles.length} file(s) selected
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button 
          onClick={handleClose} 
          disabled={aiProcessing}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={aiProcessing ? <AutoAwesomeIcon /> : <AddIcon />}
          onClick={handleAddNote}
          disabled={!noteContent.trim() || aiProcessing}
          size="large"
        >
          {aiProcessing ? 'Submitting...' : '+ Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddJobOrderNoteDialog;
