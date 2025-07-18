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
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../../../contexts/AuthContext';

interface ConversationSettingsProps {
  tenantId: string;
}

const ConversationSettings: React.FC<ConversationSettingsProps> = ({ tenantId }) => {
  const [settings, setSettings] = useState({
    confidence: {
      threshold: 0.7,
      enableLowConfidenceAlerts: true,
      autoEscalateThreshold: 0.3,
    },
    escalation: {
      enabled: true,
      delayMinutes: 5,
      maxAttempts: 3,
      escalationChannels: ['manager', 'hr', 'support'],
    },
    privacy: {
      enableAnonymousMode: true,
      defaultAnonymous: false,
      allowWorkerChoice: true,
      anonymizeInLogs: true,
    },
    conversation: {
      maxLength: 50,
      autoArchiveDays: 30,
      enableContextRetention: true,
      contextRetentionDays: 7,
      enableConversationHistory: true,
    },
    responses: {
      enableAutoResponses: true,
      responseDelaySeconds: 2,
      enableTypingIndicators: true,
      maxResponseLength: 500,
    },
  });
  const [originalSettings, setOriginalSettings] = useState(settings);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const conversationRef = doc(db, 'tenants', tenantId, 'aiSettings', 'conversation');
        const conversationSnap = await getDoc(conversationRef);
        if (conversationSnap.exists()) {
          const data = conversationSnap.data();
          setSettings((data as typeof settings) || settings);
          setOriginalSettings((data as typeof settings) || settings);
        }
      } catch (err) {
        setError('Failed to fetch conversation settings');
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleSettingChange = (section: string, field: string, value: any) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'conversation');
      await setDoc(ref, settings, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ConversationSettings_${Date.now()}`), {
        tenantId,
        section: 'ConversationSettings',
        changed: 'conversation_settings',
        oldValue: originalSettings,
        newValue: settings,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['ConversationEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'ConversationSettings',
      });
      setOriginalSettings({ ...settings });
      setSuccess(true);
    } catch (err) {
      setError('Failed to save conversation settings');
    }
  };

  const isChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Conversation & AI Chat Settings
        <Tooltip title="Configure how the AI handles conversations, confidence levels, and escalation.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      {/* Confidence Settings */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Confidence & Response Quality</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography gutterBottom>
                Confidence Threshold: {settings.confidence.threshold}
              </Typography>
              <Slider
                value={settings.confidence.threshold}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(_, value) => handleSettingChange('confidence', 'threshold', value)}
              />
              <Typography variant="caption" color="text.secondary">
                Minimum confidence required for AI responses
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography gutterBottom>
                Auto-Escalate Threshold: {settings.confidence.autoEscalateThreshold}
              </Typography>
              <Slider
                value={settings.confidence.autoEscalateThreshold}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(_, value) =>
                  handleSettingChange('confidence', 'autoEscalateThreshold', value)
                }
              />
              <Typography variant="caption" color="text.secondary">
                Confidence level below which to auto-escalate
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.confidence.enableLowConfidenceAlerts}
                    onChange={(e) =>
                      handleSettingChange(
                        'confidence',
                        'enableLowConfidenceAlerts',
                        e.target.checked,
                      )
                    }
                  />
                }
                label="Enable Low Confidence Alerts"
              />
              <Tooltip title="Alert managers when AI confidence is low">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Escalation Settings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Escalation Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.escalation.enabled}
                    onChange={(e) => handleSettingChange('escalation', 'enabled', e.target.checked)}
                  />
                }
                label="Enable Auto-Escalation"
              />
              <Tooltip title="Automatically escalate conversations when needed">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Escalation Delay (minutes)"
                type="number"
                value={settings.escalation.delayMinutes}
                onChange={(e) =>
                  handleSettingChange('escalation', 'delayMinutes', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 1, max: 60 }}
                disabled={!settings.escalation.enabled}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Max Escalation Attempts"
                type="number"
                value={settings.escalation.maxAttempts}
                onChange={(e) =>
                  handleSettingChange('escalation', 'maxAttempts', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 1, max: 10 }}
                disabled={!settings.escalation.enabled}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Escalation Channels</InputLabel>
                <Select
                  multiple
                  value={settings.escalation.escalationChannels}
                  label="Escalation Channels"
                  onChange={(e) =>
                    handleSettingChange('escalation', 'escalationChannels', e.target.value)
                  }
                  disabled={!settings.escalation.enabled}
                >
                  <MenuItem value="manager">Manager</MenuItem>
                  <MenuItem value="hr">HR</MenuItem>
                  <MenuItem value="support">Support</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Privacy Settings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Privacy & Anonymity</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.privacy.enableAnonymousMode}
                    onChange={(e) =>
                      handleSettingChange('privacy', 'enableAnonymousMode', e.target.checked)
                    }
                  />
                }
                label="Enable Anonymous Mode"
              />
              <Tooltip title="Allow workers to have anonymous conversations">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.privacy.defaultAnonymous}
                    onChange={(e) =>
                      handleSettingChange('privacy', 'defaultAnonymous', e.target.checked)
                    }
                    disabled={!settings.privacy.enableAnonymousMode}
                  />
                }
                label="Default to Anonymous"
              />
              <Tooltip title="New conversations start anonymous by default">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.privacy.allowWorkerChoice}
                    onChange={(e) =>
                      handleSettingChange('privacy', 'allowWorkerChoice', e.target.checked)
                    }
                    disabled={!settings.privacy.enableAnonymousMode}
                  />
                }
                label="Allow Worker Choice"
              />
              <Tooltip title="Workers can choose whether to be anonymous">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.privacy.anonymizeInLogs}
                    onChange={(e) =>
                      handleSettingChange('privacy', 'anonymizeInLogs', e.target.checked)
                    }
                  />
                }
                label="Anonymize in Logs"
              />
              <Tooltip title="Remove identifying information from conversation logs">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Conversation Management */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Conversation Management</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <TextField
                label="Max Conversation Length"
                type="number"
                value={settings.conversation.maxLength}
                onChange={(e) =>
                  handleSettingChange('conversation', 'maxLength', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 10, max: 200 }}
                helperText="Maximum messages per conversation"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Auto-Archive Days"
                type="number"
                value={settings.conversation.autoArchiveDays}
                onChange={(e) =>
                  handleSettingChange('conversation', 'autoArchiveDays', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 1, max: 365 }}
                helperText="Days before auto-archiving conversations"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Context Retention Days"
                type="number"
                value={settings.conversation.contextRetentionDays}
                onChange={(e) =>
                  handleSettingChange(
                    'conversation',
                    'contextRetentionDays',
                    parseInt(e.target.value),
                  )
                }
                fullWidth
                inputProps={{ min: 1, max: 30 }}
                disabled={!settings.conversation.enableContextRetention}
                helperText="Days to retain conversation context"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.conversation.enableContextRetention}
                    onChange={(e) =>
                      handleSettingChange(
                        'conversation',
                        'enableContextRetention',
                        e.target.checked,
                      )
                    }
                  />
                }
                label="Enable Context Retention"
              />
              <Tooltip title="Retain conversation context for future interactions">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.conversation.enableConversationHistory}
                    onChange={(e) =>
                      handleSettingChange(
                        'conversation',
                        'enableConversationHistory',
                        e.target.checked,
                      )
                    }
                  />
                }
                label="Enable Conversation History"
              />
              <Tooltip title="Store conversation history for reference">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Response Settings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Response Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.responses.enableAutoResponses}
                    onChange={(e) =>
                      handleSettingChange('responses', 'enableAutoResponses', e.target.checked)
                    }
                  />
                }
                label="Enable Auto-Responses"
              />
              <Tooltip title="Allow AI to send automatic responses">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Response Delay (seconds)"
                type="number"
                value={settings.responses.responseDelaySeconds}
                onChange={(e) =>
                  handleSettingChange('responses', 'responseDelaySeconds', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 0, max: 30 }}
                disabled={!settings.responses.enableAutoResponses}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Max Response Length"
                type="number"
                value={settings.responses.maxResponseLength}
                onChange={(e) =>
                  handleSettingChange('responses', 'maxResponseLength', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 50, max: 2000 }}
                disabled={!settings.responses.enableAutoResponses}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.responses.enableTypingIndicators}
                    onChange={(e) =>
                      handleSettingChange('responses', 'enableTypingIndicators', e.target.checked)
                    }
                    disabled={!settings.responses.enableAutoResponses}
                  />
                }
                label="Enable Typing Indicators"
              />
              <Tooltip title="Show typing indicators during AI responses">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Conversation Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Conversation settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default ConversationSettings;
