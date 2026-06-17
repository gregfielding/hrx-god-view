/**
 * CsvTimesheetImport — the "Import CSV" tab on /timesheets.
 *
 * Phase 0: upload a customer timesheet CSV (Indeed Flex hardcoded for
 * now), parse + classify the rows, and show a preview. No worker
 * matching, persistence, or Everee submission yet — those are later
 * phases. This is intentionally client-only so it's safe + fast to ship
 * as the foundation.
 */

import React, { useMemo, useRef, useState } from 'react';
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
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Switch,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import type { HiringEntity } from '../../types/recruiter/hiringEntity';
import {
  mapIndeedFlexRows,
  looksLikeIndeedFlex,
  type ParsedImport,
  type ParsedTimesheetRow,
  type ImportRowStatus,
} from '../../utils/timesheets/indeedFlexImport';
import {
  mapConnectTeamRows,
  looksLikeConnectTeam,
} from '../../utils/timesheets/connectTeamImport';

/** One worker-match result from the importTimesheetMatchWorkers callable. */
interface MatchRowResult {
  rowIndex: number;
  email: string;
  matched: boolean;
  ambiguous: boolean;
  userId: string | null;
  displayName: string | null;
  evereeWorkerId: string | null;
  evereeLinked: boolean;
  matchedByName: boolean;
  block: boolean;
  blockReason: string | null;
  // Phase 2: paired assignment + resolved pay context.
  assignmentId: string | null;
  jobOrderId: string | null;
  shiftId: string | null;
  jobTitle: string | null;
  worksiteId: string | null;
  worksiteName: string | null;
  worksiteAddress: { street: string; city: string; state: string; zip: string } | null;
  workersCompCode: string | null;
  workersCompRate: number | null;
  payRate: number | null;
  payRateSource: 'assignment' | 'site_mapping' | 'none';
  workersCompSource: 'assignment' | 'site_mapping' | 'account' | 'none';
  worksiteSource: 'assignment' | 'site_mapping' | 'account' | 'none';
  needsPayRate: boolean;
  /** Candidate HRX workers to resolve a no-match / ambiguous email. */
  suggestions?: WorkerSuggestion[];
}

/** A candidate HRX worker offered when an email doesn't resolve cleanly. */
interface WorkerSuggestion {
  userId: string;
  displayName: string | null;
  email: string | null;
  evereeLinked: boolean;
  reason: string;
}

/** Inline, manually-entered overrides for a row's Everee-bound fields. */
interface RowOverride {
  payRate?: number;
  workersCompCode?: string;
  workersCompRate?: number;
}
type OverrideField = keyof RowOverride;

/** A pickable HRX job order for the site-mapping dialog. */
interface JobOrderOption {
  id: string;
  jobTitle: string;
  accountName: string;
  label: string;
}
interface MatchWorkersResponse {
  evereeTenantId: string | null;
  entityEvereeEnabled: boolean;
  results: MatchRowResult[];
}

type CustomerKey = 'indeed_flex' | 'connect_team';

const CUSTOMERS: Array<{
  key: CustomerKey;
  label: string;
  /** File kind the export comes as. */
  fileKind: 'csv' | 'xlsx';
  /** Account this customer's timesheets always belong to (informational). */
  account?: string;
  /** Substring used to auto-select the paying entity when picked. */
  defaultEntityMatch?: string;
}> = [
  { key: 'indeed_flex', label: 'Indeed Flex', fileKind: 'csv' },
  {
    key: 'connect_team',
    label: 'Connect Team',
    fileKind: 'xlsx',
    account: 'VenueSmart',
    defaultEntityMatch: 'c1 events',
  },
];

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  importable: 'Importable',
  excluded_future: 'Future',
  excluded_absence: 'Absence',
  excluded_no_email: 'No email',
  excluded_other: 'Excluded',
};

function statusChipColor(s: ImportRowStatus): 'success' | 'default' | 'warning' {
  if (s === 'importable') return 'success';
  if (s === 'excluded_no_email' || s === 'excluded_other') return 'warning';
  return 'default';
}

/** Confidence levels for the per-field provenance color-coding. */
type Conf = 'exact' | 'probable' | 'guess' | 'select' | 'problem';
const CONF_TOKEN: Record<Conf, string> = {
  exact: 'primary.main', // blue — assignment / unique match / linked / typed
  probable: 'success.main', // green — remembered site→JO mapping
  guess: 'warning.main', // amber — account-level fallback
  select: 'text.disabled', // grey — needs selection
  problem: 'error.main', // red — not linked / ambiguous / no match
};
const CONF_LABEL: Record<Conf, string> = {
  exact: 'Exact match',
  probable: 'Probable (remembered mapping)',
  guess: 'Guess (account default)',
  select: 'Needs selection',
  problem: 'Problem',
};
const sourceConf = (src: 'assignment' | 'site_mapping' | 'account' | 'none'): Conf =>
  src === 'assignment'
    ? 'exact'
    : src === 'site_mapping'
      ? 'probable'
      : src === 'account'
        ? 'guess'
        : 'select';

const ConfDot: React.FC<{ level: Conf; title?: string }> = ({ level, title }) => (
  <Tooltip title={title || CONF_LABEL[level]}>
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: CONF_TOKEN[level],
        mr: 0.75,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    />
  </Tooltip>
);

interface CsvTimesheetImportProps {
  tenantId: string;
  entities: HiringEntity[];
  defaultEntityId?: string | null;
}

const CsvTimesheetImport: React.FC<CsvTimesheetImportProps> = ({
  tenantId,
  entities,
  defaultEntityId,
}) => {
  const [customer, setCustomer] = useState<CustomerKey>('indeed_flex');
  const [entityId, setEntityId] = useState<string>(defaultEntityId || '');
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  // Match result by source rowIndex (only importable rows are matched).
  const [matchByRow, setMatchByRow] = useState<Map<number, MatchRowResult>>(new Map());
  // Excluded rows (future / absence / no-email) are hidden by default —
  // they're noise; the recruiter cares about the payable (importable) rows.
  const [showExcluded, setShowExcluded] = useState(false);
  // Site → job order mapping (P3): job-order options loaded lazily on first
  // map-dialog open, then cached; the dialog itself is keyed on the site string.
  const [jobOrders, setJobOrders] = useState<JobOrderOption[] | null>(null);
  const [jobOrdersLoading, setJobOrdersLoading] = useState(false);
  const [mapSite, setMapSite] = useState<string | null>(null);
  const [mapJobOrder, setMapJobOrder] = useState<JobOrderOption | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Worker resolution (slice #1): pick the right HRX worker for an
  // unresolved CSV email, then remember it as an alias.
  const [resolveRow, setResolveRow] = useState<{
    email: string;
    firstName: string;
    lastName: string;
    name: string;
  } | null>(null);
  const [resolveSuggestions, setResolveSuggestions] = useState<WorkerSuggestion[]>([]);
  const [resolvePick, setResolvePick] = useState<string>('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Inline cell overrides (this import session): manually-entered pay rate /
  // WC code / WC rate, keyed by row. They win over the resolved value and
  // survive a re-match; they flow into the Everee submit payload (P4).
  const [overrides, setOverrides] = useState<Map<number, RowOverride>>(new Map());
  const [editing, setEditing] = useState<{ rowIndex: number; field: OverrideField } | null>(null);
  const [editValue, setEditValue] = useState('');
  // After typing a pay rate, offer to copy it to every other worker on the
  // same Type/site (e.g. all Railbird workers) in one tap.
  const [bulkRatePrompt, setBulkRatePrompt] = useState<{
    site: string;
    rate: number;
    rowIndexes: number[];
  } | null>(null);
  // Submit-to-Everee (P4): dry-run preview, then live submit.
  const [submitting, setSubmitting] = useState(false);
  const [submitPreview, setSubmitPreview] = useState<{
    count: number;
    totalAmount: number;
    preview: Array<{ workerName: string; workDate: string; hours: number; payRate: number; amount: number }>;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<{ submitted: number; failed: number; totalAmount: number; errors: string[] } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Per-payable submitted status (persisted) keyed by externalId, so the grid
  // shows what's already been sent + lets the recruiter void it.
  const [submittedByExtId, setSubmittedByExtId] = useState<Map<string, { status: string; amount: number }>>(new Map());
  const [voidingExtId, setVoidingExtId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importableRows = parsed?.rows.filter((r) => r.status === 'importable') ?? [];

  // Lazily load the tenant's job orders for the mapping picker. Walks the
  // three doc-path candidates the rest of the codebase uses and merges by id.
  const loadJobOrders = async () => {
    if (jobOrders || jobOrdersLoading) return;
    setJobOrdersLoading(true);
    try {
      const byId = new Map<string, JobOrderOption>();
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        try {
          const snap = await getDocs(collection(db, 'tenants', tenantId, coll));
          snap.forEach((d) => {
            if (byId.has(d.id)) return;
            const jo = d.data() as Record<string, any>;
            const jobTitle = String(jo.jobTitle || jo.title || '').trim();
            const accountName = String(
              jo.recruiterAccountName || jo.accountName || jo.companyName || '',
            ).trim();
            byId.set(d.id, {
              id: d.id,
              jobTitle,
              accountName,
              label: `${jobTitle || '(untitled job order)'}${accountName ? ` — ${accountName}` : ''}`,
            });
          });
        } catch {
          /* collection may not exist; try next */
        }
      }
      const opts = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
      setJobOrders(opts);
    } finally {
      setJobOrdersLoading(false);
    }
  };

  const openMapDialog = (site: string) => {
    setMapSite(site);
    setMapJobOrder(null);
    setMapError(null);
    void loadJobOrders();
  };

  const saveMapping = async () => {
    if (!mapSite || !mapJobOrder) return;
    setSavingMapping(true);
    setMapError(null);
    try {
      const fn = httpsCallable<
        { tenantId: string; customer: string; site: string; jobOrderId: string },
        { ok: true; docId: string; accountName: string | null }
      >(functions, 'saveTimesheetSiteMapping');
      await fn({ tenantId, customer, site: mapSite, jobOrderId: mapJobOrder.id });
      setMapSite(null);
      setMapJobOrder(null);
      // Re-run the match so every row with this site picks up the new mapping.
      await runMatch();
    } catch (err: any) {
      console.error('saveTimesheetSiteMapping failed:', err);
      setMapError(err?.message || 'Failed to save the site mapping.');
    } finally {
      setSavingMapping(false);
    }
  };

  const openResolveDialog = (
    row: { email: string; firstName: string; lastName: string },
    suggestions: WorkerSuggestion[],
  ) => {
    setResolveRow({
      ...row,
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
    });
    setResolveSuggestions(suggestions);
    setResolvePick(suggestions[0]?.userId ?? '');
    setResolveError(null);
  };

  const saveAlias = async () => {
    if (!resolveRow || !resolvePick) return;
    setSavingAlias(true);
    setResolveError(null);
    try {
      const fn = httpsCallable<
        {
          tenantId: string;
          userId: string;
          email?: string;
          customer?: string;
          firstName?: string;
          lastName?: string;
        },
        { ok: true; docId: string; displayName: string | null }
      >(functions, 'saveTimesheetWorkerAlias');
      // Email customers key the alias on email; no-email customers (Connect
      // Team) key it on the worker's name, scoped to the customer.
      await fn(
        resolveRow.email
          ? { tenantId, userId: resolvePick, email: resolveRow.email }
          : {
              tenantId,
              userId: resolvePick,
              customer,
              firstName: resolveRow.firstName,
              lastName: resolveRow.lastName,
            },
      );
      setResolveRow(null);
      setResolveSuggestions([]);
      setResolvePick('');
      // Re-run the match so every row for this worker resolves.
      await runMatch();
    } catch (err: any) {
      console.error('saveTimesheetWorkerAlias failed:', err);
      setResolveError(err?.message || 'Failed to save the worker match.');
    } finally {
      setSavingAlias(false);
    }
  };

  /** Match in batches: bounded per-call work (fits the deadline at any file
   *  size), live progress as each batch lands, and a failed batch costs only
   *  itself — the rest still resolve. */
  const MATCH_BATCH_SIZE = 400;
  const runMatch = async () => {
    if (!entityId || importableRows.length === 0) return;
    setMatching(true);
    setMatchError(null);
    const fn = httpsCallable<
      {
        tenantId: string;
        hiringEntityId: string;
        hiringEntityName: string;
        customer: string;
        customerAccount: string;
        rows: Array<{
          rowIndex: number;
          email: string;
          firstName: string;
          lastName: string;
          workDate: string;
          site: string;
          role: string;
        }>;
      },
      MatchWorkersResponse
    >(functions, 'importTimesheetMatchWorkers', { timeout: 300000 });
    const payload = (r: ParsedTimesheetRow) => ({
      rowIndex: r.rowIndex,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      workDate: r.workDate,
      site: r.site,
      role: r.role,
    });
    const merged = new Map<number, MatchRowResult>();
    let entityEvereeEnabled = true;
    let failed = 0;
    try {
      for (let i = 0; i < importableRows.length; i += MATCH_BATCH_SIZE) {
        const slice = importableRows.slice(i, i + MATCH_BATCH_SIZE);
        setMatchProgress({ done: i, total: importableRows.length });
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await fn({
            tenantId,
            hiringEntityId: entityId,
            hiringEntityName: entities.find((e) => e.id === entityId)?.name || '',
            customer,
            customerAccount: CUSTOMERS.find((c) => c.key === customer)?.account || '',
            rows: slice.map(payload),
          });
          (res.data?.results ?? []).forEach((m) => merged.set(m.rowIndex, m));
          if (res.data && !res.data.entityEvereeEnabled) entityEvereeEnabled = false;
        } catch (err: any) {
          console.error(`importTimesheetMatchWorkers batch @${i} failed:`, err);
          failed += slice.length;
        }
        // Show results live as each batch completes.
        setMatchByRow(new Map(merged));
      }
      if (!entityEvereeEnabled) {
        setMatchError(
          'The selected hiring entity is not configured for Everee payroll — every row will be blocked until you pick an Everee-enabled entity.',
        );
      } else if (failed > 0) {
        setMatchError(
          `${failed} row${failed === 1 ? '' : 's'} couldn’t be matched (a batch errored) — click Match again to retry.`,
        );
      }
    } finally {
      setMatching(false);
      setMatchProgress(null);
    }
    // Surface any rows already submitted to Everee for this customer.
    await loadSubmitted();
  };

  // Reset match results whenever the parse or entity changes.
  const resetMatch = () => {
    setMatchByRow(new Map());
    setMatchError(null);
    setOverrides(new Map());
    setEditing(null);
    setSubmittedByExtId(new Map());
  };

  const handleFile = (file: File) => {
    setError(null);
    setParsed(null);
    resetMatch();
    setFileName(file.name);
    setParsing(true);

    // Connect Team exports as .xlsx (parse the "All Employees" sheet with
    // SheetJS); Indeed Flex exports as CSV (PapaParse).
    if (customer === 'connect_team') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const sheetName =
            wb.SheetNames.find((n) => n.trim().toLowerCase() === 'all employees') ||
            wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json(ws, {
            raw: false,
            defval: '',
          }) as Array<Record<string, unknown>>;
          if (!rawRows.length) {
            setError('That file has no data rows.');
            return;
          }
          if (!looksLikeConnectTeam(rawRows)) {
            setError(
              "This doesn't look like a Connect Team export — it's missing expected columns (First name, Last name, Start Date, Daily total hours, Type). Check the file or customer selection.",
            );
            return;
          }
          setParsed(mapConnectTeamRows(rawRows));
        } catch (err: any) {
          setError(`Failed to parse the Excel file: ${err?.message || err}`);
        } finally {
          setParsing(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read the file.');
        setParsing(false);
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rawRows = (results.data as Array<Record<string, unknown>>) || [];
          if (!rawRows.length) {
            setError('That file has no data rows.');
            return;
          }
          if (customer === 'indeed_flex' && !looksLikeIndeedFlex(rawRows)) {
            setError(
              "This doesn't look like an Indeed Flex export — it's missing expected columns (Email, Date, Hours, Timesheet Status). Check the file or customer selection.",
            );
            return;
          }
          setParsed(mapIndeedFlexRows(rawRows));
        } finally {
          setParsing(false);
        }
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
        setParsing(false);
      },
    });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // reset so re-selecting the same file re-fires onChange
    e.target.value = '';
  };

  const s = parsed?.summary;

  // Subtle tint marking the columns that are the actual Everee payload
  // (vs. CSV-source / HRX-match context columns).
  const evCol = { bgcolor: 'rgba(25, 118, 210, 0.06)' } as const;

  // 1099 entities (e.g. C1 Events LLC) pay independent contractors — Everee
  // does NOT take a workers-comp code/rate for them (WC is a W-2 concern), so
  // the WC column is shown as not-applicable rather than a payload field.
  const is1099Entity = entities.find((e) => e.id === entityId)?.workerType === '1099';

  // ── Carry a worker's resolved rate across their other same-event rows ──
  // A worker who's Ready on one day (assignment/site rate, or a typed rate)
  // for an event usually earns the same rate on their other days of that
  // event. Carry it so those "needs rate" rows resolve with zero typing.
  // Keyed by (userId | event) so a worker at two events keeps two rates.
  const carriedRateByRow = useMemo(() => {
    const out = new Map<number, number>();
    const rows = parsed?.rows ?? [];
    const knownByGroup = new Map<string, number>();
    const groupKey = (uid: string, site: string) => `${uid}|${(site || '').trim().toLowerCase()}`;
    // Pass 1: collect a known rate per (worker, event) — typed override wins,
    // else a resolved assignment/site rate.
    for (const r of rows) {
      if (r.status !== 'importable') continue;
      const m = matchByRow.get(r.rowIndex);
      if (!m || m.block || !m.userId) continue;
      const ov = overrides.get(r.rowIndex)?.payRate;
      const rate = ov != null ? ov : Number(m.payRate) > 0 ? Number(m.payRate) : null;
      if (rate != null && rate > 0) {
        const k = groupKey(m.userId, r.site);
        if (!knownByGroup.has(k)) knownByGroup.set(k, rate);
      }
    }
    // Pass 2: fill rows that lack their own rate from the group's known rate.
    for (const r of rows) {
      if (r.status !== 'importable') continue;
      const m = matchByRow.get(r.rowIndex);
      if (!m || m.block || !m.userId) continue;
      const ov = overrides.get(r.rowIndex)?.payRate;
      const hasOwn = ov != null || Number(m.payRate) > 0;
      if (hasOwn) continue;
      const carried = knownByGroup.get(groupKey(m.userId, r.site));
      if (carried != null) out.set(r.rowIndex, carried);
    }
    return out;
  }, [parsed, matchByRow, overrides]);

  // ── Inline editing ──
  // Effective value = manual override > resolved match > carried sibling rate.
  const effective = (match: MatchRowResult | undefined, rowIndex: number) => {
    const o = overrides.get(rowIndex) || {};
    const carried = carriedRateByRow.get(rowIndex);
    const resolved = Number(match?.payRate) > 0 ? (match!.payRate as number) : null;
    const payRateCarried = o.payRate == null && resolved == null && carried != null;
    const payRate = o.payRate != null ? o.payRate : resolved != null ? resolved : carried ?? null;
    const workersCompCode =
      o.workersCompCode != null ? o.workersCompCode : match?.workersCompCode ?? null;
    const workersCompRate =
      o.workersCompRate != null ? o.workersCompRate : match?.workersCompRate ?? null;
    return {
      payRate,
      workersCompCode,
      workersCompRate,
      needsPayRate: !(Number(payRate) > 0),
      payRateCarried,
      edited: o,
    };
  };

  const startEdit = (rowIndex: number, field: OverrideField, current: string | number | null) => {
    setEditing({ rowIndex, field });
    setEditValue(current == null ? '' : String(current));
  };
  const cancelEdit = () => setEditing(null);
  const commitEdit = () => {
    if (!editing) return;
    const { rowIndex, field } = editing;
    const raw = editValue.trim();
    const num = raw === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
    const validNum = num != null && Number.isFinite(num) && num >= 0 ? num : null;
    setOverrides((prev) => {
      const next = new Map(prev);
      const cur: RowOverride = { ...(next.get(rowIndex) || {}) };
      if (raw === '') {
        delete cur[field];
      } else if (field === 'workersCompCode') {
        cur.workersCompCode = raw;
      } else if (validNum != null) {
        cur[field] = validNum;
      }
      if (Object.keys(cur).length === 0) next.delete(rowIndex);
      else next.set(rowIndex, cur);
      return next;
    });
    setEditing(null);
    // Smart copy: a pay rate is usually the same for every worker at a given
    // event, so after typing one, offer to apply it to the rest of that Type.
    if (field === 'payRate' && validNum != null && parsed) {
      const site = parsed.rows.find((r) => r.rowIndex === rowIndex)?.site || '';
      if (site) {
        const rowIndexes = parsed.rows
          .filter((r) => r.status === 'importable' && r.site === site && r.rowIndex !== rowIndex)
          .map((r) => r.rowIndex);
        if (rowIndexes.length > 0) setBulkRatePrompt({ site, rate: validNum, rowIndexes });
      }
    }
  };

  const applyRateToSite = () => {
    if (!bulkRatePrompt) return;
    const { rate, rowIndexes } = bulkRatePrompt;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const ri of rowIndexes) {
        next.set(ri, { ...(next.get(ri) || {}), payRate: rate });
      }
      return next;
    });
    setBulkRatePrompt(null);
  };

  /** Render a value that becomes an inline TextField on click. */
  const editableCell = (
    rowIndex: number,
    field: OverrideField,
    current: string | number | null,
    display: React.ReactNode,
    opts?: { prefix?: string; width?: number; placeholder?: string; align?: 'left' | 'right' },
  ) => {
    const isEditing = editing?.rowIndex === rowIndex && editing.field === field;
    const isOverridden = overrides.get(rowIndex)?.[field] != null;
    if (isEditing) {
      return (
        <TextField
          size="small"
          autoFocus
          variant="standard"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              cancelEdit();
            }
          }}
          placeholder={opts?.placeholder}
          sx={{ width: opts?.width ?? 84 }}
          inputProps={{ style: { textAlign: opts?.align ?? 'left' } }}
          InputProps={
            opts?.prefix
              ? { startAdornment: <InputAdornment position="start">{opts.prefix}</InputAdornment> }
              : undefined
          }
        />
      );
    }
    return (
      <Tooltip title={isOverridden ? 'Edited — click to change' : 'Click to edit'}>
        <Box
          component="span"
          onClick={() => startEdit(rowIndex, field, current)}
          sx={{
            cursor: 'pointer',
            borderBottom: '1px dashed',
            borderColor: isOverridden ? 'primary.main' : 'divider',
            color: isOverridden ? 'primary.main' : 'inherit',
            display: 'inline-block',
          }}
        >
          {display}
        </Box>
      </Tooltip>
    );
  };

  // ── Submit to Everee (P4) ──
  // Deterministic Everee externalId for an import payable — must byte-match the
  // server's `buildPayableExternalId({assignmentId: 'import-{customer}-{uid}'})`
  // so a row can be looked up against its submitted/voided status doc.
  const rowExternalId = (userId: string, workDate: string) =>
    `${tenantId}::import-${customer}-${userId}::${workDate}::CONTRACTOR`;

  // A row already submitted to Everee (and not since voided).
  const submittedStatusFor = (userId?: string, workDate?: string) => {
    if (!userId || !workDate) return undefined;
    const st = submittedByExtId.get(rowExternalId(userId, workDate));
    return st && st.status === 'submitted' ? st : undefined;
  };

  // The Ready rows: matched + Everee-linked + a resolved/typed pay rate, and not
  // already submitted to Everee.
  const buildReadyRows = () =>
    (parsed?.rows ?? [])
      .filter((r) => r.status === 'importable')
      .map((r) => ({ r, match: matchByRow.get(r.rowIndex) }))
      .filter(({ r, match }) => {
        if (!match || match.block) return false;
        if (submittedStatusFor(match.userId, r.workDate)) return false;
        return !effective(match, r.rowIndex).needsPayRate && !!match.userId;
      })
      .map(({ r, match }) => ({
        userId: match!.userId as string,
        workDate: r.workDate,
        hours: r.hours,
        payRate: effective(match, r.rowIndex).payRate as number,
        workerName: match!.displayName || [r.firstName, r.lastName].filter(Boolean).join(' '),
      }));
  const readyCount = buildReadyRows().length;

  const submitCallable = () =>
    httpsCallable<
      {
        tenantId: string;
        hiringEntityId: string;
        customer: string;
        dryRun: boolean;
        rows: Array<{ userId: string; workDate: string; hours: number; payRate: number; workerName: string }>;
      },
      {
        dryRun: boolean;
        count?: number;
        totalAmount?: number;
        preview?: Array<{ workerName: string; workDate: string; hours: number; payRate: number; amount: number }>;
        submitted?: number;
        failed?: number;
        errors?: string[];
      }
    >(functions, 'submitImportTimesheetBatch', { timeout: 300000 });

  const previewSubmit = async () => {
    const rows = buildReadyRows();
    if (!entityId || rows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const res = await submitCallable()({ tenantId, hiringEntityId: entityId, customer, dryRun: true, rows });
      setSubmitPreview({
        count: res.data?.count ?? rows.length,
        totalAmount: res.data?.totalAmount ?? 0,
        preview: res.data?.preview ?? [],
      });
    } catch (err: any) {
      console.error('submitImportTimesheetBatch (dry-run) failed:', err);
      setSubmitError(err?.message || 'Failed to preview the submission.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmSubmit = async () => {
    const rows = buildReadyRows();
    if (!entityId || rows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitCallable()({ tenantId, hiringEntityId: entityId, customer, dryRun: false, rows });
      setSubmitPreview(null);
      setSubmitResult({
        submitted: res.data?.submitted ?? 0,
        failed: res.data?.failed ?? 0,
        totalAmount: res.data?.totalAmount ?? 0,
        errors: res.data?.errors ?? [],
      });
      // Refresh the per-row submitted state so the just-sent rows flip to
      // "Submitted ✓" and drop out of the Ready count.
      await loadSubmitted();
    } catch (err: any) {
      console.error('submitImportTimesheetBatch (live) failed:', err);
      setSubmitError(err?.message || 'Failed to submit to Everee.');
    } finally {
      setSubmitting(false);
    }
  };

  // Load the per-payable status docs for this customer so the grid can show
  // which rows are already in Everee (across sessions) and offer a Void.
  const loadSubmitted = async () => {
    if (!tenantId || !customer) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'tenants', tenantId, 'timesheet_import_payables'),
          where('customer', '==', customer),
        ),
      );
      const next = new Map<string, { status: string; amount: number }>();
      snap.forEach((d) => {
        const data = d.data() as { externalId?: string; status?: string; amount?: number };
        if (data.externalId) {
          next.set(data.externalId, {
            status: String(data.status || ''),
            amount: Number(data.amount || 0),
          });
        }
      });
      setSubmittedByExtId(next);
    } catch (err) {
      console.error('loadSubmitted failed:', err);
    }
  };

  const voidCallable = () =>
    httpsCallable<
      { tenantId: string; hiringEntityId: string; externalId: string },
      { ok: boolean; externalId: string }
    >(functions, 'voidImportTimesheetPayable', { timeout: 120000 });

  const voidRow = async (externalId: string) => {
    if (!entityId) return;
    setVoidingExtId(externalId);
    setSubmitError(null);
    try {
      await voidCallable()({ tenantId, hiringEntityId: entityId, externalId });
      await loadSubmitted();
    } catch (err: any) {
      console.error('voidImportTimesheetPayable failed:', err);
      setSubmitError(err?.message || 'Failed to void the payable in Everee.');
    } finally {
      setVoidingExtId(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2, maxWidth: 1400 }}>
      <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
        Upload a customer timesheet CSV to import a week of hours. Phase 0 parses and previews the
        rows; worker matching, missing-field fill-in, and submitting to Everee come next.
      </Alert>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }}>
        <FormControl sx={{ minWidth: 220 }} size="small">
          <InputLabel>Customer</InputLabel>
          <Select
            label="Customer"
            value={customer}
            onChange={(e) => {
              const next = e.target.value as CustomerKey;
              setCustomer(next);
              setParsed(null);
              setError(null);
              setFileName('');
              resetMatch();
              // Auto-select the customer's standing paying entity (e.g.
              // Connect Team / VenueSmart always pays via C1 Events LLC).
              const match = CUSTOMERS.find((c) => c.key === next)?.defaultEntityMatch;
              if (match) {
                const ent = entities.find((x) => x.name.toLowerCase().includes(match));
                if (ent) setEntityId(ent.id);
              }
            }}
          >
            {CUSTOMERS.map((c) => (
              <MenuItem key={c.key} value={c.key}>
                {c.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 240 }} size="small">
          <InputLabel>Paying entity</InputLabel>
          <Select
            label="Paying entity"
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              resetMatch();
            }}
          >
            {entities.map((ent) => (
              <MenuItem key={ent.id} value={ent.id}>
                {ent.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="contained"
          startIcon={<UploadFileIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={parsing}
          sx={{ textTransform: 'none' }}
        >
          {parsing
            ? 'Parsing…'
            : customer === 'connect_team'
              ? 'Upload Excel'
              : 'Upload CSV'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={
            customer === 'connect_team'
              ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : '.csv,text/csv'
          }
          hidden
          onChange={onPick}
        />
        {fileName && (
          <Typography variant="body2" color="text.secondary">
            {fileName}
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {s && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`Parsed: ${s.total}`} />
          <Chip color="success" label={`Importable: ${s.importable}`} />
          {s.excludedFuture > 0 && <Chip label={`Future: ${s.excludedFuture}`} />}
          {s.excludedAbsence > 0 && <Chip label={`Absence: ${s.excludedAbsence}`} />}
          {s.excludedNoEmail > 0 && <Chip color="warning" label={`No email: ${s.excludedNoEmail}`} />}
          {s.excludedOther > 0 && <Chip color="warning" label={`Other: ${s.excludedOther}`} />}
          {s.total - s.importable > 0 && (
            <FormControlLabel
              sx={{ ml: 1 }}
              control={
                <Switch
                  size="small"
                  checked={showExcluded}
                  onChange={(e) => setShowExcluded(e.target.checked)}
                />
              }
              label={`Show ${s.total - s.importable} excluded (future / absence)`}
            />
          )}
        </Stack>
      )}

      {parsed && (
        <>
        <Typography variant="caption" color="text.secondary">
          The <Box component="span" sx={{ px: 0.5, py: 0.1, borderRadius: 0.5, ...evCol }}>tinted</Box>{' '}
          columns are the exact fields submitted to Everee: worker ID, pay rate, WC code{' '}
          {is1099Entity
            ? '(n/a — 1099 contractors carry no workers’ comp)'
            : '(W-2 only; rate is internal — not sent)'}
          {is1099Entity
            ? ' — for 1099, worker + pay rate + hours are all Everee needs (no worksite).'
            : ', and the worksite address (sent as a flat work-location: street → line1, city, state, zip → postalCode).'}{' '}
          Pay rate and WC code/rate are{' '}
          <Box component="span" sx={{ borderBottom: '1px dashed', borderColor: 'primary.main', color: 'primary.main' }}>
            click-to-edit
          </Box>{' '}
          — typed values override the resolved ones for this import.
        </Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Confidence:</Typography>
          {(['exact', 'probable', 'guess', 'select', 'problem'] as Conf[]).map((lvl) => (
            <Box key={lvl} sx={{ display: 'inline-flex', alignItems: 'center' }}>
              <ConfDot level={lvl} />
              <Typography variant="caption" color="text.secondary">
                {lvl === 'exact'
                  ? 'Exact (assignment / match / typed)'
                  : lvl === 'probable'
                    ? 'Probable (site mapping / name match)'
                    : lvl === 'guess'
                      ? 'Guess (account default)'
                      : lvl === 'select'
                        ? 'Needs selection'
                        : 'Problem'}
              </Typography>
            </Box>
          ))}
        </Stack>
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '60vh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Worker</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Hours</TableCell>
                <TableCell sx={evCol}>Everee worker ID</TableCell>
                <TableCell align="right" sx={evCol}>Pay rate</TableCell>
                <TableCell sx={evCol}>WC code / rate</TableCell>
                <TableCell sx={evCol}>Worksite → Everee</TableCell>
                <TableCell>Source status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(showExcluded ? parsed.rows : parsed.rows.filter((r) => r.status === 'importable')).map((r) => {
                const match = r.status === 'importable' ? matchByRow.get(r.rowIndex) : undefined;
                const payable = match && !match.block;
                const addr = match?.worksiteAddress;
                const eff = effective(match, r.rowIndex);
                const submitted = submittedStatusFor(match?.userId, r.workDate);
                const extId = match?.userId ? rowExternalId(match.userId, r.workDate) : '';
                return (
                <TableRow key={r.rowIndex} hover sx={{ opacity: r.status === 'importable' ? 1 : 0.65 }}>
                  <TableCell>
                    {submitted ? (
                      <Stack spacing={0.25} alignItems="flex-start">
                        <Tooltip title={`Submitted to Everee as a $${submitted.amount.toFixed(2)} payable`}>
                          <Chip
                            size="small"
                            color="success"
                            variant="outlined"
                            icon={<CheckCircleIcon />}
                            label={`Submitted $${submitted.amount.toFixed(2)}`}
                          />
                        </Tooltip>
                        <Link
                          component="button"
                          type="button"
                          variant="caption"
                          underline="hover"
                          color="error"
                          disabled={voidingExtId === extId}
                          onClick={() => voidRow(extId)}
                        >
                          {voidingExtId === extId ? 'Voiding…' : 'Void'}
                        </Link>
                      </Stack>
                    ) : match ? (
                      <Tooltip
                        title={
                          match.block
                            ? match.blockReason ?? 'Blocked'
                            : eff.needsPayRate
                              ? 'Matched + Everee-linked, but no pay rate yet — map the site, or click the pay-rate cell to type one.'
                              : 'Matched + Everee-linked + pay rate resolved'
                        }
                      >
                        <Chip
                          size="small"
                          color={match.block ? 'warning' : eff.needsPayRate ? 'info' : 'success'}
                          icon={!match.block && !eff.needsPayRate ? <CheckCircleIcon /> : undefined}
                          label={match.block ? 'Blocked' : eff.needsPayRate ? 'Needs rate' : 'Ready'}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title={r.excludeReason ?? 'Ready to match + import'}>
                        <Chip size="small" color={statusChipColor(r.status)} label={STATUS_LABEL[r.status]} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {r.email || 'no email'}
                    </Typography>
                    {r.status !== 'importable' ? null : !match ? (
                      <Typography variant="caption" color="text.secondary">not matched yet</Typography>
                    ) : match.block ? (
                      <>
                        <Typography variant="caption" color="warning.main" display="block">
                          <ConfDot level={match.suggestions && match.suggestions.length > 0 ? 'select' : 'problem'} />
                          {match.blockReason}
                        </Typography>
                        {match.suggestions && match.suggestions.length > 0 && (
                          <Link
                            component="button"
                            type="button"
                            variant="caption"
                            underline="hover"
                            onClick={() =>
                              openResolveDialog(
                                { email: r.email, firstName: r.firstName, lastName: r.lastName },
                                match.suggestions!,
                              )
                            }
                            sx={{ display: 'block', mt: 0.25 }}
                          >
                            Resolve worker ({match.suggestions.length}) →
                          </Link>
                        )}
                      </>
                    ) : (
                      <Typography
                        variant="caption"
                        color={match.matchedByName ? 'success.dark' : 'success.main'}
                        display="block"
                        noWrap
                        title={match.matchedByName ? `${match.displayName} (matched by name)` : match.displayName ?? ''}
                      >
                        <ConfDot level={match.matchedByName ? 'probable' : 'exact'} /> ✓ {match.displayName}
                        {match.matchedByName ? ' (by name)' : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{r.workDate}</TableCell>
                  <TableCell align="right">{r.hours.toFixed(2)}</TableCell>

                  {/* ── Everee payload ── */}
                  <TableCell sx={{ ...evCol, maxWidth: 200 }}>
                    {!payable ? (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    ) : match!.evereeWorkerId ? (
                      <Tooltip title={match!.evereeWorkerId}>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace' }}
                          noWrap
                          display="block"
                        >
                          <ConfDot level="exact" /> {match!.evereeWorkerId}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="warning.main">
                        <ConfDot level="problem" /> not linked
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={evCol}>
                    {payable ? (
                      <>
                        {editableCell(
                          r.rowIndex,
                          'payRate',
                          eff.payRate,
                          eff.payRate != null ? (
                            <Tooltip
                              title={eff.payRateCarried ? "Carried from this worker's other shift at this event" : ''}
                            >
                              <Typography component="span" variant="body2">
                                <ConfDot
                                  level={
                                    overrides.get(r.rowIndex)?.payRate != null
                                      ? 'exact'
                                      : eff.payRateCarried
                                        ? 'probable'
                                        : sourceConf(match!.payRateSource)
                                  }
                                />
                                ${eff.payRate.toFixed(2)}
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography component="span" variant="caption" color="info.main">
                              <ConfDot level="select" /> + add rate
                            </Typography>
                          ),
                          { prefix: '$', align: 'right', placeholder: '0.00' },
                        )}
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={evCol}>
                    {!payable ? (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    ) : is1099Entity ? (
                      <Tooltip title="1099 contractor — workers’ comp isn’t sent to Everee">
                        <Typography variant="caption" color="text.disabled">n/a · 1099</Typography>
                      </Tooltip>
                    ) : (
                      <>
                        {editableCell(
                          r.rowIndex,
                          'workersCompCode',
                          eff.workersCompCode,
                          eff.workersCompCode ? (
                            <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                              <ConfDot
                                level={overrides.get(r.rowIndex)?.workersCompCode != null ? 'exact' : sourceConf(match!.workersCompSource)}
                              />
                              {eff.workersCompCode}
                            </Typography>
                          ) : (
                            <Typography component="span" variant="caption" color="text.secondary">
                              <ConfDot level="select" /> + WC code
                            </Typography>
                          ),
                          { width: 72, placeholder: 'code' },
                        )}
                        <Box sx={{ mt: 0.25 }}>
                          {editableCell(
                            r.rowIndex,
                            'workersCompRate',
                            eff.workersCompRate,
                            eff.workersCompRate != null ? (
                              <Typography component="span" variant="caption" color="text.secondary">
                                ${eff.workersCompRate.toFixed(2)} rate
                              </Typography>
                            ) : (
                              <Typography component="span" variant="caption" color="text.disabled">
                                + WC rate
                              </Typography>
                            ),
                            { prefix: '$', width: 76, placeholder: '0.00' },
                          )}
                        </Box>
                      </>
                    )}
                  </TableCell>
                  <TableCell sx={{ ...evCol, maxWidth: 280 }}>
                    {payable ? (
                      <>
                        <Typography variant="body2" noWrap title={match!.worksiteName ?? ''}>
                          {match!.worksiteName ? (
                            <>
                              <ConfDot level={match!.worksiteAddress ? sourceConf(match!.worksiteSource) : 'select'} />
                              {match!.worksiteName}
                            </>
                          ) : is1099Entity ? (
                            <Typography component="span" variant="caption" color="text.disabled">
                              n/a · 1099
                            </Typography>
                          ) : (
                            <Typography component="span" variant="caption" color="text.secondary">
                              no worksite
                            </Typography>
                          )}
                        </Typography>
                        {addr && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {[addr.street, [addr.city, addr.state].filter(Boolean).join(', '), addr.zip]
                              .filter(Boolean)
                              .join(' · ')}
                          </Typography>
                        )}
                        {!is1099Entity && eff.needsPayRate && r.site && (
                          <Link
                            component="button"
                            type="button"
                            variant="caption"
                            underline="hover"
                            onClick={() => openMapDialog(r.site)}
                            sx={{ display: 'block', mt: 0.25 }}
                          >
                            {match!.payRateSource === 'site_mapping' ? 'Re-map site →' : 'Map site → job order'}
                          </Link>
                        )}
                        <Typography variant="caption" color="text.disabled" display="block" noWrap title={r.site}>
                          CSV: {r.site || '—'}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary" noWrap title={r.site} display="block">
                        {r.site || '—'}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    {r.sourceStatus}
                    {r.billRate != null && (
                      <Typography variant="caption" color="text.disabled" display="block">
                        bill ${r.billRate.toFixed(2)}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      )}

      {s && s.importable > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              onClick={runMatch}
              disabled={!entityId || matching}
              sx={{ textTransform: 'none' }}
            >
              {matching
                ? matchProgress
                  ? `Matching ${Math.min(matchProgress.done + MATCH_BATCH_SIZE, matchProgress.total)}/${matchProgress.total}…`
                  : 'Matching…'
                : `Match ${s.importable} worker${s.importable === 1 ? '' : 's'} to HRX`}
            </Button>
            {!entityId && (
              <Typography variant="caption" color="text.secondary">
                Pick a paying entity first.
              </Typography>
            )}
            {matchByRow.size > 0 &&
              (() => {
                const rows = (parsed?.rows ?? [])
                  .filter((r) => r.status === 'importable')
                  .map((r) => ({ r, m: matchByRow.get(r.rowIndex) }))
                  .filter((x): x is { r: ParsedTimesheetRow; m: MatchRowResult } => !!x.m);
                const submittedCount = rows.filter(
                  ({ r, m }) => submittedStatusFor(m.userId, r.workDate),
                ).length;
                const live = rows.filter(({ r, m }) => !submittedStatusFor(m.userId, r.workDate));
                const ready = live.filter(
                  ({ m }) => !m.block && !effective(m, m.rowIndex).needsPayRate,
                ).length;
                const needsRate = live.filter(
                  ({ m }) => !m.block && effective(m, m.rowIndex).needsPayRate,
                ).length;
                const blocked = live.filter(({ m }) => m.block).length;
                return (
                  <>
                    <Chip size="small" color="success" label={`Ready: ${ready}`} />
                    {needsRate > 0 && (
                      <Chip size="small" color="info" label={`Needs pay rate: ${needsRate}`} />
                    )}
                    {blocked > 0 && (
                      <Chip size="small" color="warning" label={`Blocked: ${blocked}`} />
                    )}
                    {submittedCount > 0 && (
                      <Chip
                        size="small"
                        color="success"
                        variant="outlined"
                        label={`Submitted: ${submittedCount}`}
                      />
                    )}
                  </>
                );
              })()}
          </Stack>
          {readyCount > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                color="success"
                onClick={previewSubmit}
                disabled={submitting || matching}
                sx={{ textTransform: 'none' }}
              >
                {submitting ? 'Working…' : `Submit ${readyCount} Ready to Everee →`}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Previews the payload first — nothing is sent until you confirm.
              </Typography>
            </Stack>
          )}
          {submitResult && (
            <Alert
              severity={submitResult.failed > 0 || submitResult.errors.length ? 'warning' : 'success'}
              onClose={() => setSubmitResult(null)}
            >
              Submitted {submitResult.submitted} payable{submitResult.submitted === 1 ? '' : 's'} to
              Everee (${submitResult.totalAmount.toFixed(2)}).
              {submitResult.failed > 0 ? ` ${submitResult.failed} failed.` : ''}
              {submitResult.errors.length > 0 ? ` ${submitResult.errors.join('; ')}` : ''}
            </Alert>
          )}
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)}>
              {submitError}
            </Alert>
          )}
          {matchError && (
            <Alert severity="warning" onClose={() => setMatchError(null)}>
              {matchError}
            </Alert>
          )}
          {matchByRow.size > 0 && (
            <Typography variant="caption" color="text.secondary">
              Blocked rows need an HRX worker + Everee onboarding before they can be paid.
              “Needs rate” rows have no paired assignment — map their site to a job order or type a
              pay rate. Ready rows submit to Everee as contractor pay (hours × rate).
            </Typography>
          )}
        </Box>
      )}

      <Dialog
        open={submitPreview != null}
        onClose={() => (submitting ? null : setSubmitPreview(null))}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Submit to Everee — preview</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This is exactly what will be sent to Everee as contractor pay (1099). Nothing has been
              submitted yet — review, then confirm.
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip color="success" label={`${submitPreview?.count ?? 0} payable${(submitPreview?.count ?? 0) === 1 ? '' : 's'}`} />
              <Chip label={`Total $${(submitPreview?.totalAmount ?? 0).toFixed(2)}`} />
            </Stack>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Worker</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(submitPreview?.preview ?? []).map((p, idx) => (
                    <TableRow key={`${p.workerName}-${p.workDate}-${idx}`}>
                      <TableCell>{p.workerName || '—'}</TableCell>
                      <TableCell>{p.workDate}</TableCell>
                      <TableCell align="right">{p.hours.toFixed(2)}</TableCell>
                      <TableCell align="right">${p.payRate.toFixed(2)}</TableCell>
                      <TableCell align="right">${p.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {submitError && (
              <Alert severity="error" onClose={() => setSubmitError(null)}>
                {submitError}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmitPreview(null)} disabled={submitting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={confirmSubmit}
            disabled={submitting || !(submitPreview?.count ?? 0)}
            sx={{ textTransform: 'none' }}
          >
            {submitting ? 'Submitting…' : `Submit ${submitPreview?.count ?? 0} to Everee`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mapSite != null} onClose={() => (savingMapping ? null : setMapSite(null))} fullWidth maxWidth="sm">
        <DialogTitle>Map site to a job order</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Connect this customer site to an HRX job order. We’ll pull the pay rate, WC code, and
              worksite from the job order and remember this mapping for future imports.
            </Typography>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Customer site
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {mapSite}
              </Typography>
            </Box>
            <Autocomplete<JobOrderOption>
              options={jobOrders ?? []}
              loading={jobOrdersLoading}
              value={mapJobOrder}
              onChange={(_e, val) => setMapJobOrder(val)}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="HRX job order"
                  placeholder="Search job orders…"
                  size="small"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {jobOrdersLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
            {mapError && (
              <Alert severity="error" onClose={() => setMapError(null)}>
                {mapError}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapSite(null)} disabled={savingMapping} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={saveMapping}
            disabled={!mapJobOrder || savingMapping}
            sx={{ textTransform: 'none' }}
          >
            {savingMapping ? 'Saving…' : 'Save mapping & re-match'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={resolveRow != null}
        onClose={() => (savingAlias ? null : setResolveRow(null))}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Resolve worker</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This row didn’t resolve to a single HRX worker. Pick the right person — we’ll remember
              it ({resolveRow?.email ? 'by email' : 'by name'}) so future imports resolve automatically.
            </Typography>
            <Box>
              <Typography variant="caption" color="text.secondary">
                CSV worker
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {resolveRow?.name || '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {resolveRow?.email}
              </Typography>
            </Box>
            <FormControl fullWidth size="small" disabled={savingAlias}>
              <InputLabel>HRX worker</InputLabel>
              <Select
                label="HRX worker"
                value={resolvePick}
                onChange={(e) => setResolvePick(e.target.value)}
                renderValue={(val) => {
                  const sug = resolveSuggestions.find((x) => x.userId === val);
                  return sug ? sug.displayName || sug.email || sug.userId : '';
                }}
              >
                {resolveSuggestions.map((sug) => (
                  <MenuItem key={sug.userId} value={sug.userId}>
                    <Box>
                      <Typography variant="body2">
                        {sug.displayName || '(no name)'}
                        {sug.evereeLinked ? ' · Everee ✓' : ' · not linked'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {sug.email || 'no email'} — {sug.reason}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {resolveError && (
              <Alert severity="error" onClose={() => setResolveError(null)}>
                {resolveError}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveRow(null)} disabled={savingAlias} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={saveAlias}
            disabled={!resolvePick || savingAlias}
            sx={{ textTransform: 'none' }}
          >
            {savingAlias ? 'Saving…' : 'Use this match & re-match'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!bulkRatePrompt}
        autoHideDuration={12000}
        onClose={() => setBulkRatePrompt(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={
          bulkRatePrompt
            ? `Apply $${bulkRatePrompt.rate.toFixed(2)} to all ${bulkRatePrompt.rowIndexes.length} other “${bulkRatePrompt.site}” worker${bulkRatePrompt.rowIndexes.length === 1 ? '' : 's'}?`
            : ''
        }
        action={
          <>
            <Button color="primary" size="small" onClick={applyRateToSite} sx={{ textTransform: 'none' }}>
              Apply to all
            </Button>
            <Button color="inherit" size="small" onClick={() => setBulkRatePrompt(null)} sx={{ textTransform: 'none' }}>
              Dismiss
            </Button>
          </>
        }
      />
    </Box>
  );
};

export default CsvTimesheetImport;
