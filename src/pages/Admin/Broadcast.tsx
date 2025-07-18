import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
  Grid,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  LinearProgress,
  CircularProgress,
  Paper,
  IconButton,
  SelectChangeEvent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  FormGroup,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Rating,
  useTheme,
} from '@mui/material';
import {
  Send as SendIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Analytics as AnalyticsIcon,
  Schedule as ScheduleIcon,
  Article as TemplateIcon,
  People as PeopleIcon,
  Message as MessageIcon,
  Visibility as VisibilityIcon,
  Reply as ReplyIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Legend,
  ArcElement,
} from 'chart.js';
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Legend,
  ArcElement,
);

interface BroadcastSettings {
  enabled: boolean;
  defaultTone: string;
  defaultEscalationEmail: string;
  aiSummaryEnabled: boolean;
}

interface AudienceFilter {
  location: string[];
  jobTitle: string[];
  department: string[];
  costCenter: string[];
  traits: string[];
  tags: string[];
  userIds?: string[];
  jobOrderId?: string;
  userGroupId?: string;
}

interface BroadcastTemplate {
  id: string;
  name: string;
  message: string;
  category: string;
  audienceFilter?: AudienceFilter;
}

const Broadcast: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<BroadcastSettings>({
    enabled: true,
    defaultTone: 'professional',
    defaultEscalationEmail: '',
    aiSummaryEnabled: true,
  });
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]);
  const [showComposeDialog, setShowComposeDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BroadcastTemplate | null>(null);

  // Compose form state
  const [composeForm, setComposeForm] = useState({
    broadcastType: 'message', // 'message' or 'survey'
    message: '',
    surveyDescription: '',
    surveyOptions: [''],
    audienceFilter: {
      location: [],
      jobTitle: [],
      department: [],
      costCenter: [],
      traits: [],
      tags: [],
      userIds: [],
      jobOrderId: undefined,
      userGroupId: undefined,
    } as AudienceFilter,
    aiAssistReplies: true,
    escalationEmail: '',
    scheduledFor: null as Date | null,
    templateId: '',
  });

  // Template form state
  const [templateForm, setTemplateForm] = useState({
    name: '',
    message: '',
    category: 'general',
  });

  const [customerList, setCustomerList] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [timeRange, setTimeRange] = useState<number>(30 * 24 * 60 * 60 * 1000); // 30 days

  // Add state for audience data
  const [locations, setLocations] = useState<{ id: string; name: string; nickname?: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [userGroups, setUserGroups] = useState<{ id: string; title: string; description?: string }[]>([]);
  const [audienceEntireWorkforce, setAudienceEntireWorkforce] = useState(false);

  const functions = getFunctions();
  const theme = useTheme();

  // Fetch audience data (mocked for now, replace with Firestore fetch as in AICampaigns)
  useEffect(() => {
    // TODO: Replace with Firestore fetch logic as in AICampaigns
    setLocations([
      { id: 'loc1', name: 'Main Warehouse' },
      { id: 'loc2', name: 'Remote Office' },
    ]);
    setDepartments([
      { id: 'dept1', name: 'Operations' },
      { id: 'dept2', name: 'Logistics' },
    ]);
    setUserGroups([
      { id: 'group1', title: 'Night Shift' },
      { id: 'group2', title: 'Managers' },
    ]);
  }, []);

  useEffect(() => {
    loadSettings();
    loadCustomerList();
    if (tabValue === 1) loadBroadcasts();
    if (tabValue === 2) loadAnalytics();
    if (tabValue === 3) loadTemplates();
  }, [tabValue, selectedCustomer, timeRange]);

  const loadSettings = async () => {
    try {
      // Load broadcast settings from Firestore
      setLoading(false);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadCustomerList = async () => {
    try {
      // Load customer list
      setCustomerList([]);
    } catch (error) {
      console.error('Failed to load tenants:', error);
    }
  };

  const loadBroadcasts = async () => {
    setLoading(true);
    try {
      // Load broadcasts from Firestore
      setBroadcasts([]);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load broadcasts:', error);
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    if (!selectedCustomer) return;

    setLoading(true);
    try {
      const getAnalytics = httpsCallable(functions, 'getBroadcastAnalytics');
      const result = await getAnalytics({
        tenantId: selectedCustomer,
        timeRange,
      });
      const { analytics } = result.data as any;
      setAnalytics(analytics);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load analytics:', error);
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      // Load templates from Firestore
      setTemplates([]);
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  const saveSettings = async () => {
    setLoading(true);
    try {
      // Save settings to Firestore
      setLoading(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setLoading(false);
    }
  };

  const sendBroadcast = async () => {
    if (
      (composeForm.broadcastType === 'message' && !composeForm.message.trim()) ||
      (composeForm.broadcastType === 'survey' && (composeForm.surveyOptions.length < 2 || composeForm.surveyOptions.some(opt => !opt.trim()))) ||
      !selectedCustomer
    ) return;

    setLoading(true);
    try {
      const createBroadcast = httpsCallable(functions, 'createBroadcast');
      const result = await createBroadcast({
        senderId: 'admin', // Replace with actual user ID
        tenantId: selectedCustomer,
        audienceFilter: composeForm.audienceFilter,
        message: composeForm.broadcastType === 'message' ? composeForm.message : undefined,
        broadcastType: composeForm.broadcastType,
        survey: composeForm.broadcastType === 'survey' ? {
          description: composeForm.surveyDescription,
          options: composeForm.surveyOptions,
        } : undefined,
        aiAssistReplies: composeForm.aiAssistReplies,
        escalationEmail: composeForm.escalationEmail || settings.defaultEscalationEmail,
        scheduledFor: composeForm.scheduledFor,
        templateId: composeForm.templateId,
      });

      setShowComposeDialog(false);
      setComposeForm({
        broadcastType: 'message',
        message: '',
        surveyDescription: '',
        surveyOptions: [''],
        audienceFilter: {
          location: [],
          jobTitle: [],
          department: [],
          costCenter: [],
          traits: [],
          tags: [],
          userIds: [],
          jobOrderId: undefined,
          userGroupId: undefined,
        },
        aiAssistReplies: true,
        escalationEmail: '',
        scheduledFor: null,
        templateId: '',
      });

      if (tabValue === 1) loadBroadcasts();
      setLoading(false);
    } catch (error) {
      console.error('Failed to send broadcast:', error);
      setLoading(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.message.trim()) return;

    try {
      // Save template to Firestore
      setShowTemplateDialog(false);
      setTemplateForm({ name: '', message: '', category: 'general' });
      setEditingTemplate(null);
      if (tabValue === 3) loadTemplates();
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleTemplateSelect = (template: BroadcastTemplate) => {
    setComposeForm({
      ...composeForm,
      message: template.message,
      audienceFilter: template.audienceFilter || {
        location: [],
        jobTitle: [],
        department: [],
        costCenter: [],
        traits: [],
        tags: [],
        userIds: [],
        jobOrderId: undefined,
        userGroupId: undefined,
      },
      templateId: template.id,
    });
  };

  return (
    <Box sx={{ p:0 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
        Broadcast Management
      </Typography>

      <Tabs value={tabValue} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
        <Tab label="Compose" icon={<MessageIcon />} />
        <Tab label="Broadcasts" icon={<SendIcon />} />
        <Tab label="Analytics" icon={<AnalyticsIcon />} />
        <Tab label="Templates" icon={<TemplateIcon />} />
        <Tab label="Settings" icon={<EditIcon />} />
      </Tabs>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Compose Tab */}
      <Box role="tabpanel" hidden={tabValue !== 0}>
        <Card>
          <CardContent>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Compose New Broadcast</Typography>
              <Button
                variant="contained"
                onClick={() => setShowComposeDialog(true)}
                startIcon={<AddIcon />}
              >
                New Broadcast
              </Button>
            </Box>

            <Typography color="text.secondary">
              Create targeted messages to communicate with your workforce. Use audience filters to
              reach specific groups.
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Broadcasts Tab */}
      <Box role="tabpanel" hidden={tabValue !== 1}>
        <Card>
          <CardContent>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Broadcast History</Typography>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Customer</InputLabel>
                <Select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  label="Customer"
                >
                  <MenuItem value="">All Customers</MenuItem>
                  {customerList.map((customer) => (
                    <MenuItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {broadcasts.length === 0 ? (
              <Typography>No broadcasts found.</Typography>
            ) : (
              <List>
                {broadcasts.map((broadcast) => (
                  <ListItem key={broadcast.id} divider>
                    <ListItemText
                      primary={broadcast.message}
                      secondary={`Sent to ${
                        broadcast.metadata?.numRecipients || 0
                      } recipients • ${new Date(broadcast.createdAt).toLocaleDateString()}`}
                    />
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip
                        label={`${broadcast.metadata?.numRead || 0} read`}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                      <Chip
                        label={`${broadcast.metadata?.numReplied || 0} replies`}
                        size="small"
                        color="secondary"
                        variant="outlined"
                      />
                      <Chip
                        label={broadcast.status}
                        size="small"
                        color={broadcast.status === 'sent' ? 'success' : 'warning'}
                      />
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Analytics Tab */}
      <Box role="tabpanel" hidden={tabValue !== 2}>
        <Card>
          <CardContent>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Broadcast Analytics</Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel>Customer</InputLabel>
                  <Select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    label="Customer"
                  >
                    <MenuItem value="">Select Customer</MenuItem>
                    {customerList.map((customer) => (
                      <MenuItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as number)}
                    label="Time Range"
                  >
                    <MenuItem value={7 * 24 * 60 * 60 * 1000}>Last 7 days</MenuItem>
                    <MenuItem value={30 * 24 * 60 * 60 * 1000}>Last 30 days</MenuItem>
                    <MenuItem value={90 * 24 * 60 * 60 * 1000}>Last 90 days</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : analytics ? (
              <>
                {/* Overview Metrics */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'primary.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">{analytics.overview.totalBroadcasts}</Typography>
                        <Typography variant="body2">Total Broadcasts</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'success.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">{analytics.overview.totalRecipients}</Typography>
                        <Typography variant="body2">Total Recipients</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'info.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {(analytics.overview.readRate * 100).toFixed(1)}%
                        </Typography>
                        <Typography variant="body2">Read Rate</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'warning.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {(analytics.overview.replyRate * 100).toFixed(1)}%
                        </Typography>
                        <Typography variant="body2">Reply Rate</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'error.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {(analytics.overview.escalationRate * 100).toFixed(1)}%
                        </Typography>
                        <Typography variant="body2">Escalation Rate</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'secondary.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">{analytics.overview.totalEscalated}</Typography>
                        <Typography variant="body2">Escalated</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Charts */}
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Broadcasts Over Time
                        </Typography>
                        <Line
                          data={{
                            labels: analytics.broadcastsByDay.map((d: any) => d.date),
                            datasets: [
                              {
                                label: 'Broadcasts',
                                data: analytics.broadcastsByDay.map((d: any) => d.count),
                                borderColor: 'rgba(75,192,192,1)',
                                backgroundColor: 'rgba(75,192,192,0.2)',
                                tension: 0.3,
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: { legend: { display: false } },
                          }}
                          height={200}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Reply Sentiment
                        </Typography>
                        <Doughnut
                          data={{
                            labels: ['Positive', 'Neutral', 'Negative'],
                            datasets: [
                              {
                                data: [
                                  analytics.sentiments.positive,
                                  analytics.sentiments.neutral,
                                  analytics.sentiments.negative,
                                ],
                                backgroundColor: ['#4caf50', '#ff9800', '#f44336'],
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: { legend: { position: 'bottom' } },
                          }}
                          height={200}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </>
            ) : (
              <Typography>No analytics data available.</Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Templates Tab */}
      <Box role="tabpanel" hidden={tabValue !== 3}>
        <Card>
          <CardContent>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Message Templates</Typography>
              <Button
                variant="contained"
                onClick={() => setShowTemplateDialog(true)}
                startIcon={<AddIcon />}
              >
                New Template
              </Button>
            </Box>

            <Grid container spacing={2}>
              {templates.map((template) => (
                <Grid item xs={12} md={6} key={template.id}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          mb: 1,
                        }}
                      >
                        <Typography variant="h6" sx={{ flex: 1, mr: 2 }}>
                          {template.name}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditingTemplate(template);
                              setTemplateForm({
                                name: template.name,
                                message: template.message,
                                category: template.category,
                              });
                              setShowTemplateDialog(true);
                            }}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              /* Delete template */
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {template.message}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip
                          label={template.category}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleTemplateSelect(template)}
                        >
                          Use Template
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {/* Settings Tab */}
      <Box role="tabpanel" hidden={tabValue !== 4}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Broadcast Settings
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
                  label="Enable Broadcast Module"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.aiSummaryEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, aiSummaryEnabled: e.target.checked })
                      }
                    />
                  }
                  label="Enable AI Response Summaries"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Tone</InputLabel>
                  <Select
                    value={settings.defaultTone}
                    onChange={(e) => setSettings({ ...settings, defaultTone: e.target.value })}
                    label="Default Tone"
                  >
                    <MenuItem value="professional">Professional</MenuItem>
                    <MenuItem value="friendly">Friendly</MenuItem>
                    <MenuItem value="urgent">Urgent</MenuItem>
                    <MenuItem value="informative">Informative</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Default Escalation Email"
                  value={settings.defaultEscalationEmail}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultEscalationEmail: e.target.value })
                  }
                  placeholder="hr@company.com"
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
              <Button variant="contained" onClick={saveSettings} disabled={loading}>
                Save Settings
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Compose Dialog */}
      <Dialog
        open={showComposeDialog}
        onClose={() => setShowComposeDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Compose New Broadcast</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth margin="normal">
                <InputLabel>Broadcast Type</InputLabel>
                <Select
                  value={composeForm.broadcastType}
                  label="Broadcast Type"
                  onChange={e => setComposeForm({ ...composeForm, broadcastType: e.target.value as 'message' | 'survey' })}
                >
                  <MenuItem value="message">Message</MenuItem>
                  <MenuItem value="survey">Survey</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Show message or survey fields based on type */}
            {composeForm.broadcastType === 'message' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  label="Message"
                  value={composeForm.message}
                  onChange={(e) => setComposeForm({ ...composeForm, message: e.target.value })}
                  placeholder="Enter your broadcast message..."
                />
              </Grid>
            )}
            {composeForm.broadcastType === 'survey' && (
              <>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Survey Description"
                    value={composeForm.surveyDescription}
                    onChange={e => setComposeForm({ ...composeForm, surveyDescription: e.target.value })}
                    margin="normal"
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Answer Options</Typography>
                  {composeForm.surveyOptions.map((option, idx) => (
                    <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <TextField
                        fullWidth
                        label={`Option ${idx + 1}`}
                        value={option}
                        onChange={e => {
                          const newOptions = [...composeForm.surveyOptions];
                          newOptions[idx] = e.target.value;
                          setComposeForm({ ...composeForm, surveyOptions: newOptions });
                        }}
                        sx={{ mr: 1 }}
                      />
                      <Button
                        color="error"
                        disabled={composeForm.surveyOptions.length <= 1}
                        onClick={() => {
                          setComposeForm({
                            ...composeForm,
                            surveyOptions: composeForm.surveyOptions.filter((_, i) => i !== idx),
                          });
                        }}
                      >Remove</Button>
                    </Box>
                  ))}
                  <Button
                    variant="outlined"
                    onClick={() => setComposeForm({ ...composeForm, surveyOptions: [...composeForm.surveyOptions, ''] })}
                  >Add Option</Button>
                </Grid>
              </>
            )}

            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>
                Audience Filter
              </Typography>
              {/* Audience Selection Section (replaces Accordion) */}
              <Box sx={{ mt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={audienceEntireWorkforce}
                      onChange={(e) => {
                        setAudienceEntireWorkforce(e.target.checked);
                        if (e.target.checked) {
                          setComposeForm({
                            ...composeForm,
                            audienceFilter: {
                              ...composeForm.audienceFilter,
                              location: [],
                              department: [],
                              userGroupId: undefined,
                            },
                          });
                        }
                      }}
                    />
                  }
                  label="Target Entire Workforce"
                />
                {!audienceEntireWorkforce && (
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    {/* Locations */}
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth margin="normal">
                        <InputLabel>Locations</InputLabel>
                        <Select
                          multiple
                          value={composeForm.audienceFilter.location}
                          onChange={(e) => setComposeForm({
                            ...composeForm,
                            audienceFilter: {
                              ...composeForm.audienceFilter,
                              location: e.target.value as string[],
                            },
                          })}
                          label="Locations"
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {(selected as string[]).map((value) => {
                                const location = locations.find(loc => loc.id === value);
                                return (
                                  <Chip
                                    key={value}
                                    label={location?.name || value}
                                    size="small"
                                    onDelete={() => {
                                      setComposeForm({
                                        ...composeForm,
                                        audienceFilter: {
                                          ...composeForm.audienceFilter,
                                          location: composeForm.audienceFilter.location.filter(id => id !== value),
                                        },
                                      });
                                    }}
                                  />
                                );
                              })}
                            </Box>
                          )}
                        >
                          {locations.map((location) => (
                            <MenuItem key={location.id} value={location.id}>
                              {location.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {/* Departments */}
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth margin="normal">
                        <InputLabel>Departments</InputLabel>
                        <Select
                          multiple
                          value={composeForm.audienceFilter.department}
                          onChange={(e) => setComposeForm({
                            ...composeForm,
                            audienceFilter: {
                              ...composeForm.audienceFilter,
                              department: e.target.value as string[],
                            },
                          })}
                          label="Departments"
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {(selected as string[]).map((value) => {
                                const dept = departments.find(d => d.id === value);
                                return (
                                  <Chip
                                    key={value}
                                    label={dept?.name || value}
                                    size="small"
                                    onDelete={() => {
                                      setComposeForm({
                                        ...composeForm,
                                        audienceFilter: {
                                          ...composeForm.audienceFilter,
                                          department: composeForm.audienceFilter.department.filter(id => id !== value),
                                        },
                                      });
                                    }}
                                  />
                                );
                              })}
                            </Box>
                          )}
                        >
                          {departments.map((dept) => (
                            <MenuItem key={dept.id} value={dept.id}>
                              {dept.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {/* User Groups */}
                    <Grid item xs={12}>
                      <FormControl fullWidth margin="normal">
                        <InputLabel>User Groups</InputLabel>
                        <Select
                          multiple
                          value={composeForm.audienceFilter.userGroupId ? [composeForm.audienceFilter.userGroupId] : []}
                          onChange={(e) => setComposeForm({
                            ...composeForm,
                            audienceFilter: {
                              ...composeForm.audienceFilter,
                              userGroupId: (e.target.value as string[])[0], // Only allow one for now, or adapt to array if needed
                            },
                          })}
                          label="User Groups"
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {(selected as string[]).map((value) => {
                                const group = userGroups.find(g => g.id === value);
                                return (
                                  <Chip
                                    key={value}
                                    label={group?.title || value}
                                    size="small"
                                    onDelete={() => {
                                      setComposeForm({
                                        ...composeForm,
                                        audienceFilter: {
                                          ...composeForm.audienceFilter,
                                          userGroupId: undefined,
                                        },
                                      });
                                    }}
                                  />
                                );
                              })}
                            </Box>
                          )}
                        >
                          {userGroups.map((group) => (
                            <MenuItem key={group.id} value={group.id}>
                              {group.title}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                )}
                {/* Audience Summary */}
                <Box sx={{ mt: 2, p: 2, borderRadius: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    <strong>Audience Summary:</strong> {
                      audienceEntireWorkforce
                        ? 'Entire workforce will be targeted'
                        : [
                            composeForm.audienceFilter.location.length > 0 && `${composeForm.audienceFilter.location.length} location(s)`,
                            composeForm.audienceFilter.department.length > 0 && `${composeForm.audienceFilter.department.length} department(s)`,
                            composeForm.audienceFilter.userGroupId && `1 user group`
                          ].filter(Boolean).join(', ') || 'No specific audience selected'
                    }
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={composeForm.aiAssistReplies}
                    onChange={(e) =>
                      setComposeForm({ ...composeForm, aiAssistReplies: e.target.checked })
                    }
                  />
                }
                label="Enable AI-Assisted Replies"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Escalation Email"
                value={composeForm.escalationEmail}
                onChange={(e) =>
                  setComposeForm({ ...composeForm, escalationEmail: e.target.value })
                }
                placeholder="hr@company.com"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowComposeDialog(false)}>Cancel</Button>
          <Button
            onClick={sendBroadcast}
            variant="contained"
            disabled={!composeForm.message.trim() || !selectedCustomer}
          >
            Send Broadcast
          </Button>
        </DialogActions>
      </Dialog>

      {/* Template Dialog */}
      <Dialog
        open={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{editingTemplate ? 'Edit Template' : 'New Template'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Template Name"
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                placeholder="e.g., Holiday Reminder"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Message Template"
                value={templateForm.message}
                onChange={(e) => setTemplateForm({ ...templateForm, message: e.target.value })}
                placeholder="Enter your message template..."
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}
                  label="Category"
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="holiday">Holiday</MenuItem>
                  <MenuItem value="policy">Policy Update</MenuItem>
                  <MenuItem value="safety">Safety</MenuItem>
                  <MenuItem value="training">Training</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTemplateDialog(false)}>Cancel</Button>
          <Button
            onClick={saveTemplate}
            variant="contained"
            disabled={!templateForm.name.trim() || !templateForm.message.trim()}
          >
            Save Template
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Broadcast;
