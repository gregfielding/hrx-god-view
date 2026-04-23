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
import PageHeader from '../../../components/PageHeader';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { p, workersCompRateDocId } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import type { RecruiterAccount, WorkersCompRateByState } from '../../../types/recruiter/account';
import { US_STATE_CODES } from '../../../utils/unemploymentRates';
import jobTitlesData from '../../../data/onetJobTitles.json';

const jobTitlesList = Array.isArray(jobTitlesData) ? (jobTitlesData as string[]) : [];

type Row = WorkersCompRateByState & { id: string };

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
            <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} disabled={!tenantId}>
              Add rate
            </Button>
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
                  <TableCell align="right" sx={{ width: 100, maxWidth: 100 }}>Actions</TableCell>
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
                    <TableCell align="right" sx={{ width: 100, maxWidth: 100 }}>
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
    </Box>
  );
};

export default WorkersCompRatesPage;
