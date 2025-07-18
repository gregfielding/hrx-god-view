import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Paper,
  Divider,
  Alert,
  Radio,
  RadioGroup,
  FormControl,
  FormLabel,
} from '@mui/material';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const FlexSettings: React.FC = () => {
  const { tenantId } = useAuth();
  const [settings, setSettings] = useState({
    jobOrderSettings: {
      autoAssignWorkers: false,
      requireApproval: true,
      allowOverlapping: false,
      enableNotifications: true,
    },
    timesheetSettings: {
      enableTimesheets: false,
      requireDailySubmission: true,
      allowOvertime: false,
      autoApprove: false,
    },
    worksiteSettings: {
      workerAssignmentLocation: 'tenant', // 'tenant', 'customer', 'both'
    },
    generalSettings: {
      enableFlexModule: true,
      showJobBoard: true,
      enableAnalytics: true,
    }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customersModuleEnabled, setCustomersModuleEnabled] = useState(false);
  const [tenantName, setTenantName] = useState('');

  // Load settings from Firestore
  useEffect(() => {
    if (!tenantId) return;

    const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setSettings(prev => ({
          ...prev,
          ...data?.settings,
        }));
      } else {
        // Initialize default settings if module doesn't exist
        setSettings(prev => ({
          ...prev,
          timesheetSettings: {
            ...prev.timesheetSettings,
            enableTimesheets: false,
          }
        }));
      }
      setLoading(false);
    }, (error) => {
      console.error('Error loading flex settings:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  // Load customers module status and tenant name
  useEffect(() => {
    if (!tenantId) return;

    // Listen for customers module status
    const customersModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-customers');
    const customersUnsubscribe = onSnapshot(customersModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        setCustomersModuleEnabled(isEnabled);
      } else {
        setCustomersModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to customers module status:', error);
      setCustomersModuleEnabled(false);
    });

    // Get tenant name
    const tenantRef = doc(db, 'tenants', tenantId);
    const tenantUnsubscribe = onSnapshot(tenantRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setTenantName(data?.name || 'Your Company');
      } else {
        setTenantName('Your Company');
      }
    }, (error) => {
      console.error('Error loading tenant name:', error);
      setTenantName('Your Company');
    });

    return () => {
      customersUnsubscribe();
      tenantUnsubscribe();
    };
  }, [tenantId]);

  const handleSettingChange = async (section: string, setting: string, value: boolean | string) => {
    if (!tenantId) return;

    setSaving(true);
    try {
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      await updateDoc(flexModuleRef, {
        [`settings.${section}.${setting}`]: value
      });
      
      setSettings(prev => ({
        ...prev,
        [section]: {
          ...prev[section as keyof typeof prev],
          [setting]: value
        }
      }));
    } catch (error) {
      console.error('Error updating flex setting:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Flex Management Settings
      </Typography>
      
      {saving && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Saving changes...
        </Alert>
      )}

      {/* Job Order Settings */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Job Order Settings
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.jobOrderSettings.autoAssignWorkers}
                onChange={(e) => handleSettingChange('jobOrderSettings', 'autoAssignWorkers', e.target.checked)}
                disabled={saving}
              />
            }
            label="Auto-assign workers to job orders"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.jobOrderSettings.requireApproval}
                onChange={(e) => handleSettingChange('jobOrderSettings', 'requireApproval', e.target.checked)}
                disabled={saving}
              />
            }
            label="Require approval for job order assignments"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.jobOrderSettings.allowOverlapping}
                onChange={(e) => handleSettingChange('jobOrderSettings', 'allowOverlapping', e.target.checked)}
                disabled={saving}
              />
            }
            label="Allow overlapping job assignments"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.jobOrderSettings.enableNotifications}
                onChange={(e) => handleSettingChange('jobOrderSettings', 'enableNotifications', e.target.checked)}
                disabled={saving}
              />
            }
            label="Enable job order notifications"
          />
        </Box>
      </Paper>

      {/* Timesheets Settings */}
      {settings.timesheetSettings?.enableTimesheets && (
        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Timesheets Settings
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.timesheetSettings.requireDailySubmission}
                  onChange={(e) => handleSettingChange('timesheetSettings', 'requireDailySubmission', e.target.checked)}
                  disabled={saving}
                />
              }
              label="Require daily timesheet submission"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.timesheetSettings.allowOvertime}
                  onChange={(e) => handleSettingChange('timesheetSettings', 'allowOvertime', e.target.checked)}
                  disabled={saving}
                />
              }
              label="Allow overtime tracking"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.timesheetSettings.autoApprove}
                  onChange={(e) => handleSettingChange('timesheetSettings', 'autoApprove', e.target.checked)}
                  disabled={saving}
                />
              }
              label="Auto-approve timesheets"
            />
          </Box>
        </Paper>
      )}

      {/* Worksite Settings */}
      {customersModuleEnabled && (
        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Worksite Settings
          </Typography>
          <FormControl component="fieldset" disabled={saving}>
            <FormLabel component="legend" sx={{ mb: 2 }}>
              Where do you send Flex Workers to work?
            </FormLabel>
            <RadioGroup
              value={settings.worksiteSettings?.workerAssignmentLocation || 'tenant'}
              onChange={(e) => handleSettingChange('worksiteSettings', 'workerAssignmentLocation', e.target.value)}
            >
              <FormControlLabel
                value="tenant"
                control={<Radio />}
                label={`${tenantName} Locations`}
              />
              <FormControlLabel
                value="customer"
                control={<Radio />}
                label="Customer Locations"
              />
              <FormControlLabel
                value="both"
                control={<Radio />}
                label="Both"
              />
            </RadioGroup>
          </FormControl>
        </Paper>
      )}

      {/* General Settings */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          General Settings
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.generalSettings.enableFlexModule}
                onChange={(e) => handleSettingChange('generalSettings', 'enableFlexModule', e.target.checked)}
                disabled={saving}
              />
            }
            label="Enable Flex Management module"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.generalSettings.showJobBoard}
                onChange={(e) => handleSettingChange('generalSettings', 'showJobBoard', e.target.checked)}
                disabled={saving}
              />
            }
            label="Show Jobs Board tab"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.generalSettings.enableAnalytics}
                onChange={(e) => handleSettingChange('generalSettings', 'enableAnalytics', e.target.checked)}
                disabled={saving}
              />
            }
            label="Enable analytics and reporting"
          />
        </Box>
      </Paper>
    </Box>
  );
};

export default FlexSettings; 