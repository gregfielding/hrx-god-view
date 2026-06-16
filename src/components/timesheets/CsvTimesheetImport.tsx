/**
 * CsvTimesheetImport — the "Import CSV" tab on /timesheets.
 *
 * Phase 0: upload a customer timesheet CSV (Indeed Flex hardcoded for
 * now), parse + classify the rows, and show a preview. No worker
 * matching, persistence, or Everee submission yet — those are later
 * phases. This is intentionally client-only so it's safe + fast to ship
 * as the foundation.
 */

import React, { useRef, useState } from 'react';
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
  InputLabel,
  Link,
  MenuItem,
  Switch,
  Paper,
  Select,
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
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import type { HiringEntity } from '../../types/recruiter/hiringEntity';
import {
  mapIndeedFlexRows,
  looksLikeIndeedFlex,
  type ParsedImport,
  type ImportRowStatus,
} from '../../utils/timesheets/indeedFlexImport';

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

type CustomerKey = 'indeed_flex';

const CUSTOMERS: Array<{ key: CustomerKey; label: string }> = [
  { key: 'indeed_flex', label: 'Indeed Flex' },
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
  const [resolveRow, setResolveRow] = useState<{ email: string; name: string } | null>(null);
  const [resolveSuggestions, setResolveSuggestions] = useState<WorkerSuggestion[]>([]);
  const [resolvePick, setResolvePick] = useState<string>('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
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

  const openResolveDialog = (email: string, name: string, suggestions: WorkerSuggestion[]) => {
    setResolveRow({ email, name });
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
        { tenantId: string; email: string; userId: string },
        { ok: true; docId: string; displayName: string | null }
      >(functions, 'saveTimesheetWorkerAlias');
      await fn({ tenantId, email: resolveRow.email, userId: resolvePick });
      setResolveRow(null);
      setResolveSuggestions([]);
      setResolvePick('');
      // Re-run the match so every row with this email resolves to the worker.
      await runMatch();
    } catch (err: any) {
      console.error('saveTimesheetWorkerAlias failed:', err);
      setResolveError(err?.message || 'Failed to save the worker match.');
    } finally {
      setSavingAlias(false);
    }
  };

  const runMatch = async () => {
    if (!entityId || importableRows.length === 0) return;
    setMatching(true);
    setMatchError(null);
    try {
      const fn = httpsCallable<
        {
          tenantId: string;
          hiringEntityId: string;
          customer: string;
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
      >(functions, 'importTimesheetMatchWorkers');
      const res = await fn({
        tenantId,
        hiringEntityId: entityId,
        customer,
        rows: importableRows.map((r) => ({
          rowIndex: r.rowIndex,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          workDate: r.workDate,
          site: r.site,
          role: r.role,
        })),
      });
      const next = new Map<number, MatchRowResult>();
      (res.data?.results ?? []).forEach((m) => next.set(m.rowIndex, m));
      setMatchByRow(next);
      if (res.data && !res.data.entityEvereeEnabled) {
        setMatchError('The selected hiring entity is not configured for Everee payroll — every row will be blocked until you pick an Everee-enabled entity.');
      }
    } catch (err: any) {
      console.error('importTimesheetMatchWorkers failed:', err);
      setMatchError(err?.message || 'Failed to match workers.');
    } finally {
      setMatching(false);
    }
  };

  // Reset match results whenever the parse or entity changes.
  const resetMatch = () => {
    setMatchByRow(new Map());
    setMatchError(null);
  };

  const handleFile = (file: File) => {
    setError(null);
    setParsed(null);
    resetMatch();
    setFileName(file.name);
    setParsing(true);
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
              setCustomer(e.target.value as CustomerKey);
              setParsed(null);
              setError(null);
              setFileName('');
              resetMatch();
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
          {parsing ? 'Parsing…' : 'Upload CSV'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
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
          columns are the exact fields submitted to Everee: worker ID, pay rate, WC code (rate is
          internal — not sent), and the worksite address (sent as a flat work-location:
          street → line1, city, state, zip → postalCode).
        </Typography>
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
                return (
                <TableRow key={r.rowIndex} hover sx={{ opacity: r.status === 'importable' ? 1 : 0.65 }}>
                  <TableCell>
                    {match ? (
                      <Tooltip
                        title={
                          match.block
                            ? match.blockReason ?? 'Blocked'
                            : match.needsPayRate
                              ? 'Matched + Everee-linked, but no assignment paired — map the site (or enter a rate) to pay.'
                              : 'Matched + Everee-linked + pay rate resolved'
                        }
                      >
                        <Chip
                          size="small"
                          color={match.block ? 'warning' : match.needsPayRate ? 'info' : 'success'}
                          icon={!match.block && !match.needsPayRate ? <CheckCircleIcon /> : undefined}
                          label={match.block ? 'Blocked' : match.needsPayRate ? 'Needs rate' : 'Ready'}
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
                                r.email,
                                [r.firstName, r.lastName].filter(Boolean).join(' '),
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
                      <Typography variant="caption" color="success.main" display="block" noWrap title={match.displayName ?? ''}>
                        ✓ {match.displayName}
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
                          {match!.evereeWorkerId}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="warning.main">not linked</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={evCol}>
                    {match && match.payRate != null ? (
                      <Tooltip
                        title={
                          match.payRateSource === 'assignment'
                            ? 'From paired HRX assignment'
                            : match.payRateSource === 'site_mapping'
                              ? 'From mapped site → job order'
                              : ''
                        }
                      >
                        <Typography variant="body2">${match.payRate.toFixed(2)}</Typography>
                      </Tooltip>
                    ) : payable && match!.needsPayRate ? (
                      <Typography variant="caption" color="info.main">needs rate</Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={evCol}>
                    {payable && match!.workersCompCode ? (
                      <>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {match!.workersCompCode}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {match!.workersCompRate != null
                            ? `$${match!.workersCompRate.toFixed(2)} rate`
                            : 'no rate'}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ ...evCol, maxWidth: 280 }}>
                    {payable ? (
                      <>
                        <Typography variant="body2" noWrap title={match!.worksiteName ?? ''}>
                          {match!.worksiteName || (
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
                        {match!.needsPayRate && r.site && (
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
                ? 'Matching…'
                : `Match ${s.importable} worker${s.importable === 1 ? '' : 's'} to HRX`}
            </Button>
            {!entityId && (
              <Typography variant="caption" color="text.secondary">
                Pick a paying entity first.
              </Typography>
            )}
            {matchByRow.size > 0 &&
              (() => {
                const vals = [...matchByRow.values()];
                const ready = vals.filter((m) => !m.block && !m.needsPayRate).length;
                const needsRate = vals.filter((m) => !m.block && m.needsPayRate).length;
                const blocked = vals.filter((m) => m.block).length;
                return (
                  <>
                    <Chip size="small" color="success" label={`Ready: ${ready}`} />
                    {needsRate > 0 && (
                      <Chip size="small" color="info" label={`Needs pay rate: ${needsRate}`} />
                    )}
                    {blocked > 0 && (
                      <Chip size="small" color="warning" label={`Blocked: ${blocked}`} />
                    )}
                  </>
                );
              })()}
          </Stack>
          {matchError && (
            <Alert severity="warning" onClose={() => setMatchError(null)}>
              {matchError}
            </Alert>
          )}
          {matchByRow.size > 0 && (
            <Typography variant="caption" color="text.secondary">
              Blocked rows need an HRX worker + Everee onboarding before they can be paid.
              “Needs rate” rows have no paired assignment — map their site to a job order to pull
              the pay rate, WC code, and worksite, then submit to Everee.
            </Typography>
          )}
        </Box>
      )}

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
              The CSV email didn’t match a single HRX worker. Pick the right person — we’ll remember
              this email → worker so future imports resolve automatically.
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
    </Box>
  );
};

export default CsvTimesheetImport;
