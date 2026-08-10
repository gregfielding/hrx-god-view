/**
 * Payroll Costs — "what did each job cost us in payroll?" (Greg 2026-07-28).
 *
 * Front-end for the `getPayrollCostReport` callable: pick a date range
 * (+ optional hiring entity), see dollars sent to Everee grouped by
 * job order and account, plus per-submission-day splits the bookkeeper
 * uses to parse funding wires across QBO classes. One-click CSV export
 * with job order + worksite columns per Greg's spec.
 *
 * Plain-English, pick-a-range, no config — per the recruiter-UX ethos.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import WorkersCompMonthlyCard from '../components/payroll/WorkersCompMonthlyCard';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface GroupTotals {
  key: string;
  label: string;
  entries: number;
  workers: number;
  hours: number;
  total: number;
  pct: number;
  /** Name-keyed (class) groups only — absent on byAccount. */
  accountName?: string | null;
  attributed?: boolean;
  jobOrderRefs?: string[];
  poNumbers?: string[];
}

interface ReportData {
  totals: { gross: number; entries: number; workers: number; unattributed: number };
  truncated: boolean;
  byJobOrder: GroupTotals[];
  byAccount: GroupTotals[];
  byBatch: Array<{
    batchId: string;
    hiringEntityId: string;
    total: number;
    entries: number;
    dateRange: { min: string; max: string };
    byJobOrder: Array<{ label: string; total: number; pct: number }>;
  }>;
  rows: Array<Record<string, unknown>>;
  venueMappings?: Array<{
    venueLabel: string;
    jobOrderId: string;
    jobOrderName: string | null;
    jobOrderNumber: string | null;
    accountName: string | null;
  }>;
}

interface JoOption {
  id: string;
  label: string;
}

function monthStartIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const CSV_COLUMNS: Array<{ header: string; key: string }> = [
  { header: 'Worker', key: 'workerName' },
  { header: 'Work date', key: 'workDate' },
  { header: 'Hiring entity', key: 'hiringEntityId' },
  { header: 'Account', key: 'accountName' },
  { header: 'Job order #', key: 'jobOrderNumber' },
  { header: 'Customer PO', key: 'poNumber' },
  { header: 'Job order', key: 'jobOrderName' },
  { header: 'Worksite', key: 'worksiteName' },
  { header: 'Work state', key: 'workState' },
  { header: 'WC code', key: 'workersCompCode' },
  { header: 'WC rate', key: 'workersCompRate' },
  { header: 'Pay rate', key: 'payRate' },
  { header: 'Reg hours', key: 'regularHours' },
  { header: 'OT hours', key: 'overtimeHours' },
  { header: 'DT hours', key: 'doubleTimeHours' },
  { header: 'Hours', key: 'hours' },
  { header: 'Gross', key: 'gross' },
  { header: 'Tips', key: 'tips' },
  { header: 'Bonus', key: 'bonus' },
  { header: 'Premiums', key: 'premiums' },
  { header: 'Total', key: 'total' },
  { header: 'Status', key: 'status' },
  { header: 'Source', key: 'source' },
  { header: 'Sent (entity · day)', key: 'batchId' },
];

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PayrollCostsPage: React.FC = () => {
  const { tenantId } = useAuth();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  /** 0 = Payroll Report, 1 = Workers' Comp Report (Greg 2026-08-05: two tools, two tabs). */
  const [tab, setTab] = useState(0);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  /** Who-was-paid expansion (Greg 2026-08-09): open group keys in the by-JO table. */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  /**
   * Per-group worker rollup from the detail rows the report already returns.
   * The key formula MUST mirror the server's classMap key
   * (`accountId|jo-or-venue|name`) so each table row finds its workers.
   */
  const workersByGroupKey = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; entries: number; hours: number; total: number }>>();
    const agg = new Map<string, Map<string, { name: string; entries: number; hours: number; total: number }>>();
    for (const r of data?.rows ?? []) {
      const jobOrderName = (r.jobOrderName as string | null) || null;
      const name = jobOrderName ?? ((r.worksiteName as string | null) || null) ?? 'Unknown';
      const key = `${(r.accountId as string | null) ?? ''}|${jobOrderName ? 'jo' : 'venue'}|${name}`;
      if (!agg.has(key)) agg.set(key, new Map());
      const workers = agg.get(key)!;
      const wid = String(r.workerId ?? '');
      const w = workers.get(wid) ?? { name: '', entries: 0, hours: 0, total: 0 };
      if (!w.name && r.workerName) w.name = String(r.workerName);
      w.entries += 1;
      w.hours += Number(r.hours) || 0;
      w.total += Number(r.total) || 0;
      workers.set(wid, w);
    }
    for (const [key, workers] of agg) {
      map.set(
        key,
        Array.from(workers.entries())
          .map(([id, w]) => ({ id, ...w, name: w.name || '(no name on file)' }))
          .sort((a, b) => b.total - a.total),
      );
    }
    return map;
  }, [data]);

  // Venue → job order mapping dialog state.
  const [mapVenue, setMapVenue] = useState<string | null>(null);
  const [joOptions, setJoOptions] = useState<JoOption[] | null>(null);
  const [mapJo, setMapJo] = useState<JoOption | null>(null);
  const [mapSaving, setMapSaving] = useState(false);
  /** Complete-the-record wizard (Greg 2026-08-05): position + rate + preview. */
  const [mapPosition, setMapPosition] = useState('');
  /** 'position' = use the picked JO position's own rate (sent as fixed). */
  const [mapRateMode, setMapRateMode] = useState<'actual' | 'fixed' | 'position'>('actual');
  const [mapFixedRate, setMapFixedRate] = useState('');
  /** The selected job order's positions (Greg 2026-08-09) — the Position
      field must offer THIS JO's titles + rates, not free text. */
  const [mapJoPositions, setMapJoPositions] = useState<Array<{ title: string; payRate: number }>>([]);
  const mapPositionRate =
    mapJoPositions.find((p) => p.title.toLowerCase() === mapPosition.trim().toLowerCase())?.payRate ?? 0;

  useEffect(() => {
    setMapJoPositions([]);
    if (!tenantId || !mapJo) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', mapJo.id));
        if (cancelled || !snap.exists()) return;
        const v = snap.data() as Record<string, unknown>;
        const str = (x: unknown): string => String(x ?? '').trim();
        // Same shape chain as the timesheets Fix-assignment card: positions[]
        // → gigPositions[] → career JOs' top-level jobTitle/payRate.
        const raw =
          Array.isArray(v.positions) && v.positions.length
            ? (v.positions as unknown[])
            : Array.isArray(v.gigPositions)
              ? (v.gigPositions as unknown[])
              : [];
        const toPos = (rec: Record<string, unknown>) => ({
          title: str(rec.jobTitle) || str(rec.title),
          payRate: Number(rec.payRate) > 0 ? Number(rec.payRate) : 0,
        });
        const positions = raw.map((p) => toPos((p ?? {}) as Record<string, unknown>)).filter((p) => p.title);
        if (!positions.length && str(v.jobTitle)) positions.push(toPos(v));
        const seen = new Set<string>();
        setMapJoPositions(
          positions.filter((p) => {
            const k = p.title.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          }),
        );
      } catch {
        // Best-effort — the field still accepts free text without options.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, mapJo]);
  const [mapPreview, setMapPreview] = useState<{
    workers: number;
    entries: number;
    dateSpan: string | null;
    jobOrderName: string | null;
    jobTitle: string;
    ongoing: boolean;
    rateSummary?: string[];
  } | null>(null);
  // Off-cycle payment dialog state (Mark's manual adjustment form).
  const [ocOpen, setOcOpen] = useState(false);
  const [ocWorkerQuery, setOcWorkerQuery] = useState('');
  const [ocWorkerOpts, setOcWorkerOpts] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [ocWorker, setOcWorker] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [ocEntity, setOcEntity] = useState('');
  const [ocReason, setOcReason] = useState('missed_hours');
  const [ocDate, setOcDate] = useState(todayIso());
  const [ocHours, setOcHours] = useState('');
  const [ocRate, setOcRate] = useState('');
  const [ocGross, setOcGross] = useState('');
  const [ocGrossTouched, setOcGrossTouched] = useState(false);
  const [ocPerDiem, setOcPerDiem] = useState('');
  const [ocJo, setOcJo] = useState<JoOption | null>(null);
  const [ocNotes, setOcNotes] = useState('');
  const [ocSaving, setOcSaving] = useState(false);
  const [ocError, setOcError] = useState<string | null>(null);
  const [ocSuccess, setOcSuccess] = useState<string | null>(null);
  // Duplicate-pay guard: server found a submitted timesheet for the same
  // worker + work date — sending requires an explicit second confirm.
  const [ocDupWarning, setOcDupWarning] = useState<{
    workDate: string;
    totalHours: number;
    totalAmount: number;
  } | null>(null);

  // Debounced worker search for the off-cycle dialog.
  useEffect(() => {
    if (!ocOpen || ocWorkerQuery.trim().length < 2 || !tenantId) return;
    const t = setTimeout(() => {
      const fn = httpsCallable(functions, 'searchOffCycleWorkers');
      fn({ tenantId, query: ocWorkerQuery.trim() })
        .then((res) => {
          const d = res.data as { workers?: Array<{ id: string; name: string; email: string | null }> };
          setOcWorkerOpts(d.workers ?? []);
        })
        .catch(() => setOcWorkerOpts([]));
    }, 350);
    return () => clearTimeout(t);
  }, [ocOpen, ocWorkerQuery, tenantId]);

  // Gross auto-computes from hours × rate until the user edits it directly.
  useEffect(() => {
    if (ocGrossTouched) return;
    const h = Number(ocHours);
    const r = Number(ocRate);
    if (h > 0 && r > 0) setOcGross((Math.round(h * r * 100) / 100).toFixed(2));
  }, [ocHours, ocRate, ocGrossTouched]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) =>
        setEntities(
          snap.docs
            .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
            .filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.name)),
        ),
      )
      .catch(() => setEntities([]));
  }, [tenantId]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport');
      // An inverted range (start after end) is a picker slip, not intent —
      // swap instead of surfacing the server's range error.
      const [s, e] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
      const res = await fn({
        tenantId,
        startDate: s,
        endDate: e,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      setData(res.data as ReportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, startDate, endDate, entityId]);

  // Auto-load on mount AND whenever a filter changes (`load`'s identity
  // tracks entity + dates). The old initial-load-only wiring left a stale
  // table under fresh-looking controls — Greg read Events rows as a C1
  // Select misattribution (2026-08-05, Oakland Arena). Debounced so a
  // quick entity + date adjustment coalesces into one fetch; the Load
  // button stays as a manual refresh.
  const loadDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (loadDebounceRef.current) window.clearTimeout(loadDebounceRef.current);
    loadDebounceRef.current = window.setTimeout(() => {
      void load();
    }, 350);
    return () => {
      if (loadDebounceRef.current) window.clearTimeout(loadDebounceRef.current);
    };
  }, [load]);

  const ensureJoOptions = useCallback(async () => {
    if (joOptions || !tenantId) return;
    // Account names for the option labels (Greg 2026-08-05: "#id — name —
    // company — worksite") — one bulk read, id → name in memory.
    const accountName = new Map<string, string>();
    try {
      const acctSnap = await getDocs(collection(db, 'tenants', tenantId, 'accounts'));
      acctSnap.docs.forEach((d) => {
        const n = String(d.data().name ?? d.data().accountName ?? '').trim();
        if (n) accountName.set(d.id, n);
      });
    } catch {
      // Accounts unreadable — labels just omit the company part.
    }
    const opts: JoOption[] = [];
    const seen = new Set<string>();
    for (const coll of ['job_orders', 'recruiter_jobOrders']) {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, coll));
        snap.docs.forEach((d) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          const v = d.data();
          const name = String(v.jobOrderName ?? '').trim();
          if (!name) return;
          const numPart = String(v.jobOrderNumber ?? '').trim();
          const sitePart = String(v.worksiteName ?? '').trim();
          const company =
            String(v.accountName ?? '').trim() ||
            accountName.get(String(v.recruiterAccountId ?? '').trim()) ||
            '';
          opts.push({
            id: d.id,
            label: [
              `${numPart ? `#${numPart} ` : ''}${name}`,
              company && company !== name ? company : null,
              sitePart && sitePart !== name && sitePart !== company ? sitePart : null,
            ]
              .filter(Boolean)
              .join(' — '),
          });
        });
      } catch {
        // Collection may not exist for this tenant — keep going.
      }
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    setJoOptions(opts);
  }, [joOptions, tenantId]);

  const openMapDialog = async (unattributedLabel: string) => {
    setMapVenue(unattributedLabel.replace(/^Unattributed — /, ''));
    setMapJo(null);
    setMapPosition('');
    setMapRateMode('actual');
    setMapFixedRate('');
    setMapPreview(null);
    void ensureJoOptions();
  };

  /**
   * The real repair: create an assignment per worker from the venue's paid
   * entries (dryRun first for the preview), so rate/worksite/WC persist and
   * future imports pair automatically — not just a report-time label patch.
   */
  const runCompleteMapping = async (dryRun: boolean) => {
    if (!tenantId || !mapVenue || !mapJo) return;
    setMapSaving(true);
    try {
      const fn = httpsCallable(functions, 'completeVenueMapping');
      const res = await fn({
        tenantId,
        venueLabel: mapVenue,
        jobOrderId: mapJo.id,
        positionTitle: mapPosition.trim() || undefined,
        // 'position' is client-side sugar: the picked JO position's own rate,
        // sent to the server as a fixed rate.
        rateMode: mapRateMode === 'position' ? 'fixed' : mapRateMode,
        ...(mapRateMode === 'fixed'
          ? { fixedRate: Number(mapFixedRate) }
          : mapRateMode === 'position'
            ? { fixedRate: mapPositionRate }
            : {}),
        dryRun,
      });
      const data = res.data as any;
      if (dryRun) {
        setMapPreview(data);
      } else {
        setOcSuccess(
          `Created ${data.assignmentsCreated} assignments (${data.assignmentsReused} already existed) and connected ${data.entriesStamped} payments for “${mapVenue}”.`,
        );
        setMapVenue(null);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapSaving(false);
    }
  };

  const saveMapping = async (venueLabel: string, jobOrderId: string | null) => {
    if (!tenantId) return;
    setMapSaving(true);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({ tenantId, venueLabel, ...(jobOrderId ? { jobOrderId } : {}) });
      setMapVenue(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMapSaving(false);
    }
  };

  const openOffCycle = () => {
    setOcOpen(true);
    setOcError(null);
    setOcSuccess(null);
    setOcWorker(null);
    setOcWorkerQuery('');
    setOcWorkerOpts([]);
    setOcEntity(entityId || entities[0]?.id || '');
    setOcReason('missed_hours');
    setOcDate(todayIso());
    setOcHours('');
    setOcRate('');
    setOcGross('');
    setOcGrossTouched(false);
    setOcPerDiem('');
    setOcJo(null);
    setOcNotes('');
    setOcDupWarning(null);
    void ensureJoOptions();
  };

  const submitOffCycle = async (overrideDuplicateWarning = false) => {
    if (!tenantId || !ocWorker || !ocEntity) return;
    setOcSaving(true);
    setOcError(null);
    try {
      const fn = httpsCallable(functions, 'createOffCyclePayment');
      const res = await fn({
        tenantId,
        hiringEntityId: ocEntity,
        workerId: ocWorker.id,
        reason: ocReason,
        workDate: ocDate,
        hours: Number(ocHours) || 0,
        hourlyRate: Number(ocRate) || 0,
        grossAmount: Number(ocGross) || 0,
        perDiemAmount: Number(ocPerDiem) || 0,
        ...(ocJo ? { jobOrderId: ocJo.id } : {}),
        notes: ocNotes,
        ...(overrideDuplicateWarning ? { overrideDuplicateWarning: true } : {}),
      });
      const d = res.data as {
        total?: number;
        status?: string;
        duplicateWarning?: { workDate: string; totalHours: number; totalAmount: number };
      };
      // Duplicate-pay guard: nothing was sent — ask before paying twice.
      if (d.status === 'duplicate_warning' && d.duplicateWarning) {
        setOcDupWarning(d.duplicateWarning);
        return;
      }
      setOcDupWarning(null);
      setOcOpen(false);
      setOcSuccess(`Payment of ${usd(d.total)} for ${ocWorker.name} sent to Everee.`);
      await load();
    } catch (err) {
      setOcError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcSaving(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = [
      CSV_COLUMNS.map((c) => c.header).join(','),
      ...data.rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-costs-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptLongIcon fontSize="small" />
            <span>Payroll Costs</span>
          </Box>
        }
      />

      {/* Shared entity picker + the two report tabs. Each tab owns its own
          date control (range vs month) — the side-by-side duplicate date
          fields read as one confusing form (Greg 2026-08-05). */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ pb: 0 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Hiring entity</InputLabel>
            <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
              <MenuItem value="">All entities</MenuItem>
              {entities.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mt: 1 }}>
            <Tab label="Payroll Report" />
            <Tab label="Workers' Comp Report" />
          </Tabs>
        </CardContent>
      </Card>

      {tab === 0 && (
        <>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              type="date"
              label="Start"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="End"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={exportCsv}
              disabled={!data || data.rows.length === 0}
            >
              Export CSV
            </Button>
            <Button variant="outlined" color="secondary" onClick={openOffCycle}>
              New off-cycle payment
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Dollars sent to Everee (sent + paid entries) for work dates in the range. Rows that
            can&apos;t be tied to a job order show as &quot;Unattributed&quot; with their venue.
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {ocSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setOcSuccess(null)}>
          {ocSuccess}
        </Alert>
      )}
      {loading && !data && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={30} />
        </Box>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Total payroll', value: usd(data.totals.gross) },
              { label: 'Entries', value: String(data.totals.entries) },
              { label: 'Workers', value: String(data.totals.workers) },
              { label: 'Unattributed', value: usd(data.totals.unattributed) },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 140 }}>
                <Typography variant="caption" color="text.secondary">
                  {t.label}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {t.value}
                </Typography>
              </Paper>
            ))}
          </Box>
          {data.truncated && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This range has more rows than the report can return — narrow the dates for complete
              detail rows (summaries above are still complete).
            </Alert>
          )}

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By job order (name)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Grouped by job order name — same-name orders merge into one row (the name is the
                QBO class). Internal #ids and customer POs are shown as references.
              </Typography>
              <TableContainer sx={{ maxHeight: 440 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Job order</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Refs</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">% of payroll</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byJobOrder.map((g) => {
                      const open = expandedGroups.has(g.key);
                      const groupWorkers = workersByGroupKey.get(g.key) ?? [];
                      const toggle = () =>
                        setExpandedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.key)) next.delete(g.key);
                          else next.add(g.key);
                          return next;
                        });
                      return (
                        <React.Fragment key={g.key}>
                          <TableRow hover onClick={toggle} sx={{ cursor: 'pointer' }}>
                            <TableCell>
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                {open ? (
                                  <KeyboardArrowUpIcon fontSize="small" color="action" />
                                ) : (
                                  <KeyboardArrowDownIcon fontSize="small" color="action" />
                                )}
                                <span>{g.label}</span>
                              </Stack>
                            </TableCell>
                            <TableCell>{g.accountName ?? '—'}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {g.attributed === false ? (
                                <Button size="small" variant="outlined" onClick={() => void openMapDialog(g.label)}>
                                  Map to job order
                                </Button>
                              ) : (
                                [
                                  ...(g.poNumbers ?? []).map((p) => `PO ${p}`),
                                  ...(g.jobOrderRefs ?? []),
                                ].join(', ') || '—'
                              )}
                            </TableCell>
                            <TableCell align="right">{g.workers}</TableCell>
                            <TableCell align="right">{g.hours.toFixed(1)}</TableCell>
                            <TableCell align="right">{usd(g.total)}</TableCell>
                            <TableCell align="right">{g.pct}%</TableCell>
                          </TableRow>
                          {open && (
                            <TableRow>
                              <TableCell colSpan={7} sx={{ py: 0, bgcolor: 'action.hover' }}>
                                <Box sx={{ maxHeight: 260, overflowY: 'auto', py: 1 }}>
                                  <Table size="small">
                                    <TableBody>
                                      {groupWorkers.map((w) => (
                                        <TableRow key={w.id}>
                                          <TableCell sx={{ border: 0, py: 0.25 }}>{w.name}</TableCell>
                                          <TableCell sx={{ border: 0, py: 0.25 }} align="right">
                                            {w.entries} {w.entries === 1 ? 'payment' : 'payments'}
                                          </TableCell>
                                          <TableCell sx={{ border: 0, py: 0.25 }} align="right">
                                            {w.hours.toFixed(1)} h
                                          </TableCell>
                                          <TableCell sx={{ border: 0, py: 0.25 }} align="right">
                                            {usd(w.total)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                      {groupWorkers.length === 0 && (
                                        <TableRow>
                                          <TableCell sx={{ border: 0 }}>
                                            <Typography variant="caption" color="text.secondary">
                                              Detail rows unavailable for this range (report truncated) —
                                              narrow the dates to see workers.
                                            </Typography>
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </TableBody>
                                  </Table>
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                By account
              </Typography>
              <TableContainer sx={{ maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">% of payroll</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byAccount.map((g) => (
                      <TableRow key={g.key} hover>
                        <TableCell>{g.label}</TableCell>
                        <TableCell align="right">{g.workers}</TableCell>
                        <TableCell align="right">{usd(g.total)}</TableCell>
                        <TableCell align="right">{g.pct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                Wire splits — by submission day
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Each Everee funding wire maps to a submission day. Apply these percentages to the
                wire total (taxes + fees allocate pro-rata) to split it across QBO classes.
              </Typography>
              {data.byBatch.map((b) => (
                <Paper key={b.batchId} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {b.batchId} · work {b.dateRange.min} → {b.dateRange.max} · {usd(b.total)} (
                    {b.entries} entries)
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {b.byJobOrder.map((j) => (
                        <TableRow key={j.label}>
                          <TableCell sx={{ border: 0 }}>{j.label}</TableCell>
                          <TableCell sx={{ border: 0 }} align="right">
                            {usd(j.total)}
                          </TableCell>
                          <TableCell sx={{ border: 0 }} align="right" width={80}>
                            {j.pct}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              ))}
            </CardContent>
          </Card>

          {(data.venueMappings?.length ?? 0) > 0 && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Venue → job order mappings
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Entries whose venue can&apos;t be tied to a job order automatically are attributed
                  using these mappings — past and future.
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Venue label</TableCell>
                      <TableCell>Job order</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Remove</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.venueMappings?.map((m) => (
                      <TableRow key={m.venueLabel} hover>
                        <TableCell>{m.venueLabel}</TableCell>
                        <TableCell>
                          {m.jobOrderNumber ? `#${m.jobOrderNumber} ` : ''}
                          {m.jobOrderName ?? m.jobOrderId}
                        </TableCell>
                        <TableCell>{m.accountName ?? '—'}</TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            disabled={mapSaving}
                            onClick={() => void saveMapping(m.venueLabel, null)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
        </>
      )}

      {tab === 1 && (
        <WorkersCompMonthlyCard
          tenantId={tenantId}
          entityId={entityId}
          entityName={entities.find((e) => e.id === entityId)?.name ?? null}
        />
      )}

      <Dialog open={ocOpen} onClose={() => !ocSaving && setOcOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New off-cycle payment</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sends the payment to Everee right away and records it against the job order so it shows
            in payroll costs.
          </Typography>
          {ocError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOcError(null)}>
              {ocError}
            </Alert>
          )}
          {ocDupWarning && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This worker already has a submitted timesheet for {ocDupWarning.workDate} (
              {ocDupWarning.totalHours}h, {usd(ocDupWarning.totalAmount)}). Send anyway?
            </Alert>
          )}
          <Stack spacing={2}>
            <Autocomplete
              options={ocWorkerOpts}
              getOptionLabel={(o) => (o.email ? `${o.name} (${o.email})` : o.name)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(x) => x}
              value={ocWorker}
              onChange={(_e, v) => {
                setOcWorker(v);
                setOcDupWarning(null);
              }}
              onInputChange={(_e, v) => setOcWorkerQuery(v)}
              noOptionsText={ocWorkerQuery.trim().length < 2 ? 'Type a name or email…' : 'No workers found'}
              renderInput={(params) => <TextField {...params} label="Worker" autoFocus />}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={ocEntity} label="Hiring entity" onChange={(e) => setOcEntity(e.target.value)}>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Payment reason</InputLabel>
              <Select value={ocReason} label="Payment reason" onChange={(e) => setOcReason(e.target.value)}>
                <MenuItem value="missed_hours">Missed hours</MenuItem>
                <MenuItem value="late_timesheet">Late timesheet</MenuItem>
                <MenuItem value="forgot_bank_account">Forgot bank account</MenuItem>
                <MenuItem value="bonus">Bonus</MenuItem>
                <MenuItem value="expense_reimbursement">Expense reimbursement</MenuItem>
                <MenuItem value="payroll_correction">Payroll correction</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Work date"
              type="date"
              value={ocDate}
              onChange={(e) => {
                setOcDate(e.target.value);
                setOcDupWarning(null);
              }}
              InputLabelProps={{ shrink: true }}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                label="Hours"
                type="number"
                value={ocHours}
                onChange={(e) => setOcHours(e.target.value)}
              />
              <TextField
                size="small"
                label="Hourly rate"
                type="number"
                value={ocRate}
                onChange={(e) => setOcRate(e.target.value)}
              />
              <TextField
                size="small"
                label="Gross amount"
                type="number"
                value={ocGross}
                onChange={(e) => {
                  setOcGross(e.target.value);
                  setOcGrossTouched(true);
                }}
                helperText="Auto-fills from hours × rate"
              />
            </Stack>
            <TextField
              size="small"
              label="Per diem (optional)"
              type="number"
              value={ocPerDiem}
              onChange={(e) => setOcPerDiem(e.target.value)}
              sx={{ maxWidth: 220 }}
            />
            <Autocomplete
              options={joOptions ?? []}
              loading={joOptions === null}
              value={ocJo}
              onChange={(_e, v) => setOcJo(v)}
              renderInput={(params) => <TextField {...params} label="Job order (for cost attribution)" />}
            />
            <TextField
              size="small"
              label="Notes"
              multiline
              minRows={2}
              value={ocNotes}
              onChange={(e) => setOcNotes(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOcOpen(false)} disabled={ocSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={ocDupWarning ? 'warning' : 'primary'}
            disabled={
              ocSaving ||
              !ocWorker ||
              !ocEntity ||
              (Number(ocGross) || 0) + (Number(ocPerDiem) || 0) <= 0
            }
            onClick={() => void submitOffCycle(Boolean(ocDupWarning))}
          >
            {ocSaving
              ? 'Sending…'
              : `Send ${usd((Number(ocGross) || 0) + (Number(ocPerDiem) || 0))} ${ocDupWarning ? 'anyway' : 'to Everee'}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mapVenue !== null} onClose={() => setMapVenue(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Map “{mapVenue}” to a job order</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pick the job order and position, then preview — HRX creates a real assignment for each
            worker (their actual paid rate, worksite, and workers&apos; comp fill in from the job
            order), so payroll and WC data stay complete here and in every future import.
          </Typography>
          <Autocomplete
            options={joOptions ?? []}
            loading={joOptions === null}
            value={mapJo}
            onChange={(_e, v) => {
              setMapJo(v);
              setMapPreview(null);
            }}
            renderInput={(params) => <TextField {...params} label="Job order" autoFocus />}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <Autocomplete
              freeSolo
              size="small"
              options={mapJoPositions}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.title)}
              renderOption={(props, o) => (
                <li {...props} key={o.title}>
                  {o.title}
                  {o.payRate > 0 ? ` — $${o.payRate.toFixed(2)}/hr` : ''}
                </li>
              )}
              inputValue={mapPosition}
              onInputChange={(_e, v) => {
                setMapPosition(v);
                setMapPreview(null);
                // A different position invalidates a position-rate selection.
                if (mapRateMode === 'position') setMapRateMode('actual');
              }}
              sx={{ minWidth: 240 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Position / job title"
                  placeholder={
                    mapJoPositions.length
                      ? `${mapJoPositions.length} position${mapJoPositions.length === 1 ? '' : 's'} on this job order`
                      : "defaults to the job order's title"
                  }
                />
              )}
            />
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>Pay rate</InputLabel>
              <Select
                value={mapRateMode}
                label="Pay rate"
                onChange={(e) => {
                  setMapRateMode(e.target.value as 'actual' | 'fixed' | 'position');
                  setMapPreview(null);
                }}
              >
                <MenuItem value="actual">Actual paid rates</MenuItem>
                {mapPositionRate > 0 && (
                  <MenuItem value="position">Position rate (${mapPositionRate.toFixed(2)})</MenuItem>
                )}
                <MenuItem value="fixed">One rate for all</MenuItem>
              </Select>
            </FormControl>
            {mapRateMode === 'fixed' && (
              <TextField
                size="small"
                label="Rate"
                value={mapFixedRate}
                onChange={(e) => {
                  setMapFixedRate(e.target.value);
                  setMapPreview(null);
                }}
                sx={{ width: 100 }}
              />
            )}
          </Stack>
          {mapPreview && (
            <Alert severity={mapPreview.workers > 0 ? 'info' : 'warning'} sx={{ mt: 2 }}>
              {mapPreview.workers > 0 ? (
                <>
                  <strong>{mapPreview.workers} workers · {mapPreview.entries} payments</strong>{' '}
                  ({mapPreview.dateSpan}) → {mapPreview.workers} assignments under{' '}
                  {mapPreview.jobOrderName ?? 'this job order'}
                  {mapPreview.jobTitle ? ` as “${mapPreview.jobTitle}”` : ''}.
                  {mapPreview.rateSummary?.length ? ` Rates: ${mapPreview.rateSummary.join(', ')}.` : ''}
                  {mapPreview.ongoing
                    ? ' Assignments stay open (ongoing venue) so future imports connect automatically.'
                    : ' Assignments close at each worker’s last day.'}
                  {' '}No worker notifications are sent.
                </>
              ) : (
                'No unattributed payments matched this venue label — saving will store the label mapping only.'
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapVenue(null)} disabled={mapSaving}>
            Cancel
          </Button>
          <Button
            disabled={!mapJo || mapSaving}
            onClick={() => mapVenue && mapJo && void saveMapping(mapVenue, mapJo.id)}
          >
            Label only
          </Button>
          {!mapPreview ? (
            <Button
              variant="contained"
              disabled={!mapJo || mapSaving || (mapRateMode === 'fixed' && !(Number(mapFixedRate) > 0))}
              onClick={() => void runCompleteMapping(true)}
            >
              {mapSaving ? 'Checking…' : 'Preview'}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={mapSaving || mapPreview.workers === 0}
              onClick={() => void runCompleteMapping(false)}
            >
              {mapSaving ? 'Creating…' : `Create ${mapPreview.workers} assignments & save`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PayrollCostsPage;
