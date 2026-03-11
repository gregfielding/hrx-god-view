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
  Box,
  Autocomplete,
} from '@mui/material';
import { RecruiterAccountFormData } from '../../types/recruiter/account';

export interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: RecruiterAccountFormData) => Promise<void>;
  accountOptions?: Array<{ id: string; label: string }>;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({ open, onClose, onSubmit, accountOptions = [] }) => {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [parentAccountId, setParentAccountId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (!submitting) {
      setName('');
      setActive(true);
      setParentAccountId('');
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Account name is required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, active, parentAccountId: parentAccountId || null });
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Account</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            autoFocus
            label="Account Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            error={!!error}
            helperText={error}
            placeholder="e.g. Acme Corp"
          />
          <Autocomplete
            options={accountOptions}
            value={accountOptions.find((option) => option.id === parentAccountId) || null}
            onChange={(_, newValue) => setParentAccountId(newValue?.id || '')}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Parent Account"
                placeholder="Optional"
                helperText="Use this when creating a child account under a national or regional parent."
              />
            )}
          />
          <FormControlLabel
            control={
              <Switch
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                color="primary"
              />
            }
            label="Active"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Account'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddAccountModal;
