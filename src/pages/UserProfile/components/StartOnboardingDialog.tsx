/**
 * Start Onboarding — entity-driven.
 * Only required field: Entity. Worker type and E-Verify are taken from entity config.
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';

interface EntityOption {
  id: string;
  name: string;
  workerType?: string;
  everifyRequired?: boolean;
}

interface StartOnboardingDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  tenantId: string;
  onOnboardingStarted?: () => void;
}

const StartOnboardingDialog: React.FC<StartOnboardingDialogProps> = ({
  open,
  onClose,
  userId,
  tenantId,
  onOnboardingStarted,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entityId, setEntityId] = useState('');
  const [jobOrderId, setJobOrderId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open || !tenantId) {
      setEntities([]);
      return;
    }
    const load = async () => {
      setEntitiesLoading(true);
      try {
        const ref = collection(db, p.entities(tenantId));
        const snap = await getDocs(ref);
        const list = snap.docs
          .map((d) => {
            const data = d.data() as { name?: string; workerType?: string; everifyRequired?: boolean };
            return {
              id: d.id,
              name: data.name || d.id,
              workerType: data.workerType,
              everifyRequired: data.everifyRequired,
            };
          })
          .filter((e) => e.name);
        setEntities(list);
      } catch {
        setEntities([]);
      } finally {
        setEntitiesLoading(false);
      }
    };
    load();
  }, [open, tenantId]);

  const selectedEntity = entityId ? entities.find((e) => e.id === entityId) : null;

  const handleStart = async () => {
    if (!entityId.trim()) {
      setError('Please select an entity');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const callable = httpsCallable<
        { tenantId: string; userId: string; entityId: string | null; jobOrderId?: string | null },
        { success: boolean; pipelineId?: string; created?: boolean }
      >(functions, 'triggerWorkerOnboardingPipeline');
      await callable({
        tenantId,
        userId,
        entityId: entityId.trim(),
        jobOrderId: jobOrderId.trim() || null,
      });
      setEntityId('');
      setJobOrderId('');
      setNotes('');
      onClose();
      onOnboardingStarted?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to start onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setEntityId('');
      setJobOrderId('');
      setNotes('');
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Start Onboarding</Typography>
          <IconButton onClick={handleClose} disabled={loading}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the entity for this onboarding. Worker type and E-Verify requirement are set from the entity.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={2}>
            <FormControl fullWidth required>
              <InputLabel>Entity *</InputLabel>
              <Select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                label="Entity *"
                disabled={loading || entitiesLoading}
              >
                <MenuItem value="">
                  <em>Select entity</em>
                </MenuItem>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {selectedEntity && (
              <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Preview (from entity)
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Typography variant="body2">
                    Worker type: <strong>{selectedEntity.workerType === '1099' ? '1099' : selectedEntity.workerType === 'BOTH' ? 'W-2 or 1099' : 'W-2'}</strong>
                  </Typography>
                  <Typography variant="body2">
                    E-Verify: <strong>{selectedEntity.everifyRequired ? 'Required' : 'Not required'}</strong>
                  </Typography>
                </Stack>
              </Box>
            )}

            <TextField
              label="Job / assignment (optional)"
              value={jobOrderId}
              onChange={(e) => setJobOrderId(e.target.value)}
              fullWidth
              size="small"
              placeholder="Job order ID if applicable"
              disabled={loading}
            />
            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={1}
              disabled={loading}
            />
          </Stack>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} disabled={loading} variant="outlined">
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleStart}
          disabled={!entityId.trim() || loading || entitiesLoading}
          size="large"
        >
          {loading ? 'Starting...' : 'Start Onboarding'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StartOnboardingDialog;
