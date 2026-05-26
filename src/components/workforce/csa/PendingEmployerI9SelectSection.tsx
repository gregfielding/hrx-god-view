/**
 * Section 4 on /readiness/employee-readiness — "Pending Employer I-9
 * (C1 Select)".
 *
 * Surfaces every W-2 worker who's finished the worker portion of I-9
 * (Section 1 — signed inside Everee's onboarding flow) but is waiting
 * on HRX/the Onboarding Specialist to countersign the EMPLOYER portion
 * (Section 2). Federal deadline is 3 business days from hire, so this
 * is high-priority remediation work.
 *
 * **Source of truth: Everee.** The "worker has signed Section 1" signal
 * comes from the readinessMirror block on each `everee_workers/*`
 * linkage doc (`mirror.i9SignedAt`), which is populated by the
 * evereeReadinessMirror reconcile path against `GET /api/v2/workers/{id}`.
 * The Section 2 completion stamp lives on the HRX `entity_employments`
 * row (`i9Section2CompletedAt`) because that's where the recruiter
 * action is recorded.
 *
 * **Why this is just a thin filter on the existing queue hook**
 * (`useOnboardingSpecialistActionQueueItems`):
 *   - The hook already joins entity_employments + everee_workers +
 *     entities + users and produces `OnboardingSpecialistActionItem`
 *     rows of type `i9_section_2` exactly when this section needs.
 *   - The hook already honors `scope: 'mine' | 'all'` against
 *     `users.primaryRecruiterId` — same semantics the page-level
 *     toggle uses.
 *   - The Section 2 "mark complete" dialog
 *     (`I9Section2CompleteDialog`) is already built and wired to the
 *     callable that stamps `i9Section2CompletedAt`.
 *
 * The only thing missing was a place to surface those items on
 * `/readiness/employee-readiness`. This component is that surface,
 * scoped to C1 Select per the operational ask.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Snackbar,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';

import CsaSectionTable, { ROWS_PER_PAGE_OPTIONS } from './CsaSectionTable';
import CsaWorkerInfoCell from './CsaWorkerInfoCell';
import I9Section2CompleteDialog from '../../staffOnboarding/I9Section2CompleteDialog';
import useOnboardingSpecialistActionQueueItems from '../../../hooks/useOnboardingSpecialistActionQueueItems';
import { useTenantRecruiterNamesByUid } from '../../../hooks/useTenantRecruiterNamesByUid';
import type { OnboardingSpecialistActionItem } from '../../../types/onboardingSpecialistActionQueue';

export interface PendingEmployerI9SelectSectionProps {
  tenantId: string | null;
  currentUserUid: string | null;
  scope: 'mine' | 'all';
}

const headerCellSx = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'text.secondary',
  letterSpacing: 0.4,
} as const;

const cellSx = { fontSize: 13, py: 1 } as const;

/**
 * Format Section 1 sign-time as a relative "X days ago" — matches the
 * sub-line UX on the other readiness sections so the recruiter can
 * eyeball how stale each row is.
 */
function formatDaysSince(ts: { toMillis?: () => number } | null): string | null {
  if (!ts || typeof ts.toMillis !== 'function') return null;
  const elapsed = Date.now() - ts.toMillis();
  if (elapsed < 0) return null;
  const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/* ─────────────── Federal I-9 Section 2 deadline ───────────────
 *
 * USCIS rule: Section 2 must be completed by the end of the third
 * BUSINESS day after the worker starts work for pay. We approximate
 * "starts work for pay" via `hireDate` (the field the rest of the
 * platform uses; HRX recruiters stamp it on hire). Business days =
 * Mon-Fri; weekends + federal holidays would be a future refinement
 * (this app doesn't track a holiday calendar yet, so we count Mon-Fri
 * only — over-counts available days slightly on holiday weeks, which
 * fails safe by showing the deadline a bit LATER than reality).
 *
 * The chip on each row encodes one of four states:
 *   - `overdue` (red)        — current day is past the deadline
 *   - `due_today` (red)      — last business day before midnight
 *   - `due_soon` (amber)     — 1 business day left
 *   - `upcoming` (default)   — 2 or more business days left
 *   - `no_anchor` (grey)     — hireDate missing (legacy row); show "—"
 */

type DeadlineUrgency = 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'no_anchor';

interface DeadlineSummary {
  urgency: DeadlineUrgency;
  /** Business days remaining (negative when overdue). null when no anchor. */
  businessDaysLeft: number | null;
}

function isBusinessDay(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

/** Count business days between two Dates (inclusive of end-day boundary
 *  meaning "days through end-of-day end"). Positive = future, negative =
 *  past, zero = same business day. */
function businessDaysBetween(from: Date, to: Date): number {
  // Normalize both to start-of-day so partial-day arithmetic doesn't
  // bias the count.
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (a.getTime() === b.getTime()) return 0;
  const sign = b > a ? 1 : -1;
  let count = 0;
  const cursor = new Date(a);
  // Walk one calendar day at a time toward `b`, counting only
  // business days along the way. Bounded by the diff so this is O(n)
  // in calendar days — fine for the few-week window we care about.
  while (cursor.getTime() !== b.getTime()) {
    cursor.setDate(cursor.getDate() + sign);
    if (isBusinessDay(cursor)) count += sign;
  }
  return count;
}

/** Add N business days to a date. Used to derive the Section 2 deadline
 *  from hireDate (deadline = hireDate + 3 business days, end-of-day). */
function addBusinessDays(d: Date, n: number): Date {
  const result = new Date(d);
  let remaining = n;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) remaining--;
  }
  return result;
}

function computeDeadlineSummary(
  hireTs: { toMillis?: () => number } | null,
): DeadlineSummary {
  if (!hireTs || typeof hireTs.toMillis !== 'function') {
    return { urgency: 'no_anchor', businessDaysLeft: null };
  }
  const hireDate = new Date(hireTs.toMillis());
  if (Number.isNaN(hireDate.getTime())) {
    return { urgency: 'no_anchor', businessDaysLeft: null };
  }
  const deadline = addBusinessDays(hireDate, 3);
  const today = new Date();
  const businessDaysLeft = businessDaysBetween(today, deadline);
  if (businessDaysLeft < 0) return { urgency: 'overdue', businessDaysLeft };
  if (businessDaysLeft === 0) return { urgency: 'due_today', businessDaysLeft };
  if (businessDaysLeft === 1) return { urgency: 'due_soon', businessDaysLeft };
  return { urgency: 'upcoming', businessDaysLeft };
}

function formatDeadlineLabel(d: DeadlineSummary): string {
  switch (d.urgency) {
    case 'overdue': {
      const days = Math.abs(d.businessDaysLeft ?? 0);
      if (days === 1) return 'Overdue · 1 day late';
      return `Overdue · ${days} days late`;
    }
    case 'due_today':
      return 'Due today';
    case 'due_soon':
      return '1 day left';
    case 'upcoming':
      return `${d.businessDaysLeft} days left`;
    case 'no_anchor':
      return '—';
  }
}

/** Sort weight — overdue first, then due_today, then ascending days
 *  left. Lower number sorts first. */
function urgencyWeight(d: DeadlineSummary): number {
  switch (d.urgency) {
    case 'overdue':
      // Larger overdue = more urgent. Subtract so older > newer.
      return -1_000_000 + (d.businessDaysLeft ?? 0);
    case 'due_today':
      return 0;
    case 'due_soon':
      return 1;
    case 'upcoming':
      return 2 + (d.businessDaysLeft ?? 0);
    case 'no_anchor':
      return 1_000_000;
  }
}

const PendingEmployerI9SelectSection: React.FC<PendingEmployerI9SelectSectionProps> = ({
  tenantId,
  currentUserUid,
  scope,
}) => {
  const navigate = useNavigate();
  const { items, loading, error } = useOnboardingSpecialistActionQueueItems({
    tenantId: tenantId ?? undefined,
    currentUserUid,
    scope,
  });

  // Filter to JUST the C1 Select rows in the I-9 Section 2 band. The
  // hook returns every action type and every entity; we narrow here so
  // the section stays scoped without re-implementing the join. If we
  // later add Workforce/Events I-9 surfaces we can lift the entity key
  // into a prop.
  // Filter to JUST the C1 Select rows in the I-9 Section 2 band, then
  // attach the federal-deadline summary so we can sort + render off one
  // shape. Sort: overdue first (oldest first within), then due_today,
  // then ascending days remaining. Workers without a hireDate anchor
  // sink to the bottom — they're a data-quality issue, not a deadline.
  const filtered = useMemo(() => {
    const withDeadline = items
      .filter(
        (it) =>
          it.actionType === 'i9_section_2' &&
          String(it.entityKey || '').toLowerCase() === 'select',
      )
      .map((it) => ({ item: it, deadline: computeDeadlineSummary(it.context.hireDate) }));
    withDeadline.sort((a, b) => urgencyWeight(a.deadline) - urgencyWeight(b.deadline));
    return withDeadline;
  }, [items]);

  // Header-band counts: surface the urgency totals so the recruiter has
  // a single-glance sense of "how bad is the backlog right now". Pulled
  // off the already-sorted set so the math stays cheap.
  const urgencyCounts = useMemo(() => {
    let overdue = 0;
    let dueToday = 0;
    let dueSoon = 0;
    for (const row of filtered) {
      if (row.deadline.urgency === 'overdue') overdue++;
      else if (row.deadline.urgency === 'due_today') dueToday++;
      else if (row.deadline.urgency === 'due_soon') dueSoon++;
    }
    return { overdue, dueToday, dueSoon };
  }, [filtered]);

  const csaNamesByUid = useTenantRecruiterNamesByUid(tenantId);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);
  const visible = useMemo(() => {
    const start = page * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page, rowsPerPage]);

  const [dialogItem, setDialogItem] = useState<OnboardingSpecialistActionItem | null>(
    null,
  );
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    severity: 'success' | 'error';
    message: string;
  }>({ open: false, severity: 'success', message: '' });

  const handleSection2Completed = useCallback(() => {
    setSnackbar({
      open: true,
      severity: 'success',
      message: 'I-9 Section 2 marked complete.',
    });
    // The aggregator's entity_employments listener picks up the new
    // `i9Section2CompletedAt` and the row disappears from `filtered`
    // automatically — no manual refresh needed.
  }, []);

  return (
    <>
      {/* Urgency banner — only renders when there's at least one
          overdue / due-today / due-soon row, otherwise it's noise. */}
      {(urgencyCounts.overdue > 0 ||
        urgencyCounts.dueToday > 0 ||
        urgencyCounts.dueSoon > 0) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            mb: 1,
          }}
        >
          {urgencyCounts.overdue > 0 && (
            <Chip
              size="small"
              color="error"
              variant="filled"
              label={`${urgencyCounts.overdue} overdue`}
              sx={{ fontWeight: 600 }}
            />
          )}
          {urgencyCounts.dueToday > 0 && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={`${urgencyCounts.dueToday} due today`}
              sx={{ fontWeight: 600 }}
            />
          )}
          {urgencyCounts.dueSoon > 0 && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${urgencyCounts.dueSoon} due tomorrow`}
              sx={{ fontWeight: 600 }}
            />
          )}
        </Box>
      )}

      <CsaSectionTable
        title="Employer I-9 needed (C1 Select)"
        totalCount={filtered.length}
        loading={loading}
        error={error}
        emptyStateCopy="No C1 Select workers waiting on Employer I-9. Nice work!"
        pagination={{
          page,
          rowsPerPage,
          onPageChange: setPage,
          onRowsPerPageChange: (next) => {
            setRowsPerPage(next);
            setPage(0);
          },
        }}
      >
        <TableHead>
          <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
            <TableCell sx={headerCellSx}>Worker</TableCell>
            <TableCell sx={headerCellSx}>Deadline</TableCell>
            <TableCell sx={headerCellSx}>Worker signed Section 1</TableCell>
            <TableCell sx={headerCellSx}>Onboarding Specialist</TableCell>
            <TableCell sx={headerCellSx} align="right">
              Action
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map(({ item, deadline }) => {
            const sub = formatDaysSince(item.context.i9Section1SignedAt);
            const recruiterName = csaNamesByUid.get(item.workerUid) ?? '—';
            // workerName is composed by the aggregator from first+last;
            // split it back out so CsaWorkerInfoCell can render avatar
            // initials + name on its own. Coerce nulls → undefined to
            // match the cell's optional-string prop shape.
            const nameParts = item.workerName.split(' ');
            const firstName = nameParts[0] || undefined;
            const lastName = nameParts.slice(1).join(' ') || undefined;
            return (
              <TableRow key={item.id} hover>
                <TableCell sx={cellSx}>
                  <CsaWorkerInfoCell
                    workerUid={item.workerUid}
                    firstName={firstName}
                    lastName={lastName}
                    email={item.workerEmail ?? undefined}
                    phone={item.workerPhone ?? undefined}
                    hiringEntityName={item.entityName}
                    avatarUrl={item.workerAvatarUrl ?? undefined}
                    onWorkerClick={(uid) => navigate(`/users/${uid}`)}
                  />
                </TableCell>
                <TableCell sx={cellSx}>
                  {deadline.urgency === 'no_anchor' ? (
                    <Typography variant="body2" color="text.disabled">
                      —
                    </Typography>
                  ) : (
                    <Chip
                      size="small"
                      label={formatDeadlineLabel(deadline)}
                      // Red filled for overdue (most urgent), red outlined
                      // for due-today, amber outlined for due-tomorrow,
                      // default outlined chip for further-out. Matches
                      // the urgency banner above.
                      color={
                        deadline.urgency === 'overdue'
                          ? 'error'
                          : deadline.urgency === 'due_today'
                            ? 'error'
                            : deadline.urgency === 'due_soon'
                              ? 'warning'
                              : 'default'
                      }
                      variant={deadline.urgency === 'overdue' ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 600 }}
                    />
                  )}
                </TableCell>
                <TableCell sx={cellSx}>
                  <Typography variant="body2">
                    {sub ?? 'Signed in Everee'}
                  </Typography>
                </TableCell>
                <TableCell sx={cellSx}>
                  <Typography variant="body2">{recruiterName}</Typography>
                </TableCell>
                <TableCell sx={cellSx} align="right">
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    {/* Deep-link to the worker's Everee admin page in
                        a new tab. Pattern: app.everee.com handles the
                        tenant context via the recruiter's own Everee
                        session, so we don't need to include the
                        evereeTenantId in the URL itself — see
                        EvereeAdminSyncCard for prior art. */}
                    {item.context.evereeWorkerId ? (
                      <Tooltip title="Open in Everee">
                        <IconButton
                          size="small"
                          aria-label={`Open ${item.workerName} in Everee`}
                          onClick={() =>
                            window.open(
                              `https://app.everee.com/workers/details/${encodeURIComponent(
                                item.context.evereeWorkerId as string,
                              )}`,
                              '_blank',
                              'noopener,noreferrer',
                            )
                          }
                          sx={{ color: 'text.secondary' }}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => setDialogItem(item)}
                      sx={{
                        textTransform: 'none',
                        fontSize: 12,
                        px: 1.5,
                        py: 0.4,
                        minHeight: 28,
                        bgcolor: '#0057B8',
                        '&:hover': { bgcolor: '#004a9f' },
                      }}
                    >
                      Mark complete
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </CsaSectionTable>

      <I9Section2CompleteDialog
        open={dialogItem != null}
        item={dialogItem}
        tenantId={tenantId ?? undefined}
        onClose={() => setDialogItem(null)}
        onCompleted={handleSection2Completed}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default PendingEmployerI9SelectSection;
