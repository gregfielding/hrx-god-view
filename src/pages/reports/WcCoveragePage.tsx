/**
 * /reports/wc-coverage — WC Coverage Gaps (Greg 2026-08-25, the "Slice 3
 * coverage dashboard" that was scoped and never built): one page answering
 * "where are we missing workers' comp coverage," with dollars attached.
 *
 * Nine gap types, cross-entity, one call:
 * getWorkersCompMonthlyReport({ coverage: true, startDate?, endDate? }).
 * The two with real premium exposure lead: payroll in states with NO policy
 * on file, and payroll worked outside a policy's effective window. The rest
 * are classification hygiene (unresolved / 8040 placeholders / rate gaps /
 * missing work state) plus the forward-looking uncoded-live-assignments
 * queue (next cycle's problem, visible today).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const daysAgoIso = (d: number): string => new Date(Date.now() - d * 24 * 3600e3).toISOString().slice(0, 10);

interface GapRow {
  key: string;
  gross: number;
  hours: number;
  entries: number;
  workers: number;
}

interface EntityCoverage {
  entityId: string;
  name: string;
  isContractor: boolean;
  hasAnyPolicy: boolean;
  policyStates: string[];
  total: { gross: number; hours: number; entries: number; workers: number };
  workedStates: GapRow[];
  gaps: {
    statesNoPolicy: GapRow[];
    workedOutsidePolicyWindow: GapRow[];
    unresolved: GapRow[];
    placeholderReplaceNow: GapRow[];
    placeholderCoverageNeeded: GapRow[];
    ratesMissing: GapRow[];
    noState: { gross: number; hours: number; entries: number; workers: number };
    uncodedLiveAssignments: { count: number; byState: Record<string, number> };
  };
}

interface MassPnRow {
  entityId: string;
  entityName: string;
  accountName: string;
  worksiteName: string;
  worksiteAddress: string;
  state: string;
  code: string;
  jobTitles: string[];
  periodGross: number;
  workers: number;
  annualEstimate: number;
  /** The REAL class code to request (dominant code the same titles carry in
   *  the entity's other rated states) — never 8040. Null = novel titles. */
  suggestedCode?: string | null;
  suggestedBasis?: string[];
  comparableRateMin?: number | null;
  comparableRateMax?: number | null;
}

/** One line of the add-coverage "order form": entity + state + the code to
 *  ask the carrier for, with dollars and comparable rates attached. */
interface CoverageAsk {
  entityId: string;
  entityName: string;
  state: string;
  suggestedCode: string | null;
  jobTitles: string[];
  periodGross: number;
  annualEstimate: number;
  workers: number;
  comparableRateMin: number | null;
  comparableRateMax: number | null;
}

interface CoverageData {
  startDate: string;
  endDate: string;
  entities: EntityCoverage[];
  summary: Record<string, number>;
  unverifiedCodes: Array<{ code: string; title: string; statesInUse: string[] }>;
  massPn: MassPnRow[];
  coverageAsks?: CoverageAsk[];
}

const GAP_SECTIONS: Array<{
  key: keyof EntityCoverage['gaps'];
  title: string;
  severity: 'error' | 'warning' | 'info';
  hint: string;
}> = [
  {
    key: 'statesNoPolicy',
    title: 'Payroll in states with NO policy on file',
    severity: 'error',
    hint: 'True coverage gap — work is running in a state with no workers’ comp policy record for this entity. Confirm with the broker, then add the policy on Settings → Workers’ Comp.',
  },
  {
    key: 'workedOutsidePolicyWindow',
    title: 'Work outside the policy’s effective window',
    severity: 'error',
    hint: 'A policy exists for the state but the work dates fall before its effective date or after its expiration — likely a lapsed renewal or a stale record.',
  },
  {
    key: 'unresolved',
    title: 'Unresolved payroll (no class code claims it)',
    severity: 'warning',
    hint: 'These dollars survive the whole resolution chain uncoded. Assign codes from the monthly WC report’s assign control.',
  },
  {
    key: 'placeholderCoverageNeeded',
    title: '8040 placeholder — carrier coverage needed',
    severity: 'warning',
    hint: 'Riding the placeholder with no real code in the matrix for the state/title — the carrier must add the classification.',
  },
  {
    key: 'placeholderReplaceNow',
    title: '8040 placeholder — replace now (we have the code)',
    severity: 'info',
    hint: 'The matrix already has a real code for this state/title — reassign to clear.',
  },
  {
    key: 'ratesMissing',
    title: 'Class code used with no rate on file',
    severity: 'warning',
    hint: 'Premium is not computable for these dollars until the rate lands in the matrix (key = STATE_code).',
  },
];

const WcCoveragePage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [startDate, setStartDate] = useState(daysAgoIso(90));
  const [endDate, setEndDate] = useState(todayIso());
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getWorkersCompMonthlyReport');
      const res = await fn({ tenantId, coverage: true, startDate, endDate });
      setData(res.data as CoverageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId, startDate, endDate]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /**
   * InSource "Mass Prospect Notification" export (Greg 2026-08-25): the
   * carrier's exact 24-column intake sheet, one row per worksite needing
   * coverage — pre-filled from the carrier-ask gap cohorts (no-policy
   * states, outside-window work, 8040 coverage-needed). Headers are copied
   * VERBATIM from their template, line breaks included. Exposure flags
   * default "No" per past submissions; review before sending.
   */
  /** Per-entity Mass PN workbooks — shared by the Export download and the
   *  "Submit to Eddie" email so both produce byte-identical files. */
  const buildMassPnWorkbooks = async (): Promise<
    Array<{
      entityName: string;
      filename: string;
      wb: ReturnType<(typeof import('xlsx'))['utils']['book_new']>;
      xlsx: typeof import('xlsx');
    }>
  > => {
    if (!data || data.massPn.length === 0) return [];
    const XLSX = await import('xlsx');
    const HEADERS = [
      'Your Staffing Company Name  ',
      'Contact Name',
      'Email',
      'Phone',
      '',
      'Your Client/Prospect Name',
      'Address',
      'City',
      'State',
      'Zip',
      'Project/Worksite Address \n(if different than Mailing Address)',
      'Client Business Description',
      'Job Description',
      'Class Code State',
      'Class Code',
      'Annual Payroll Estimated',
      'Group Transportation          (Yes or No)',
      'Trenching or Excavation (Yes or No)',
      'Height Exposure Above Ground Level (Yes or No)',
      'Chemical Exposure (Yes or No)',
      'Machinery Exposure (Yes or No)',
      'Respirators or Dust Mask (Yes or No)',
      'Airborne/Bloodborn Exposure (Yes or No)',
      'Notes \n(COI or Endorsement Needs, Wording Specifics, etc...) ',
    ];
    // One FILE per entity (Greg 2026-09-05): each entity is its own InSource
    // client with its own policy — the carrier gets a separate request per
    // entity, so a combined sheet would just need manual splitting.
    const byEntity = new Map<string, typeof data.massPn>();
    for (const r of data.massPn) {
      if (!byEntity.has(r.entityId)) byEntity.set(r.entityId, []);
      byEntity.get(r.entityId)!.push(r);
    }
    const out: Array<{ entityName: string; filename: string; wb: ReturnType<typeof XLSX.utils.book_new>; xlsx: typeof XLSX }> = [];
    for (const entityRows of byEntity.values()) {
      const entityName = entityRows[0].entityName;
      const rows: (string | number)[][] = [HEADERS];
      entityRows.forEach((r, i) => {
        rows.push([
        // A-D fill once (their sample pattern).
        i === 0 ? 'C1 Staffing LLC' : '',
        i === 0 ? 'Greg Fielding' : '',
        i === 0 ? 'g.fielding@c1staffing.com' : '',
        i === 0 ? '925-448-0579' : '',
        '',
        r.accountName || '(fill in client)',
        '', // client mailing address — fill in
        '',
        '',
        '',
        [r.worksiteName, r.worksiteAddress].filter(Boolean).join(' — '),
        '', // client business description — fill in
        r.jobTitles.length ? r.jobTitles.join(', ') : '',
        r.state,
        // Ask for the REAL code — 8040 is our placeholder, not a requestable
        // classification (Greg 2026-09-05).
        r.suggestedCode || (r.code && r.code !== '8040' ? r.code : '(needs classification)'),
        r.annualEstimate,
        'No',
        'No',
        'No',
        'No',
        'No',
        'No',
        'No',
        [
          `Est. annualized from ${usd(r.periodGross)} over ${data.startDate}→${data.endDate} (${r.workers} workers, ${r.entityName})`,
          r.suggestedCode && (r.suggestedBasis?.length ?? 0) > 0
            ? `Code ${r.suggestedCode} suggested from titles rated elsewhere on our policy: ${(r.suggestedBasis ?? []).join(', ')}`
            : '',
          r.comparableRateMin != null
            ? `Comparable rate on existing policy states: ${r.comparableRateMin}${r.comparableRateMax != null && r.comparableRateMax !== r.comparableRateMin ? `–${r.comparableRateMax}` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join('. '),
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = HEADERS.map((h, i) => ({
        wch: Math.max(h.split('\n')[0].length, ...rows.slice(1).map((r2) => String(r2[i] ?? '').length), 6) + 2,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Mass PN');
      out.push({
        entityName,
        filename: `Mass-Prospect-Notification_${entityName.replace(/\s+/g, '-')}_${data.startDate}_to_${data.endDate}.xlsx`,
        wb,
        xlsx: XLSX,
      });
    }
    return out;
  };

  const exportMassPn = async (): Promise<void> => {
    for (const f of await buildMassPnWorkbooks()) {
      f.xlsx.writeFile(f.wb, f.filename);
    }
  };

  /** One email per entity to the InSource coverage contact, same file as the
   *  export (Greg 2026-09-05). The send happens server-side via the connected
   *  Gmail mailbox, books-gated. */
  const submitToEddie = async (): Promise<void> => {
    if (!data || submitting) return;
    const files = await buildMassPnWorkbooks();
    if (files.length === 0) return;
    const ok = window.confirm(
      `Email ${files.length} coverage request${files.length > 1 ? 's' : ''} to Eddie (eddiem@insourcees.com)?\n\n` +
        files.map((f) => `• ${f.entityName} — ${f.filename}`).join('\n'),
    );
    if (!ok) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const fn = httpsCallable(functions, 'getWorkersCompMonthlyReport');
      const sent: string[] = [];
      for (const f of files) {
        const xlsxBase64 = f.xlsx.write(f.wb, { type: 'base64', bookType: 'xlsx' }) as string;
        await fn({
          tenantId,
          emailMassPn: { entityName: f.entityName, filename: f.filename, xlsxBase64 },
        });
        sent.push(f.entityName);
      }
      setSubmitResult(`Sent to Eddie: ${sent.join(', ')}`);
    } catch (e) {
      setSubmitResult(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const s = data?.summary ?? {};
  const exposureGross = Number(s.statesNoPolicyGross ?? 0) + Number(s.outsidePolicyWindowGross ?? 0);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center">
            <GppMaybeOutlinedIcon />
            <span>WC Coverage Gaps</span>
          </Stack>
        }
        subtitle="Where we're missing workers' comp coverage — every gap type with the dollars attached."
      />

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
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
        <Button variant="contained" size="small" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void load()}>
          Run
        </Button>
        <Tooltip
          title={
            data && data.massPn.length > 0
              ? `${data.massPn.length} worksite rows needing carrier coverage — one file per entity, InSource's exact intake format`
              : 'No carrier-ask rows in this window'
          }
        >
          <span>
            <Button
              variant="outlined"
              size="small"
              disabled={loading || !data || data.massPn.length === 0}
              onClick={() => void exportMassPn()}
            >
              Export Mass PN (InSource)
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Email one Mass PN file per entity to Eddie at InSource (eddiem@insourcees.com), from your connected mailbox — same files as the export.">
          <span>
            <Button
              variant="contained"
              color="warning"
              size="small"
              disabled={loading || submitting || !data || data.massPn.length === 0}
              onClick={() => void submitToEddie()}
            >
              {submitting ? 'Sending…' : 'Submit to Eddie'}
            </Button>
          </span>
        </Tooltip>
        {submitResult && (
          <Typography variant="caption" color={submitResult.startsWith('Send failed') ? 'error' : 'success.main'}>
            {submitResult}
          </Typography>
        )}
        {data && (
          <Typography variant="caption" color="text.secondary">
            {data.startDate} → {data.endDate}
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && data && (
        <>
          {/* Headline exposure */}
          <Stack direction="row" spacing={1.5} sx={{ mb: 3, flexWrap: 'wrap' }} useFlexGap>
            <Card variant="outlined" sx={{ minWidth: 210, borderColor: exposureGross > 0 ? 'error.main' : 'divider' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">
                  COVERAGE EXPOSURE (no policy / outside window)
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: exposureGross > 0 ? 'error.main' : 'success.main' }}>
                  {usd(exposureGross)}
                </Typography>
              </CardContent>
            </Card>
            {[
              ['Unresolved', s.unresolvedGross],
              ['8040 needs carrier', s.placeholderCoverageNeededGross],
              ['8040 fixable now', s.placeholderReplaceNowGross],
              ['Rate missing', s.ratesMissingGross],
              ['No work state', s.noStateGross],
            ].map(([label, v]) => (
              <Card key={String(label)} variant="outlined" sx={{ minWidth: 150 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">
                    {String(label).toUpperCase()}
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {usd(v)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
            <Card variant="outlined" sx={{ minWidth: 170 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">
                  UNCODED LIVE ASSIGNMENTS
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {Number(s.uncodedLiveAssignments ?? 0).toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  next cycle&apos;s uncoded payroll
                </Typography>
              </CardContent>
            </Card>
          </Stack>

          {/* The add-coverage order form (Greg 2026-09-05): what to ASK the
              carrier for — real class codes suggested from the same titles
              rated elsewhere on the entity's own policy, never 8040. */}
          {(data.coverageAsks?.length ?? 0) > 0 && (
            <Card variant="outlined" sx={{ mb: 3, borderColor: 'warning.main' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                  What to ask the carrier for
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Carrier-ask payroll grouped by entity + state + the class code to request. Codes are
                  suggested from the same job titles already rated on the entity&apos;s policy in other
                  states; the rate range shows what that code costs where it&apos;s already covered. The
                  Mass PN export uses these codes.
                </Typography>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Entity</TableCell>
                        <TableCell>State</TableCell>
                        <TableCell>Ask for code</TableCell>
                        <TableCell>Job titles</TableCell>
                        <TableCell align="right">Period gross</TableCell>
                        <TableCell align="right">Annual est.</TableCell>
                        <TableCell align="right">Workers</TableCell>
                        <TableCell align="right">Comparable rate</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(data.coverageAsks ?? []).map((a) => (
                        <TableRow key={`${a.entityId}_${a.state}_${a.suggestedCode ?? 'none'}`}>
                          <TableCell>{a.entityName}</TableCell>
                          <TableCell>{a.state}</TableCell>
                          <TableCell>
                            {a.suggestedCode ? (
                              <Chip size="small" color="warning" variant="outlined" label={a.suggestedCode} sx={{ fontWeight: 700 }} />
                            ) : (
                              <Chip size="small" variant="outlined" label="needs classification" />
                            )}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 320 }}>
                            <Typography variant="caption">{a.jobTitles.join(', ') || '—'}</Typography>
                          </TableCell>
                          <TableCell align="right">{usd(a.periodGross)}</TableCell>
                          <TableCell align="right">{usd(a.annualEstimate)}</TableCell>
                          <TableCell align="right">{a.workers}</TableCell>
                          <TableCell align="right">
                            {a.comparableRateMin != null
                              ? a.comparableRateMax != null && a.comparableRateMax !== a.comparableRateMin
                                ? `${a.comparableRateMin}–${a.comparableRateMax}`
                                : String(a.comparableRateMin)
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          )}

          {data.entities.map((ent) => {
            const gapSections = GAP_SECTIONS.map((sec) => ({
              ...sec,
              rows: ent.gaps[sec.key] as GapRow[],
            })).filter((sec) => Array.isArray(sec.rows) && sec.rows.length > 0);
            const noState = ent.gaps.noState;
            const liveUncoded = ent.gaps.uncodedLiveAssignments;
            const clean =
              gapSections.length === 0 && noState.gross === 0 && liveUncoded.count === 0;
            return (
              <Card key={ent.entityId} variant="outlined" sx={{ mb: 2.5 }}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {ent.name}
                    </Typography>
                    {ent.isContractor && (
                      <Tooltip title="1099 entity — WC never rides the payroll wire, but C1 pays the premium, so classification still matters.">
                        <Chip size="small" variant="outlined" label="1099" />
                      </Tooltip>
                    )}
                    {!ent.hasAnyPolicy && (
                      <Chip size="small" color="error" label="NO POLICY RECORDS AT ALL" />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {usd(ent.total.gross)} gross · {ent.total.workers} workers ·{' '}
                      {ent.workedStates.length} states worked · policies on file:{' '}
                      {ent.policyStates.length ? ent.policyStates.join(', ') : 'none'}
                    </Typography>
                    {clean && <Chip size="small" color="success" label="No gaps" />}
                  </Stack>

                  {gapSections.map((sec) => (
                    <Box key={String(sec.key)} sx={{ mb: 1.5 }}>
                      <Alert severity={sec.severity} icon={false} sx={{ py: 0.25, mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {sec.title} —{' '}
                          {usd(sec.rows.reduce((t, r) => t + r.gross, 0))}
                        </Typography>
                        <Typography variant="caption">{sec.hint}</Typography>
                      </Alert>
                      <TableContainer sx={{ maxHeight: 240 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell>State / key</TableCell>
                              <TableCell align="right">Gross</TableCell>
                              <TableCell align="right">Hours</TableCell>
                              <TableCell align="right">Entries</TableCell>
                              <TableCell align="right">Workers</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {sec.rows.map((r) => (
                              <TableRow key={r.key}>
                                <TableCell>{r.key}</TableCell>
                                <TableCell align="right">{usd(r.gross)}</TableCell>
                                <TableCell align="right">{r.hours.toLocaleString()}</TableCell>
                                <TableCell align="right">{r.entries.toLocaleString()}</TableCell>
                                <TableCell align="right">{r.workers.toLocaleString()}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  ))}

                  {noState.gross > 0 && (
                    <Alert severity="warning" icon={false} sx={{ py: 0.25, mb: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Payroll with no work state — {usd(noState.gross)} ({noState.entries} entries,{' '}
                        {noState.workers} workers)
                      </Typography>
                      <Typography variant="caption">
                        Can&apos;t be classified or matched to a policy until a state lands on the
                        entry (or its import sidecar).
                      </Typography>
                    </Alert>
                  )}

                  {liveUncoded.count > 0 && (
                    <Alert severity="info" icon={false} sx={{ py: 0.25 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {liveUncoded.count} live assignments with no WC code
                      </Typography>
                      <Typography variant="caption">
                        {Object.entries(liveUncoded.byState)
                          .sort((a, b) => b[1] - a[1])
                          .map(([st, n]) => `${st}: ${n}`)
                          .join(' · ')}{' '}
                        — these become uncoded payroll next cycle. Fix on the assignment or via the
                        monthly report&apos;s assign control.
                      </Typography>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {data.unverifiedCodes.length > 0 && (
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Class-catalog codes not yet verified ({data.unverifiedCodes.length})
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {data.unverifiedCodes
                    .map((c) => `${c.code}${c.title ? ` (${c.title})` : ''}`)
                    .join(' · ')}{' '}
                  — review on Settings → WC Class Codes.
                </Typography>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Box>
  );
};

export default WcCoveragePage;
