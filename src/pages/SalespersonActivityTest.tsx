import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Stack,
  Alert
} from '@mui/material';
import SalespersonActivityView from '../components/SalespersonActivityView';
import { useAuth } from '../contexts/AuthContext';

const SalespersonActivityTest: React.FC = () => {
  const { user } = useAuth();
  const [salespersonId, setSalespersonId] = useState(user?.uid || '');
  const [salespersonName, setSalespersonName] = useState('Test Salesperson');
  const [salespersonEmail, setSalespersonEmail] = useState('test@example.com');
  const [tenantId, setTenantId] = useState('TgDJ4sIaC7x2n5cPs3rW'); // HRX tenant

  const handleViewActivities = () => {
    if (!salespersonId) {
      alert('Please enter a salesperson ID');
      return;
    }
  };

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Salesperson Activity View - Test Page
      </Typography>
      
      <Alert severity="info" sx={{ mb: 3 }}>
        This page demonstrates the salesperson activity tracking system. 
        It shows all activities (tasks, emails, calls, meetings, notes) performed by a specific salesperson.
      </Alert>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Configuration
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Tenant ID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            fullWidth
          />
          <TextField
            label="Salesperson ID"
            value={salespersonId}
            onChange={(e) => setSalespersonId(e.target.value)}
            fullWidth
            helperText="Enter the user ID of the salesperson to view activities for"
          />
          <TextField
            label="Salesperson Name"
            value={salespersonName}
            onChange={(e) => setSalespersonName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Salesperson Email"
            value={salespersonEmail}
            onChange={(e) => setSalespersonEmail(e.target.value)}
            fullWidth
          />
          <Button 
            variant="contained" 
            onClick={handleViewActivities}
            disabled={!salespersonId}
          >
            View Activities
          </Button>
        </Stack>
      </Paper>

      {salespersonId && (
        <SalespersonActivityView
          tenantId={tenantId}
          salespersonId={salespersonId}
          salespersonName={salespersonName}
          salespersonEmail={salespersonEmail}
        />
      )}
    </Box>
  );
};

export default SalespersonActivityTest;
