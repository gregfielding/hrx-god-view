import React, { useState } from 'react';
import { Alert, Box, CircularProgress, Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useEntityEmploymentOverview } from '../../../../hooks/useEntityEmploymentOverview';
import type { EmploymentEntityKey } from './employmentV2Types';
import EmploymentEntityTabs from './EmploymentEntityTabs';
import EmploymentEntityPanel from './EmploymentEntityPanel';
import EmploymentTab from '../EmploymentTab';

export interface EmploymentV2TabProps {
  uid: string;
  tenantId: string | null;
}

const EmploymentV2Tab: React.FC<EmploymentV2TabProps> = ({ uid, tenantId }) => {
  const [entityKey, setEntityKey] = useState<EmploymentEntityKey>('select');
  const { byEntityKey, loading, error, refetch } = useEntityEmploymentOverview({ userId: uid, tenantId });

  if (!tenantId) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">Select a tenant to view employment.</Alert>
      </Box>
    );
  }

  if (loading && !error) {
    return (
      <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Readiness by hiring entity: what is complete, what is blocking, and how assignment-specific requirements differ.
      </Typography>

      <EmploymentEntityTabs value={entityKey} onChange={setEntityKey} />
      <EmploymentEntityPanel entityKey={entityKey} overview={byEntityKey[entityKey]} onRefresh={refetch} />

      <Accordion sx={{ mt: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Legacy employment tools</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <EmploymentTab uid={uid} tenantId={tenantId} />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default EmploymentV2Tab;
