/**
 * /reports/qbo-classes — QBO Classes & Mapping (Greg 2026-08-19; level-aware
 * v2 2026-08-27). A class is a pointer to ONE node in the HRX hierarchy:
 *   - Overhead  — non-client dollars, excluded from client margins
 *   - Account   — parent/child/standalone account; dollars attach at the
 *                 account and are never guessed down to job orders
 *   - Job order — one or MORE JOs (successor pairs like MN Yacht Club +
 *                 Country Club); fully attributed, rolls up automatically
 * Mappings are authoritative — Gross Margin and Job Costing consult them
 * before any name matching. Two lenses: the class audit (every class,
 * mapping status, unmapped-with-activity first) and the account tree
 * (classes grouped under the accounts they attach to). "Add class"
 * creates the class in QBO and can map it in the same step.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
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

interface ClassMapping {
  targetKind: 'overhead' | 'account' | 'job_order';
  jobOrderId: string | null;
  jobOrderName: string | null;
  jobOrderNames: string[];
  accountId: string | null;
  accountName: string | null;
  parentAccountId: string | null;
  parentAccountName: string | null;
  source: string;
}

interface ClassRow {
  classId: string;
  name: string;
  fqn: string;
  active: boolean;
  parentClassId: string | null;
  billedInRange: number;
  expensesInRange: number;
  mapping: ClassMapping | null;
  suggestion: { jobOrderId: string; jobOrderName: string; accountId: string | null; accountName: string | null } | null;
}

interface CatalogData {
  totals: { classes: number; mapped: number; unmappedWithActivity: number };
  classes: ClassRow[];
}

interface JoOption { id: string; label: string; accountId: string | null }
interface AcctOption { id: string; label: string; parentId: string | null; depth: number }

type MapKind = 'job_order' | 'account' | 'overhead';

const KIND_LABEL: Record<string, string> = {
  overhead: 'OVERHEAD',
  account: 'ACCOUNT',
  job_order: 'JOB ORDER',
};

const QboClassesPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CatalogData | null>(null);
  const [joOptions, setJoOptions] = useState<JoOption[]>([]);
  const [acctOptions, setAcctOptions] = useState<AcctOption[]>([]);
  const [lens, setLens] = useState<'classes' | 'tree'>('classes');
  // Map dialog state.
  const [mapTarget, setMapTarget] = useState<ClassRow | null>(null);
  const [mapKind, setMapKind] = useState<MapKind>('job_order');
  const [mapJos, setMapJos] = useState<JoOption[]>([]);
  const [mapAcct, setMapAcct] = useState<AcctOption | null>(null);
  // Add dialog state.
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<ClassRow | null>(null);
  const [newMapJo, setNewMapJo] = useState<JoOption | null>(null);

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
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'job_orders'))
      .then((snap) =>
        setJoOptions(
          snap.docs
            .map((d) => {
              const j = d.data();
              const num = j.jobOrderNumber != null ? `#${j.jobOrderNumber} ` : '';
              return {
                id: d.id,
                label: `${num}${String(j.jobOrderName ?? j.title ?? d.id)}`,
                accountId: String(j.recruiterAccountId ?? '') || null,
              };
            })
            .sort((a, b) => a.label.localeCompare(b.label)),
        ),
      )
      .catch(() => setJoOptions([]));
    getDocs(collection(db, 'tenants', tenantId, 'accounts'))
      .then((snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          name: String(d.data().name ?? d.id),
          parentId: String(d.data().parentAccountId ?? '').trim() || null,
        }));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const kids = new Map<string, typeof rows>();
        const tops: typeof rows = [];
        for (const r of rows) {
          if (r.parentId && byId.has(r.parentId)) {
            if (!kids.has(r.parentId)) kids.set(r.parentId, []);
            kids.get(r.parentId)!.push(r);
          } else tops.push(r);
        }
        tops.sort((a, b) => a.name.localeCompare(b.name));
        const opts: AcctOption[] = [];
        for (const t of tops) {
          opts.push({ id: t.id, label: t.name, parentId: null, depth: 0 });
          for (const k of (kids.get(t.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
            opts.push({ id: k.id, label: k.name, parentId: t.id, depth: 1 });
          }
        }
        setAcctOptions(opts);
      })
      .catch(() => setAcctOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const saveMapping = async (
    row: ClassRow,
    target: { targetKind: MapKind; jobOrderIds?: string[]; accountId?: string },
  ): Promise<void> => {
    if (!tenantId) return;
    setBusy(row.classId);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({
        tenantId,
        action: 'mapQboClass',
        classId: row.classId,
        className: row.name,
        fqn: row.fqn,
        targetKind: target.targetKind,
        ...(target.jobOrderIds && target.jobOrderIds.length > 0 ? { jobOrderIds: target.jobOrderIds } : {}),
        ...(target.accountId ? { accountId: target.accountId } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setMapTarget(null);
      setMapJos([]);
      setMapAcct(null);
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
      const created = await fn({
        tenantId,
        action: 'createQboClass',
        name: newName.trim(),
        ...(newParent ? { parentClassId: newParent.classId } : {}),
      });
      const c = created.data as { classId?: string; name?: string; fqn?: string };
      // Create-and-map: the new class becomes authoritative for the JO in
      // the same step — the convention that retires bare account classes.
      if (newMapJo && c.classId) {
        await fn({
          tenantId,
          action: 'mapQboClass',
          classId: c.classId,
          className: c.name || newName.trim(),
          fqn: c.fqn || newName.trim(),
          targetKind: 'job_order',
          jobOrderIds: [newMapJo.id],
        });
      }
      setAddOpen(false);
      setNewName('');
      setNewParent(null);
      setNewMapJo(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const parents = useMemo(() => (data?.classes ?? []).filter((c) => !c.parentClassId && c.active), [data]);

  const mappingBreadcrumb = (m: ClassMapping): string => {
    if (m.targetKind === 'overhead') return 'Overhead (non-client)';
    if (m.targetKind === 'account') {
      return m.parentAccountName ? `${m.parentAccountName} → ${m.accountName}` : m.accountName ?? 'account';
    }
    const jos = m.jobOrderNames.length > 0 ? m.jobOrderNames.join(' + ') : m.jobOrderName ?? '';
    return m.accountName ? `${m.accountName} → ${jos}` : jos;
  };

  const kindColor = (k: string): 'default' | 'success' | 'info' | 'warning' =>
    k === 'job_order' ? 'success' : k === 'account' ? 'info' : 'default';

  /** Tree lens grouping: parent account → classes attached beneath it. */
  const treeGroups = useMemo(() => {
    if (!data) return [] as Array<{ label: string; rows: ClassRow[]; billed: number; expenses: number }>;
    const groups = new Map<string, ClassRow[]>();
    for (const c of data.classes) {
      if (!c.active && c.billedInRange === 0 && c.expensesInRange === 0) continue;
      let key: string;
      if (c.mapping?.targetKind === 'overhead') key = 'Overhead (non-client)';
      else if (c.mapping) key = c.mapping.parentAccountName ?? c.mapping.accountName ?? '(mapped, no account)';
      else if (c.suggestion?.accountName) key = `${c.suggestion.accountName} (suggested)`;
      else key = '(unmapped)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return Array.from(groups.entries())
      .map(([label, rows]) => ({
        label,
        rows: rows.sort((a, b) => b.billedInRange + b.expensesInRange - (a.billedInRange + a.expensesInRange)),
        billed: Math.round(rows.reduce((s, r) => s + r.billedInRange, 0) * 100) / 100,
        expenses: Math.round(rows.reduce((s, r) => s + r.expensesInRange, 0) * 100) / 100,
      }))
      .sort((a, b) => b.billed + b.expenses - (a.billed + a.expenses));
  }, [data]);

  const renderRow = (c: ClassRow, indent = false): React.ReactNode => (
    <TableRow key={c.classId} hover sx={{ opacity: c.active ? 1 : 0.5 }}>
      <TableCell sx={indent ? { pl: 4 } : undefined}>
        {c.fqn}
        {!c.active && <Chip label="inactive" size="small" sx={{ ml: 1 }} />}
      </TableCell>
      <TableCell align="right">{c.billedInRange ? usd(c.billedInRange) : '—'}</TableCell>
      <TableCell align="right">{c.expensesInRange ? usd(c.expensesInRange) : '—'}</TableCell>
      <TableCell>
        {c.mapping ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={kindColor(c.mapping.targetKind)} label={KIND_LABEL[c.mapping.targetKind] ?? c.mapping.targetKind} />
            <Chip
              size="small"
              variant="outlined"
              label={mappingBreadcrumb(c.mapping)}
              onDelete={() => void removeMapping(c)}
            />
          </Stack>
        ) : c.suggestion ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              suggest: {c.suggestion.jobOrderName}
            </Typography>
            <Button
              size="small"
              disabled={busy === c.classId}
              onClick={() => void saveMapping(c, { targetKind: 'job_order', jobOrderIds: [c.suggestion!.jobOrderId] })}
            >
              Apply
            </Button>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">—</Typography>
        )}
      </TableCell>
      <TableCell>
        <Button
          size="small"
          disabled={busy === c.classId}
          onClick={() => {
            setMapTarget(c);
            setMapKind(c.mapping?.targetKind === 'account' ? 'account' : c.mapping?.targetKind === 'overhead' ? 'overhead' : 'job_order');
            setMapJos([]);
            setMapAcct(null);
          }}
        >
          Map…
        </Button>
      </TableCell>
    </TableRow>
  );

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
            <ToggleButtonGroup
              size="small"
              exclusive
              value={lens}
              onChange={(_e, v) => v && setLens(v)}
            >
              <ToggleButton value="classes">All classes</ToggleButton>
              <ToggleButton value="tree">By account</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            A class points to one node in the hierarchy — <b>Overhead</b> (non-client, excluded from
            client margins), an <b>Account</b> (parent, child location, or standalone — dollars attach
            at the account and are never guessed down to job orders), or one or more <b>Job orders</b>
            (fully attributed, rolls up automatically). Mappings are authoritative — Gross Margin and
            Job Costing use them before any name matching.
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
                  <TableCell sx={{ fontWeight: 600 }}>{lens === 'tree' ? 'Account / class' : 'QBO class'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Billed (YTD)</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Expenses (YTD)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Mapped to</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lens === 'classes'
                  ? data.classes.map((c) => renderRow(c))
                  : treeGroups.map((g) => (
                      <React.Fragment key={g.label}>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>{g.label}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.billed ? usd(g.billed) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.expenses ? usd(g.expenses) : '—'}</TableCell>
                          <TableCell colSpan={2}>
                            <Typography variant="caption" color="text.secondary">
                              {g.rows.length} class{g.rows.length === 1 ? '' : 'es'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                        {g.rows.map((c) => renderRow(c, true))}
                      </React.Fragment>
                    ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Level-aware map dialog */}
      <Dialog open={Boolean(mapTarget)} onClose={() => setMapTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Map “{mapTarget?.fqn}”</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            label="What does this class represent?"
            value={mapKind}
            onChange={(e) => setMapKind(e.target.value as MapKind)}
          >
            <MenuItem value="job_order">A job order (or several that share this class)</MenuItem>
            <MenuItem value="account">An account — parent, child location, or standalone</MenuItem>
            <MenuItem value="overhead">Overhead / non-client (exclude from client margins)</MenuItem>
          </TextField>

          {mapKind === 'job_order' && (
            <Autocomplete
              multiple
              sx={{ mt: 2 }}
              options={joOptions}
              value={mapJos}
              onChange={(_e, v) => setMapJos(v)}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => (
                <TextField {...params} size="small" label="Job order(s)" placeholder="Type to search…" />
              )}
            />
          )}
          {mapKind === 'account' && (
            <Autocomplete
              sx={{ mt: 2 }}
              options={acctOptions}
              value={mapAcct}
              onChange={(_e, v) => setMapAcct(v)}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderOption={(props, o) => (
                <li {...props} key={o.id} style={{ paddingLeft: o.depth > 0 ? 32 : 16 }}>
                  {o.label}
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} size="small" label="Account" placeholder="Type to search…" />
              )}
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {mapKind === 'job_order' &&
              'Billing and expenses attribute to the job order(s) — and roll up to their account automatically.'}
            {mapKind === 'account' &&
              "Dollars attach at the account. Job Costing shows them as account-level (never guessed down to a specific job order)."}
            {mapKind === 'overhead' &&
              'Dollars are excluded from every client margin view and reported as company overhead.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              busy === mapTarget?.classId ||
              (mapKind === 'job_order' && mapJos.length === 0) ||
              (mapKind === 'account' && !mapAcct)
            }
            onClick={() =>
              mapTarget &&
              void saveMapping(mapTarget, {
                targetKind: mapKind,
                ...(mapKind === 'job_order' ? { jobOrderIds: mapJos.map((j) => j.id) } : {}),
                ...(mapKind === 'account' && mapAcct ? { accountId: mapAcct.id } : {}),
              })
            }
          >
            Save mapping
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add-class dialog (create in QBO + optional map in one step) */}
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
            placeholder="e.g. Outside Lands 2026"
          />
          <Autocomplete
            sx={{ mt: 2 }}
            options={parents}
            value={newParent}
            onChange={(_e, v) => setNewParent(v)}
            getOptionLabel={(o) => o.fqn}
            renderInput={(params) => (
              <TextField {...params} size="small" label="Parent class (optional, e.g. Black Caviar)" />
            )}
          />
          <Autocomplete
            sx={{ mt: 2 }}
            options={joOptions}
            value={newMapJo}
            onChange={(_e, v) => setNewMapJo(v)}
            getOptionLabel={(o) => o.label}
            renderInput={(params) => (
              <TextField {...params} size="small" label="Map to job order (optional — one step)" />
            )}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Creates the class in QuickBooks immediately (flows to Expensify on the next class sync).
            Picking a job order maps it authoritatively in the same step — the per-event-class
            convention that keeps billing attributable.
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
