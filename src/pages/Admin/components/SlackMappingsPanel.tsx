/**
 * Slack Mappings Panel
 * 
 * Reuses the existing SlackMappingsTab content for the admin page.
 */

import React from 'react';
import { Paper } from '@mui/material';
import SlackMappingsTab from '../../TenantViews/SlackMappingsTab';

interface SlackMappingsPanelProps {
  tenantId: string;
}

const SlackMappingsPanel: React.FC<SlackMappingsPanelProps> = ({ tenantId }) => {
  return (
    <Paper elevation={1} sx={{ px: 2, py: 3, borderRadius: 0 }}>
      <SlackMappingsTab tenantId={tenantId} />
    </Paper>
  );
};

export default SlackMappingsPanel;



