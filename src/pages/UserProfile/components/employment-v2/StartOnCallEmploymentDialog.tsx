import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../../firebase';
import { p } from '../../../../data/firestorePaths';
import type { EmploymentEntityKey } from './employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, resolveEntityFirestoreIdForTab } from '../../../../utils/employmentEntityPresentation';

export interface StartOnCallEmploymentDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  profileUserId: string;
  /** Current entity tab — pre-select matching hiring entity when possible. */
  entityKey: EmploymentEntityKey;
  onSuccess: () => void;
}

type EntityOption = { id: string; name: string };

const startOnCallFn = httpsCallable<
  {
    tenantId: string;
    userId: string;
    entityId: string;
    workerType?: 'w2' | '1099' | 'entity_default';
    screeningPackageId?: string | null;
    screeningPackageName?: string | null;
    note?: string | null;
  },
  { pipelineId: string; created: boolean; entityKey: string; hiringEntityId: string; entityName: string }
>(functions, 'startOnCallOnboarding');

const StartOnCallEmploymentDialog: React.FC<StartOnCallEmploymentDialogProps> = ({
  open,
  onClose,
  tenantId,
  profileUserId,
  entityKey,
  onSuccess,
}) => {
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [entityId, setEntityId] = useState('');
  const [workerType, setWorkerType] = useState<'entity_default' | 'w2' | '1099'>('entity_default');
  const [packageId, setPackageId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntities = useCallback(async () => {
    setLoadingEntities(true);
    try {
      const snap = await getDocs(collection(db, p.entities(tenantId)));
      const list: EntityOption[] = snap.docs.map((d) => {
        const data = d.data() as { name?: string };
        return { id: d.id, name: String(data.name || d.id) };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setEntities(list);
    } catch {
      setEntities([]);
    } finally {
      setLoadingEntities(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    void loadEntities();
  }, [open, loadEntities]);

  useEffect(() => {
    if (!open || entities.length === 0) return;
    const brief = entities.map((e) => ({ id: e.id, name: e.name, entityCode: '' }));
    const resolved = resolveEntityFirestoreIdForTab(entityKey, brief, null);
    if (resolved) {
      setEntityId(resolved);
    } else {
      setEntityId((prev) => prev || entities[0]?.id || '');
    }
  }, [open, entities, entityKey]);

  const handleSubmit = async () => {
    setError(null);
    if (!entityId.trim()) {
      setError('Select a hiring entity.');
      return;
    }
    setSubmitting(true);
    try {
      await startOnCallFn({
        tenantId,
        userId: profileUserId,
        entityId: entityId.trim(),
        workerType,
        screeningPackageId: packageId.trim() || null,
        screeningPackageName: packageName.trim() || null,
        note: note.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const fe = e as { message?: string; code?: string };
      const raw = typeof fe?.message === 'string' ? fe.message.trim() : '';
      const msg =
        raw && raw !== 'INTERNAL'
          ? raw
          : typeof fe?.code === 'string'
            ? `${fe.code.replace(/^functions\//, '')}: request failed`
            : 'Request failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Start on-call employment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Opens entity employment and the standard onboarding pipeline for this worker <strong>without</strong> an
            assignment — for labor pool / pre-placement hiring. Configure automation for trigger{' '}
            <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
              on_call_employment_started
            </Typography>{' '}
            and message type On-call employment started if you want templated notifications.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl fullWidth size="small" disabled={loadingEntities}>
            <InputLabel id="oncall-entity-label">Hiring entity</InputLabel>
            <Select
              labelId="oncall-entity-label"
              label="Hiring entity"
              value={entityId}
              onChange={(e) => setEntityId(String(e.target.value))}
            >
              {entities.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {loadingEntities ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <CircularProgress size={24} />
            </Box>
          ) : null}
          <FormControl fullWidth size="small">
            <InputLabel id="oncall-wt-label">Worker type</InputLabel>
            <Select
              labelId="oncall-wt-label"
              label="Worker type"
              value={workerType}
              onChange={(e) => setWorkerType(e.target.value as 'entity_default' | 'w2' | '1099')}
            >
              <MenuItem value="entity_default">Use entity default</MenuItem>
              <MenuItem value="w2">W-2</MenuItem>
              <MenuItem value="1099">1099</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Screening package ID (optional)"
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            size="small"
            fullWidth
            helperText="AccuSource / SourceDirect package id — orders only when integration is enabled and you have access."
          />
          <TextField
            label="Screening package name (optional)"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Internal note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <Typography variant="caption" color="text.secondary">
            Entity tabs: {EMPLOYMENT_ENTITY_KEYS.join(', ')} — pick the legal entity that matches this worker&apos;s
            hiring path.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting || !entityId}>
          {submitting ? <CircularProgress size={22} /> : 'Start on-call employment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StartOnCallEmploymentDialog;
