import React from 'react';
import { Box } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import CalendarWidget from '../components/CalendarWidget';

const CalendarPage: React.FC = () => {
  const { user, activeTenant, tenantId } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId || '';

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <CalendarWidget
            userId={user?.uid || ''}
            tenantId={effectiveTenantId}
            preloadedContacts={[]}
            preloadedSalespeople={[]}
            preloadedCompanies={[]}
            preloadedDeals={[]}
            variant="page"
            initialView="month"
          />
        </Box>
      </Box>
    </Box>
  );
};

export default CalendarPage;


