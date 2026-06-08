/**
 * Section on /readiness/employee-readiness — "Workers Bypassed at Headshot Gate".
 *
 * Surfaces workers whose `respondToAssignment` was rejected by the
 * Accept-flow headshot gate (avatarVerification.status != 'approved')
 * and whom a recruiter then confirmed manually via
 * `confirmAssignmentForWorker`. The bypass stamp lives on the assignment
 * doc at `headshotBypass.{at, byUid, reason, avatarStatus}` (written by
 * `placementsApi.ts:confirmAssignmentForWorker` when the worker would
 * have failed the gate).
 *
 * Why this is a list and not an alert: the bypass is a legitimate
 * recruiter override, but it leaves the underlying blocker in place —
 * the next placement for the same worker will hit the same gate. This
 * surface lets the team proactively approve/reupload headshots so
 * future self-confirmations work.
 *
 * A row drops off the list automatically when the worker's
 * `avatarVerification.status` becomes 'approved'.
 *
 * **Scoping note**: tenant-wide, last 30 days of confirms, capped at 500
 * to keep the query bounded. If a tenant ever exceeds that, we'll add an
 * index + paginated query — for now, alert+cap keeps the page snappy.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { collection, getDoc, getDocs, doc, limit, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';

export interface HeadshotBypassesSectionProps {
  tenantId: string | null;
  /** Optional — when set, filter to assignments confirmed by these recruiters only. */
  scopeRecruiterUids?: string[];
}

interface BypassRow {
  assignmentId: string;
  workerUid: string;
  workerName: string;
  workerCity?: string;
  workerState?: string;
  bypassedAt: number; // ms since epoch — null sinks to bottom
  recruiterUid: string;
  recruiterName?: string;
  /** Current status on the user doc (may differ from `bypassReason` if the worker has since uploaded). */
  currentAvatarStatus: 'approved' | 'pending' | 'rejected' | 'error' | 'missing';
  bypassReason: string | null;
  jobOrderId?: string;
  jobTitle?: string;
}

const HEADER_CELL_SX = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  color: 'text.secondary',
  letterSpacing: 0.4,
};
const CELL_SX = { fontSize: 13, py: 1 };

function statusChipColor(s: BypassRow['currentAvatarStatus']): 'warning' | 'error' | 'default' {
  if (s === 'pending') return 'warning';
  if (s === 'approved') return 'default';
  return 'error';
}

function relativeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const elapsed = Date.now() - ms;
  if (elapsed < 0) return 'just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const HeadshotBypassesSection: React.FC<HeadshotBypassesSectionProps> = ({
  tenantId,
  scopeRecruiterUids,
}) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BypassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Query assignments confirmed by a recruiter ('recruiter_manual'),
        // capped at 500 most-recent. This is a single equality, no orderBy,
        // so no composite index needed.
        const q = query(
          collection(db, 'tenants', tenantId, 'assignments'),
          where('confirmedBySource', '==', 'recruiter_manual'),
          limit(500),
        );
        const snap = await getDocs(q);
        const candidates: Array<{ id: string; data: any }> = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data?.headshotBypass) candidates.push({ id: d.id, data });
        });
        // Dedupe by userId — only show the most recent bypass per worker
        const latestByUser = new Map<string, { id: string; data: any }>();
        for (const c of candidates) {
          const uid = String(c.data?.userId || c.data?.candidateId || '');
          if (!uid) continue;
          if (scopeRecruiterUids && scopeRecruiterUids.length > 0) {
            const byUid = String(c.data?.headshotBypass?.byUid || '');
            if (!scopeRecruiterUids.includes(byUid)) continue;
          }
          const at = c.data?.headshotBypass?.at?.toMillis?.() ?? 0;
          const prior = latestByUser.get(uid);
          const priorAt = prior?.data?.headshotBypass?.at?.toMillis?.() ?? 0;
          if (!prior || at > priorAt) latestByUser.set(uid, c);
        }
        // Fetch each worker's current avatarVerification + recruiter name in parallel.
        const workerUids = [...latestByUser.keys()];
        const recruiterUids = [
          ...new Set(
            [...latestByUser.values()]
              .map((c) => String(c.data?.headshotBypass?.byUid || ''))
              .filter(Boolean),
          ),
        ];
        const [workerSnaps, recruiterSnaps] = await Promise.all([
          Promise.all(workerUids.map((uid) => getDoc(doc(db, 'users', uid)).catch(() => null))),
          Promise.all(recruiterUids.map((uid) => getDoc(doc(db, 'users', uid)).catch(() => null))),
        ]);
        const recruiterNames = new Map<string, string>();
        recruiterUids.forEach((uid, idx) => {
          const r = recruiterSnaps[idx];
          if (!r?.exists()) return;
          const rd: any = r.data();
          recruiterNames.set(
            uid,
            String(rd.displayName || `${rd.firstName || ''} ${rd.lastName || ''}`.trim() || rd.email || uid),
          );
        });
        const next: BypassRow[] = [];
        workerUids.forEach((uid, idx) => {
          const candidate = latestByUser.get(uid)!;
          const userSnap = workerSnaps[idx];
          const ud: any = userSnap?.exists() ? userSnap.data() : {};
          const av = ud?.avatarVerification as { status?: string } | undefined;
          const hasAvatar = typeof ud?.avatar === 'string' && ud.avatar.trim().length > 0;
          const rawStatus = String(av?.status || '').toLowerCase();
          let currentAvatarStatus: BypassRow['currentAvatarStatus'];
          if (rawStatus === 'approved') currentAvatarStatus = 'approved';
          else if (rawStatus === 'pending' || rawStatus === 'rejected' || rawStatus === 'error') {
            currentAvatarStatus = rawStatus as BypassRow['currentAvatarStatus'];
          } else if (hasAvatar) currentAvatarStatus = 'pending';
          else currentAvatarStatus = 'missing';

          // Drop the row if the worker has since become approved — the blocker is cleared.
          if (currentAvatarStatus === 'approved') return;

          const recruiterUid = String(candidate.data?.headshotBypass?.byUid || '');
          next.push({
            assignmentId: candidate.id,
            workerUid: uid,
            workerName:
              String(candidate.data?.firstName || ud?.firstName || '') +
              ' ' +
              String(candidate.data?.lastName || ud?.lastName || ''),
            workerCity: ud?.addressInfo?.city || ud?.city || undefined,
            workerState: ud?.addressInfo?.state || ud?.state || undefined,
            bypassedAt: candidate.data?.headshotBypass?.at?.toMillis?.() ?? 0,
            recruiterUid,
            recruiterName: recruiterNames.get(recruiterUid),
            currentAvatarStatus,
            bypassReason: candidate.data?.headshotBypass?.reason || null,
            jobOrderId: candidate.data?.jobOrderId,
            jobTitle: candidate.data?.jobTitle,
          });
        });
        // Sort: missing first (worst), then rejected, then error, then pending; within each by most-recent bypass.
        const severity: Record<BypassRow['currentAvatarStatus'], number> = {
          missing: 0,
          rejected: 1,
          error: 2,
          pending: 3,
          approved: 9,
        };
        next.sort((a, b) => {
          const s = severity[a.currentAvatarStatus] - severity[b.currentAvatarStatus];
          if (s !== 0) return s;
          return b.bypassedAt - a.bypassedAt;
        });
        if (!cancelled) {
          setRows(next);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load headshot-bypass list');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, scopeRecruiterUids]);

  const counts = useMemo(() => {
    const c = { missing: 0, rejected: 0, pending: 0, error: 0 };
    for (const r of rows) {
      if (r.currentAvatarStatus !== 'approved') {
        (c as any)[r.currentAvatarStatus] = ((c as any)[r.currentAvatarStatus] ?? 0) + 1;
      }
    }
    return c;
  }, [rows]);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <VerifiedUserOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Workers Bypassed at Headshot Gate
        </Typography>
        {!loading && (
          <Chip
            size="small"
            label={`${rows.length} active`}
            color={rows.length > 0 ? 'warning' : 'default'}
            variant={rows.length > 0 ? 'filled' : 'outlined'}
            sx={{ fontWeight: 600 }}
          />
        )}
        {counts.missing > 0 && (
          <Chip size="small" color="error" label={`${counts.missing} no photo`} sx={{ fontWeight: 600 }} />
        )}
        {counts.rejected > 0 && (
          <Chip size="small" color="error" label={`${counts.rejected} rejected`} sx={{ fontWeight: 600 }} />
        )}
        {counts.pending > 0 && (
          <Chip size="small" color="warning" label={`${counts.pending} pending review`} sx={{ fontWeight: 600 }} />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        These workers tried to self-confirm a shift but were blocked by the headshot gate; a
        recruiter then manually confirmed for them. The underlying blocker is still in place — the
        worker can&apos;t self-confirm their next shift until their headshot is approved. Each row
        drops off automatically once the worker is approved.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        </Box>
      ) : rows.length === 0 ? (
        <Alert severity="success" variant="outlined" sx={{ mb: 1 }}>
          No active headshot-gate bypasses. Every worker who got past the gate via a recruiter has
          since been approved.
        </Alert>
      ) : (
        <TableContainer
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: 480,
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={HEADER_CELL_SX}>Worker</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Current status</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Bypassed by</TableCell>
                <TableCell sx={HEADER_CELL_SX}>When</TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  Open
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.assignmentId} hover>
                  <TableCell sx={CELL_SX}>
                    <Stack spacing={0.25}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {r.workerName.trim() || '(unknown)'}
                      </Typography>
                      {(r.workerCity || r.workerState) && (
                        <Typography variant="caption" color="text.secondary">
                          {[r.workerCity, r.workerState].filter(Boolean).join(', ')}
                        </Typography>
                      )}
                      {r.jobTitle && (
                        <Typography variant="caption" color="text.secondary">
                          {r.jobTitle}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell sx={CELL_SX}>
                    <Tooltip
                      title={
                        r.bypassReason
                          ? `At bypass: ${r.bypassReason} · Current: ${r.currentAvatarStatus}`
                          : `Current: ${r.currentAvatarStatus}`
                      }
                    >
                      <Chip
                        size="small"
                        color={statusChipColor(r.currentAvatarStatus)}
                        label={
                          r.currentAvatarStatus === 'missing'
                            ? 'No photo'
                            : r.currentAvatarStatus.charAt(0).toUpperCase() +
                              r.currentAvatarStatus.slice(1)
                        }
                        sx={{ fontWeight: 600 }}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={CELL_SX}>
                    <Typography variant="body2">{r.recruiterName || r.recruiterUid.slice(0, 8)}…</Typography>
                  </TableCell>
                  <TableCell sx={CELL_SX}>
                    <Tooltip title={new Date(r.bypassedAt).toLocaleString()}>
                      <Typography variant="body2">{relativeTime(r.bypassedAt)}</Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={CELL_SX} align="right">
                    <Tooltip title="Open worker profile to review/approve their headshot">
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/users/${r.workerUid}`)}
                        aria-label="Open worker profile"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default HeadshotBypassesSection;
