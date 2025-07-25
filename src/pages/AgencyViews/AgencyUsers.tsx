import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import ContactsTab from '../AgencyProfile/components/ContactsTab';

const AgencyUsers: React.FC = () => {
  const { tenantId } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Users
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => setShowForm(true)}
        >
          Add New User
        </Button>
      </Box>
      <ContactsTab tenantId={tenantId} showForm={showForm} setShowForm={setShowForm} />
    </Box>
  );
};

export default AgencyUsers; 