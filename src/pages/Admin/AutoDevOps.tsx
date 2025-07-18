import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Switch,
  FormControlLabel,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  LinearProgress,
  CircularProgress,
  Tooltip,
  Badge,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  BugReport as BugIcon,
  Speed as SpeedIcon,
  Lightbulb as SuggestionIcon,
  Settings as SettingsIcon,
  ArrowBack as ArrowBackIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
  ContentCopy as CopyIcon,
  PlayArrow as ApplyIcon,
  Code as CodeIcon,
  Notifications as NotifyIcon,
  AutoFixHigh as AutoFixIcon,
  Monitor as MonitorIcon,
  Build as BuildIcon,
  Security as SecurityIcon,
  Analytics as AnalyticsIcon,
  Timeline as TimelineIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';
import DevOpsChat from '../../components/DevOpsChat';
import { useAuth } from '../../contexts/AuthContext';

interface AutoDevOpsLog {
  id: string;
  timestamp: Date;
  source:
    | 'AI Engine'
    | 'Trait Module'
    | 'Moments Engine'
    | 'Companion Chat'
    | 'Firestore'
    | 'Vector Engine'
    | 'Context Engine';
  category: 'Error' | 'Performance' | 'Optimization' | 'Suggestion';
  summary: string;
  suggestion?: string;
  affectedFiles?: string[];
  autoFixPatch?: any;
  needsHumanReview: boolean;
  status: 'New' | 'In Review' | 'Fixed' | 'Ignored';
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  userImpact?: string;
  estimatedFixTime?: string;
}

interface AutoDevOpsSettings {
  id: string;
  autoFixEnabled: boolean;
  notifyOnMajorIssue: boolean;
  watchedModules: string[];
  notifyEmails: string[];
  slackWebhook?: string;
  autoPatchThreshold: 'Low' | 'Medium' | 'High';
  maxSuggestionsPerDay: number;
}

interface CodePatch {
  file: string;
  original: string;
  suggested: string;
  diff: string;
  confidence: number;
}

interface QualityMetrics {
  successRate: number;
  avgLatency: number;
  errorRate: number;
  totalInteractions: number;
  qualityScore: number;
}

interface ConfigSuggestion {
  type: string;
  description: string;
  configChanges: Record<string, string>;
  confidence: number;
}

interface LogPattern {
  type: string;
  errorType?: string;
  issue?: string;
  count: number;
  logs: any[];
  suggestion: string;
  avgLatency?: number;
}

interface AutoDevOpsMetrics {
  id: string;
  timestamp: Date;
  period: 'hourly' | 'daily' | 'weekly';
  totalFixAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  partialFixes: number;
  averageFixTimeMs: number;
  totalProcessingTimeMs: number;
  logsProcessed: number;
  logsReprocessed: number;
  errorTypes: Record<string, number>;
  errorMessages: string[];
  criticalErrors: number;
  buildErrors: number;
  deploymentErrors: number;
  developmentErrors: number;
  compilationErrors: number;
  typeScriptErrors: number;
  lintingErrors: number;
  testFailures: number;
  systemHealth: 'healthy' | 'degraded' | 'critical';
  healthScore: number;
  fixSuccessRate: number;
  reprocessSuccessRate: number;
  averageLogsPerRun: number;
  memoryUsageMB: number;
  cpuUsagePercent: number;
  functionExecutionTimeMs: number;
  alertsGenerated: number;
  alertsResolved: number;
  pendingAlerts: number;
}

interface RealTimeMetrics {
  lastRunTime: Date;
  isCurrentlyRunning: boolean;
  currentRunStartTime?: Date;
  logsInQueue: number;
  activeFixes: number;
  systemStatus: 'idle' | 'processing' | 'error' | 'maintenance';
  uptimeSeconds: number;
  lastError?: string;
  lastErrorTime?: Date;
  buildStatus: 'success' | 'failed' | 'building' | 'unknown';
  deploymentStatus: 'success' | 'failed' | 'deploying' | 'unknown';
  lastBuildTime?: Date;
  lastDeploymentTime?: Date;
  pendingBuilds: number;
  pendingDeployments: number;
}

interface BuildDeploymentError {
  id: string;
  timestamp: Date;
  type: 'build' | 'deployment' | 'compilation' | 'typescript' | 'linting' | 'test' | 'development';
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  errorDetails: string;
  affectedFiles: string[];
  stackTrace?: string;
  buildId?: string;
  deploymentId?: string;
  branch?: string;
  commit?: string;
  status: 'detected' | 'fixing' | 'fixed' | 'failed';
  autoFixAttempted: boolean;
  fixApplied?: string;
  resolvedAt?: Date;
}

interface BuildDeploymentStats {
  totalErrors: number;
  buildErrors: number;
  deploymentErrors: number;
  developmentErrors: number;
  criticalErrors: number;
  autoFixed: number;
  pendingFixes: number;
  failedFixes: number;
  errorTypes: {
    build: number;
    deployment: number;
    development: number;
    compilation: number;
    typescript: number;
    linting: number;
    test: number;
  };
  severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface AIEngineProcessingStats {
  totalErrors: number;
  engineNotEngaged: number;
  engineProcessingFailed: number;
  engineTimeout: number;
  engineConfigError: number;
  criticalErrors: number;
  autoFixed: number;
  pendingFixes: number;
  failedFixes: number;
  errorTypes: {
    engine_not_engaged: number;
    engine_processing_failed: number;
    engine_timeout: number;
    engine_config_error: number;
  };
  severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  engines: {
    ContextEngine: number;
    FeedbackEngine: number;
    MomentsEngine: number;
    ToneEngine: number;
    TraitsEngine: number;
    WeightsEngine: number;
    VectorEngine: number;
    PriorityEngine: number;
  };
}

const AutoDevOps: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AutoDevOpsLog[]>([]);
  const [settings, setSettings] = useState<AutoDevOpsSettings>({
    id: 'global',
    autoFixEnabled: false,
    notifyOnMajorIssue: true,
    watchedModules: ['AI Engine', 'Firestore', 'Vector Engine', 'Context Engine'],
    notifyEmails: ['cto@hrxone.com'],
    autoPatchThreshold: 'Medium',
    maxSuggestionsPerDay: 50,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filters, setFilters] = useState({
    source: '',
    category: '',
    status: '',
    severity: '',
    fixableOnly: false,
  });
  const [selectedLog, setSelectedLog] = useState<AutoDevOpsLog | null>(null);
  const [patchDialog, setPatchDialog] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [liveMode, setLiveMode] = useState(true);
  const [metrics, setMetrics] = useState<AutoDevOpsMetrics | null>(null);
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
  const [buildDeploymentStats, setBuildDeploymentStats] = useState<BuildDeploymentStats | null>(null);
  const [buildDeploymentErrors, setBuildDeploymentErrors] = useState<BuildDeploymentError[]>([]);
  const [patterns, setPatterns] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<ConfigSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [timeRange, setTimeRange] = useState(24);
  const [showLogDetails, setShowLogDetails] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [aiEngineProcessingStats, setAiEngineProcessingStats] = useState<AIEngineProcessingStats | null>(null);
  const navigate = useNavigate();

  const functions = getFunctions();

  const formatLatency = (latency: number) => {
    if (latency < 1000) return `${latency}ms`;
    return `${(latency / 1000).toFixed(1)}s`;
  };

  // Mock data for demonstration
  const mockLogs: AutoDevOpsLog[] = [
    {
      id: 'log_1',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      source: 'AI Engine',
      category: 'Performance',
      summary: 'Prompt exceeded max length due to missing tone trimming rule',
      suggestion: 'Update promptPreprocessor.ts to include tone condensing logic',
      affectedFiles: ['/lib/promptPreprocessor.ts', '/src/utils/toneManager.ts'],
      autoFixPatch: {
        file: '/lib/promptPreprocessor.ts',
        changes: [
          {
            line: 45,
            original: '// No tone trimming',
            suggested: 'const trimmedTone = condenseTone(toneSettings);',
          },
          {
            line: 67,
            original: 'return prompt;',
            suggested: 'return applyToneTrimming(prompt, trimmedTone);',
          },
        ],
      },
      needsHumanReview: true,
      status: 'New',
      severity: 'Medium',
      userImpact: 'Slower AI responses',
      estimatedFixTime: '15 minutes',
    },
    {
      id: 'log_2',
      timestamp: new Date(Date.now() - 15 * 60 * 1000),
      source: 'Vector Engine',
      category: 'Error',
      summary: 'Vector similarity threshold too low causing irrelevant results',
      suggestion: 'Increase similarity threshold from 0.7 to 0.85',
      affectedFiles: ['/config/vectorSettings.json'],
      autoFixPatch: {
        file: '/config/vectorSettings.json',
        changes: [
          {
            line: 12,
            original: '"similarityThreshold": 0.7',
            suggested: '"similarityThreshold": 0.85',
          },
        ],
      },
      needsHumanReview: false,
      status: 'Fixed',
      severity: 'High',
      userImpact: 'Poor context relevance',
      estimatedFixTime: '2 minutes',
    },
    {
      id: 'log_3',
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
      source: 'Firestore',
      category: 'Optimization',
      summary: 'Redundant context being loaded for simple queries',
      suggestion: 'Implement context caching for frequently accessed data',
      affectedFiles: ['/src/contextLoader.ts', '/src/cacheManager.ts'],
      autoFixPatch: null,
      needsHumanReview: true,
      status: 'In Review',
      severity: 'Low',
      userImpact: 'Increased database costs',
      estimatedFixTime: '1 hour',
    },
    {
      id: 'log_4',
      timestamp: new Date(Date.now() - 45 * 60 * 1000),
      source: 'Moments Engine',
      category: 'Suggestion',
      summary: 'Trait scoring missing for 23% of interactions',
      suggestion: 'Add fallback trait scoring for incomplete data',
      affectedFiles: ['/src/traitScorer.ts'],
      autoFixPatch: {
        file: '/src/traitScorer.ts',
        changes: [
          {
            line: 89,
            original: 'if (!traitData) return null;',
            suggested: 'if (!traitData) return estimateTraitsFromContext(context);',
          },
        ],
      },
      needsHumanReview: true,
      status: 'New',
      severity: 'Medium',
      userImpact: 'Incomplete trait analysis',
      estimatedFixTime: '30 minutes',
    },
    {
      id: 'log_5',
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
      source: 'Context Engine',
      category: 'Error',
      summary: 'Context assembly failed due to missing customer tone settings',
      suggestion: 'Add default tone fallback and error handling',
      affectedFiles: ['/src/contextAssembler.ts'],
      autoFixPatch: {
        file: '/src/contextAssembler.ts',
        changes: [
          {
            line: 156,
            original: 'const tone = customerTone;',
            suggested: 'const tone = customerTone || getDefaultTone();',
          },
          {
            line: 157,
            original: 'if (!tone) throw new Error("No tone found");',
            suggested: 'if (!tone) console.warn("Using default tone");',
          },
        ],
      },
      needsHumanReview: false,
      status: 'Fixed',
      severity: 'Critical',
      userImpact: 'AI responses failing',
      estimatedFixTime: '10 minutes',
    },
  ];

  useEffect(() => {
    loadData();
    if (liveMode) {
      const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [liveMode]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const functions = getFunctions(app);
      const getAutoDevOpsLogs = httpsCallable(functions, 'getAutoDevOpsLogs');
      const getAutoDevOpsSettings = httpsCallable(functions, 'getAutoDevOpsSettings');
      const getLatestMetrics = httpsCallable(functions, 'getLatestAutoDevOpsMetrics');
      const getRealTimeMetrics = httpsCallable(functions, 'getRealTimeMetrics');
      const getBuildDeploymentStats = httpsCallable(functions, 'getBuildDeploymentStats');

      const [logsResult, settingsResult, metricsResult, realTimeResult, statsResult] = await Promise.all([
        getAutoDevOpsLogs(),
        getAutoDevOpsSettings(),
        getLatestMetrics(),
        getRealTimeMetrics(),
        getBuildDeploymentStats()
      ]);

      const logsData = logsResult.data as { logs: AutoDevOpsLog[] };
      const settingsData = settingsResult.data as { settings: AutoDevOpsSettings };

      setLogs(logsData.logs || []);
      // Only update settings if we get valid data, otherwise keep the default
      if (settingsData.settings) {
        setSettings(settingsData.settings);
      }
      
      if (metricsResult.data) {
        const metricsData = metricsResult.data as any;
        setMetrics(metricsData.metrics);
      }
      if (realTimeResult.data) {
        const realTimeData = realTimeResult.data as any;
        setRealTimeMetrics(realTimeData.metrics);
      }
      if (statsResult.data) {
        const statsData = statsResult.data as any;
        setBuildDeploymentStats(statsData.stats);
      }

    } catch (err: any) {
      // Fallback to mock data for development
      setLogs(mockLogs);
      console.warn('Using mock data for AutoDevOps:', err.message);
      // Keep the default settings on error
    } finally {
      setLoading(false);
    }
  };

  const handleViewPatch = (log: AutoDevOpsLog) => {
    setSelectedLog(log);
    setPatchDialog(true);
  };

  const handleApplyPatch = async (log: AutoDevOpsLog) => {
    try {
      const functions = getFunctions(app);
      const applyAutoDevOpsPatch = httpsCallable(functions, 'applyAutoDevOpsPatch');

      await applyAutoDevOpsPatch({
        logId: log.id,
        patch: log.autoFixPatch,
        userId: 'current_user', // TODO: Get actual user ID
      });

      setLogs((prev) =>
        prev.map((l) => (l.id === log.id ? { ...l, status: 'Fixed' as const } : l)),
      );
      setSuccess('Patch applied successfully');
      setPatchDialog(false);
    } catch (err: any) {
      setError('Failed to apply patch');
    }
  };

  const handleCopyPatch = (log: AutoDevOpsLog) => {
    if (log.autoFixPatch) {
      navigator.clipboard.writeText(JSON.stringify(log.autoFixPatch, null, 2));
      setSuccess('Patch copied to clipboard');
    }
  };

  const handleUpdateSettings = async () => {
    try {
      const functions = getFunctions(app);
      const updateAutoDevOpsSettings = httpsCallable(functions, 'updateAutoDevOpsSettings');

      await updateAutoDevOpsSettings({
        settings,
        userId: 'current_user', // TODO: Get actual user ID
      });

      setSuccess('Settings updated successfully');
      setSettingsDialog(false);
    } catch (err: any) {
      setError('Failed to update settings');
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Error':
        return 'error';
      case 'Performance':
        return 'warning';
      case 'Optimization':
        return 'info';
      case 'Suggestion':
        return 'success';
      default:
        return 'default';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical':
        return 'error';
      case 'High':
        return 'warning';
      case 'Medium':
        return 'info';
      case 'Low':
        return 'success';
      default:
        return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Fixed':
        return 'success';
      case 'In Review':
        return 'warning';
      case 'New':
        return 'info';
      case 'Ignored':
        return 'default';
      default:
        return 'default';
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'AI Engine':
        return <BuildIcon />;
      case 'Vector Engine':
        return <SpeedIcon />;
      case 'Firestore':
        return <SecurityIcon />;
      case 'Context Engine':
        return <AutoFixIcon />;
      case 'Moments Engine':
        return <AutoFixIcon />;
      default:
        return <BugIcon />;
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filters.source && log.source !== filters.source) return false;
    if (filters.category && log.category !== filters.category) return false;
    if (filters.status && log.status !== filters.status) return false;
    if (filters.severity && log.severity !== filters.severity) return false;
    if (filters.fixableOnly && !log.autoFixPatch) return false;
    return true;
  });

  const recentFixes = logs.filter((log) => log.status === 'Fixed').slice(0, 5);
  const criticalIssues = logs.filter(
    (log) => log.severity === 'Critical' && log.status !== 'Fixed',
  );
  const pendingReview = logs.filter((log) => log.needsHumanReview && log.status === 'New');

  const fetchMetrics = async () => {
    try {
      const getMetrics = httpsCallable(functions, 'getAILogQualityMetrics');
      const result = await getMetrics({
        tenantId: selectedCustomer || null,
        module: selectedModule || null,
        timeRange,
      });
      setMetrics((result.data as any).metrics);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    }
  };

  const analyzePatterns = async () => {
    try {
      const analyzePatterns = httpsCallable(functions, 'analyzeAILogsForPatterns');
      const result = await analyzePatterns({ timeRange });
      setPatterns((result.data as any).patterns);
    } catch (error) {
      console.error('Error analyzing patterns:', error);
    }
  };

  const getSuggestions = async (issueType: string) => {
    try {
      const getSuggestions = httpsCallable(functions, 'suggestConfigImprovements');
      const result = await getSuggestions({
        tenantId: selectedCustomer || null,
        module: selectedModule || null,
        issueType,
      });
      setSuggestions((result.data as any).suggestions);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error getting suggestions:', error);
    }
  };

  const updateLogStatus = async (logId: string, status: string) => {
    try {
      const updateLog = httpsCallable(functions, 'updateAutoDevOpsLog');
      await updateLog({ logId, status });
      loadData();
    } catch (error) {
      console.error('Error updating log status:', error);
    }
  };

  const applyPatch = async (patch: any) => {
    try {
      const applyPatch = httpsCallable(functions, 'applyAutoDevOpsPatch');
      await applyPatch({ patch });
      loadData();
    } catch (error) {
      console.error('Error applying patch:', error);
    }
  };

  const startMonitoring = async () => {
    try {
      setIsMonitoring(true);
      const functions = getFunctions(app);
      const monitorBuildDeploymentErrors = httpsCallable(functions, 'monitorBuildDeploymentErrors');
      await monitorBuildDeploymentErrors({ userId: user?.uid });
      await loadData(); // Refresh data after monitoring
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsMonitoring(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'build':
        return <BuildIcon />;
      case 'deployment':
        return <CloudUploadIcon />;
      case 'development':
        return <CodeIcon />;
      case 'compilation':
        return <BugIcon />;
      case 'typescript':
        return <CodeIcon />;
      case 'linting':
        return <WarningIcon />;
      case 'test':
        return <CheckCircleIcon />;
      default:
        return <BugIcon />;
    }
  };

  if (loading && !metrics) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
          AutoDevOps Assistant
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              loadData();
              fetchMetrics();
              analyzePatterns();
            }}
            disabled={loading}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
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
      </Box>

      <Typography variant="subtitle1" color="text.secondary" mb={3}>
        AI-powered DevOps monitoring and automated fix suggestions for the HRX system.
      </Typography>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <ErrorIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h6">{criticalIssues.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Critical Issues
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <InfoIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">{pendingReview.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Pending Review
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CheckCircleIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">{recentFixes.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Recent Fixes
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AutoFixIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">{settings?.autoFixEnabled ? 'ON' : 'OFF'}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Auto-Fix Status
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Content */}
      <Box sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
            <Tab label="Live Feed" />
            <Tab label="Recent Fixes" />
            <Tab label="Settings" />
          </Tabs>
        </Box>

        {/* Live Feed Tab */}
        <Box role="tabpanel" hidden={tabValue !== 0} sx={{ mt: 3 }}>
          {/* Filters */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Source</InputLabel>
                  <Select
                    value={filters.source}
                    onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value }))}
                    label="Source"
                  >
                    <MenuItem value="">All Sources</MenuItem>
                    <MenuItem value="AI Engine">AI Engine</MenuItem>
                    <MenuItem value="Vector Engine">Vector Engine</MenuItem>
                    <MenuItem value="Firestore">Firestore</MenuItem>
                    <MenuItem value="Context Engine">Context Engine</MenuItem>
                    <MenuItem value="Moments Engine">Moments Engine</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={filters.category}
                    onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
                    label="Category"
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    <MenuItem value="Error">Error</MenuItem>
                    <MenuItem value="Performance">Performance</MenuItem>
                    <MenuItem value="Optimization">Optimization</MenuItem>
                    <MenuItem value="Suggestion">Suggestion</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                    label="Status"
                  >
                    <MenuItem value="">All Status</MenuItem>
                    <MenuItem value="New">New</MenuItem>
                    <MenuItem value="In Review">In Review</MenuItem>
                    <MenuItem value="Fixed">Fixed</MenuItem>
                    <MenuItem value="Ignored">Ignored</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Severity</InputLabel>
                  <Select
                    value={filters.severity}
                    onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))}
                    label="Severity"
                  >
                    <MenuItem value="">All Severities</MenuItem>
                    <MenuItem value="Critical">Critical</MenuItem>
                    <MenuItem value="High">High</MenuItem>
                    <MenuItem value="Medium">Medium</MenuItem>
                    <MenuItem value="Low">Low</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={filters.fixableOnly}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, fixableOnly: e.target.checked }))
                      }
                    />
                  }
                  label="Fixable Only"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControlLabel
                  control={
                    <Switch checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
                  }
                  label="Live Mode"
                />
              </Grid>
            </Grid>
          </Paper>

          {/* Logs Table */}
          <Paper>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Summary</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredLogs
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((log) => (
                      <TableRow key={log.id} hover>
                        <TableCell>
                          <Typography variant="caption">
                            {log.timestamp.toLocaleTimeString()}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            {getSourceIcon(log.source)}
                            <Typography variant="body2" sx={{ ml: 1 }}>
                              {log.source}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={log.category}
                            size="small"
                            color={getCategoryColor(log.category)}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ maxWidth: 300 }}>
                            {log.summary}
                          </Typography>
                          {log.suggestion && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              💡 {log.suggestion}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={log.severity}
                            size="small"
                            color={getSeverityColor(log.severity)}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={log.status}
                            size="small"
                            color={getStatusColor(log.status)}
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {log.autoFixPatch && (
                              <Tooltip title="View Patch">
                                <IconButton
                                  size="small"
                                  onClick={() => handleViewPatch(log)}
                                  color="primary"
                                >
                                  <CodeIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {log.needsHumanReview && (
                              <Tooltip title="Needs Review">
                                <IconButton size="small" color="warning">
                                  <NotifyIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              rowsPerPageOptions={[10, 25, 50]}
              component="div"
              count={filteredLogs.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </Paper>
        </Box>

        {/* Recent Fixes Tab */}
        <Box role="tabpanel" hidden={tabValue !== 1} sx={{ mt: 3 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Recently Applied Fixes
            </Typography>
            <List>
              {recentFixes.map((log) => (
                <ListItem key={log.id} divider>
                  <ListItemIcon>
                    <CheckCircleIcon color="success" />
                  </ListItemIcon>
                  <ListItemText
                    primary={log.summary}
                    secondary={`${log.source} • ${log.timestamp.toLocaleString()}`}
                  />
                  <ListItemSecondaryAction>
                    <Button
                      size="small"
                      startIcon={<ViewIcon />}
                      onClick={() => handleViewPatch(log)}
                    >
                      View Fix
                    </Button>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>

        {/* Settings Tab */}
        <Box role="tabpanel" hidden={tabValue !== 2} sx={{ mt: 3 }}>
          <Paper sx={{ p: 3 }}>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">AutoDevOps Settings</Typography>
              <Button
                variant="contained"
                startIcon={<SettingsIcon />}
                onClick={() => setSettingsDialog(true)}
              >
                Edit Settings
              </Button>
            </Box>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Auto-Fix Configuration
                    </Typography>
                    <FormControlLabel
                      control={<Switch checked={settings?.autoFixEnabled || false} disabled />}
                      label="Enable Auto-Fix"
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Threshold: {settings?.autoPatchThreshold || 'Medium'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Max suggestions per day: {settings?.maxSuggestionsPerDay || 50}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Notifications
                    </Typography>
                    <FormControlLabel
                      control={<Switch checked={settings?.notifyOnMajorIssue || false} disabled />}
                      label="Notify on Major Issues"
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Watched modules: {settings?.watchedModules?.length || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Notification emails: {settings?.notifyEmails?.length || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Box>
      </Box>

      {/* Patch Viewer Dialog */}
      <Dialog open={patchDialog} onClose={() => setPatchDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Code Patch</Typography>
            <Box>
              {selectedLog?.autoFixPatch && (
                <>
                  <Button
                    size="small"
                    startIcon={<CopyIcon />}
                    onClick={() => handleCopyPatch(selectedLog)}
                    sx={{ mr: 1 }}
                  >
                    Copy
                  </Button>
                  <Button
                    size="small"
                    startIcon={<ApplyIcon />}
                    onClick={() => handleApplyPatch(selectedLog)}
                    variant="contained"
                    color="primary"
                  >
                    Apply Patch
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedLog && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                {selectedLog.summary}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {selectedLog.suggestion}
              </Typography>

              {selectedLog.autoFixPatch && (
                <Paper sx={{ p: 2, mt: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="h6" gutterBottom>
                    Suggested Changes
                  </Typography>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{ whiteSpace: 'pre-wrap' }}
                  >
                    {JSON.stringify(selectedLog.autoFixPatch, null, 2)}
                  </Typography>
                </Paper>
              )}

              {selectedLog.affectedFiles && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Affected Files
                  </Typography>
                  {selectedLog.affectedFiles.map((file, index) => (
                    <Chip key={index} label={file} size="small" sx={{ mr: 1, mb: 1 }} />
                  ))}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPatchDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog
        open={settingsDialog}
        onClose={() => setSettingsDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit AutoDevOps Settings</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Auto-Fix Configuration
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings?.autoFixEnabled || false}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, autoFixEnabled: e.target.checked }))
                    }
                  />
                }
                label="Enable Auto-Fix"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Auto-Patch Threshold</InputLabel>
                <Select
                  value={settings?.autoPatchThreshold || 'Medium'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, autoPatchThreshold: e.target.value as any }))
                  }
                  label="Auto-Patch Threshold"
                >
                  <MenuItem value="Low">Low (Apply most suggestions)</MenuItem>
                  <MenuItem value="Medium">Medium (Apply safe suggestions)</MenuItem>
                  <MenuItem value="High">High (Apply only critical fixes)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Max Suggestions Per Day"
                type="number"
                value={settings?.maxSuggestionsPerDay || 50}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    maxSuggestionsPerDay: parseInt(e.target.value),
                  }))
                }
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Notifications
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings?.notifyOnMajorIssue || false}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, notifyOnMajorIssue: e.target.checked }))
                    }
                  />
                }
                label="Notify on Major Issues"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Slack Webhook URL"
                value={settings?.slackWebhook || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, slackWebhook: e.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialog(false)}>Cancel</Button>
          <Button onClick={handleUpdateSettings} variant="contained">
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>

      {/* System Status Overview */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                System Health
              </Typography>
              <Box display="flex" alignItems="center">
                <Chip
                  label={realTimeMetrics?.systemStatus || 'Unknown'}
                  color={getStatusColor(realTimeMetrics?.systemStatus || '')}
                  sx={{ mr: 1 }}
                />
                {realTimeMetrics?.isCurrentlyRunning && (
                  <CircularProgress size={20} sx={{ ml: 1 }} />
                )}
              </Box>
              <Typography variant="h6" sx={{ mt: 1 }}>
                {metrics?.healthScore || 0}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Build Status
              </Typography>
              <Chip
                label={realTimeMetrics?.buildStatus || 'Unknown'}
                color={getStatusColor(realTimeMetrics?.buildStatus || '')}
              />
              <Typography variant="h6" sx={{ mt: 1 }}>
                {buildDeploymentStats?.buildErrors || 0} Errors
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Deployment Status
              </Typography>
              <Chip
                label={realTimeMetrics?.deploymentStatus || 'Unknown'}
                color={getStatusColor(realTimeMetrics?.deploymentStatus || '')}
              />
              <Typography variant="h6" sx={{ mt: 1 }}>
                {buildDeploymentStats?.deploymentErrors || 0} Errors
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Auto-Fix Success Rate
              </Typography>
              <Typography variant="h6">
                {metrics?.fixSuccessRate ? (metrics.fixSuccessRate * 100).toFixed(1) : 0}%
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {buildDeploymentStats?.autoFixed || 0} auto-fixed
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Error Statistics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Error Distribution by Type
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {buildDeploymentStats?.errorTypes && Object.entries(buildDeploymentStats.errorTypes).map(([type, count]) => (
                  <Chip
                    key={type}
                    label={`${type}: ${count}`}
                    icon={getTypeIcon(type)}
                    variant="outlined"
                    size="small"
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Error Severity Breakdown
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {buildDeploymentStats?.severity && Object.entries(buildDeploymentStats.severity).map(([severity, count]) => (
                  <Chip
                    key={severity}
                    label={`${severity}: ${count}`}
                    color={getSeverityColor(severity)}
                    size="small"
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Performance Metrics */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Performance Metrics
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="textSecondary">
                Average Fix Time
              </Typography>
              <Typography variant="h6">
                {metrics?.averageFixTimeMs ? (metrics.averageFixTimeMs / 1000).toFixed(2) : 0}s
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="textSecondary">
                Logs Processed
              </Typography>
              <Typography variant="h6">
                {metrics?.logsProcessed || 0}
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="textSecondary">
                Logs in Queue
              </Typography>
              <Typography variant="h6">
                {realTimeMetrics?.logsInQueue || 0}
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="textSecondary">
                Active Fixes
              </Typography>
              <Typography variant="h6">
                {realTimeMetrics?.activeFixes || 0}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Activity
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Last Run: {realTimeMetrics?.lastRunTime ? new Date(realTimeMetrics.lastRunTime).toLocaleString() : 'Never'}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                Uptime: {realTimeMetrics?.uptimeSeconds ? Math.floor(realTimeMetrics.uptimeSeconds / 3600) : 0} hours
              </Typography>
              {realTimeMetrics?.lastError && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Last Error: {realTimeMetrics.lastError}
                </Alert>
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Pending Builds: {realTimeMetrics?.pendingBuilds || 0}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                Pending Deployments: {realTimeMetrics?.pendingDeployments || 0}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                Total Errors: {buildDeploymentStats?.totalErrors || 0}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

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

      <DevOpsChat
        context={{
          logs:
            logs.length > 0
              ? `Found ${logs.length} AutoDevOps logs. Recent issues: ${logs
                  .slice(0, 3)
                  .map((log) => log.summary)
                  .join(', ')}`
              : 'No logs found.',
          error: selectedLog?.summary || 'No specific error selected.',
          filename: selectedLog?.affectedFiles?.[0] || 'No file context.',
          filetree:
            'HRX project structure includes React frontend, Firebase backend, and AI orchestration modules.',
        }}
      />
    </Box>
  );
};

export default AutoDevOps;
