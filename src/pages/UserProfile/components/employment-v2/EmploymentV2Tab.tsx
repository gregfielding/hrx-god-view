import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAuth } from '../../../../contexts/AuthContext';
import { useEntityEmploymentOverview } from '../../../../hooks/useEntityEmploymentOverview';
import type { EmploymentEntityKey } from './employmentV2Types';
import EmploymentEntityTabs from './EmploymentEntityTabs';
import EmploymentEntityPanel from './EmploymentEntityPanel';
import EmploymentTab from '../EmploymentTab';

export interface EmploymentV2TabProps {
  uid: string;
  tenantId: string | null;
  /** Security level ≥ 4 / recruiter tooling — enables on-call labor pool hire. */
  allowStartOnCallEmployment?: boolean;
}

const EmploymentV2Tab: React.FC<EmploymentV2TabProps> = ({ uid, tenantId, allowStartOnCallEmployment }) => {
  const [entityKey, setEntityKey] = useState<EmploymentEntityKey>('select');
  const { activeTenant } = useAuth();
  const tenantSlug =
    activeTenant && typeof activeTenant.slug === 'string' && activeTenant.slug.trim() !== ''
      ? activeTenant.slug.trim()
      : undefined;
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
        Readiness by hiring entity: the relationship path (I-9, forms, payroll, internal readiness) is separate from job
        package requirements and screening orders in the assignment section below.
      </Typography>

      <EmploymentEntityTabs
        value={entityKey}
        onChange={setEntityKey}
        trailingAction={
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />
      <EmploymentEntityPanel
        entityKey={entityKey}
        overview={byEntityKey[entityKey]}
        profileUserId={uid}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        onRefresh={refetch}
        allowStartOnCallEmployment={allowStartOnCallEmployment}
      />

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
