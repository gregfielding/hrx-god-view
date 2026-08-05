/**
 * FixAssignmentDialog — the "assignment card" for CSV-import rows
 * (Greg 2026-08-05: editing a worksite in isolation misses the point —
 * the fix is linking the row to a JOB ORDER and letting worksite,
 * position, pay and WC flow from it, materialized as a REAL assignment).
 *
 * One compact card: worker (fixed) → job order picker → worksite derived
 * from the JO → position / pay rate / WC code (pre-resolved from the
 * matrix, editable). Saving:
 *   1. `createImportAssignments` — creates ONE retro assignment covering
 *      every fixable row of this worker in view (notifications suppressed,
 *      `assignmentSource: 'import_backfill'`), stamped with JO + account +
 *      worksite(+state) + rate + WC. Reuses an existing assignment if the
 *      anchor id already exists.
 *   2. `reresolveImportEntry` per row — pairs each entry to the assignment
 *      and stamps assignmentId/JO/rate/WC/worksite/workState, recomputing
 *      the import lifecycle (needs_* → ready).
 * The parent then swaps the affected rows in place — no grid reload.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import WcCodeSelect from '../workersComp/WcCodeSelect';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import { normalizeStateCode } from '../../utils/unemploymentRates';

interface JoPosition {
  title: string;
  payRate: number;
  wcCode: string;
}

interface JoOption {
  id: string;
  label: string;
  worksiteName: string;
  worksiteLine: string;
  state: string;
  hiringEntityId: string;
  jobTitle: string;
  /** The JO's positions (positions[] with gigPositions[] fallback) — the
   *  Position field offers these, and picking one fills pay rate + WC. */
  positions: JoPosition[];
  sameEntity: boolean;
}

export interface FixAssignmentRow {
  entryId: string;
  workDate: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hiringEntityId: string;
  userId: string;
  workerName: string;
  defaultTitle?: string;
  defaultPayRate?: number;
  /** Every fixable (non-live) import row for this worker in view — the
   *  assignment covers all of them and each gets re-resolved on save. */
  rows: FixAssignmentRow[];
  /** Called with the entry ids that were re-resolved; parent refreshes
   *  them in place. */
  onFixed: (entryIds: string[]) => void;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const FixAssignmentDialog: React.FC<Props> = ({
  open,
  onClose,
  tenantId,
  hiringEntityId,
  userId,
  workerName,
  defaultTitle,
  defaultPayRate,
  rows,
  onFixed,
}) => {
  const [joOptions, setJoOptions] = useState<JoOption[]>([]);
  const [loadingJos, setLoadingJos] = useState(false);
  const [jo, setJo] = useState<JoOption | null>(null);
  const [title, setTitle] = useState('');
  const [payRate, setPayRate] = useState('');
  const [wcCode, setWcCode] = useState('');
  const [wcRate, setWcRate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => rows.map((r) => r.workDate).sort(), [rows]);

  useEffect(() => {
    if (!open) return;
    setJo(null);
    setTitle(defaultTitle ?? '');
    setPayRate(defaultPayRate && defaultPayRate > 0 ? String(defaultPayRate) : '');
    setWcCode('');
    setError(null);
  }, [open, defaultTitle, defaultPayRate]);

  // Job orders — same-entity first, labeled like the payroll-costs picker.
  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;
    setLoadingJos(true);
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'job_orders'));
        const opts: JoOption[] = snap.docs.map((d) => {
          const v = d.data() as Record<string, unknown>;
          const num = v.jobOrderNumber != null ? `#${v.jobOrderNumber}` : '';
          const name = str(v.jobOrderName) || str(v.title) || d.id;
          const company = str(v.companyName) || str(v.accountName);
          const site = str(v.worksiteName);
          const addr = (v.worksiteAddress as Record<string, unknown> | undefined) ?? {};
          const state = normalizeStateCode(str(addr.state)).toUpperCase();
          const entity = str(v.hiringEntityId);
          const rawPositions = Array.isArray(v.positions) && v.positions.length
            ? (v.positions as unknown[])
            : Array.isArray(v.gigPositions)
              ? (v.gigPositions as unknown[])
              : [];
          const positions: JoPosition[] = rawPositions
            .map((p) => {
              const rec = (p ?? {}) as Record<string, unknown>;
              return {
                title: str(rec.jobTitle) || str(rec.title),
                payRate: Number(rec.payRate) > 0 ? Number(rec.payRate) : 0,
                wcCode: str(rec.workersCompCode),
              };
            })
            .filter((p) => p.title);
          return {
            id: d.id,
            label: [num, name, company, site].filter(Boolean).join(' — '),
            worksiteName: site,
            worksiteLine: [str(addr.city), state].filter(Boolean).join(', '),
            state,
            hiringEntityId: entity,
            jobTitle: str(v.jobTitle),
            positions,
            sameEntity: !entity || entity === hiringEntityId,
          };
        });
        opts.sort((a, b) =>
          a.sameEntity === b.sameEntity ? a.label.localeCompare(b.label) : a.sameEntity ? -1 : 1,
        );
        if (!cancelled) setJoOptions(opts);
      } catch {
        if (!cancelled) setJoOptions([]);
      } finally {
        if (!cancelled) setLoadingJos(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, hiringEntityId]);

  const rate = Number(payRate);
  const canSave =
    Boolean(userId) && Boolean(jo) && Number.isFinite(rate) && rate > 0 && rows.length > 0 && !saving;

  const handleSave = async (): Promise<void> => {
    if (!jo) return;
    setSaving(true);
    setError(null);
    try {
      const create = httpsCallable(functions, 'createImportAssignments', { timeout: 120000 });
      await create({
        tenantId,
        hiringEntityId,
        groups: [
          {
            jobOrderId: jo.id,
            workers: [
              {
                userId,
                dates,
                payRate: rate,
                title: title.trim(),
                state: jo.state,
                ...(wcCode.trim() ? { wcCode: wcCode.trim(), wcRate: wcRate ?? undefined } : {}),
              },
            ],
          },
        ],
      });
      // Pair + stamp every row; per-row failures don't kill the batch.
      const reresolve = httpsCallable<{ tenantId: string; entryId: string }, { connected: boolean }>(
        functions,
        'reresolveImportEntry',
        { timeout: 60000 },
      );
      const fixed: string[] = [];
      for (const r of rows) {
        try {
          await reresolve({ tenantId, entryId: r.entryId });
          fixed.push(r.entryId);
        } catch (e) {
          console.error('reresolve failed for', r.entryId, e);
        }
      }
      onFixed(fixed);
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Fix assignment — {workerName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Link a job order and this creates a real assignment for {workerName} — worksite,
            account, and WC flow from it, and all {rows.length} of their imported row
            {rows.length === 1 ? '' : 's'} in view reconnect to it.
          </Typography>

          <Autocomplete<JoOption>
            options={joOptions}
            loading={loadingJos}
            value={jo}
            onChange={(_, v) => {
              setJo(v);
              if (!v) return;
              // Single-position JOs fill everything; multi-position JOs offer
              // the Position dropdown below.
              const only = v.positions.length === 1 ? v.positions[0] : null;
              if (only) {
                setTitle(only.title);
                if (only.payRate > 0) setPayRate(String(only.payRate));
                setWcCode(only.wcCode || '');
              } else {
                setWcCode('');
                if (!title.trim() && v.jobTitle) setTitle(v.jobTitle);
              }
            }}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            groupBy={(o) => (o.sameEntity ? 'This entity' : 'Other entities')}
            renderInput={(params) => (
              <TextField {...params} label="Job order" autoFocus placeholder="Search by #, name, company, worksite" />
            )}
          />

          {jo && (
            <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
              <Typography variant="body2">
                Worksite from this job order: <strong>{jo.worksiteName || '(none on JO)'}</strong>
                {jo.worksiteLine ? ` · ${jo.worksiteLine}` : ''}
                {!jo.state && ' — ⚠️ no state on the JO worksite; WC can’t resolve until it has one.'}
              </Typography>
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Autocomplete<JoPosition, false, false, true>
              freeSolo
              fullWidth
              options={jo?.positions ?? []}
              inputValue={title}
              onInputChange={(_, v) => setTitle(v)}
              onChange={(_, v) => {
                // Picking a JO position fills its title + pay rate + WC code;
                // free-typing a custom title leaves rate/WC as entered.
                if (v && typeof v !== 'string') {
                  setTitle(v.title);
                  if (v.payRate > 0) setPayRate(String(v.payRate));
                  if (v.wcCode) setWcCode(v.wcCode);
                } else if (typeof v === 'string') {
                  setTitle(v);
                }
              }}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.title)}
              renderOption={(props, o) => (
                <li {...props} key={o.title}>
                  <Box>
                    <Typography variant="body2">{o.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[o.payRate > 0 ? `$${o.payRate.toFixed(2)}/hr` : null, o.wcCode ? `WC ${o.wcCode}` : null]
                        .filter(Boolean)
                        .join(' · ') || 'no rate on position'}
                    </Typography>
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Position"
                  placeholder={jo ? 'Pick a JO position or type one' : 'Pick a job order first'}
                />
              )}
            />
            <TextField
              label="Pay rate"
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
              type="number"
              sx={{ width: 160 }}
              error={payRate !== '' && !(rate > 0)}
            />
          </Stack>

          {jo?.state && (
            <WcCodeSelect
              tenantId={tenantId}
              state={jo.state}
              hiringEntityId={jo.hiringEntityId || hiringEntityId}
              value={wcCode}
              onChange={(c, r) => {
                setWcCode(c);
                setWcRate(r);
              }}
              helperText="Leave blank to auto-resolve from the matrix by position + state; pick a code to pin it."
            />
          )}

          <Box>
            <Typography variant="caption" color="text.secondary">
              Covers {rows.length} row{rows.length === 1 ? '' : 's'}:
            </Typography>
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
              {dates.map((d) => (
                <Chip key={d} label={d} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Creating…' : `Create assignment & fix ${rows.length} row${rows.length === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FixAssignmentDialog;
