/**
 * Labor Pool "Inactive elsewhere" chip — Phase 5b of
 * `docs/WORKFORCE_DOMAIN_MODEL.md` (§10).
 *
 * When a recruiter is picking workers for Account Y, we want them to see
 * at a glance that a candidate has been deactivated at some OTHER
 * account (X or Z). Clicking / hovering lists the accounts + reasons so
 * the recruiter has context before placing.
 *
 * The chip reads from `users.{uid}.inactiveAtAccounts` — a denormalized
 * array maintained by `onAccountWorkforceStatusChangeSyncUserInactiveSet`.
 * Entries that match `currentAccountId` are filtered out (the recruiter
 * already knows about those — they're managing that account's roster).
 *
 * Quiet by design: small, outlined, muted color. Not a blocker, just a
 * signal. Clicking it pops a tooltip listing the other accounts; we
 * intentionally don't link out — the recruiter can see it and keep scanning.
 */

import React from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import type { UserInactiveAtAccountEntry } from '../../shared/accountWorkforce';

export interface WorkforceInactiveElsewhereChipProps {
  entries: UserInactiveAtAccountEntry[] | null | undefined;
  /**
   * The account the recruiter is currently placing for. Entries
   * matching this id are hidden — the recruiter already knows about
   * their own account's deactivations via the Workforce → Inactive tab.
   */
  currentAccountId?: string | null;
  /** When true, the chip collapses to an icon-only form for very narrow rows. */
  iconOnly?: boolean;
}

const REASON_LABELS: Record<string, string> = {
  no_show: 'No-show',
  left_early_repeat: 'Left early (repeated)',
  client_requested: 'Client requested replacement',
  performance: 'Performance',
  attendance: 'Attendance',
  policy: 'Policy violation',
  worker_request: 'Worker requested off',
  other: 'Other',
};

const WorkforceInactiveElsewhereChip: React.FC<WorkforceInactiveElsewhereChipProps> = ({
  entries,
  currentAccountId,
  iconOnly,
}) => {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const filtered = currentAccountId
    ? entries.filter((e) => e?.accountId !== currentAccountId)
    : entries;
  if (filtered.length === 0) return null;

  const label =
    filtered.length === 1
      ? 'Inactive at 1 account'
      : `Inactive at ${filtered.length} accounts`;

  const tooltipContent = (
    <Box sx={{ maxWidth: 280 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Inactive at other account{filtered.length === 1 ? '' : 's'}
      </Typography>
      {filtered.map((e) => (
        <Box key={e.accountId} sx={{ mb: 0.5, '&:last-child': { mb: 0 } }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
            {e.accountName || e.accountId}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {REASON_LABELS[e.reason] || e.reason}
            {e.deactivatedAt ? ` · ${new Date(e.deactivatedAt).toLocaleDateString()}` : ''}
          </Typography>
        </Box>
      ))}
    </Box>
  );

  return (
    <Tooltip title={tooltipContent} arrow placement="top">
      {iconOnly ? (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            color: 'warning.main',
            cursor: 'help',
          }}
        >
          <WarningAmberIcon fontSize="small" />
        </Box>
      ) : (
        <Chip
          icon={<WarningAmberIcon />}
          label={label}
          size="small"
          variant="outlined"
          color="warning"
          sx={{
            fontSize: '0.7rem',
            height: 22,
            fontWeight: 500,
            '& .MuiChip-label': { px: 0.75 },
          }}
        />
      )}
    </Tooltip>
  );
};

export default WorkforceInactiveElsewhereChip;
