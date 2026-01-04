import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  CircularProgress,
  Alert,
  Snackbar,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Autocomplete,
  Tabs,
  Tab,
  TextField,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  Speed as SpeedIcon,
  Psychology as PsychologyIcon,
  Error as ErrorIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  ArrowBack as ArrowBackIcon,
  Assessment as AssessmentIcon,
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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';

import { app , db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';


interface AnalyticsData {
  eventFrequency: Array<{ eventType: string; count: number; trend: number }>;
  engineProcessingTimes: Array<{ engine: string; avgTime: number; count: number }>;
  errorRates: Array<{ engine: string; errorRate: number; totalLogs: number }>;
  performanceMetrics: {
    avgLatency: number;
    successRate: number;
    throughput: number;
    errorCount: number;
  };
  topIssues: Array<{ issue: string; count: number; impact: string }>;
  contextUsage: Array<{ contextType: string; usage: number; effectiveness: number }>;
  urgencyDistribution: Array<{ level: string; count: number; percentage: number }>;
  engineEffectiveness: Array<{ engine: string; effectiveness: number; recommendations: string[] }>;
  // Organizational analytics
  organizationalBreakdown?: {
    regions: Array<{ regionId: string; regionName: string; count: number; avgLatency: number; errorRate: number }>;
    divisions: Array<{ divisionId: string; divisionName: string; count: number; avgLatency: number; errorRate: number }>;
    departments: Array<{ departmentId: string; departmentName: string; count: number; avgLatency: number; errorRate: number }>;
    locations: Array<{ locationId: string; locationName: string; count: number; avgLatency: number; errorRate: number }>;
  };
  organizationalPerformance?: {
    regionPerformance: Array<{ region: string; successRate: number; avgLatency: number; throughput: number }>;
    divisionPerformance: Array<{ division: string; successRate: number; avgLatency: number; throughput: number }>;
    departmentPerformance: Array<{ department: string; successRate: number; avgLatency: number; throughput: number }>;
    locationPerformance: Array<{ location: string; successRate: number; avgLatency: number; throughput: number }>;
  };
  organizationalIssues?: {
    regionIssues: Array<{ region: string; issue: string; count: number; impact: string }>;
    divisionIssues: Array<{ division: string; issue: string; count: number; impact: string }>;
    departmentIssues: Array<{ department: string; issue: string; count: number; impact: string }>;
    locationIssues: Array<{ location: string; issue: string; count: number; impact: string }>;
  };
}

interface TimeRange {
  label: string;
  value: string;
  hours: number;
}

interface OrganizationalUnit {
  id: string;
  name: string;
  type: 'region' | 'division' | 'department' | 'location';
}

const AIAnalytics: React.FC = () => {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>({
    label: 'Last 24 Hours',
    value: '24h',
    hours: 24,
  });
  
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
  
  // Tab management
  const [activeTab, setActiveTab] = useState(0);
  
  const navigate = useNavigate();
  const { tenantId } = useAuth();

  // Batch enrichment controls
  const [batchLimit, setBatchLimit] = useState<number>(100);
  const [batchMode, setBatchMode] = useState<'full' | 'metadata'>('metadata');
  const [batchForce, setBatchForce] = useState<boolean>(false);
  const [runningBatch, setRunningBatch] = useState<boolean>(false);
  const [enrichmentStats, setEnrichmentStats] = useState<{ companies: number; enriched: number; updatedLast7Days: number; avgLeadScore: number } | null>(null);

  const timeRanges: TimeRange[] = [
    { label: 'Last Hour', value: '1h', hours: 1 },
    { label: 'Last 6 Hours', value: '6h', hours: 6 },
    { label: 'Last 24 Hours', value: '24h', hours: 24 },
    { label: 'Last 7 Days', value: '7d', hours: 168 },
    { label: 'Last 30 Days', value: '30d', hours: 720 },
  ];

  useEffect(() => {
    fetchOrganizationalData();
    fetchAnalytics();
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

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const functions = getFunctions(app);
      const getAnalytics = httpsCallable(functions, 'getAIAnalytics');
      const getEnrichmentStats = httpsCallable(functions, 'getEnrichmentStats');

      const result = await getAnalytics({ 
        timeRange: timeRange.value,
        organizationalFilters: {
          regions: selectedRegions.map(r => r.id),
          divisions: selectedDivisions.map(d => d.id),
          departments: selectedDepartments.map(dept => dept.id),
          locations: selectedLocations.map(l => l.id),
        }
      });
      console.log('Analytics result:', result);
      setAnalyticsData(result.data as AnalyticsData);

      if (tenantId) {
        const enr = await getEnrichmentStats({ tenantId });
        const stats = (enr.data || {}) as any;
        setEnrichmentStats({
          companies: stats.companies || 0,
          enriched: stats.enriched || 0,
          updatedLast7Days: stats.updatedLast7Days || 0,
          avgLeadScore: stats.avgLeadScore || 0,
        });
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.details || 'Failed to fetch analytics data';
      setError(`Analytics error: ${errorMessage}`);
      console.error('Analytics error:', err);
    } finally {
      setLoading(false);
    }
  };

  const runBatchEnrichment = async () => {
    if (!tenantId) {
      setError('Missing tenant context');
      return;
    }
    try {
      setRunningBatch(true);
      const functions = getFunctions(app);
      const batch = httpsCallable(functions, 'enrichCompanyBatch');
      const result = await batch({ tenantId, limit: batchLimit, mode: batchMode, force: batchForce });
      const data = result.data as any;
      setSuccess(`Queued ${data?.queued ?? 0} companies for ${batchMode} enrichment`);
    } catch (err: any) {
      setError(err?.message || 'Batch enrichment failed');
    } finally {
      setRunningBatch(false);
    }
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

  if (loading) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" fontWeight={600}>
          AI Analytics Dashboard
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
      <Typography variant="subtitle1" color="text.secondary" mb={3}>
        Comprehensive analytics and insights from AI system logs for performance optimization and
        system health monitoring.
      </Typography>

      {/* Controls */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Time Range</InputLabel>
              <Select
                value={timeRange.value}
                onChange={(e) => {
                  const selected = timeRanges.find(tr => tr.value === e.target.value);
                  if (selected) setTimeRange(selected);
                }}
                label="Time Range"
              >
                {timeRanges.map((tr) => (
                  <MenuItem key={tr.value} value={tr.value}>
                    {tr.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={9}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={fetchAnalytics}
                disabled={loading}
              >
                Refresh Analytics
              </Button>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Batch Mode</InputLabel>
                <Select
                  label="Batch Mode"
                  value={batchMode}
                  onChange={(e) => setBatchMode(e.target.value as any)}
                >
                  <MenuItem value="metadata">Metadata</MenuItem>
                  <MenuItem value="full">Full</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Limit"
                type="number"
                size="small"
                value={batchLimit}
                onChange={(e) => setBatchLimit(parseInt(e.target.value || '0', 10))}
                inputProps={{ min: 10, max: 500 }}
                sx={{ width: 120 }}
              />
              <FormControlLabel control={<Switch checked={batchForce} onChange={(e) => setBatchForce(e.target.checked)} />} label="Force" />
              <Button variant="outlined" onClick={runBatchEnrichment} disabled={runningBatch}>
                {runningBatch ? 'Queuing…' : 'Run Batch'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Enrichment Stats */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Company Enrichment Summary</Typography>
          <Button size="small" variant="outlined" onClick={fetchAnalytics}>Refresh</Button>
        </Box>
        {enrichmentStats ? (
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <Card><CardContent>
                <Typography variant="h4">{enrichmentStats.companies}</Typography>
                <Typography variant="caption" color="text.secondary">Total Companies</Typography>
              </CardContent></Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card><CardContent>
                <Typography variant="h4">{enrichmentStats.enriched}</Typography>
                <Typography variant="caption" color="text.secondary">With AI Enrichment</Typography>
              </CardContent></Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card><CardContent>
                <Typography variant="h4">{enrichmentStats.updatedLast7Days}</Typography>
                <Typography variant="caption" color="text.secondary">Updated (7 days)</Typography>
              </CardContent></Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card><CardContent>
                <Typography variant="h4">{enrichmentStats.avgLeadScore.toFixed(1)}</Typography>
                <Typography variant="caption" color="text.secondary">Avg Lead Score</Typography>
              </CardContent></Card>
            </Grid>
          </Grid>
        ) : (
          <Typography variant="body2" color="text.secondary">No enrichment stats available.</Typography>
        )}
      </Paper>

      {/* Organizational Filtering */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon />
          Organizational Filtering
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filter analytics data by organizational units to focus on specific areas
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
                tagValue.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={option.name}
                      size="small"
                      icon={<BusinessIcon />}
                      {...chipProps}
                    />
                  );
                })
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
                tagValue.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={option.name}
                      size="small"
                      icon={<AccountTreeIcon />}
                      {...chipProps}
                    />
                  );
                })
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
                tagValue.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={option.name}
                      size="small"
                      icon={<GroupIcon />}
                      {...chipProps}
                    />
                  );
                })
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
                tagValue.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={option.name}
                      size="small"
                      icon={<LocationOnIcon />}
                      {...chipProps}
                    />
                  );
                })
              }
            />
          </Grid>
        </Grid>
      </Paper>

      {!analyticsData && (
        <Alert severity="info">
          No analytics data available for the selected time range. Try refreshing or selecting a
          different time range.
        </Alert>
      )}

      {analyticsData && (
        <>
          {/* Main Content Tabs */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
              <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
                <Tab label="Overview" />
                <Tab label="Organizational Analytics" />
                <Tab label="Performance Details" />
              </Tabs>
            </Box>

            {/* Overview Tab */}
            {activeTab === 0 && (
              <Box>
                {/* Performance Overview */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} sm={6} md={3}>
                    <Card>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <SpeedIcon color="primary" sx={{ mr: 1 }} />
                          <Typography variant="h6">
                            {analyticsData.performanceMetrics.avgLatency}ms
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Average Latency
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(
                            100,
                            (analyticsData.performanceMetrics.avgLatency / 2000) * 100,
                          )}
                          sx={{ mt: 1 }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Card>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <CheckCircleIcon color="success" sx={{ mr: 1 }} />
                          <Typography variant="h6">
                            {analyticsData.performanceMetrics.successRate.toFixed(1)}%
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Success Rate
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={analyticsData.performanceMetrics.successRate}
                          color="success"
                          sx={{ mt: 1 }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Card>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <PsychologyIcon color="secondary" sx={{ mr: 1 }} />
                          <Typography variant="h6">
                            {analyticsData.performanceMetrics.throughput}/min
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Throughput
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, (analyticsData.performanceMetrics.throughput / 100) * 100)}
                          color="secondary"
                          sx={{ mt: 1 }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Card>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <ErrorIcon color="error" sx={{ mr: 1 }} />
                          <Typography variant="h6">
                            {analyticsData.performanceMetrics.errorCount}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Error Count
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, (analyticsData.performanceMetrics.errorCount / 50) * 100)}
                          color="error"
                          sx={{ mt: 1 }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Charts Row 1 */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Event Frequency Trend
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={analyticsData.eventFrequency}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="eventType" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="count" stroke="#8884d8" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Engine Processing Times
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.engineProcessingTimes}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="engine" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="avgTime" fill="#82ca9d" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Charts Row 2 */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Error Rates by Engine
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.errorRates}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="engine" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="errorRate" fill="#ff8042" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Urgency Distribution
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={analyticsData.urgencyDistribution}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ payload }: any) =>
                              `${payload?.level || ''}: ${payload?.percentage || 0}%`
                            }
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="count"
                          >
                            {analyticsData.urgencyDistribution.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Organizational Analytics Tab */}
            {activeTab === 1 && analyticsData.organizationalBreakdown && (
              <Box>
                <Typography variant="h6" gutterBottom sx={{ mb: 3 }}>
                  Organizational Performance Breakdown
                </Typography>

                {/* Regional Performance */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Regional Performance
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.organizationalBreakdown.regions}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="regionName" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="count" fill="#8884d8" name="Request Count" />
                          <Bar dataKey="avgLatency" fill="#82ca9d" name="Avg Latency (ms)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Division Performance
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.organizationalBreakdown.divisions}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="divisionName" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="count" fill="#0088FE" name="Request Count" />
                          <Bar dataKey="avgLatency" fill="#00C49F" name="Avg Latency (ms)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Department and Location Performance */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Department Performance
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.organizationalBreakdown.departments}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="departmentName" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="count" fill="#FFBB28" name="Request Count" />
                          <Bar dataKey="avgLatency" fill="#FF8042" name="Avg Latency (ms)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Location Performance
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.organizationalBreakdown.locations}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="locationName" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="count" fill="#8884D8" name="Request Count" />
                          <Bar dataKey="avgLatency" fill="#82CA9D" name="Avg Latency (ms)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Organizational Performance Metrics */}
                {analyticsData.organizationalPerformance && (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom>
                          Regional Success Rates
                        </Typography>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={analyticsData.organizationalPerformance.regionPerformance}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="region" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Area type="monotone" dataKey="successRate" stackId="1" stroke="#8884d8" fill="#8884d8" />
                            <Area type="monotone" dataKey="throughput" stackId="2" stroke="#82ca9d" fill="#82ca9d" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom>
                          Division Success Rates
                        </Typography>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={analyticsData.organizationalPerformance.divisionPerformance}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="division" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Area type="monotone" dataKey="successRate" stackId="1" stroke="#0088FE" fill="#0088FE" />
                            <Area type="monotone" dataKey="throughput" stackId="2" stroke="#00C49F" fill="#00C49F" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </Paper>
                    </Grid>
                  </Grid>
                )}
              </Box>
            )}

            {/* Performance Details Tab */}
            {activeTab === 2 && (
              <Box>
                {/* Context Usage and Engine Effectiveness */}
                <Grid container spacing={3} sx={{ mb: 4 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Context Usage Effectiveness
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.contextUsage}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="contextType" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="usage" fill="#8884d8" />
                          <Bar dataKey="effectiveness" fill="#82ca9d" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Engine Effectiveness
                      </Typography>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsData.engineEffectiveness}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="engine" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="effectiveness" fill="#0088FE" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Top Issues and Recommendations */}
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Top Issues
                      </Typography>
                      <List>
                        {analyticsData.topIssues.map((issue, index) => (
                          <ListItem key={index} divider>
                            <ListItemIcon>
                              <Chip
                                label={issue.impact}
                                size="small"
                                color={
                                  issue.impact === 'High'
                                    ? 'error'
                                    : issue.impact === 'Medium'
                                    ? 'warning'
                                    : 'default'
                                }
                              />
                            </ListItemIcon>
                            <ListItemText
                              primary={issue.issue}
                              secondary={`${issue.count} occurrences`}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom>
                        Engine Recommendations
                      </Typography>
                      <List>
                        {analyticsData.engineEffectiveness.map((engine, index) => (
                          <ListItem key={index} divider>
                            <ListItemIcon>
                              <AssessmentIcon color="primary" />
                            </ListItemIcon>
                            <ListItemText
                              primary={engine.engine}
                              secondary={
                                <Box>
                                  <Typography variant="body2" color="text.secondary">
                                    Effectiveness: {engine.effectiveness.toFixed(1)}%
                                  </Typography>
                                  {engine.recommendations.map((rec, recIndex) => (
                                    <Typography
                                      key={recIndex}
                                      variant="caption"
                                      display="block"
                                      color="text.secondary"
                                    >
                                      • {rec}
                                    </Typography>
                                  ))}
                                </Box>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Paper>
                  </Grid>
                </Grid>
              </Box>
            )}
          </Paper>
        </>
      )}

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={2000} onClose={() => setSuccess('')}>
        <Alert severity="success" onClose={() => setSuccess('')} sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AIAnalytics;
