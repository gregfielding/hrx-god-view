import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Slider,
  Chip,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Badge,
  Tooltip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  SelectChangeEvent,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Settings as SettingsIcon,
  Upload as UploadIcon,
  Person as PersonIcon,
  Security as SecurityIcon,
  ArrowBack as ArrowBackIcon,
  Psychology as PsychologyIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Analytics as AnalyticsIcon,
  History as HistoryIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  SentimentSatisfiedAlt as SentimentSatisfiedAltIcon,
  SentimentDissatisfied as SentimentDissatisfiedIcon,
  SentimentNeutral as SentimentNeutralIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useTheme } from '@mui/material/styles';
import CircularProgress from '@mui/material/CircularProgress';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { useNavigate } from 'react-router-dom';
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

interface AIChatSettings {
  // HRX System Settings
  systemDefaults: {
    confidenceThreshold: number;
    defaultTone: string;
    fallbackContact: string;
    enableAnonymousMode: boolean;
    escalationDelayHours: number;
    enableHRXHandbook: boolean;
  };

  // Customer Settings
  customerSettings: {
    companyTone: string;
    customHandbook: string;
    escalationPaths: EscalationPath[];
    enableAnonymousMode: boolean;
    requireApproval: boolean;
    approvedAnswers: string[];
  };

  // Conversation Management
  conversationSettings: {
    maxConversationLength: number;
    autoArchiveDays: number;
    enableSentimentAnalysis: boolean;
    enableRecurringCheckins: boolean;
  };
}

interface EscalationPath {
  id: string;
  category: string;
  department: string;
  contactName: string;
  contactEmail: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  autoEscalate: boolean;
}

interface Conversation {
  id: string;
  workerId: string;
  messages: Message[];
  status: 'active' | 'escalated' | 'resolved' | 'archived';
  confidence: number;
  escalated: boolean;
  escalatedTo: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  sentiment?: number;
}

interface Message {
  id: string;
  sender: 'worker' | 'ai' | 'human';
  content: string;
  timestamp: Date;
  confidence?: number;
  tone?: string;
}

type FeatureToggle = 'sentiment' | 'checkins' | 'faq';

const AIChat: React.FC = () => {
  const [settings, setSettings] = useState<AIChatSettings>({
    systemDefaults: {
      confidenceThreshold: 0.8,
      defaultTone: 'professional',
      fallbackContact: 'hr@company.com',
      enableAnonymousMode: true,
      escalationDelayHours: 4,
      enableHRXHandbook: true,
    },
    customerSettings: {
      companyTone: 'professional',
      customHandbook: '',
      escalationPaths: [],
      enableAnonymousMode: true,
      requireApproval: false,
      approvedAnswers: [],
    },
    conversationSettings: {
      maxConversationLength: 50,
      autoArchiveDays: 90,
      enableSentimentAnalysis: true,
      enableRecurringCheckins: true,
    },
  });

  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showEscalationDialog, setShowEscalationDialog] = useState(false);
  const [editingEscalationPath, setEditingEscalationPath] = useState<EscalationPath | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [sentimentOverrides, setSentimentOverrides] = useState<{ [id: string]: number }>({});
  const [featureToggles, setFeatureToggles] = useState<Record<FeatureToggle, boolean>>({
    sentiment: true,
    checkins: true,
    faq: true,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [automationRules, setAutomationRules] = useState({
    sentimentCheckinThreshold: -0.3,
    checkinDelayDays: 3,
    sentimentEscalateThreshold: -0.5,
  });
  const [rulesLoading, setRulesLoading] = useState(false);
  const [feedbackList, setFeedbackList] = useState<any[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [realTimeAnalytics, setRealTimeAnalytics] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [timeRange, setTimeRange] = useState<number>(7 * 24 * 60 * 60 * 1000); // 7 days
  const [customerFAQs, setCustomerFAQs] = useState<any[]>([]);
  const [improvementSuggestions, setImprovementSuggestions] = useState<any[]>([]);
  const [faqDialogOpen, setFaqDialogOpen] = useState(false);
  const [editingFAQ, setEditingFAQ] = useState<any>(null);
  const [newFAQ, setNewFAQ] = useState({
    question: '',
    answer: '',
    category: 'general',
    tags: [],
    priority: 'medium',
  });

  const functions = getFunctions();
  const theme = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    loadSettings();
    fetchConversations();
    fetchCustomerList();
    loadAutomationRules();
  }, []);

  useEffect(() => {
    if (tabValue === 3) loadRealTimeAnalytics();
    if (tabValue === 4) loadCustomerFAQs();
    if (tabValue === 5) loadImprovementSuggestions();
    if (tabValue === 6) loadFeedback();
    // eslint-disable-next-line
  }, [tabValue, selectedCustomer]);

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const getAIChatSettings = httpsCallable(functions, 'getAIChatSettings');
      const result = await getAIChatSettings({});
      const { settings: loadedSettings } = result.data as any;

      if (loadedSettings) {
        setSettings(loadedSettings);
        // Also load feature toggles if they exist
        if (loadedSettings.featureToggles) {
          setFeatureToggles(loadedSettings.featureToggles);
        }
      }
      setSettingsLoading(false);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setSettingsLoading(false);
    }
  };

  const fetchConversations = async () => {
    try {
      const getAIChatConversations = httpsCallable(functions, 'getAIChatConversations');
      const result = await getAIChatConversations();
      if (result.data) {
        setConversations(result.data as Conversation[]);
      }
    } catch (err) {
      console.error('Error fetching conversations:', err);
    }
  };

  const fetchCustomerList = async () => {
    // TODO: Replace with real Firestore call
    // Example mock data:
    setCustomerList([
      {
        id: 'c1',
        name: 'Acme Corp',
        customHandbook: true,
        customEscalation: true,
        lastUpdated: '2024-06-01',
      },
      {
        id: 'c2',
        name: 'Beta Agency',
        customHandbook: false,
        customEscalation: false,
        lastUpdated: '2024-05-20',
      },
      {
        id: 'c3',
        name: 'Gamma LLC',
        customHandbook: true,
        customEscalation: false,
        lastUpdated: '2024-06-02',
      },
    ]);
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const getAnalytics = httpsCallable(functions, 'getAIChatAnalytics');
      const result = await getAnalytics();
      setAnalytics(result.data);
    } catch (err: any) {
      setAnalyticsError('Failed to load analytics. Showing mock data.');
      setAnalytics({
        conversationVolume: [12, 18, 25, 30, 22, 28, 35],
        escalationRate: [0.1, 0.15, 0.2, 0.12, 0.18, 0.22, 0.13],
        satisfaction: 0.87,
        sentiment: [0.2, 0.1, 0.3, 0.15, 0.05, 0.25, 0.18],
        faqLeaderboard: [
          { question: 'How do I request time off?', count: 14 },
          { question: 'When is payday?', count: 11 },
          { question: 'What if I am sick?', count: 8 },
          { question: 'How do I update my address?', count: 6 },
        ],
      });
    }
    setAnalyticsLoading(false);
  };

  const saveSettings = async (newSettings: Partial<AIChatSettings>) => {
    try {
      const updateAIChatSettings = httpsCallable(functions, 'updateAIChatSettings');
      await updateAIChatSettings({ settings: newSettings });
      setSuccess('Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      setError('Failed to save settings');
    }
  };

  const addEscalationPath = () => {
    const newPath: EscalationPath = {
      id: Date.now().toString(),
      category: '',
      department: '',
      contactName: '',
      contactEmail: '',
      priority: 'medium',
      autoEscalate: false,
    };
    setEditingEscalationPath(newPath);
    setShowEscalationDialog(true);
  };

  const saveEscalationPath = () => {
    if (editingEscalationPath) {
      const updatedPaths = [...settings.customerSettings.escalationPaths];
      const existingIndex = updatedPaths.findIndex((p) => p.id === editingEscalationPath.id);

      if (existingIndex >= 0) {
        updatedPaths[existingIndex] = editingEscalationPath;
      } else {
        updatedPaths.push(editingEscalationPath);
      }

      setSettings((prev) => ({
        ...prev,
        customerSettings: {
          ...prev.customerSettings,
          escalationPaths: updatedPaths,
        },
      }));
    }
    setShowEscalationDialog(false);
    setEditingEscalationPath(null);
  };

  const deleteEscalationPath = (id: string) => {
    const updatedPaths = settings.customerSettings.escalationPaths.filter((p) => p.id !== id);
    setSettings((prev) => ({
      ...prev,
      customerSettings: {
        ...prev.customerSettings,
        escalationPaths: updatedPaths,
      },
    }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'primary';
      case 'escalated':
        return 'warning';
      case 'resolved':
        return 'success';
      case 'archived':
        return 'default';
      default:
        return 'default';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  const handleSentimentOverride = async (conversationId: string, value: number) => {
    setSentimentOverrides((prev) => ({ ...prev, [conversationId]: value }));

    try {
      const analyzeSentiment = httpsCallable(functions, 'analyzeConversationSentiment');
      await analyzeSentiment({ conversationId, overrideSentiment: value });
      setSuccess('Sentiment updated successfully');
    } catch (error) {
      console.error('Failed to update sentiment:', error);
      setError('Failed to update sentiment');
    }
  };

  const handleToggle = async (feature: FeatureToggle) => {
    const newToggles = { ...featureToggles, [feature]: !featureToggles[feature] };
    setFeatureToggles(newToggles);

    // Persist to Firestore
    try {
      const updateAIChatSettings = httpsCallable(functions, 'updateAIChatSettings');
      await updateAIChatSettings({
        settings: {
          featureToggles: newToggles,
        },
      });
    } catch (error) {
      console.error('Failed to save feature toggle:', error);
      // Revert on error
      setFeatureToggles((prev) => ({ ...prev, [feature]: !prev[feature] }));
    }
  };

  const loadAutomationRules = async () => {
    setRulesLoading(true);
    try {
      const getAIChatSettings = httpsCallable(functions, 'getAIChatSettings');
      const result = await getAIChatSettings({});
      const { settings } = result.data as any;
      if (settings && settings.automationRules) {
        setAutomationRules(settings.automationRules);
      }
      setRulesLoading(false);
    } catch (error) {
      setRulesLoading(false);
    }
  };

  const saveAutomationRules = async () => {
    try {
      const updateAIChatSettings = httpsCallable(functions, 'updateAIChatSettings');
      await updateAIChatSettings({ settings: { automationRules } });
      setSuccess('Automation rules saved');
    } catch (error) {
      setError('Failed to save automation rules');
    }
  };

  const loadFeedback = async () => {
    setFeedbackLoading(true);
    try {
      // Use Firestore REST API for now (or add a backend function for this)
      const res = await fetch(
        '/__/firebase/firestore/projectId/hrx1-d3beb/databases/(default)/documents/ai_automation_feedback?pageSize=20',
      );
      const data = await res.json();
      const feedback: any[] = (data.documents || []).map((doc: any) => ({
        id: doc.name.split('/').pop(),
        ...doc.fields,
        timestamp: doc.fields.timestamp?.timestampValue || '',
      }));
      setFeedbackList(feedback);
      setFeedbackLoading(false);
    } catch (error) {
      setFeedbackLoading(false);
    }
  };

  const markFeedback = async (
    id: string,
    status: 'correct' | 'needs_improvement',
    comment: string,
  ) => {
    // Use Firestore REST API for now (or add a backend function for this)
    await fetch(
      `/__/firebase/firestore/projectId/hrx1-d3beb/databases/(default)/documents/ai_automation_feedback/${id}?updateMask.fieldPaths=adminStatus&updateMask.fieldPaths=adminComment`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { adminStatus: { stringValue: status }, adminComment: { stringValue: comment } },
        }),
      },
    );
    loadFeedback();
  };

  const loadRealTimeAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const getRealTimeAnalytics = httpsCallable(functions, 'getRealTimeAIChatAnalytics');
      const result = await getRealTimeAnalytics({
        tenantId: selectedCustomer || null,
        timeRange,
      });
      const { analytics } = result.data as any;
      setRealTimeAnalytics(analytics);
      setAnalyticsLoading(false);
    } catch (error) {
      console.error('Failed to load real-time analytics:', error);
      setAnalyticsLoading(false);
    }
  };

  const loadCustomerFAQs = async () => {
    if (!selectedCustomer) return;

    try {
      const manageFAQ = httpsCallable(functions, 'manageCustomerFAQ');
      const result = await manageFAQ({
        action: 'get',
        tenantId: selectedCustomer,
      });
      const { faqs } = result.data as any;
      setCustomerFAQs(faqs);
    } catch (error) {
      console.error('Failed to load customer FAQs:', error);
    }
  };

  const loadImprovementSuggestions = async () => {
    try {
      const getSuggestions = httpsCallable(functions, 'getImprovementSuggestions');
      const result = await getSuggestions({
        tenantId: selectedCustomer || null,
        status: 'pending_review',
      });
      const { suggestions } = result.data as any;
      setImprovementSuggestions(suggestions);
    } catch (error) {
      console.error('Failed to load improvement suggestions:', error);
    }
  };

  const saveFAQ = async () => {
    if (!selectedCustomer || !newFAQ.question || !newFAQ.answer) return;

    try {
      const manageFAQ = httpsCallable(functions, 'manageCustomerFAQ');
      if (editingFAQ) {
        await manageFAQ({
          action: 'update',
          tenantId: selectedCustomer,
          data: { ...editingFAQ, ...newFAQ },
        });
      } else {
        await manageFAQ({
          action: 'add',
          tenantId: selectedCustomer,
          data: newFAQ,
        });
      }

      setFaqDialogOpen(false);
      setEditingFAQ(null);
      setNewFAQ({ question: '', answer: '', category: 'general', tags: [], priority: 'medium' });
      loadCustomerFAQs();
    } catch (error) {
      console.error('Failed to save FAQ:', error);
    }
  };

  const deleteFAQ = async (faqId: string) => {
    if (!selectedCustomer) return;

    try {
      const manageFAQ = httpsCallable(functions, 'manageCustomerFAQ');
      await manageFAQ({
        action: 'delete',
        tenantId: selectedCustomer,
        data: { id: faqId },
      });
      loadCustomerFAQs();
    } catch (error) {
      console.error('Failed to delete FAQ:', error);
    }
  };

  const updateSuggestionStatus = async (suggestionId: string, status: string, notes: string) => {
    try {
      const updateStatus = httpsCallable(functions, 'updateImprovementStatus');
      await updateStatus({ suggestionId, status, adminNotes: notes });
      loadImprovementSuggestions();
    } catch (error) {
      console.error('Failed to update suggestion status:', error);
    }
  };

  return (
    <Box sx={{ p:0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
        AI Chat Management
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
      

      <Tabs
        value={tabValue}
        onChange={(_, newValue) => setTabValue(newValue)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Settings" />
        <Tab label="Escalation" />
        <Tab label="Conversations" />
        <Tab label="Analytics" />
        <Tab label="Customer FAQs" />
        <Tab label="Improvements" />
        <Tab label="Feedback" />
      </Tabs>

      {/* System Settings Tab */}
      <Box role="tabpanel" hidden={tabValue !== 0}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  AI Confidence & Behavior
                </Typography>

                <Box sx={{ mb: 3 }}>
                  <Typography gutterBottom>Confidence Threshold</Typography>
                  <Slider
                    value={settings.systemDefaults.confidenceThreshold}
                    onChange={(_, value) =>
                      setSettings((prev) => ({
                        ...prev,
                        systemDefaults: {
                          ...prev.systemDefaults,
                          confidenceThreshold: value as number,
                        },
                      }))
                    }
                    min={0.5}
                    max={0.95}
                    step={0.05}
                    marks
                    valueLabelDisplay="auto"
                  />
                  <Typography variant="body2" color="text.secondary">
                    AI will escalate when confidence falls below{' '}
                    {(settings.systemDefaults.confidenceThreshold * 100).toFixed(0)}%
                  </Typography>
                </Box>

                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Default Tone</InputLabel>
                  <Select
                    value={settings.systemDefaults.defaultTone}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        systemDefaults: {
                          ...prev.systemDefaults,
                          defaultTone: e.target.value,
                        },
                      }))
                    }
                    label="Default Tone"
                  >
                    <MenuItem value="professional">Professional</MenuItem>
                    <MenuItem value="friendly">Friendly</MenuItem>
                    <MenuItem value="supportive">Supportive</MenuItem>
                    <MenuItem value="formal">Formal</MenuItem>
                    <MenuItem value="casual">Casual</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  fullWidth
                  label="Fallback Contact"
                  value={settings.systemDefaults.fallbackContact}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      systemDefaults: {
                        ...prev.systemDefaults,
                        fallbackContact: e.target.value,
                      },
                    }))
                  }
                  sx={{ mb: 2 }}
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.systemDefaults.enableAnonymousMode}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          systemDefaults: {
                            ...prev.systemDefaults,
                            enableAnonymousMode: e.target.checked,
                          },
                        }))
                      }
                    />
                  }
                  label="Enable Anonymous Mode"
                />
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <SecurityIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Escalation & Safety
                </Typography>

                <TextField
                  fullWidth
                  label="Escalation Delay (hours)"
                  type="number"
                  value={settings.systemDefaults.escalationDelayHours}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      systemDefaults: {
                        ...prev.systemDefaults,
                        escalationDelayHours: parseInt(e.target.value),
                      },
                    }))
                  }
                  sx={{ mb: 2 }}
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.systemDefaults.enableHRXHandbook}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          systemDefaults: {
                            ...prev.systemDefaults,
                            enableHRXHandbook: e.target.checked,
                          },
                        }))
                      }
                    />
                  }
                  label="Enable HRX Default Handbook"
                />

                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  HRX provides a comprehensive starter handbook with labor law information, PTO
                  templates, and common HR policies that tenants can customize.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Customer Settings Tab */}
      <Box role="tabpanel" hidden={tabValue !== 1}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <PsychologyIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Company Customization
                </Typography>

                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    All Customers & Agencies
                  </Typography>
                  <Table sx={{ bgcolor: 'background.paper', borderRadius: 2 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Handbook</TableCell>
                        <TableCell>Escalation</TableCell>
                        <TableCell>Last Updated</TableCell>
                        <TableCell>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {customerList.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.customHandbook ? 'Custom' : 'Default'}</TableCell>
                          <TableCell>{row.customEscalation ? 'Custom' : 'Default'}</TableCell>
                          <TableCell>{row.lastUpdated}</TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setSelectedCustomerId(row.id)}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                {selectedCustomerId && (
                  <>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Company Tone</InputLabel>
                      <Select
                        value={settings.customerSettings.companyTone}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            customerSettings: {
                              ...prev.customerSettings,
                              companyTone: e.target.value,
                            },
                          }))
                        }
                        label="Company Tone"
                      >
                        <MenuItem value="professional">Professional</MenuItem>
                        <MenuItem value="friendly">Friendly</MenuItem>
                        <MenuItem value="supportive">Supportive</MenuItem>
                        <MenuItem value="formal">Formal</MenuItem>
                        <MenuItem value="casual">Casual</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      multiline
                      rows={4}
                      label="Custom Handbook Content"
                      value={settings.customerSettings.customHandbook}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          customerSettings: {
                            ...prev.customerSettings,
                            customHandbook: e.target.value,
                          },
                        }))
                      }
                      placeholder="Upload or paste your company handbook, policies, and procedures..."
                      sx={{ mb: 2 }}
                    />

                    <Button variant="outlined" startIcon={<UploadIcon />} sx={{ mb: 2 }}>
                      Upload Handbook PDF
                    </Button>

                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.customerSettings.requireApproval}
                          onChange={(e) =>
                            setSettings((prev) => ({
                              ...prev,
                              customerSettings: {
                                ...prev.customerSettings,
                                requireApproval: e.target.checked,
                              },
                            }))
                          }
                        />
                      }
                      label="Require Approval for AI Responses"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                  }}
                >
                  <Typography variant="h6">
                    <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Escalation Paths
                  </Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addEscalationPath}>
                    Add Path
                  </Button>
                </Box>

                <List>
                  {settings.customerSettings.escalationPaths.map((path) => (
                    <ListItem key={path.id} divider>
                      <ListItemText
                        primary={`${path.category} → ${path.contactName}`}
                        secondary={`${path.department} • ${path.contactEmail}`}
                      />
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={path.priority}
                          color={getPriorityColor(path.priority)}
                          size="small"
                        />
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditingEscalationPath(path);
                            setShowEscalationDialog(true);
                          }}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton size="small" onClick={() => deleteEscalationPath(path.id)}>
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </ListItem>
                  ))}
                </List>

                {settings.customerSettings.escalationPaths.length === 0 && (
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    No escalation paths configured. Add paths to route specific topics to the right
                    people.
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Conversations Tab */}
      <Box role="tabpanel" hidden={tabValue !== 2}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              <HistoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              Recent Conversations
            </Typography>
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={featureToggles.sentiment}
                    onChange={() => handleToggle('sentiment')}
                  />
                }
                label="Sentiment Analysis"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={featureToggles.checkins}
                    onChange={() => handleToggle('checkins')}
                  />
                }
                label="Recurring Check-Ins"
              />
              <FormControlLabel
                control={
                  <Switch checked={featureToggles.faq} onChange={() => handleToggle('faq')} />
                }
                label="FAQ Previews"
              />
            </Box>
            <List>
              {conversations.map((conversation) => (
                <ListItem key={conversation.id} divider alignItems="flex-start">
                  <ListItemIcon>
                    <Badge badgeContent={conversation.messages.length} color="primary">
                      <ChatIcon />
                    </Badge>
                  </ListItemIcon>
                  <ListItemText
                    primary={`Worker ${conversation.workerId}`}
                    secondary={`${conversation.messages[0]?.content.substring(0, 100)}...`}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label={conversation.status}
                      color={getStatusColor(conversation.status)}
                      size="small"
                    />
                    {conversation.escalated && (
                      <Chip label="Escalated" color="warning" size="small" icon={<WarningIcon />} />
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {(conversation.confidence * 100).toFixed(0)}%
                    </Typography>
                    {/* Sentiment visualization */}
                    {featureToggles.sentiment && (
                      <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                        {typeof conversation.sentiment === 'number' && (
                          <>
                            {conversation.sentiment > 0.2 ? (
                              <SentimentSatisfiedAltIcon color="success" />
                            ) : conversation.sentiment < -0.2 ? (
                              <SentimentDissatisfiedIcon color="error" />
                            ) : (
                              <SentimentNeutralIcon color="warning" />
                            )}
                            <Typography variant="caption" sx={{ ml: 0.5 }}>
                              {conversation.sentiment.toFixed(2)}
                            </Typography>
                          </>
                        )}
                        {/* Sentiment override input */}
                        <TextField
                          size="small"
                          type="number"
                          inputProps={{ step: 0.01, min: -1, max: 1 }}
                          value={sentimentOverrides[conversation.id] ?? conversation.sentiment ?? 0}
                          onChange={(e) =>
                            setSentimentOverrides((prev) => ({
                              ...prev,
                              [conversation.id]: parseFloat(e.target.value),
                            }))
                          }
                          sx={{ width: 60, ml: 1 }}
                        />
                        <Button
                          size="small"
                          onClick={() =>
                            handleSentimentOverride(
                              conversation.id,
                              sentimentOverrides[conversation.id] ?? 0,
                            )
                          }
                        >
                          Save
                        </Button>
                      </Box>
                    )}
                    {/* Scheduled check-ins (mock) */}
                    {featureToggles.checkins && (
                      <Tooltip title="Next check-in: 2024-07-10">
                        <Chip label="Check-In" color="info" size="small" />
                      </Tooltip>
                    )}
                  </Box>
                </ListItem>
              ))}
            </List>
            {conversations.length === 0 && (
              <Typography variant="body2" color="text.secondary" textAlign="center">
                No conversations yet. Workers will appear here when they start chatting.
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Analytics Tab */}
      <Box role="tabpanel" hidden={tabValue !== 3}>
        <Card>
          <CardContent>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Real-Time Analytics</Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
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
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as number)}
                    label="Time Range"
                  >
                    <MenuItem value={24 * 60 * 60 * 1000}>Last 24h</MenuItem>
                    <MenuItem value={7 * 24 * 60 * 60 * 1000}>Last 7 days</MenuItem>
                    <MenuItem value={30 * 24 * 60 * 60 * 1000}>Last 30 days</MenuItem>
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  onClick={loadRealTimeAnalytics}
                  disabled={analyticsLoading}
                >
                  Refresh
                </Button>
              </Box>
            </Box>

            {analyticsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : realTimeAnalytics ? (
              <>
                {/* Overview Metrics */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'primary.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {realTimeAnalytics.overview.totalConversations}
                        </Typography>
                        <Typography variant="body2">Total Conversations</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'success.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {realTimeAnalytics.overview.activeConversations}
                        </Typography>
                        <Typography variant="body2">Active</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'warning.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {realTimeAnalytics.overview.escalatedConversations}
                        </Typography>
                        <Typography variant="body2">Escalated</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'info.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {realTimeAnalytics.overview.avgSentiment.toFixed(2)}
                        </Typography>
                        <Typography variant="body2">Avg Sentiment</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'secondary.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {realTimeAnalytics.overview.avgSatisfaction
                            ? realTimeAnalytics.overview.avgSatisfaction.toFixed(2)
                            : 'N/A'}
                        </Typography>
                        <Typography variant="body2">Avg Satisfaction</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Card sx={{ bgcolor: 'error.light', color: 'white' }}>
                      <CardContent>
                        <Typography variant="h4">
                          {(realTimeAnalytics.automation.overrideRate * 100).toFixed(1)}%
                        </Typography>
                        <Typography variant="body2">Override Rate</Typography>
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
                          Conversations Over Time
                        </Typography>
                        <Line
                          data={{
                            labels: realTimeAnalytics.trends.conversationsByDay.map(
                              (d: any) => d.date,
                            ),
                            datasets: [
                              {
                                label: 'Conversations',
                                data: realTimeAnalytics.trends.conversationsByDay.map(
                                  (d: any) => d.count,
                                ),
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
                          Sentiment Trend
                        </Typography>
                        <Line
                          data={{
                            labels: realTimeAnalytics.trends.sentimentByDay.map((d: any) => d.date),
                            datasets: [
                              {
                                label: 'Sentiment',
                                data: realTimeAnalytics.trends.sentimentByDay.map(
                                  (d: any) => d.sentiment,
                                ),
                                borderColor: 'rgba(255,99,132,1)',
                                backgroundColor: 'rgba(255,99,132,0.2)',
                                tension: 0.3,
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: { legend: { display: false } },
                            scales: { y: { min: -1, max: 1 } },
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
                          Automation Actions
                        </Typography>
                        <Doughnut
                          data={{
                            labels: ['Check-ins', 'Escalations', 'Trait Updates'],
                            datasets: [
                              {
                                data: [
                                  realTimeAnalytics.automation.autoCheckins,
                                  realTimeAnalytics.automation.autoEscalations,
                                  realTimeAnalytics.automation.traitUpdates,
                                ],
                                backgroundColor: ['#1976d2', '#d32f2f', '#388e3c'],
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
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Recent Activity (24h)
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography>New Conversations</Typography>
                            <Typography variant="h6">
                              {realTimeAnalytics.overview.recentActivity.conversations24h}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography>Scheduled Check-ins</Typography>
                            <Typography variant="h6">
                              {realTimeAnalytics.overview.recentActivity.checkins24h}
                            </Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Customer-specific metrics */}
                {realTimeAnalytics.customer && (
                  <Card sx={{ mt: 3 }}>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Customer-Specific Metrics
                      </Typography>
                      <Grid container spacing={3}>
                        <Grid item xs={12} md={3}>
                          <Typography variant="subtitle2">Total Workers</Typography>
                          <Typography variant="h4">
                            {realTimeAnalytics.customer.totalWorkers}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <Typography variant="subtitle2">Avg Conversations/Worker</Typography>
                          <Typography variant="h4">
                            {realTimeAnalytics.customer.avgConversationsPerWorker.toFixed(1)}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Typography variant="subtitle2" gutterBottom>
                            Top Issues
                          </Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {realTimeAnalytics.customer.topIssues.map(
                              (issue: any, index: number) => (
                                <Chip
                                  key={index}
                                  label={`${issue.issue} (${issue.count})`}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                              ),
                            )}
                          </Box>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Typography>No analytics data available.</Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Customer FAQ Management Tab */}
      <Box role="tabpanel" hidden={tabValue !== 4}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 3,
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Typography variant="h6">Customer FAQ Management</Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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
                <Button
                  variant="contained"
                  onClick={() => setFaqDialogOpen(true)}
                  disabled={!selectedCustomer}
                  startIcon={<AddIcon />}
                >
                  Add FAQ
                </Button>
              </Box>
            </Box>

            {selectedCustomer ? (
              <Grid container spacing={2}>
                {customerFAQs.map((faq) => (
                  <Grid item xs={12} md={6} key={faq.id}>
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
                            {faq.question}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton
                              size="small"
                              onClick={() => {
                                setEditingFAQ(faq);
                                setNewFAQ({
                                  question: faq.question,
                                  answer: faq.answer,
                                  category: faq.category,
                                  tags: faq.tags,
                                  priority: faq.priority,
                                });
                                setFaqDialogOpen(true);
                              }}
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => deleteFAQ(faq.id)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          {faq.answer}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={faq.category}
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                          <Chip
                            label={faq.priority}
                            size="small"
                            color="secondary"
                            variant="outlined"
                          />
                          <Chip label={`Used ${faq.usageCount} times`} size="small" />
                        </Box>
                        {faq.tags.length > 0 && (
                          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {faq.tags.map((tag: string, index: number) => (
                              <Chip key={index} label={tag} size="small" variant="outlined" />
                            ))}
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography>Please select a customer to manage FAQs.</Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Improvement Suggestions Tab */}
      <Box role="tabpanel" hidden={tabValue !== 5}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              AI Improvement Suggestions
            </Typography>
            <Grid container spacing={2}>
              {improvementSuggestions.map((suggestion) => (
                <Grid item xs={12} key={suggestion.id}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          mb: 2,
                        }}
                      >
                        <Box>
                          <Typography variant="h6" color="error">
                            Low Satisfaction: {suggestion.originalScore}/5
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Worker: {suggestion.workerId} |{' '}
                            {new Date(suggestion.createdAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            onClick={() => updateSuggestionStatus(suggestion.id, 'implemented', '')}
                          >
                            Implement
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            onClick={() => updateSuggestionStatus(suggestion.id, 'reviewed', '')}
                          >
                            Review
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => updateSuggestionStatus(suggestion.id, 'rejected', '')}
                          >
                            Reject
                          </Button>
                        </Box>
                      </Box>

                      <Typography variant="body2" sx={{ mb: 2 }}>
                        <strong>Feedback:</strong> {suggestion.feedback}
                      </Typography>

                      <Typography variant="subtitle2" gutterBottom>
                        Suggested Improvements:
                      </Typography>
                      {suggestion.suggestedImprovements?.map((improvement: any, index: number) => (
                        <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                          <Typography variant="body2">
                            <strong>{improvement.category}:</strong> {improvement.suggestion}
                          </Typography>
                          <Chip label={improvement.priority} size="small" sx={{ mt: 0.5 }} />
                        </Box>
                      ))}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {/* FAQ Dialog */}
      <Dialog open={faqDialogOpen} onClose={() => setFaqDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingFAQ ? 'Edit FAQ' : 'Add New FAQ'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Question"
            value={newFAQ.question}
            onChange={(e) => setNewFAQ({ ...newFAQ, question: e.target.value })}
            margin="normal"
            multiline
            rows={2}
          />
          <TextField
            fullWidth
            label="Answer"
            value={newFAQ.answer}
            onChange={(e) => setNewFAQ({ ...newFAQ, answer: e.target.value })}
            margin="normal"
            multiline
            rows={4}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Category</InputLabel>
            <Select
              value={newFAQ.category}
              onChange={(e) => setNewFAQ({ ...newFAQ, category: e.target.value })}
              label="Category"
            >
              <MenuItem value="general">General</MenuItem>
              <MenuItem value="payroll">Payroll</MenuItem>
              <MenuItem value="scheduling">Scheduling</MenuItem>
              <MenuItem value="benefits">Benefits</MenuItem>
              <MenuItem value="policies">Policies</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel>Priority</InputLabel>
            <Select
              value={newFAQ.priority}
              onChange={(e) => setNewFAQ({ ...newFAQ, priority: e.target.value })}
              label="Priority"
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFaqDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={saveFAQ}
            variant="contained"
            disabled={!newFAQ.question || !newFAQ.answer}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Messages */}
      {success && (
        <Alert severity="success" onClose={() => setSuccess('')} sx={{ mt: 2 }}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};

export default AIChat;
