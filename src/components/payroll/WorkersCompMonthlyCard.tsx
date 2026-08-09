/**
 * Workers' Comp monthly report (WC-C, Greg 2026-08-05).
 *
 * Front-end for `getWorkersCompMonthlyReport`: pick an entity + calendar
 * month, get gross pay totals by work state + WC class code with rates and
 * computed premium — the carrier's monthly report, generated from HRX.
 * Applies to BOTH entities: C1 Events contractors are carrier-reported and
 * premium-paid even though their codes never go to Everee.
 *
 * The table is a live review surface: unresolved payroll (no code / no
 * matrix row) is listed by state + job title with an inline assign control —
 * assigning writes a matrix row (entity-scoped, learn-once job titles) and
 * regenerates, so next month self-heals. Export becomes available once
 * generated; unresolved payroll is flagged loudly first.
 */
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
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
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface WcRow {
  state: string;
  code: string;
  rate: number | null;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
  premium: number | null;
}

interface WcUnresolved {
  state: string;
  jobTitle: string;
  gross: number;
  entries: number;
  workers: number;
}

/** Payroll riding the 8040 placeholder — classified in name only. */
interface WcPlaceholder {
  state: string;
  jobTitle: string;
  venue: string;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
  via: string;
}

/** One venue with payroll this month + its policy-schedule flag. */
interface WcLocation {
  state: string;
  name: string;
  address: string | null;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
  codes: string[];
  placeholderGross: number;
  unresolvedGross: number;
  /** true/false = reviewed against the carrier policy; null = never marked. */
  onPolicy: boolean | null;
}

interface WcReport {
  month: string;
  hiringEntityId: string;
  entityName: string;
  workerType: 'employee' | 'contractor';
  rows: WcRow[];
  unresolved: WcUnresolved[];
  unresolvedGross: number;
  placeholders: WcPlaceholder[];
  placeholderGross: number;
  locations: WcLocation[];
  /** Rated codes available per unresolved state — feeds the assign dropdown. */
  stateCodeOptions: Record<string, Array<{ code: string; rate: number; title: string | null }>>;
  totalGross: number;
  totalPremium: number;
  entryCount: number;
  offCycle: Array<{ workDate: string; workerName: string; reasonLabel: string; total: number }>;
  offCycleTotal: number;
  grandTotal: number;
}

function previousMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Props {
  tenantId: string | null | undefined;
  /** Driven by the page-level "Hiring entity" picker — one picker, both reports. */
  entityId: string;
  entityName: string | null;
}

const WorkersCompMonthlyCard: React.FC<Props> = ({ tenantId, entityId, entityName }) => {
  const [month, setMonth] = useState(previousMonth());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WcReport | null>(null);
  /** Per-unresolved-group draft code/rate inputs, keyed `state|title`. */
  const [drafts, setDrafts] = useState<Record<string, { code: string; rate: string; custom?: boolean }>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  /** Code-picker popup for a resolved row (timesheets-style, Greg 2026-08-05). */
  const [codeDialog, setCodeDialog] = useState<{
    state: string;
    currentCode: string;
    pickedCode: string;
    customCode: string;
    rate: string;
    saving: boolean;
  } | null>(null);

  // A report for one entity must never sit under another entity's selection —
  // same stale-table footgun as the cost report (Oakland Arena, 2026-08-05).
  React.useEffect(() => {
    setReport(null);
    setDrafts({});
  }, [entityId]);

  const generate = async (): Promise<void> => {
    if (!tenantId || !entityId || !month) return;
    setLoading(true);
    setError(null);
    try {
      const call = httpsCallable(functions, 'getWorkersCompMonthlyReport');
      const res = await call({ tenantId, hiringEntityId: entityId, month });
      setReport(res.data as WcReport);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Two callers share this: the unresolved-group Assign button (writes code +
   * rate + learned title; '(no title)' groups become the entity's per-state
   * DEFAULT via the '*' title so future months classify automatically), and
   * the resolved-row "Set" button for codes missing a rate (rate only —
   * `forcedCode` is the row's existing code, no title learning).
   */
  const assign = async (u: WcUnresolved, draftKey?: string, forcedCode?: string): Promise<void> => {
    const key = draftKey ?? `${u.state}|${u.jobTitle}`;
    const draft = drafts[key];
    const code = (forcedCode ?? draft?.code ?? '').trim();
    const rate = Number(draft?.rate);
    if (!tenantId || !code || !(rate >= 0) || draft?.rate === '' || draft?.rate == null) return;
    setAssigning(key);
    setError(null);
    try {
      const call = httpsCallable(functions, 'upsertWorkersCompRate');
      await call({
        tenantId,
        hiringEntityId: entityId,
        state: u.state,
        code,
        rate,
        jobTitles: forcedCode ? [] : u.jobTitle !== '(no title)' ? [u.jobTitle] : ['*'],
        // Connect the code to the data: stamps matching uncoded assignments
        // (state + title) and this month's uncoded entries server-side, so
        // the whole chain learns — not just this report.
        propagateMonth: report?.month ?? month,
      });
      await generate();
    } catch (e: any) {
      setError(e?.message || 'Failed to save code/rate');
    } finally {
      setAssigning(null);
    }
  };

  /** Save from the code-picker popup: same code = rate fix; new code = reclassify. */
  const saveCodeDialog = async (): Promise<void> => {
    if (!codeDialog || !tenantId) return;
    const code = (codeDialog.pickedCode === '__custom' ? codeDialog.customCode : codeDialog.pickedCode).trim();
    const rate = Number(codeDialog.rate);
    if (!code || !(rate >= 0) || codeDialog.rate === '') return;
    setCodeDialog((p) => (p ? { ...p, saving: true } : p));
    setError(null);
    try {
      const call = httpsCallable(functions, 'upsertWorkersCompRate');
      await call({
        tenantId,
        hiringEntityId: entityId,
        state: codeDialog.state,
        code,
        rate,
        jobTitles: [],
        propagateMonth: report?.month ?? month,
        ...(code !== codeDialog.currentCode ? { reclassifyFromCode: codeDialog.currentCode } : {}),
      });
      setCodeDialog(null);
      await generate();
    } catch (e: any) {
      setError(e?.message || 'Failed to save code/rate');
      setCodeDialog((p) => (p ? { ...p, saving: false } : p));
    }
  };

  /**
   * On-policy flag per venue — optimistic flip, persisted server-side so the
   * reconciliation against the carrier's location schedule is done ONCE and
   * every later month's report computes coverage from it.
   */
  const [policySaving, setPolicySaving] = useState<string | null>(null);
  const togglePolicy = async (loc: WcLocation): Promise<void> => {
    if (!tenantId) return;
    const next = loc.onPolicy !== true;
    const key = `${loc.state}|${loc.name}`;
    setPolicySaving(key);
    setReport((p) =>
      p ? { ...p, locations: p.locations.map((l) => (l === loc ? { ...l, onPolicy: next } : l)) } : p,
    );
    try {
      const call = httpsCallable(functions, 'setWorkersCompPolicyLocation');
      await call({ tenantId, hiringEntityId: entityId, state: loc.state, name: loc.name, onPolicy: next });
    } catch (e: any) {
      setError(e?.message || 'Failed to save policy flag');
      setReport((p) =>
        p ? { ...p, locations: p.locations.map((l) => (l.state === loc.state && l.name === loc.name ? { ...l, onPolicy: loc.onPolicy } : l)) } : p,
      );
    } finally {
      setPolicySaving(null);
    }
  };

  const exportCsv = (): void => {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`Workers' Comp Payroll Report,${report.entityName},${report.month}`);
    lines.push('');
    lines.push('State,Class code,Rate,Hours,Gross payroll,Premium,Workers');
    for (const r of report.rows) {
      lines.push(
        [r.state, r.code, r.rate ?? '', r.hours, r.gross.toFixed(2), r.premium?.toFixed(2) ?? '', r.workers]
          .map(csvCell)
          .join(','),
      );
    }
    lines.push(['TOTAL', '', '', '', report.totalGross.toFixed(2), report.totalPremium.toFixed(2), ''].join(','));
    if (report.unresolved.length > 0) {
      lines.push('');
      lines.push('UNRESOLVED (no code assigned),,,,,,');
      lines.push('State,Job title,,,Gross payroll,,Workers');
      for (const u of report.unresolved) {
        lines.push([u.state, u.jobTitle, '', '', u.gross.toFixed(2), '', u.workers].map(csvCell).join(','));
      }
      lines.push(['UNRESOLVED TOTAL', '', '', '', report.unresolvedGross.toFixed(2), '', ''].join(','));
    }
    if ((report.placeholders?.length ?? 0) > 0) {
      lines.push('');
      lines.push('8040 PLACEHOLDER (no real class),,,,,,');
      lines.push('State,Job title,Location,Hours,Gross payroll,Came from,Workers');
      for (const g of report.placeholders) {
        lines.push(
          [g.state, g.jobTitle, g.venue, g.hours, g.gross.toFixed(2), g.via, g.workers].map(csvCell).join(','),
        );
      }
      lines.push(['8040 TOTAL', '', '', '', report.placeholderGross.toFixed(2), '', ''].join(','));
    }
    if ((report.locations?.length ?? 0) > 0) {
      lines.push('');
      lines.push('LOCATION COVERAGE,,,,,,');
      lines.push('State,Location,Address,Hours,Gross payroll,Classes,On policy');
      for (const l of report.locations) {
        lines.push(
          [
            l.state,
            l.name,
            l.address ?? '',
            l.hours,
            l.gross.toFixed(2),
            l.codes.join(' '),
            l.onPolicy == null ? 'not reviewed' : l.onPolicy ? 'yes' : 'NO',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    if (report.offCycle.length > 0) {
      lines.push('');
      lines.push('Off-cycle payments (not classified),,,,,,');
      lines.push('Work date,Worker,Reason,,Amount,,');
      for (const p of report.offCycle) {
        lines.push([p.workDate, p.workerName, p.reasonLabel, '', p.total.toFixed(2), '', ''].map(csvCell).join(','));
      }
      lines.push(['OFF-CYCLE TOTAL', '', '', '', report.offCycleTotal.toFixed(2), '', ''].join(','));
    }
    lines.push(['GRAND TOTAL', '', '', '', report.grandTotal.toFixed(2), '', ''].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WC-Report_${report.entityName.replace(/\s+/g, '-')}_${report.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <HealthAndSafetyIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight={600}>
            Workers&apos; Comp monthly report
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            type="month"
            label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Button variant="contained" onClick={() => void generate()} disabled={loading || !entityId}>
            {loading ? 'Generating…' : entityName ? `Generate — ${entityName}` : 'Generate'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={exportCsv}
            disabled={!report || report.rows.length === 0}
          >
            Export CSV
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {entityId
            ? 'Gross payroll + premium by work state and WC class code for the calendar month. Both entities are carrier-reported — contractor codes just never go to Everee. Fix anything in the "needs a code" list before exporting.'
            : 'Pick a hiring entity above — the same picker drives both reports. WC reports are per entity.'}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {report && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>{report.entityName}</strong> — {report.month} ·{' '}
              {report.workerType === 'contractor' ? '1099 contractors (flat-rate hours)' : 'W-2 employees'} ·{' '}
              {report.entryCount} entries · est. premium <strong>{usd(report.totalPremium)}</strong>
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>State</TableCell>
                    <TableCell>Class code</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Gross payroll</TableCell>
                    <TableCell align="right">Premium</TableCell>
                    <TableCell align="right">Workers</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={`${r.state}_${r.code}`}>
                      <TableCell>{r.state}</TableCell>
                      <TableCell>
                        {/* Code-first editing (timesheets pattern): click the
                            code → popup of the state's available codes; the
                            rate follows the matrix. Changing a code
                            reclassifies the underlying entries/assignments. */}
                        <Button
                          size="small"
                          variant="text"
                          sx={{ minWidth: 0, p: 0.25, textDecoration: 'underline', fontWeight: r.rate == null ? 700 : 400 }}
                          color={r.rate == null ? 'warning' : 'primary'}
                          onClick={() =>
                            setCodeDialog({
                              state: r.state,
                              currentCode: r.code,
                              pickedCode: r.code,
                              customCode: '',
                              rate: r.rate != null ? String(r.rate) : '',
                              saving: false,
                            })
                          }
                        >
                          {r.code}
                        </Button>
                      </TableCell>
                      <TableCell align="right">{r.rate ?? '—'}</TableCell>
                      <TableCell align="right">{r.hours.toFixed(2)}</TableCell>
                      <TableCell align="right">{usd(r.gross)}</TableCell>
                      <TableCell align="right">{r.premium != null ? usd(r.premium) : '—'}</TableCell>
                      <TableCell align="right">{r.workers}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} sx={{ fontWeight: 700 }}>
                      Total
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {usd(report.totalGross)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {usd(report.totalPremium)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {report.offCycle.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        Off-cycle payments ({report.offCycle.length}, not classified)
                      </TableCell>
                      <TableCell align="right">{usd(report.offCycleTotal)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {report.unresolved.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {usd(report.unresolvedGross)} of payroll needs a code. Assign a class code + rate
                  per line — it saves to the rate table for {report.entityName} and future months
                  classify automatically.
                </Alert>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>State</TableCell>
                        <TableCell>Job title</TableCell>
                        <TableCell align="right">Gross payroll</TableCell>
                        <TableCell align="right">Workers</TableCell>
                        <TableCell>Class code</TableCell>
                        <TableCell>Rate</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.unresolved.map((u) => {
                        const key = `${u.state}|${u.jobTitle}`;
                        const draft = drafts[key] ?? { code: '', rate: '' };
                        const noState = u.state === '(no state)';
                        return (
                          <TableRow key={key}>
                            <TableCell>{u.state}</TableCell>
                            <TableCell>{u.jobTitle}</TableCell>
                            <TableCell align="right">{usd(u.gross)}</TableCell>
                            <TableCell align="right">{u.workers}</TableCell>
                            {noState ? (
                              <TableCell colSpan={3}>
                                <Typography variant="caption" color="text.secondary">
                                  No work state on these entries — fix the worksite on the
                                  timesheet rows first.
                                </Typography>
                              </TableCell>
                            ) : (
                              <>
                                <TableCell sx={{ minWidth: 200 }}>
                                  {(() => {
                                    const options = report.stateCodeOptions?.[u.state] ?? [];
                                    if (options.length === 0 || draft.custom) {
                                      return (
                                        <TextField
                                          size="small"
                                          placeholder="e.g. 9016"
                                          value={draft.code}
                                          onChange={(e) =>
                                            setDrafts((p) => ({
                                              ...p,
                                              [key]: { ...draft, code: e.target.value, custom: true },
                                            }))
                                          }
                                        />
                                      );
                                    }
                                    return (
                                      <TextField
                                        select
                                        size="small"
                                        fullWidth
                                        value={draft.code}
                                        SelectProps={{ displayEmpty: true }}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          if (v === '__custom') {
                                            setDrafts((p) => ({ ...p, [key]: { code: '', rate: '', custom: true } }));
                                            return;
                                          }
                                          const opt = options.find((o) => o.code === v);
                                          setDrafts((p) => ({
                                            ...p,
                                            [key]: { code: v, rate: opt ? String(opt.rate) : draft.rate },
                                          }));
                                        }}
                                      >
                                        <MenuItem value="" disabled>
                                          Pick a {u.state} code…
                                        </MenuItem>
                                        {options.map((o) => (
                                          <MenuItem key={o.code} value={o.code}>
                                            {o.code}
                                            {o.title ? ` — ${o.title}` : ''} ({o.rate})
                                          </MenuItem>
                                        ))}
                                        <MenuItem value="__custom">Other code…</MenuItem>
                                      </TextField>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell sx={{ width: 100 }}>
                                  <TextField
                                    size="small"
                                    placeholder="rate"
                                    value={draft.rate}
                                    onChange={(e) =>
                                      setDrafts((p) => ({ ...p, [key]: { ...draft, rate: e.target.value } }))
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    disabled={
                                      assigning === key || !draft.code.trim() || !(Number(draft.rate) >= 0) || draft.rate === ''
                                    }
                                    onClick={() => void assign(u)}
                                  >
                                    {assigning === key ? 'Saving…' : 'Assign'}
                                  </Button>
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Missing classifications — payroll riding the 8040 placeholder.
                Fixing happens through the existing controls: click 8040 in the
                by-class table to reclassify a state's placeholder payroll. */}
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Missing classes — 8040 placeholder
              </Typography>
              {(report.placeholders?.length ?? 0) === 0 ? (
                <Alert severity="success">
                  No payroll on the 8040 placeholder this month — every dollar is on a real class code.
                </Alert>
              ) : (
                <>
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    {usd(report.placeholderGross)} of payroll is classified 8040 (placeholder) — the
                    carrier sees these workers without a real class. To fix a line, click{' '}
                    <strong>8040</strong> in the by-class table above and pick the real code — that
                    reclassifies the state&apos;s placeholder payroll and future months follow.
                  </Alert>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>State</TableCell>
                          <TableCell>Job title</TableCell>
                          <TableCell>Location</TableCell>
                          <TableCell align="right">Workers</TableCell>
                          <TableCell align="right">Hours</TableCell>
                          <TableCell align="right">Gross payroll</TableCell>
                          <TableCell>Came from</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.placeholders.map((g) => (
                          <TableRow key={`${g.state}|${g.jobTitle}|${g.venue}`}>
                            <TableCell>{g.state}</TableCell>
                            <TableCell>{g.jobTitle}</TableCell>
                            <TableCell>{g.venue}</TableCell>
                            <TableCell align="right">{g.workers}</TableCell>
                            <TableCell align="right">{g.hours.toFixed(2)}</TableCell>
                            <TableCell align="right">{usd(g.gross)}</TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {g.via || '—'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </Box>

            {/* Location coverage — every venue with payroll vs the carrier
                policy's location schedule. The checkbox is the one-time
                reconciliation; per-state "N of M" headers show the gap. */}
            {(report.locations?.length ?? 0) > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Location coverage
                </Typography>
                <Alert severity="info" sx={{ mb: 1 }}>
                  Every location with payroll this month. Check <strong>On policy</strong> for each
                  venue that appears on the carrier&apos;s location schedule — the flag sticks, so
                  future months show each state&apos;s coverage automatically. Unchecked or
                  unreviewed venues with payroll are your exposure list for InSource.
                </Alert>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Location</TableCell>
                        <TableCell align="right">Workers</TableCell>
                        <TableCell align="right">Hours</TableCell>
                        <TableCell align="right">Gross payroll</TableCell>
                        <TableCell>Classes</TableCell>
                        <TableCell align="center">On policy</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Array.from(new Set(report.locations.map((l) => l.state))).map((st) => {
                        const locs = report.locations.filter((l) => l.state === st);
                        const onCount = locs.filter((l) => l.onPolicy === true).length;
                        const covered = onCount === locs.length;
                        return (
                          <React.Fragment key={st}>
                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                              <TableCell colSpan={5} sx={{ fontWeight: 700 }}>
                                {st}
                              </TableCell>
                              <TableCell align="center">
                                <Chip
                                  size="small"
                                  color={covered ? 'success' : 'warning'}
                                  label={`${onCount} of ${locs.length} on policy`}
                                />
                              </TableCell>
                            </TableRow>
                            {locs.map((l) => (
                              <TableRow key={`${l.state}|${l.name}`}>
                                <TableCell>
                                  {l.name}
                                  {l.address && (
                                    <Typography variant="caption" color="text.secondary" display="block">
                                      {l.address}
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell align="right">{l.workers}</TableCell>
                                <TableCell align="right">{l.hours.toFixed(2)}</TableCell>
                                <TableCell align="right">{usd(l.gross)}</TableCell>
                                <TableCell>
                                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                    {l.codes.filter((c) => c !== '8040').map((c) => (
                                      <Chip key={c} size="small" variant="outlined" label={c} />
                                    ))}
                                    {l.placeholderGross > 0 && (
                                      <Tooltip title={`${usd(l.placeholderGross)} on the 8040 placeholder`}>
                                        <Chip size="small" color="warning" label="8040" />
                                      </Tooltip>
                                    )}
                                    {l.unresolvedGross > 0 && (
                                      <Tooltip title={`${usd(l.unresolvedGross)} with no code at all`}>
                                        <Chip size="small" color="error" label="no code" />
                                      </Tooltip>
                                    )}
                                  </Stack>
                                </TableCell>
                                <TableCell align="center">
                                  <Tooltip
                                    title={
                                      l.onPolicy == null
                                        ? 'Not reviewed yet — check if this venue is on the carrier policy'
                                        : l.onPolicy
                                          ? 'On the carrier policy'
                                          : 'Reviewed: NOT on the carrier policy'
                                    }
                                  >
                                    <Checkbox
                                      size="small"
                                      checked={l.onPolicy === true}
                                      indeterminate={l.onPolicy == null}
                                      disabled={policySaving === `${l.state}|${l.name}` || l.name === '(no venue)'}
                                      onChange={() => void togglePolicy(l)}
                                    />
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}
      </CardContent>

      {/* Code picker popup — the state's available codes with rates, the
          8040 placeholder always offered, plus free entry. Picking loads the
          matrix rate; saving a DIFFERENT code reclassifies this row's
          entries + assignments and relearns their titles. */}
      <Dialog open={codeDialog !== null} onClose={() => !codeDialog?.saving && setCodeDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {codeDialog?.state} — class code
        </DialogTitle>
        <DialogContent>
          <List dense>
            {(report?.stateCodeOptions?.[codeDialog?.state ?? ''] ?? []).map((o) => (
              <ListItemButton
                key={o.code}
                selected={codeDialog?.pickedCode === o.code}
                onClick={() =>
                  setCodeDialog((p) => (p ? { ...p, pickedCode: o.code, rate: String(o.rate) } : p))
                }
              >
                <ListItemText
                  primary={`${o.code}${o.title ? ` — ${o.title}` : ''}`}
                  secondary={`rate ${o.rate}`}
                />
              </ListItemButton>
            ))}
            <ListItemButton
              selected={codeDialog?.pickedCode === '__custom'}
              onClick={() => setCodeDialog((p) => (p ? { ...p, pickedCode: '__custom', rate: '' } : p))}
            >
              <ListItemText primary="Other code…" />
            </ListItemButton>
          </List>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            {codeDialog?.pickedCode === '__custom' && (
              <TextField
                size="small"
                label="Code"
                value={codeDialog.customCode}
                onChange={(e) => setCodeDialog((p) => (p ? { ...p, customCode: e.target.value } : p))}
              />
            )}
            <TextField
              size="small"
              label="Rate"
              value={codeDialog?.rate ?? ''}
              onChange={(e) => setCodeDialog((p) => (p ? { ...p, rate: e.target.value } : p))}
            />
          </Stack>
          {codeDialog && codeDialog.pickedCode !== '__custom' && codeDialog.pickedCode !== codeDialog.currentCode && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Saving moves this row&apos;s workers from {codeDialog.currentCode} to{' '}
              {codeDialog.pickedCode} — assignments and this month&apos;s entries are updated, and
              future work classifies to the new code.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCodeDialog(null)} disabled={codeDialog?.saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              !codeDialog ||
              codeDialog.saving ||
              codeDialog.rate === '' ||
              !(Number(codeDialog.rate) >= 0) ||
              (codeDialog.pickedCode === '__custom' && !codeDialog.customCode.trim())
            }
            onClick={() => void saveCodeDialog()}
          >
            {codeDialog?.saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default WorkersCompMonthlyCard;
