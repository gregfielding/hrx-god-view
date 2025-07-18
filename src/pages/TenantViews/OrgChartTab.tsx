import React, { useState } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import OrgTreeView from './OrgTreeView';
import PeopleGridView from './PeopleGridView';
import HeatmapView from './HeatmapView';

const OrgChartTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [view, setView] = useState(0);
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => setView(newValue);

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs value={view} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab label="Org Tree View" />
        <Tab label="People Grid View" />
        <Tab label="Heatmap View" />
      </Tabs>
      {view === 0 && (
        <Box>
          <OrgTreeView tenantId={tenantId} />
        </Box>
      )}
      {view === 1 && (
        <Box>
          <PeopleGridView tenantId={tenantId} />
        </Box>
      )}
      {view === 2 && (
        <Box>
          <HeatmapView tenantId={tenantId} />
        </Box>
      )}
    </Box>
  );
};

export default OrgChartTab; 