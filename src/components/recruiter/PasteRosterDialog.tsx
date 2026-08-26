/**
 * Paste Roster — the spreadsheet bridge (Greg approved 2026-08-24).
 *
 * Recruiters staff events from Google Sheets (VenueSmart / Connect Team
 * lists). This dialog lets them paste those rows straight onto a shift:
 *   paste → parse (name / email / phone per line) → match to HRX workers
 *   (`importTimesheetMatchWorkers` — the same engine the timesheet import
 *   uses, email match → name match with ambiguity suggestions) → review
 *   grid → assign through `placementsCreateAssignments` (the trusted path:
 *   DNR blocks, rate resolution, overlap guard, worker SMS + app visibility).
 *
 * No new Cloud Run functions — both callables already exist. Pasted phones
 * aren't consumed by the matcher but are used client-side to auto-resolve
 * ambiguous rows when a suggestion's phone matches, and shown for eyeball
 * verification.
 */
import React, { useMemo, useState } from 'react';
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
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

interface ShiftLike {
  id: string;
  shiftDate?: string;
  shiftTitle?: string;
  startTime?: string;
  endTime?: string;
}

interface PasteRosterDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  jobOrderId: string;
  shift: ShiftLike | null;
  /** entities/{id} for Everee-link decoration in the matcher. */
  hiringEntityId?: string | null;
  /** Account name (e.g. "VenueSmart") — matcher tie-break for same names. */
  customerAccount?: string | null;
  onAssigned?: (createdCount: number) => void;
}

interface ParsedRow {
  rowIndex: number;
  raw: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface Suggestion {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  reason: string;
}

interface MatchedRow extends ParsedRow {
  status: 'matched' | 'probable' | 'ambiguous' | 'none';
  userId: string | null;
  displayName: string | null;
  matchedEmail: string | null;
  matchedPhone: string | null;
  suggestions: Suggestion[];
  /** Recruiter's pick for an ambiguous/none row. */
  chosenUserId: string;
}

const digits = (v: string): string => v.replace(/\D/g, '');

/** Parse one pasted line into name / email / phone. Tab, comma, and
 *  multi-space separated all work; "Last, First" is recognized. */
export function parseRosterLine(line: string, rowIndex: number): ParsedRow | null {
  const raw = line.trim();
  if (!raw) return null;
  let rest = raw;
  const emailMatch = rest.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : '';
  if (email) rest = rest.replace(email, ' ');
  const phoneMatch = rest.match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  const phone = phoneMatch ? digits(phoneMatch[0]).slice(-10) : '';
  if (phoneMatch) rest = rest.replace(phoneMatch[0], ' ');
  // Name: first tab/comma-separated cell of what's left, or the whole rest.
  const cells = rest.split(/\t/).map((c) => c.trim()).filter(Boolean);
  let name = cells[0] ?? '';
  if (!name && cells.length > 1) name = cells.join(' ');
  // "Last, First" → "First Last" (only when a single comma splits two words).
  const commaParts = name.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2 && !/\d/.test(name)) {
    name = `${commaParts[1]} ${commaParts[0]}`;
  } else {
    name = commaParts.join(' ');
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  const firstName = tokens[0] ?? '';
  const lastName = tokens.length > 1 ? tokens.slice(1).join(' ') : '';
  if (!firstName && !email && !phone) return null;
  return { rowIndex, raw, firstName, lastName, email, phone };
}

const STATUS_CHIP: Record<MatchedRow['status'], { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  matched: { label: 'Matched', color: 'success' },
  probable: { label: 'Probable (name)', color: 'warning' },
  ambiguous: { label: 'Pick worker', color: 'warning' },
  none: { label: 'Not found', color: 'error' },
};

const PasteRosterDialog: React.FC<PasteRosterDialogProps> = ({
  open,
  onClose,
  tenantId,
  jobOrderId,
  shift,
  hiringEntityId,
  customerAccount,
  onAssigned,
}) => {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<MatchedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<{
    created: number;
    skipped: Array<{ userId: string; reason: string }>;
  } | null>(null);

  const reset = () => {
    setText('');
    setRows(null);
    setError(null);
    setAssignResult(null);
  };

  const readyRows = useMemo(
    () => (rows ?? []).filter((r) => r.userId || r.chosenUserId),
    [rows],
  );

  const runMatch = async () => {
    const parsed = text
      .split(/\r?\n/)
      .map((line, i) => parseRosterLine(line, i))
      .filter((r): r is ParsedRow => r !== null);
    if (parsed.length === 0) {
      setError('Nothing to match — paste one worker per line.');
      return;
    }
    if (parsed.length > 500) {
      setError('Too many rows at once (max 500).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'importTimesheetMatchWorkers');
      const res = await fn({
        tenantId,
        // Matching is identity-based; the entity only decorates Everee-link
        // status. Fall back to Select so the callable's arg check passes.
        hiringEntityId: hiringEntityId || 'c1_select_llc',
        customerAccount: customerAccount || undefined,
        rows: parsed.map((r) => ({
          rowIndex: r.rowIndex,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
        })),
      });
      const results = ((res.data as { results?: Array<Record<string, unknown>> })?.results ?? []).slice();
      const byIndex = new Map<number, Record<string, unknown>>();
      for (const r of results) byIndex.set(Number(r.rowIndex), r);
      setRows(
        parsed.map((p) => {
          const m = byIndex.get(p.rowIndex) ?? {};
          const suggestions = ((m.suggestions as Suggestion[] | undefined) ?? []).slice(0, 6);
          let userId = (m.userId as string) ?? null;
          let status: MatchedRow['status'] = m.matched
            ? m.matchedByName
              ? 'probable'
              : 'matched'
            : m.ambiguous
              ? 'ambiguous'
              : 'none';
          let chosenUserId = '';
          // Phone assist: an unmatched/ambiguous row whose pasted phone equals
          // a suggestion's phone resolves to that suggestion.
          if (!userId && p.phone && suggestions.length > 0) {
            const hit = suggestions.find((sg) => sg.phone && digits(sg.phone).slice(-10) === p.phone);
            if (hit) {
              chosenUserId = hit.userId;
              status = 'probable';
            }
          }
          return {
            ...p,
            status,
            userId,
            displayName: (m.displayName as string) ?? null,
            matchedEmail: (m.matchedEmail as string) ?? null,
            matchedPhone: (m.matchedPhone as string) ?? null,
            suggestions,
            chosenUserId,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAssign = async () => {
    if (!shift || readyRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const userIds = Array.from(new Set(readyRows.map((r) => r.userId || r.chosenUserId)));
      const fn = httpsCallable(functions, 'placementsCreateAssignments');
      const res = await fn({
        tenantId,
        jobOrderId,
        shiftId: shift.id,
        userIds,
        sourceType: 'roster_paste',
      });
      const data = res.data as {
        created?: unknown[];
        skipped?: Array<{ userId: string; reason: string }>;
      };
      const created = Array.isArray(data?.created) ? data.created.length : 0;
      setAssignResult({ created, skipped: data?.skipped ?? [] });
      onAssigned?.(created);
    } catch (e) {
      // DNR and other hard failures surface the server's message verbatim —
      // it names exactly who is blocked and why.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shiftLabel = shift
    ? [shift.shiftTitle || 'Shift', shift.shiftDate, [shift.startTime, shift.endTime].filter(Boolean).join('–')]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Paste roster
        <Typography variant="body2" color="text.secondary">
          {shiftLabel}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {assignResult ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity={assignResult.created > 0 ? 'success' : 'warning'}>
              {assignResult.created} worker{assignResult.created === 1 ? '' : 's'} assigned. They get the
              standard shift SMS and see it in their app.
            </Alert>
            {assignResult.skipped.length > 0 && (
              <Alert severity="warning">
                Skipped: {assignResult.skipped.map((s) => s.reason).join(', ')} — usually already
                assigned or overlapping. Use the normal placements flow for those.
              </Alert>
            )}
          </Stack>
        ) : rows === null ? (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              One worker per line, straight from the sheet — name, and optionally email/phone in any
              order. Tabs, commas, and “Last, First” all work.
            </Typography>
            <TextField
              multiline
              minRows={8}
              fullWidth
              placeholder={'Maria Lopez\t555-201-4433\nJames Carter jcarter@gmail.com\nNguyen, Kim'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          </Stack>
        ) : (
          <Box sx={{ pt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Pasted</TableCell>
                  <TableCell>HRX worker</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.rowIndex}>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography variant="body2" noWrap title={r.raw}>
                        {r.raw}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {r.userId ? (
                        <>
                          <Typography variant="body2">{r.displayName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {[r.matchedEmail, r.matchedPhone].filter(Boolean).join(' · ')}
                          </Typography>
                        </>
                      ) : r.suggestions.length > 0 ? (
                        <Select
                          size="small"
                          fullWidth
                          displayEmpty
                          value={r.chosenUserId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              (prev ?? []).map((x, xi) => (xi === i ? { ...x, chosenUserId: v } : x)),
                            );
                          }}
                        >
                          <MenuItem value="">
                            <em>Pick the right worker…</em>
                          </MenuItem>
                          {r.suggestions.map((sg) => (
                            <MenuItem key={sg.userId} value={sg.userId}>
                              {sg.displayName || sg.userId} — {[sg.email, sg.phone].filter(Boolean).join(' · ')}
                            </MenuItem>
                          ))}
                        </Select>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          No candidate found
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={
                          r.chosenUserId && !r.userId ? 'Picked' : STATUS_CHIP[r.status].label
                        }
                        color={r.chosenUserId && !r.userId ? 'success' : STATUS_CHIP[r.status].color}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {readyRows.length} of {rows.length} rows ready. Unresolved rows are simply left out —
              assign them by hand afterwards.
            </Typography>
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {assignResult ? (
          <Button
            variant="contained"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Done
          </Button>
        ) : rows === null ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" disabled={busy || !text.trim() || !shift} onClick={() => void runMatch()}>
              {busy ? <CircularProgress size={20} /> : 'Match workers'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setRows(null)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="contained"
              disabled={busy || readyRows.length === 0 || !shift}
              onClick={() => void runAssign()}
            >
              {busy ? <CircularProgress size={20} /> : `Assign ${readyRows.length} worker${readyRows.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PasteRosterDialog;
