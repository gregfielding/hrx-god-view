import React from 'react';
import { Stack, Card, CardContent, Typography } from '@mui/material';
import { useT } from '../../../i18n';

const WorkerStatusCards: React.FC = () => {
  const t = useT();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Card variant="outlined" sx={{ minWidth: 160 }}>
        <CardContent>
          <Typography variant="caption" color="text.secondary">{t('applications.status')}</Typography>
          <Typography variant="body2">—</Typography>
        </CardContent>
      </Card>
    </Stack>
  );
};

export default WorkerStatusCards;
