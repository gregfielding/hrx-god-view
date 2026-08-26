/**
 * /reports/qbo-classes — QBO Classes & Mapping (Greg 2026-08-19).
 * The QBO classes were created by hand and have no durable link to HRX
 * data. This page IS that link: every class with its billed/expense
 * activity, its mapping to an HRX job order/client (stored in
 * qbo_class_mappings — consulted FIRST by the gross-margin/job-costing
 * matcher), one-click apply of auto-suggested matches, a manual map
 * dialog, and "Add class" which creates the class IN QuickBooks.
 * Mark's email-driven VenueSmart class automation calls the same
 * savePayrollVenueMapping branches this page uses.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AddIcon from '@mui/icons-material/Add';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearStartIso = (): string => `${todayIso().slice(0, 4)}-01-01`;

interface ClassRow {
  classId: string;
  name: string;
  fqn: string;
  active: boolean;
  parentClassId: string | null;
  billedInRange: number;
  expensesInRange: number;
  mapping: { jobOrderId: string | null; jobOrderName: string | null; accountId: string | null; accountName: string | null; source: string } | null;
  suggestion: { jobOrderId: string; jobOrderName: string; accountId: string | null; accountName: string | null } | null;
}

interface CatalogData {
  totals: { classes: number; mapped: number; unmappedWithActivity: number };
  classes: ClassRow[];
}

interface JoOption { id: string; label: string; accountName: string | null }

const QboClassesPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CatalogData | null>(null);
  const [joOptions, setJoOptions] = useState<JoOption[]>([]);
  const [mapTarget, setMapTarget] = useState<ClassRow | null>(null);
  const [mapJo, setMapJo] = useState<JoOption | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<ClassRow | null>(null);

  const load = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
      const res = await fn({
        tenantId,
        startDate: yearStartIso(),
        endDate: todayIso(),
        includeClassCatalog: true,
      });
      const d = res.data as { classCatalog: CatalogData | null; classCatalogError: string | null };
      if (!d.classCatalog) setError(d.classCatalogError || 'Class catalog unavailable.');
      else setData(d.classCatalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Job-order options for the manual map dialog.
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'job_orders'))
      .then((snap) =>
        setJoOptions(
          snap.docs
            .map((d) => ({
              id: d.id,
              label: String(d.data().jobOrderName ?? d.data().title ?? d.id),
              accountName: null,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ),
      )
      .catch(() => setJoOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const saveMapping = async (row: ClassRow, jobOrderId: string): Promise<void> => {
    if (!tenantId) return;
    setBusy(row.classId);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({ tenantId, action: 'mapQboClass', classId: row.classId, className: row.name, fqn: row.fqn, jobOrderId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setMapTarget(null);
      setMapJo(null);
    }
  };

  const removeMapping = async (row: ClassRow): Promise<void> => {
    if (!tenantId) return;
    setBusy(row.classId);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({ tenantId, action: 'mapQboClass', classId: row.classId, className: row.name, remove: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const createClass = async (): Promise<void> => {
    if (!tenantId || !newName.trim()) return;
    setBusy('__create');
    setError(null);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({
        tenantId,
        action: 'createQboClass',
        name: newName.trim(),
        ...(newParent ? { parentClassId: newParent.classId } : {}),
      });
      setAddOpen(false);
      setNewName('');
      setNewParent(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const parents = useMemo(() => (data?.classes ?? []).filter((c) => !c.parentClassId && c.active), [data]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <AccountTreeOutlinedIcon fontSize="small" />
            <span>QBO Classes &amp; Mapping</span>
          </Box>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              Add class (creates in QBO)
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Every QuickBooks class with its year-to-date billing/expense activity and its HRX mapping.
            Mapping a class to a job order makes the link authoritative — Gross Margin and Job Costing
            use it before any name matching. Classes created here appear in QBO immediately (and flow
            to Expensify on the next class sync).
          </Typography>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'QBO classes', value: data.totals.classes },
              { label: 'Mapped', value: data.totals.mapped },
              { label: 'Unmapped w/ activity', value: data.totals.unmappedWithActivity },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 150 }}>
                <Typography variant="caption" color="text.secondary">{t.label}</Typography>
                <Typography variant="h6" fontWeight={600}>{t.value}</Typography>
              </Paper>
            ))}
          </Box>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>QBO class</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Billed (YTD)</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Expenses (YTD)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Mapped to</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.classes.map((c) => (
                  <TableRow key={c.classId} hover sx={{ opacity: c.active ? 1 : 0.5 }}>
                    <TableCell>
                      {c.fqn}
                      {!c.active && <Chip label="inactive" size="small" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell align="right">{c.billedInRange ? usd(c.billedInRange) : '—'}</TableCell>
                    <TableCell align="right">{c.expensesInRange ? usd(c.expensesInRange) : '—'}</TableCell>
                    <TableCell>
                      {c.mapping ? (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={c.mapping.jobOrderName ?? c.mapping.accountName ?? 'mapped'}
                          onDelete={() => void removeMapping(c)}
                        />
                      ) : c.suggestion ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="caption" color="text.secondary">
                            suggest: {c.suggestion.jobOrderName}
                          </Typography>
                          <Button
                            size="small"
                            disabled={busy === c.classId}
                            onClick={() => void saveMapping(c, c.suggestion!.jobOrderId)}
                          >
                            Apply
                          </Button>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="small" disabled={busy === c.classId} onClick={() => setMapTarget(c)}>
                        Map…
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Manual map dialog */}
      <Dialog open={Boolean(mapTarget)} onClose={() => setMapTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Map “{mapTarget?.fqn}” to a job order</DialogTitle>
        <DialogContent>
          <Autocomplete
            sx={{ mt: 1 }}
            options={joOptions}
            value={mapJo}
            onChange={(_e, v) => setMapJo(v)}
            getOptionLabel={(o) => o.label}
            renderInput={(params) => <TextField {...params} size="small" label="Job order" />}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            The class&apos;s billing and expenses will attribute to this job order (and its client) in
            Gross Margin and Job Costing.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!mapJo || busy === mapTarget?.classId}
            onClick={() => mapTarget && mapJo && void saveMapping(mapTarget, mapJo.id)}
          >
            Save mapping
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add-class dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add a QBO class</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            label="Class name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Riot Fest 2026"
          />
          <Autocomplete
            sx={{ mt: 2 }}
            options={parents}
            value={newParent}
            onChange={(_e, v) => setNewParent(v)}
            getOptionLabel={(o) => o.fqn}
            renderInput={(params) => (
              <TextField {...params} size="small" label="Parent class (optional, e.g. Venue Smart)" />
            )}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Creates the class in QuickBooks immediately. Map it to a job order afterwards so reports
            attribute it automatically.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newName.trim() || busy === '__create'} onClick={() => void createClass()}>
            {busy === '__create' ? 'Creating…' : 'Create in QBO'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default QboClassesPage;
