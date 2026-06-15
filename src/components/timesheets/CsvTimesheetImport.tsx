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
  InputLabel,
  MenuItem,
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
import Papa from 'papaparse';

import {
  mapIndeedFlexRows,
  looksLikeIndeedFlex,
  type ParsedImport,
  type ImportRowStatus,
} from '../../utils/timesheets/indeedFlexImport';

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

const CsvTimesheetImport: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  void tenantId; // used in later phases (matching/persistence)
  const [customer, setCustomer] = useState<CustomerKey>('indeed_flex');
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setError(null);
    setParsed(null);
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
            }}
          >
            {CUSTOMERS.map((c) => (
              <MenuItem key={c.key} value={c.key}>
                {c.label}
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
        </Stack>
      )}

      {parsed && (
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '60vh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Worker</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Hours</TableCell>
                <TableCell>Site</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Bill rate</TableCell>
                <TableCell>Source status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {parsed.rows.map((r) => (
                <TableRow key={r.rowIndex} hover sx={{ opacity: r.status === 'importable' ? 1 : 0.65 }}>
                  <TableCell>
                    <Tooltip title={r.excludeReason ?? 'Ready to match + import'}>
                      <Chip size="small" color={statusChipColor(r.status)} label={STATUS_LABEL[r.status]} />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.email || 'no email'}
                    </Typography>
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
                    {r.billRate != null ? `$${r.billRate.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell>{r.sourceStatus}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {s && s.importable > 0 && (
        <Box>
          <Button variant="outlined" disabled sx={{ textTransform: 'none' }}>
            Match workers → review (next phase)
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Phase 1 will match each importable row to an HRX worker by email and resolve their Everee
            linkage, pay rate, and assignment.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default CsvTimesheetImport;
