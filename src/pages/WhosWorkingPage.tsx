/**
 * Who's Working — the weekly assignment report (Phase 3a).
 *
 * Design contract (Greg, 2026-07-17 review): answer "who is assigned,
 * where, and for how many hours" for ANY week — last week for payroll
 * checks, this week and next for planning — in plain English with zero
 * configuration. Recruiters pick a week with arrows; everything else is
 * automatic.
 *
 * Data: the SAME resolver the Timesheets grid uses
 * (`resolveTimesheetGrid`, new `tenant_period` filter kind), so scheduled
 * hours here always agree with the payroll grid — one source of truth for
 * the weeklySchedule/open-shift expansion and the phantom-row filters.
 * Rows are grouped Account → Job Order → worker; per worker we show the
 * days they're scheduled, total scheduled hours, and actual hours where a
 * timesheet entry exists (past weeks). CSV-imported (Indeed Flex) worked
 * rows are included via the resolver's import leg, so portal-first crews
 * appear in the payroll view too.
 *
 * Money (pay × hours vs bill × hours, OT at 1.5× bill) is Phase 3b — this
 * page deliberately stays people + hours.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  Button,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  resolveTimesheetGrid,
  scheduledHoursForRow,
  actualHoursForRow,
  type TimesheetGridRow,
} from '../components/timesheets/timesheetGridResolver';
import {
  type PeriodRange,
  currentWeeklyPeriod,
  shiftWeeklyPeriod,
  eachDateInPeriod,
  formatWeekOfLabel,
  dowForIso,
  dowShortLabel,
  todayIsoLocal,
} from '../utils/timesheets/dateRange';

/* -------------------------------------------------------------------------
 * Aggregation
 * ------------------------------------------------------------------------- */

interface WorkerLine {
  workerId: string;
  workerName: string;
  /** ISO dates in the week the worker is scheduled/worked. */
  dates: Set<string>;
  scheduledHours: number;
  actualHours: number;
  hasEntries: boolean;
}

interface JobOrderGroup {
  jobOrderId: string;
  label: string;
  workers: Map<string, WorkerLine>;
  scheduledHours: number;
  actualHours: number;
}

interface AccountGroup {
  key: string;
  label: string;
  jobOrders: Map<string, JobOrderGroup>;
  workerIds: Set<string>;
  scheduledHours: number;
  actualHours: number;
}

interface JoNames {
  accountKey: string;
  accountLabel: string;
  joLabel: string;
}

function buildGroups(
  rows: TimesheetGridRow[],
  joNames: Map<string, JoNames>,
): AccountGroup[] {
  const accounts = new Map<string, AccountGroup>();
  for (const row of rows) {
    if (row.kind !== 'entry' && row.kind !== 'empty') continue;
    const joId = row.assignment.jobOrderId || '';
    const names = joId ? joNames.get(joId) : undefined;
    // Unmatched import rows have no JO — group them under their venue
    // name so imported crews are never silently dropped from the report.
    const accountKey =
      names?.accountKey ||
      (row.assignment.worksiteDisplayName
        ? `venue:${row.assignment.worksiteDisplayName}`
        : 'unknown');
    const accountLabel =
      names?.accountLabel || row.assignment.worksiteDisplayName || 'Unmatched';
    const joLabel = names?.joLabel || row.assignment.worksiteDisplayName || 'Job order';

    let account = accounts.get(accountKey);
    if (!account) {
      account = {
        key: accountKey,
        label: accountLabel,
        jobOrders: new Map(),
        workerIds: new Set(),
        scheduledHours: 0,
        actualHours: 0,
      };
      accounts.set(accountKey, account);
    }
    const joGroupKey = joId || accountKey;
    let jo = account.jobOrders.get(joGroupKey);
    if (!jo) {
      jo = {
        jobOrderId: joId,
        label: joLabel,
        workers: new Map(),
        scheduledHours: 0,
        actualHours: 0,
      };
      account.jobOrders.set(joGroupKey, jo);
    }

    const workerId = row.assignment.workerId || row.assignment.candidateId || row.key;
    let worker = jo.workers.get(workerId);
    if (!worker) {
      worker = {
        workerId,
        workerName: row.assignment.workerDisplayName || 'Worker',
        dates: new Set(),
        scheduledHours: 0,
        actualHours: 0,
        hasEntries: false,
      };
      jo.workers.set(workerId, worker);
    } else if (worker.workerName === 'Worker' && row.assignment.workerDisplayName) {
      worker.workerName = row.assignment.workerDisplayName;
    }

    const sched = scheduledHoursForRow(row);
    const actual = row.kind === 'entry' ? actualHoursForRow(row) : 0;
    worker.dates.add(row.workDate);
    worker.scheduledHours += sched;
    worker.actualHours += actual;
    if (row.kind === 'entry') worker.hasEntries = true;
    jo.scheduledHours += sched;
    jo.actualHours += actual;
    account.workerIds.add(workerId);
    account.scheduledHours += sched;
    account.actualHours += actual;
  }
  return Array.from(accounts.values()).sort((a, b) =>
    b.scheduledHours + b.actualHours - (a.scheduledHours + a.actualHours),
  );
}

function fmtHours(h: number): string {
  if (h <= 0) return '—';
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} hrs`;
}

/* -------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

const WhosWorkingPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodRange>(() => currentWeeklyPeriod(0, 6));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const isCurrentWeek = useMemo(() => {
    const now = currentWeeklyPeriod(0, 6);
    return now.start === period.start;
  }, [period]);
  const isPastWeek = useMemo(() => period.end < todayIsoLocal(), [period]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      // Entity ids feed the resolver's CSV-import leg (its composite
      // index is entity-scoped). Small list; loaded fresh per view.
      const entitiesSnap = await getDocs(collection(db, 'tenants', tenantId, 'entities'));
      const hiringEntityIds = entitiesSnap.docs.map((d) => d.id);

      const resolution = await resolveTimesheetGrid({
        fdb: db,
        tenantId,
        filter: {
          kind: 'tenant_period',
          periodStart: period.start,
          periodEnd: period.end,
          hiringEntityIds,
        },
      });

      // Name join: one JO read per unique job order in the result set.
      const joIds = new Set<string>();
      for (const r of resolution.rows) {
        if (r.assignment.jobOrderId) joIds.add(r.assignment.jobOrderId);
      }
      const joNames = new Map<string, JoNames>();
      await Promise.all(
        Array.from(joIds).map(async (joId) => {
          try {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', joId));
            if (!s.exists()) return;
            const jo = s.data() as Record<string, unknown>;
            const accountLabel = String(
              jo.companyName || jo.accountName || jo.parentAccountName || 'Account',
            );
            const joLabel = String(
              jo.jobOrderName || jo.jobTitle || jo.title || 'Job order',
            );
            joNames.set(joId, {
              accountKey: String(jo.companyId || jo.accountId || accountLabel),
              accountLabel,
              joLabel,
            });
          } catch {
            // Name-join miss just falls back to venue labels.
          }
        }),
      );

      setGroups(buildGroups(resolution.rows, joNames));
      setRowCount(resolution.rows.length);
      if (resolution.errors.length > 0) {
        // Non-fatal resolver warnings — surface the first so data gaps
        // are never silent, without burying the report under a wall.
        setError(resolution.errors[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekDates = useMemo(() => eachDateInPeriod(period), [period]);
  const totalWorkers = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const id of Array.from(g.workerIds)) ids.add(id);
    return ids.size;
  }, [groups]);
  const totalScheduled = groups.reduce((s, g) => s + g.scheduledHours, 0);
  const totalActual = groups.reduce((s, g) => s + g.actualHours, 0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Who's Working
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Everyone assigned for the week — by account, with their days and hours.
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton aria-label="Previous week" onClick={() => setPeriod((p) => shiftWeeklyPeriod(p, -1))}>
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="subtitle1" fontWeight={600} sx={{ minWidth: 170, textAlign: 'center' }}>
            {formatWeekOfLabel(period)}
          </Typography>
          <IconButton aria-label="Next week" onClick={() => setPeriod((p) => shiftWeeklyPeriod(p, 1))}>
            <ChevronRightIcon />
          </IconButton>
          {!isCurrentWeek && (
            <Tooltip title="Jump back to this week">
              <Button
                size="small"
                startIcon={<TodayIcon />}
                onClick={() => setPeriod(currentWeeklyPeriod(0, 6))}
              >
                This week
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* Week summary strip */}
      <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="h6" fontWeight={700}>{totalWorkers}</Typography>
            <Typography variant="caption" color="text.secondary">workers assigned</Typography>
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700}>{fmtHours(totalScheduled)}</Typography>
            <Typography variant="caption" color="text.secondary">scheduled</Typography>
          </Box>
          {isPastWeek && (
            <Box>
              <Typography variant="h6" fontWeight={700}>{fmtHours(totalActual)}</Typography>
              <Typography variant="caption" color="text.secondary">actually worked</Typography>
            </Box>
          )}
          <Box>
            <Typography variant="h6" fontWeight={700}>{groups.length}</Typography>
            <Typography variant="caption" color="text.secondary">accounts</Typography>
          </Box>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      ) : groups.length === 0 ? (
        <Paper variant="outlined" sx={{ mt: 2, p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Nobody is scheduled this week
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No assignments touch {formatWeekOfLabel(period)}. Use the arrows to check another week.
          </Typography>
        </Paper>
      ) : (
        groups.map((account) => (
          <Paper key={account.key} variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="subtitle1" fontWeight={700}>{account.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {account.workerIds.size} worker{account.workerIds.size === 1 ? '' : 's'} ·{' '}
                  {fmtHours(account.scheduledHours)} scheduled
                  {isPastWeek && account.actualHours > 0
                    ? ` · ${fmtHours(account.actualHours)} worked`
                    : ''}
                </Typography>
              </Stack>
            </Box>
            {Array.from(account.jobOrders.values()).map((jo) => (
              <Box key={jo.jobOrderId || jo.label} sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                  {jo.jobOrderId ? (
                    <Button
                      size="small"
                      sx={{ textTransform: 'none', fontWeight: 600, p: 0, minWidth: 0 }}
                      onClick={() => navigate(`/jobs/job-orders/${jo.jobOrderId}?tab=placements`)}
                    >
                      {jo.label}
                    </Button>
                  ) : (
                    <Typography variant="body2" fontWeight={600}>{jo.label}</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {fmtHours(jo.scheduledHours)} scheduled
                    {isPastWeek && jo.actualHours > 0 ? ` · ${fmtHours(jo.actualHours)} worked` : ''}
                  </Typography>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  {Array.from(jo.workers.values())
                    .sort((a, b) => a.workerName.localeCompare(b.workerName))
                    .map((w) => (
                      <Stack
                        key={w.workerId}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ py: 0.5 }}
                      >
                        <Typography variant="body2" sx={{ minWidth: 180 }}>
                          {w.workerName}
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          {weekDates.map((d) => {
                            const dow = dowForIso(d);
                            const on = w.dates.has(d);
                            return (
                              <Chip
                                key={d}
                                label={dow == null ? '?' : dowShortLabel(dow)}
                                size="small"
                                color={on ? 'primary' : 'default'}
                                variant={on ? 'filled' : 'outlined'}
                                sx={{ opacity: on ? 1 : 0.35, minWidth: 44 }}
                              />
                            );
                          })}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                          {isPastWeek && w.hasEntries && w.actualHours > 0
                            ? `${fmtHours(w.actualHours)} worked`
                            : `${fmtHours(w.scheduledHours)} scheduled`}
                        </Typography>
                      </Stack>
                    ))}
                </Box>
              </Box>
            ))}
          </Paper>
        ))
      )}

      {!loading && rowCount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Hours come from the same math as the Timesheets grid, so this report always matches payroll.
        </Typography>
      )}
    </Box>
  );
};

export default WhosWorkingPage;
