import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  AutoAwesome as AutoAwesomeIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Contact {
  id: string;
  fullName: string;
  email: string;
  title?: string;
}

interface AddNoteDialogProps {
  open: boolean;
  onClose: () => void;
  entityId: string;
  entityType: 'contact' | 'company' | 'location' | 'deal';
  entityName: string;
  tenantId: string;
  contacts?: Contact[];
  onNoteAdded?: () => void;
}

const AddNoteDialog: React.FC<AddNoteDialogProps> = ({
  open,
  onClose,
  entityId,
  entityType,
  entityName,
  tenantId,
  contacts = [],
  onNoteAdded
}) => {
  const { currentUser } = useAuth();
  const [noteContent, setNoteContent] = useState('');
  const [selectedContact, setSelectedContact] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');

  // Auto-select contact if there's only one available
  useEffect(() => {
    if (contacts.length === 1) {
      setSelectedContact(contacts[0].id);
    } else {
      setSelectedContact('');
    }
  }, [contacts]);

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
      // Create note data
      const noteData = {
        content: noteContent.trim(),
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email || 'Unknown User',
        authorRole: 'hrx' as const,
        timestamp: serverTimestamp(),
        aiReviewed: false,
        source: entityType,
        entityId,
        entityType,
        tenantId,
        ...(selectedContact && { contactId: selectedContact }),
        ...(selectedFiles.length > 0 && { files: selectedFiles.map(f => ({ name: f.name, type: f.type })) })
      };

      // Add note to Firestore
      const notesRef = collection(db, 'tenants', tenantId, `${entityType}_notes`);
      const docRef = await addDoc(notesRef, noteData);

      // Trigger AI review (optional - skip if function doesn't exist)
      try {
        const functions = getFunctions();
        const triggerAIReview = httpsCallable(functions, 'triggerAINoteReview');
        
        await triggerAIReview({
          noteId: docRef.id,
          tenantId,
          entityId,
          entityType,
          content: noteContent.trim(),
          category: 'general',
          priority: 'medium',
          tags: []
        });
      } catch (aiError) {
        console.warn('Callable failed, falling back to HTTP:', aiError);
        
        // HTTP fallback for CORS issues
        try {
          const resp = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/triggerAINoteReviewHttp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              noteId: docRef.id,
              tenantId,
              entityId,
              entityType,
              content: noteContent.trim(),
              category: 'general',
              priority: 'medium',
              tags: []
            })
          });
          
          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`HTTP fallback failed: ${resp.status} ${errText}`);
          }
          
          console.log('AI review completed via HTTP fallback');
        } catch (httpErr) {
          console.warn('AI review function not available, note saved without AI processing:', httpErr);
          // Continue without AI review - the note is still saved successfully
        }
      }

      // Reset form
      setNoteContent('');
      setSelectedContact('');
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
      setSelectedContact('');
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
            Add notes, observations, and feedback about this {entityType}. All notes trigger AI review for insights.
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
              placeholder={`Enter your note, observation, or feedback about this ${entityType}...`}
              variant="outlined"
              disabled={aiProcessing}
            />

            {/* Company Contact */}
            {contacts.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Company Contact (optional)</InputLabel>
                <Select
                  value={selectedContact}
                  onChange={(e) => setSelectedContact(e.target.value)}
                  label="Company Contact (optional)"
                  disabled={aiProcessing}
                >
                  <MenuItem value="">
                    <em>No contact selected</em>
                  </MenuItem>
                  {contacts.map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName} {contact.title && `(${contact.title})`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

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
          {aiProcessing ? 'Processing with AI...' : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddNoteDialog;
