/**
 * RD.1 — Section 3: open onboarding-call tasks for the CSA to action.
 *
 * **What changed from v0:** the v0 spike of this section wrote to a
 * dedicated `tenants/{tid}/csa_actions` collection via a custom
 * `WelcomeCallModal`. Per the revised RD.1 spec we instead consume the
 * existing task system (`tenants/{tid}/tasks`) and reuse
 * `TaskDetailsDialog` for the complete-with-notes flow. Benefits:
 *   - no parallel data system that downstream surfaces wouldn't see,
 *   - the dialog already handles task associations, completion notes,
 *     and write-through to the activity log via `taskService`,
 *   - the row disappears automatically when the task's status flips to
 *     'completed' — `useCsaPendingOnboardingCallTasks`' predicate drops
 *     it on the next snapshot tick, no optimistic state needed.
 *
 * Per spec §3 ("Don't roll a new dialog for v1 — TaskDetailsDialog
 * already exists. If its API doesn't support pre-population by taskId or
 * doesn't have a 'complete with notes' flow, use UnifiedTaskCreateModal
 * as the fallback or note the gap.") the dialog accepts a full pre-loaded
 * task object (which we already have on the row), and its built-in
 * "Complete" sub-dialog asks for notes. No fallback needed.
 *
 * **Gap noted (non-blocking):** the task type system at
 * `src/types/Tasks.ts` doesn't have a dedicated `'onboarding_call'` task
 * type. We surface tasks where `type === 'onboarding'` OR
 * `category === 'onboarding'` (see
 * `src/hooks/internal/csaOnboardingCallTaskFilter.ts` for rationale).
 * Once a dedicated `'onboarding_call'` type lands (#40 CSA tasks system
 * RFC), narrow the predicate.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import CsaSectionTable, { ROWS_PER_PAGE_OPTIONS } from './CsaSectionTable';
import CsaWorkerInfoCell from './CsaWorkerInfoCell';
import TaskDetailsDialog from '../../TaskDetailsDialog';
import useCsaPendingOnboardingCallTasks, {
  type CsaPendingOnboardingCallRow,
} from '../../../hooks/useCsaPendingOnboardingCallTasks';
import useUserDocsByUids from '../../../hooks/useUserDocsByUids';
import { formatAge, formatAbsoluteTime } from '../../../utils/readinessQueue';
import { pickAvatarFromUserDoc, pickDisplayNameFromUserDoc } from './pickFromUserDoc';

export interface PendingOnboardingCallsSectionProps {
  tenantId: string | null;
  /** Current user's uid — passed to TaskDetailsDialog as `salespersonId` */
  /** so completion writes are attributed correctly. */
  csaUid: string | null;
  scope: 'mine' | 'all';
  /** Fired after `TaskDetailsDialog` reports a successful update — the */
  /** page surfaces this as a "Task completed" snackbar. */
  onTaskUpdated?: (taskId: string) => void;
}

const headerCellSx = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'text.secondary',
  letterSpacing: 0.4,
} as const;

const cellSx = { fontSize: 13, py: 1 } as const;

function asMaybeString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const PendingOnboardingCallsSection: React.FC<PendingOnboardingCallsSectionProps> = ({
  tenantId,
  csaUid,
  scope,
  onTaskUpdated,
}) => {
  const navigate = useNavigate();
  const { rows, loading, error } = useCsaPendingOnboardingCallTasks({
    tenantId,
    currentUserUid: csaUid,
    scope,
  });

  // Worker uids derived from tasks' associations. Some tasks may not
  // resolve a worker (workerUid === null) — we still show the row but
  // render "Unknown worker" in the worker column. Filtering those out
  // would hide actionable work from the CSA.
  const uids = useMemo(
    () => Array.from(new Set(rows.map((r) => r.workerUid).filter((u): u is string => !!u))),
    [rows],
  );
  const { docs: userDocs } = useUserDocsByUids(uids);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);
  const [openRow, setOpenRow] = useState<CsaPendingOnboardingCallRow | null>(null);

  // Reset paging when the tenant or scope changes — otherwise the user
  // may land on an empty page after a scope flip.
  React.useEffect(() => {
    setPage(0);
  }, [tenantId, scope]);

  const visible = useMemo(() => {
    const start = page * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [rows, page, rowsPerPage]);

  const handleTaskUpdated = useCallback(
    (taskId: string) => {
      // We don't manually drop the row from local state — the live
      // listener will receive the status flip and the predicate will
      // exclude the row on the next tick. Surface the success upward.
      onTaskUpdated?.(taskId);
    },
    [onTaskUpdated],
  );

  return (
    <>
      <CsaSectionTable
        title="New onboarding workers to call"
        totalCount={rows.length}
        loading={loading}
        error={error}
        emptyStateCopy="No pending onboarding calls — nice work!"
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
            <TableCell sx={headerCellSx}>Hiring entity</TableCell>
            <TableCell sx={headerCellSx}>Task created</TableCell>
            <TableCell sx={{ ...headerCellSx, textAlign: 'right' }}>Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((row) => {
            const userDoc = row.workerUid ? userDocs.get(row.workerUid) ?? undefined : undefined;
            const nameParts = pickDisplayNameFromUserDoc(userDoc);
            const createdRel = row.createdAtMs ? `${formatAge(row.createdAtMs)} ago` : '—';
            const createdAbs = row.createdAtMs ? formatAbsoluteTime(row.createdAtMs) : '';

            return (
              <TableRow key={row.taskId} hover>
                <TableCell sx={cellSx}>
                  <CsaWorkerInfoCell
                    workerUid={row.workerUid ?? ''}
                    firstName={nameParts.firstName}
                    lastName={nameParts.lastName}
                    email={asMaybeString(nameParts.email) ?? asMaybeString(userDoc?.email)}
                    phone={asMaybeString(userDoc?.phone)}
                    avatarUrl={pickAvatarFromUserDoc(userDoc)}
                    onWorkerClick={(uid) => {
                      if (uid) navigate(`/users/${uid}`);
                    }}
                  />
                </TableCell>
                <TableCell sx={cellSx}>
                  <Typography variant="body2">{row.hiringEntityName ?? '—'}</Typography>
                </TableCell>
                <TableCell sx={cellSx}>
                  <Tooltip title={createdAbs} placement="top" arrow>
                    <Typography variant="body2">{createdRel}</Typography>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ ...cellSx, textAlign: 'right' }}>
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    onClick={() => setOpenRow(row)}
                    // Defensive — the page only renders this when
                    // authenticated, but TaskDetailsDialog requires a
                    // tenant + uid to attribute writes.
                    disabled={!csaUid || !tenantId}
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                  >
                    Complete
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </CsaSectionTable>

      {openRow && csaUid && tenantId && (
        <TaskDetailsDialog
          open
          onClose={() => setOpenRow(null)}
          task={openRow.task}
          salespersonId={csaUid}
          tenantId={tenantId}
          onTaskUpdated={(taskId) => {
            handleTaskUpdated(taskId);
            // The dialog calls onClose on its own after completion, but
            // close defensively here too in case the dialog returns from
            // a Save (vs Complete) without auto-closing.
            setOpenRow(null);
          }}
        />
      )}
    </>
  );
};

export default PendingOnboardingCallsSection;
