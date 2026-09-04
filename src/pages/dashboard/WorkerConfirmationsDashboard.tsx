/**
 * Worker Confirmations dashboard (Daniel Sanchez's idea, built 2026-09-04).
 *
 * The day-before confirmation FLOW already exists — the gig cadence sends
 * the T-24h confirmation ask, escalates while silent, re-confirms at T-4h,
 * and the T+30m probe flips silent workers to no_show — all recorded on
 * `assignment.cortConfirmation.state`. This page is the missing recruiter
 * view: every worker scheduled in the next few days with their confirmation
 * status, pending-first, so a recruiter with 20+ scheduled only chases the
 * silent ones.
 *
 * Rendered as the recruiter's `/dashboard` when their user doc carries
 * `recruiterDashboard: { variant: 'worker_confirmations', title, companyMatch }`
 * (Greg 2026-09-04: Deborah → Sodexo, Daniel → Indeed Flex).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import PageHeader from '../../components/PageHeader';

type ConfirmationStatus = 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';

const STATUS_META: Record<
  ConfirmationStatus,
  { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  pending: { label: 'Pending', color: 'warning' },
  confirmed: { label: 'Confirmed', color: 'success' },
  checked_in: { label: 'On site', color: 'info' },
  cancelled: { label: 'Unable to attend', color: 'error' },
  no_show: { label: 'No-show', color: 'error' },
};

const STATUS_SORT: Record<ConfirmationStatus, number> = {
  pending: 0,
  no_show: 1,
  cancelled: 2,
  confirmed: 3,
  checked_in: 4,
};

/** Assignment lifecycle statuses that mean "this worker is scheduled". */
const SCHEDULED_STATUSES = new Set(['confirmed', 'active', 'accepted', 'scheduled']);

interface RowModel {
  assignmentId: string;
  userId: string;
  workerName: string;
  phone: string;
  jobTitle: string;
  worksite: string;
  companyName: string;
  startDate: string;
  startTime: string;
  status: ConfirmationStatus;
  respondedAt: string | null;
}

function normStatus(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function toShortTime(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || '—';
}

function fmtRespondedAt(cort: Record<string, unknown> | undefined): string | null {
  const ts =
    (cort?.confirmedAt as { toDate?: () => Date } | undefined) ??
    (cort?.cancelledAt as { toDate?: () => Date } | undefined) ??
    (cort?.updatedAt as { toDate?: () => Date } | undefined);
  if (!ts || typeof ts.toDate !== 'function') return null;
  try {
    return ts.toDate().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

const WorkerConfirmationsDashboard: React.FC<{
  tenantId: string;
  title: string;
  /** Lowercase substrings matched against companyName; empty = all accounts. */
  companyMatch: string[];
  /** How many days ahead to include (default 3, today inclusive). */
  daysAhead?: number;
}> = ({ tenantId, title, companyMatch, daysAhead = 3 }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RowModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const toDate = new Date(today.getTime() + daysAhead * 24 * 3600 * 1000);
      const to = toDate.toISOString().slice(0, 10);
      const snap = await getDocs(
        query(
          collection(db, `tenants/${tenantId}/assignments`),
          where('startDate', '>=', from),
          where('startDate', '<=', to),
        ),
      );
      const matches = companyMatch.map((m) => m.toLowerCase()).filter(Boolean);
      const raw = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
        .filter(({ data }) => {
          const st = normStatus(data.status ?? data.normalizedStatus);
          if (st && !SCHEDULED_STATUSES.has(st)) return false;
          if (matches.length === 0) return true;
          const co = String(data.companyName ?? data.companyTitle ?? '').toLowerCase();
          return matches.some((m) => co.includes(m));
        });

      // Worker names/phones — batch fetch the user docs in chunks of 30.
      const uids = Array.from(
        new Set(
          raw
            .map(({ data }) => String(data.userId ?? data.candidateId ?? '').trim())
            .filter(Boolean),
        ),
      );
      const userMap = new Map<string, { name: string; phone: string }>();
      for (let i = 0; i < uids.length; i += 30) {
        const chunk = uids.slice(i, i + 30);
        const usnap = await getDocs(
          query(collection(db, 'users'), where(documentId(), 'in', chunk)),
        );
        usnap.docs.forEach((u) => {
          const x = u.data() as Record<string, unknown>;
          userMap.set(u.id, {
            name:
              [x.firstName, x.lastName].filter(Boolean).join(' ').trim() ||
              String(x.displayName ?? ''),
            phone: String(x.phone ?? x.phoneNumber ?? ''),
          });
        });
      }

      const models: RowModel[] = raw.map(({ id, data }) => {
        const uid = String(data.userId ?? data.candidateId ?? '').trim();
        const u = userMap.get(uid);
        const cort = (data.cortConfirmation ?? undefined) as
          | Record<string, unknown>
          | undefined;
        const cortState = normStatus(cort?.state);
        const status: ConfirmationStatus =
          cortState === 'confirmed'
            ? 'confirmed'
            : cortState === 'checked_in'
              ? 'checked_in'
              : cortState === 'cancelled'
                ? 'cancelled'
                : cortState === 'no_show'
                  ? 'no_show'
                  : 'pending';
        return {
          assignmentId: id,
          userId: uid,
          workerName:
            u?.name ||
            String(data.workerName ?? '').trim() ||
            [data.firstName, data.lastName].filter(Boolean).join(' ') ||
            'Unknown worker',
          phone: u?.phone ?? '',
          jobTitle: String(data.jobTitle ?? '').trim() || '—',
          worksite: String(
            data.worksiteDisplayName ?? data.worksiteName ?? '',
          ).trim(),
          companyName: String(data.companyName ?? '').trim(),
          startDate: String(data.startDate ?? ''),
          startTime: toShortTime(data.startTime),
          status,
          respondedAt: fmtRespondedAt(cort),
        };
      });

      models.sort((a, b) => {
        if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
        if (STATUS_SORT[a.status] !== STATUS_SORT[b.status])
          return STATUS_SORT[a.status] - STATUS_SORT[b.status];
        return a.workerName.localeCompare(b.workerName);
      });
      setRows(models);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [tenantId, companyMatch.join('|'), daysAhead]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<ConfirmationStatus, number> = {
      pending: 0,
      confirmed: 0,
      checked_in: 0,
      cancelled: 0,
      no_show: 0,
    };
    rows.forEach((r) => {
      c[r.status]++;
    });
    return c;
  }, [rows]);

  const byDate = useMemo(() => {
    const m = new Map<string, RowModel[]>();
    rows.forEach((r) => {
      const list = m.get(r.startDate) ?? [];
      list.push(r);
      m.set(r.startDate, list);
    });
    return Array.from(m.entries());
  }, [rows]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      <PageHeader
        title={title}
        subtitle={
          <Typography variant="body2" color="text.secondary">
            Everyone scheduled today through the next {daysAhead} days, with their
            day-before confirmation status. Chase the Pending rows — Confirmed and
            On&nbsp;site are handled.
          </Typography>
        }
      />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
        {(Object.keys(STATUS_META) as ConfirmationStatus[]).map((s) => (
          <Chip
            key={s}
            size="small"
            color={counts[s] > 0 ? STATUS_META[s].color : 'default'}
            variant={counts[s] > 0 ? 'filled' : 'outlined'}
            label={`${STATUS_META[s].label}: ${counts[s]}`}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : rows.length === 0 ? (
        <Alert severity="info">
          No upcoming assignments match this dashboard&apos;s scope
          {companyMatch.length ? ` (${companyMatch.join(', ')})` : ''}. As soon as
          workers are scheduled here, they&apos;ll appear with their confirmation
          status.
        </Alert>
      ) : (
        byDate.map(([date, list]) => (
          <Box key={date} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                · {list.length} scheduled
              </Typography>
            </Typography>
            <TableContainer component={Paper} elevation={0} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'grey.100' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Job</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Worksite</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Start</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Responded</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.map((r) => (
                    <TableRow
                      key={r.assignmentId}
                      hover
                      sx={{ cursor: r.userId ? 'pointer' : 'default' }}
                      onClick={() => r.userId && navigate(`/users/${r.userId}`)}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.workerName}
                        </Typography>
                        {r.companyName ? (
                          <Typography variant="caption" color="text.secondary">
                            {r.companyName}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {r.phone ? (
                          <Link href={`tel:${r.phone}`} underline="hover" variant="body2">
                            {r.phone}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{r.jobTitle}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {r.worksite || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{r.startTime}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={STATUS_META[r.status].color}
                          label={STATUS_META[r.status].label}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {r.respondedAt ?? '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))
      )}
    </Box>
  );
};

export default WorkerConfirmationsDashboard;
