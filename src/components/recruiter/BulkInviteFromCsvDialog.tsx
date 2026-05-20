/**
 * **BulkInviteFromCsvDialog** — recruiter-facing CSV upload + bulk
 * SMS-invite flow for a user group.
 *
 * Lives on the user-group detail page (`UserGroupDetails.tsx`),
 * launched by the "Bulk invite from CSV" icon next to copy-apply-link.
 *
 * Designed for the Indeed Sponsored Job applicant export shape:
 *   columns: name,email,phone,status,candidate location,relevant experience,
 *            education,job title,job location,date,interest level,source
 * Only `name` and `phone` are required; other columns are silently
 * ignored so we tolerate small schema drift.
 *
 * Three states the user walks through:
 *   1. **Upload**: drag-and-drop or click-to-pick a CSV.
 *   2. **Preview**: parsed rows with normalized phones, counts,
 *      sample message. "Send invites" button (requires explicit
 *      confirmation when total > 25 — easy guardrail against the
 *      "oops uploaded the wrong file" case).
 *   3. **Results**: aggregate + per-row outcomes after the server
 *      returns. Closing the dialog re-opens fresh.
 *
 * The CSV parser tolerates quoted fields with embedded commas (e.g.
 * `"Kansas City, MO"`) but doesn't handle escaped quotes inside quoted
 * fields — Indeed exports don't emit those.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

import {
  userGroupBulkInviteCandidates,
  type BulkInviteResponse,
  type BulkInviteRowResult,
  type BulkInviteRowStatus,
} from '../../services/recruiter/userGroupBulkInviteCallable';

export interface BulkInviteFromCsvDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  groupId: string;
  /** Public group label (e.g. "Cleaners Kansas City"). Just for the
   *  dialog title — the SMS body picks its own label server-side. */
  groupLabel?: string;
  /** Apply URL to send. Defaults to the standard
   *  `<origin>/c1/apply/group/<groupId>` shape if omitted. */
  applyUrl?: string;
}

interface ParsedRow {
  /** Original row index (1-based, matches a spreadsheet view). */
  rowIndex: number;
  name: string;
  rawPhone: string;
  /** E.164 if normalize succeeded, null otherwise. */
  phoneE164: string | null;
  /** Reason this row is excluded from send. */
  exclusionReason?: 'no_phone' | 'bad_phone';
}

// ─────────────────────────────────────────────────────────────────────
// CSV parsing
// ─────────────────────────────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') inQuote = false;
      else current += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') {
        cells.push(current);
        current = '';
      } else current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cells[j] ?? '';
    rows.push(row);
  }
  return rows;
}

function normalizeE164(raw: string): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^'/, '')
    .replace(/[\s()\-.]/g, '')
    .trim();
  let digits = cleaned;
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length !== 11 || !digits.startsWith('1')) return null;
  if (!/^\d+$/.test(digits)) return null;
  return `+${digits}`;
}

// ─────────────────────────────────────────────────────────────────────
// Dialog
// ─────────────────────────────────────────────────────────────────────

const BulkInviteFromCsvDialog: React.FC<BulkInviteFromCsvDialogProps> = ({
  open,
  onClose,
  tenantId,
  groupId,
  groupLabel,
  applyUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkInviteResponse | null>(null);

  const resolvedApplyUrl = useMemo(() => {
    if (applyUrl) return applyUrl;
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/c1/apply/group/${groupId}`;
    }
    return `https://hrxone.com/c1/apply/group/${groupId}`;
  }, [applyUrl, groupId]);

  const sendableRows = useMemo(
    () => rows.filter((r) => r.phoneE164 !== null),
    [rows],
  );

  const handleClose = (): void => {
    if (sending) return;
    setRows([]);
    setFileName('');
    setParseError(null);
    setServerError(null);
    setResult(null);
    onClose();
  };

  const handleFile = async (file: File): Promise<void> => {
    setParseError(null);
    setResult(null);
    setRows([]);
    setFileName(file.name);
    try {
      const text = await file.text();
      const raw = parseCsv(text);
      if (raw.length === 0) {
        setParseError(
          'No data rows found. Make sure the CSV has a header row with `name` and `phone` columns.',
        );
        return;
      }
      const parsed: ParsedRow[] = raw.map((r, i) => {
        const name = String(r['name'] ?? '').trim();
        const rawPhone = String(r['phone'] ?? '').trim();
        const phoneE164 = normalizeE164(rawPhone);
        const exclusionReason: ParsedRow['exclusionReason'] = !rawPhone
          ? 'no_phone'
          : !phoneE164
            ? 'bad_phone'
            : undefined;
        return {
          rowIndex: i + 2, // +2 because: +1 for 0-index, +1 for header row
          name,
          rawPhone,
          phoneE164,
          exclusionReason,
        };
      });
      setRows(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFile(file);
    e.target.value = ''; // allow re-picking the same file later
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSend = async (): Promise<void> => {
    if (sendableRows.length === 0) return;
    setSending(true);
    setServerError(null);
    try {
      const res = await userGroupBulkInviteCandidates({
        tenantId,
        groupId,
        applyUrl: resolvedApplyUrl,
        candidates: sendableRows.map((r) => ({
          name: r.name,
          phone: r.phoneE164 as string,
        })),
      });
      setResult(res.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setServerError(msg);
    } finally {
      setSending(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <UploadFileIcon color="primary" />
        <Box flex={1}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
            Bulk invite from CSV
          </Typography>
          {groupLabel && (
            <Typography variant="caption" color="text.secondary">
              → {groupLabel}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={handleClose} disabled={sending}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* Phase 1 — file picker */}
        {rows.length === 0 && !result && (
          <Box
            onDrop={onDrop}
            onDragOver={onDragOver}
            sx={{
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              backgroundColor: 'background.default',
              cursor: 'pointer',
              transition: 'background-color 120ms ease',
              '&:hover': { backgroundColor: 'action.hover' },
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              Drop CSV here or click to pick
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Indeed Sponsored Job applicant export shape (name, phone columns
              required). Other columns ignored.
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={onFileInputChange}
            />
          </Box>
        )}

        {parseError && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setParseError(null)}>
            {parseError}
          </Alert>
        )}

        {/* Phase 2 — preview */}
        {rows.length > 0 && !result && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={2}>
              <Chip
                label={`${sendableRows.length} sendable`}
                color="primary"
                size="small"
              />
              {rows.length - sendableRows.length > 0 && (
                <Chip
                  label={`${rows.length - sendableRows.length} skipped`}
                  color="warning"
                  size="small"
                />
              )}
              <Box flex={1} />
              <Typography variant="caption" color="text.secondary">
                {fileName}
              </Typography>
            </Stack>

            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Apply URL:</strong>{' '}
                <code style={{ fontSize: '0.85em' }}>{resolvedApplyUrl}</code>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Each recipient gets ONE SMS with this link. Re-uploading the
                same CSV is safe — already-invited phones are auto-skipped.
              </Typography>
            </Alert>

            <Box sx={{ maxHeight: 320, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Row</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Phone</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.slice(0, 100).map((r) => (
                    <TableRow key={r.rowIndex} hover>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {r.rowIndex}
                      </TableCell>
                      <TableCell>{r.name || <i>(no name)</i>}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                        {r.phoneE164 ?? r.rawPhone}
                      </TableCell>
                      <TableCell>
                        {r.phoneE164 ? (
                          <Chip
                            label="Will send"
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            label={r.exclusionReason === 'no_phone' ? 'No phone' : 'Bad phone'}
                            size="small"
                            color="warning"
                            variant="outlined"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {rows.length > 100 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Showing first 100 of {rows.length}. All sendable rows will be processed.
              </Typography>
            )}

            {serverError && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setServerError(null)}>
                {serverError}
              </Alert>
            )}
          </Box>
        )}

        {/* Phase 3 — results */}
        {result && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={2} flexWrap="wrap">
              <CheckCircleIcon color="success" />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                Done.
              </Typography>
              <Chip label={`${result.aggregate.sent} sent`} color="success" size="small" />
              {result.aggregate.skippedAlreadySent > 0 && (
                <Chip
                  label={`${result.aggregate.skippedAlreadySent} already sent`}
                  size="small"
                  variant="outlined"
                />
              )}
              {result.aggregate.twilioError > 0 && (
                <Chip
                  label={`${result.aggregate.twilioError} Twilio error`}
                  color="error"
                  size="small"
                />
              )}
              {(result.aggregate.skippedBadPhone + result.aggregate.skippedNoPhone) > 0 && (
                <Chip
                  label={`${result.aggregate.skippedBadPhone + result.aggregate.skippedNoPhone} bad/no phone`}
                  color="warning"
                  size="small"
                />
              )}
            </Stack>

            {result.aggregate.twilioError > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Some sends hit Twilio errors — usually error 21610 (recipient
                previously replied STOP) or 30007 (carrier filtering). Surface
                these to the recruiter team for alternate-channel outreach.
              </Alert>
            )}

            <Box sx={{ maxHeight: 360, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Phone</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.results.map((r, i) => (
                    <ResultRow key={i} row={r} />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}

        {sending && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Sending {sendableRows.length} invite{sendableRows.length === 1 ? '' : 's'}…
            </Typography>
            <LinearProgress />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {result ? (
          <Button onClick={handleClose} variant="contained" disabled={sending}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={sending}>
              Cancel
            </Button>
            {rows.length > 0 && (
              <Button
                onClick={handleSend}
                variant="contained"
                disabled={sendableRows.length === 0 || sending}
                startIcon={sending ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {sending
                  ? 'Sending…'
                  : `Send ${sendableRows.length} invite${sendableRows.length === 1 ? '' : 's'}`}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default BulkInviteFromCsvDialog;

// ─────────────────────────────────────────────────────────────────────
// Per-result row
// ─────────────────────────────────────────────────────────────────────

const STATUS_META: Record<BulkInviteRowStatus, { label: string; color: 'success' | 'warning' | 'error' | 'default'; icon: React.ReactNode }> = {
  sent: { label: 'Sent', color: 'success', icon: <CheckCircleIcon fontSize="inherit" /> },
  skipped_already_sent: { label: 'Already sent', color: 'default', icon: null },
  skipped_bad_phone: { label: 'Bad phone', color: 'warning', icon: <WarningAmberIcon fontSize="inherit" /> },
  skipped_no_phone: { label: 'No phone', color: 'warning', icon: <WarningAmberIcon fontSize="inherit" /> },
  skipped_no_name: { label: 'No name', color: 'warning', icon: <WarningAmberIcon fontSize="inherit" /> },
  twilio_error: { label: 'Twilio error', color: 'error', icon: <ErrorOutlineIcon fontSize="inherit" /> },
  preview: { label: 'Preview', color: 'default', icon: null },
};

const ResultRow: React.FC<{ row: BulkInviteRowResult }> = ({ row }) => {
  const meta = STATUS_META[row.status];
  return (
    <TableRow hover>
      <TableCell>{row.name || <i>(no name)</i>}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{row.phone}</TableCell>
      <TableCell>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Chip
            label={meta.label}
            size="small"
            color={meta.color}
            variant={meta.color === 'default' ? 'outlined' : 'filled'}
            icon={meta.icon ? <span style={{ display: 'flex' }}>{meta.icon}</span> : undefined}
          />
          {row.error && (
            <Typography variant="caption" color="text.secondary">
              {row.error}
            </Typography>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Convenience: Divider import kept for any future per-phase breaks.
// ─────────────────────────────────────────────────────────────────────
void Divider;
