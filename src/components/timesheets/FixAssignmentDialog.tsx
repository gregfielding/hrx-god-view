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
  /** Saved timesheet-entry doc id. Omit for Import-tab rows that only exist
   *  in memory — those skip the per-entry re-resolve; the caller re-runs the
   *  match instead (onFixed), which pairs the fresh assignment. */
  entryId?: string;
  workDate: string;
}

interface WorkerHit {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hiringEntityId: string;
  /** The currently-matched HRX worker ('' when the rows are unmatched — the
   *  card's worker search on the top row fixes that in the same save). */
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
  /** Fired after the assignment is created, with what was chosen — lets the
   *  parent offer "apply the same JO/position to the other workers at this
   *  event" (Greg 2026-08-05: one Lollapalooza fix → 33 more assignments). */
  onCreated?: (info: {
    jobOrderId: string;
    joLabel: string;
    title: string;
    payRate: number;
    state: string;
    wcCode?: string;
    wcRate?: number;
  }) => void;
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
  onCreated,
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
  // Worker (top row): pre-filled with the current match; searchable so an
  // unmatched CSV name gets matched IN the card (Greg 2026-08-05 — one
  // dialog, no separate worker pencil). Changing it reassigns the rows'
  // docs to the picked worker before the assignment is created.
  const [pickedWorker, setPickedWorker] = useState<WorkerHit | null>(null);
  const [wHits, setWHits] = useState<WorkerHit[]>([]);
  const [wSearching, setWSearching] = useState(false);
  const wDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const dates = useMemo(() => rows.map((r) => r.workDate).sort(), [rows]);
  // Reassigning moves entry DOCS — only possible when every row is saved.
  const canPickWorker = rows.length > 0 && rows.every((r) => Boolean(r.entryId));
  const effUserId = pickedWorker?.userId ?? userId;

  useEffect(() => {
    if (!open) return;
    setJo(null);
    setTitle(defaultTitle ?? '');
    setPayRate(defaultPayRate && defaultPayRate > 0 ? String(defaultPayRate) : '');
    setWcCode('');
    setPickedWorker(userId ? { userId, displayName: workerName, email: null, phone: null } : null);
    setWHits([]);
    setError(null);
  }, [open, defaultTitle, defaultPayRate, userId, workerName]);

  const searchWorkers = (q: string) => {
    if (wDebounce.current) clearTimeout(wDebounce.current);
    const query = q.trim();
    if (query.length < 2) return;
    wDebounce.current = setTimeout(() => {
      setWSearching(true);
      httpsCallable<{ tenantId: string; query: string }, { candidates: WorkerHit[] }>(
        functions,
        'searchTimesheetWorkers',
        { timeout: 30000 },
      )({ tenantId, query })
        .then((res) => setWHits(res.data?.candidates ?? []))
        .catch((e) => console.error('searchTimesheetWorkers failed:', e))
        .finally(() => setWSearching(false));
    }, 400);
  };

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
    Boolean(effUserId) &&
    Boolean(jo) &&
    Number.isFinite(rate) &&
    rate > 0 &&
    rows.length > 0 &&
    !saving;

  const handleSave = async (): Promise<void> => {
    if (!jo || !effUserId) return;
    setSaving(true);
    setError(null);
    try {
      // Worker changed (or newly matched): reassign each saved row's doc to
      // the picked worker first — the assignment must anchor to them.
      if (pickedWorker && pickedWorker.userId !== userId) {
        const reassign = httpsCallable<
          { tenantId: string; hiringEntityId: string; entryId: string; newUserId: string },
          { ok: boolean }
        >(functions, 'reassignImportEntryWorker', { timeout: 60000 });
        for (const r of rows) {
          if (!r.entryId) continue;
          await reassign({
            tenantId,
            hiringEntityId,
            entryId: r.entryId,
            newUserId: pickedWorker.userId,
          });
        }
      }
      // Create the assignment AND stamp the worker's saved rows server-side
      // (one call — no per-row re-resolve round-trips).
      const create = httpsCallable(functions, 'createImportAssignments', { timeout: 120000 });
      await create({
        tenantId,
        hiringEntityId,
        stampEntries: true,
        groups: [
          {
            jobOrderId: jo.id,
            workers: [
              {
                userId: effUserId,
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
      onCreated?.({
        jobOrderId: jo.id,
        joLabel: jo.label,
        title: title.trim(),
        payRate: rate,
        state: jo.state,
        wcCode: wcCode.trim() || undefined,
        wcRate: wcRate ?? undefined,
      });
      onFixed([]);
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
            Link the worker and a job order — this creates a real assignment for {workerName};
            worksite, account, and WC flow from it, and all {rows.length} of their imported row
            {rows.length === 1 ? '' : 's'} in view reconnect to it.
          </Typography>

          {canPickWorker ? (
            <Autocomplete<WorkerHit>
              options={wHits}
              loading={wSearching}
              value={pickedWorker}
              onChange={(_, v) => setPickedWorker(v)}
              onInputChange={(_, v, reason) => {
                if (reason === 'input') searchWorkers(v);
              }}
              getOptionLabel={(o) => o.displayName || o.email || o.userId}
              isOptionEqualToValue={(a, b) => a.userId === b.userId}
              filterOptions={(o) => o}
              renderOption={(props, o) => (
                <li {...props} key={o.userId}>
                  <Box>
                    <Typography variant="body2">{o.displayName || '(no name)'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[o.email, o.phone].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Worker"
                  placeholder={`Search HRX by name, email, or phone${userId ? '' : ` — CSV says “${workerName}”`}`}
                  autoFocus={!userId}
                  helperText={
                    userId
                      ? undefined
                      : 'These rows aren’t linked to an HRX worker yet — pick who this is.'
                  }
                />
              )}
            />
          ) : (
            !userId && (
              <Alert severity="warning">
                These rows aren't linked to an HRX worker yet — match {workerName} with the
                worker pencil on the row first, then reopen this card.
              </Alert>
            )
          )}

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
              // ALWAYS show every JO position — the field is pre-seeded with
              // the CSV role (e.g. "AM Shift"), and the default filter would
              // hide non-matching positions behind it (Greg 2026-08-05).
              filterOptions={(opts) => opts}
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
