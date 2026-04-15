import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { TABLE_AVATAR_SIZE } from '../../utils/uiConstants';
import type { OnboardingQueuePagination } from '../../types/onboardingQueue';
import { useOnboardingTaxPayrollQueue } from '../../hooks/useOnboardingTaxPayrollQueue';
import { useOnboardingEverifyQueue } from '../../hooks/useOnboardingEverifyQueue';
import { useOnboardingBackgroundQueue } from '../../hooks/useOnboardingBackgroundQueue';
import OnboardingQueueTableShell from './OnboardingQueueTableShell';
import OnboardingQueueWorkerSearchField from './OnboardingQueueWorkerSearchField';

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function QueueWorkerAvatar({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = avatarUrl && !imgFailed ? avatarUrl : undefined;
  return (
    <Avatar
      src={src}
      alt=""
      imgProps={{ onError: () => setImgFailed(true) }}
      sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: 14 }}
    >
      {initials(displayName)}
    </Avatar>
  );
}

function statusChipColor(
  label: string,
): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' {
  const s = label.toLowerCase();
  if (s.includes('report ready') || s.includes('drug report ready')) return 'warning';
  if (s.includes('ready') || s.includes('complete')) return 'success';
  if (s.includes('review') || s.includes('attention') || s.includes('error')) return 'warning';
  if (s.includes('waiting')) return 'info';
  if (s.includes("doesn't") || s.includes('doesn')) return 'default';
  return 'default';
}

const headCellSx = { fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' as const };

export const StaffOnboardingTaxPayrollTab: React.FC<{
  tenantId: string | undefined;
  pagination: OnboardingQueuePagination;
  workerSearch: string;
  onWorkerSearchChange: (value: string) => void;
}> = ({ tenantId, pagination, workerSearch, onWorkerSearchChange }) => {
  const navigate = useNavigate();
  const q = useOnboardingTaxPayrollQueue(tenantId, pagination, workerSearch);
  const emptyMessage =
    q.unfilteredCount === 0
      ? 'No workers currently need tax or payroll follow-up.'
      : 'No workers match your search.';

  const openRow = useCallback(
    (uid: string) => {
      navigate(`/users/${encodeURIComponent(uid)}?employmentFocus=Employment`);
    },
    [navigate],
  );

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <OnboardingQueueWorkerSearchField
        id="staff-onboarding-tax-search"
        value={workerSearch}
        onChange={onWorkerSearchChange}
      />
      <OnboardingQueueTableShell
      loading={q.loading}
      error={q.error}
      emptyMessage={emptyMessage}
      colCount={13}
      totalCount={q.totalCount}
      page={q.page}
      pageSize={q.pageSize}
      onPageChange={q.setPage}
      onPageSizeChange={q.setPageSize}
      head={
        <>
          <TableCell sx={headCellSx}>Worker</TableCell>
          <TableCell sx={headCellSx}>Entity</TableCell>
          <TableCell sx={headCellSx}>Worker type</TableCell>
          <TableCell sx={headCellSx}>Employment mode</TableCell>
          <TableCell sx={headCellSx}>E-Verify</TableCell>
          <TableCell sx={headCellSx}>Assignment</TableCell>
          <Tooltip
            title="TempWorks I-9 employee section (external i9_employee_section) — same completion rules as User → Employment → Tax and identity → I-9 completed."
            placement="top"
            arrow
          >
            <TableCell sx={headCellSx}>I-9 Complete</TableCell>
          </Tooltip>
          <Tooltip
            title="Same completion rules as User → Employment → Payroll setup: verified TempWorks direct-deposit step or payroll account signals."
            placement="top"
            arrow
          >
            <TableCell sx={headCellSx}>Direct deposit</TableCell>
          </Tooltip>
          <Tooltip
            title="Same as User → Employment → Tax and identity (W-4 or W-9): verified external step or tax identity marked complete on employment."
            placement="top"
            arrow
          >
            <TableCell sx={headCellSx}>Tax forms</TableCell>
          </Tooltip>
          <Tooltip
            title="The tightest bottleneck among I-9, Everee (when present), direct deposit, and tax forms (matches row sort priority)."
            placement="top"
            arrow
          >
            <TableCell sx={headCellSx}>Why queued</TableCell>
          </Tooltip>
          <TableCell sx={headCellSx}>Last activity</TableCell>
          <TableCell sx={headCellSx}>Owner</TableCell>
          <TableCell sx={headCellSx} align="right">
            Actions
          </TableCell>
        </>
      }
    >
      {q.rows.map((r) => (
        <TableRow key={r.rowId} hover sx={{ cursor: 'pointer' }} onClick={() => openRow(r.userId)}>
          <TableCell sx={{ minWidth: 200 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <QueueWorkerAvatar displayName={r.workerDisplayName} avatarUrl={r.workerAvatarUrl} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {r.workerDisplayName}
                </Typography>
                {(r.workerEmail || r.workerPhone) && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    {[r.workerEmail, r.workerPhone].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Box>
            </Box>
          </TableCell>
          <TableCell>
            <Typography variant="body2" noWrap>
              {r.entityLabel}
            </Typography>
          </TableCell>
          <TableCell>{r.workerTypeLabel}</TableCell>
          <TableCell>{r.employmentModeLabel}</TableCell>
          <TableCell sx={{ maxWidth: 160, verticalAlign: 'top' }}>
            {r.everifyStatusLabel ? (
              <Typography variant="body2" noWrap title={r.everifyStatusLabel}>
                {r.everifyStatusLabel}
              </Typography>
            ) : null}
          </TableCell>
          <TableCell sx={{ maxWidth: 220, verticalAlign: 'top' }}>
            {r.assignmentJobOrderName || r.assignmentJobTitle || r.assignmentStartDateLabel ? (
              <Box sx={{ py: 0.25 }}>
                {r.assignmentJobOrderName ? (
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    display="block"
                    noWrap
                    title={r.assignmentJobOrderName}
                  >
                    {r.assignmentJobOrderName}
                  </Typography>
                ) : null}
                {r.assignmentJobTitle ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                    title={r.assignmentJobTitle}
                  >
                    {r.assignmentJobTitle}
                  </Typography>
                ) : null}
                {r.assignmentStartDateLabel ? (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Start {r.assignmentStartDateLabel}
                  </Typography>
                ) : null}
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">
                —
              </Typography>
            )}
          </TableCell>
          <TableCell>
            <Chip
              size="small"
              label={r.i9CompleteLabel}
              color={statusChipColor(r.i9CompleteLabel)}
              variant="outlined"
            />
          </TableCell>
          <TableCell>
            <Chip
              size="small"
              label={r.directDepositLabel}
              color={statusChipColor(r.directDepositLabel)}
              variant="outlined"
            />
          </TableCell>
          <TableCell>
            <Chip
              size="small"
              label={r.taxFormsLabel}
              color={statusChipColor(r.taxFormsLabel)}
              variant="outlined"
            />
          </TableCell>
          <TableCell sx={{ maxWidth: 200 }}>
            <Typography variant="body2" noWrap title={r.whyQueuedLabel}>
              {r.whyQueuedLabel}
            </Typography>
          </TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.lastActivityLabel}</TableCell>
          <TableCell>{r.ownerLabel}</TableCell>
          <TableCell align="right" onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              variant="outlined"
              sx={{ textTransform: 'none' }}
              onClick={() => openRow(r.userId)}
            >
              Open profile
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </OnboardingQueueTableShell>
    </Stack>
  );
};

export const StaffOnboardingEverifyTab: React.FC<{
  tenantId: string | undefined;
  pagination: OnboardingQueuePagination;
  workerSearch: string;
  onWorkerSearchChange: (value: string) => void;
}> = ({ tenantId, pagination, workerSearch, onWorkerSearchChange }) => {
  const navigate = useNavigate();
  const q = useOnboardingEverifyQueue(tenantId, pagination, workerSearch);
  const emptyMessage =
    q.unfilteredCount === 0
      ? 'No C1 Select workers with I-9 complete who still need E-Verify.'
      : 'No workers match your search.';

  const openRow = useCallback(
    (uid: string) => {
      const params = new URLSearchParams();
      params.set('employmentFocus', 'Employment');
      params.set('employmentScrollTo', 'e_verify');
      params.set('employmentEntityKey', 'select');
      navigate(`/users/${encodeURIComponent(uid)}?${params.toString()}`);
    },
    [navigate],
  );

  return (
    <Box>
      {!q.loading && !q.selectEntityResolved ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          C1 Select entity is not resolved for this tenant — the E-Verify queue is empty until
          Select is configured.
        </Alert>
      ) : null}
      {!q.loading && q.selectEntityResolved ? (
        <Alert severity="info" sx={{ mb: 2 }} variant="outlined">
          <strong>C1 Select only.</strong> Workers whose <strong>I-9 is complete</strong> (same TempWorks rule as Tax
          &amp; Payroll) and <strong>E-Verify is not yet complete</strong> — including active onboarding or employed
          Select pipelines (newest activity first). Workforce/Events hires are not included.
        </Alert>
      ) : null}
      <Stack spacing={2} sx={{ width: '100%' }}>
        <OnboardingQueueWorkerSearchField
          id="staff-onboarding-ev-search"
          value={workerSearch}
          onChange={onWorkerSearchChange}
        />
        <OnboardingQueueTableShell
        loading={q.loading}
        error={q.error}
        emptyMessage={emptyMessage}
        colCount={8}
        totalCount={q.totalCount}
        page={q.page}
        pageSize={q.pageSize}
        onPageChange={q.setPage}
        onPageSizeChange={q.setPageSize}
        head={
          <>
            <TableCell sx={headCellSx}>Worker</TableCell>
            <TableCell sx={headCellSx}>Entity</TableCell>
            <TableCell sx={headCellSx}>Employment context</TableCell>
            <TableCell sx={headCellSx}>E-Verify status</TableCell>
            <TableCell sx={headCellSx}>Current step</TableCell>
            <TableCell sx={headCellSx}>Last update</TableCell>
            <TableCell sx={headCellSx}>Owner</TableCell>
            <TableCell sx={headCellSx} align="right">
              Actions
            </TableCell>
          </>
        }
      >
        {q.rows.map((r) => (
          <TableRow
            key={r.rowId}
            hover
            sx={{ cursor: 'pointer' }}
            onClick={() => openRow(r.userId)}
          >
            <TableCell sx={{ minWidth: 200 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <QueueWorkerAvatar
                  displayName={r.workerDisplayName}
                  avatarUrl={r.workerAvatarUrl}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {r.workerDisplayName}
                  </Typography>
                  {(r.workerEmail || r.workerPhone) && (
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {[r.workerEmail, r.workerPhone].filter(Boolean).join(' · ')}
                    </Typography>
                  )}
                </Box>
              </Box>
            </TableCell>
            <TableCell>{r.entityLabel}</TableCell>
            <TableCell>{r.employmentContextLabel}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={r.statusLabel}
                color={statusChipColor(r.statusLabel)}
                variant="outlined"
              />
            </TableCell>
            <TableCell>
              <Tooltip title={r.currentStepLabel}>
                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                  {r.currentStepLabel}
                </Typography>
              </Tooltip>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.lastUpdateLabel}</TableCell>
            <TableCell>{r.ownerLabel}</TableCell>
            <TableCell align="right" onClick={(e) => e.stopPropagation()}>
              <Button
                size="small"
                variant="outlined"
                sx={{ textTransform: 'none' }}
                onClick={() => openRow(r.userId)}
              >
                Open profile
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </OnboardingQueueTableShell>
      </Stack>
    </Box>
  );
};

export const StaffOnboardingBackgroundTab: React.FC<{
  tenantId: string | undefined;
  pagination: OnboardingQueuePagination;
  workerSearch: string;
  onWorkerSearchChange: (value: string) => void;
}> = ({ tenantId, pagination, workerSearch, onWorkerSearchChange }) => {
  const navigate = useNavigate();
  const q = useOnboardingBackgroundQueue(tenantId, pagination, workerSearch);
  const emptyMessage =
    q.unfilteredCount === 0
      ? 'No workers currently need background screening follow-up.'
      : 'No workers match your search.';

  const openRow = useCallback(
    (uid: string, backgroundCheckId?: string) => {
      const params = new URLSearchParams();
      params.set('employmentFocus', 'Backgrounds');
      if (backgroundCheckId) {
        params.set('employmentScrollTo', 'background_check');
        params.set('employmentBackgroundCheckId', backgroundCheckId);
      }
      navigate(`/users/${encodeURIComponent(uid)}?${params.toString()}`);
    },
    [navigate],
  );

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <OnboardingQueueWorkerSearchField
        id="staff-onboarding-bg-search"
        value={workerSearch}
        onChange={onWorkerSearchChange}
      />
      <OnboardingQueueTableShell
      loading={q.loading}
      error={q.error}
      emptyMessage={emptyMessage}
      colCount={8}
      totalCount={q.totalCount}
      page={q.page}
      pageSize={q.pageSize}
      onPageChange={q.setPage}
      onPageSizeChange={q.setPageSize}
      head={
        <>
          <TableCell sx={headCellSx}>Worker</TableCell>
          <TableCell sx={headCellSx}>Entity</TableCell>
          <TableCell sx={headCellSx}>Employment mode</TableCell>
          <TableCell sx={headCellSx}>Package</TableCell>
          <TableCell sx={headCellSx}>Background status</TableCell>
          <TableCell sx={headCellSx}>Last update</TableCell>
          <TableCell sx={headCellSx}>Owner</TableCell>
          <TableCell sx={headCellSx} align="right">
            Actions
          </TableCell>
        </>
      }
    >
      {q.rows.map((r) => (
        <TableRow
          key={r.rowId}
          hover
          sx={{ cursor: 'pointer' }}
          onClick={() => openRow(r.userId, r.backgroundCheckId)}
        >
          <TableCell sx={{ minWidth: 200 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <QueueWorkerAvatar displayName={r.workerDisplayName} avatarUrl={r.workerAvatarUrl} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {r.workerDisplayName}
                </Typography>
                {(r.workerEmail || r.workerPhone) && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    {[r.workerEmail, r.workerPhone].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Box>
            </Box>
          </TableCell>
          <TableCell>{r.entityLabel}</TableCell>
          <TableCell>{r.employmentModeLabel}</TableCell>
          <TableCell>
            <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
              {r.packageLabel}
            </Typography>
          </TableCell>
          <TableCell>
            <Chip
              size="small"
              label={r.statusLabel}
              color={statusChipColor(r.statusLabel)}
              variant="outlined"
            />
          </TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.lastUpdateLabel}</TableCell>
          <TableCell>{r.ownerLabel}</TableCell>
          <TableCell align="right" onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              variant="outlined"
              sx={{ textTransform: 'none' }}
              onClick={() => openRow(r.userId, r.backgroundCheckId)}
            >
              Open profile
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </OnboardingQueueTableShell>
    </Stack>
  );
};
