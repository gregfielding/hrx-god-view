/**
 * /reports/interview-metrics — INT-1 (Greg 2026-08-30).
 *
 * AI prescreen funnel: invited → started → completed → passed, drop-off by
 * question, splits by job order and invite channel. First report in the
 * "Usage & metrics" section.
 *
 * Data: backfillPrescreenCategoryScores callable, mode 'interviewMetrics'
 * (read-only aggregation; mode-flag convention). Honesty notes: "started"
 * tracking begins 2026-08-30 (session instrumentation ship date), and bank
 * auto-completes are bucketed apart so repeat applicants don't flatter the
 * funnel.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
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
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

interface MetricsPayload {
  range: { startMs: number; endMs: number };
  invites: {
    firstInvites: number;
    chase1: number;
    chase2: number;
    uniqueUsersInvited: number;
    byDay: Record<string, number>;
    error?: string;
  };
  started: { sessions: number; byDay: Record<string, number>; trackingSince: string; error?: string };
  completed: {
    total: number;
    humanCompleted: number;
    autoCompletedFromBank: number;
    avgScore10: number | null;
    byDay: Record<string, number>;
  };
  passed: { proceed: number; review: number; decline: number; other: number };
  dropOff: Array<{ stepId: string; count: number }>;
  byJobOrder: Array<{
    jobOrderId: string;
    jobOrderName: string | null;
    completed: number;
    proceed: number;
    avgScore10: number | null;
  }>;
  byEntry: Array<{ entry: string; completed: number; proceed: number }>;
}

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

const pct = (num: number, den: number): string =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : '—';

const FunnelStage: React.FC<{
  label: string;
  value: number;
  ofPrev?: { prev: number };
  note?: string;
}> = ({ label, value, ofPrev, note }) => (
  <Paper variant="outlined" sx={{ p: 2, minWidth: 150, flex: 1 }}>
    <Typography variant="overline" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="h4">{value.toLocaleString()}</Typography>
    {ofPrev && (
      <Typography variant="body2" color="text.secondary">
        {pct(value, ofPrev.prev)} of previous stage
      </Typography>
    )}
    {note && (
      <Typography variant="caption" color="text.secondary">
        {note}
      </Typography>
    )}
  </Paper>
);

const InterviewMetricsPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'backfillPrescreenCategoryScores', { timeout: 300000 });
      const res = await fn({
        mode: 'interviewMetrics',
        tenantId,
        startMs: new Date(`${startDate}T00:00:00`).getTime(),
        endMs: new Date(`${endDate}T23:59:59`).getTime(),
      });
      const payload = (res.data as { interviewMetrics?: MetricsPayload })?.interviewMetrics;
      if (!payload) throw new Error('Empty response');
      setData(payload);
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

  const funnel = useMemo(() => {
    if (!data) return null;
    return {
      invited: data.invites.uniqueUsersInvited,
      started: data.started.sessions,
      completed: data.completed.humanCompleted,
      passed: data.passed.proceed,
    };
  }, [data]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center">
            <QueryStatsOutlinedIcon />
            <span>Interview Metrics</span>
          </Stack>
        }
        subtitle="AI prescreen funnel — invited, started, completed, passed — and where workers drop off."
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
        <Button variant="contained" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Run'}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && !data && (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      )}

      {data && funnel && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 1 }}>
            <FunnelStage label="Invited (unique workers)" value={funnel.invited} />
            <FunnelStage
              label="Started"
              value={funnel.started}
              ofPrev={{ prev: funnel.invited }}
              note={`tracking since ${data.started.trackingSince}`}
            />
            <FunnelStage
              label="Completed"
              value={funnel.completed}
              ofPrev={{ prev: funnel.started || funnel.invited }}
              note="human interviews — bank auto-completes excluded"
            />
            <FunnelStage
              label="Passed"
              value={funnel.passed}
              ofPrev={{ prev: funnel.completed }}
              note='engine "proceed" — auto-hire gates are stricter'
            />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={`First invites sent: ${data.invites.firstInvites}`} />
            <Chip size="small" label={`Chase 1: ${data.invites.chase1}`} />
            <Chip size="small" label={`Chase 2: ${data.invites.chase2}`} />
            <Chip
              size="small"
              label={`Auto-completed from answer bank: ${data.completed.autoCompletedFromBank}`}
            />
            {data.completed.avgScore10 != null && (
              <Chip size="small" label={`Avg score: ${data.completed.avgScore10}/10`} />
            )}
            <Chip
              size="small"
              label={`Recommendations — proceed ${data.passed.proceed} · review ${data.passed.review} · decline ${data.passed.decline}`}
            />
          </Stack>

          {(data.invites.error || data.started.error) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {data.invites.error && <>Invite counts unavailable: {data.invites.error} </>}
              {data.started.error && <>Started counts unavailable: {data.started.error}</>}
              {' — the backing index may still be building; retry shortly.'}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
            <Paper variant="outlined" sx={{ p: 2, flex: 1, width: '100%' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Drop-off by question
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Workers with a saved session, no submission — grouped by the last question they
                were on. Populates as save/resume data accrues (since {data.started.trackingSince}).
              </Typography>
              {data.dropOff.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No abandoned sessions in range.
                </Typography>
              ) : (
                <Table size="small">
                  <TableBody>
                    {data.dropOff.slice(0, 12).map((r) => (
                      <TableRow key={r.stepId}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.stepId}</TableCell>
                        <TableCell align="right">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, flex: 1.4, width: '100%' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                By job order
              </Typography>
              <TableContainer sx={{ maxHeight: 420 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Job order</TableCell>
                      <TableCell align="right">Completed</TableCell>
                      <TableCell align="right">Proceed</TableCell>
                      <TableCell align="right">Avg score</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byJobOrder.map((r) => (
                      <TableRow key={r.jobOrderId} hover>
                        <TableCell>
                          <Tooltip title={r.jobOrderId}>
                            <span>{r.jobOrderName ?? r.jobOrderId}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">{r.completed}</TableCell>
                        <TableCell align="right">
                          {r.proceed} ({pct(r.proceed, r.completed)})
                        </TableCell>
                        <TableCell align="right">{r.avgScore10 ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {data.byJobOrder.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No job-order-linked interviews in range (profile-first interviews carry
                            no job order).
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, flex: 1, width: '100%' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                By invite channel
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Channel</TableCell>
                    <TableCell align="right">Completed</TableCell>
                    <TableCell align="right">Proceed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byEntry.map((r) => (
                    <TableRow key={r.entry}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{r.entry}</TableCell>
                      <TableCell align="right">{r.completed}</TableCell>
                      <TableCell align="right">{r.proceed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        </>
      )}
    </Box>
  );
};

export default InterviewMetricsPage;
