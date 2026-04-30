/**
 * RD.1 — shared "worker info" table cell for CSA section tables.
 *
 * Compact per-row column matching the pattern from `RecruiterUsers` /
 * `UsersTable`: avatar (left) + name (linked to `/users/{uid}`) over
 * email + phone + hiring entity. Intentionally lighter than
 * `RecruiterUserTableContactBlock` — that component has a lot of
 * recruiter-specific signal glyphs (resume / skills / Indeed Flex /
 * notes) that aren't actionable for the CSA's purposes here. v1 keeps
 * the column readable; signal glyphs can be added later if a CSA proves
 * they need them.
 *
 * Click-on-name navigates to the user profile via the parent's
 * `onWorkerClick` prop (so the parent can also surface activity logging
 * if it wants to). Avatar click intentionally does nothing — only the
 * name is the affordance for "open profile".
 */
import React from 'react';
import { Avatar, Box, Stack, Typography } from '@mui/material';

import { formatPhoneNumber } from '../../../utils/formatPhone';

export interface CsaWorkerInfoCellProps {
  workerUid: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  hiringEntityName?: string;
  avatarUrl?: string;
  /** Click handler for the worker name. Receives the uid. */
  onWorkerClick: (uid: string) => void;
}

const tightCaption = { lineHeight: 1.2, fontSize: '0.72rem' } as const;

const CsaWorkerInfoCell: React.FC<CsaWorkerInfoCellProps> = ({
  workerUid,
  firstName,
  lastName,
  email,
  phone,
  hiringEntityName,
  avatarUrl,
  onWorkerClick,
}) => {
  // Single source of truth for "what to display when there's no name on
  // the doc": fall back to email local-part, then to the uid as last
  // resort. Workers can submit applications with a phone-only flow so
  // missing names happen in the wild.
  const displayName =
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    (email ? email.split('@')[0] : '') ||
    workerUid;

  // Avatar fallback: first letter of the resolved display name (NOT the
  // uid — `b` for `bcip2bq9...` is meaningless to a CSA).
  const initial = displayName.slice(0, 1).toUpperCase();

  // formatPhoneNumber is defensive against bad inputs but bails out with
  // the raw string for already-formatted / international numbers, which
  // is exactly what we want.
  const phoneDisplay = phone ? formatPhoneNumber(phone) : '';

  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0, py: 0.25 }}>
      <Avatar
        src={avatarUrl || undefined}
        sx={{ width: 32, height: 32, fontSize: 14, mt: 0.25, flexShrink: 0 }}
      >
        {initial}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          onClick={() => onWorkerClick(workerUid)}
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
          {displayName}
        </Typography>

        {phoneDisplay && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={tightCaption}
          >
            {phoneDisplay}
          </Typography>
        )}
        {email && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            noWrap
            sx={tightCaption}
            title={email}
          >
            {email}
          </Typography>
        )}
        {hiringEntityName && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            noWrap
            sx={{ ...tightCaption, mt: 0.125 }}
            title={hiringEntityName}
          >
            {hiringEntityName}
          </Typography>
        )}
      </Box>
    </Stack>
  );
};

export default CsaWorkerInfoCell;
