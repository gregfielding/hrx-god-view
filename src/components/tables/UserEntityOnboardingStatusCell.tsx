import React from 'react';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { UserListEntityOnboardingItem } from '../../utils/userListEntityEmploymentStatus';
import {
  USER_LIST_ENTITY_ONBOARDING_MAX_CHIPS,
  formatEntityOnboardingChipLine,
  sortEntityOnboardingItemsForDisplay,
} from '../../utils/userListEntityEmploymentStatus';

export interface UserEntityOnboardingStatusCellProps {
  items: UserListEntityOnboardingItem[];
  /** When true, show em dash (still stable row height). */
  loading?: boolean;
  maxVisible?: number;
  /** `hidden` omits the cell when there are no items (profile header). Default `dash` for tables. */
  emptyDisplay?: 'dash' | 'hidden';
  /** `compact` = slightly smaller chips and softer fills (profile header). */
  density?: 'default' | 'compact';
}

function chipSxForTone(tone: UserListEntityOnboardingItem['tone'], density: 'default' | 'compact') {
  const soft = density === 'compact';
  const fill = (base: number) => (soft ? base * 0.55 : base);
  switch (tone) {
    case 'ready':
      return {
        borderColor: soft ? 'success.main' : 'success.light',
        color: soft ? 'success.main' : 'success.dark',
        bgcolor: (theme) => alpha(theme.palette.success.main, fill(0.1)),
      };
    case 'onboarding':
      return {
        borderColor: soft ? 'warning.main' : 'warning.light',
        color: 'warning.dark',
        bgcolor: (theme) => alpha(theme.palette.warning.main, fill(0.12)),
      };
    case 'needs_attention':
      return {
        borderColor: soft ? 'error.main' : 'error.light',
        color: soft ? 'error.main' : 'error.dark',
        bgcolor: (theme) => alpha(theme.palette.error.main, fill(0.1)),
      };
    case 'inactive':
    default:
      return {
        borderColor: 'divider',
        color: 'text.secondary',
        bgcolor: (theme) =>
          theme.palette.action?.hover ? alpha(theme.palette.action.hover, soft ? 0.4 : 0.65) : 'action.hover',
      };
  }
}

const UserEntityOnboardingStatusCell: React.FC<UserEntityOnboardingStatusCellProps> = ({
  items,
  loading = false,
  maxVisible = USER_LIST_ENTITY_ONBOARDING_MAX_CHIPS,
  emptyDisplay = 'dash',
  density = 'default',
}) => {
  const sorted = React.useMemo(() => sortEntityOnboardingItemsForDisplay(items), [items]);
  const visible = sorted.slice(0, maxVisible);
  const overflow = Math.max(0, sorted.length - visible.length);

  const tooltipTitle =
    sorted.length === 0 ? (
      'No entity employment with onboarding status yet.'
    ) : (
      <Stack spacing={0.5} sx={{ py: 0.25, maxWidth: 320 }}>
        {sorted.map((it, i) => (
          <Typography key={`${it.entityLabel}-${i}`} variant="caption" component="div" sx={{ lineHeight: 1.35 }}>
            {formatEntityOnboardingChipLine(it)}
            {it.rawStatus ? (
              <Typography component="span" variant="caption" color="text.secondary" display="block">
                ({it.rawStatus})
              </Typography>
            ) : null}
          </Typography>
        ))}
      </Stack>
    );

  if (loading) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
        …
      </Typography>
    );
  }

  if (sorted.length === 0) {
    if (emptyDisplay === 'hidden') return null;
    return (
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
        —
      </Typography>
    );
  }

  const compact = density === 'compact';
  const chipHeight = compact ? 20 : 22;
  const chipFont = compact ? '0.65rem' : '0.7rem';
  const overflowFont = compact ? '0.65rem' : '0.7rem';
  const rowMaxW = compact ? 420 : 280;

  return (
    <Tooltip title={tooltipTitle} placement="top" enterDelay={400} slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}>
      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        gap={compact ? 0.375 : 0.5}
        sx={{ alignItems: 'center', maxWidth: rowMaxW, py: compact ? 0 : 0.25 }}
      >
        {visible.map((it, i) => (
          <Chip
            key={`${it.entityLabel}-${it.statusLabel}-${i}`}
            size="small"
            variant="outlined"
            label={formatEntityOnboardingChipLine(it)}
            sx={{
              height: chipHeight,
              maxWidth: '100%',
              '& .MuiChip-label': {
                px: compact ? 0.5 : 0.75,
                fontSize: chipFont,
                fontWeight: 500,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
              ...chipSxForTone(it.tone, density),
            }}
          />
        ))}
        {overflow > 0 ? (
          <Box
            component="span"
            sx={{
              fontSize: overflowFont,
              color: 'text.secondary',
              fontWeight: 600,
              lineHeight: 1.2,
              flexShrink: 0,
            }}
          >
            +{overflow} more
          </Box>
        ) : null}
      </Stack>
    </Tooltip>
  );
};

export default UserEntityOnboardingStatusCell;
