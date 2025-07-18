import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  Message as MessageIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
  Analytics as AnalyticsIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface HelloMessageTemplate {
  id: string;
  name: string;
  category: string;
  content: {
    en: string;
    es: string;
  };
  variables: string[];
  usage: number;
  lastUsed?: Date;
  enabled: boolean;
  priority: number;
}

interface HelloMessageSettings {
  enabled: boolean;
  frequency: 'always' | 'daily' | 'weekly' | 'monthly' | 'never';
  timeOfDay: string;
  timezone: string;
  maxMessagesPerDay: number;
  cooldownHours: number;
  enablePersonalization: boolean;
  enableAnalytics: boolean;
  defaultLanguage: string;
}

interface HelloMessageAnalytics {
  totalSent: number;
  totalRead: number;
  readRate: number;
  responseRate: number;
  topTemplates: Array<{
    templateId: string;
    name: string;
    sentCount: number;
    readCount: number;
    responseCount: number;
  }>;
  languageStats: Array<{
    language: string;
    sentCount: number;
    readCount: number;
  }>;
  timeStats: Array<{
    hour: number;
    sentCount: number;
    readCount: number;
  }>;
}

const HelloMessageManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // State for different sections
  const [templates, setTemplates] = useState<HelloMessageTemplate[]>([]);
  const [settings, setSettings] = useState<HelloMessageSettings>({
    enabled: true,
    frequency: 'daily',
    timeOfDay: '09:00',
    timezone: 'America/New_York',
    maxMessagesPerDay: 100,
    cooldownHours: 24,
    enablePersonalization: true,
    enableAnalytics: true,
    defaultLanguage: 'en'
  });
  const [analytics, setAnalytics] = useState<HelloMessageAnalytics | null>(null);
  
  // Dialog states
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  
  // Form states
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'general',
    contentEn: '',
    contentEs: '',
    variables: [] as string[],
    priority: 1
  });
  
  const [testMessage, setTestMessage] = useState({
    userId: '',
    language: 'en',
    templateId: ''
  });
  
  const functions = getFunctions();

  useEffect(() => {
    loadTemplates();
    loadSettings();
    loadAnalytics();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      // Mock data for demonstration
      const mockTemplates: HelloMessageTemplate[] = [
        {
          id: '1',
          name: 'Welcome Back',
          category: 'greeting',
          content: {
            en: 'Welcome back, {firstName}! We hope you had a great day.',
            es: '¡Bienvenido de vuelta, {firstName}! Esperamos que hayas tenido un gran día.'
          },
          variables: ['firstName'],
          usage: 156,
          lastUsed: new Date(),
          enabled: true,
          priority: 1
        },
        {
          id: '2',
          name: 'Good Morning',
          category: 'morning',
          content: {
            en: 'Good morning, {firstName}! Ready for another productive day?',
            es: '¡Buenos días, {firstName}! ¿Listo para otro día productivo?'
          },
          variables: ['firstName'],
          usage: 89,
          lastUsed: new Date(),
          enabled: true,
          priority: 2
        },
        {
          id: '3',
          name: 'Weekly Check-in',
          category: 'weekly',
          content: {
            en: 'Hi {firstName}! How has your week been going?',
            es: '¡Hola {firstName}! ¿Cómo ha ido tu semana?'
          },
          variables: ['firstName'],
          usage: 45,
          lastUsed: new Date(),
          enabled: false,
          priority: 3
        }
      ];
      
      setTemplates(mockTemplates);
    } catch (error: any) {
      setError(`Error loading templates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      // This would load from the backend
      console.log('Loading hello message settings...');
    } catch (error: any) {
      setError(`Error loading settings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // Mock analytics data
      const mockAnalytics: HelloMessageAnalytics = {
        totalSent: 1234,
        totalRead: 987,
        readRate: 80.0,
        responseRate: 15.5,
        topTemplates: [
          { templateId: '1', name: 'Welcome Back', sentCount: 156, readCount: 134, responseCount: 23 },
          { templateId: '2', name: 'Good Morning', sentCount: 89, readCount: 71, responseCount: 12 },
          { templateId: '3', name: 'Weekly Check-in', sentCount: 45, readCount: 38, responseCount: 8 }
        ],
        languageStats: [
          { language: 'en', sentCount: 890, readCount: 712 },
          { language: 'es', sentCount: 344, readCount: 275 }
        ],
        timeStats: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          sentCount: Math.floor(Math.random() * 50),
          readCount: Math.floor(Math.random() * 40)
        }))
      };
      
      setAnalytics(mockAnalytics);
    } catch (error: any) {
      setError(`Error loading analytics: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    try {
      // This would save to the backend
      setSuccess('Hello message settings saved successfully!');
      setSettingsDialogOpen(false);
    } catch (error: any) {
      setError(`Error saving settings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async () => {
    setLoading(true);
    try {
      const newTemplateData: HelloMessageTemplate = {
        id: Date.now().toString(),
        name: newTemplate.name,
        category: newTemplate.category,
        content: {
          en: newTemplate.contentEn,
          es: newTemplate.contentEs
        },
        variables: extractVariables(newTemplate.contentEn),
        usage: 0,
        enabled: true,
        priority: newTemplate.priority
      };
      
      setTemplates([...templates, newTemplateData]);
      setNewTemplate({ name: '', category: 'general', contentEn: '', contentEs: '', variables: [], priority: 1 });
      setTemplateDialogOpen(false);
      setSuccess('Hello message template created successfully!');
    } catch (error: any) {
      setError(`Error creating template: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestMessage = async () => {
    setLoading(true);
    try {
      const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
      const result = await sendHelloMessage({
        userId: testMessage.userId,
        language: testMessage.language
      });
      
      const data = result.data as any;
      if (data.success) {
        setSuccess(`Test message sent successfully! Message: ${data.message}`);
        setTestDialogOpen(false);
      } else {
        setError('Failed to send test message');
      }
    } catch (error: any) {
      setError(`Test message failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTemplate = async (templateId: string) => {
    setTemplates(prev => 
      prev.map(template => 
        template.id === templateId 
          ? { ...template, enabled: !template.enabled }
          : template
      )
    );
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }
    
    setTemplates(prev => prev.filter(template => template.id !== templateId));
    setSuccess('Template deleted successfully!');
  };

  const extractVariables = (content: string): string[] => {
    const variableRegex = /\{(\w+)\}/g;
    const variables: string[] = [];
    let match;
    
    while ((match = variableRegex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }
    
    return variables;
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'greeting': return 'primary';
      case 'morning': return 'success';
      case 'weekly': return 'warning';
      case 'special': return 'error';
      default: return 'default';
    }
  };

  const formatTime = (hour: number) => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Hello Message Management
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      <Box sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Templates" icon={<MessageIcon />} />
          <Tab label="Settings" icon={<SettingsIcon />} />
          <Tab label="Analytics" icon={<AnalyticsIcon />} />
          <Tab label="Test Messages" icon={<ScheduleIcon />} />
        </Tabs>
      </Box>
      
      {activeTab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6">Hello Message Templates</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setTemplateDialogOpen(true)}
            >
              Create Template
            </Button>
          </Box>
          
          <Grid container spacing={3}>
            {templates.map((template) => (
              <Grid item xs={12} md={6} lg={4} key={template.id}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Typography variant="h6" component="div">
                        {template.name}
                      </Typography>
                      <Box>
                        <Chip
                          label={template.category}
                          color={getCategoryColor(template.category) as any}
                          size="small"
                          sx={{ mr: 1 }}
                        />
                        <Chip
                          label={template.enabled ? 'Active' : 'Inactive'}
                          color={template.enabled ? 'success' : 'default'}
                          size="small"
                        />
                      </Box>
                    </Box>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      <strong>English:</strong> {template.content.en}
                    </Typography>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      <strong>Spanish:</strong> {template.content.es}
                    </Typography>
                    
                    {template.variables.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="textSecondary">
                          Variables: {template.variables.join(', ')}
                        </Typography>
                      </Box>
                    )}
                    
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">
                        Used {template.usage} times | Priority: {template.priority}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {template.lastUsed?.toLocaleDateString()}
                      </Typography>
                    </Box>
                    
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        onClick={() => handleToggleTemplate(template.id)}
                        color={template.enabled ? 'warning' : 'success'}
                      >
                        {template.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="small"
                        startIcon={<EditIcon />}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleDeleteTemplate(template.id)}
                      >
                        Delete
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
      
      {activeTab === 1 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">Hello Message Settings</Typography>
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => setSettingsDialogOpen(true)}
              >
                Edit Settings
              </Button>
            </Box>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>General Settings</Typography>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.enabled}
                        disabled
                      />
                    }
                    label="Hello Messages Enabled"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.enablePersonalization}
                        disabled
                      />
                    }
                    label="Enable Personalization"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.enableAnalytics}
                        disabled
                      />
                    }
                    label="Enable Analytics"
                  />
                </Box>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>Timing Settings</Typography>
                <Typography variant="body2" color="textSecondary">
                  Frequency: {settings.frequency}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Time of Day: {settings.timeOfDay}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Timezone: {settings.timezone}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Max Messages/Day: {settings.maxMessagesPerDay}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Cooldown: {settings.cooldownHours} hours
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      
      {activeTab === 2 && analytics && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Overview Statistics
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="h4" color="primary">
                      {analytics.totalSent}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Total Sent
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="h4" color="success.main">
                      {analytics.totalRead}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Total Read
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="h4" color="info.main">
                      {analytics.readRate.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Read Rate
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="h4" color="warning.main">
                      {analytics.responseRate.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Response Rate
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Top Templates
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Template</TableCell>
                        <TableCell align="right">Sent</TableCell>
                        <TableCell align="right">Read</TableCell>
                        <TableCell align="right">Response</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.topTemplates.map((template) => (
                        <TableRow key={template.templateId}>
                          <TableCell>{template.name}</TableCell>
                          <TableCell align="right">{template.sentCount}</TableCell>
                          <TableCell align="right">{template.readCount}</TableCell>
                          <TableCell align="right">{template.responseCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Language Distribution
                </Typography>
                {analytics.languageStats.map((stat) => (
                  <Box key={stat.language} sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">
                        {stat.language.toUpperCase()}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {stat.sentCount} sent, {stat.readCount} read
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        width: '100%',
                        height: 8,
                        backgroundColor: 'grey.200',
                        borderRadius: 1,
                        overflow: 'hidden'
                      }}
                    >
                      <Box
                        sx={{
                          width: `${(stat.readCount / stat.sentCount) * 100}%`,
                          height: '100%',
                          backgroundColor: 'primary.main'
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Hourly Activity
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {analytics.timeStats.slice(6, 20).map((stat) => (
                    <Box key={stat.hour}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2">
                          {formatTime(stat.hour)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          {stat.sentCount} sent, {stat.readCount} read
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          width: '100%',
                          height: 4,
                          backgroundColor: 'grey.200',
                          borderRadius: 1,
                          overflow: 'hidden'
                        }}
                      >
                        <Box
                          sx={{
                            width: `${(stat.sentCount / Math.max(...analytics.timeStats.map(s => s.sentCount))) * 100}%`,
                            height: '100%',
                            backgroundColor: 'secondary.main'
                          }}
                        />
                      </Box>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      
      {activeTab === 3 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Test Hello Messages
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={testMessage.userId}
                  onChange={(e) => setTestMessage({ ...testMessage, userId: e.target.value })}
                  sx={{ mb: 2 }}
                />
                
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Language</InputLabel>
                  <Select
                    value={testMessage.language}
                    label="Language"
                    onChange={(e) => setTestMessage({ ...testMessage, language: e.target.value })}
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="es">Spanish</MenuItem>
                  </Select>
                </FormControl>
                
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Template (Optional)</InputLabel>
                  <Select
                    value={testMessage.templateId}
                    label="Template (Optional)"
                    onChange={(e) => setTestMessage({ ...testMessage, templateId: e.target.value })}
                  >
                    <MenuItem value="">Random Template</MenuItem>
                    {templates.filter(t => t.enabled).map(template => (
                      <MenuItem key={template.id} value={template.id}>
                        {template.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} /> : <MessageIcon />}
                  onClick={handleTestMessage}
                  disabled={loading || !testMessage.userId}
                >
                  {loading ? 'Sending...' : 'Send Test Message'}
                </Button>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Test Instructions
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                  1. Enter a valid user ID to send a test hello message
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                  2. Select the preferred language for the message
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                  3. Optionally select a specific template, or let the system choose randomly
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                  4. Click "Send Test Message" to deliver the hello message
                </Typography>
                
                <Alert severity="info" sx={{ mt: 2 }}>
                  Test messages will be sent immediately and will respect the user's language preferences.
                </Alert>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      
      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Hello Message Template</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Template Name"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={newTemplate.category}
                  label="Category"
                  onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="greeting">Greeting</MenuItem>
                  <MenuItem value="morning">Morning</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="special">Special</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Priority"
                value={newTemplate.priority}
                onChange={(e) => setNewTemplate({ ...newTemplate, priority: parseInt(e.target.value) })}
                inputProps={{ min: 1, max: 10 }}
                helperText="Higher priority templates are used more frequently"
              />
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="English Content"
                value={newTemplate.contentEn}
                onChange={(e) => setNewTemplate({ ...newTemplate, contentEn: e.target.value })}
                helperText="Use {variableName} for dynamic content (e.g., {firstName})"
              />
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Spanish Content"
                value={newTemplate.contentEs}
                onChange={(e) => setNewTemplate({ ...newTemplate, contentEs: e.target.value })}
                helperText="Use {variableName} for dynamic content (e.g., {firstName})"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateTemplate} 
            variant="contained"
            disabled={loading || !newTemplate.name || !newTemplate.contentEn || !newTemplate.contentEs}
          >
            Create Template
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Settings Dialog */}
      <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Hello Message Settings</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
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
            
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enablePersonalization}
                    onChange={(e) => setSettings({ ...settings, enablePersonalization: e.target.checked })}
                  />
                }
                label="Enable Personalization"
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Frequency</InputLabel>
                <Select
                  value={settings.frequency}
                  label="Frequency"
                  onChange={(e) => setSettings({ ...settings, frequency: e.target.value as any })}
                >
                  <MenuItem value="always">Always</MenuItem>
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                  <MenuItem value="never">Never</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="time"
                label="Time of Day"
                value={settings.timeOfDay}
                onChange={(e) => setSettings({ ...settings, timeOfDay: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Timezone"
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Max Messages Per Day"
                value={settings.maxMessagesPerDay}
                onChange={(e) => setSettings({ ...settings, maxMessagesPerDay: parseInt(e.target.value) })}
                inputProps={{ min: 1, max: 1000 }}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Cooldown Hours"
                value={settings.cooldownHours}
                onChange={(e) => setSettings({ ...settings, cooldownHours: parseInt(e.target.value) })}
                inputProps={{ min: 1, max: 168 }}
                helperText="Hours between messages to the same user"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSaveSettings} 
            variant="contained"
            disabled={loading}
          >
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default HelloMessageManagement; 