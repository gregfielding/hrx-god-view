import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  CircularProgress,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';

interface HelloMessageSettings {
  templates: {
    en: string[];
    es: string[];
  };
  triggers: {
    onLogin: boolean;
    dailyCheckin: boolean;
    weeklyCheckin: boolean;
  };
  timing: {
    loginDelayMinutes: number;
    dailyCheckinHour: number;
    weeklyCheckinDay: number;
  };
  enabled: boolean;
  createdAt?: any;
  updatedAt?: any;
}

const HelloMessageConfig: React.FC = () => {
  const [settings, setSettings] = useState<HelloMessageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<{
    language: 'en' | 'es';
    index: number;
    text: string;
  } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ language: 'en' as 'en' | 'es', text: '' });

  const navigate = useNavigate();
  const functions = getFunctions();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const getHelloMessageSettings = httpsCallable(functions, 'getHelloMessageSettings');
      const result = await getHelloMessageSettings();
      setSettings(result.data as HelloMessageSettings);
    } catch (error: any) {
      setError(`Failed to load settings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    
    try {
      setSaving(true);
      const updateHelloMessageSettings = httpsCallable(functions, 'updateHelloMessageSettings');
      await updateHelloMessageSettings({ settings });
      setSuccess('Settings saved successfully!');
    } catch (error: any) {
      setError(`Failed to save settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateEdit = (language: 'en' | 'es', index: number) => {
    const template = settings?.templates[language][index] || '';
    setEditingTemplate({ language, index, text: template });
  };

  const handleTemplateSave = () => {
    if (!editingTemplate || !settings) return;
    
    const newSettings = { ...settings };
    newSettings.templates[editingTemplate.language][editingTemplate.index] = editingTemplate.text;
    setSettings(newSettings);
    setEditingTemplate(null);
  };

  const handleTemplateDelete = (language: 'en' | 'es', index: number) => {
    if (!settings) return;
    
    const newSettings = { ...settings };
    newSettings.templates[language].splice(index, 1);
    setSettings(newSettings);
  };

  const handleAddTemplate = async () => {
    if (!newTemplate.text.trim() || !settings) return;
    
    const newSettings = { ...settings };
    newSettings.templates[newTemplate.language].push(newTemplate.text.trim());
    setSettings(newSettings);
    setNewTemplate({ language: 'en', text: '' });
    setShowAddDialog(false);
  };

  const handleTestHelloMessage = async () => {
    try {
      const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
      await sendHelloMessage({ userId: 'test', language: 'en' });
      setSuccess('Test hello message sent successfully!');
    } catch (error: any) {
      setError(`Failed to send test message: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!settings) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load hello message settings</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h3">
          Hello Message Config
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ fontWeight: 600 }}
        >
          Back to Launchpad
        </Button>
      </Box>
      {/* <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/admin')} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1">
          Hello Message Configuration
        </Typography>
      </Box> */}

      {/* Main Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          General Settings
        </Typography>
        
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                />
              }
              label="Enable Hello Messages"
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Login Delay (minutes)</InputLabel>
              <Select
                value={settings.timing.loginDelayMinutes}
                onChange={(e) => setSettings({
                  ...settings,
                  timing: { ...settings.timing, loginDelayMinutes: e.target.value as number }
                })}
              >
                <MenuItem value={0}>Immediate</MenuItem>
                <MenuItem value={1}>1 minute</MenuItem>
                <MenuItem value={5}>5 minutes</MenuItem>
                <MenuItem value={15}>15 minutes</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Triggers */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Trigger Settings
        </Typography>
        
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.triggers.onLogin}
                  onChange={(e) => setSettings({
                    ...settings,
                    triggers: { ...settings.triggers, onLogin: e.target.checked }
                  })}
                />
              }
              label="Send on Login"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.triggers.dailyCheckin}
                  onChange={(e) => setSettings({
                    ...settings,
                    triggers: { ...settings.triggers, dailyCheckin: e.target.checked }
                  })}
                />
              }
              label="Daily Check-in"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.triggers.weeklyCheckin}
                  onChange={(e) => setSettings({
                    ...settings,
                    triggers: { ...settings.triggers, weeklyCheckin: e.target.checked }
                  })}
                />
              }
              label="Weekly Check-in"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Message Templates */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Message Templates
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddDialog(true)}
          >
            Add Template
          </Button>
        </Box>

        {/* English Templates */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">
              English Templates ({settings.templates.en.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <List>
              {settings.templates.en.map((template, index) => (
                <ListItem key={index} divider>
                  <ListItemText
                    primary={template}
                    secondary={`Template ${index + 1}`}
                  />
                  <Box>
                    <IconButton
                      onClick={() => handleTemplateEdit('en', index)}
                      size="small"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      onClick={() => handleTemplateDelete('en', index)}
                      size="small"
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>

        {/* Spanish Templates */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">
              Spanish Templates ({settings.templates.es.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <List>
              {settings.templates.es.map((template, index) => (
                <ListItem key={index} divider>
                  <ListItemText
                    primary={template}
                    secondary={`Template ${index + 1}`}
                  />
                  <Box>
                    <IconButton
                      onClick={() => handleTemplateEdit('es', index)}
                      size="small"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      onClick={() => handleTemplateDelete('es', index)}
                      size="small"
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      </Paper>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={handleTestHelloMessage}
          disabled={!settings.enabled}
        >
          Test Hello Message
        </Button>
        <Button
          variant="contained"
          onClick={saveSettings}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>

      {/* Edit Template Dialog */}
      <Dialog
        open={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Edit Template
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={3}
            value={editingTemplate?.text || ''}
            onChange={(e) => setEditingTemplate(editingTemplate ? {
              ...editingTemplate,
              text: e.target.value
            } : null)}
            placeholder="Enter template text..."
            sx={{ mt: 1 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Use {'{firstName}'} as a placeholder for the user's first name
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingTemplate(null)}>
            Cancel
          </Button>
          <Button onClick={handleTemplateSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Template Dialog */}
      <Dialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Add New Template
        </DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Language</InputLabel>
            <Select
              value={newTemplate.language}
              onChange={(e) => setNewTemplate({
                ...newTemplate,
                language: e.target.value as 'en' | 'es'
              })}
            >
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="es">Spanish</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            multiline
            rows={3}
            value={newTemplate.text}
            onChange={(e) => setNewTemplate({
              ...newTemplate,
              text: e.target.value
            })}
            placeholder="Enter template text..."
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Use {'{firstName}'} as a placeholder for the user's first name
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAddTemplate}
            variant="contained"
            disabled={!newTemplate.text.trim()}
          >
            Add Template
          </Button>
        </DialogActions>
      </Dialog>

      {/* Notifications */}
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>

      <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess('')}>
        <Alert onClose={() => setSuccess('')} severity="success">
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default HelloMessageConfig; 