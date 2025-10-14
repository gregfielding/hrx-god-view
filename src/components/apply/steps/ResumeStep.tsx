import React from 'react';
import { Box, Typography } from '@mui/material';
import ResumeUpload from '../../../components/ResumeUpload';

type Props = {
  tenantId: string;
  value: any;
  onChange: (v: any) => void;
};

const ResumeStep: React.FC<Props> = ({ tenantId, value, onChange }) => {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Upload your resume (PDF/Word/TXT)</Typography>
      <ResumeUpload
        userId={value?.userId || ''}
        tenantId={tenantId}
        onResumeParsed={(parsed) => onChange({ ...(value || {}), parsed })}
      />
    </Box>
  );
};

export default ResumeStep;


