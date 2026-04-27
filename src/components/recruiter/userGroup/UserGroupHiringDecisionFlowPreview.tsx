import React from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import type { UserGroupHiringConfigV1 } from '../../../types/userGroupHiringConfig';
import { buildDecisionFlowSteps } from '../../../utils/userGroupHiringPipeline';

export type UserGroupHiringDecisionFlowPreviewProps = {
  cfg: UserGroupHiringConfigV1;
};

const UserGroupHiringDecisionFlowPreview: React.FC<UserGroupHiringDecisionFlowPreviewProps> = ({ cfg }) => {
  const steps = buildDecisionFlowSteps(cfg);

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        bgcolor: 'grey.50',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={800}>
          What happens when someone applies?
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          Flow from your settings — not legal copy.
        </Typography>
      </Box>
      <Stack spacing={0} sx={{ px: 1.5, pb: 1.5, position: 'relative' }}>
        <Box
          sx={{
            position: 'absolute',
            left: 22,
            top: 12,
            bottom: 12,
            width: 2,
            bgcolor: 'divider',
            borderRadius: 1,
          }}
        />
        {steps.map((s, i) => (
          <Stack key={i} direction="row" spacing={1.25} alignItems="flex-start" sx={{ py: 0.65, pl: 0.25 }}>
            <Box
              sx={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 800,
                zIndex: 1,
              }}
            >
              {i + 1}
            </Box>
            <Box
              sx={{
                flex: 1,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.45 }}>
                {s.text}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};

export default UserGroupHiringDecisionFlowPreview;
