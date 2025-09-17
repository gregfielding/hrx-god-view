import React from 'react';
import { Box, Typography, Alert } from '@mui/material';

import { useFlag } from '../hooks/useFlag';

/**
 * Example component that demonstrates how to use feature flags
 * to conditionally render new data model features
 */
const ExampleNewDataModelComponent: React.FC = () => {
  // Use the NEW_DATA_MODEL flag to conditionally render content
  const { value: newDataModelEnabled, loading } = useFlag('NEW_DATA_MODEL', false);

  // Show loading state
  if (loading) {
    return (
      <Box p={2}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  // If the new data model is not enabled, don't render anything
  if (!newDataModelEnabled) {
    return null;
  }

  // Render the new data model UI when the flag is enabled
  return (
    <Box p={2}>
      <Alert severity="info" sx={{ mb: 2 }}>
        🚀 New Data Model Features Enabled
      </Alert>
      
      <Typography variant="h6" gutterBottom>
        New Data Model Components
      </Typography>
      
      <Typography variant="body1" paragraph>
        This component is only visible when the NEW_DATA_MODEL feature flag is enabled.
        Here you would implement your new single-document data model features for:
      </Typography>
      
      <Box component="ul" sx={{ pl: 2 }}>
        <li>Single Company documents</li>
        <li>Single Worker documents</li>
        <li>Single Job Order documents</li>
        <li>New data access patterns</li>
        <li>Updated UI components</li>
      </Box>
      
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        To disable this feature, toggle the NEW_DATA_MODEL flag in Firestore at:
        tenants/{'{tenantId}'}/settings/config
      </Typography>
    </Box>
  );
};

export default ExampleNewDataModelComponent;
