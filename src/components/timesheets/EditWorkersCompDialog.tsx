/**
 * EditWorkersCompDialog — set a timesheet row's WC class code via the
 * `setEntryWorkersComp` callable. Asks for the CODE only; the (internal)
 * rate resolves server-side from the WC matrix by the row's worksite state
 * + code (Greg 2026-07-30).
 *
 * When the row's worksite `state` is known, the code field is a searchable
 * dropdown of the codes actually rated for that state in the matrix — each
 * shown with its catalog title + rate — so the recruiter picks from the
 * real options instead of typing a number (Greg 2026-07-31). Free typing is
 * still allowed for a code the matrix doesn't list yet.
 *
 * The callable stamps the override on the entry AND back-fills the shift
 * doc when its slot is empty, so one edit fixes every other entry on the
 * same shift.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { callSetEntryWorkersComp } from '../../services/setEntryWorkersCompCallable';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import { normalizeStateCode } from '../../utils/unemploymentRates';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tenantId: string;
  entryId: string;
  /** Worksite state — scopes the code dropdown to the matrix's codes for it. */
  state?: string;
  /** Pre-filled values — typically the row's resolved (override OR inherited)
   *  values so the recruiter sees what's effective today. */
  initialCode?: string;
  initialRate?: number;
  /** Optional descriptor for the row — e.g. "Aaron T · 2026-05-29". */
  rowLabel?: string;
}

interface WcOption {
  code: string;
  title: string;
  rate: number | null;
}

const EditWorkersCompDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  entryId,
  state,
  initialCode,
  initialRate,
  rowLabel,
}) => {
  const [code, setCode] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<WcOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const stateCode = normalizeStateCode(state ?? '').trim().toUpperCase();

  useEffect(() => {
    if (!open) return;
    setCode(initialCode ?? '');
    setError(null);
  }, [open, initialCode]);

  // Load the codes rated for this worksite state (matrix) + their catalog
  // titles, so the recruiter picks from the real options.
  useEffect(() => {
    if (!open || !tenantId || !stateCode) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoadingOptions(true);
    (async () => {
      try {
        const [rateSnap, catSnap] = await Promise.all([
          getDocs(
            query(collection(db, 'tenants', tenantId, 'workers_comp_rates'), where('state', '==', stateCode)),
          ),
          getDocs(collection(db, 'tenants', tenantId, 'workers_comp_class_codes')),
        ]);
        const titleByCode = new Map<string, string>();
        catSnap.forEach((d) => {
          const v = d.data() as Record<string, unknown>;
          const c = String(v.code ?? '').trim();
          if (c) titleByCode.set(c, String(v.title ?? '').trim());
        });
        const byCode = new Map<string, number | null>();
        rateSnap.forEach((d) => {
          const v = d.data() as Record<string, unknown>;
          const c = String(v.code ?? '').trim();
          if (!c) return;
          const r = Number(v.rate);
          const cur = byCode.get(c);
          const next = Number.isFinite(r) ? (cur == null ? r : Math.max(cur, r)) : cur ?? null;
          byCode.set(c, next);
        });
        const opts: WcOption[] = [...byCode.entries()]
          .map(([c, r]) => ({ code: c, title: titleByCode.get(c) ?? '', rate: r }))
          .sort((a, b) => a.code.localeCompare(b.code));
        if (!cancelled) setOptions(opts);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, stateCode]);

  const handleSubmit = async (): Promise<void> => {
    const trimmedCode = code.trim();
    setSubmitting(true);
    setError(null);
    try {
      await callSetEntryWorkersComp(
        functions,
        trimmedCode
          ? // Code only — the server resolves the (internal) rate from the WC
            // matrix by the row's worksite state + code.
            { tenantId, entryId, workersCompCode: trimmedCode }
          : // Blank code = clear the WC override (code + rate).
            { tenantId, entryId, workersCompCode: null, workersCompRate: null },
      );
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Workers' Comp — {rowLabel || 'entry'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {stateCode
              ? `Pick a class code rated for ${stateCode} — the (internal) rate resolves automatically from the matrix. `
              : 'Enter the class code — the (internal) rate resolves automatically from your WC matrix. '}
            Saves an override on this row AND back-fills the shift when its WC fields are empty, so
            other entries on the same shift inherit too.
          </Typography>

          <Autocomplete<WcOption, false, false, true>
            freeSolo
            options={options}
            loading={loadingOptions}
            inputValue={code}
            onInputChange={(_, v) => setCode(v)}
            onChange={(_, v) => {
              if (v && typeof v !== 'string') setCode(v.code);
              else if (typeof v === 'string') setCode(v);
            }}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.code)}
            filterOptions={(opts, s) => {
              const q = s.inputValue.trim().toLowerCase();
              if (!q) return opts;
              return opts.filter(
                (o) => o.code.toLowerCase().includes(q) || o.title.toLowerCase().includes(q),
              );
            }}
            renderOption={(props, o) => (
              <li {...props} key={o.code}>
                <Box>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                    {o.code}
                  </Typography>
                  {(o.title || o.rate != null) && (
                    <Typography variant="caption" color="text.secondary">
                      {o.title}
                      {o.rate != null ? `${o.title ? ' · ' : ''}$${o.rate.toFixed(2)} rate` : ''}
                    </Typography>
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="NCCI class code"
                placeholder="e.g. 8044"
                autoFocus
                helperText={
                  stateCode
                    ? `Codes rated for ${stateCode}. Rate resolves from the matrix; leave blank to clear WC.`
                    : "4-digit code from your insurer's schedule. Rate resolves from the matrix; leave blank to clear."
                }
              />
            )}
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditWorkersCompDialog;
