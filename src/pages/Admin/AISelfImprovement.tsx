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
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tabs,
  Tab,
  Autocomplete,
} from '@mui/material';
import {
  AutoFixHigh as AutoFixHighIcon,
  Psychology as PsychologyIcon,
  TrendingUp as TrendingUpIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Settings as SettingsIcon,
  Lightbulb as LightbulbIcon,
  Analytics as AnalyticsIcon,
  Feedback as FeedbackIcon,
  TrendingDown as TrendingDownIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
  AccountTree as AccountTreeIcon,
  Group as GroupIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { app , db } from '../../firebase';

interface ImprovementRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  organizationalScope?: 'all' | 'specific' | 'none';
  targetRegions?: string[];
  targetDivisions?: string[];
  targetDepartments?: string[];
  targetLocations?: string[];
}

interface LowConfidencePattern {
  sourceModule: string;
  eventType: string;
  avgConfidence: number;
  count: number;
  examples: any[];
  organizationalBreakdown?: {
    regions: { [key: string]: number };
    divisions: { [key: string]: number };
    departments: { [key: string]: number };
    locations: { [key: string]: number };
  };
}

interface TraitAccuracy {
  traitName: string;
  accuracy: number;
  predictions: number;
  avgConfidence: number;
  needsImprovement: boolean;
  organizationalBreakdown?: {
    regions: { [key: string]: { accuracy: number; predictions: number } };
    divisions: { [key: string]: { accuracy: number; predictions: number } };
    departments: { [key: string]: { accuracy: number; predictions: number } };
    locations: { [key: string]: { accuracy: number; predictions: number } };
  };
}

interface AdminOverride {
  id: string;
  logId: string;
  adminId: string;
  overrideReason: string;
  newAction: string;
  originalAction: string;
  originalConfidence: number;
  timestamp: Date;
  promptId: string;
  sourceModule: string;
  organizationalContext?: {
    regionId?: string;
    divisionId?: string;
    departmentId?: string;
    locationId?: string;
  };
}

interface SelfImprovementReport {
  reportId: string;
  timeRange: number;
  recommendations: ImprovementRecommendation[];
  summary: {
    totalLowConfidence: number;
    totalOverrides: number;
    traitsNeedingImprovement: number;
    recommendationsCount: number;
    organizationalInsights?: {
      regionsWithIssues: string[];
      divisionsWithIssues: string[];
      departmentsWithIssues: string[];
      locationsWithIssues: string[];
    };
  };
}

interface OrganizationalUnit {
  id: string;
  name: string;
  type: 'region' | 'division' | 'department' | 'location';
}

const AISelfImprovement: React.FC = (): JSX.Element => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [timeRange, setTimeRange] = useState(24);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  
  // Organizational filtering
  const [selectedRegions, setSelectedRegions] = useState<OrganizationalUnit[]>([]);
  const [selectedDivisions, setSelectedDivisions] = useState<OrganizationalUnit[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<OrganizationalUnit[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<OrganizationalUnit[]>([]);
  const [organizationalData, setOrganizationalData] = useState<{
    regions: OrganizationalUnit[];
    divisions: OrganizationalUnit[];
    departments: OrganizationalUnit[];
    locations: OrganizationalUnit[];
  }>({
    regions: [],
    divisions: [],
    departments: [],
    locations: [],
  });
  
  const [lowConfidenceData, setLowConfidenceData] = useState<{
    totalLogs: number;
    patterns: LowConfidencePattern[];
  } | null>(null);
  const [traitAccuracyData, setTraitAccuracyData] = useState<{
    totalTraits: number;
    accuracyRates: TraitAccuracy[];
    needsImprovement: TraitAccuracy[];
  } | null>(null);
  const [adminOverrides, setAdminOverrides] = useState<AdminOverride[]>([]);
  const [improvementReport, setImprovementReport] = useState<SelfImprovementReport | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<LowConfidencePattern | null>(null);
  const [selectedTrait, setSelectedTrait] = useState<TraitAccuracy | null>(null);
  const [overrideDialog, setOverrideDialog] = useState(false);
  const [newOverride, setNewOverride] = useState({
    logId: '',
    overrideReason: '',
    newAction: '',
  });
  const navigate = useNavigate();

  // Mock data for demonstration
  const mockLowConfidenceData = {
    totalLogs: 23,
    patterns: [
      {
        sourceModule: 'FeedbackEngine',
        eventType: 'feedback.response',
        avgConfidence: 0.45,
        count: 12,
        examples: [],
        organizationalBreakdown: {
          regions: { 'region1': 5, 'region2': 7 },
          divisions: { 'division1': 8, 'division2': 4 },
          departments: { 'dept1': 6, 'dept2': 6 },
          locations: { 'location1': 3, 'location2': 9 },
        },
      },
      {
        sourceModule: 'MomentsEngine',
        eventType: 'moment.trigger',
        avgConfidence: 0.52,
        count: 8,
        examples: [],
        organizationalBreakdown: {
          regions: { 'region1': 3, 'region2': 5 },
          divisions: { 'division1': 5, 'division2': 3 },
          departments: { 'dept1': 4, 'dept2': 4 },
          locations: { 'location1': 2, 'location2': 6 },
        },
      },
      {
        sourceModule: 'TraitsEngine',
        eventType: 'trait.analysis',
        avgConfidence: 0.38,
        count: 3,
        examples: [],
        organizationalBreakdown: {
          regions: { 'region1': 2, 'region2': 1 },
          divisions: { 'division1': 2, 'division2': 1 },
          departments: { 'dept1': 1, 'dept2': 2 },
          locations: { 'location1': 1, 'location2': 2 },
        },
      },
    ],
  };

  const mockTraitAccuracyData = {
    totalTraits: 8,
    accuracyRates: [
      {
        traitName: 'Communication Style',
        accuracy: 85.2,
        predictions: 45,
        avgConfidence: 0.78,
        needsImprovement: false,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 87.5, predictions: 24 }, 'region2': { accuracy: 82.9, predictions: 21 } },
          divisions: { 'division1': { accuracy: 86.2, predictions: 29 }, 'division2': { accuracy: 83.8, predictions: 16 } },
          departments: { 'dept1': { accuracy: 84.6, predictions: 26 }, 'dept2': { accuracy: 85.8, predictions: 19 } },
          locations: { 'location1': { accuracy: 88.1, predictions: 18 }, 'location2': { accuracy: 83.3, predictions: 27 } },
        },
      },
      {
        traitName: 'Work Preference',
        accuracy: 67.8,
        predictions: 32,
        avgConfidence: 0.65,
        needsImprovement: true,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 70.0, predictions: 15 }, 'region2': { accuracy: 65.6, predictions: 17 } },
          divisions: { 'division1': { accuracy: 69.2, predictions: 20 }, 'division2': { accuracy: 65.0, predictions: 12 } },
          departments: { 'dept1': { accuracy: 68.8, predictions: 18 }, 'dept2': { accuracy: 66.8, predictions: 14 } },
          locations: { 'location1': { accuracy: 71.4, predictions: 12 }, 'location2': { accuracy: 65.5, predictions: 20 } },
        },
      },
      {
        traitName: 'Learning Style',
        accuracy: 72.1,
        predictions: 28,
        avgConfidence: 0.71,
        needsImprovement: true,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 75.0, predictions: 14 }, 'region2': { accuracy: 69.2, predictions: 14 } },
          divisions: { 'division1': { accuracy: 73.3, predictions: 18 }, 'division2': { accuracy: 70.0, predictions: 10 } },
          departments: { 'dept1': { accuracy: 72.7, predictions: 16 }, 'dept2': { accuracy: 71.5, predictions: 12 } },
          locations: { 'location1': { accuracy: 76.9, predictions: 11 }, 'location2': { accuracy: 69.4, predictions: 17 } },
        },
      },
      {
        traitName: 'Motivation Type',
        accuracy: 91.3,
        predictions: 52,
        avgConfidence: 0.84,
        needsImprovement: false,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 92.0, predictions: 28 }, 'region2': { accuracy: 90.6, predictions: 24 } },
          divisions: { 'division1': { accuracy: 91.7, predictions: 34 }, 'division2': { accuracy: 90.6, predictions: 18 } },
          departments: { 'dept1': { accuracy: 91.2, predictions: 30 }, 'dept2': { accuracy: 91.4, predictions: 22 } },
          locations: { 'location1': { accuracy: 92.3, predictions: 20 }, 'location2': { accuracy: 90.7, predictions: 32 } },
        },
      },
    ],
    needsImprovement: [
      {
        traitName: 'Work Preference',
        accuracy: 67.8,
        predictions: 32,
        avgConfidence: 0.65,
        needsImprovement: true,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 70.0, predictions: 15 }, 'region2': { accuracy: 65.6, predictions: 17 } },
          divisions: { 'division1': { accuracy: 69.2, predictions: 20 }, 'division2': { accuracy: 65.0, predictions: 12 } },
          departments: { 'dept1': { accuracy: 68.8, predictions: 18 }, 'dept2': { accuracy: 66.8, predictions: 14 } },
          locations: { 'location1': { accuracy: 71.4, predictions: 12 }, 'location2': { accuracy: 65.5, predictions: 20 } },
        },
      },
      {
        traitName: 'Learning Style',
        accuracy: 72.1,
        predictions: 28,
        avgConfidence: 0.71,
        needsImprovement: true,
        organizationalBreakdown: {
          regions: { 'region1': { accuracy: 75.0, predictions: 14 }, 'region2': { accuracy: 69.2, predictions: 14 } },
          divisions: { 'division1': { accuracy: 73.3, predictions: 18 }, 'division2': { accuracy: 70.0, predictions: 10 } },
          departments: { 'dept1': { accuracy: 72.7, predictions: 16 }, 'dept2': { accuracy: 71.5, predictions: 12 } },
          locations: { 'location1': { accuracy: 76.9, predictions: 11 }, 'location2': { accuracy: 69.4, predictions: 17 } },
        },
      },
    ],
  };

  const mockAdminOverrides: AdminOverride[] = [
    {
      id: 'override1',
      logId: 'log123',
      adminId: 'admin1',
      overrideReason: 'AI response too formal for casual feedback',
      newAction: 'Used more conversational tone',
      originalAction: 'Formal acknowledgment of feedback',
      originalConfidence: 0.45,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      promptId: 'feedback_response',
      sourceModule: 'FeedbackEngine',
      organizationalContext: {
        regionId: 'region1',
        divisionId: 'division1',
        departmentId: 'dept1',
        locationId: 'location1',
      },
    },
    {
      id: 'override2',
      logId: 'log124',
      adminId: 'admin2',
      overrideReason: 'Incorrect trait prediction',
      newAction: 'Corrected trait assignment',
      originalAction: 'Assigned analytical trait',
      originalConfidence: 0.52,
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
      promptId: 'trait_analysis',
      sourceModule: 'TraitsEngine',
      organizationalContext: {
        regionId: 'region2',
        divisionId: 'division2',
        departmentId: 'dept2',
        locationId: 'location2',
      },
    },
  ];

  const mockImprovementReport: SelfImprovementReport = {
    reportId: 'report1',
    timeRange: 24,
    recommendations: [
      {
        type: 'confidence_improvement',
        priority: 'high',
        title: 'Address Low Confidence Patterns',
        description: '23 interactions had low confidence scores',
        action: 'Review and enhance context retrieval for affected modules',
        organizationalScope: 'specific',
        targetRegions: ['region2'],
        targetDivisions: ['division1'],
        targetDepartments: ['dept1'],
        targetLocations: ['location2'],
      },
      {
        type: 'trait_improvement',
        priority: 'medium',
        title: 'Improve Trait Prediction Accuracy',
        description: '2 traits have accuracy below 70%',
        action: 'Review trait prediction logic and training data',
        organizationalScope: 'specific',
        targetRegions: ['region2'],
        targetDivisions: ['division2'],
        targetDepartments: ['dept2'],
        targetLocations: ['location2'],
      },
      {
        type: 'escalation_improvement',
        priority: 'high',
        title: 'Review Escalation Logic',
        description: '2 admin overrides in the last 24 hours',
        action: 'Lower confidence thresholds and improve decision logic',
        organizationalScope: 'all',
      },
      {
        type: 'organizational_training',
        priority: 'medium',
        title: 'Region-Specific Training Needed',
        description: 'Region 2 shows consistently lower accuracy across traits',
        action: 'Implement region-specific training data and context enhancement',
        organizationalScope: 'specific',
        targetRegions: ['region2'],
      },
    ],
    summary: {
      totalLowConfidence: 23,
      totalOverrides: 2,
      traitsNeedingImprovement: 2,
      recommendationsCount: 4,
      organizationalInsights: {
        regionsWithIssues: ['region2'],
        divisionsWithIssues: ['division1', 'division2'],
        departmentsWithIssues: ['dept1', 'dept2'],
        locationsWithIssues: ['location2'],
      },
    },
  };

  useEffect(() => {
    fetchOrganizationalData();
    fetchSelfImprovementData();
  }, [timeRange]);

  const fetchOrganizationalData = async () => {
    try {
      // Fetch regions
      const regionsQuery = query(collection(db, 'regions'), where('status', '==', 'active'));
      const regionsSnapshot = await getDocs(regionsQuery);
      const regions = regionsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, type: 'region' as const }));

      // Fetch divisions
      const divisionsQuery = query(collection(db, 'divisions'), where('status', '==', 'active'));
      const divisionsSnapshot = await getDocs(divisionsQuery);
      const divisions = divisionsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, type: 'division' as const }));

      // Fetch departments
      const departmentsQuery = query(collection(db, 'departments'), where('status', '==', 'active'));
      const departmentsSnapshot = await getDocs(departmentsQuery);
      const departments = departmentsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, type: 'department' as const }));

      // Fetch locations
      const locationsQuery = query(collection(db, 'locations'), where('status', '==', 'active'));
      const locationsSnapshot = await getDocs(locationsQuery);
      const locations = locationsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, type: 'location' as const }));

      setOrganizationalData({ regions, divisions, departments, locations });
    } catch (err: any) {
      console.error('Failed to fetch organizational data:', err);
      // Use mock data if fetch fails
      setOrganizationalData({
        regions: [
          { id: 'region1', name: 'North Region', type: 'region' },
          { id: 'region2', name: 'South Region', type: 'region' },
        ],
        divisions: [
          { id: 'division1', name: 'Operations', type: 'division' },
          { id: 'division2', name: 'Support', type: 'division' },
        ],
        departments: [
          { id: 'dept1', name: 'Field Services', type: 'department' },
          { id: 'dept2', name: 'Customer Success', type: 'department' },
        ],
        locations: [
          { id: 'location1', name: 'Main Office', type: 'location' },
          { id: 'location2', name: 'Branch Office', type: 'location' },
        ],
      });
    }
  };

  const fetchSelfImprovementData = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app);

      // Fetch low confidence data
      const scanLogsForLowConfidence = httpsCallable(functions, 'scanLogsForLowConfidence');
      const lowConfidenceResult = await scanLogsForLowConfidence({
        timeRange,
        confidenceThreshold,
      });
      setLowConfidenceData(lowConfidenceResult.data as any);

      // Fetch trait accuracy data
      const evaluateTraitPredictionAccuracy = httpsCallable(
        functions,
        'evaluateTraitPredictionAccuracy',
      );
      const traitAccuracyResult = await evaluateTraitPredictionAccuracy({ timeRange });
      setTraitAccuracyData(traitAccuracyResult.data as any);

      // Use mock data for demonstration
      setLowConfidenceData(mockLowConfidenceData);
      setTraitAccuracyData(mockTraitAccuracyData);
      setAdminOverrides(mockAdminOverrides);
      setImprovementReport(mockImprovementReport);
    } catch (err: any) {
      setError('Failed to fetch self-improvement data');
      // Use mock data for demonstration
      setLowConfidenceData(mockLowConfidenceData);
      setTraitAccuracyData(mockTraitAccuracyData);
      setAdminOverrides(mockAdminOverrides);
      setImprovementReport(mockImprovementReport);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app);
      const generateSelfImprovementReport = httpsCallable(
        functions,
        'generateSelfImprovementReport',
      );
      const result = await generateSelfImprovementReport({ timeRange });
      setImprovementReport(result.data as SelfImprovementReport);
      setSuccess('Self-improvement report generated successfully');
    } catch (err: any) {
      setError('Failed to generate improvement report');
    } finally {
      setLoading(false);
    }
  };

  const handleTrackOverride = async () => {
    try {
      const functions = getFunctions(app);
      const trackAdminOverrides = httpsCallable(functions, 'trackAdminOverrides');
      await trackAdminOverrides({
        logId: newOverride.logId,
        adminId: 'current_admin', // This would come from auth
        overrideReason: newOverride.overrideReason,
        newAction: newOverride.newAction,
      });
      setSuccess('Admin override tracked successfully');
      setOverrideDialog(false);
      setNewOverride({ logId: '', overrideReason: '', newAction: '' });
      fetchSelfImprovementData();
    } catch (err: any) {
      setError('Failed to track admin override');
    }
  };

  const handleSuggestRefinement = async (promptId: string) => {
    try {
      const functions = getFunctions(app);
      const suggestPromptRefinement = httpsCallable(functions, 'suggestPromptRefinement');
      const result = await suggestPromptRefinement({ promptId });
      setSuccess(`Generated ${(result.data as any).refinements.length} refinement suggestions`);
    } catch (err: any) {
      setError('Failed to suggest prompt refinements');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'default';
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 80) return 'success';
    if (accuracy >= 70) return 'warning';
    return 'error';
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h3">
            AI Self-Improvement Engine
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Monitor AI performance, track improvements, and generate optimization recommendations
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ height: 40 }}
        >
          Back to Launchpad
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TrendingDownIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h6">{lowConfidenceData?.totalLogs || 0}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Low Confidence Logs
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <FeedbackIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">{adminOverrides.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Admin Overrides
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PsychologyIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">
                  {traitAccuracyData?.needsImprovement.length || 0}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Traits Needing Improvement
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <LightbulbIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">
                  {improvementReport?.recommendations.length || 0}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Active Recommendations
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Controls */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Time Range</InputLabel>
              <Select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as number)}
                label="Time Range"
              >
                <MenuItem value={1}>Last Hour</MenuItem>
                <MenuItem value={24}>Last 24 Hours</MenuItem>
                <MenuItem value={168}>Last Week</MenuItem>
                <MenuItem value={720}>Last Month</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Typography variant="body2" gutterBottom>
              Confidence Threshold
            </Typography>
            <Slider
              value={confidenceThreshold}
              onChange={(_, value) => setConfidenceThreshold(value as number)}
              min={0.1}
              max={1.0}
              step={0.1}
              marks
              valueLabelDisplay="auto"
            />
          </Grid>
          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={fetchSelfImprovementData}
                disabled={loading}
              >
                Refresh Data
              </Button>
              <Button
                variant="contained"
                startIcon={<AnalyticsIcon />}
                onClick={handleGenerateReport}
                disabled={loading}
              >
                Generate Report
              </Button>
              <Button
                variant="outlined"
                startIcon={<FeedbackIcon />}
                onClick={() => setOverrideDialog(true)}
              >
                Track Override
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Organizational Filtering */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon />
          Organizational Filtering
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filter AI performance data by organizational units to identify patterns and issues
        </Typography>
        
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              multiple
              options={organizationalData.regions}
              value={selectedRegions}
              onChange={(_, value) => setSelectedRegions(value)}
              getOptionLabel={(option) => option.name}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Regions" placeholder="Select regions" />
              )}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((option, index) => (
                  <Chip
                    label={option.name}
                    {...getTagProps({ index })}
                    size="small"
                    icon={<BusinessIcon />}
                  />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              multiple
              options={organizationalData.divisions}
              value={selectedDivisions}
              onChange={(_, value) => setSelectedDivisions(value)}
              getOptionLabel={(option) => option.name}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Divisions" placeholder="Select divisions" />
              )}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((option, index) => (
                  <Chip
                    label={option.name}
                    {...getTagProps({ index })}
                    size="small"
                    icon={<AccountTreeIcon />}
                  />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              multiple
              options={organizationalData.departments}
              value={selectedDepartments}
              onChange={(_, value) => setSelectedDepartments(value)}
              getOptionLabel={(option) => option.name}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Departments" placeholder="Select departments" />
              )}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((option, index) => (
                  <Chip
                    label={option.name}
                    {...getTagProps({ index })}
                    size="small"
                    icon={<GroupIcon />}
                  />
                ))
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              multiple
              options={organizationalData.locations}
              value={selectedLocations}
              onChange={(_, value) => setSelectedLocations(value)}
              getOptionLabel={(option) => option.name}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Locations" placeholder="Select locations" />
              )}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((option, index) => (
                  <Chip
                    label={option.name}
                    {...getTagProps({ index })}
                    size="small"
                    icon={<LocationOnIcon />}
                  />
                ))
              }
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Main Content */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
            <Tab label="Low Confidence Patterns" />
            <Tab label="Trait Accuracy" />
            <Tab label="Admin Overrides" />
            <Tab label="Recommendations" />
          </Tabs>
        </Box>

        {/* Low Confidence Patterns Tab */}
        {activeTab === 0 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Low Confidence Patterns
            </Typography>

            <Grid container spacing={3}>
              {lowConfidenceData?.patterns.map((pattern, index) => (
                <Grid item xs={12} md={6} key={index}>
                  <Card>
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
                          <Typography variant="h6" gutterBottom>
                            {pattern.sourceModule}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {pattern.eventType}
                          </Typography>
                        </Box>
                        <Chip
                          label={`${(pattern.avgConfidence * 100).toFixed(1)}%`}
                          color={pattern.avgConfidence < 0.5 ? 'error' : 'warning'}
                          size="small"
                        />
                      </Box>
                      <Typography variant="body2" sx={{ mb: 2 }}>
                        {pattern.count} occurrences
                      </Typography>
                      
                      {/* Organizational Breakdown */}
                      {pattern.organizationalBreakdown && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Organizational Breakdown:
                          </Typography>
                          <Grid container spacing={1}>
                            {Object.entries(pattern.organizationalBreakdown.regions).map(([regionId, count]) => {
                              const region = organizationalData.regions.find(r => r.id === regionId);
                              return (
                                <Grid item xs={6} key={`region-${regionId}`}>
                                  <Chip
                                    label={`${region?.name || regionId}: ${count}`}
                                    size="small"
                                    variant="outlined"
                                    icon={<BusinessIcon />}
                                  />
                                </Grid>
                              );
                            })}
                            {Object.entries(pattern.organizationalBreakdown.divisions).map(([divisionId, count]) => {
                              const division = organizationalData.divisions.find(d => d.id === divisionId);
                              return (
                                <Grid item xs={6} key={`division-${divisionId}`}>
                                  <Chip
                                    label={`${division?.name || divisionId}: ${count}`}
                                    size="small"
                                    variant="outlined"
                                    icon={<AccountTreeIcon />}
                                  />
                                </Grid>
                              );
                            })}
                            {Object.entries(pattern.organizationalBreakdown.departments).map(([deptId, count]) => {
                              const dept = organizationalData.departments.find(d => d.id === deptId);
                              return (
                                <Grid item xs={6} key={`dept-${deptId}`}>
                                  <Chip
                                    label={`${dept?.name || deptId}: ${count}`}
                                    size="small"
                                    variant="outlined"
                                    icon={<GroupIcon />}
                                  />
                                </Grid>
                              );
                            })}
                            {Object.entries(pattern.organizationalBreakdown.locations).map(([locationId, count]) => {
                              const location = organizationalData.locations.find(l => l.id === locationId);
                              return (
                                <Grid item xs={6} key={`location-${locationId}`}>
                                  <Chip
                                    label={`${location?.name || locationId}: ${count}`}
                                    size="small"
                                    variant="outlined"
                                    icon={<LocationOnIcon />}
                                  />
                                </Grid>
                              );
                            })}
                          </Grid>
                        </Box>
                      )}

                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setSelectedPattern(pattern)}
                        sx={{ mt: 2 }}
                      >
                        View Details
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* Trait Accuracy Tab */}
        {activeTab === 1 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Trait Prediction Accuracy
            </Typography>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Trait Name</TableCell>
                    <TableCell>Accuracy</TableCell>
                    <TableCell>Predictions</TableCell>
                    <TableCell>Avg Confidence</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {traitAccuracyData?.accuracyRates.map((trait) => (
                    <TableRow key={trait.traitName}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {trait.traitName}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`${trait.accuracy.toFixed(1)}%`}
                          color={getAccuracyColor(trait.accuracy)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{trait.predictions}</TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {(trait.avgConfidence * 100).toFixed(1)}%
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={trait.needsImprovement ? <WarningIcon /> : <CheckCircleIcon />}
                          label={trait.needsImprovement ? 'Needs Improvement' : 'Good'}
                          color={trait.needsImprovement ? 'warning' : 'success'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setSelectedTrait(trait)}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Admin Overrides Tab */}
        {activeTab === 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Admin Overrides
            </Typography>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Timestamp</TableCell>
                    <TableCell>Module</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Original Confidence</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {adminOverrides.map((override) => (
                    <TableRow key={override.id}>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatDate(override.timestamp)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={override.sourceModule} variant="outlined" size="small" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{override.overrideReason}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {(override.originalConfidence * 100).toFixed(1)}%
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            setNewOverride({
                              logId: override.logId,
                              overrideReason: override.overrideReason,
                              newAction: override.newAction,
                            });
                            setOverrideDialog(true);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Recommendations Tab */}
        {activeTab === 3 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Improvement Recommendations
            </Typography>

            <Grid container spacing={3}>
              {improvementReport?.recommendations.map((recommendation, index) => (
                <Grid item xs={12} md={6} key={index}>
                  <Card>
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          mb: 2,
                        }}
                      >
                        <Typography variant="h6" gutterBottom>
                          {recommendation.title}
                        </Typography>
                        <Chip
                          label={recommendation.priority}
                          color={getPriorityColor(recommendation.priority)}
                          size="small"
                        />
                      </Box>

                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {recommendation.description}
                      </Typography>

                      <Typography variant="body2" fontWeight={500}>
                        Recommended Action:
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {recommendation.action}
                      </Typography>

                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<AutoFixHighIcon />}
                        onClick={() => {
                          // Handle recommendation action
                          setSuccess(`Applied recommendation: ${recommendation.title}`);
                        }}
                      >
                        Apply Recommendation
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}
      </Paper>

      {/* Pattern Details Dialog */}
      <Dialog
        open={!!selectedPattern}
        onClose={() => setSelectedPattern(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Low Confidence Pattern Details</DialogTitle>
        <DialogContent>
          {selectedPattern && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedPattern.sourceModule} - {selectedPattern.eventType}
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Pattern Statistics
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Average Confidence"
                            secondary={`${(selectedPattern.avgConfidence * 100).toFixed(1)}%`}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText primary="Occurrences" secondary={selectedPattern.count} />
                        </ListItem>
                        <ListItem>
                          <ListItemText primary="Module" secondary={selectedPattern.sourceModule} />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Suggested Actions
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemIcon>
                            <SettingsIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Review Context Retrieval"
                            secondary="Enhance filters for this module"
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <AutoFixHighIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Optimize Prompts"
                            secondary="Improve prompt clarity and specificity"
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <TrendingUpIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Monitor Performance"
                            secondary="Track improvements over time"
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedPattern(null)}>Close</Button>
          <Button
            variant="contained"
            onClick={() => {
              handleSuggestRefinement(selectedPattern?.sourceModule || '');
              setSelectedPattern(null);
            }}
          >
            Generate Refinements
          </Button>
        </DialogActions>
      </Dialog>

      {/* Trait Details Dialog */}
      <Dialog open={!!selectedTrait} onClose={() => setSelectedTrait(null)} maxWidth="md" fullWidth>
        <DialogTitle>Trait Accuracy Details</DialogTitle>
        <DialogContent>
          {selectedTrait && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedTrait.traitName}
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Accuracy Metrics
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Accuracy Rate"
                            secondary={`${selectedTrait.accuracy.toFixed(1)}%`}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Total Predictions"
                            secondary={selectedTrait.predictions}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Average Confidence"
                            secondary={`${(selectedTrait.avgConfidence * 100).toFixed(1)}%`}
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Improvement Suggestions
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemIcon>
                            <PsychologyIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Review Training Data"
                            secondary="Check for bias or gaps"
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <AutoFixHighIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Optimize Prediction Logic"
                            secondary="Improve algorithm accuracy"
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <TrendingUpIcon color="primary" />
                          </ListItemIcon>
                          <ListItemText
                            primary="Monitor Trends"
                            secondary="Track improvement over time"
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedTrait(null)}>Close</Button>
          <Button
            variant="contained"
            onClick={() => {
              handleSuggestRefinement(selectedTrait?.traitName || '');
              setSelectedTrait(null);
            }}
          >
            Generate Improvements
          </Button>
        </DialogActions>
      </Dialog>

      {/* Override Dialog */}
      <Dialog
        open={overrideDialog}
        onClose={() => setOverrideDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Track Admin Override</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Log ID"
                value={newOverride.logId}
                onChange={(e) => setNewOverride((prev) => ({ ...prev, logId: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Override Reason"
                value={newOverride.overrideReason}
                onChange={(e) =>
                  setNewOverride((prev) => ({ ...prev, overrideReason: e.target.value }))
                }
                fullWidth
                multiline
                rows={2}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="New Action"
                value={newOverride.newAction}
                onChange={(e) => setNewOverride((prev) => ({ ...prev, newAction: e.target.value }))}
                fullWidth
                multiline
                rows={2}
                required
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverrideDialog(false)}>Cancel</Button>
          <Button onClick={handleTrackOverride} variant="contained">
            Track Override
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess('')}>
        <Alert severity="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AISelfImprovement;
