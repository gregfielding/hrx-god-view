import React from 'react';
import { Box, Tooltip } from '@mui/material';

type Props = {
  user: Record<string, unknown> | null | undefined;
  /** When true, no top margin — use inline with other row icons. */
  compact?: boolean;
};

/**
 * Mirror of `UserTableIndeedFlexBadge`. Reads `users.addedToFieldglass` and
 * renders the SAP Fieldglass logo when truthy. Same sizing / layout
 * conventions so the two badges line up cleanly when both are toggled on.
 */
const UserTableFieldglassBadge: React.FC<Props> = ({ user, compact }) => {
  if (!user || user.addedToFieldglass !== true) return null;
  return (
    <Box sx={{ mt: compact ? 0 : 0.25, lineHeight: 0 }}>
      <Tooltip title="Added to SAP Fieldglass">
        <Box
          component="img"
          src="/img/fieldglass.png"
          alt="SAP Fieldglass"
          sx={{
            height: 18,
            width: 'auto',
            maxWidth: 100,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </Tooltip>
    </Box>
  );
};

export default UserTableFieldglassBadge;
