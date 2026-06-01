/**
 * LinkVenueToAccountDialog — opens from the /shifts/log "Link to
 * account" button on a NEEDS REVIEW entry. The recruiter picks the
 * correct HRX child account; on submit, the callable writes the alias
 * + re-runs the matcher so the row flips to MATCHED immediately.
 *
 * Subsequent Indeed Flex emails carrying the same normalized venueName
 * route via the matcher's alias short-circuit — no fuzzy guesswork.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { callLinkVenueToAccount } from '../../services/linkVenueToAccountCallable';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

interface AccountOption {
  id: string;
  name: string;
  /** Optional locality from the account doc for disambiguation in the dropdown. */
  city?: string;
  state?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: {
    accountName: string;
    rematchConfidence?: 'exact' | 'fuzzy' | 'multiple' | 'none';
  }) => void;
  tenantId: string;
  /** Raw venue string from the log entry — pre-filled, not editable. */
  venueName: string;
  /** Optional — pass the originating log entry id so the callable can
   *  re-run the matcher on it after the alias is written. */
  requestId?: string;
  /** Optional — top fuzzy candidates from the existing match attempt.
   *  Pre-rank these in the dropdown so the recruiter doesn't have to
   *  hunt for the one the matcher almost-picked. */
  suggestedAccountIds?: string[];
}

function formatSubtitle(a: AccountOption): string {
  return [a.city, a.state].filter(Boolean).join(', ');
}

const LinkVenueToAccountDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  venueName,
  requestId,
  suggestedAccountIds,
}) => {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AccountOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'accounts'));
        if (cancelled) return;
        const list: AccountOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const name = String(data.name ?? '').trim();
            if (!name) return null;
            const addr =
              (data.address as Record<string, unknown> | undefined) ??
              (data.primaryAddress as Record<string, unknown> | undefined) ??
              {};
            return {
              id: d.id,
              name,
              city: String(addr.city ?? data.city ?? '') || undefined,
              state: String(addr.state ?? data.state ?? '') || undefined,
            } as AccountOption;
          })
          .filter((x): x is AccountOption => !!x);
        // Sort: suggestions first (preserve given order), then alpha.
        const suggested = new Set(suggestedAccountIds ?? []);
        list.sort((a, b) => {
          const aS = suggested.has(a.id) ? 0 : 1;
          const bS = suggested.has(b.id) ? 0 : 1;
          if (aS !== bS) return aS - bS;
          return a.name.localeCompare(b.name);
        });
        setAccounts(list);
      } catch (e) {
        if (!cancelled) {
          console.warn('[LinkVenueToAccountDialog] failed to load accounts', e);
          setError(formatFirebaseHttpsError(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, suggestedAccountIds]);

  const canSubmit = useMemo(
    () => !!selected && !submitting,
    [selected, submitting],
  );

  const handleSubmit = async (): Promise<void> => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await callLinkVenueToAccount(functions, {
        tenantId,
        venueName,
        accountId: selected.id,
        ...(requestId ? { requestId } : {}),
      });
      onSuccess({
        accountName: data.accountName,
        rematchConfidence: data.rematchConfidence,
      });
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const suggestedIdSet = useMemo(() => new Set(suggestedAccountIds ?? []), [suggestedAccountIds]);

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Link venue to account</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            The next Indeed Flex email carrying this venue string will route
            automatically — no fuzzy match, no recruiter review. SVC codes
            and city prefixes are normalized away, so one alias covers
            every variant.
          </Typography>

          <Box
            sx={{
              p: 1.5,
              backgroundColor: 'grey.50',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Venue from email
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', mt: 0.5, wordBreak: 'break-all' }}
            >
              {venueName}
            </Typography>
          </Box>

          <Autocomplete<AccountOption, false, false, false>
            value={selected}
            onChange={(_, v) => setSelected(v)}
            options={accounts}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={loading}
            groupBy={(o) =>
              suggestedIdSet.has(o.id) ? 'Top fuzzy candidates' : 'All accounts'
            }
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <ListItemText
                  primary={option.name}
                  secondary={formatSubtitle(option)}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="HRX account"
                placeholder="Type to filter…"
                autoFocus
                helperText={
                  loading
                    ? 'Loading accounts…'
                    : `${accounts.length} accounts available`
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
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
          disabled={!canSubmit}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : null
          }
        >
          {submitting ? 'Linking…' : 'Link account'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LinkVenueToAccountDialog;
