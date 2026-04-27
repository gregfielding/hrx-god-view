/**
 * Phase D.1.1a — collapsed-row layout for one worker × hiring entity in
 * the Workforce > Employee Readiness queue.
 *
 * **D.1.1a scope (this commit):**
 *   - Collapsed-only layout. The expand caret is rendered but DISABLED
 *     with a "Inline items arrive in D.1.1b" tooltip — explicit forward
 *     reference so reviewers know it isn't dead code.
 *   - `Remind worker ▾` and `⋯` action shells are rendered DISABLED with
 *     "Actions wire in D.1.1b/c" tooltips. We keep them visible so the
 *     row's column widths don't shift when D.1.1b lands.
 *   - Clicking the row body opens the existing per-item drawer placeholder
 *     (D.2 lands the real matrix drawer; we hand it the most-urgent item
 *     so the placeholder stays consistent with the v1 behavior).
 *   - Clicking the worker name navigates to `/users/{uid}` in the same
 *     tab — same as the v1 row.
 *
 * **What's NOT in this row (yet):**
 *   - Per-row checkbox. Bulk actions are D.1.1c; deferring the column
 *     until then keeps this commit small.
 *   - Inline expanded item table. D.1.1b.
 *
 * @see ../../utils/readinessQueue/groupByWorkerEntity.ts for the
 *      `WorkerGroup` shape this consumes.
 */

import React from 'react';
import {
  Avatar,
  Box,
  Chip,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ButtonGroup from '@mui/material/ButtonGroup';
import Button from '@mui/material/Button';

import ReadinessProgressBar from '../readiness/ReadinessProgressBar';
import WorkerCountChips from '../readiness/WorkerCountChips';
import { formatAbsoluteTime, formatAge } from '../../utils/readinessQueue';
import type { WorkerGroup } from '../../utils/readinessQueue';

interface WorkerReadinessRowProps {
  group: WorkerGroup;
  /** Current user's uid — used to render "You" as the owner label
   *  when this CSA owns the most-urgent item. */
  currentUserUid: string | null;
  /** Click handler for the row body — opens per-item drawer in D.1.1a,
   *  worker × entity matrix drawer in D.2. Receives the entire group;
   *  callers decide which item (typically `group.items[0]`) to surface. */
  onRowClick: (group: WorkerGroup) => void;
  /** Click handler for the worker name — navigates to the profile. */
  onWorkerNameClick: (group: WorkerGroup) => void;
}

const cellSx = {
  fontSize: 13,
  py: 1.25,
  verticalAlign: 'middle' as const,
};

const WorkerReadinessRow: React.FC<WorkerReadinessRowProps> = ({
  group,
  currentUserUid,
  onRowClick,
  onWorkerNameClick,
}) => {
  const isMine = group.primaryRecruiterId === currentUserUid;
  const ownerLabel = group.primaryRecruiterId
    ? isMine
      ? 'You'
      : group.ownerName || group.primaryRecruiterId
    : null;

  // Stop propagation on every interactive control inside the row so
  // clicking buttons / name / caret doesn't ALSO open the drawer. Only
  // the row body should trigger the drawer.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <TableRow hover onClick={() => onRowClick(group)} sx={{ cursor: 'pointer' }}>
      {/* Worker — avatar + name + hiring entity + blocking badge */}
      <TableCell sx={cellSx}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar
            src={group.workerAvatar || undefined}
            sx={{ width: 32, height: 32, fontSize: 14 }}
          >
            {group.workerName.slice(0, 1).toUpperCase()}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                onClick={(e) => {
                  stop(e);
                  onWorkerNameClick(group);
                }}
                sx={{
                  fontWeight: 600,
                  color: 'primary.main',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220,
                  '&:hover': { textDecoration: 'underline' },
                }}
                title="Open worker profile"
              >
                {group.workerName}
              </Typography>
              {group.blockingCount > 0 && (
                <Chip
                  label={`${group.blockingCount} BLOCKING`}
                  size="small"
                  color="error"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 260,
              }}
            >
              {group.hiringEntityName || group.hiringEntityId}
            </Typography>
          </Box>
        </Stack>
      </TableCell>

      {/* Progress bar — segmented complete/expired/needs-review/incomplete */}
      <TableCell sx={{ ...cellSx, minWidth: 200 }}>
        <ReadinessProgressBar counts={group.counts} />
      </TableCell>

      {/* Count chips — non-zero status families */}
      <TableCell sx={cellSx}>
        <WorkerCountChips counts={group.counts} />
      </TableCell>

      {/* Owner — avatar with "You" affordance */}
      <TableCell sx={cellSx}>
        {ownerLabel ? (
          <Tooltip title={ownerLabel}>
            <Avatar
              src={isMine ? undefined : group.ownerAvatar || undefined}
              sx={{
                width: 26,
                height: 26,
                fontSize: 12,
                bgcolor: isMine ? 'primary.main' : undefined,
              }}
            >
              {ownerLabel.slice(0, 1).toUpperCase()}
            </Avatar>
          </Tooltip>
        ) : (
          <Tooltip title="Unassigned — first CSA to act becomes primary owner">
            <Chip label="Unassigned" size="small" variant="outlined" />
          </Tooltip>
        )}
      </TableCell>

      {/* Last activity — relative + absolute tooltip */}
      <TableCell sx={cellSx}>
        <Tooltip title={formatAbsoluteTime(group.lastUpdatedAtMs)}>
          <Typography variant="body2" color="text.secondary">
            {formatAge(group.lastUpdatedAtMs)}
          </Typography>
        </Tooltip>
      </TableCell>

      {/* Actions — Remind split-button + ⋯ menu + expand caret. Disabled
          shells in D.1.1a so column widths lock now. */}
      <TableCell sx={{ ...cellSx, textAlign: 'right' }} onClick={stop}>
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
          <Tooltip title="Remind worker — wires in D.1.1b (SMS now / Push / Schedule / Skip)">
            <span>
              <ButtonGroup size="small" variant="outlined" disabled>
                <Button
                  startIcon={<NotificationsActiveIcon fontSize="small" />}
                  sx={{ textTransform: 'none' }}
                >
                  Remind worker
                </Button>
                <Button sx={{ minWidth: 28, px: 0.5 }}>
                  <ArrowDropDownIcon fontSize="small" />
                </Button>
              </ButtonGroup>
            </span>
          </Tooltip>
          <Tooltip title="Worker-level actions — wire in D.1.1c">
            <span>
              <IconButton size="small" disabled>
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Inline items arrive in D.1.1b">
            <span>
              <IconButton size="small" disabled>
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
};

export default WorkerReadinessRow;
