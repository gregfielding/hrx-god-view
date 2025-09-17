import React, { useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';

import { useAuth } from '../contexts/AuthContext';
import { useFlag } from '../hooks/useFlag';
import { setFeatureFlag, initializeFeatureFlags } from '../utils/featureFlags';

/**
 * Test component to demonstrate the feature flag system
 * This component shows how to use the useFlag hook and manage feature flags
 */
const FeatureFlagTest: React.FC = () => {
  const { tenantId } = useAuth();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Use the NEW_DATA_MODEL flag with default value of false
  const { value: newDataModelEnabled, loading, error } = useFlag('NEW_DATA_MODEL', false);

  const handleToggleFlag = async () => {
    if (!tenantId) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      await setFeatureFlag(tenantId, 'NEW_DATA_MODEL', !newDataModelEnabled);
      setMessage({ 
        type: 'success', 
        text: `NEW_DATA_MODEL flag ${!newDataModelEnabled ? 'enabled' : 'disabled'} successfully` 
      });
    } catch (error) {
      console.error('Error toggling flag:', error);
      setMessage({ 
        type: 'error', 
        text: 'Failed to toggle feature flag' 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInitializeFlags = async () => {
    if (!tenantId) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      await initializeFeatureFlags(tenantId, {
        NEW_DATA_MODEL: false,
        // Add other default flags here as needed
      });
      setMessage({ 
        type: 'success', 
        text: 'Feature flags initialized successfully' 
      });
    } catch (error) {
      console.error('Error initializing flags:', error);
      setMessage({ 
        type: 'error', 
        text: 'Failed to initialize feature flags' 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" p={4}>
        <CircularProgress />
        <Typography variant="body2" sx={{ ml: 2 }}>
          Loading feature flags...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Error loading feature flags: {error}
      </Alert>
    );
  }

  return (
    <Card sx={{ maxWidth: 600, m: 2 }}>
      <CardHeader 
        title="Feature Flag Test" 
        subheader="Test the NEW_DATA_MODEL feature flag system"
      />
      <CardContent>
        {message && (
          <Alert 
            severity={message.type} 
            sx={{ mb: 2 }}
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        )}

        <Box mb={3}>
          <Typography variant="h6" gutterBottom>
            Current Flag Status
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={newDataModelEnabled}
                onChange={handleToggleFlag}
                disabled={saving}
                color="primary"
              />
            }
            label={`NEW_DATA_MODEL: ${newDataModelEnabled ? 'Enabled' : 'Disabled'}`}
          />
        </Box>

        <Box mb={3}>
          <Typography variant="body2" color="text.secondary">
            This demonstrates the feature flag system. When enabled, new UI components 
            and data model features will be available. When disabled, the application 
            will use the existing data model.
          </Typography>
        </Box>

        <Box display="flex" gap={2}>
          <Button
            variant="contained"
            onClick={handleToggleFlag}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={20} /> : null}
          >
            {saving ? 'Saving...' : `Turn ${newDataModelEnabled ? 'Off' : 'On'} NEW_DATA_MODEL`}
          </Button>
          
          <Button
            variant="outlined"
            onClick={handleInitializeFlags}
            disabled={saving}
          >
            Initialize Flags
          </Button>
        </Box>

        <Box mt={3}>
          <Typography variant="subtitle2" color="text.secondary">
            Firestore Path: tenants/{tenantId}/settings/config
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Flag Structure: {JSON.stringify({ flags: { NEW_DATA_MODEL: newDataModelEnabled } }, null, 2)}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default FeatureFlagTest;
