import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Alert,
  Button,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Autocomplete,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const FlexSettings: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [settings, setSettings] = useState({
    jobOrderEnabled: true,
    jobOrderVisibility: 'all', // 'all', 'managers', 'workers'
    autoAssignment: false,
    skillMatching: true,
    locationBasedMatching: true,
    maxAssignmentsPerWorker: 3,
    allowSelfAssignment: true,
    requireApproval: false,
    notificationSettings: {
      newJobOrders: true,
      assignmentUpdates: true,
      skillMatches: true,
    },
    visibilityRules: {
      showSalary: false,
      showClientDetails: true,
      showLocation: true,
      showDuration: true,
    },
  });

  useEffect(() => {
    loadSettings();
  }, [tenantId]);

  const loadSettings = async () => {
    if (!tenantId) return;
    
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'flex');
      const settingsDoc = await getDoc(settingsRef);
      
      if (settingsDoc.exists()) {
        setSettings(prev => ({ ...prev, ...settingsDoc.data() }));
      }
    } catch (error) {
      console.error('Error loading flex settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    
    setSaving(true);
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'flex');
      await updateDoc(settingsRef, {
        ...settings,
        updatedAt: new Date(),
      });
      
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      console.error('Error saving flex settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleNestedSettingChange = (parentKey: string, childKey: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [parentKey]: {
        ...(prev as any)[parentKey],
        [childKey]: value,
      },
    }));
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading Flex Settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        HRX Flex Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Configure job order functionality and visibility rules for your workforce.
      </Typography>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Job Order Functionality */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Job Order Functionality" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.jobOrderEnabled}
                    onChange={(e) => handleSettingChange('jobOrderEnabled', e.target.checked)}
                  />
                }
                label="Enable Job Orders"
              />
              
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>Job Order Visibility</InputLabel>
                <Select
                  value={settings.jobOrderVisibility}
                  onChange={(e) => handleSettingChange('jobOrderVisibility', e.target.value)}
                  label="Job Order Visibility"
                >
                  <MenuItem value="all">All Workers</MenuItem>
                  <MenuItem value="managers">Managers Only</MenuItem>
                  <MenuItem value="workers">Workers Only</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.autoAssignment}
                    onChange={(e) => handleSettingChange('autoAssignment', e.target.checked)}
                  />
                }
                label="Enable Auto-Assignment"
                sx={{ mt: 2, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.skillMatching}
                    onChange={(e) => handleSettingChange('skillMatching', e.target.checked)}
                  />
                }
                label="Enable Skill Matching"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.locationBasedMatching}
                    onChange={(e) => handleSettingChange('locationBasedMatching', e.target.checked)}
                  />
                }
                label="Enable Location-Based Matching"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Assignment Rules */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Assignment Rules" />
            <CardContent>
              <TextField
                fullWidth
                type="number"
                label="Max Assignments Per Worker"
                value={settings.maxAssignmentsPerWorker}
                onChange={(e) => handleSettingChange('maxAssignmentsPerWorker', parseInt(e.target.value))}
                sx={{ mb: 2 }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.allowSelfAssignment}
                    onChange={(e) => handleSettingChange('allowSelfAssignment', e.target.checked)}
                  />
                }
                label="Allow Self-Assignment"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.requireApproval}
                    onChange={(e) => handleSettingChange('requireApproval', e.target.checked)}
                  />
                }
                label="Require Manager Approval"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Notification Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Notification Settings" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.newJobOrders}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'newJobOrders', e.target.checked)}
                  />
                }
                label="New Job Orders"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.assignmentUpdates}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'assignmentUpdates', e.target.checked)}
                  />
                }
                label="Assignment Updates"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.skillMatches}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'skillMatches', e.target.checked)}
                  />
                }
                label="Skill Matches"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Visibility Rules */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Visibility Rules" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.visibilityRules.showSalary}
                    onChange={(e) => handleNestedSettingChange('visibilityRules', 'showSalary', e.target.checked)}
                  />
                }
                label="Show Salary Information"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.visibilityRules.showClientDetails}
                    onChange={(e) => handleNestedSettingChange('visibilityRules', 'showClientDetails', e.target.checked)}
                  />
                }
                label="Show Client Details"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.visibilityRules.showLocation}
                    onChange={(e) => handleNestedSettingChange('visibilityRules', 'showLocation', e.target.checked)}
                  />
                }
                label="Show Location"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.visibilityRules.showDuration}
                    onChange={(e) => handleNestedSettingChange('visibilityRules', 'showDuration', e.target.checked)}
                  />
                }
                label="Show Duration"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          size="large"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
};

export default FlexSettings; 