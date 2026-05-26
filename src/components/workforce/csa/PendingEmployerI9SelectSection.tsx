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
  Button,
  Snackbar,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
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
  const filtered = useMemo(
    () =>
      items.filter(
        (it) =>
          it.actionType === 'i9_section_2' &&
          String(it.entityKey || '').toLowerCase() === 'select',
      ),
    [items],
  );

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
            <TableCell sx={headerCellSx}>Worker signed Section 1</TableCell>
            <TableCell sx={headerCellSx}>Onboarding Specialist</TableCell>
            <TableCell sx={headerCellSx} align="right">
              Action
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((item) => {
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
                  <Typography variant="body2">
                    {sub ?? 'Signed in Everee'}
                  </Typography>
                </TableCell>
                <TableCell sx={cellSx}>
                  <Typography variant="body2">{recruiterName}</Typography>
                </TableCell>
                <TableCell sx={cellSx} align="right">
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
