/**
 * CsvTimesheetImport — the "Import CSV" tab on /timesheets.
 *
 * Phase 0: upload a customer timesheet CSV (Indeed Flex hardcoded for
 * now), parse + classify the rows, and show a preview. No worker
 * matching, persistence, or Everee submission yet — those are later
 * phases. This is intentionally client-only so it's safe + fast to ship
 * as the foundation.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  IconButton,
  InputAdornment,
  InputLabel,
  Link,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Radio,
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
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

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
import { importCsvKey, importEntryDocId } from '../../utils/timesheets/importEntryKeys';

/** One worker-match result from the importTimesheetMatchWorkers callable. */
interface MatchRowResult {
  rowIndex: number;
  email: string;
  matched: boolean;
  ambiguous: boolean;
  userId: string | null;
  displayName: string | null;
  /** Matched HRX worker's contact info (not the CSV's). */
  matchedEmail: string | null;
  matchedPhone: string | null;
  evereeWorkerId: string | null;
  evereeLinked: boolean;
  matchedByName: boolean;
  /** Recruiter manually picked this worker via the lookup pencil. */
  matchedManual: boolean;
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
  phone: string | null;
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
  jobOrderNumber: string;
  title: string;        // recruiter-facing JO title (e.g. "Loader / Crew")
  jobTitle: string;     // role / O*NET title (e.g. "Warehouse Associate")
  type: string;         // 'gig' | 'career' | 'open' | ''
  accountName: string;
  worksiteId: string;
  worksiteName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  payRate: number | null;
  workersCompCode: string | null;
  workersCompRate: number | null;
  label: string;        // single line shown once selected
  searchText: string;   // lowercased haystack for filtering
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
    rowIndex: number;
    email: string;
    firstName: string;
    lastName: string;
    name: string;
  } | null>(null);
  const [resolveSuggestions, setResolveSuggestions] = useState<WorkerSuggestion[]>([]);
  const [resolvePick, setResolvePick] = useState<string>('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Free-text worker search inside the resolve/lookup dialog.
  const [resolveQuery, setResolveQuery] = useState('');
  const [resolveSearching, setResolveSearching] = useState(false);
  // Apply the pick to every row with the same CSV name (remembered alias) vs.
  // just this one row (a session-only forced override).
  const [resolveApplyAll, setResolveApplyAll] = useState(true);
  // Recruiter-forced worker per row (lookup pencil, "this row only"). Survives
  // re-match; flows into the match payload as forcedUserId. Cleared on reset.
  const [forcedUserIdByRow, setForcedUserIdByRow] = useState<Map<number, string>>(new Map());
  // Manually-picked worksite per row (worksite-lookup pencil). Wins over the
  // resolved worksite; flows into Save + the Everee work location (W-2).
  type WorksiteOverride = {
    worksiteId: string;
    worksiteName: string;
    worksiteAddress: { street: string; city: string; state: string; zip: string };
    accountName?: string;
  };
  const [worksiteOverrideByRow, setWorksiteOverrideByRow] = useState<Map<number, WorksiteOverride>>(
    new Map(),
  );
  // Sortable import-grid columns (Worker / Date / Worksite).
  const [gridSort, setGridSort] = useState<{ field: 'worker' | 'date' | 'worksite'; dir: 'asc' | 'desc' } | null>(
    null,
  );
  // Worksite-lookup dialog (pencil on the Worksite cell): pick an account,
  // then a worksite within it. Accounts are loaded once + cached.
  type WsAccount = {
    id: string;
    name: string;
    accountType: string;
    parentName?: string;
    companyIds: string[];
    linkedLocations: Array<{ companyId: string; locationId: string }>;
  };
  type WsWorksite = {
    worksiteId: string;
    companyId: string;
    worksiteName: string;
    address: { street: string; city: string; state: string; zip: string };
  };
  const [worksiteDialog, setWorksiteDialog] = useState<{ rowIndex: number; csvSite: string } | null>(null);
  const [wsAccounts, setWsAccounts] = useState<WsAccount[] | null>(null);
  const [wsAccountsLoading, setWsAccountsLoading] = useState(false);
  const [wsAccountPick, setWsAccountPick] = useState<WsAccount | null>(null);
  const [wsWorksites, setWsWorksites] = useState<WsWorksite[]>([]);
  const [wsWorksitesLoading, setWsWorksitesLoading] = useState(false);
  const [wsWorksitePick, setWsWorksitePick] = useState<WsWorksite | null>(null);
  const [wsApplyAllSite, setWsApplyAllSite] = useState(true);
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
    evereeClassifiesOt: boolean;
    preview: Array<{
      workerName: string;
      workDate: string;
      hours: number;
      payRate: number;
      amount: number;
      workersCompCode?: string | null;
      worksiteName?: string | null;
    }>;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<{ submitted: number; failed: number; totalAmount: number; errors: string[] } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Per-payable submitted status (persisted) keyed by externalId, so the grid
  // shows what's already been sent + lets the recruiter void it.
  const [submittedByExtId, setSubmittedByExtId] = useState<Map<string, { status: string; amount: number }>>(new Map());
  const [voidingExtId, setVoidingExtId] = useState<string | null>(null);
  // Manual "Save progress" — persists the current grid to timesheet_entries.
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ upserted: number } | null>(null);
  // Clear-stale (re-upload orphan cleanup): dry-run count → confirm → delete.
  const [clearing, setClearing] = useState(false);
  const [staleConfirm, setStaleConfirm] = useState<{
    count: number;
    keepDocIds: string[];
    minDate: string;
    maxDate: string;
  } | null>(null);
  // One-shot guard so resume-from-saved restores overrides/forced picks only
  // once per uploaded file (keyed by file name + entity + customer).
  const resumeKeyRef = useRef<string>('');
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
            const jo = d.data() as Record<string, any>;
            const title = String(jo.title || '').trim();
            const type = String(
              jo.type || jo.jobOrderType || (jo.shiftType === 'open' ? 'open' : ''),
            )
              .trim()
              .toLowerCase();
            const accountName = String(
              jo.recruiterAccountName || jo.accountName || jo.companyName || '',
            ).trim();
            const worksiteName = String(jo.worksiteName || jo.locationName || '').trim();
            const wa = (jo.worksiteAddress && typeof jo.worksiteAddress === 'object'
              ? jo.worksiteAddress
              : {}) as Record<string, any>;
            const street = String(wa.street || jo.street || '').trim();
            const city = String(wa.city || jo.worksiteCity || jo.city || '').trim();
            const state = String(wa.state || jo.worksiteState || '').trim();
            const zip = String(wa.zipCode || wa.zip || jo.zipCode || jo.zip || '').trim();
            const jobOrderNumber = String(jo.jobOrderNumber ?? '').trim();
            const worksiteId = String(jo.worksiteId || jo.locationId || '').trim();
            const num = (...xs: any[]) => {
              for (const x of xs) {
                const n = Number(x);
                if (Number.isFinite(n) && n > 0) return n;
              }
              return null;
            };
            const str = (...xs: any[]) => {
              for (const x of xs) if (typeof x === 'string' && x.trim()) return x.trim();
              return null;
            };
            // One option PER POSITION — a JO can carry several, each with its
            // own pay rate + WC. Mirrors the server resolveJobOrderFields chain
            // (position → JO-level → gigPosition[0]).
            const positions: Array<Record<string, any>> =
              (Array.isArray(jo.positions) && jo.positions.length
                ? jo.positions
                : Array.isArray(jo.gigPositions) && jo.gigPositions.length
                  ? jo.gigPositions
                  : [{}]) || [{}];
            const firstGig = Array.isArray(jo.gigPositions) && jo.gigPositions.length ? jo.gigPositions[0] : {};
            positions.forEach((pos) => {
              const jobTitle = str(pos.jobTitle, jo.jobTitle, firstGig.jobTitle) || '';
              const key = `${d.id}::${jobTitle.toLowerCase()}`;
              if (byId.has(key)) return;
              const payRate = num(pos.payRate, jo.payRate);
              const workersCompCode = str(
                pos.workersCompCode,
                pos.workersCompClassCode,
                jo.workersCompCode,
                jo.workersCompClassCode,
                firstGig.workersCompClassCode,
              );
              const workersCompRate = num(pos.workersCompRate, jo.workersCompRate, firstGig.workersCompRate);
              const primary = title || jobTitle || '(untitled job order)';
              byId.set(key, {
                id: d.id,
                jobOrderNumber,
                title,
                jobTitle,
                type,
                accountName,
                worksiteId,
                worksiteName,
                street,
                city,
                state,
                zip,
                payRate,
                workersCompCode,
                workersCompRate,
                label: `${jobOrderNumber ? `#${jobOrderNumber} ` : ''}${primary}${jobTitle && jobTitle !== title ? ` · ${jobTitle}` : ''}${accountName ? ` — ${accountName}` : ''}`,
                searchText: [jobOrderNumber, title, jobTitle, type, accountName, worksiteName, city, state, workersCompCode]
                  .filter(Boolean)
                  .join(' ')
                  .toLowerCase(),
              });
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
        { tenantId: string; customer: string; site: string; jobOrderId: string; positionJobTitle?: string },
        { ok: true; docId: string; accountName: string | null }
      >(functions, 'saveTimesheetSiteMapping');
      await fn({ tenantId, customer, site: mapSite, jobOrderId: mapJobOrder.id, positionJobTitle: mapJobOrder.jobTitle });
      // Apply the JO's pay rate / WC / worksite to every row with this CSV site
      // RIGHT NOW (client overrides) so the cells update immediately, regardless
      // of how the re-match resolves. The saved mapping handles future imports.
      const jo = mapJobOrder;
      const siteNorm = mapSite.trim().toLowerCase();
      const wsOv: WorksiteOverride | null = jo.worksiteId
        ? {
            worksiteId: jo.worksiteId,
            worksiteName: jo.worksiteName || jo.worksiteId,
            worksiteAddress: { street: jo.street, city: jo.city, state: jo.state, zip: jo.zip },
          }
        : null;
      setOverrides((prev) => {
        const next = new Map(prev);
        (parsed?.rows ?? []).forEach((r) => {
          if (r.status !== 'importable' || (r.site || '').trim().toLowerCase() !== siteNorm) return;
          const ov = { ...(next.get(r.rowIndex) || {}) };
          if (jo.payRate != null) ov.payRate = jo.payRate;
          if (jo.workersCompCode) ov.workersCompCode = jo.workersCompCode;
          if (jo.workersCompRate != null) ov.workersCompRate = jo.workersCompRate;
          next.set(r.rowIndex, ov);
        });
        return next;
      });
      if (wsOv) {
        setWorksiteOverrideByRow((prev) => {
          const next = new Map(prev);
          (parsed?.rows ?? []).forEach((r) => {
            if (r.status === 'importable' && (r.site || '').trim().toLowerCase() === siteNorm) {
              next.set(r.rowIndex, wsOv);
            }
          });
          return next;
        });
      }
      setMapSite(null);
      setMapJobOrder(null);
      // Re-run the match so the mapping persists into resolution for other rows
      // / future imports; the overrides above win in the meantime.
      await runMatch();
    } catch (err: any) {
      console.error('saveTimesheetSiteMapping failed:', err);
      setMapError(err?.message || 'Failed to save the site mapping.');
    } finally {
      setSavingMapping(false);
    }
  };

  const openResolveDialog = (
    rowIndex: number,
    row: { email: string; firstName: string; lastName: string },
    suggestions: WorkerSuggestion[],
  ) => {
    setResolveRow({
      rowIndex,
      ...row,
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
    });
    setResolveSuggestions(suggestions);
    setResolvePick(suggestions[0]?.userId ?? '');
    setResolveQuery('');
    // Default to "all rows named X" for no-email customers (name is the key);
    // for email customers default to this row only.
    setResolveApplyAll(!row.email);
    setResolveError(null);
  };

  // Free-text HRX worker lookup inside the dialog — merges hits into the
  // candidate list (deduped), so a wrong/missing auto-match can be corrected.
  const runWorkerSearch = async () => {
    const q = resolveQuery.trim();
    if (q.length < 2) return;
    setResolveSearching(true);
    setResolveError(null);
    try {
      const fn = httpsCallable<
        { tenantId: string; query: string },
        { candidates: Array<{ userId: string; displayName: string | null; email: string | null; phone: string | null; inTenant: boolean }> }
      >(functions, 'searchTimesheetWorkers', { timeout: 30000 });
      const res = await fn({ tenantId, query: q });
      const hits: WorkerSuggestion[] = (res.data?.candidates ?? []).map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        evereeLinked: false, // resolved on re-match
        reason: c.inTenant ? 'search' : 'search · other tenant',
      }));
      setResolveSuggestions((prev) => {
        const byId = new Map(prev.map((s) => [s.userId, s]));
        hits.forEach((h) => byId.set(h.userId, h));
        return [...byId.values()];
      });
      if (hits.length && !resolvePick) setResolvePick(hits[0].userId);
      if (!hits.length) setResolveError(`No HRX worker matched “${q}”.`);
    } catch (err: any) {
      console.error('searchTimesheetWorkers failed:', err);
      setResolveError(err?.message || 'Worker search failed.');
    } finally {
      setResolveSearching(false);
    }
  };

  const applyResolvedWorker = async () => {
    if (!resolveRow || !resolvePick) return;
    setSavingAlias(true);
    setResolveError(null);
    try {
      const next = new Map(forcedUserIdByRow);
      if (resolveApplyAll) {
        // Remember the pick for every row with this CSV name (persists across
        // imports). Email customers key on email; no-email on name+customer.
        const fn = httpsCallable<
          { tenantId: string; userId: string; email?: string; customer?: string; firstName?: string; lastName?: string },
          { ok: true; docId: string; displayName: string | null }
        >(functions, 'saveTimesheetWorkerAlias');
        await fn(
          resolveRow.email
            ? { tenantId, userId: resolvePick, email: resolveRow.email }
            : { tenantId, userId: resolvePick, customer, firstName: resolveRow.firstName, lastName: resolveRow.lastName },
        );
        // Also force this session's same-name rows immediately (the alias takes
        // over on the next clean match; forcing avoids a stale flash).
        const name = resolveRow.name.trim().toLowerCase();
        (parsed?.rows ?? []).forEach((r) => {
          if (r.status !== 'importable') return;
          const rn = [r.firstName, r.lastName].filter(Boolean).join(' ').trim().toLowerCase();
          if (rn && rn === name) next.set(r.rowIndex, resolvePick);
        });
      } else {
        // This row only — a session-scoped forced override (not remembered).
        next.set(resolveRow.rowIndex, resolvePick);
      }
      setForcedUserIdByRow(next);
      setResolveRow(null);
      setResolveSuggestions([]);
      setResolvePick('');
      setResolveQuery('');
      // Pass the fresh map — state isn't visible to runMatch's closure yet.
      await runMatch(next);
    } catch (err: any) {
      console.error('applyResolvedWorker failed:', err);
      setResolveError(err?.message || 'Failed to apply the worker match.');
    } finally {
      setSavingAlias(false);
    }
  };

  /** Match in batches: bounded per-call work (fits the deadline at any file
   *  size), live progress as each batch lands, and a failed batch costs only
   *  itself — the rest still resolve. */
  const MATCH_BATCH_SIZE = 400;
  // `forcedOverride` lets a caller (the worker-lookup pencil) pass the
  // just-updated forced-worker map synchronously, since React state from a
  // setState in the same tick isn't visible to this closure yet.
  const runMatch = async (forcedOverride?: Map<number, string>) => {
    if (!entityId || importableRows.length === 0) return;
    const forced = forcedOverride ?? forcedUserIdByRow;
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
          forcedUserId?: string;
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
      ...(forced.get(r.rowIndex) ? { forcedUserId: forced.get(r.rowIndex) } : {}),
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
    setForcedUserIdByRow(new Map());
    setWorksiteOverrideByRow(new Map());
  };

  const handleFile = (file: File) => {
    setError(null);
    setParsed(null);
    resetMatch();
    setFileName(file.name);
    setParsing(true);

    // The file CONTAINER (Excel vs CSV) is detected from the file itself, so a
    // recruiter can upload either format regardless of customer — some export
    // Connect Team as .csv, or Indeed Flex saved as .xlsx. The selected
    // customer only decides which COLUMN MAPPING to apply.
    const isExcel =
      /\.xls[xm]?$/i.test(file.name) ||
      file.type.includes('spreadsheetml') ||
      file.type === 'application/vnd.ms-excel';

    // Map the raw rows through the selected customer's column mapping +
    // shape check, then publish. Always clears `parsing`.
    const finish = (rawRows: Array<Record<string, unknown>>) => {
      try {
        if (!rawRows.length) {
          setError('That file has no data rows.');
          return;
        }
        if (customer === 'connect_team') {
          if (!looksLikeConnectTeam(rawRows)) {
            setError(
              "This doesn't look like a Connect Team export — it's missing expected columns (First name, Last name, Start Date, Daily total hours, Type). Check the file or customer selection.",
            );
            return;
          }
          setParsed(mapConnectTeamRows(rawRows));
        } else {
          if (!looksLikeIndeedFlex(rawRows)) {
            setError(
              "This doesn't look like an Indeed Flex export — it's missing expected columns (Email, Date, Hours, Timesheet Status). Check the file or customer selection.",
            );
            return;
          }
          setParsed(mapIndeedFlexRows(rawRows));
        }
      } finally {
        setParsing(false);
      }
    };

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          // Connect Team's data lives on an "All Employees" sheet; otherwise
          // take the first sheet.
          const sheetName =
            wb.SheetNames.find((n) => n.trim().toLowerCase() === 'all employees') ||
            wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json(ws, {
            raw: false,
            defval: '',
          }) as Array<Record<string, unknown>>;
          finish(rawRows);
        } catch (err: any) {
          setError(`Failed to parse the Excel file: ${err?.message || err}`);
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
      complete: (results) => finish((results.data as Array<Record<string, unknown>>) || []),
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

  // Effective worksite = manual worksite-lookup override > resolved match.
  const effectiveWorksite = (match: MatchRowResult | undefined, rowIndex: number) => {
    const ov = worksiteOverrideByRow.get(rowIndex);
    if (ov) {
      return {
        worksiteId: ov.worksiteId,
        worksiteName: ov.worksiteName,
        worksiteAddress: ov.worksiteAddress,
        source: 'override' as const,
      };
    }
    return {
      worksiteId: match?.worksiteId ?? null,
      worksiteName: match?.worksiteName ?? null,
      worksiteAddress: match?.worksiteAddress ?? null,
      source: 'match' as const,
    };
  };

  // ── Worksite lookup (pick an HRX account → worksite, client-side) ──
  const openWorksiteDialog = (rowIndex: number, csvSite: string) => {
    setWorksiteDialog({ rowIndex, csvSite });
    setWsAccountPick(null);
    setWsWorksites([]);
    setWsWorksitePick(null);
    setWsApplyAllSite(true);
    if (!wsAccounts && !wsAccountsLoading) void loadWsAccounts();
  };

  const loadWsAccounts = async () => {
    if (!tenantId) return;
    setWsAccountsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, 'accounts'));
      const raw = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      const byId = new Map(raw.map((r) => [r.id, r.data]));
      const list: WsAccount[] = raw
        .filter(({ data }) => data.active !== false)
        .map(({ id, data }) => {
          const assoc = data.associations || {};
          let companyIds: string[] = Array.isArray(assoc.companyIds)
            ? assoc.companyIds.filter((x: any) => typeof x === 'string' && x.trim())
            : [];
          // Child accounts with no companyIds inherit the parent's.
          if (companyIds.length === 0 && data.parentAccountId) {
            const pa = byId.get(data.parentAccountId)?.associations;
            if (Array.isArray(pa?.companyIds)) {
              companyIds = pa.companyIds.filter((x: any) => typeof x === 'string' && x.trim());
            }
          }
          const linkedLocations = Array.isArray(assoc.locations)
            ? assoc.locations
                .filter((x: any) => x && typeof x.companyId === 'string' && typeof x.locationId === 'string')
                .map((x: any) => ({ companyId: String(x.companyId), locationId: String(x.locationId) }))
            : [];
          const parentName = data.parentAccountId
            ? String(byId.get(data.parentAccountId)?.name || '').trim() || undefined
            : undefined;
          return {
            id,
            name: String(data.name || data.accountName || id),
            accountType: String(data.accountType || 'standalone'),
            parentName,
            companyIds,
            linkedLocations,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setWsAccounts(list);
    } catch (err) {
      console.error('loadWsAccounts failed:', err);
      setWsAccounts([]);
    } finally {
      setWsAccountsLoading(false);
    }
  };

  const toWsWorksite = (id: string, companyId: string, d: any): WsWorksite => {
    const a = d.address || {};
    return {
      worksiteId: id,
      companyId,
      worksiteName: String(d.nickname || d.name || 'Location'),
      address: {
        street: String(a.street || d.street || ''),
        city: String(a.city || d.city || ''),
        state: String(a.state || d.state || ''),
        zip: String(a.zipCode || a.zip || d.zipCode || d.zip || ''),
      },
    };
  };

  const loadWsWorksites = async (acc: WsAccount) => {
    if (!tenantId) return;
    setWsWorksitesLoading(true);
    setWsWorksites([]);
    setWsWorksitePick(null);
    try {
      const out: WsWorksite[] = [];
      if (acc.linkedLocations.length > 0) {
        // Child account → its specifically linked worksite(s).
        await Promise.all(
          acc.linkedLocations.map(async ({ companyId, locationId }) => {
            const s = await getDoc(
              doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId),
            );
            if (s.exists()) out.push(toWsWorksite(s.id, companyId, s.data()));
          }),
        );
      } else {
        // Standalone / national → all locations under each linked company.
        await Promise.all(
          acc.companyIds.map(async (companyId) => {
            const snap = await getDocs(
              collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations'),
            );
            snap.forEach((d) => out.push(toWsWorksite(d.id, companyId, d.data())));
          }),
        );
      }
      out.sort((a, b) => a.worksiteName.localeCompare(b.worksiteName));
      setWsWorksites(out);
      if (out.length === 1) setWsWorksitePick(out[0]);
    } catch (err) {
      console.error('loadWsWorksites failed:', err);
    } finally {
      setWsWorksitesLoading(false);
    }
  };

  const applyWorksite = () => {
    if (!worksiteDialog || !wsWorksitePick) return;
    const ov: WorksiteOverride = {
      worksiteId: wsWorksitePick.worksiteId,
      worksiteName: wsWorksitePick.worksiteName,
      worksiteAddress: wsWorksitePick.address,
      accountName: wsAccountPick?.name,
    };
    const site = worksiteDialog.csvSite.trim().toLowerCase();
    setWorksiteOverrideByRow((prev) => {
      const next = new Map(prev);
      next.set(worksiteDialog.rowIndex, ov);
      if (wsApplyAllSite && site) {
        (parsed?.rows ?? []).forEach((r) => {
          if (r.status === 'importable' && (r.site || '').trim().toLowerCase() === site) {
            next.set(r.rowIndex, ov);
          }
        });
      }
      return next;
    });
    setWorksiteDialog(null);
  };

  // ── Sortable grid columns (Worker / Date / Worksite) ──
  const toggleSort = (field: 'worker' | 'date' | 'worksite') => {
    setGridSort((prev) =>
      prev?.field === field
        ? prev.dir === 'asc'
          ? { field, dir: 'desc' }
          : null // asc → desc → off
        : { field, dir: 'asc' },
    );
  };
  const sortImportRows = (rows: ParsedTimesheetRow[]): ParsedTimesheetRow[] => {
    if (!gridSort) return rows;
    const dir = gridSort.dir === 'asc' ? 1 : -1;
    const keyOf = (r: ParsedTimesheetRow): string => {
      const m = matchByRow.get(r.rowIndex);
      if (gridSort.field === 'date') return r.workDate || '';
      if (gridSort.field === 'worksite') {
        const ews = effectiveWorksite(m, r.rowIndex);
        return (ews.worksiteName || r.site || '').toLowerCase();
      }
      return (m?.displayName || [r.firstName, r.lastName].filter(Boolean).join(' ') || '').toLowerCase();
    };
    return [...rows].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      return ka < kb ? -dir : ka > kb ? dir : 0;
    });
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
  // Deterministic Everee externalId for an import submission — must byte-match
  // the server's `importExternalId`. 1099 rows become payables (CONTRACTOR),
  // W-2 rows become worked shifts (WORKED_SHIFT); the suffix tracks the entity
  // type so a row can be looked up against its submitted/voided status doc.
  const rowExternalId = (userId: string, workDate: string) =>
    `${tenantId}::import-${customer}-${userId}::${workDate}::${is1099Entity ? 'CONTRACTOR' : 'WORKED_SHIFT'}`;

  // W-2 worked shifts require a WC class code (comp-insurance classification);
  // a W-2 row without one isn't submittable. 1099 never needs WC.
  const rowNeedsWc = (eff: ReturnType<typeof effective>) =>
    !is1099Entity && !String(eff.workersCompCode || '').trim();

  // A row that's live in Everee (submitted or paid) — terminal, not
  // re-submittable. `paid` rows can't be voided (the pay run finalized).
  const submittedStatusFor = (userId?: string, workDate?: string) => {
    if (!userId || !workDate) return undefined;
    const st = submittedByExtId.get(rowExternalId(userId, workDate));
    return st && (st.status === 'submitted' || st.status === 'paid') ? st : undefined;
  };

  // The Ready rows: matched + Everee-linked + a resolved/typed pay rate (and a
  // WC code for W-2), and not already submitted to Everee.
  const buildReadyRows = () =>
    (parsed?.rows ?? [])
      .filter((r) => r.status === 'importable')
      .map((r) => ({ r, match: matchByRow.get(r.rowIndex) }))
      .filter(({ r, match }) => {
        if (!match || match.block || !match.userId) return false;
        if (submittedStatusFor(match.userId, r.workDate)) return false;
        const eff = effective(match, r.rowIndex);
        return !eff.needsPayRate && !rowNeedsWc(eff);
      })
      .map(({ r, match }) => {
        const eff = effective(match, r.rowIndex);
        const ews = effectiveWorksite(match, r.rowIndex);
        return {
          userId: match!.userId as string,
          workDate: r.workDate,
          hours: r.hours,
          payRate: eff.payRate as number,
          workerName: match!.displayName || [r.firstName, r.lastName].filter(Boolean).join(' '),
          // The event/site this day belongs to — used for the per-day pay-stub
          // line label (both worker types).
          eventLabel: r.site || ews.worksiteName || null,
          // W-2 only — omitted/ignored server-side for 1099.
          workersCompCode: is1099Entity ? null : eff.workersCompCode ?? null,
          worksiteId: ews.worksiteId,
          worksiteName: ews.worksiteName,
          worksiteAddress: ews.worksiteAddress,
        };
      });
  const readyCount = buildReadyRows().length;

  const submitCallable = () =>
    httpsCallable<
      {
        tenantId: string;
        hiringEntityId: string;
        customer: string;
        dryRun: boolean;
        rows: Array<{
          userId: string;
          workDate: string;
          hours: number;
          payRate: number;
          workerName: string;
          eventLabel?: string | null;
          workersCompCode?: string | null;
          worksiteId?: string | null;
          worksiteName?: string | null;
          worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
        }>;
      },
      {
        dryRun: boolean;
        workerType?: string;
        evereeClassifiesOt?: boolean;
        count?: number;
        skippedNoWc?: number;
        totalAmount?: number;
        preview?: Array<{
          workerName: string;
          workDate: string;
          hours: number;
          payRate: number;
          amount: number;
          workersCompCode?: string | null;
          worksiteName?: string | null;
        }>;
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
        evereeClassifiesOt: !!res.data?.evereeClassifiesOt,
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
      // HRX is the system of record. Persist the ENTIRE grid (matched,
      // needs-rate, needs-wc, blocked — not just the Ready rows we're about
      // to send) to `timesheet_entries` FIRST, so the import is saved to HRX
      // before anything reaches Everee. This makes "Save progress" optional:
      // submitting can no longer leave HRX empty or silently drop blocked
      // rows. If the persist fails, abort before calling Everee.
      try {
        await persistImportRows(entityId);
      } catch (saveErr: any) {
        console.error('Pre-submit persist to HRX failed:', saveErr);
        setSubmitError(
          `Could not save the import to HRX before submitting (${saveErr?.message || 'unknown error'}). ` +
            'Nothing was sent to Everee — please retry.',
        );
        setSubmitting(false);
        return;
      }
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
      {
        tenantId: string;
        hiringEntityId: string;
        externalId: string;
        userId?: string;
        workDate?: string;
        customer?: string;
      },
      { ok: boolean; externalId: string }
    >(functions, 'voidImportTimesheetPayable', { timeout: 120000 });

  const voidRow = async (externalId: string, userId?: string | null, workDate?: string) => {
    if (!entityId) return;
    setVoidingExtId(externalId);
    setSubmitError(null);
    try {
      await voidCallable()({
        tenantId,
        hiringEntityId: entityId,
        externalId,
        userId: userId || undefined,
        workDate: workDate || undefined,
        customer,
      });
      await loadSubmitted();
    } catch (err: any) {
      console.error('voidImportTimesheetPayable failed:', err);
      setSubmitError(err?.message || 'Failed to void the payable in Everee.');
    } finally {
      setVoidingExtId(null);
    }
  };

  // ── Save progress (persist the whole grid to timesheet_entries) ──
  type ImportMatchStatus = 'ready' | 'needs_rate' | 'needs_wc' | 'blocked' | 'submitted' | 'voided';
  const matchStatusFor = (
    m: MatchRowResult,
    eff: ReturnType<typeof effective>,
    submitted: boolean,
  ): ImportMatchStatus => {
    if (submitted) return 'submitted';
    if (m.block) return 'blocked';
    if (eff.needsPayRate) return 'needs_rate';
    if (rowNeedsWc(eff)) return 'needs_wc';
    return 'ready';
  };

  /** Every matched-or-attempted importable row → a SaveImportRow snapshot. */
  const buildSaveRows = () =>
    (parsed?.rows ?? [])
      .filter((r) => r.status === 'importable')
      .map((r) => ({ r, m: matchByRow.get(r.rowIndex) }))
      .filter((x): x is { r: ParsedTimesheetRow; m: MatchRowResult } => !!x.m)
      .map(({ r, m }) => {
        const eff = effective(m, r.rowIndex);
        const ews = effectiveWorksite(m, r.rowIndex);
        const submitted = !!submittedStatusFor(m.userId, r.workDate);
        const typedRate = overrides.get(r.rowIndex)?.payRate != null;
        const worksiteOverridden = worksiteOverrideByRow.has(r.rowIndex);
        const typedWc = overrides.get(r.rowIndex)?.workersCompCode != null;
        return {
          rowIndex: r.rowIndex,
          workDate: r.workDate,
          hours: r.hours,
          userId: m.userId || '',
          csvKey: importCsvKey({ firstName: r.firstName, lastName: r.lastName, email: r.email }),
          csvWorkerName: m.displayName || [r.firstName, r.lastName].filter(Boolean).join(' '),
          csvEmail: m.matchedEmail || r.email || '',
          csvSite: r.site || '',
          csvRole: r.role || '',
          matchStatus: matchStatusFor(m, eff, submitted),
          blockReason: m.blockReason ?? null,
          ambiguous: !!m.ambiguous,
          evereeWorkerId: m.evereeWorkerId,
          evereeLinked: m.evereeLinked,
          matchedByName: m.matchedByName,
          matchedManual: m.matchedManual,
          forcedUserId: forcedUserIdByRow.get(r.rowIndex) || null,
          assignmentId: m.assignmentId,
          jobOrderId: m.jobOrderId,
          shiftId: m.shiftId,
          worksiteId: ews.worksiteId,
          worksiteName: ews.worksiteName,
          worksiteAddress: ews.worksiteAddress,
          workState: ews.worksiteAddress?.state ?? null,
          payRate: eff.payRate,
          workersCompCode: is1099Entity ? null : eff.workersCompCode,
          workersCompRate: is1099Entity ? null : eff.workersCompRate,
          billRate: r.billRate ?? null,
          payRateSource: typedRate ? 'typed' : eff.payRateCarried ? 'carried' : m.payRateSource,
          workersCompSource: typedWc ? 'typed' : m.workersCompSource,
          worksiteSource: worksiteOverridden ? 'manual' : m.worksiteSource,
        };
      });

  /**
   * Persist the WHOLE import grid to HRX `timesheet_entries` — every
   * importable row (ready, needs-rate, needs-wc, blocked, already-submitted).
   * This is the single write path for "save to HRX" and is shared by the
   * manual "Save progress" button AND the submit flow, so HRX always holds the
   * records before anything is sent to Everee. Returns the upserted count.
   */
  const persistImportRows = async (eid: string): Promise<number> => {
    const rows = buildSaveRows();
    if (rows.length === 0) return 0;
    const fn = httpsCallable<
      { tenantId: string; hiringEntityId: string; customer: string; rows: typeof rows },
      { ok: boolean; upserted: number; byStatus: Record<string, number> }
    >(functions, 'saveImportTimesheetRows', { timeout: 300000 });
    const res = await fn({ tenantId, hiringEntityId: eid, customer, rows });
    return res.data?.upserted ?? rows.length;
  };

  const saveProgress = async () => {
    if (!entityId) return;
    setSaving(true);
    setSaveResult(null);
    setMatchError(null);
    try {
      const upserted = await persistImportRows(entityId);
      if (upserted > 0) setSaveResult({ upserted });
    } catch (err: any) {
      console.error('saveImportTimesheetRows failed:', err);
      setMatchError(err?.message || 'Failed to save progress.');
    } finally {
      setSaving(false);
    }
  };

  // ── Clear stale rows (re-upload orphans) ──
  const staleCallable = () =>
    httpsCallable<
      {
        tenantId: string;
        hiringEntityId: string;
        customer: string;
        keepDocIds: string[];
        minDate: string;
        maxDate: string;
        dryRun: boolean;
      },
      { dryRun: boolean; staleCount?: number; deleted?: number; liveKept?: number }
    >(functions, 'deleteStaleImportEntries', { timeout: 120000 });

  /** Doc ids for every row currently in the grid — the set to KEEP. */
  const currentKeepDocIds = () => {
    const ids: string[] = [];
    let minDate = '';
    let maxDate = '';
    for (const r of parsed?.rows ?? []) {
      if (r.status !== 'importable') continue;
      const m = matchByRow.get(r.rowIndex);
      const csvKey = importCsvKey({ firstName: r.firstName, lastName: r.lastName, email: r.email });
      ids.push(importEntryDocId({ customer, userId: m?.userId || '', csvKey, workDate: r.workDate }));
      if (r.workDate) {
        if (!minDate || r.workDate < minDate) minDate = r.workDate;
        if (!maxDate || r.workDate > maxDate) maxDate = r.workDate;
      }
    }
    return { ids, minDate, maxDate };
  };

  const clearStale = async () => {
    if (!entityId) return;
    const { ids, minDate, maxDate } = currentKeepDocIds();
    if (!minDate || !maxDate) return;
    setClearing(true);
    setMatchError(null);
    try {
      const res = await staleCallable()({
        tenantId,
        hiringEntityId: entityId,
        customer,
        keepDocIds: ids,
        minDate,
        maxDate,
        dryRun: true,
      });
      const count = res.data?.staleCount ?? 0;
      if (count === 0) {
        setSaveResult(null);
        setMatchError('No stale rows to clear — every saved row is in this file (or already paid).');
      } else {
        setStaleConfirm({ count, keepDocIds: ids, minDate, maxDate });
      }
    } catch (err: any) {
      console.error('deleteStaleImportEntries (dry-run) failed:', err);
      setMatchError(err?.message || 'Failed to check for stale rows.');
    } finally {
      setClearing(false);
    }
  };

  const confirmClearStale = async () => {
    if (!entityId || !staleConfirm) return;
    setClearing(true);
    try {
      const res = await staleCallable()({
        tenantId,
        hiringEntityId: entityId,
        customer,
        keepDocIds: staleConfirm.keepDocIds,
        minDate: staleConfirm.minDate,
        maxDate: staleConfirm.maxDate,
        dryRun: false,
      });
      setStaleConfirm(null);
      setSaveResult(null);
      setMatchError(
        `Removed ${res.data?.deleted ?? 0} stale row${(res.data?.deleted ?? 0) === 1 ? '' : 's'} from timesheets.`,
      );
    } catch (err: any) {
      console.error('deleteStaleImportEntries failed:', err);
      setMatchError(err?.message || 'Failed to clear stale rows.');
    } finally {
      setClearing(false);
    }
  };

  // Resume: restore typed rate/WC overrides + forced worker picks from
  // previously-saved import entries, keyed by csvKey|workDate. Runs once per
  // uploaded file (before Match), so a re-upload + Match picks up where the
  // recruiter left off. Blocked/submitted state reproduces from the match +
  // the payables ledger, so we only restore the recruiter's manual edits here.
  const loadImportEntries = async (rows: ParsedTimesheetRow[]) => {
    if (!tenantId || !entityId || !customer) return;
    const importable = rows.filter((r) => r.status === 'importable');
    if (importable.length === 0) return;
    const dates = importable.map((r) => r.workDate).filter(Boolean).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    try {
      const snap = await getDocs(
        query(
          collection(db, 'tenants', tenantId, 'timesheet_entries'),
          where('source', '==', 'csv_import'),
          where('hiringEntityId', '==', entityId),
          where('workDate', '>=', minDate),
          where('workDate', '<=', maxDate),
        ),
      );
      const byKey = new Map<
        string,
        {
          payRate?: number;
          workersCompCode?: string;
          forcedUserId?: string | null;
          payRateSource?: string;
          workersCompSource?: string;
          worksiteSource?: string;
          worksiteId?: string;
          worksiteName?: string;
          worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
        }
      >();
      snap.forEach((d) => {
        const data = d.data() as any;
        const imp = (data.import || {}) as any;
        if (imp.customer !== customer) return;
        byKey.set(`${imp.csvKey || ''}|${data.workDate || ''}`, {
          payRate: typeof data.payRate === 'number' ? data.payRate : undefined,
          workersCompCode: typeof data.workersCompCode === 'string' ? data.workersCompCode : undefined,
          forcedUserId: imp.forcedUserId ?? null,
          payRateSource: imp.payRateSource,
          workersCompSource: imp.workersCompSource,
          worksiteSource: imp.worksiteSource,
          worksiteId: typeof imp.worksiteId === 'string' ? imp.worksiteId : undefined,
          worksiteName: typeof imp.worksiteName === 'string' ? imp.worksiteName : undefined,
          worksiteAddress: imp.worksiteAddress ?? null,
        });
      });
      if (byKey.size === 0) return;
      const nextOverrides = new Map(overrides);
      const nextForced = new Map(forcedUserIdByRow);
      const nextWorksites = new Map(worksiteOverrideByRow);
      let restored = 0;
      for (const r of importable) {
        const ck = importCsvKey({ firstName: r.firstName, lastName: r.lastName, email: r.email });
        const p = byKey.get(`${ck}|${r.workDate}`);
        if (!p) continue;
        if (p.forcedUserId && nextForced.get(r.rowIndex) !== p.forcedUserId) {
          nextForced.set(r.rowIndex, p.forcedUserId);
          restored += 1;
        }
        const ov = { ...(nextOverrides.get(r.rowIndex) || {}) };
        let ovChanged = false;
        if (p.payRateSource === 'typed' && Number(p.payRate) > 0 && ov.payRate == null) {
          ov.payRate = Number(p.payRate);
          ovChanged = true;
        }
        if (p.workersCompSource === 'typed' && p.workersCompCode && ov.workersCompCode == null) {
          ov.workersCompCode = p.workersCompCode;
          ovChanged = true;
        }
        if (ovChanged) {
          nextOverrides.set(r.rowIndex, ov);
          restored += 1;
        }
        // Restore a manually-picked worksite (worksiteSource === 'manual').
        if (p.worksiteSource === 'manual' && p.worksiteId && !nextWorksites.has(r.rowIndex)) {
          const a = p.worksiteAddress || {};
          nextWorksites.set(r.rowIndex, {
            worksiteId: p.worksiteId,
            worksiteName: p.worksiteName || p.worksiteId,
            worksiteAddress: {
              street: String(a.street || ''),
              city: String(a.city || ''),
              state: String(a.state || ''),
              zip: String(a.zip || ''),
            },
          });
          restored += 1;
        }
      }
      if (restored > 0) {
        setOverrides(nextOverrides);
        setForcedUserIdByRow(nextForced);
        setWorksiteOverrideByRow(nextWorksites);
        setSaveResult(null);
        setMatchError(
          `Restored ${restored} saved edit${restored === 1 ? '' : 's'} from a previous session — click Match to re-apply.`,
        );
      }
    } catch (err) {
      console.error('loadImportEntries (resume) failed:', err);
    }
  };

  // Once a file is parsed AND an entity + customer are chosen, restore any
  // saved edits from a prior session — once per (file, entity, customer).
  useEffect(() => {
    if (!parsed || !entityId || !customer) return;
    const rk = `${fileName}|${entityId}|${customer}`;
    if (resumeKeyRef.current === rk) return;
    resumeKeyRef.current = rk;
    void loadImportEntries(parsed.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, entityId, customer, fileName]);

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
          {parsing ? 'Parsing…' : 'Upload CSV / Excel'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          // Accept either container — the parser detects Excel vs CSV from the
          // file and applies the selected customer's column mapping.
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                <TableCell sortDirection={gridSort?.field === 'worker' ? gridSort.dir : false}>
                  <TableSortLabel
                    active={gridSort?.field === 'worker'}
                    direction={gridSort?.field === 'worker' ? gridSort.dir : 'asc'}
                    onClick={() => toggleSort('worker')}
                  >
                    Worker
                  </TableSortLabel>
                </TableCell>
                <TableCell sortDirection={gridSort?.field === 'date' ? gridSort.dir : false}>
                  <TableSortLabel
                    active={gridSort?.field === 'date'}
                    direction={gridSort?.field === 'date' ? gridSort.dir : 'asc'}
                    onClick={() => toggleSort('date')}
                  >
                    Date
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">Hours</TableCell>
                <TableCell>Job title</TableCell>
                <TableCell sx={evCol}>Everee worker ID</TableCell>
                <TableCell align="right" sx={evCol}>Pay rate</TableCell>
                <TableCell sx={evCol}>WC code / rate</TableCell>
                <TableCell sx={evCol} sortDirection={gridSort?.field === 'worksite' ? gridSort.dir : false}>
                  <TableSortLabel
                    active={gridSort?.field === 'worksite'}
                    direction={gridSort?.field === 'worksite' ? gridSort.dir : 'asc'}
                    onClick={() => toggleSort('worksite')}
                  >
                    Worksite → Everee
                  </TableSortLabel>
                </TableCell>
                <TableCell>Source status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortImportRows(
                showExcluded ? parsed.rows : parsed.rows.filter((r) => r.status === 'importable'),
              ).map((r) => {
                const match = r.status === 'importable' ? matchByRow.get(r.rowIndex) : undefined;
                const payable = match && !match.block;
                const ews = effectiveWorksite(match, r.rowIndex);
                const addr = ews.worksiteAddress;
                const eff = effective(match, r.rowIndex);
                const needsWc = rowNeedsWc(eff);
                const submitted = submittedStatusFor(match?.userId, r.workDate);
                const extId = match?.userId ? rowExternalId(match.userId, r.workDate) : '';
                return (
                <TableRow key={r.rowIndex} hover sx={{ opacity: r.status === 'importable' ? 1 : 0.65 }}>
                  <TableCell>
                    {submitted ? (
                      <Stack spacing={0.25} alignItems="flex-start">
                        <Tooltip
                          title={
                            submitted.status === 'paid'
                              ? `Paid by Everee ($${submitted.amount.toFixed(2)})`
                              : is1099Entity
                                ? `Submitted to Everee as a $${submitted.amount.toFixed(2)} payable`
                                : `Submitted to Everee — $${submitted.amount.toFixed(2)} straight-time; Everee adds any OT/DT at the pay run`
                          }
                        >
                          <Chip
                            size="small"
                            color="success"
                            variant={submitted.status === 'paid' ? 'filled' : 'outlined'}
                            icon={<CheckCircleIcon />}
                            label={
                              submitted.status === 'paid'
                                ? `Paid $${submitted.amount.toFixed(2)}`
                                : `Submitted ${is1099Entity ? '' : '~'}$${submitted.amount.toFixed(2)}`
                            }
                          />
                        </Tooltip>
                        {/* Paid rows can't be voided — the Everee pay run finalized. */}
                        {submitted.status !== 'paid' && (
                          <Link
                            component="button"
                            type="button"
                            variant="caption"
                            underline="hover"
                            color="error"
                            disabled={voidingExtId === extId}
                            onClick={() => voidRow(extId, match?.userId, r.workDate)}
                          >
                            {voidingExtId === extId ? 'Voiding…' : 'Void'}
                          </Link>
                        )}
                      </Stack>
                    ) : match ? (
                      <Tooltip
                        title={
                          match.block
                            ? match.blockReason ?? 'Blocked'
                            : eff.needsPayRate
                              ? 'Matched + Everee-linked, but no pay rate yet — map the site, or click the pay-rate cell to type one.'
                              : needsWc
                                ? 'Matched + Everee-linked + pay rate, but no workers-comp code yet — click the WC cell to add one (required for W-2).'
                                : 'Matched + Everee-linked + pay rate resolved'
                        }
                      >
                        <Chip
                          size="small"
                          color={match.block ? 'warning' : eff.needsPayRate || needsWc ? 'info' : 'success'}
                          icon={!match.block && !eff.needsPayRate && !needsWc ? <CheckCircleIcon /> : undefined}
                          label={
                            match.block
                              ? 'Blocked'
                              : eff.needsPayRate
                                ? 'Needs rate'
                                : needsWc
                                  ? 'Needs WC'
                                  : 'Ready'
                          }
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title={r.excludeReason ?? 'Ready to match + import'}>
                        <Chip size="small" color={statusChipColor(r.status)} label={STATUS_LABEL[r.status]} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                      </Typography>
                      {r.status === 'importable' && (
                        <Tooltip title="Look up / change the HRX worker for this row">
                          <IconButton
                            size="small"
                            onClick={() =>
                              openResolveDialog(
                                r.rowIndex,
                                { email: r.email, firstName: r.firstName, lastName: r.lastName },
                                match?.suggestions ?? [],
                              )
                            }
                            sx={{ p: 0.25 }}
                          >
                            <EditIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                    {/* Contact: the matched HRX worker's email/phone when found,
                        else the CSV's (Connect Team has none → "no email"). */}
                    {match && (match.matchedEmail || match.matchedPhone) ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {[match.matchedEmail, match.matchedPhone].filter(Boolean).join(' · ')}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {r.email || 'no email'}
                      </Typography>
                    )}
                    {r.status !== 'importable' ? null : !match ? (
                      <Typography variant="caption" color="text.secondary">not matched yet</Typography>
                    ) : match.block ? (
                      <>
                        <Typography variant="caption" color="warning.main" display="block">
                          <ConfDot level={match.suggestions && match.suggestions.length > 0 ? 'select' : 'problem'} />
                          {match.blockReason}
                        </Typography>
                        <Link
                          component="button"
                          type="button"
                          variant="caption"
                          underline="hover"
                          onClick={() =>
                            openResolveDialog(
                              r.rowIndex,
                              { email: r.email, firstName: r.firstName, lastName: r.lastName },
                              match.suggestions ?? [],
                            )
                          }
                          sx={{ display: 'block', mt: 0.25 }}
                        >
                          {match.suggestions && match.suggestions.length > 0
                            ? `Resolve worker (${match.suggestions.length}) →`
                            : 'Look up worker →'}
                        </Link>
                      </>
                    ) : (
                      <Typography
                        variant="caption"
                        color={match.matchedManual ? 'info.main' : match.matchedByName ? 'success.dark' : 'success.main'}
                        display="block"
                        noWrap
                        title={match.displayName ?? ''}
                      >
                        <ConfDot level={match.matchedManual ? 'exact' : match.matchedByName ? 'probable' : 'exact'} /> ✓ {match.displayName}
                        {match.matchedManual ? ' (manual)' : match.matchedByName ? ' (by name)' : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{r.workDate}</TableCell>
                  <TableCell align="right">{r.hours.toFixed(2)}</TableCell>
                  {/* Resolved position / job title — drives pay rate + WC. */}
                  <TableCell sx={{ maxWidth: 160 }}>
                    {match?.jobTitle ? (
                      <Typography variant="body2" noWrap title={match.jobTitle}>
                        {match.jobTitle}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {r.role || '—'}
                      </Typography>
                    )}
                  </TableCell>

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
                    {r.status === 'importable' ? (
                      <>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography variant="body2" noWrap title={ews.worksiteName ?? ''} sx={{ flex: 1, minWidth: 0 }}>
                            {ews.worksiteName ? (
                              <>
                                <ConfDot
                                  level={
                                    worksiteOverrideByRow.has(r.rowIndex)
                                      ? 'exact'
                                      : ews.worksiteAddress
                                        ? sourceConf(match?.worksiteSource ?? 'none')
                                        : 'select'
                                  }
                                />
                                {ews.worksiteName}
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
                          <Tooltip title="Look up / set the HRX worksite for this event">
                            <IconButton size="small" onClick={() => openWorksiteDialog(r.rowIndex, r.site)} sx={{ p: 0.25 }}>
                              <EditIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
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
                            {match?.payRateSource === 'site_mapping' ? 'Re-map site →' : 'Map site → job order'}
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
              onClick={() => runMatch()}
              disabled={!entityId || matching}
              sx={{ textTransform: 'none' }}
            >
              {matching
                ? matchProgress
                  ? `Matching ${Math.min(matchProgress.done + MATCH_BATCH_SIZE, matchProgress.total)}/${matchProgress.total}…`
                  : 'Matching…'
                : `Match ${s.importable} worker${s.importable === 1 ? '' : 's'} to HRX`}
            </Button>
            {matchByRow.size > 0 && (
              <Button
                variant="outlined"
                onClick={saveProgress}
                disabled={saving || matching}
                sx={{ textTransform: 'none' }}
              >
                {saving ? 'Saving…' : 'Save progress'}
              </Button>
            )}
            {matchByRow.size > 0 && (
              <Tooltip title="Remove previously-saved rows for this week that aren't in the current file (paid/submitted rows are kept)">
                <Button
                  variant="text"
                  color="inherit"
                  onClick={clearStale}
                  disabled={clearing || matching || saving}
                  sx={{ textTransform: 'none' }}
                >
                  {clearing ? 'Checking…' : 'Clear stale rows'}
                </Button>
              </Tooltip>
            )}
            {!entityId && (
              <Typography variant="caption" color="text.secondary">
                Pick a paying entity first.
              </Typography>
            )}
            {saveResult && (
              <Typography variant="caption" color="success.main">
                Saved {saveResult.upserted} row{saveResult.upserted === 1 ? '' : 's'} to timesheets ✓
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
                const ready = live.filter(({ m }) => {
                  if (m.block) return false;
                  const eff = effective(m, m.rowIndex);
                  return !eff.needsPayRate && !rowNeedsWc(eff);
                }).length;
                const needsRate = live.filter(
                  ({ m }) => !m.block && effective(m, m.rowIndex).needsPayRate,
                ).length;
                const needsWc = live.filter(({ m }) => {
                  if (m.block) return false;
                  const eff = effective(m, m.rowIndex);
                  return !eff.needsPayRate && rowNeedsWc(eff);
                }).length;
                const blocked = live.filter(({ m }) => m.block).length;
                return (
                  <>
                    <Chip size="small" color="success" label={`Ready: ${ready}`} />
                    {needsRate > 0 && (
                      <Chip size="small" color="info" label={`Needs pay rate: ${needsRate}`} />
                    )}
                    {needsWc > 0 && (
                      <Chip size="small" color="info" label={`Needs WC code: ${needsWc}`} />
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
                Previews the payload first — nothing is sent until you confirm. On confirm, the
                whole import (including blocked rows) is saved to HRX timesheets before the Ready
                rows go to Everee.
              </Typography>
            </Stack>
          )}
          {submitResult && (
            <Alert
              severity={submitResult.failed > 0 || submitResult.errors.length ? 'warning' : 'success'}
              onClose={() => setSubmitResult(null)}
            >
              Submitted {submitResult.submitted}{' '}
              {is1099Entity
                ? `payable${submitResult.submitted === 1 ? '' : 's'}`
                : `worked shift${submitResult.submitted === 1 ? '' : 's'}`}{' '}
              to Everee ({is1099Entity ? '' : '~'}${submitResult.totalAmount.toFixed(2)}
              {is1099Entity ? '' : ' straight-time'}).
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
              pay rate.{!is1099Entity && ' “Needs WC” rows need a workers-comp class code.'} Ready rows
              submit to Everee as{' '}
              {is1099Entity
                ? 'contractor pay (hours × rate).'
                : 'worked shifts — Everee classifies any OT/DT at the pay run.'}
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
              {is1099Entity
                ? 'This is exactly what will be sent to Everee as contractor pay (1099). Nothing has been submitted yet — review, then confirm.'
                : 'Each row is sent to Everee as a worked shift (W-2). Nothing has been submitted yet — review, then confirm.'}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                color="success"
                label={
                  is1099Entity
                    ? `${submitPreview?.count ?? 0} payable${(submitPreview?.count ?? 0) === 1 ? '' : 's'}`
                    : `${submitPreview?.count ?? 0} worked shift${(submitPreview?.count ?? 0) === 1 ? '' : 's'}`
                }
              />
              <Chip
                label={`${submitPreview?.evereeClassifiesOt ? '~' : ''}$${(submitPreview?.totalAmount ?? 0).toFixed(2)}${
                  submitPreview?.evereeClassifiesOt ? ' straight-time' : ''
                }`}
              />
            </Stack>
            {submitPreview?.evereeClassifiesOt && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Total is straight-time (hours × rate). Everee’s payroll engine computes any
                overtime / double-time at the pay run, so the final gross may be higher.
              </Alert>
            )}
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Worker</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    {!is1099Entity && <TableCell>WC</TableCell>}
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
                      {!is1099Entity && (
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.workersCompCode || '—'}</TableCell>
                      )}
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
              isOptionEqualToValue={(a, b) => a.id === b.id && a.jobTitle === b.jobTitle}
              filterOptions={(opts, state) => {
                const q = state.inputValue.trim().toLowerCase();
                if (!q) return opts;
                const tokens = q.split(/\s+/).filter(Boolean);
                return opts.filter((o) => tokens.every((t) => o.searchText.includes(t)));
              }}
              renderOption={(props, o) => {
                const loc = [o.worksiteName, [o.city, o.state].filter(Boolean).join(', ')]
                  .filter(Boolean)
                  .join(' · ');
                // Line 2: position (job title) · pay · WC — the fields that
                // drive the row's pay/WC, so the recruiter picks the right one.
                const pay = o.payRate != null ? `$${o.payRate.toFixed(2)}/hr` : '';
                const wc = o.workersCompCode
                  ? `WC ${o.workersCompCode}${o.workersCompRate != null ? ` ($${o.workersCompRate.toFixed(2)})` : ''}`
                  : 'no WC';
                const secondary = [o.jobTitle ? `Position: ${o.jobTitle}` : '', pay, wc, o.accountName, loc]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Box component="li" {...props} sx={{ display: 'block !important', py: 0.75 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {o.jobOrderNumber && (
                        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace' }}>
                          #{o.jobOrderNumber}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {o.title || o.jobTitle || '(untitled job order)'}
                      </Typography>
                      {o.type && (
                        <Chip
                          size="small"
                          label={o.type.charAt(0).toUpperCase() + o.type.slice(1)}
                          sx={{ height: 18, fontSize: 11 }}
                        />
                      )}
                      {!o.workersCompCode && (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label="no WC"
                          sx={{ height: 18, fontSize: 11 }}
                        />
                      )}
                    </Stack>
                    {secondary && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {secondary}
                      </Typography>
                    )}
                  </Box>
                );
              }}
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
        <DialogTitle>Look up worker</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                CSV row
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {resolveRow?.name || '—'}
              </Typography>
              {resolveRow?.email && (
                <Typography variant="caption" color="text.secondary">
                  {resolveRow.email}
                </Typography>
              )}
            </Box>

            {/* Free-text search — name, email, or phone. */}
            <TextField
              size="small"
              fullWidth
              label="Search HRX by name, email, or phone"
              value={resolveQuery}
              onChange={(e) => setResolveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runWorkerSearch();
                }
              }}
              disabled={savingAlias}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={runWorkerSearch}
                      disabled={resolveSearching || resolveQuery.trim().length < 2}
                    >
                      {resolveSearching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {resolveSuggestions.length > 0 ? (
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 240, overflow: 'auto' }}>
                <List dense disablePadding>
                  {resolveSuggestions.map((sug) => (
                    <ListItemButton
                      key={sug.userId}
                      selected={resolvePick === sug.userId}
                      onClick={() => setResolvePick(sug.userId)}
                      dense
                    >
                      <Radio
                        edge="start"
                        size="small"
                        checked={resolvePick === sug.userId}
                        tabIndex={-1}
                        disableRipple
                      />
                      <ListItemText
                        primary={`${sug.displayName || '(no name)'}${sug.evereeLinked ? ' · Everee ✓' : ''}`}
                        secondary={
                          [sug.email, sug.phone].filter(Boolean).join(' · ') || sug.reason
                        }
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Search above to find the right HRX worker.
              </Typography>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={resolveApplyAll}
                  onChange={(e) => setResolveApplyAll(e.target.checked)}
                  disabled={savingAlias}
                />
              }
              label={
                <Typography variant="body2">
                  Apply to all rows named “{resolveRow?.name}”{' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    (remembered for future imports)
                  </Typography>
                </Typography>
              }
            />

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
            onClick={applyResolvedWorker}
            disabled={!resolvePick || savingAlias}
            sx={{ textTransform: 'none' }}
          >
            {savingAlias ? 'Applying…' : resolveApplyAll ? 'Use for all & re-match' : 'Use for this row'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={staleConfirm != null} onClose={() => (clearing ? null : setStaleConfirm(null))} maxWidth="xs" fullWidth>
        <DialogTitle>Clear stale rows?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {staleConfirm?.count} previously-saved row{(staleConfirm?.count ?? 0) === 1 ? '' : 's'} for this
            week {(staleConfirm?.count ?? 0) === 1 ? 'is' : 'are'} no longer in the current file. Remove{' '}
            {(staleConfirm?.count ?? 0) === 1 ? 'it' : 'them'} from timesheets? Submitted / paid rows are
            always kept.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStaleConfirm(null)} disabled={clearing} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmClearStale}
            disabled={clearing}
            sx={{ textTransform: 'none' }}
          >
            {clearing ? 'Removing…' : `Remove ${staleConfirm?.count ?? 0}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={worksiteDialog != null}
        onClose={() => setWorksiteDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Look up worksite</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                CSV site
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {worksiteDialog?.csvSite || '—'}
              </Typography>
            </Box>

            <Autocomplete
              size="small"
              options={wsAccounts ?? []}
              loading={wsAccountsLoading}
              value={wsAccountPick}
              onChange={(_e, val) => {
                setWsAccountPick(val);
                setWsWorksitePick(null);
                setWsWorksites([]);
                if (val) void loadWsWorksites(val);
              }}
              getOptionLabel={(a) => (a.parentName ? `${a.parentName} › ${a.name}` : a.name)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Account"
                  placeholder="Pick the HRX account"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {wsAccountsLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <Autocomplete
              size="small"
              disabled={!wsAccountPick}
              options={wsWorksites}
              loading={wsWorksitesLoading}
              value={wsWorksitePick}
              onChange={(_e, val) => setWsWorksitePick(val)}
              getOptionLabel={(w) =>
                `${w.worksiteName}${[w.address.city, w.address.state].filter(Boolean).length ? ' — ' + [w.address.city, w.address.state].filter(Boolean).join(', ') : ''}`
              }
              isOptionEqualToValue={(a, b) => a.worksiteId === b.worksiteId}
              noOptionsText={wsAccountPick ? 'No worksites on this account' : 'Pick an account first'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Worksite"
                  placeholder="Search worksites in this account"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {wsWorksitesLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
            {wsWorksitePick && (
              <Typography variant="caption" color="text.secondary">
                {[
                  wsWorksitePick.address.street,
                  [wsWorksitePick.address.city, wsWorksitePick.address.state].filter(Boolean).join(', '),
                  wsWorksitePick.address.zip,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No address on file'}
              </Typography>
            )}

            <FormControlLabel
              control={
                <Switch checked={wsApplyAllSite} onChange={(e) => setWsApplyAllSite(e.target.checked)} />
              }
              label={
                <Typography variant="body2">
                  Apply to all rows with site “{worksiteDialog?.csvSite}”
                </Typography>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorksiteDialog(null)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={applyWorksite}
            disabled={!wsWorksitePick}
            sx={{ textTransform: 'none' }}
          >
            Use worksite
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
