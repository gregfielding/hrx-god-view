/**
 * New Channel Dialog Component
 * 
 * Dialog for creating a new channel
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Typography,
  Alert,
  Box,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface NewChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onChannelCreated: () => void;
  tenantId: string;
  userId: string;
}

const NewChannelDialog: React.FC<NewChannelDialogProps> = ({
  open,
  onClose,
  onChannelCreated,
  tenantId,
  userId,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Channel name is required');
      return;
    }

    // Validate channel name (alphanumeric, hyphens, underscores)
    if (!/^[a-z0-9-_]+$/i.test(name.trim())) {
      setError('Channel name must be alphanumeric with hyphens or underscores only');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const createChannel = httpsCallable(functions, 'createChannelApi');
      const result = await createChannel({
        tenantId,
        name: name.trim(),
        description: description.trim(),
        isPrivate,
      });

      const data = result.data as { success: boolean; error?: string };
      if (data.success) {
        setName('');
        setDescription('');
        setIsPrivate(false);
        onChannelCreated();
      } else {
        setError(data.error || 'Failed to create channel');
      }
    } catch (err: any) {
      console.error('Error creating channel:', err);
      setError(err.message || 'Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName('');
      setDescription('');
      setIsPrivate(false);
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Channel</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <TextField
          autoFocus
          margin="dense"
          label="Channel Name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., sales, recruiting, ops"
          helperText="Alphanumeric characters, hyphens, and underscores only"
          disabled={loading}
          sx={{ mb: 2 }}
        />

        <TextField
          margin="dense"
          label="Description (optional)"
          fullWidth
          variant="outlined"
          multiline
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this channel about?"
          disabled={loading}
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={loading}
            />
          }
          label="Private Channel"
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          Private channels are only visible to members
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleCreate} variant="contained" disabled={loading || !name.trim()}>
          {loading ? 'Creating...' : 'Create Channel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewChannelDialog;




