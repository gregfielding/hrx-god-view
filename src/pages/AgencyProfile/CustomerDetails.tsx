import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Tabs, Tab, Paper, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SmartToyIcon from '@mui/icons-material/SmartToy';

import { db } from '../../firebase';
import LocationsTab from '../CustomerProfile/components/LocationsTab';
import AITrainingTab from '../CustomerProfile/components/AITrainingTab';

import AgencyContactsTab from './AgencyContactsTab';

const tabLabels = [
  { label: 'Locations', icon: <LocationOnIcon /> },
  { label: 'Org Chart', icon: <AccountTreeIcon /> },
  { label: 'AI Training', icon: <SmartToyIcon /> },
];

interface CustomerDetailsProps {
  tenantId: string;
}

const CustomerDetails: React.FC<CustomerDetailsProps> = ({ tenantId, ...props }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [customerName, setCustomerName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCustomer = async () => {
      setLoading(true);
      try {
        const customerRef = doc(db, 'tenants', tenantId);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          setCustomerName(customerSnap.data().name || 'Customer');
        } else {
          setCustomerName('Customer');
        }
      } catch {
        setCustomerName('Customer');
      }
      setLoading(false);
    };
    fetchCustomer();
  }, [tenantId]);

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 500 }}>
      {/* Left vertical menu */}
      <Paper
        elevation={2}
        sx={{
          minWidth: 220,
          pt: 2,
          pb: 2,
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          background: 'rgba(20,20,20,0.98)',
        }}
      >
        <Tabs
          orientation="vertical"
          value={tab}
          onChange={(_, newValue) => setTab(newValue)}
          sx={{
            borderRight: 1,
            borderColor: 'divider',
            minWidth: 180,
            width: '100%',
            '.MuiTab-root': {
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              textAlign: 'left',
              pl: 2,
              pr: 2,
              minHeight: 48,
              fontWeight: 500,
              color: '#bbb',
            },
            '.Mui-selected': {
              color: '#fff',
              background: 'rgba(0, 123, 255, 0.12)',
              borderLeft: '4px solid #2196f3',
            },
            '.MuiTabs-indicator': {
              display: 'none',
            },
          }}
        >
          {tabLabels.map((tabObj, idx) => (
            <Tab
              key={tabObj.label}
              icon={tabObj.icon}
              iconPosition="start"
              label={tabObj.label}
              sx={{
                gap: 1.5,
                minHeight: 48,
                borderRadius: 0,
                textTransform: 'none',
                fontSize: 16,
              }}
            />
          ))}
        </Tabs>
      </Paper>
      {/* Main content area */}
      <Box sx={{ flex: 1, p: 4 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          {loading ? (
            <Box display="flex" alignItems="center" gap={2}>
              <CircularProgress size={24} />
              <Typography variant="h4" gutterBottom>
                Loading...
              </Typography>
            </Box>
          ) : (
            <Typography variant="h4" gutterBottom>
              {customerName}
            </Typography>
          )}
          <Button variant="outlined" onClick={() => navigate(`/tenants/${tenantId}?tab=7`)}>
            &larr; Back to Customers
          </Button>
        </Box>
        {tab === 0 && <LocationsTab tenantId={tenantId} />}
        {tab === 1 && <AgencyContactsTab tenantId={tenantId} />}
        {tab === 2 && <AITrainingTab tenantId={tenantId} />}
      </Box>
    </Box>
  );
};

export default CustomerDetails;
