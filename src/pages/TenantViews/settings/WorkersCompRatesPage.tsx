/**
 * Master Workers Comp Rates — manage state + code + rate and link job titles from the master list.
 * When an account/job order uses one of these job titles and the worksite is in the given state,
 * the WC code and rate are auto-applied from here.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  CircularProgress,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import PageHeader from '../../../components/PageHeader';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { p, workersCompRateDocId } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import type { RecruiterAccount, WorkersCompRateByState } from '../../../types/recruiter/account';
import { US_STATE_CODES } from '../../../utils/unemploymentRates';
import { useTenantJobTitleOptions } from '../../../hooks/useTenantJobTitles';

/** Per-entity sync stamp written by syncWorkersCompToEveree. */
interface EvereeSyncStamp {
  evereeId: number;
  rate: number;
  name: string;
}

type Row = WorkersCompRateByState & { id: string; everee?: Record<string, EvereeSyncStamp> | null };

/** The W-2 payroll company — the entity whose Everee table must hold every
 *  code/rate before a worked shift referencing them will submit. The sync
 *  dialog lets you target other entities; the table column reports this one. */
const DEFAULT_EVEREE_ENTITY = 'c1_select_llc';

interface SyncPlanEntry {
  state: string;
  code: string;
  name: string;
  rate: number;
  rateIds: string[];
  evereeId?: number;
  evereeRate?: number;
}

interface SyncPlan {
  entityId: string;
  creates: SyncPlanEntry[];
  updates: SyncPlanEntry[];
  inSync: SyncPlanEntry[];
  conflicts: Array<{ state: string; code: string; rates: number[]; rateIds: string[] }>;
  evereeOnly: Array<{ state: string; code: string; rate: number; name: string }>;
  applied?: Array<{ state: string; code: string; action: string; evereeId: number }>;
  errors?: Array<{ state: string; code: string; error: string }>;
}

function isNationalOrStandaloneAccount(acc: RecruiterAccount): boolean {
  const t = acc.accountType;
  if (t === 'child') return false;
  if (t === 'national' || t === 'standalone') return true;
  return !(acc.parentAccountId && String(acc.parentAccountId).trim());
}

export interface WorkersCompRatesPageProps {
  tenantId?: string | null;
  /** When true, omit duplicate page chrome (used inside Settings shell). */
  embeddedInSettings?: boolean;
}

const WorkersCompRatesPage: React.FC<WorkersCompRatesPageProps> = ({
  tenantId: tenantIdProp,
  embeddedInSettings,
}) => {
  const { activeTenant, tenantId: authTenantId, user } = useAuth();
  const tenantId = tenantIdProp ?? activeTenant?.id ?? authTenantId;
  const jobTitlesList = useTenantJobTitleOptions(tenantId);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<string>('');
  const [formCode, setFormCode] = useState('');
  const [formRate, setFormRate] = useState<number | ''>('');
  const [formJobTitles, setFormJobTitles] = useState<string[]>([]);
  /** National or standalone recruiter account — limits this row to jobs under that account subtree. */
  const [formModifierAccount, setFormModifierAccount] = useState<RecruiterAccount | null>(null);
  const [nationalStandaloneAccounts, setNationalStandaloneAccounts] = useState<RecruiterAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  type SortKey = 'state' | 'code' | 'rate';
  const [sortBy, setSortBy] = useState<SortKey>('state');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
  };

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'state') cmp = (a.state || '').localeCompare(b.state || '');
      else if (sortBy === 'code') cmp = (a.code || '').localeCompare(b.code || '');
      else if (sortBy === 'rate') cmp = (a.rate ?? 0) - (b.rate ?? 0);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sortBy, sortOrder]);

  const loadRates = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, p.workersCompRates(tenantId)));
      const list: Row[] = snap.docs.map((d) => {
        const data = d.data() as WorkersCompRateByState;
        return {
          id: d.id,
          state: data.state ?? '',
          code: data.code ?? '',
          rate: data.rate ?? 0,
          jobTitles: data.jobTitles ?? [],
          modifierAccountId: data.modifierAccountId ?? null,
          everee: (d.data() as { everee?: Record<string, EvereeSyncStamp> }).everee ?? null,
        };
      });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workers comp rates');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  /** If accounts load after opening Edit, attach the modifier account option. */
  useEffect(() => {
    if (!dialogOpen || !editingId || nationalStandaloneAccounts.length === 0) return;
    const row = rows.find((r) => r.id === editingId);
    const mid = (row?.modifierAccountId || '').trim();
    if (!mid) return;
    setFormModifierAccount((prev) => prev ?? (nationalStandaloneAccounts.find((a) => a.id === mid) ?? null));
  }, [dialogOpen, editingId, rows, nationalStandaloneAccounts]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, p.recruiterAccounts(tenantId)))
      .then((snap) => {
        const list = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<RecruiterAccount, 'id'>) }))
          .filter((a) => a.active !== false && isNationalOrStandaloneAccount(a))
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
        setNationalStandaloneAccounts(list);
      })
      .catch(() => setNationalStandaloneAccounts([]));
  }, [tenantId]);

  const openAdd = () => {
    setEditingId(null);
    setFormState('');
    setFormCode('');
    setFormRate('');
    setFormJobTitles([]);
    setFormModifierAccount(null);
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(row.id);
    setFormState(row.state);
    setFormCode(row.code);
    setFormRate(row.rate);
    setFormJobTitles(Array.isArray(row.jobTitles) ? [...row.jobTitles] : []);
    const mid = (row.modifierAccountId || '').trim();
    setFormModifierAccount(mid ? nationalStandaloneAccounts.find((a) => a.id === mid) || null : null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    const state = String(formState || '').trim().toUpperCase();
    const code = String(formCode || '').trim();
    const rate = formRate === '' ? null : Number(formRate);
    if (!state || !code) {
      setError('State and code are required.');
      return;
    }
    if (rate == null || Number.isNaN(rate)) {
      setError('Rate is required and must be a number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const modifierId = formModifierAccount?.id ? String(formModifierAccount.id).trim() : '';
      const newDocId = workersCompRateDocId(state, code, modifierId || null);
      const payload: WorkersCompRateByState & { updatedAt: any; updatedBy?: string | null } = {
        state,
        code,
        rate,
        jobTitles: formJobTitles.length ? formJobTitles : null,
        modifierAccountId: modifierId || null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      };
      if (editingId && editingId !== newDocId) {
        await deleteDoc(doc(db, p.workersCompRates(tenantId), editingId));
      }
      await setDoc(doc(db, p.workersCompRates(tenantId), newDocId), payload, { merge: true });
      await loadRates();
      setDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!tenantId) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteDoc(doc(db, p.workersCompRates(tenantId), id));
      await loadRates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Everee sync ─────────────────────────────────────────────────────────
  // One dialog serves both flows: the header button previews the WHOLE list,
  // a row's cloud button previews just that row. Nothing writes until Apply.
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncScope, setSyncScope] = useState<string[] | null>(null); // null = all rows
  const [syncEntityId, setSyncEntityId] = useState(DEFAULT_EVEREE_ENTITY);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [evereeEntities, setEvereeEntities] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, `tenants/${tenantId}/entities`))
      .then((snap) => {
        const list = snap.docs
          .filter((d) => String(d.get('evereeTenantId') ?? '').trim())
          .map((d) => ({ id: d.id, name: String(d.get('name') ?? d.id) }));
        setEvereeEntities(list);
      })
      .catch(() => setEvereeEntities([]));
  }, [tenantId]);

  const runSyncPreview = useCallback(
    async (scope: string[] | null, entityId: string) => {
      if (!tenantId) return;
      setSyncBusy(true);
      setSyncError(null);
      setSyncPlan(null);
      try {
        const call = httpsCallable(functions, 'syncWorkersCompToEveree', { timeout: 300000 });
        const res = await call({ tenantId, entityId, rateIds: scope ?? undefined, dryRun: true });
        setSyncPlan(res.data as SyncPlan);
      } catch (e: unknown) {
        setSyncError(e instanceof Error ? e.message : 'Preview failed');
      } finally {
        setSyncBusy(false);
      }
    },
    [tenantId],
  );

  const openSync = (scope: string[] | null) => {
    setSyncScope(scope);
    setSyncOpen(true);
    runSyncPreview(scope, syncEntityId);
  };

  const applySync = async () => {
    if (!tenantId || !syncPlan) return;
    setSyncBusy(true);
    setSyncError(null);
    try {
      const call = httpsCallable(functions, 'syncWorkersCompToEveree', { timeout: 300000 });
      const res = await call({ tenantId, entityId: syncEntityId, rateIds: syncScope ?? undefined, dryRun: false });
      setSyncPlan(res.data as SyncPlan);
      await loadRates();
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  };

  /** Table-column status vs the default (W-2 payroll) entity. */
  const syncStateFor = (row: Row): { label: string; color: 'success' | 'warning' | 'default'; title: string } => {
    const stamp = row.everee?.[DEFAULT_EVEREE_ENTITY];
    if (!stamp) return { label: 'Not synced', color: 'default', title: 'This code has not been pushed to Everee yet.' };
    if (Math.abs(stamp.rate - (row.rate ?? 0)) > 0.0001) {
      return {
        label: 'Rate drift',
        color: 'warning',
        title: `Everee still has ${stamp.rate} — the rate changed here since the last sync. Sync again to update it.`,
      };
    }
    return { label: 'Synced', color: 'success', title: `In Everee as "${stamp.name}" (id ${stamp.evereeId}).` };
  };

  return (
    <Box sx={embeddedInSettings ? { px: { xs: 2, md: 3 }, py: 2 } : { p: 2 }}>
      {!embeddedInSettings && (
        <PageHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HealthAndSafetyIcon fontSize="small" />
              <span>Workers Comp</span>
            </Box>
          }
          subtitle="Manage workers comp codes and rates by state. Assign job titles so accounts and job orders get the correct code and rate automatically."
        />
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Workers comp rates by state
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<CloudSyncIcon />}
                onClick={() => openSync(null)}
                disabled={!tenantId || rows.length === 0}
              >
                Sync to Everee
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} disabled={!tenantId}>
                Add rate
              </Button>
            </Box>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : rows.length === 0 ? (
            <Typography color="text.secondary">No workers comp rates yet. Click Add rate to create one.</Typography>
          ) : (
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 70, maxWidth: 70 }}>
                    <TableSortLabel
                      active={sortBy === 'state'}
                      direction={sortBy === 'state' ? sortOrder : 'asc'}
                      onClick={() => handleSort('state')}
                    >
                      State
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: 76, maxWidth: 76 }}>
                    <TableSortLabel
                      active={sortBy === 'code'}
                      direction={sortBy === 'code' ? sortOrder : 'asc'}
                      onClick={() => handleSort('code')}
                    >
                      Code
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 88, maxWidth: 88 }}>
                    <TableSortLabel
                      active={sortBy === 'rate'}
                      direction={sortBy === 'rate' ? sortOrder : 'asc'}
                      onClick={() => handleSort('rate')}
                    >
                      Rate (%)
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Job titles (auto-apply)</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>Account scope</TableCell>
                  <TableCell sx={{ width: 110, maxWidth: 110 }}>Everee</TableCell>
                  <TableCell align="right" sx={{ width: 130, maxWidth: 130 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell sx={{ width: 70, maxWidth: 70 }}>{row.state}</TableCell>
                    <TableCell sx={{ width: 76, maxWidth: 76 }}>{row.code}</TableCell>
                    <TableCell align="right" sx={{ width: 88, maxWidth: 88 }}>{row.rate}</TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      {Array.isArray(row.jobTitles) && row.jobTitles.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {row.jobTitles.map((t) => (
                            <Chip key={t} label={t} size="small" variant="outlined" />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 140 }}>
                      {(row.modifierAccountId || '').trim() ? (
                        <Typography variant="body2" noWrap title={(row.modifierAccountId || '').trim()}>
                          {nationalStandaloneAccounts.find((a) => a.id === row.modifierAccountId)?.name ||
                            row.modifierAccountId}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">All accounts</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ width: 110, maxWidth: 110 }}>
                      {(() => {
                        const s = syncStateFor(row);
                        return (
                          <Tooltip title={s.title}>
                            <Chip size="small" label={s.label} color={s.color} variant={s.color === 'default' ? 'outlined' : 'filled'} />
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130, maxWidth: 130 }}>
                      <Tooltip title="Preview + sync this row to Everee">
                        <IconButton size="small" onClick={() => openSync([row.id])} aria-label="Sync to Everee">
                          <CloudSyncIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={() => openEdit(row)} aria-label="Edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(row.id)}
                        disabled={deletingId === row.id}
                        aria-label="Delete"
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit workers comp rate' : 'Add workers comp rate'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>State</InputLabel>
              <Select
                value={formState}
                label="State"
                onChange={(e) => setFormState(e.target.value)}
              >
                {US_STATE_CODES.map((code) => (
                  <MenuItem key={code} value={code}>{code}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Class code"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder="e.g. 9014"
              fullWidth
            />
            <TextField
              size="small"
              type="number"
              label="Rate (%)"
              value={formRate}
              onChange={(e) => setFormRate(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="e.g. 1.7"
              inputProps={{ min: 0, step: 0.1 }}
              fullWidth
            />
            <Autocomplete
              multiple
              size="small"
              options={jobTitlesList}
              value={formJobTitles}
              onChange={(_, v) => setFormJobTitles(v)}
              renderInput={(params) => (
                <TextField {...params} label="Job titles (auto-apply when account/job order uses this title in this state)" placeholder="e.g. Cleaner" />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip label={option} size="small" {...getTagProps({ index })} key={option} />
                ))
              }
            />
            <Autocomplete
              size="small"
              options={nationalStandaloneAccounts}
              value={formModifierAccount}
              onChange={(_, v) => setFormModifierAccount(v)}
              getOptionLabel={(o) => String(o?.name || '').trim() || o.id}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Limit to national / standalone account (optional)"
                  placeholder="Search accounts…"
                  helperText="Only job orders under this client use this code/rate for the titles above. Leave empty for every account."
                />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => !saving && setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Everee sync — always previews (dry-run) first; Apply is the only write. */}
      <Dialog open={syncOpen} onClose={() => !syncBusy && setSyncOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Sync {syncScope ? 'this rate' : 'all rates'} to Everee
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Everee company</InputLabel>
              <Select
                value={syncEntityId}
                label="Everee company"
                disabled={syncBusy}
                onChange={(e) => {
                  setSyncEntityId(e.target.value);
                  runSyncPreview(syncScope, e.target.value);
                }}
              >
                {(evereeEntities.length
                  ? evereeEntities
                  : [{ id: DEFAULT_EVEREE_ENTITY, name: 'C1 Select LLC' }]
                ).map((ent) => (
                  <MenuItem key={ent.id} value={ent.id}>{ent.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {syncError && <Alert severity="error">{syncError}</Alert>}
            {syncBusy && !syncPlan && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            )}

            {syncPlan && (
              <>
                {syncPlan.applied ? (
                  <Alert severity={syncPlan.errors && syncPlan.errors.length ? 'warning' : 'success'}>
                    {syncPlan.applied.length} change(s) applied to Everee
                    {syncPlan.errors && syncPlan.errors.length ? `, ${syncPlan.errors.length} failed` : ''}.
                  </Alert>
                ) : (
                  <Alert severity="info">
                    Preview only — nothing has been sent yet. Review and click Apply.
                  </Alert>
                )}

                {syncPlan.conflicts.length > 0 && (
                  <Alert severity="error">
                    {syncPlan.conflicts.map((c) => (
                      <div key={`${c.state}/${c.code}`}>
                        {c.state} {c.code}: HRX has conflicting rates ({c.rates.join(' vs ')}) — Everee can
                        hold only one. Fix in HRX, then sync.
                      </div>
                    ))}
                  </Alert>
                )}

                {syncPlan.creates.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2">Will create ({syncPlan.creates.length})</Typography>
                    {syncPlan.creates.map((e) => (
                      <Typography key={`${e.state}/${e.code}`} variant="body2" color="text.secondary">
                        {e.state} {e.code} @ {e.rate} — “{e.name}”
                      </Typography>
                    ))}
                  </Box>
                )}
                {syncPlan.updates.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" color="warning.main">
                      Will update ({syncPlan.updates.length})
                    </Typography>
                    {syncPlan.updates.map((e) => (
                      <Typography key={`${e.state}/${e.code}`} variant="body2" color="text.secondary">
                        {e.state} {e.code}: {e.evereeRate} → {e.rate}
                      </Typography>
                    ))}
                  </Box>
                )}
                {syncPlan.inSync.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    <CheckCircleOutlineIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />
                    Already in sync: {syncPlan.inSync.length}
                  </Typography>
                )}
                {syncPlan.errors && syncPlan.errors.length > 0 && (
                  <Alert severity="error">
                    {syncPlan.errors.map((e) => (
                      <div key={`${e.state}/${e.code}`}>{e.state} {e.code}: {e.error}</div>
                    ))}
                  </Alert>
                )}

                {syncPlan.evereeOnly.length > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle2">In Everee but not in HRX ({syncPlan.evereeOnly.length})</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Never touched by the sync. Consider adding these here so HRX auto-applies them.
                      </Typography>
                      {syncPlan.evereeOnly.map((e) => (
                        <Typography key={`${e.state}/${e.code}`} variant="body2" color="text.secondary">
                          {e.state} {e.code} @ {e.rate} — “{e.name}”
                        </Typography>
                      ))}
                    </Box>
                  </>
                )}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncOpen(false)} disabled={syncBusy}>Close</Button>
          <Button
            variant="contained"
            onClick={applySync}
            disabled={
              syncBusy ||
              !syncPlan ||
              !!syncPlan.applied ||
              (syncPlan.creates.length === 0 && syncPlan.updates.length === 0)
            }
          >
            {syncBusy && syncPlan ? <CircularProgress size={20} /> : 'Apply to Everee'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkersCompRatesPage;
