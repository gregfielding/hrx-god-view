import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Slider,
  Divider,
  Card,
  CardContent,
  CardHeader,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SecurityIcon from '@mui/icons-material/Security';
import PeopleIcon from '@mui/icons-material/People';
import ChatIcon from '@mui/icons-material/Chat';
import CampaignIcon from '@mui/icons-material/Campaign';
import { useAuth } from '../../../../contexts/AuthContext';
import { 
  SecurityLevelAIEngagement, 
  SECURITY_LEVELS, 
  getTenantAIEngagementSettings, 
  updateTenantAIEngagementSettings 
} from '../../../../utils/securityLevelAIEngagement';

interface SecurityLevelEngagementSettingsProps {
  tenantId: string;
}

const SecurityLevelEngagementSettings: React.FC<SecurityLevelEngagementSettingsProps> = ({ tenantId }) => {
  const [settings, setSettings] = useState<Record<string, SecurityLevelAIEngagement>>({});
  const [originalSettings, setOriginalSettings] = useState<Record<string, SecurityLevelAIEngagement>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { currentUser } = useAuth();

  const securityLevelLabels = {
    [SECURITY_LEVELS.ADMIN]: 'Admin',
    [SECURITY_LEVELS.MANAGER]: 'Manager',
    [SECURITY_LEVELS.WORKER]: 'Worker',
    [SECURITY_LEVELS.HIRED_STAFF]: 'Hired Staff',
    [SECURITY_LEVELS.APPLICANT]: 'Applicant',
    [SECURITY_LEVELS.SUSPENDED]: 'Suspended',
    [SECURITY_LEVELS.DISMISSED]: 'Dismissed',
  };

  const engagementTypeLabels = {
    standard: 'Standard Employee',
    applicant: 'Applicant',
    hired_staff: 'Hired Staff',
    flex_worker: 'Flex Worker',
    none: 'No Engagement',
  };

  const toneLabels = {
    professional: 'Professional',
    casual: 'Casual',
    supportive: 'Supportive',
    none: 'None',
  };

  const frequencyLabels = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    none: 'None',
  };

  useEffect(() => {
    loadSettings();
  }, [tenantId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await getTenantAIEngagementSettings(tenantId);
      setSettings(data);
      setOriginalSettings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSettingChange = (securityLevel: string, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [securityLevel]: {
        ...prev[securityLevel],
        [field]: value,
      },
    }));
  };

  const handleModuleChange = (securityLevel: string, moduleName: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      [securityLevel]: {
        ...prev[securityLevel],
        modules: {
          ...prev[securityLevel].modules,
          [moduleName]: enabled,
        },
      },
    }));
  };

  const handleMessagingChange = (securityLevel: string, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [securityLevel]: {
        ...prev[securityLevel],
        messaging: {
          ...prev[securityLevel].messaging,
          [field]: value,
        },
      },
    }));
  };

  const handleBehaviorChange = (securityLevel: string, field: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      [securityLevel]: {
        ...prev[securityLevel],
        behavior: {
          ...prev[securityLevel].behavior,
          [field]: enabled,
        },
      },
    }));
  };

  const handleTargetingChange = (securityLevel: string, field: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      [securityLevel]: {
        ...prev[securityLevel],
        targeting: {
          ...prev[securityLevel].targeting,
          [field]: enabled,
        },
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateTenantAIEngagementSettings(tenantId, settings);
      setOriginalSettings({ ...settings });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const isChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography>Loading security level AI engagement settings...</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <SecurityIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6">Security Level AI Engagement</Typography>
        <Tooltip title="Configure how the AI engages with different types of workers based on their security level">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure AI engagement settings for each security level. This controls how the AI interacts with different types of workers, 
        including messaging tone, frequency, allowed topics, and module access.
      </Typography>

      {Object.entries(settings).map(([securityLevel, config]) => (
        <Accordion key={securityLevel} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <Typography variant="h6" sx={{ flexGrow: 1 }}>
                {securityLevelLabels[securityLevel as keyof typeof securityLevelLabels]}
              </Typography>
              <Chip 
                label={config.enabled ? 'Enabled' : 'Disabled'} 
                color={config.enabled ? 'success' : 'error'}
                size="small"
                sx={{ mr: 2 }}
              />
              <Chip 
                label={engagementTypeLabels[config.engagementType]} 
                variant="outlined"
                size="small"
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              {/* Basic Settings */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Basic Settings" />
                  <CardContent>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.enabled}
                          onChange={(e) => handleSettingChange(securityLevel, 'enabled', e.target.checked)}
                        />
                      }
                      label="Enable AI Engagement"
                      sx={{ mb: 2 }}
                    />
                    
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Engagement Type</InputLabel>
                      <Select
                        value={config.engagementType}
                        onChange={(e) => handleSettingChange(securityLevel, 'engagementType', e.target.value)}
                        label="Engagement Type"
                      >
                        {Object.entries(engagementTypeLabels).map(([value, label]) => (
                          <MenuItem key={value} value={value}>{label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Messaging Tone</InputLabel>
                      <Select
                        value={config.messaging.tone}
                        onChange={(e) => handleMessagingChange(securityLevel, 'tone', e.target.value)}
                        label="Messaging Tone"
                      >
                        {Object.entries(toneLabels).map(([value, label]) => (
                          <MenuItem key={value} value={value}>{label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth>
                      <InputLabel>Engagement Frequency</InputLabel>
                      <Select
                        value={config.messaging.frequency}
                        onChange={(e) => handleMessagingChange(securityLevel, 'frequency', e.target.value)}
                        label="Engagement Frequency"
                      >
                        {Object.entries(frequencyLabels).map(([value, label]) => (
                          <MenuItem key={value} value={value}>{label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </CardContent>
                </Card>
              </Grid>

              {/* Module Access */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Module Access" />
                  <CardContent>
                    {Object.entries(config.modules).map(([moduleName, enabled]) => (
                      <FormControlLabel
                        key={moduleName}
                        control={
                          <Switch
                            checked={enabled}
                            onChange={(e) => handleModuleChange(securityLevel, moduleName, e.target.checked)}
                            disabled={!config.enabled}
                          />
                        }
                        label={moduleName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        sx={{ mb: 1, display: 'block' }}
                      />
                    ))}
                  </CardContent>
                </Card>
              </Grid>

              {/* Behavior Settings */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="AI Behavior" />
                  <CardContent>
                    {Object.entries(config.behavior).map(([behaviorName, enabled]) => (
                      <FormControlLabel
                        key={behaviorName}
                        control={
                          <Switch
                            checked={enabled}
                            onChange={(e) => handleBehaviorChange(securityLevel, behaviorName, e.target.checked)}
                            disabled={!config.enabled}
                          />
                        }
                        label={behaviorName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        sx={{ mb: 1, display: 'block' }}
                      />
                    ))}
                  </CardContent>
                </Card>
              </Grid>

              {/* Targeting Settings */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="AI Targeting" />
                  <CardContent>
                    {Object.entries(config.targeting).map(([targetName, enabled]) => (
                      <FormControlLabel
                        key={targetName}
                        control={
                          <Switch
                            checked={enabled}
                            onChange={(e) => handleTargetingChange(securityLevel, targetName, e.target.checked)}
                            disabled={!config.enabled}
                          />
                        }
                        label={targetName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        sx={{ mb: 1, display: 'block' }}
                      />
                    ))}
                  </CardContent>
                </Card>
              </Grid>

              {/* Topics */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="Messaging Topics" />
                  <CardContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Allowed topics for AI conversations with this security level
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {config.messaging.topics.map((topic, index) => (
                        <Chip key={index} label={topic} color="primary" variant="outlined" />
                      ))}
                    </Box>
                    
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 3, mb: 2 }}>
                      Restricted topics (AI will avoid these)
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {config.messaging.restrictedTopics.map((topic, index) => (
                        <Chip key={index} label={topic} color="error" variant="outlined" />
                      ))}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      ))}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!isChanged || saving}
          sx={{ minWidth: 120 }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>

      <Snackbar open={success} autoHideDuration={6000} onClose={() => setSuccess(false)}>
        <Alert onClose={() => setSuccess(false)} severity="success">
          Security level AI engagement settings saved successfully!
        </Alert>
      </Snackbar>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default SecurityLevelEngagementSettings; 