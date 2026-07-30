/**
 * SyncWcToEvereeDialog — push the HRX WC rate matrix into an Everee company
 * instance (Greg 2026-07-31). Everee validates (code, state) on every
 * worked-shift against ITS own table, so codes+rates must exist there too.
 *
 * Flow: pick the Everee-linked entity → Preview (dry-run, read-only) shows
 * the plan (create / update / in-sync / conflicts / Everee-only) → Apply
 * writes to Everee (POST new, PUT changed; never deletes). Wraps the
 * `syncWorkersCompToEveree` callable (SL7-gated).
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';

interface PlanEntry {
  state: string;
  code: string;
  rate: number;
  name?: string;
  evereeRate?: number;
}
interface Conflict {
  state: string;
  code: string;
  rates: number[];
}
interface Plan {
  creates: PlanEntry[];
  updates: PlanEntry[];
  inSync: PlanEntry[];
  conflicts: Conflict[];
  evereeOnly: PlanEntry[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
}

const SyncWcToEvereeDialog: React.FC<Props> = ({ open, onClose, tenantId }) => {
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    setPlan(null);
    setApplied(null);
    setError(null);
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'entities'));
        const list = snap.docs
          .map((d) => ({ id: d.id, name: String((d.data() as Record<string, unknown>).name || d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntities(list);
        if (list.length === 1) setEntityId(list[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load entities.');
      }
    })();
  }, [open, tenantId]);

  const run = async (dryRun: boolean) => {
    if (!entityId) return;
    setBusy(true);
    setError(null);
    if (dryRun) setApplied(null);
    try {
      const fn = httpsCallable<{ tenantId: string; entityId: string; dryRun: boolean }, Plan & { applied?: PlanEntry[] }>(
        functions,
        'syncWorkersCompToEveree',
        { timeout: 300000 },
      );
      const res = await fn({ tenantId, entityId, dryRun });
      setPlan(res.data);
      if (!dryRun) setApplied((res.data.creates?.length ?? 0) + (res.data.updates?.length ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const nToApply = plan ? plan.creates.length + plan.updates.length : 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Sync WC matrix → Everee</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Everee validates each (code, state) on every worked-shift, so your matrix codes + rates
            must exist on the Everee side. Preview shows what would change; nothing is written until you
            Apply. This never deletes Everee-only codes.
          </Typography>

          <FormControl fullWidth size="small">
            <InputLabel id="wc-sync-entity">Everee entity</InputLabel>
            <Select
              labelId="wc-sync-entity"
              label="Everee entity"
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setPlan(null);
                setApplied(null);
              }}
            >
              {entities.map((en) => (
                <MenuItem key={en.id} value={en.id}>
                  {en.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {plan && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip size="small" color="success" label={`${plan.creates.length} to create`} />
                <Chip size="small" color="warning" label={`${plan.updates.length} rate updates`} />
                <Chip size="small" variant="outlined" label={`${plan.inSync.length} in sync`} />
                {plan.conflicts.length > 0 && (
                  <Chip size="small" color="error" label={`${plan.conflicts.length} conflicts`} />
                )}
                <Chip size="small" variant="outlined" label={`${plan.evereeOnly.length} Everee-only`} />
              </Box>

              {applied != null && (
                <Alert severity="success">Applied {applied} change(s) to Everee.</Alert>
              )}

              {plan.conflicts.length > 0 && (
                <Alert severity="error">
                  {plan.conflicts.length} (state, code) pair(s) have disagreeing rates in HRX and were
                  skipped — fix the matrix so each pair has one rate:{' '}
                  {plan.conflicts
                    .slice(0, 6)
                    .map((c) => `${c.state} ${c.code} (${c.rates.join(' / ')})`)
                    .join(', ')}
                  {plan.conflicts.length > 6 ? '…' : ''}
                </Alert>
              )}

              {(plan.creates.length > 0 || plan.updates.length > 0) && (
                <Box sx={{ maxHeight: 220, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                  {plan.creates.map((c) => (
                    <Typography key={`c-${c.state}-${c.code}`} variant="caption" sx={{ display: 'block' }}>
                      <Chip size="small" color="success" label="new" sx={{ mr: 0.5, height: 18 }} />
                      {c.state} {c.code} — {c.name || 'Class'} @ ${c.rate.toFixed(2)}
                    </Typography>
                  ))}
                  {plan.updates.map((u) => (
                    <Typography key={`u-${u.state}-${u.code}`} variant="caption" sx={{ display: 'block' }}>
                      <Chip size="small" color="warning" label="rate" sx={{ mr: 0.5, height: 18 }} />
                      {u.state} {u.code} — ${(u.evereeRate ?? 0).toFixed(2)} → ${u.rate.toFixed(2)}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Typography variant="caption" color="text.secondary">
            Requires tenant security level 7.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button onClick={() => run(true)} disabled={!entityId || busy} startIcon={busy ? <CircularProgress size={16} /> : null}>
          {busy && !applied ? 'Working…' : 'Preview'}
        </Button>
        <Button
          variant="contained"
          onClick={() => run(false)}
          disabled={!plan || nToApply === 0 || busy}
        >
          {busy ? 'Applying…' : `Apply ${nToApply || ''}`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SyncWcToEvereeDialog;
