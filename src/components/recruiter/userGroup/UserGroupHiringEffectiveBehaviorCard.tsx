import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
import {
  getUserGroupHiringEffectiveBehaviorSummary,
  type UserGroupHiringConfigV1,
} from '../../../types/userGroupHiringConfig';

export type UserGroupHiringEffectiveBehaviorCardProps = {
  cfg: UserGroupHiringConfigV1;
};

/**
 * Short human-readable summary of what the saved config implies (v1 — execution not wired).
 */
const UserGroupHiringEffectiveBehaviorCard: React.FC<UserGroupHiringEffectiveBehaviorCardProps> = ({ cfg }) => {
  const { lines } = getUserGroupHiringEffectiveBehaviorSummary(cfg);

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'primary.light',
        bgcolor: 'rgba(0, 87, 184, 0.04)',
      }}
    >
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Effective behavior
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Plain-language readout of this group&apos;s hiring settings. Automation follows these rules when backend
          processing is enabled.
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
          {lines.map((line, i) => (
            <Typography key={i} component="li" variant="body2" color="text.primary" sx={{ mb: 0.75 }}>
              {line}
            </Typography>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

export default UserGroupHiringEffectiveBehaviorCard;
