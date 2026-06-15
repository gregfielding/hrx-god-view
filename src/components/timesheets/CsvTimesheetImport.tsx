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
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
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
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Papa from 'papaparse';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
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
  workersCompCode: string | null;
  payRate: number | null;
  payRateSource: 'assignment' | 'none';
  needsPayRate: boolean;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importableRows = parsed?.rows.filter((r) => r.status === 'importable') ?? [];

  const runMatch = async () => {
    if (!entityId || importableRows.length === 0) return;
    setMatching(true);
    setMatchError(null);
    try {
      const fn = httpsCallable<
        {
          tenantId: string;
          hiringEntityId: string;
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
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '60vh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Worker (CSV)</TableCell>
                <TableCell>HRX worker</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Hours</TableCell>
                <TableCell>Site</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Pay rate</TableCell>
                <TableCell align="right">Bill rate</TableCell>
                <TableCell>Source status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(showExcluded ? parsed.rows : parsed.rows.filter((r) => r.status === 'importable')).map((r) => {
                const match = r.status === 'importable' ? matchByRow.get(r.rowIndex) : undefined;
                return (
                <TableRow key={r.rowIndex} hover sx={{ opacity: r.status === 'importable' ? 1 : 0.65 }}>
                  <TableCell>
                    {match ? (
                      <Tooltip
                        title={
                          match.block
                            ? match.blockReason ?? 'Blocked'
                            : match.needsPayRate
                              ? 'Matched + Everee-linked, but no assignment paired — enter a pay rate to pay.'
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
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.email || 'no email'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    {r.status !== 'importable' ? (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    ) : !match ? (
                      <Typography variant="caption" color="text.secondary">not matched yet</Typography>
                    ) : match.block ? (
                      <Typography variant="caption" color="warning.main">
                        {match.blockReason}
                      </Typography>
                    ) : (
                      <Typography variant="body2" noWrap title={match.displayName ?? ''}>
                        {match.displayName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{r.workDate}</TableCell>
                  <TableCell align="right">{r.hours.toFixed(2)}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap title={r.site}>
                      {r.site}
                    </Typography>
                  </TableCell>
                  <TableCell>{r.role}</TableCell>
                  <TableCell align="right">
                    {match && match.payRate != null ? (
                      <Tooltip title={match.payRateSource === 'assignment' ? 'From paired HRX assignment' : ''}>
                        <Typography variant="body2">${match.payRate.toFixed(2)}</Typography>
                      </Tooltip>
                    ) : match && !match.block && match.needsPayRate ? (
                      <Typography variant="caption" color="info.main">
                        needs rate
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {r.billRate != null ? `$${r.billRate.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell>{r.sourceStatus}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
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
              Blocked rows need an HRX worker + Everee onboarding before they can be paid. Next
              phase: pair assignments + fill pay rate/WC, then submit to Everee.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

export default CsvTimesheetImport;
