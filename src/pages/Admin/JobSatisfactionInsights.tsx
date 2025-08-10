import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  LinearProgress,
  Tooltip,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Snackbar,
  Accordion,
  AccordionDetails,
  Avatar,
  Checkbox,
  Slider,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  FormHelperText,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import {
  ArrowBack,
  TrendingUp,
  TrendingDown,
  Warning,
  CheckCircle,
  Info,
  Settings,
  Download,
  Refresh,
  Assessment,
  Psychology,
  Work,
  SupervisorAccount,
  Favorite,
  ExitToApp,
  Timeline,
  TableChart,
  Help,
  Book,
  Schedule,
  Analytics,
  PictureAsPdf,
  TableView,
  Code,
  Report,
  Print,
  Chat,
  Close,
  SmartToy as AutomationIcon,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ReferenceLine,
} from 'recharts';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useModuleAccess } from '../../utils/useModuleAccess';
import JSICustomReportBuilder from '../../components/JSICustomReportBuilder';
import { generatePDFReport, generateExcelReport } from '../../utils/exportUtils';

interface JSIScore {
  id: string;
  userId: string;
  userName: string;
  region?: string;
  division?: string;
  department: string;
  location: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  lastUpdated: string;
  trend: 'up' | 'down' | 'stable';
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  supervisor?: string;
  team?: string;
  aiSummary?: string;
  lastSurveyResponse?: string;
  recommendedAction?: string;
}

interface JSIBaseline {
  tenantId: string;
  customerId?: string; // For backward compatibility with export functions
  region?: string;
  division?: string;
  department?: string;
  location?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  dateRange: {
    start: string;
    end: string;
  };
  workerCount: number;
  calculatedAt: string;
}

interface JSIBenchmark {
  type: 'global' | 'industry';
  industryCode?: string;
  industryName?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  workerCount: number;
  customerCount: number;
  calculatedAt: string;
  dateRange: {
    start: string;
    end: string;
  };
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
}

interface JSITrendData {
  date: string;
  overall: number;
  engagement: number;
  career: number;
  manager: number;
  wellbeing: number;
  mobility: number;
  workerCount: number;
}

interface JSIDimension {
  name: string;
  weight: number;
  score: number;
  trend: 'up' | 'down' | 'stable';
  icon: React.ReactNode;
  color: string;
}

interface RiskTag {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  severity: 'low' | 'medium' | 'high';
}

interface ReportFilters {
  tenantId: string;
  region: string;
  division: string;
  department: string;
  location: string;
  riskLevel: string;
  showPersonalWellbeing: boolean;
  timeRange: string;
  customStartDate?: string;
  customEndDate?: string;
}

interface JSIMessagingTopic {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  priority: 'high' | 'medium' | 'low';
  frequency: 'weekly' | 'monthly' | 'quarterly';
  samplePrompts: string[];
  category: 'wellbeing' | 'engagement' | 'career' | 'relationships' | 'custom';
  createdAt: string;
  updatedAt: string;
}

interface JSIMessagingConfig {
  tenantId: string;
  topics: JSIMessagingTopic[];
  globalSettings: {
    enableCustomTopics: boolean;
    maxTopicsPerPrompt: number;
    topicRotationStrategy: 'random' | 'priority' | 'frequency';
    defaultFrequency: 'weekly' | 'monthly' | 'quarterly';
  };
  createdAt: string;
  updatedAt: string;
}

const riskTags: RiskTag[] = [
  {
    id: 'low_engagement',
    name: 'Low Engagement',
    description: 'Worker shows signs of disengagement',
    icon: <Work />,
    color: '#f44336',
    severity: 'medium',
  },
  {
    id: 'career_misalignment',
    name: 'Career Misalignment',
    description: "Role doesn't match long-term goals",
    icon: <Psychology />,
    color: '#ff9800',
    severity: 'medium',
  },
  {
    id: 'manager_strain',
    name: 'Manager Strain',
    description: 'Issues with supervisor relationship',
    icon: <SupervisorAccount />,
    color: '#9c27b0',
    severity: 'high',
  },
  {
    id: 'job_search_risk',
    name: 'Job Search Risk',
    description: 'Signals of job hunting activity',
    icon: <ExitToApp />,
    color: '#e91e63',
    severity: 'high',
  },
  {
    id: 'wellbeing_decline',
    name: 'Wellbeing Decline',
    description: 'Personal wellbeing concerns',
    icon: <Favorite />,
    color: '#607d8b',
    severity: 'high',
  },
  {
    id: 'tenure_risk',
    name: 'Tenure Risk',
    description: 'Short tenure with satisfaction issues',
    icon: <Timeline />,
    color: '#795548',
    severity: 'medium',
  },
  {
    id: 'burnout_pattern',
    name: 'Burnout Pattern',
    description: 'Detected burnout indicators',
    icon: <Warning />,
    color: '#d32f2f',
    severity: 'high',
  },
];

// Mock baseline data
const mockBaselineData: JSIBaseline = {
  tenantId: 'global',
  customerId: 'global', // For backward compatibility with export functions
  overallScore: 75,
  workEngagement: 78,
  careerAlignment: 72,
  managerRelationship: 76,
  personalWellbeing: 74,
  jobMobility: 68,
  dateRange: {
    start: '2024-01-01',
    end: '2024-01-14',
  },
  workerCount: 45,
  calculatedAt: '2024-01-15',
};

// Enhanced mock trend data with more realistic patterns
const mockTrendData: JSITrendData[] = [
  {
    date: '2024-01-01',
    overall: 75,
    engagement: 78,
    career: 72,
    manager: 76,
    wellbeing: 74,
    mobility: 68,
    workerCount: 45,
  },
  {
    date: '2024-01-08',
    overall: 77,
    engagement: 80,
    career: 73,
    manager: 77,
    wellbeing: 75,
    mobility: 69,
    workerCount: 47,
  },
  {
    date: '2024-01-15',
    overall: 78,
    engagement: 82,
    career: 74,
    manager: 78,
    wellbeing: 76,
    mobility: 70,
    workerCount: 48,
  },
  {
    date: '2024-01-22',
    overall: 76,
    engagement: 79,
    career: 73,
    manager: 77,
    wellbeing: 75,
    mobility: 69,
    workerCount: 49,
  },
  {
    date: '2024-01-29',
    overall: 74,
    engagement: 77,
    career: 71,
    manager: 75,
    wellbeing: 73,
    mobility: 67,
    workerCount: 50,
  },
  {
    date: '2024-02-05',
    overall: 72,
    engagement: 75,
    career: 69,
    manager: 73,
    wellbeing: 71,
    mobility: 65,
    workerCount: 51,
  },
  {
    date: '2024-02-12',
    overall: 70,
    engagement: 73,
    career: 67,
    manager: 71,
    wellbeing: 69,
    mobility: 63,
    workerCount: 52,
  },
  {
    date: '2024-02-19',
    overall: 68,
    engagement: 71,
    career: 65,
    manager: 69,
    wellbeing: 67,
    mobility: 61,
    workerCount: 53,
  },
  {
    date: '2024-02-26',
    overall: 66,
    engagement: 69,
    career: 63,
    manager: 67,
    wellbeing: 65,
    mobility: 59,
    workerCount: 54,
  },
  {
    date: '2024-03-05',
    overall: 64,
    engagement: 67,
    career: 61,
    manager: 65,
    wellbeing: 63,
    mobility: 57,
    workerCount: 55,
  },
  {
    date: '2024-03-12',
    overall: 62,
    engagement: 65,
    career: 59,
    manager: 63,
    wellbeing: 61,
    mobility: 55,
    workerCount: 56,
  },
  {
    date: '2024-03-19',
    overall: 60,
    engagement: 63,
    career: 57,
    manager: 61,
    wellbeing: 59,
    mobility: 53,
    workerCount: 57,
  },
  {
    date: '2024-03-26',
    overall: 58,
    engagement: 61,
    career: 55,
    manager: 59,
    wellbeing: 57,
    mobility: 51,
    workerCount: 58,
  },
  {
    date: '2024-04-02',
    overall: 56,
    engagement: 59,
    career: 53,
    manager: 57,
    wellbeing: 55,
    mobility: 49,
    workerCount: 59,
  },
  {
    date: '2024-04-09',
    overall: 54,
    engagement: 57,
    career: 51,
    manager: 55,
    wellbeing: 53,
    mobility: 47,
    workerCount: 60,
  },
  {
    date: '2024-04-16',
    overall: 52,
    engagement: 55,
    career: 49,
    manager: 53,
    wellbeing: 51,
    mobility: 45,
    workerCount: 61,
  },
];

const mockJSIData: JSIScore[] = [
  {
    id: '1',
    userId: 'user1',
    userName: 'Rosa Garcia',
    region: 'West Coast',
    division: 'Operations',
    department: 'Operations',
    location: 'Los Angeles',
    overallScore: 78,
    workEngagement: 85,
    careerAlignment: 72,
    managerRelationship: 80,
    personalWellbeing: 75,
    jobMobility: 65,
    lastUpdated: '2024-01-15',
    trend: 'up',
    riskLevel: 'low',
    flags: [],
  },
  {
    id: '2',
    userId: 'user2',
    userName: 'Marcus Johnson',
    region: 'Midwest',
    division: 'Sales',
    department: 'Sales',
    location: 'Chicago',
    overallScore: 45,
    workEngagement: 40,
    careerAlignment: 35,
    managerRelationship: 50,
    personalWellbeing: 60,
    jobMobility: 30,
    lastUpdated: '2024-01-15',
    trend: 'down',
    riskLevel: 'high',
    flags: ['rapid_drop', 'low_engagement', 'mobility_risk'],
  },
  {
    id: '3',
    userId: 'user3',
    userName: 'Sarah Chen',
    region: 'East Coast',
    division: 'Marketing',
    department: 'Marketing',
    location: 'New York',
    overallScore: 82,
    workEngagement: 88,
    careerAlignment: 85,
    managerRelationship: 78,
    personalWellbeing: 80,
    jobMobility: 70,
    lastUpdated: '2024-01-15',
    trend: 'stable',
    riskLevel: 'low',
    flags: [],
  },
];

const mockDimensionData = [
  { name: 'Work Engagement', value: 78, color: '#4CAF50' },
  { name: 'Career Alignment', value: 72, color: '#2196F3' },
  { name: 'Manager Relationship', value: 80, color: '#FF9800' },
  { name: 'Personal Wellbeing', value: 75, color: '#9C27B0' },
  { name: 'Job Mobility', value: 65, color: '#F44336' },
];

const JobSatisfactionInsights: React.FC = () => {
  const { role, securityLevel, accessRole, currentUser } = useAuth();
  const { isModuleInEnabledList, loading: moduleLoading } = useModuleAccess();
  const [activeTab, setActiveTab] = useState(0);
  const [selectedWorker, setSelectedWorker] = useState<JSIScore | null>(null);
  const [filterRegion, setFilterRegion] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterRiskLevel, setFilterRiskLevel] = useState('all');
  
  // Organizational structure data
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [divisions, setDivisions] = useState<{ id: string; name: string }[]>([]);
  const [showPersonalWellbeing, setShowPersonalWellbeing] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [methodologyDialogOpen, setMethodologyDialogOpen] = useState(false);
  const [surveyQueueDialogOpen, setSurveyQueueDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jsiData, setJsiData] = useState<JSIScore[]>([]);
  const [aggregateStats, setAggregateStats] = useState<any>(null);
  const [baselineData, setBaselineData] = useState<JSIBaseline>(mockBaselineData);
  const [trendData, setTrendData] = useState<JSITrendData[]>(mockTrendData);
  const [reportFilters, setReportFilters] = useState<ReportFilters>({
    tenantId: 'global',
    region: 'all',
    division: 'all',
    department: 'all',
    location: 'all',
    riskLevel: 'all',
    showPersonalWellbeing: false,
    timeRange: '90',
  });

  // Enhanced reporting state
  const [reportData, setReportData] = useState<any>(null);
  const [advancedTrends, setAdvancedTrends] = useState<any>(null);

  // Automation state
  const [automationDialog, setAutomationDialog] = useState(false);
  const [automationStep, setAutomationStep] = useState(0);
  const [automationConfig, setAutomationConfig] = useState({
    insightsGeneration: {
      enabled: false,
      frequency: 'weekly',
      includeOrganizational: true,
      timeRange: '30'
    },
    reportScheduling: {
      enabled: false,
      frequency: 'weekly',
      recipients: [] as string[],
      reportType: 'comprehensive',
      includeOrganizational: true
    },
    alerts: {
      enabled: false,
      riskThreshold: 0.1,
      trendThreshold: 0.2,
      emailNotifications: true
    }
  });
  const [automatedInsights, setAutomatedInsights] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const [comparisonMode, setComparisonMode] = useState<'baseline' | 'peer' | 'threshold'>(
    'baseline',
  );
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exportType, setExportType] = useState<'detailed' | 'summary'>('detailed');
  const [exportTab, setExportTab] = useState<'quick' | 'custom' | 'advanced'>('quick');
  const [includeBenchmarks, setIncludeBenchmarks] = useState(true);
  const [includePercentiles, setIncludePercentiles] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeAuditTrail, setIncludeAuditTrail] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    includeHighRisk: true,
    includeMediumRisk: true,
    includeLowRisk: true,
    includeFlags: true,
  });

  // Messaging configuration state
  const [messagingConfig, setMessagingConfig] = useState<JSIMessagingConfig | null>(null);
  const [messagingConfigDialogOpen, setMessagingConfigDialogOpen] = useState(false);
  const [customTopicDialogOpen, setCustomTopicDialogOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<JSIMessagingTopic | null>(null);

  // Benchmarking state
  const [benchmarks, setBenchmarks] = useState<{
    global: JSIBenchmark;
    industry?: JSIBenchmark;
  } | null>(null);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  // Permission checks
  const canAccessJSI = () => {
    if (accessRole.startsWith('hrx_')) return true;
    if (accessRole.startsWith('agency_') && securityLevel === '5') return true;
    if (accessRole.startsWith('customer_') && securityLevel === '5') return true;
    if (accessRole.startsWith('customer_') && securityLevel === '4') return true;
    return false;
  };

  const canViewPersonalWellbeing = (worker: JSIScore) => {
    if (accessRole.startsWith('hrx_')) return true;
    if (accessRole.startsWith('agency_') && securityLevel === '5') return true;
    if (accessRole.startsWith('customer_') && securityLevel === '5') return true;
    if (
      accessRole.startsWith('customer_') &&
      securityLevel === '4' &&
      showPersonalWellbeing
    ) {
      // Check if manager is assigned to this worker (simplified check)
      return worker.supervisor === currentUser?.uid;
    }
    return false;
  };

  const canViewWorkerDetails = (worker: JSIScore) => {
    if (accessRole.startsWith('hrx_')) return true;
    if (accessRole.startsWith('agency_') && securityLevel === '5') return true;
    if (accessRole.startsWith('customer_') && securityLevel === '5') return true;
    if (accessRole.startsWith('customer_') && securityLevel === '4') {
      return worker.supervisor === currentUser?.uid;
    }
    return false;
  };

  // Baseline calculation functions
  const calculateBaseline = (
    data: JSIScore[],
    region?: string,
    division?: string,
    department?: string,
    location?: string,
  ): JSIBaseline => {
    const filteredData = data.filter((worker) => {
      if (region && region !== 'all' && worker.region !== region) return false;
      if (division && division !== 'all' && worker.division !== division) return false;
      if (department && department !== 'all' && worker.department !== department) return false;
      if (location && location !== 'all' && worker.location !== location) return false;
      return true;
    });

    if (filteredData.length === 0) {
          return {
      tenantId: 'global',
      region,
      division,
      department,
      location,
      overallScore: 0,
      workEngagement: 0,
      careerAlignment: 0,
      managerRelationship: 0,
      personalWellbeing: 0,
      jobMobility: 0,
      dateRange: { start: '', end: '' },
      workerCount: 0,
      calculatedAt: new Date().toISOString(),
    };
    }

    const totalScores = filteredData.reduce(
      (acc, worker) => ({
        overall: acc.overall + worker.overallScore,
        engagement: acc.engagement + worker.workEngagement,
        career: acc.career + worker.careerAlignment,
        manager: acc.manager + worker.managerRelationship,
        wellbeing: acc.wellbeing + worker.personalWellbeing,
        mobility: acc.mobility + worker.jobMobility,
      }),
      {
        overall: 0,
        engagement: 0,
        career: 0,
        manager: 0,
        wellbeing: 0,
        mobility: 0,
      },
    );

    return {
      tenantId: 'global',
      region,
      division,
      department,
      location,
      overallScore: Math.round(totalScores.overall / filteredData.length),
      workEngagement: Math.round(totalScores.engagement / filteredData.length),
      careerAlignment: Math.round(totalScores.career / filteredData.length),
      managerRelationship: Math.round(totalScores.manager / filteredData.length),
      personalWellbeing: Math.round(totalScores.wellbeing / filteredData.length),
      jobMobility: Math.round(totalScores.mobility / filteredData.length),
      dateRange: {
        start: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
      workerCount: filteredData.length,
      calculatedAt: new Date().toISOString(),
    };
  };

  // Export functions
  const exportToCSV = () => {
    const headers = [
      'Worker',
      'Department',
      'Location',
      'Date',
      'Overall Score',
      'Engagement',
      'Alignment',
      'Manager',
      'Wellbeing',
      'Mobility',
      'Risk Level',
      'Tags',
      'Global Percentile',
      'Industry Percentile',
    ];

    const csvData = filteredData.map((worker) => {
      // Calculate percentiles if benchmarks are available
      let globalPercentile = 'N/A';
      let industryPercentile = 'N/A';

      if (benchmarks?.global) {
        const globalScores = [
          benchmarks.global.percentiles.p25,
          benchmarks.global.percentiles.p50,
          benchmarks.global.percentiles.p75,
          benchmarks.global.percentiles.p90,
        ];
        if (worker.overallScore <= benchmarks.global.percentiles.p25) globalPercentile = '25th';
        else if (worker.overallScore <= benchmarks.global.percentiles.p50)
          globalPercentile = '50th';
        else if (worker.overallScore <= benchmarks.global.percentiles.p75)
          globalPercentile = '75th';
        else if (worker.overallScore <= benchmarks.global.percentiles.p90)
          globalPercentile = '90th';
        else globalPercentile = '90th+';
      }

      if (benchmarks?.industry) {
        if (worker.overallScore <= benchmarks.industry.percentiles.p25) industryPercentile = '25th';
        else if (worker.overallScore <= benchmarks.industry.percentiles.p50)
          industryPercentile = '50th';
        else if (worker.overallScore <= benchmarks.industry.percentiles.p75)
          industryPercentile = '75th';
        else if (worker.overallScore <= benchmarks.industry.percentiles.p90)
          industryPercentile = '90th';
        else industryPercentile = '90th+';
      }

      return [
        worker.userName,
        worker.department,
        worker.location,
        worker.lastUpdated,
        worker.overallScore,
        worker.workEngagement,
        worker.careerAlignment,
        worker.managerRelationship,
        canViewPersonalWellbeing(worker) ? worker.personalWellbeing : 'N/A',
        worker.jobMobility,
        worker.riskLevel,
        worker.flags.join(', '),
        globalPercentile,
        industryPercentile,
      ];
    });

    // Add benchmark summary at the end
    let benchmarkSummary: (string | number)[][] = [];
    if (benchmarks) {
      benchmarkSummary = [
        [],
        ['BENCHMARK SUMMARY'],
        ['Global Average Score', benchmarks.global.overallScore.toFixed(1)],
        ['Global 25th Percentile', benchmarks.global.percentiles.p25.toFixed(1)],
        ['Global 50th Percentile', benchmarks.global.percentiles.p50.toFixed(1)],
        ['Global 75th Percentile', benchmarks.global.percentiles.p75.toFixed(1)],
        ['Global 90th Percentile', benchmarks.global.percentiles.p90.toFixed(1)],
        ['Global Worker Count', benchmarks.global.workerCount],
        ['Global Customer Count', benchmarks.global.customerCount],
      ];

      if (benchmarks.industry) {
        benchmarkSummary.push(
          [],
          ['INDUSTRY BENCHMARK'],
          ['Industry', benchmarks.industry.industryName || 'Unknown'],
          ['Industry Average Score', benchmarks.industry.overallScore.toFixed(1)],
          ['Industry 25th Percentile', benchmarks.industry.percentiles.p25.toFixed(1)],
          ['Industry 50th Percentile', benchmarks.industry.percentiles.p50.toFixed(1)],
          ['Industry 75th Percentile', benchmarks.industry.percentiles.p75.toFixed(1)],
          ['Industry 90th Percentile', benchmarks.industry.percentiles.p90.toFixed(1)],
          ['Industry Worker Count', benchmarks.industry.workerCount],
          ['Industry Customer Count', benchmarks.industry.customerCount],
        );
      }
    }

    const csvContent = [headers, ...csvData, ...benchmarkSummary]
      .map((row) => row.map((cell: any) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jsi_report_with_benchmarks_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    setSnackbar({
      open: true,
      message: 'CSV report with benchmarks downloaded successfully',
      severity: 'success',
    });
  };

  const exportToJSON = () => {
    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        filters: reportFilters,
        baseline: baselineData,
        totalWorkers: filteredData.length,
        benchmarks: benchmarks,
      },
      workers: filteredData.map((worker) => ({
        id: worker.id,
        name: worker.userName,
        department: worker.department,
        location: worker.location,
        scores: {
          overall: worker.overallScore,
          engagement: worker.workEngagement,
          career: worker.careerAlignment,
          manager: worker.managerRelationship,
          wellbeing: canViewPersonalWellbeing(worker) ? worker.personalWellbeing : null,
          mobility: worker.jobMobility,
        },
        riskLevel: worker.riskLevel,
        flags: worker.flags,
        lastUpdated: worker.lastUpdated,
      })),
      trends: trendData,
      summary: {
        averageScore: averageScore,
        highRiskCount: highRiskWorkers.length,
        mediumRiskCount: mediumRiskWorkers.length,
        lowRiskCount: filteredData.filter((w) => w.riskLevel === 'low').length,
      },
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jsi_report_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    window.URL.revokeObjectURL(url);

    setSnackbar({
      open: true,
      message: 'JSON report downloaded successfully',
      severity: 'success',
    });
  };

  const exportToPDFReport = () => {
    try {
      const pdfData = {
        workers: filteredData,
        benchmarks: benchmarks,
        baseline: baselineData,
        filters: {
          department: filterDepartment,
          location: filterLocation,
          timeRange: reportFilters.timeRange,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          totalWorkers: filteredData.length,
          averageScore: averageScore,
        },
      };

      generatePDFReport(pdfData, 'Organization');

      setSnackbar({
        open: true,
        message: 'PDF report generated successfully!',
        severity: 'success',
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      setSnackbar({
        open: true,
        message: 'Failed to generate PDF report',
        severity: 'error',
      });
    }
  };

  const exportToExcel = () => {
    try {
      const excelData = {
        workers: filteredData,
        benchmarks: benchmarks,
        baseline: baselineData,
        filters: {
          department: filterDepartment,
          location: filterLocation,
          timeRange: reportFilters.timeRange,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          totalWorkers: filteredData.length,
          averageScore: averageScore,
        },
      };

      generateExcelReport(excelData, 'Organization');

      setSnackbar({
        open: true,
        message: 'Excel report generated successfully!',
        severity: 'success',
      });
    } catch (error) {
      console.error('Error generating Excel:', error);
      setSnackbar({
        open: true,
        message: 'Failed to generate Excel report',
        severity: 'error',
      });
    }
  };

  const handleCustomReport = (config: any) => {
    // TODO: Implement custom report generation
    setSnackbar({
      open: true,
      message: `Custom ${config.format} report generation coming soon!`,
      severity: 'info',
    });
    setExportDialogOpen(false);
  };

  // Automation functions
  const handleOpenAutomation = () => {
    setAutomationDialog(true);
    setAutomationStep(0);
  };

  const handleCloseAutomation = () => {
    setAutomationDialog(false);
    setAutomationStep(0);
  };

  const handleAutomationConfigChange = (section: string, field: string, value: any) => {
    setAutomationConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [field]: value
      }
    }));
  };

  const handleGenerateInsights = async () => {
    try {
      setLoading(true);
      const result = await generateAutomatedJSIInsights({
        customerId: 'global',
        agencyId: null,
        timeRange: automationConfig.insightsGeneration.timeRange,
        includeOrganizational: automationConfig.insightsGeneration.includeOrganizational
      });
      
      setAutomatedInsights((result as any).data);
      setSnackbar({
        open: true,
        message: 'Automated insights generated successfully!',
        severity: 'success',
      });
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: `Failed to generate insights: ${error.message}`,
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleReports = async () => {
    try {
      setLoading(true);
      const result = await scheduleAutomatedJSIReports({
        customerId: 'global',
        agencyId: null,
        schedule: {
          frequency: automationConfig.reportScheduling.frequency
        },
        recipients: automationConfig.reportScheduling.recipients,
        reportType: automationConfig.reportScheduling.reportType
      });
      
      setSnackbar({
        open: true,
        message: 'Automated reports scheduled successfully!',
        severity: 'success',
      });
      handleCloseAutomation();
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: `Failed to schedule reports: ${error.message}`,
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGetAutomatedInsights = async () => {
    try {
      setLoading(true);
      const result = await getAutomatedJSIInsights({
        customerId: 'global',
        agencyId: null,
        timeRange: '30'
      });
      
      if ((result as any).data) {
        setAutomatedInsights((result as any).data);
      }
    } catch (error: any) {
      console.error('Error fetching automated insights:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate percentage change from baseline
  const getBaselineChange = (currentScore: number, baselineScore: number): number => {
    if (baselineScore === 0) return 0;
    return Math.round(((currentScore - baselineScore) / baselineScore) * 100);
  };

  // Firebase Functions
  const functions = getFunctions();
  const generateJSIScore = httpsCallable(functions, 'generateJSIScore');
  const getJSIAggregateStats = httpsCallable(functions, 'getJSIAggregateStats');
  const triggerJSIPrompts = httpsCallable(functions, 'triggerJSIPrompts');
  const flagJSIRisk = httpsCallable(functions, 'flagJSIRisk');

  // Enhanced reporting functions
  const getJSIReportData = httpsCallable(functions, 'getJSIReportData');
  const getJSIAdvancedTrends = httpsCallable(functions, 'getJSIAdvancedTrends');
  const detectJSIAnomalies = httpsCallable(functions, 'detectJSIAnomalies');
  const exportJSIData = httpsCallable(functions, 'exportJSIData');

  // Automation functions
  const generateAutomatedJSIInsights = httpsCallable(functions, 'generateAutomatedJSIInsights');
  const scheduleAutomatedJSIReports = httpsCallable(functions, 'scheduleAutomatedJSIReports');
  const getAutomatedJSIInsights = httpsCallable(functions, 'getAutomatedJSIInsights');

  // Messaging configuration functions
  const getJSIMessagingConfig = httpsCallable(functions, 'getJSIMessagingConfig');
  const updateJSIMessagingConfig = httpsCallable(functions, 'updateJSIMessagingConfig');
  const addJSICustomTopic = httpsCallable(functions, 'addJSICustomTopic');
  const generateJSIPrompt = httpsCallable(functions, 'generateJSIPrompt');

  // Benchmarking functions
  const getJSIBenchmarks = httpsCallable(functions, 'getJSIBenchmarks');

  // Log AI action for JSI dashboard interactions
  const logJSIInteraction = async (action: string, details: any) => {
    try {
      const logAIAction = httpsCallable(functions, 'logAIAction');
      await logAIAction({
        userId: 'admin', // Will be replaced with actual user ID
        actionType: `jsi_${action}`,
        sourceModule: 'JobSatisfactionInsights',
        tenantId: 'global', // Will be replaced with actual customer ID
        success: true,
        latencyMs: 0,
        versionTag: 'v1.0',
        reason: details.reason || `JSI ${action} action`,
        eventType: `jsi.${action}`,
        targetType: details.targetType || 'dashboard',
        targetId: details.targetId || null,
        aiRelevant: true,
        contextType: 'jsi_management',
        traitsAffected: null,
        aiTags: ['jsi', 'satisfaction', 'analytics'],
        urgencyScore: details.urgencyScore || null,
      });
    } catch (error) {
      console.error('Error logging JSI interaction:', error);
    }
  };

  // Fetch organizational structure data
  const fetchOrganizationalData = async () => {
    try {
      // Fetch regions and divisions from Firestore
      const tenantId = 'global'; // This should come from context
      const regionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'regions'));
      setRegions(regionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
      
      const divisionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'divisions'));
      setDivisions(divisionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
    } catch (error) {
      console.error('Error fetching organizational data:', error);
      // Set empty arrays as fallback
      setRegions([]);
      setDivisions([]);
    }
  };

  // Fetch JSI data from Firebase
  const fetchJSIData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch organizational data first
      await fetchOrganizationalData();
      
      // Try to get real data first, fallback to mock data
      const jsiScoresRef = collection(db, 'jsiScores');
      const scoresSnapshot = await getDocs(jsiScoresRef);

      if (!scoresSnapshot.empty) {
        const realData = scoresSnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            userId: data.userId,
            userName: data.userName || 'Unknown User',
            region: data.region || '',
            division: data.division || '',
            department: data.department || 'Unknown',
            location: data.location || 'Unknown',
            overallScore: data.overallScore || 0,
            workEngagement: data.workEngagement || 0,
            careerAlignment: data.careerAlignment || 0,
            managerRelationship: data.managerRelationship || 0,
            personalWellbeing: data.personalWellbeing || 0,
            jobMobility: data.jobMobility || 0,
            lastUpdated: data.lastUpdated?.toDate?.()?.toISOString() || new Date().toISOString(),
            trend: data.trend || 'stable',
            riskLevel: data.riskLevel || 'low',
            flags: data.flags || [],
            supervisor: data.supervisor || '',
            team: data.team || '',
            aiSummary: data.aiSummary || '',
            lastSurveyResponse: data.lastSurveyResponse || '',
            recommendedAction: data.recommendedAction || '',
          } as JSIScore;
        });
        setJsiData(realData);
      } else {
        // Fallback to mock data
        setJsiData(mockJSIData);
      }

      // Fetch aggregate stats
      try {
        const statsResult = await getJSIAggregateStats({ tenantId: 'global' });
        setAggregateStats(statsResult.data);
      } catch (statsError) {
        console.warn('Could not fetch aggregate stats:', statsError);
        // Use mock stats
        setAggregateStats({
          totalWorkers: mockJSIData.length,
          averageScore:
            mockJSIData.reduce((sum, w) => sum + w.overallScore, 0) / mockJSIData.length,
          scoreDistribution: { low: 1, medium: 0, high: 2 },
          riskDistribution: { low: 2, medium: 0, high: 1 },
          trends: { improving: 1, declining: 1, stable: 1 },
        });
      }

      await logJSIInteraction('data_fetched', {
        reason: 'Dashboard data refresh',
        targetType: 'jsi_scores',
        targetId: scoresSnapshot.docs.length.toString(),
      });
    } catch (error: any) {
      console.error('Error fetching JSI data:', error);
      setError(error.message || 'Failed to fetch JSI data');
      setJsiData(mockJSIData); // Fallback to mock data
    } finally {
      setLoading(false);
    }
  };

  // Fetch enhanced reporting data
  const fetchReportData = async () => {
    try {
      const result = await getJSIReportData({
        tenantId: 'global',
        department: filterDepartment,
        location: filterLocation,
        timeRange: reportFilters.timeRange,
        includePersonalWellbeing: showPersonalWellbeing,
        reportType: 'comprehensive',
      });
      setReportData((result as any).data);
    } catch (error: any) {
      console.error('Error fetching report data:', error);
      setSnackbar({
        open: true,
        message: `Failed to fetch report data: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Fetch advanced trends
  const fetchAdvancedTrends = async () => {
    try {
      const result = await getJSIAdvancedTrends({
        tenantId: 'global',
        department: filterDepartment,
        location: filterLocation,
        timeRange: reportFilters.timeRange,
        granularity,
      });
      setAdvancedTrends((result as any).data);
    } catch (error: any) {
      console.error('Error fetching advanced trends:', error);
      setSnackbar({
        open: true,
        message: `Failed to fetch advanced trends: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Detect anomalies
  const detectAnomalies = async () => {
    try {
      const result = await detectJSIAnomalies({
        tenantId: 'global',
        department: filterDepartment,
        location: filterLocation,
        timeRange: '30',
      });
      setAnomalies((result as any).data.anomalies);
    } catch (error: any) {
      console.error('Error detecting anomalies:', error);
      setSnackbar({
        open: true,
        message: `Failed to detect anomalies: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Enhanced export function
  const exportData = async (format: 'csv' | 'json', exportType: 'detailed' | 'summary') => {
    try {
      const result = await exportJSIData({
        tenantId: 'global',
        department: filterDepartment,
        location: filterLocation,
        timeRange: reportFilters.timeRange,
        format,
        includePersonalWellbeing: showPersonalWellbeing,
        exportType,
      });

      // Create and download file
      const blob = new Blob([(result as any).data.data], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jsi_report_${exportType}_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSnackbar({
        open: true,
        message: `${format.toUpperCase()} export completed successfully`,
        severity: 'success',
      });
    } catch (error: any) {
      console.error('Error exporting data:', error);
      setSnackbar({
        open: true,
        message: `Failed to export data: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Messaging configuration functions
  const fetchMessagingConfig = async () => {
    try {
      const result = await getJSIMessagingConfig({
        tenantId: 'global',
      });
      setMessagingConfig((result as any).data);
    } catch (error: any) {
      console.error('Error fetching messaging config:', error);
      setSnackbar({
        open: true,
        message: `Failed to fetch messaging configuration: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Benchmarking functions
  const fetchBenchmarks = async () => {
    try {
      setBenchmarksLoading(true);
      const result = await getJSIBenchmarks({
        tenantId: 'global',
        dateRange: {
          start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
      });
      setBenchmarks((result as any).data);
    } catch (error: any) {
      console.error('Error fetching benchmarks:', error);
      setSnackbar({
        open: true,
        message: `Failed to fetch benchmarking data: ${error.message}`,
        severity: 'error',
      });
    } finally {
      setBenchmarksLoading(false);
    }
  };

  const updateMessagingConfig = async (topics: JSIMessagingTopic[], globalSettings?: any) => {
    try {
      await updateJSIMessagingConfig({
        tenantId: 'global',
        topics,
        globalSettings,
      });

      setSnackbar({
        open: true,
        message: 'Messaging configuration updated successfully',
        severity: 'success',
      });

      // Refresh the config
      await fetchMessagingConfig();
    } catch (error: any) {
      console.error('Error updating messaging config:', error);
      setSnackbar({
        open: true,
        message: `Failed to update messaging configuration: ${error.message}`,
        severity: 'error',
      });
    }
  };

  const addCustomTopic = async (topic: Partial<JSIMessagingTopic>) => {
    try {
      await addJSICustomTopic({
        tenantId: 'global',
        topic,
      });

      setSnackbar({
        open: true,
        message: 'Custom topic added successfully',
        severity: 'success',
      });

      // Refresh the config
      await fetchMessagingConfig();
      setCustomTopicDialogOpen(false);
    } catch (error: any) {
      console.error('Error adding custom topic:', error);
      setSnackbar({
        open: true,
        message: `Failed to add custom topic: ${error.message}`,
        severity: 'error',
      });
    }
  };

  const generatePrompt = async (userId: string, context?: string) => {
    try {
      const result = await generateJSIPrompt({
        tenantId: 'global',
        userId,
        context,
      });

      setSnackbar({
        open: true,
        message: 'AI prompt generated successfully',
        severity: 'success',
      });

      return (result as any).data;
    } catch (error: any) {
      console.error('Error generating prompt:', error);
      setSnackbar({
        open: true,
        message: `Failed to generate prompt: ${error.message}`,
        severity: 'error',
      });
      return null;
    }
  };

  // Trigger JSI prompt for a worker
  const handleTriggerPrompt = async (worker: JSIScore, promptType = 'flagged') => {
    try {
      await triggerJSIPrompts({
        userId: worker.userId,
        tenantId: 'global', // Will be replaced with actual customer ID
        promptType,
        dimension: 'workEngagement',
      });

      setSnackbar({
        open: true,
        message: `Prompt sent to ${worker.userName}`,
        severity: 'success',
      });

      await logJSIInteraction('prompt_triggered', {
        reason: `Triggered ${promptType} prompt for ${worker.userName}`,
        targetType: 'worker',
        targetId: worker.userId,
        urgencyScore: worker.riskLevel === 'high' ? 0.8 : 0.5,
      });
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: `Failed to send prompt: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Flag worker for risk monitoring
  const handleFlagRisk = async (worker: JSIScore, riskType: string) => {
    try {
      await flagJSIRisk({
        userId: worker.userId,
        tenantId: 'global',
        riskType,
        description: `Manual flag by admin for ${riskType}`,
        severity: worker.riskLevel,
      });

      setSnackbar({
        open: true,
        message: `Risk flag added for ${worker.userName}`,
        severity: 'success',
      });

      await logJSIInteraction('risk_flagged', {
        reason: `Manual risk flag for ${worker.userName}`,
        targetType: 'worker',
        targetId: worker.userId,
        urgencyScore: 0.9,
      });
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: `Failed to flag risk: ${error.message}`,
        severity: 'error',
      });
    }
  };

  // Load data on component mount
  useEffect(() => {
    fetchJSIData();
    fetchMessagingConfig();
    fetchBenchmarks();
  }, []);

  // Load enhanced data when Reports tab is selected
  useEffect(() => {
    if (activeTab === 2 && canAccessJSI()) {
      fetchReportData();
      fetchAdvancedTrends();
      detectAnomalies();
    }
  }, [activeTab]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high':
        return '#f44336';
      case 'medium':
        return '#ff9800';
      case 'low':
        return '#4caf50';
      default:
        return '#757575';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp color="success" />;
      case 'down':
        return <TrendingDown color="error" />;
      case 'stable':
        return <TrendingUp color="disabled" />;
      default:
        return <TrendingUp color="disabled" />;
    }
  };

  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'high':
        return <Warning color="error" />;
      case 'medium':
        return <Warning color="warning" />;
      case 'low':
        return <CheckCircle color="success" />;
      default:
        return <Info color="info" />;
    }
  };

  const filteredData = jsiData.filter((worker) => {
    if (filterRegion !== 'all' && worker.region !== filterRegion) return false;
    if (filterDivision !== 'all' && worker.division !== filterDivision) return false;
    if (filterDepartment !== 'all' && worker.department !== filterDepartment) return false;
    if (filterLocation !== 'all' && worker.location !== filterLocation) return false;
    if (filterRiskLevel !== 'all' && worker.riskLevel !== filterRiskLevel) return false;
    return true;
  });

  const averageScore =
    filteredData.length > 0
      ? filteredData.reduce((sum, worker) => sum + worker.overallScore, 0) / filteredData.length
      : 0;

  const highRiskWorkers = filteredData.filter((worker) => worker.riskLevel === 'high');
  const mediumRiskWorkers = filteredData.filter((worker) => worker.riskLevel === 'medium');

  const renderOverviewTab = () => (
    <Grid container spacing={3}>
      {/* Key Metrics */}
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Average JSI Score
            </Typography>
            <Typography variant="h3" color="primary">
              {averageScore.toFixed(1)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Across {filteredData.length} workers
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              High Risk Workers
            </Typography>
            <Typography variant="h3" color="error">
              {highRiskWorkers.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Need immediate attention
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Medium Risk
            </Typography>
            <Typography variant="h3" color="warning.main">
              {mediumRiskWorkers.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Monitor closely
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Data Coverage
            </Typography>
            <Typography variant="h3" color="info.main">
              94%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Workers with recent scores
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      {/* Org-Level Metrics Panel */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Organization-Level Metrics
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Average JSI by Region
              </Typography>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart
                  data={[
                    { region: 'West Coast', score: 78 },
                    { region: 'Midwest', score: 72 },
                    { region: 'East Coast', score: 81 },
                    { region: 'South', score: 75 },
                    { region: 'Northwest', score: 79 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="region" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#8884d8" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Average JSI by Division
              </Typography>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart
                  data={[
                    { division: 'Operations', score: 76 },
                    { division: 'Sales', score: 68 },
                    { division: 'Marketing', score: 82 },
                    { division: 'Technology', score: 74 },
                    { division: 'HR', score: 79 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="division" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#82ca9d" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Average JSI by Department
              </Typography>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart
                  data={[
                    { department: 'Operations', score: 76 },
                    { department: 'Sales', score: 68 },
                    { department: 'Marketing', score: 82 },
                    { department: 'Engineering', score: 74 },
                    { department: 'HR', score: 79 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="department" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#ffc658" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>
                Average JSI by Location
              </Typography>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart
                  data={[
                    { location: 'Los Angeles', score: 78 },
                    { location: 'Chicago', score: 72 },
                    { location: 'New York', score: 81 },
                    { location: 'Austin', score: 75 },
                    { location: 'Seattle', score: 79 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="location" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#ff7300" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Grid>
          </Grid>
        </Paper>
      </Grid>

      {/* Benchmarking Panel */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Industry Benchmarking</Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              onClick={fetchBenchmarks}
              disabled={benchmarksLoading}
            >
              Refresh Benchmarks
            </Button>
          </Box>

          {benchmarksLoading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : benchmarks ? (
            <Grid container spacing={3}>
              {/* Global Benchmark */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom color="primary">
                      Global Benchmark
                    </Typography>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {benchmarks.global.overallScore.toFixed(1)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Based on {benchmarks.global.workerCount} workers across{' '}
                      {benchmarks.global.customerCount} organizations
                    </Typography>
                    <Box mt={2}>
                      <Typography variant="subtitle2" gutterBottom>
                        Percentile Rankings:
                      </Typography>
                      <Grid container spacing={1}>
                        <Grid item xs={3}>
                          <Typography variant="caption">
                            25th: {benchmarks.global.percentiles.p25.toFixed(1)}
                          </Typography>
                        </Grid>
                        <Grid item xs={3}>
                          <Typography variant="caption">
                            50th: {benchmarks.global.percentiles.p50.toFixed(1)}
                          </Typography>
                        </Grid>
                        <Grid item xs={3}>
                          <Typography variant="caption">
                            75th: {benchmarks.global.percentiles.p75.toFixed(1)}
                          </Typography>
                        </Grid>
                        <Grid item xs={3}>
                          <Typography variant="caption">
                            90th: {benchmarks.global.percentiles.p90.toFixed(1)}
                          </Typography>
                        </Grid>
                      </Grid>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Industry Benchmark */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom color="secondary">
                      Industry Benchmark
                    </Typography>
                    {benchmarks.industry ? (
                      <>
                        <Typography variant="h4" color="secondary" gutterBottom>
                          {benchmarks.industry.overallScore.toFixed(1)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {benchmarks.industry.industryName} • {benchmarks.industry.workerCount}{' '}
                          workers
                        </Typography>
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Percentile Rankings:
                          </Typography>
                          <Grid container spacing={1}>
                            <Grid item xs={3}>
                              <Typography variant="caption">
                                25th: {benchmarks.industry.percentiles.p25.toFixed(1)}
                              </Typography>
                            </Grid>
                            <Grid item xs={3}>
                              <Typography variant="caption">
                                50th: {benchmarks.industry.percentiles.p50.toFixed(1)}
                              </Typography>
                            </Grid>
                            <Grid item xs={3}>
                              <Typography variant="caption">
                                75th: {benchmarks.industry.percentiles.p75.toFixed(1)}
                              </Typography>
                            </Grid>
                            <Grid item xs={3}>
                              <Typography variant="caption">
                                90th: {benchmarks.industry.percentiles.p90.toFixed(1)}
                              </Typography>
                            </Grid>
                          </Grid>
                        </Box>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No industry data available. Please ensure customer industry is set.
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* Comparison Chart */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" gutterBottom>
                  Score Comparison
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsBarChart
                    data={[
                      {
                        category: 'Your Organization',
                        overall: averageScore,
                        engagement:
                          filteredData.reduce((sum, w) => sum + w.workEngagement, 0) /
                          filteredData.length,
                        career:
                          filteredData.reduce((sum, w) => sum + w.careerAlignment, 0) /
                          filteredData.length,
                        manager:
                          filteredData.reduce((sum, w) => sum + w.managerRelationship, 0) /
                          filteredData.length,
                        wellbeing:
                          filteredData.reduce((sum, w) => sum + w.personalWellbeing, 0) /
                          filteredData.length,
                        mobility:
                          filteredData.reduce((sum, w) => sum + w.jobMobility, 0) /
                          filteredData.length,
                      },
                      {
                        category: 'Global Average',
                        overall: benchmarks.global.overallScore,
                        engagement: benchmarks.global.workEngagement,
                        career: benchmarks.global.careerAlignment,
                        manager: benchmarks.global.managerRelationship,
                        wellbeing: benchmarks.global.personalWellbeing,
                        mobility: benchmarks.global.jobMobility,
                      },
                      ...(benchmarks.industry
                        ? [
                            {
                              category: benchmarks.industry.industryName,
                              overall: benchmarks.industry.overallScore,
                              engagement: benchmarks.industry.workEngagement,
                              career: benchmarks.industry.careerAlignment,
                              manager: benchmarks.industry.managerRelationship,
                              wellbeing: benchmarks.industry.personalWellbeing,
                              mobility: benchmarks.industry.jobMobility,
                            },
                          ]
                        : []),
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis domain={[0, 100]} />
                    <RechartsTooltip />
                    <Bar dataKey="overall" fill="#8884d8" name="Overall" />
                    <Bar dataKey="engagement" fill="#82ca9d" name="Engagement" />
                    <Bar dataKey="career" fill="#ffc658" name="Career" />
                    <Bar dataKey="manager" fill="#ff7300" name="Manager" />
                    <Bar dataKey="wellbeing" fill="#8dd1e1" name="Wellbeing" />
                    <Bar dataKey="mobility" fill="#d084d0" name="Mobility" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </Grid>
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No benchmarking data available. Click "Refresh Benchmarks" to load data.
            </Typography>
          )}
        </Paper>
      </Grid>

      {/* Enhanced Trend Chart with Baseline */}
      <Grid item xs={12} md={8}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">JSI Score Trends</Typography>
            <Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Report />}
                onClick={() => setReportDialogOpen(true)}
                sx={{ mr: 1 }}
              >
                Generate Report
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                onClick={() => setExportDialogOpen(true)}
              >
                Export
              </Button>
            </Box>
          </Box>

          {/* Trend Filters */}
          <Box mb={3}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={reportFilters.timeRange}
                    onChange={(e) =>
                      setReportFilters({ ...reportFilters, timeRange: e.target.value })
                    }
                  >
                    <MenuItem value="30">30 days</MenuItem>
                    <MenuItem value="90">90 days</MenuItem>
                    <MenuItem value="180">6 months</MenuItem>
                    <MenuItem value="365">12 months</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Department</InputLabel>
                  <Select
                    value={reportFilters.department}
                    onChange={(e) =>
                      setReportFilters({ ...reportFilters, department: e.target.value })
                    }
                  >
                    <MenuItem value="all">All Departments</MenuItem>
                    <MenuItem value="Operations">Operations</MenuItem>
                    <MenuItem value="Sales">Sales</MenuItem>
                    <MenuItem value="Marketing">Marketing</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Location</InputLabel>
                  <Select
                    value={reportFilters.location}
                    onChange={(e) =>
                      setReportFilters({ ...reportFilters, location: e.target.value })
                    }
                  >
                    <MenuItem value="all">All Locations</MenuItem>
                    <MenuItem value="Los Angeles">Los Angeles</MenuItem>
                    <MenuItem value="Chicago">Chicago</MenuItem>
                    <MenuItem value="New York">New York</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={reportFilters.showPersonalWellbeing}
                      onChange={(e) =>
                        setReportFilters({
                          ...reportFilters,
                          showPersonalWellbeing: e.target.checked,
                        })
                      }
                    />
                  }
                  label="Show Wellbeing"
                />
              </Grid>
            </Grid>
          </Box>

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 100]} />
              <RechartsTooltip
                formatter={(value, name) => [value, name]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              {/* Baseline Reference Line */}
              <ReferenceLine
                y={baselineData.overallScore}
                stroke="#666"
                strokeDasharray="5 5"
                label={{
                  value: `Baseline: ${baselineData.overallScore}`,
                  position: 'insideTopRight',
                  fill: '#666',
                }}
              />
              <Line
                type="monotone"
                dataKey="overall"
                stroke="#1976d2"
                strokeWidth={3}
                name="Overall JSI"
              />
              <Line
                type="monotone"
                dataKey="engagement"
                stroke="#4caf50"
                strokeWidth={2}
                name="Work Engagement"
              />
              <Line
                type="monotone"
                dataKey="career"
                stroke="#ff9800"
                strokeWidth={2}
                name="Career Alignment"
              />
              <Line
                type="monotone"
                dataKey="manager"
                stroke="#9c27b0"
                strokeWidth={2}
                name="Manager Relationship"
              />
              {reportFilters.showPersonalWellbeing && (
                <Line
                  type="monotone"
                  dataKey="wellbeing"
                  stroke="#607d8b"
                  strokeWidth={2}
                  name="Personal Wellbeing"
                />
              )}
              <Line
                type="monotone"
                dataKey="mobility"
                stroke="#f44336"
                strokeWidth={2}
                name="Job Mobility"
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Baseline Info */}
          <Box
            mt={2}
            p={2}
            borderRadius={1}
            sx={{
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? theme.palette.background.paper : '#f5f5f5',
              color: (theme) => theme.palette.text.primary,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              <strong>Baseline:</strong> {baselineData.overallScore} (calculated from{' '}
              {baselineData.dateRange.start} to {baselineData.dateRange.end},{' '}
              {baselineData.workerCount} workers)
              {baselineData.department && ` • Department: ${baselineData.department}`}
              {baselineData.location && ` • Location: ${baselineData.location}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Current vs Baseline:</strong>{' '}
              {getBaselineChange(averageScore, baselineData.overallScore)}% change
            </Typography>
          </Box>
        </Paper>
      </Grid>

      {/* Dimension Breakdown */}
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Score Dimensions
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <RechartsPieChart>
              <Pie
                data={mockDimensionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {mockDimensionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip />
            </RechartsPieChart>
          </ResponsiveContainer>
          <Box mt={2}>
            {mockDimensionData.map((dimension, index) => (
              <Box key={index} display="flex" alignItems="center" mb={1}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: dimension.color,
                    mr: 1,
                  }}
                />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {dimension.name}
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                  {dimension.value}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );

  const renderWorkersTab = () => (
    <Box>
      {/* Header with Report Button */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Worker Details</Typography>
        <Button variant="outlined" startIcon={<Report />} onClick={() => setReportDialogOpen(true)}>
          Generate Report
        </Button>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Region</InputLabel>
              <Select
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
              >
                <MenuItem value="all">All Regions</MenuItem>
                {regions.map((region) => (
                  <MenuItem key={region.id} value={region.name}>
                    {region.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Division</InputLabel>
              <Select
                value={filterDivision}
                onChange={(e) => setFilterDivision(e.target.value)}
              >
                <MenuItem value="all">All Divisions</MenuItem>
                {divisions.map((division) => (
                  <MenuItem key={division.id} value={division.name}>
                    {division.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Department</InputLabel>
              <Select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
              >
                <MenuItem value="all">All Departments</MenuItem>
                <MenuItem value="Operations">Operations</MenuItem>
                <MenuItem value="Sales">Sales</MenuItem>
                <MenuItem value="Marketing">Marketing</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Location</InputLabel>
              <Select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                <MenuItem value="all">All Locations</MenuItem>
                <MenuItem value="Los Angeles">Los Angeles</MenuItem>
                <MenuItem value="Chicago">Chicago</MenuItem>
                <MenuItem value="New York">New York</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Risk Level</InputLabel>
              <Select value={filterRiskLevel} onChange={(e) => setFilterRiskLevel(e.target.value)}>
                <MenuItem value="all">All Risk Levels</MenuItem>
                <MenuItem value="high">High Risk</MenuItem>
                <MenuItem value="medium">Medium Risk</MenuItem>
                <MenuItem value="low">Low Risk</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={showPersonalWellbeing}
                  onChange={(e) => setShowPersonalWellbeing(e.target.checked)}
                  disabled={!accessRole.startsWith('customer_') || securityLevel !== '5'}
                />
              }
              label={
                <Box display="flex" alignItems="center">
                  Show Personal Wellbeing
                  <Tooltip
                    title={
                      accessRole.startsWith('customer_') && securityLevel === '5'
                        ? 'Enable to allow managers to see personal wellbeing data for their direct reports'
                        : 'Only Customer Admins can control this setting'
                    }
                  >
                    <Info sx={{ ml: 1, fontSize: 16 }} />
                  </Tooltip>
                </Box>
              }
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Workers Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Worker</TableCell>
              <TableCell>Region</TableCell>
              <TableCell>Division</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="center">Overall Score</TableCell>
              <TableCell align="center">Work Engagement</TableCell>
              <TableCell align="center">Career Alignment</TableCell>
              <TableCell align="center">Manager Relationship</TableCell>
              {showPersonalWellbeing && <TableCell align="center">Personal Wellbeing</TableCell>}
              <TableCell align="center">Job Mobility</TableCell>
              <TableCell align="center">Risk Level</TableCell>
              <TableCell align="center">Trend</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredData.map((worker) => (
              <React.Fragment key={worker.id}>
                <TableRow hover>
                  <TableCell>
                    <Box display="flex" alignItems="center">
                      <Avatar sx={{ width: 32, height: 32, mr: 2 }}>
                        {worker.userName.charAt(0)}
                      </Avatar>
                      <Typography variant="subtitle2">{worker.userName}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{worker.region || '-'}</TableCell>
                  <TableCell>{worker.division || '-'}</TableCell>
                  <TableCell>{worker.department}</TableCell>
                  <TableCell>{worker.location}</TableCell>
                  <TableCell align="center">
                    <Typography
                      variant="h6"
                      color={
                        worker.overallScore >= 70
                          ? 'success.main'
                          : worker.overallScore >= 50
                          ? 'warning.main'
                          : 'error.main'
                      }
                    >
                      {worker.overallScore}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box display="flex" alignItems="center" justifyContent="center">
                      <Typography variant="body2" mr={1}>
                        {worker.workEngagement}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={worker.workEngagement}
                        sx={{ width: 40, height: 6, borderRadius: 3 }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Box display="flex" alignItems="center" justifyContent="center">
                      <Typography variant="body2" mr={1}>
                        {worker.careerAlignment}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={worker.careerAlignment}
                        sx={{ width: 40, height: 6, borderRadius: 3 }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Box display="flex" alignItems="center" justifyContent="center">
                      <Typography variant="body2" mr={1}>
                        {worker.managerRelationship}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={worker.managerRelationship}
                        sx={{ width: 40, height: 6, borderRadius: 3 }}
                      />
                    </Box>
                  </TableCell>
                  {canViewPersonalWellbeing(worker) && (
                    <TableCell align="center">
                      <Box display="flex" alignItems="center" justifyContent="center">
                        <Typography variant="body2" mr={1}>
                          {worker.personalWellbeing}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={worker.personalWellbeing}
                          sx={{ width: 40, height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    </TableCell>
                  )}
                  <TableCell align="center">
                    <Box display="flex" alignItems="center" justifyContent="center">
                      <Typography variant="body2" mr={1}>
                        {worker.jobMobility}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={worker.jobMobility}
                        sx={{ width: 40, height: 6, borderRadius: 3 }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={worker.riskLevel}
                      color={
                        worker.riskLevel === 'high'
                          ? 'error'
                          : worker.riskLevel === 'medium'
                          ? 'warning'
                          : 'success'
                      }
                      size="small"
                      icon={getRiskIcon(worker.riskLevel)}
                    />
                  </TableCell>
                  <TableCell align="center">{getTrendIcon(worker.trend)}</TableCell>
                  <TableCell align="center">
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        setSelectedWorker(selectedWorker?.id === worker.id ? null : worker)
                      }
                      disabled={!canViewWorkerDetails(worker)}
                    >
                      {selectedWorker?.id === worker.id ? 'Hide Details' : 'View Details'}
                    </Button>
                  </TableCell>
                </TableRow>
                {selectedWorker?.id === worker.id && (
                  <TableRow>
                    <TableCell colSpan={canViewPersonalWellbeing(worker) ? 14 : 13}>
                      <Accordion expanded={true} sx={{ boxShadow: 'none' }}>
                        <AccordionDetails>
                          <Grid container spacing={3}>
                            <Grid item xs={12} md={6}>
                              <Typography variant="h6" gutterBottom>
                                JSI Score Timeline
                              </Typography>
                              <ResponsiveContainer width="100%" height={150}>
                                <LineChart data={mockTrendData}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="date" />
                                  <YAxis domain={[0, 100]} />
                                  <RechartsTooltip />
                                  <Line
                                    type="monotone"
                                    dataKey="overall"
                                    stroke="#8884d8"
                                    strokeWidth={2}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Typography variant="h6" gutterBottom>
                                AI Summary
                              </Typography>
                              <Paper sx={{ p: 2, backgroundColor: '#f8f9fa' }}>
                                <Typography variant="body2">
                                  {worker.aiSummary ||
                                    'Marcus has shown declining engagement over the past month. Recent check-ins indicate frustration with current role responsibilities and limited growth opportunities. Manager relationship appears strained based on communication patterns.'}
                                </Typography>
                              </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Typography variant="h6" gutterBottom>
                                Last Survey Response
                              </Typography>
                              <Paper sx={{ p: 2, backgroundColor: '#f8f9fa' }}>
                                <Typography variant="body2">
                                  {worker.lastSurveyResponse ||
                                    "Feeling somewhat disconnected from the team lately. The work is fine but I'm not sure about long-term growth here. Would appreciate more regular feedback from my manager."}
                                </Typography>
                              </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Typography variant="h6" gutterBottom>
                                Recommended Action
                              </Typography>
                              <Paper sx={{ p: 2, backgroundColor: '#e3f2fd' }}>
                                <Typography variant="body2">
                                  {worker.recommendedAction ||
                                    'Schedule 1:1 meeting to discuss career goals and growth opportunities. Consider role expansion or additional training. Monitor engagement closely over next 2 weeks.'}
                                </Typography>
                              </Paper>
                            </Grid>
                            <Grid item xs={12}>
                              <Typography variant="h6" gutterBottom>
                                Risk Flags
                              </Typography>
                              <Box display="flex" flexWrap="wrap" gap={1}>
                                {worker.flags.map((flag, index) => {
                                  const riskTag = riskTags.find((tag) => tag.id === flag);
                                  return riskTag ? (
                                    <Chip
                                      key={index}
                                      label={riskTag.name}
                                      icon={riskTag.icon as React.ReactElement}
                                      color={
                                        riskTag.severity === 'high'
                                          ? 'error'
                                          : riskTag.severity === 'medium'
                                          ? 'warning'
                                          : 'default'
                                      }
                                      size="small"
                                    />
                                  ) : (
                                    <Chip key={index} label={flag} size="small" />
                                  );
                                })}
                              </Box>
                            </Grid>
                          </Grid>
                        </AccordionDetails>
                      </Accordion>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );

  const renderAlertsTab = () => (
    <Grid container spacing={3}>
      {/* High Risk Alerts */}
      <Grid item xs={12}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            High Risk Workers Requiring Immediate Attention
          </Typography>
          <Typography variant="body2">
            {highRiskWorkers.length} workers have scores below 50 or show concerning patterns
          </Typography>
        </Alert>
      </Grid>

      {highRiskWorkers.map((worker) => (
        <Grid item xs={12} md={6} key={worker.id}>
          <Card sx={{ border: '2px solid #f44336' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">{worker.userName}</Typography>
                <Chip label="High Risk" color="error" icon={<Warning />} />
              </Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {worker.department} • {worker.location}
              </Typography>
              <Typography variant="h4" color="error" gutterBottom>
                JSI: {worker.overallScore}
              </Typography>
              <Box mb={2}>
                {worker.flags.map((flag, index) => (
                  <Chip
                    key={index}
                    label={flag.replace('_', ' ')}
                    size="small"
                    color="error"
                    variant="outlined"
                    sx={{ mr: 1, mb: 1 }}
                  />
                ))}
              </Box>
              <Box display="flex" gap={1}>
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  onClick={() => handleTriggerPrompt(worker, 'flagged')}
                >
                  Send Prompt
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={() => handleFlagRisk(worker, 'manual_intervention')}
                >
                  Flag Risk
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      ))}

      {/* Medium Risk Alerts */}
      {mediumRiskWorkers.length > 0 && (
        <Grid item xs={12}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Medium Risk Workers to Monitor
            </Typography>
            <Typography variant="body2">
              {mediumRiskWorkers.length} workers showing concerning trends
            </Typography>
          </Alert>
        </Grid>
      )}

      {mediumRiskWorkers.map((worker) => (
        <Grid item xs={12} md={6} key={worker.id}>
          <Card sx={{ border: '2px solid #ff9800' }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">{worker.userName}</Typography>
                <Chip label="Medium Risk" color="warning" icon={<Warning />} />
              </Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {worker.department} • {worker.location}
              </Typography>
              <Typography variant="h4" color="warning.main" gutterBottom>
                JSI: {worker.overallScore}
              </Typography>
              <Box display="flex" gap={1}>
                <Button
                  variant="outlined"
                  color="warning"
                  size="small"
                  onClick={() => handleTriggerPrompt(worker, 'quarterly')}
                >
                  Send Check-in
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  size="small"
                  onClick={() => handleFlagRisk(worker, 'monitoring')}
                >
                  Flag for Monitoring
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );

  const renderReportsTab = () => (
    <Grid container spacing={3}>
      {/* Date Range Controls */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Report Filters
          </Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth>
                <InputLabel>Granularity</InputLabel>
                <Select value={granularity} onChange={(e) => setGranularity(e.target.value as any)}>
                  <MenuItem value="day">Daily</MenuItem>
                  <MenuItem value="week">Weekly</MenuItem>
                  <MenuItem value="month">Monthly</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth>
                <InputLabel>Comparison</InputLabel>
                <Select
                  value={comparisonMode}
                  onChange={(e) => setComparisonMode(e.target.value as any)}
                >
                  <MenuItem value="baseline">Baseline</MenuItem>
                  <MenuItem value="peer">Peer Average</MenuItem>
                  <MenuItem value="threshold">Threshold</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={() => {
                  fetchReportData();
                  fetchAdvancedTrends();
                  detectAnomalies();
                }}
                fullWidth
              >
                Generate Report
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </Grid>

      {/* Enhanced Trend Chart */}
      <Grid item xs={12} md={8}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Advanced JSI Trends</Typography>
            <Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                onClick={() => exportData('csv', 'detailed')}
                sx={{ mr: 1 }}
              >
                Export CSV
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Code />}
                onClick={() => exportData('json', 'detailed')}
              >
                Export JSON
              </Button>
            </Box>
          </Box>

          {advancedTrends ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={advancedTrends.trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <RechartsTooltip
                  formatter={(value, name) => [value, name]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                {/* Baseline Reference Line */}
                {comparisonMode === 'baseline' && baselineData && (
                  <ReferenceLine
                    y={baselineData.overallScore}
                    stroke="#666"
                    strokeDasharray="5 5"
                    label={{
                      value: `Baseline: ${baselineData.overallScore}`,
                      position: 'insideTopRight',
                      fill: '#666',
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="overall"
                  stroke="#1976d2"
                  strokeWidth={3}
                  name="Overall JSI"
                />
                <Line
                  type="monotone"
                  dataKey="engagement"
                  stroke="#4caf50"
                  strokeWidth={2}
                  name="Work Engagement"
                />
                <Line
                  type="monotone"
                  dataKey="career"
                  stroke="#ff9800"
                  strokeWidth={2}
                  name="Career Alignment"
                />
                <Line
                  type="monotone"
                  dataKey="manager"
                  stroke="#9c27b0"
                  strokeWidth={2}
                  name="Manager Relationship"
                />
                {showPersonalWellbeing && (
                  <Line
                    type="monotone"
                    dataKey="wellbeing"
                    stroke="#607d8b"
                    strokeWidth={2}
                    name="Personal Wellbeing"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="mobility"
                  stroke="#f44336"
                  strokeWidth={2}
                  name="Job Mobility"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={400}>
              <Typography variant="body1" color="text.secondary">
                Click "Generate Report" to load trend data
              </Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Anomaly Detection */}
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Anomaly Detection
          </Typography>
          {anomalies.length > 0 ? (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {anomalies.length} anomalies detected in the last 30 days
              </Typography>
              <List dense>
                {anomalies.slice(0, 5).map((anomaly, index) => (
                  <ListItem key={index} sx={{ px: 0 }}>
                    <ListItemIcon>
                      <Warning color="error" />
                    </ListItemIcon>
                    <ListItemText
                      primary={anomaly.description}
                      secondary={`${anomaly.department} • ${anomaly.location}`}
                    />
                    <Chip
                      label={anomaly.severity}
                      color={anomaly.severity === 'high' ? 'error' : 'warning'}
                      size="small"
                    />
                  </ListItem>
                ))}
              </List>
              {anomalies.length > 5 && (
                <Button size="small" onClick={() => setReportDialogOpen(true)}>
                  View All Anomalies
                </Button>
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No anomalies detected
            </Typography>
          )}
        </Paper>
      </Grid>

      {/* Report Summary */}
      {reportData && (
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Report Summary
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="primary">
                      {reportData.summary.averageScore}
                    </Typography>
                    <Typography variant="body2">Average JSI Score</Typography>
                    {reportData.summary.baselineComparison && (
                      <Typography variant="caption" color="text.secondary">
                        {reportData.summary.baselineComparison.percentageChange > 0 ? '+' : ''}
                        {reportData.summary.baselineComparison.percentageChange}% vs baseline
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="error">
                      {reportData.distributions.risk.high}
                    </Typography>
                    <Typography variant="body2">High Risk Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Need immediate attention
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="success.main">
                      {reportData.distributions.trend.improving}
                    </Typography>
                    <Typography variant="body2">Improving Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Positive trend detected
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="warning.main">
                      {reportData.distributions.trend.declining}
                    </Typography>
                    <Typography variant="body2">Declining Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Negative trend detected
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      )}

      {/* Department & Location Breakdown */}
      {reportData && (
        <>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Department Breakdown
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <RechartsBarChart
                  data={Object.keys(reportData.breakdowns.departments).map((dept) => ({
                    department: dept,
                    score: reportData.breakdowns.departments[dept].averageScore,
                    count: reportData.breakdowns.departments[dept].count,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="department" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#8884d8" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Location Breakdown
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <RechartsBarChart
                  data={Object.keys(reportData.breakdowns.locations).map((loc) => ({
                    location: loc,
                    score: reportData.breakdowns.locations[loc].averageScore,
                    count: reportData.breakdowns.locations[loc].count,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="location" />
                  <YAxis domain={[0, 100]} />
                  <RechartsTooltip />
                  <Bar dataKey="score" fill="#82ca9d" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </>
      )}
    </Grid>
  );

  const renderMessagingTab = () => (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6">AI Messaging Topics Configuration</Typography>
            <Button
              variant="contained"
              startIcon={<Chat />}
              onClick={() => setMessagingConfigDialogOpen(true)}
            >
              Configure Topics
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" paragraph>
            Configure which conversational themes the AI explores with workers during scheduled
            Moments, vibe checks, and reflections.
          </Typography>

          {messagingConfig ? (
            <Grid container spacing={3}>
              {/* Global Settings Summary */}
              <Grid item xs={12} md={4}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Global Settings
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>Max Topics per Prompt:</strong>{' '}
                      {messagingConfig.globalSettings.maxTopicsPerPrompt}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>Rotation Strategy:</strong>{' '}
                      {messagingConfig.globalSettings.topicRotationStrategy}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>Custom Topics:</strong>{' '}
                      {messagingConfig.globalSettings.enableCustomTopics ? 'Enabled' : 'Disabled'}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* Topic Categories Summary */}
              <Grid item xs={12} md={8}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Topic Categories
                    </Typography>
                    <Grid container spacing={2}>
                      {['wellbeing', 'engagement', 'career', 'relationships', 'custom'].map(
                        (category) => {
                          const categoryTopics = messagingConfig.topics.filter(
                            (t) => t.category === category,
                          );
                          const enabledCount = categoryTopics.filter((t) => t.isEnabled).length;
                          return (
                            <Grid item xs={6} sm={4} key={category}>
                              <Box textAlign="center">
                                <Typography variant="h4" color="primary">
                                  {enabledCount}/{categoryTopics.length}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {category.charAt(0).toUpperCase() + category.slice(1)}
                                </Typography>
                              </Box>
                            </Grid>
                          );
                        },
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Priority Distribution */}
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Priority Distribution
                    </Typography>
                    <Grid container spacing={2}>
                      {['high', 'medium', 'low'].map((priority) => {
                        const priorityTopics = messagingConfig.topics.filter(
                          (t) => t.priority === priority && t.isEnabled,
                        );
                        return (
                          <Grid item xs={12} md={4} key={priority}>
                            <Box textAlign="center">
                              <Typography
                                variant="h4"
                                color={
                                  priority === 'high'
                                    ? 'error'
                                    : priority === 'medium'
                                    ? 'warning'
                                    : 'success'
                                }
                              >
                                {priorityTopics.length}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {priority.charAt(0).toUpperCase() + priority.slice(1)} Priority
                              </Typography>
                            </Box>
                          </Grid>
                        );
                      })}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          ) : (
            <Box textAlign="center" py={4}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading messaging configuration...
              </Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Quick Actions */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Quick Actions
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Chat />}
                onClick={() => setCustomTopicDialogOpen(true)}
              >
                Add Custom Topic
              </Button>
            </Grid>
            <Grid item xs={12} md={4}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Assessment />}
                onClick={() => generatePrompt('test-user', 'general_check_in')}
              >
                Test Prompt Generation
              </Button>
            </Grid>
            <Grid item xs={12} md={4}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Refresh />}
                onClick={fetchMessagingConfig}
              >
                Refresh Configuration
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </Grid>
    </Grid>
  );

  const renderSettingsTab = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Scoring Weights
          </Typography>
          <Box mb={3}>
            <Typography variant="body2" gutterBottom>
              Work Engagement: 30%
            </Typography>
            <LinearProgress variant="determinate" value={30} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
          <Box mb={3}>
            <Typography variant="body2" gutterBottom>
              Career Alignment: 20%
            </Typography>
            <LinearProgress variant="determinate" value={20} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
          <Box mb={3}>
            <Typography variant="body2" gutterBottom>
              Manager Relationship: 20%
            </Typography>
            <LinearProgress variant="determinate" value={20} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
          <Box mb={3}>
            <Typography variant="body2" gutterBottom>
              Personal Wellbeing: 20%
            </Typography>
            <LinearProgress variant="determinate" value={20} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
          <Box mb={3}>
            <Typography variant="body2" gutterBottom>
              Job Mobility Signals: 10%
            </Typography>
            <LinearProgress variant="determinate" value={10} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
        </Paper>
      </Grid>

      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Alert Thresholds
          </Typography>
          <List>
            <ListItem>
              <ListItemIcon>
                <Warning color="error" />
              </ListItemIcon>
              <ListItemText
                primary="Low Score Threshold"
                secondary="50 points - Triggers risk alerts"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon>
                <TrendingDown color="warning" />
              </ListItemIcon>
              <ListItemText
                primary="Rapid Drop Threshold"
                secondary="20 points in 30 days - Triggers follow-up"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon>
                <Info color="info" />
              </ListItemIcon>
              <ListItemText
                primary="Risk Flag Threshold"
                secondary="30 points - Marks as high risk"
              />
            </ListItem>
          </List>
        </Paper>
      </Grid>

      <Grid item xs={12}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Data Collection Settings
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={<Switch defaultChecked />}
                label="Baseline Survey (Week 1)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel control={<Switch defaultChecked />} label="Quarterly Check-ins" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel control={<Switch defaultChecked />} label="Ongoing Logging" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel control={<Switch defaultChecked />} label="Flagged Follow-up" />
            </Grid>
          </Grid>
        </Paper>
      </Grid>
    </Grid>
  );

  // Loading state
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // Scoring Methodology Dialog
  const renderMethodologyDialog = () => (
    <Dialog
      open={methodologyDialogOpen}
      onClose={() => setMethodologyDialogOpen(false)}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <Book sx={{ mr: 2 }} />
          <Typography variant="h6">JSI Scoring Methodology & Guide</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <Typography variant="h5" gutterBottom color="primary">
              JSI Formula (0-100 scale)
            </Typography>
            <Paper
              sx={{
                p: 3,
                borderRadius: 2,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
                color: (theme) => theme.palette.text.primary,
                fontFamily: 'monospace',
                fontSize: '1.1rem',
                mb: 3,
              }}
            >
              JSI = (WorkEngagement × 0.3) + (CareerAlignment × 0.2) + (ManagerRelationship × 0.2) +
              (PersonalWellbeing × 0.2) + (JobMobility × 0.1)
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Category Explanations
            </Typography>
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Data Sources</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <strong>Work Engagement (30%)</strong>
                    </TableCell>
                    <TableCell>
                      Energy, focus, daily fulfillment, expressed joy or boredom
                    </TableCell>
                    <TableCell>
                      AI sentiment analysis, vibe check responses, conversation logs
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <strong>Career Alignment (20%)</strong>
                    </TableCell>
                    <TableCell>How well the role matches their long-term goals</TableCell>
                    <TableCell>Goal surveys, manager feedback, role satisfaction</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <strong>Manager Relationship (20%)</strong>
                    </TableCell>
                    <TableCell>Trust, communication, respect, safety</TableCell>
                    <TableCell>Communication sentiment, feedback patterns</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <strong>Personal Wellbeing (20%)</strong>
                    </TableCell>
                    <TableCell>Mental health, physical state, family stress</TableCell>
                    <TableCell>Wellbeing surveys, work/life balance indicators</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <strong>Job Mobility (10%)</strong>
                    </TableCell>
                    <TableCell>Signals they're considering or applying to other jobs</TableCell>
                    <TableCell>Job search signals, tenure satisfaction, external links</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Trust & Privacy
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                • All data is anonymized and aggregated for privacy protection
                <br />
                • Personal wellbeing data is only visible to authorized personnel
                <br />
                • AI analysis respects worker confidentiality and consent
                <br />• Scores are updated regularly based on new data and feedback
              </Typography>
            </Alert>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Visibility Settings
            </Typography>
            <Typography variant="body2" paragraph>
              <strong>HRX Admin / Agency Admin:</strong> Always see all data including personal
              wellbeing
              <br />
              <strong>Customer Admin:</strong> Can enable/disable wellbeing visibility for their org
              <br />
              <strong>Managers:</strong> Can see wellbeing only if enabled AND they're the assigned
              supervisor
              <br />
              <strong>Workers:</strong> Always see their own personal wellbeing scores
            </Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setMethodologyDialogOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  // Export Dialog
  const renderExportDialog = () => (
    <Dialog
      open={exportDialogOpen}
      onClose={() => setExportDialogOpen(false)}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Export & Report Generation</Typography>
          <IconButton onClick={() => setExportDialogOpen(false)}>
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Tabs value={exportTab} onChange={(e, newValue) => setExportTab(newValue)} sx={{ mb: 3 }}>
          <Tab label="Quick Export" value="quick" />
          <Tab label="Custom Reports" value="custom" />
          <Tab label="Advanced Export" value="advanced" />
        </Tabs>

        {exportTab === 'quick' && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Quick Export Options
                  </Typography>
                  <Button
                    variant="contained"
                    fullWidth
                    sx={{ mb: 2 }}
                    onClick={() => exportToCSV()}
                    startIcon={<Download />}
                  >
                    Export to CSV
                  </Button>
                  <Button
                    variant="contained"
                    fullWidth
                    sx={{ mb: 2 }}
                    onClick={() => exportToJSON()}
                    startIcon={<Code />}
                  >
                    Export to JSON
                  </Button>
                  <Button
                    variant="contained"
                    fullWidth
                    sx={{ mb: 2 }}
                    onClick={() => exportToPDFReport()}
                    startIcon={<PictureAsPdf />}
                  >
                    Generate PDF Report
                  </Button>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => exportToExcel()}
                    startIcon={<TableView />}
                  >
                    Generate Excel Report
                  </Button>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Export Settings
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={includeBenchmarks}
                        onChange={(e) => setIncludeBenchmarks(e.target.checked)}
                      />
                    }
                    label="Include Benchmarking Data"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={includePercentiles}
                        onChange={(e) => setIncludePercentiles(e.target.checked)}
                      />
                    }
                    label="Include Percentile Rankings"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={includeMetadata}
                        onChange={(e) => setIncludeMetadata(e.target.checked)}
                      />
                    }
                    label="Include Metadata"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={includeAuditTrail}
                        onChange={(e) => setIncludeAuditTrail(e.target.checked)}
                      />
                    }
                    label="Include Audit Trail"
                    sx={{ mb: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {exportTab === 'custom' && (
          <JSICustomReportBuilder
            onGenerateReport={handleCustomReport}
            customerName="Organization"
          />
        )}

        {exportTab === 'advanced' && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Advanced Export Options
                  </Typography>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Format</InputLabel>
                    <Select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
                      label="Format"
                    >
                      <MenuItem value="csv">CSV</MenuItem>
                      <MenuItem value="json">JSON</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Export Type</InputLabel>
                    <Select
                      value={exportType}
                      onChange={(e) => setExportType(e.target.value as 'detailed' | 'summary')}
                      label="Export Type"
                    >
                      <MenuItem value="detailed">Detailed (All Data)</MenuItem>
                      <MenuItem value="summary">Summary (Aggregated)</MenuItem>
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => exportData(exportFormat, exportType)}
                    startIcon={<Download />}
                  >
                    Export Data
                  </Button>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Data Filters
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={exportFilters.includeHighRisk}
                        onChange={(e) =>
                          setExportFilters((prev) => ({
                            ...prev,
                            includeHighRisk: e.target.checked,
                          }))
                        }
                      />
                    }
                    label="Include High Risk Workers"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={exportFilters.includeMediumRisk}
                        onChange={(e) =>
                          setExportFilters((prev) => ({
                            ...prev,
                            includeMediumRisk: e.target.checked,
                          }))
                        }
                      />
                    }
                    label="Include Medium Risk Workers"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={exportFilters.includeLowRisk}
                        onChange={(e) =>
                          setExportFilters((prev) => ({
                            ...prev,
                            includeLowRisk: e.target.checked,
                          }))
                        }
                      />
                    }
                    label="Include Low Risk Workers"
                    sx={{ mb: 1 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={exportFilters.includeFlags}
                        onChange={(e) =>
                          setExportFilters((prev) => ({ ...prev, includeFlags: e.target.checked }))
                        }
                      />
                    }
                    label="Include Risk Flags"
                    sx={{ mb: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </DialogContent>
    </Dialog>
  );

  // HR Executive Report Dialog
  const renderReportDialog = () => (
    <Dialog
      open={reportDialogOpen}
      onClose={() => setReportDialogOpen(false)}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <Report sx={{ mr: 2 }} />
          <Typography variant="h6">HR Executive Report</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <Typography variant="h5" gutterBottom>
              JSI Executive Summary
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Generated on {new Date().toLocaleDateString()} • {filteredData.length} workers
              analyzed
            </Typography>
          </Grid>

          {/* Overview Metrics */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Overview Metrics
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="primary">
                      {averageScore.toFixed(1)}
                    </Typography>
                    <Typography variant="body2">Average JSI Score</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {getBaselineChange(averageScore, baselineData.overallScore)}% vs baseline
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="error">
                      {highRiskWorkers.length}
                    </Typography>
                    <Typography variant="body2">High Risk Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Need immediate attention
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="warning.main">
                      {mediumRiskWorkers.length}
                    </Typography>
                    <Typography variant="body2">Medium Risk Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Monitor closely
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="success.main">
                      {filteredData.filter((w) => w.riskLevel === 'low').length}
                    </Typography>
                    <Typography variant="body2">Low Risk Workers</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Satisfied and engaged
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Grid>

          {/* Trend Chart */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Score Trends
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <RechartsTooltip />
                <ReferenceLine
                  y={baselineData.overallScore}
                  stroke="#666"
                  strokeDasharray="5 5"
                  label="Baseline"
                />
                <Line
                  type="monotone"
                  dataKey="overall"
                  stroke="#1976d2"
                  strokeWidth={3}
                  name="Overall JSI"
                />
              </LineChart>
            </ResponsiveContainer>
          </Grid>

          {/* Score Breakdown */}
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>
              Score Dimension Breakdown
            </Typography>
            <ResponsiveContainer width="100%" height={200}>
              <RechartsPieChart>
                <Pie
                  data={mockDimensionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockDimensionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </Grid>

          {/* Suggested Actions */}
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>
              Suggested Next Steps
            </Typography>
            <Paper
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : theme.palette.grey[100],
                color: (theme) => theme.palette.text.primary,
              }}
            >
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <Warning color="warning" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Address High Risk Workers"
                    secondary={`${highRiskWorkers.length} workers need immediate intervention`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <TrendingDown color="error" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Monitor Declining Trends"
                    secondary="Overall score has decreased by 15% over 90 days"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <Assessment color="info" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Conduct Manager Training"
                    secondary="Manager relationship scores show room for improvement"
                  />
                </ListItem>
              </List>
            </Paper>
          </Grid>

          {/* AI Summary */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              AI-Generated Summary
            </Typography>
            <Paper
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : theme.palette.grey[100],
                color: (theme) => theme.palette.text.primary,
              }}
            >
              <Typography variant="body2">
                Based on the current JSI data, the organization shows concerning trends with a 15%
                decline in overall satisfaction over the past 90 days. The most significant drops
                are in Work Engagement and Manager Relationship dimensions. Immediate attention is
                recommended for the {highRiskWorkers.length} high-risk workers, particularly
                focusing on manager training and engagement initiatives. The baseline comparison
                indicates this is a departure from the established satisfaction levels.
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setReportDialogOpen(false)}>Close</Button>
        <Button variant="contained" startIcon={<Print />} onClick={() => window.print()}>
          Print / Export
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Survey Queue Dialog
  const renderSurveyQueueDialog = () => (
    <Dialog
      open={surveyQueueDialogOpen}
      onClose={() => setSurveyQueueDialogOpen(false)}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <Schedule sx={{ mr: 2 }} />
          <Typography variant="h6">Survey Queue Management</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Survey Status Overview
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="primary">
                      24
                    </Typography>
                    <Typography variant="body2">Upcoming Surveys</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="warning.main">
                      12
                    </Typography>
                    <Typography variant="body2">Overdue Surveys</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="success.main">
                      156
                    </Typography>
                    <Typography variant="body2">Completed This Month</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="info.main">
                      89%
                    </Typography>
                    <Typography variant="body2">Response Rate</Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Recent Survey Activity
            </Typography>
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Worker</TableCell>
                    <TableCell>Survey Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last Sent</TableCell>
                    <TableCell>Next Due</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Rosa Garcia</TableCell>
                    <TableCell>Quarterly Check-in</TableCell>
                    <TableCell>
                      <Chip label="Completed" color="success" size="small" />
                    </TableCell>
                    <TableCell>2024-01-15</TableCell>
                    <TableCell>2024-04-15</TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined">
                        View Response
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Marcus Johnson</TableCell>
                    <TableCell>Baseline Survey</TableCell>
                    <TableCell>
                      <Chip label="Overdue" color="error" size="small" />
                    </TableCell>
                    <TableCell>2024-01-10</TableCell>
                    <TableCell>2024-01-10</TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined" color="error">
                        Re-send
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Sarah Chen</TableCell>
                    <TableCell>Wellbeing Check</TableCell>
                    <TableCell>
                      <Chip label="Scheduled" color="info" size="small" />
                    </TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>2024-01-20</TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined">
                        Send Now
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setSurveyQueueDialogOpen(false)}>Close</Button>
        <Button variant="contained" color="primary">
          Export Survey Data
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Settings Dialog Component
  const renderSettingsDialog = () => (
    <Dialog
      open={settingsDialogOpen}
      onClose={() => setSettingsDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Typography variant="h6">JSI Settings & Configuration</Typography>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Scoring Weights
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Adjust the importance of each dimension in the overall JSI calculation.
            </Typography>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Work Engagement Weight</InputLabel>
              <Select value={30} disabled>
                <MenuItem value={30}>30% (Default)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Career Alignment Weight</InputLabel>
              <Select value={20} disabled>
                <MenuItem value={20}>20% (Default)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Manager Relationship Weight</InputLabel>
              <Select value={20} disabled>
                <MenuItem value={20}>20% (Default)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Personal Wellbeing Weight</InputLabel>
              <Select value={20} disabled>
                <MenuItem value={20}>20% (Default)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Job Mobility Weight</InputLabel>
              <Select value={10} disabled>
                <MenuItem value={10}>10% (Default)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Alert Thresholds
            </Typography>
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Low Score Threshold"
              type="number"
              defaultValue={50}
              helperText="Scores below this trigger alerts"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Rapid Drop Threshold"
              type="number"
              defaultValue={20}
              helperText="Point drop in 30 days to flag"
            />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Data Collection
            </Typography>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel
              control={<Switch defaultChecked />}
              label="Baseline Survey (Week 1)"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel control={<Switch defaultChecked />} label="Quarterly Check-ins" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel control={<Switch defaultChecked />} label="Ongoing Logging" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel control={<Switch defaultChecked />} label="Flagged Follow-up" />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Privacy Settings
            </Typography>
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel
              control={<Switch defaultChecked />}
              label="Keep Personal Wellbeing Private"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormControlLabel control={<Switch />} label="Anonymize Aggregate Data" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setSettingsDialogOpen(false);
            setSnackbar({
              open: true,
              message: 'Settings saved successfully',
              severity: 'success',
            });
            logJSIInteraction('settings_updated', {
              reason: 'JSI settings modified',
              targetType: 'settings',
              targetId: 'jsi_config',
            });
          }}
        >
          Save Settings
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Messaging Configuration Dialog
  const renderMessagingConfigDialog = () => (
    <Dialog
      open={messagingConfigDialogOpen}
      onClose={() => setMessagingConfigDialogOpen(false)}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <Chat sx={{ mr: 2 }} />
          <Typography variant="h6">AI Messaging Topics Configuration</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {messagingConfig ? (
          <Grid container spacing={3} sx={{ pt: 2 }}>
            {/* Global Settings */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Global Settings
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Max Topics per Prompt</InputLabel>
                    <Select
                      value={messagingConfig.globalSettings.maxTopicsPerPrompt}
                      onChange={(e) => {
                        const updatedConfig = {
                          ...messagingConfig,
                          globalSettings: {
                            ...messagingConfig.globalSettings,
                            maxTopicsPerPrompt: e.target.value as number,
                          },
                        };
                        updateMessagingConfig(updatedConfig.topics, updatedConfig.globalSettings);
                      }}
                      label="Max Topics per Prompt"
                    >
                      <MenuItem value={1}>1</MenuItem>
                      <MenuItem value={2}>2</MenuItem>
                      <MenuItem value={3}>3</MenuItem>
                      <MenuItem value={4}>4</MenuItem>
                      <MenuItem value={5}>5</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Topic Rotation Strategy</InputLabel>
                    <Select
                      value={messagingConfig.globalSettings.topicRotationStrategy}
                      onChange={(e) => {
                        const updatedConfig = {
                          ...messagingConfig,
                          globalSettings: {
                            ...messagingConfig.globalSettings,
                            topicRotationStrategy: e.target.value as
                              | 'random'
                              | 'priority'
                              | 'frequency',
                          },
                        };
                        updateMessagingConfig(updatedConfig.topics, updatedConfig.globalSettings);
                      }}
                      label="Topic Rotation Strategy"
                    >
                      <MenuItem value="priority">Priority-based</MenuItem>
                      <MenuItem value="frequency">Frequency-based</MenuItem>
                      <MenuItem value="random">Random</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>

            {/* Topics List */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Messaging Topics
              </Typography>
              <Grid container spacing={2}>
                {messagingConfig.topics.map((topic) => (
                  <Grid item xs={12} key={topic.id}>
                    <Card variant="outlined">
                      <CardContent>
                        <Grid container spacing={2} alignItems="center">
                          <Grid item xs={12} md={3}>
                            <Typography variant="subtitle1" fontWeight="bold">
                              {topic.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {topic.description}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={2}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Priority</InputLabel>
                              <Select
                                value={topic.priority}
                                onChange={(e) => {
                                  const updatedTopics = messagingConfig.topics.map((t) =>
                                    t.id === topic.id
                                      ? {
                                          ...t,
                                          priority: e.target.value as 'high' | 'medium' | 'low',
                                        }
                                      : t,
                                  );
                                  updateMessagingConfig(updatedTopics);
                                }}
                                label="Priority"
                              >
                                <MenuItem value="high">High</MenuItem>
                                <MenuItem value="medium">Medium</MenuItem>
                                <MenuItem value="low">Low</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={2}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Frequency</InputLabel>
                              <Select
                                value={topic.frequency}
                                onChange={(e) => {
                                  const updatedTopics = messagingConfig.topics.map((t) =>
                                    t.id === topic.id
                                      ? {
                                          ...t,
                                          frequency: e.target.value as
                                            | 'weekly'
                                            | 'monthly'
                                            | 'quarterly',
                                        }
                                      : t,
                                  );
                                  updateMessagingConfig(updatedTopics);
                                }}
                                label="Frequency"
                              >
                                <MenuItem value="weekly">Weekly</MenuItem>
                                <MenuItem value="monthly">Monthly</MenuItem>
                                <MenuItem value="quarterly">Quarterly</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={2}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={topic.isEnabled}
                                  onChange={(e) => {
                                    const updatedTopics = messagingConfig.topics.map((t) =>
                                      t.id === topic.id ? { ...t, isEnabled: e.target.checked } : t,
                                    );
                                    updateMessagingConfig(updatedTopics);
                                  }}
                                />
                              }
                              label="Enabled"
                            />
                          </Grid>
                          <Grid item xs={12} md={3}>
                            <Chip
                              label={topic.category}
                              color={topic.category === 'custom' ? 'secondary' : 'primary'}
                              size="small"
                            />
                          </Grid>
                        </Grid>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>
          </Grid>
        ) : (
          <Box textAlign="center" py={4}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Loading messaging configuration...
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setMessagingConfigDialogOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  // Custom Topic Dialog
  const renderCustomTopicDialog = () => (
    <Dialog
      open={customTopicDialogOpen}
      onClose={() => setCustomTopicDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <Chat sx={{ mr: 2 }} />
          <Typography variant="h6">Add Custom Topic</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Topic Name"
              placeholder="e.g., Safety Concerns, Workplace Conflict"
              variant="outlined"
              id="customTopicName"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              placeholder="Brief description of what this topic explores"
              variant="outlined"
              multiline
              rows={2}
              id="customTopicDescription"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select defaultValue="medium" label="Priority" id="customTopicPriority">
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Frequency</InputLabel>
              <Select defaultValue="monthly" label="Frequency" id="customTopicFrequency">
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="quarterly">Quarterly</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle1" gutterBottom>
              Sample Prompts
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Add 2-3 sample prompts that the AI can use for this topic:
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Prompt 1"
                  placeholder="e.g., How are you feeling about workplace safety lately?"
                  variant="outlined"
                  id="customTopicPrompt1"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Prompt 2"
                  placeholder="e.g., Have you noticed any safety concerns that need attention?"
                  variant="outlined"
                  id="customTopicPrompt2"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Prompt 3 (optional)"
                  placeholder="e.g., What would make you feel safer at work?"
                  variant="outlined"
                  id="customTopicPrompt3"
                />
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setCustomTopicDialogOpen(false)}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            const name = (document.getElementById('customTopicName') as HTMLInputElement)?.value;
            const description = (
              document.getElementById('customTopicDescription') as HTMLInputElement
            )?.value;
            const priority = (document.getElementById('customTopicPriority') as HTMLSelectElement)
              ?.value as 'high' | 'medium' | 'low';
            const frequency = (document.getElementById('customTopicFrequency') as HTMLSelectElement)
              ?.value as 'weekly' | 'monthly' | 'quarterly';
            const prompt1 = (document.getElementById('customTopicPrompt1') as HTMLInputElement)
              ?.value;
            const prompt2 = (document.getElementById('customTopicPrompt2') as HTMLInputElement)
              ?.value;
            const prompt3 = (document.getElementById('customTopicPrompt3') as HTMLInputElement)
              ?.value;

            if (name && description && prompt1 && prompt2) {
              const samplePrompts = [prompt1, prompt2];
              if (prompt3) samplePrompts.push(prompt3);

              addCustomTopic({
                name,
                description,
                priority,
                frequency,
                samplePrompts,
                isEnabled: true,
              });
            }
          }}
        >
          Add Topic
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Check permissions and module access
  if (!canAccessJSI()) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Access Denied
          </Typography>
          <Typography variant="body2">
            You don't have permission to access Job Satisfaction Insights. Contact your
            administrator if you believe this is an error.
          </Typography>
        </Alert>
      </Box>
    );
  }

  // Check if Job Satisfaction Insights module is enabled
  if (!moduleLoading && !isModuleInEnabledList('job-satisfaction-insights')) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Module Disabled
          </Typography>
          <Typography variant="body2">
            Job Satisfaction Insights is currently disabled. Enable it in the Modules & Features section to access this functionality.
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Header */}
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => window.history.back()} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Job Satisfaction Insights
          </Typography>
          <Typography variant="body1" color="text.secondary">
            AI-powered satisfaction scoring and risk detection
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <Button
            variant="outlined"
            startIcon={<Book />}
            onClick={() => setMethodologyDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Methodology
          </Button>
          <Button
            variant="outlined"
            startIcon={<Help />}
            onClick={() => window.open('/admin/jsi-documentation', '_blank')}
            sx={{ mr: 1 }}
          >
            Documentation
          </Button>
          <Button
            variant="outlined"
            startIcon={<Schedule />}
            onClick={() => setSurveyQueueDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Survey Queue
          </Button>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={fetchJSIData}
            sx={{ mr: 1 }}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<Settings />}
            onClick={() => setSettingsDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Settings
          </Button>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={() => setExportDialogOpen(true)}
            sx={{ mr: 1 }}
          >
            Export Data
          </Button>
          <Button
            variant="contained"
            startIcon={<AutomationIcon />}
            onClick={handleOpenAutomation}
            color="primary"
          >
            Automation
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Overview" icon={<Assessment />} />
          <Tab label="Workers" icon={<TableChart />} />
          <Tab label="Reports" icon={<Report />} />
          <Tab label="Risk Alerts" icon={<Warning />} />
          <Tab label="Messaging" icon={<Chat />} />
          <Tab label="Settings" icon={<Settings />} />
        </Tabs>
      </Box>

      {/* Tab Content */}
      {activeTab === 0 && renderOverviewTab()}
      {activeTab === 1 && renderWorkersTab()}
      {activeTab === 2 && renderReportsTab()}
      {activeTab === 3 && renderAlertsTab()}
      {activeTab === 4 && renderMessagingTab()}
      {activeTab === 5 && renderSettingsTab()}

      {/* Dialogs */}
      {renderMethodologyDialog()}
      {renderSurveyQueueDialog()}
      {renderSettingsDialog()}
      {renderExportDialog()}
      {renderReportDialog()}
      {renderMessagingConfigDialog()}
      {renderCustomTopicDialog()}

      {/* Worker Detail Dialog */}
      <Dialog
        open={!!selectedWorker}
        onClose={() => setSelectedWorker(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedWorker && (
          <>
            <DialogTitle>
              <Typography variant="h6">{selectedWorker.userName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedWorker.department} • {selectedWorker.location}
              </Typography>
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>
                    Overall JSI Score
                  </Typography>
                  <Typography variant="h2" color="primary" gutterBottom>
                    {selectedWorker.overallScore}
                  </Typography>
                  <Box display="flex" alignItems="center" mb={2}>
                    {getTrendIcon(selectedWorker.trend)}
                    <Typography variant="body2" sx={{ ml: 1 }}>
                      {selectedWorker.trend === 'up'
                        ? 'Improving'
                        : selectedWorker.trend === 'down'
                        ? 'Declining'
                        : 'Stable'}
                    </Typography>
                  </Box>
                  <Chip
                    label={selectedWorker.riskLevel}
                    color={
                      selectedWorker.riskLevel === 'high'
                        ? 'error'
                        : selectedWorker.riskLevel === 'medium'
                        ? 'warning'
                        : 'success'
                    }
                    icon={getRiskIcon(selectedWorker.riskLevel)}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>
                    Score Breakdown
                  </Typography>
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Work Engagement: {selectedWorker.workEngagement}
                    </Typography>
                    <LinearProgress variant="determinate" value={selectedWorker.workEngagement} />
                  </Box>
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Career Alignment: {selectedWorker.careerAlignment}
                    </Typography>
                    <LinearProgress variant="determinate" value={selectedWorker.careerAlignment} />
                  </Box>
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Manager Relationship: {selectedWorker.managerRelationship}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={selectedWorker.managerRelationship}
                    />
                  </Box>
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Personal Wellbeing: {selectedWorker.personalWellbeing}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={selectedWorker.personalWellbeing}
                    />
                  </Box>
                  <Box mb={2}>
                    <Typography variant="body2" gutterBottom>
                      Job Mobility: {selectedWorker.jobMobility}
                    </Typography>
                    <LinearProgress variant="determinate" value={selectedWorker.jobMobility} />
                  </Box>
                </Grid>
                {selectedWorker.flags.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Risk Flags
                    </Typography>
                    <Box>
                      {selectedWorker.flags.map((flag, index) => (
                        <Chip
                          key={index}
                          label={flag.replace('_', ' ')}
                          color="error"
                          variant="outlined"
                          sx={{ mr: 1, mb: 1 }}
                        />
                      ))}
                    </Box>
                  </Grid>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedWorker(null)}>Close</Button>
              <Button variant="contained">Take Action</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Automation Dialog */}
      <Dialog open={automationDialog} onClose={handleCloseAutomation} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <AutomationIcon color="primary" />
            <Typography variant="h6">JSI Automation Setup</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stepper activeStep={automationStep} orientation="vertical">
            <Step>
              <StepLabel>
                <Box display="flex" alignItems="center" gap={1}>
                  <Analytics />
                  <Typography variant="subtitle1">Insights Generation</Typography>
                </Box>
              </StepLabel>
              <StepContent>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={automationConfig.insightsGeneration.enabled}
                        onChange={(e) => handleAutomationConfigChange('insightsGeneration', 'enabled', e.target.checked)}
                      />
                    }
                    label="Enable Automated Insights Generation"
                  />
                  <FormHelperText>
                    AI will automatically generate insights and recommendations based on JSI data
                  </FormHelperText>
                </Box>
                {automationConfig.insightsGeneration.enabled && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Frequency</InputLabel>
                        <Select
                          value={automationConfig.insightsGeneration.frequency}
                          onChange={(e) => handleAutomationConfigChange('insightsGeneration', 'frequency', e.target.value)}
                        >
                          <MenuItem value="daily">Daily</MenuItem>
                          <MenuItem value="weekly">Weekly</MenuItem>
                          <MenuItem value="monthly">Monthly</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Time Range</InputLabel>
                        <Select
                          value={automationConfig.insightsGeneration.timeRange}
                          onChange={(e) => handleAutomationConfigChange('insightsGeneration', 'timeRange', e.target.value)}
                        >
                          <MenuItem value="7">Last 7 days</MenuItem>
                          <MenuItem value="30">Last 30 days</MenuItem>
                          <MenuItem value="90">Last 90 days</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={automationConfig.insightsGeneration.includeOrganizational}
                            onChange={(e) => handleAutomationConfigChange('insightsGeneration', 'includeOrganizational', e.target.checked)}
                          />
                        }
                        label="Include Organizational Breakdown"
                      />
                    </Grid>
                  </Grid>
                )}
                <Button
                  variant="contained"
                  onClick={() => setAutomationStep(1)}
                  sx={{ mt: 2 }}
                >
                  Continue
                </Button>
              </StepContent>
            </Step>

            <Step>
              <StepLabel>
                <Box display="flex" alignItems="center" gap={1}>
                  <Schedule />
                  <Typography variant="subtitle1">Report Scheduling</Typography>
                </Box>
              </StepLabel>
              <StepContent>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={automationConfig.reportScheduling.enabled}
                        onChange={(e) => handleAutomationConfigChange('reportScheduling', 'enabled', e.target.checked)}
                      />
                    }
                    label="Enable Automated Report Scheduling"
                  />
                  <FormHelperText>
                    Automatically generate and send reports to specified recipients
                  </FormHelperText>
                </Box>
                {automationConfig.reportScheduling.enabled && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Frequency</InputLabel>
                        <Select
                          value={automationConfig.reportScheduling.frequency}
                          onChange={(e) => handleAutomationConfigChange('reportScheduling', 'frequency', e.target.value)}
                        >
                          <MenuItem value="daily">Daily</MenuItem>
                          <MenuItem value="weekly">Weekly</MenuItem>
                          <MenuItem value="monthly">Monthly</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Report Type</InputLabel>
                        <Select
                          value={automationConfig.reportScheduling.reportType}
                          onChange={(e) => handleAutomationConfigChange('reportScheduling', 'reportType', e.target.value)}
                        >
                          <MenuItem value="summary">Summary</MenuItem>
                          <MenuItem value="comprehensive">Comprehensive</MenuItem>
                          <MenuItem value="detailed">Detailed</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Recipients (comma-separated emails)"
                        placeholder="manager@company.com, hr@company.com"
                        value={automationConfig.reportScheduling.recipients.join(', ')}
                        onChange={(e) => handleAutomationConfigChange('reportScheduling', 'recipients', e.target.value.split(',').map(email => email.trim()))}
                      />
                    </Grid>
                  </Grid>
                )}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setAutomationStep(0)}
                    sx={{ mr: 1 }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => setAutomationStep(2)}
                  >
                    Continue
                  </Button>
                </Box>
              </StepContent>
            </Step>

            <Step>
              <StepLabel>
                <Box display="flex" alignItems="center" gap={1}>
                  <Warning />
                  <Typography variant="subtitle1">Alert Configuration</Typography>
                </Box>
              </StepLabel>
              <StepContent>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={automationConfig.alerts.enabled}
                        onChange={(e) => handleAutomationConfigChange('alerts', 'enabled', e.target.checked)}
                      />
                    }
                    label="Enable Automated Alerts"
                  />
                  <FormHelperText>
                    Receive notifications when risk levels exceed thresholds
                  </FormHelperText>
                </Box>
                {automationConfig.alerts.enabled && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" gutterBottom>
                        Risk Threshold
                      </Typography>
                      <Slider
                        value={automationConfig.alerts.riskThreshold}
                        onChange={(_, value) => handleAutomationConfigChange('alerts', 'riskThreshold', value)}
                        min={0}
                        max={0.5}
                        step={0.05}
                        marks
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${(value * 100).toFixed(0)}%`}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" gutterBottom>
                        Trend Threshold
                      </Typography>
                      <Slider
                        value={automationConfig.alerts.trendThreshold}
                        onChange={(_, value) => handleAutomationConfigChange('alerts', 'trendThreshold', value)}
                        min={0}
                        max={0.5}
                        step={0.05}
                        marks
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${(value * 100).toFixed(0)}%`}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={automationConfig.alerts.emailNotifications}
                            onChange={(e) => handleAutomationConfigChange('alerts', 'emailNotifications', e.target.checked)}
                          />
                        }
                        label="Email Notifications"
                      />
                    </Grid>
                  </Grid>
                )}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setAutomationStep(1)}
                    sx={{ mr: 1 }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={handleScheduleReports}
                    startIcon={<AutomationIcon />}
                  >
                    Enable Automation
                  </Button>
                </Box>
              </StepContent>
            </Step>
          </Stepper>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAutomation}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Settings Dialog */}
      {renderSettingsDialog()}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default JobSatisfactionInsights;
