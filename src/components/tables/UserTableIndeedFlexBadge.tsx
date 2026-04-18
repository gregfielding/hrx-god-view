import React from 'react';
import { Box, Tooltip } from '@mui/material';

type Props = {
  user: Record<string, unknown> | null | undefined;
  /** When true, no top margin — use inline with other row icons. */
  compact?: boolean;
};

const UserTableIndeedFlexBadge: React.FC<Props> = ({ user, compact }) => {
  if (!user || user.addedToIndeedFlex !== true) return null;
  return (
    <Box sx={{ mt: compact ? 0 : 0.25, lineHeight: 0 }}>
      <Tooltip title="Added to Indeed Flex">
        <Box
          component="img"
          src="/img/flex.png"
          alt="Indeed Flex"
          sx={{
            height: 18,
            width: 'auto',
            maxWidth: 80,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </Tooltip>
    </Box>
  );
};

export default UserTableIndeedFlexBadge;
