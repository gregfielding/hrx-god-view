import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';
import ResumeUpload from '../../../components/ResumeUpload';

type Props = {
  uid: string;
  /** Same resolution as other profile tabs — required for admin “parse on behalf of” server checks. */
  tenantId?: string | null;
};

const ResumeTab: React.FC<Props> = ({ uid, tenantId: tenantIdProp }) => {
  const { tenantId: authTenantId, activeTenant } = useAuth();
  const effectiveTenantId = tenantIdProp || authTenantId || activeTenant?.id || undefined;

  const handleResumeParsed = (parsedData: any) => {
    // ResumeUpload component handles saving to Firestore
    // This callback can be used for additional actions if needed
    console.log('Resume parsed:', parsedData);
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      <Typography variant="h5" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
        Resume Upload
      </Typography>

      <Paper sx={{ p: 3 }}>
        <ResumeUpload
          userId={uid}
          tenantId={effectiveTenantId}
          onResumeParsed={handleResumeParsed}
        />
      </Paper>
    </Box>
  );
};

export default ResumeTab;
