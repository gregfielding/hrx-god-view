import React from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';

type Props = {
  value: any;
  tenantName?: string;
  submitting?: boolean;
  onSubmit: () => void;
};

const ReviewSubmitStep: React.FC<Props> = ({ value, tenantName, submitting, onSubmit }) => {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Review your application</Typography>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={1}>
        <Typography variant="body2">Personal: {JSON.stringify(value.personal || {}, null, 2)}</Typography>
        <Typography variant="body2">Resume: {value.resume?.parsed ? 'Parsed' : 'Not provided'}</Typography>
        <Typography variant="body2">Qualifications: {value.qualifications ? 'Included' : 'Not provided'}</Typography>
      </Stack>
      <Stack direction="row" justifyContent="flex-end" mt={3}>
        <Button variant="contained" onClick={onSubmit} disabled={!!submitting}>Submit Application</Button>
      </Stack>
    </Box>
  );
};

export default ReviewSubmitStep;


