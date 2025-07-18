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
  LinearProgress,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tabs,
  Tab,
} from '@mui/material';
import {
  ArrowBack,
  Refresh,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Error,
  Warning,
  Info,
  Schedule,
  Speed,
  HealthAndSafety,
  BugReport,
  Timeline,
  Assessment,
  Notifications,
  PlayArrow,
  Stop,
  Settings,
  PhoneIphone,
  Web,
  Cloud,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

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
}

interface AutoDevOpsAlert {
  id: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'performance' | 'error' | 'health' | 'effectiveness';
  title: string;
  description: string;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  actionTaken?: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`monitoring-tabpanel-${index}`}
      aria-labelledby={`monitoring-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `monitoring-tab-${index}`,
    'aria-controls': `monitoring-tabpanel-${index}`,
  };
}

const AutoDevOpsMonitoring: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const [metrics, setMetrics] = useState<AutoDevOpsMetrics[]>([]);
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
  const [alerts, setAlerts] = useState<AutoDevOpsAlert[]>([]);
  const [trends, setTrends] = useState<any>({});
  const [summary, setSummary] = useState<any>({});
  const [selectedAlert, setSelectedAlert] = useState<AutoDevOpsAlert | null>(null);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [mobileErrors, setMobileErrors] = useState<any[]>([]);
  const [mobileStats, setMobileStats] = useState<any>(null);
  const [cloudFunctionErrors, setCloudFunctionErrors] = useState<any[]>([]);
  const navigate = useNavigate();

  const functions = getFunctions();

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchRealTimeMetrics, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError('');

      const getPerformanceDashboard = httpsCallable(functions, 'getPerformanceDashboard');
      const result = await getPerformanceDashboard({ timeRange });
      const data = result.data as any;

      setMetrics(data.metrics || []);
      setAlerts(data.alerts || []);
      setTrends(data.trends || {});
      setSummary(data.summary || {});

      // Fetch mobile app errors
      await fetchMobileErrors();
      
      // Fetch cloud function errors
      await fetchCloudFunctionErrors();

      await fetchRealTimeMetrics();
    } catch (err: any) {
      setError(`Failed to fetch dashboard data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchMobileErrors = async () => {
    try {
      const getMobileErrorStats = httpsCallable(functions, 'getMobileErrorStats');
      const result = await getMobileErrorStats();
      const data = result.data as any;
      setMobileStats(data.stats);
      // For now, we'll use mock data for mobile errors
      setMobileErrors([
        {
          id: '1',
          timestamp: new Date().toISOString(),
          platform: 'ios',
          errorType: 'crash',
          severity: 'critical',
          errorMessage: 'App crashed on startup',
          userId: 'user123'
        },
        {
          id: '2',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          platform: 'android',
          errorType: 'network',
          severity: 'high',
          errorMessage: 'Network timeout',
          userId: 'user456'
        }
      ]);
    } catch (err) {
      console.error('Failed to fetch mobile errors:', err);
    }
  };

  const fetchCloudFunctionErrors = async () => {
    try {
      // Mock cloud function errors for now
      setCloudFunctionErrors([
        {
          id: '1',
          timestamp: new Date().toISOString(),
          functionName: 'logMobileAppError',
          errorType: 'timeout',
          severity: 'high',
          errorMessage: 'Function execution timeout',
          executionTime: 30000
        },
        {
          id: '2',
          timestamp: new Date(Date.now() - 1800000).toISOString(),
          functionName: 'monitorMobileAppErrors',
          errorType: 'memory',
          severity: 'medium',
          errorMessage: 'Memory limit exceeded',
          executionTime: 15000
        }
      ]);
    } catch (err) {
      console.error('Failed to fetch cloud function errors:', err);
    }
  };

  const fetchRealTimeMetrics = async () => {
    try {
      const getRealTimeMetrics = httpsCallable(functions, 'getRealTimeMetrics');
      const result = await getRealTimeMetrics();
      const data = result.data as any;
      setRealTimeMetrics(data.metrics);
    } catch (err: any) {
      console.error('Failed to fetch real-time metrics:', err);
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'success';
      case 'degraded': return 'warning';
      case 'critical': return 'error';
      default: return 'default';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      case 'low': return 'default';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'idle': return <CheckCircle color="success" />;
      case 'processing': return <CircularProgress size={20} />;
      case 'error': return <Error color="error" />;
      case 'maintenance': return <Settings color="warning" />;
      default: return <Info color="info" />;
    }
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const handleAlertClick = (alert: AutoDevOpsAlert) => {
    setSelectedAlert(alert);
    setAlertDialogOpen(true);
  };

  const handleResolveAlert = async (alertId: string) => {
    try {
      // This would call a backend function to resolve the alert
      console.log('Resolving alert:', alertId);
      setAlertDialogOpen(false);
      await fetchDashboardData();
    } catch (err: any) {
      setError(`Failed to resolve alert: ${err.message}`);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box display="flex" alignItems="center" gap={2}>
          
          <Typography variant="h3">
            AutoDevOps Monitoring
          </Typography>
          
          <Chip label="Live" color="success" size="small" />
        </Box>
        <Box display="flex" gap={2}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Time Range</InputLabel>
            <Select
              value={timeRange}
              label="Time Range"
              onChange={(e) => setTimeRange(e.target.value as any)}
            >
              <MenuItem value="1h">Last Hour</MenuItem>
              <MenuItem value="24h">Last 24 Hours</MenuItem>
              <MenuItem value="7d">Last 7 Days</MenuItem>
              <MenuItem value="30d">Last 30 Days</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<Refresh />}
            onClick={fetchDashboardData}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<ArrowBack />}
            onClick={() => navigate('/admin/ai')}
          >
            Back to Launchpad
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Real-time Status */}
      {realTimeMetrics && (
        <Paper sx={{ p: 3, mb: 3, bgcolor: 'background.paper' }}>
          <Typography variant="h6" gutterBottom>
            Real-time Status
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={3}>
              <Box display="flex" alignItems="center" gap={2}>
                {getStatusIcon(realTimeMetrics.systemStatus)}
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    System Status
                  </Typography>
                  <Typography variant="h6" textTransform="capitalize">
                    {realTimeMetrics.systemStatus}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} md={3}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Uptime
                </Typography>
                <Typography variant="h6">
                  {formatUptime(realTimeMetrics.uptimeSeconds)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={3}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Logs in Queue
                </Typography>
                <Typography variant="h6">
                  {realTimeMetrics.logsInQueue}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={3}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Active Fixes
                </Typography>
                <Typography variant="h6">
                  {realTimeMetrics.activeFixes}
                </Typography>
              </Box>
            </Grid>
          </Grid>
          {realTimeMetrics.isCurrentlyRunning && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary">
                Processing... Started at {realTimeMetrics.currentRunStartTime?.toLocaleTimeString()}
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Monitoring Tabs */}
      <Paper sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={handleTabChange} aria-label="monitoring tabs">
            <Tab 
              icon={<Web />} 
              label="Web App" 
              {...a11yProps(0)} 
            />
            <Tab 
              icon={<PhoneIphone />} 
              label="Mobile App" 
              {...a11yProps(1)} 
            />
            <Tab 
              icon={<Cloud />} 
              label="Cloud Functions" 
              {...a11yProps(2)} 
            />
          </Tabs>
        </Box>

        {/* Web App Monitoring */}
        <TabPanel value={activeTab} index={0}>
          {/* Key Metrics */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <CheckCircle color="success" />
                    <Typography variant="body2" color="text.secondary">
                      Fix Success Rate
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {summary.overallSuccessRate ? `${(summary.overallSuccessRate * 100).toFixed(1)}%` : 'N/A'}
                  </Typography>
                  {trends.fixSuccessRate && (
                    <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
                      {trends.fixSuccessRate.trend === 'improving' ? (
                        <TrendingUp color="success" fontSize="small" />
                      ) : (
                        <TrendingDown color="error" fontSize="small" />
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {trends.fixSuccessRate.change > 0 ? '+' : ''}{(trends.fixSuccessRate.change * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <HealthAndSafety color="primary" />
                    <Typography variant="body2" color="text.secondary">
                      System Health
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {summary.averageHealthScore ? `${summary.averageHealthScore.toFixed(0)}%` : 'N/A'}
                  </Typography>
                  {trends.systemHealth && (
                    <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
                      {trends.systemHealth.trend === 'improving' ? (
                        <TrendingUp color="success" fontSize="small" />
                      ) : (
                        <TrendingDown color="error" fontSize="small" />
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {trends.systemHealth.change > 0 ? '+' : ''}{trends.systemHealth.change.toFixed(1)}%
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Speed color="info" />
                    <Typography variant="body2" color="text.secondary">
                      Avg Fix Time
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {trends.averageFixTime ? formatDuration(trends.averageFixTime.current) : 'N/A'}
                  </Typography>
                  {trends.averageFixTime && (
                    <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
                      {trends.averageFixTime.trend === 'improving' ? (
                        <TrendingUp color="success" fontSize="small" />
                      ) : (
                        <TrendingDown color="error" fontSize="small" />
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {trends.averageFixTime.change > 0 ? '+' : ''}{formatDuration(trends.averageFixTime.change)}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <BugReport color="warning" />
                    <Typography variant="body2" color="text.secondary">
                      Total Fixes
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {summary.totalFixes || 0}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {summary.totalSuccessful || 0} successful
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts and Detailed Metrics */}
          <Grid container spacing={3}>
            {/* Performance Trends */}
            <Grid item xs={12} lg={8}>
              <Paper sx={{ p: 3, height: 400 }}>
                <Typography variant="h6" gutterBottom>
                  Performance Trends
                </Typography>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                    />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(value) => new Date(value).toLocaleString()}
                      formatter={(value: any, name: string) => [
                        name === 'fixSuccessRate' ? `${(value * 100).toFixed(1)}%` : value,
                        name === 'fixSuccessRate' ? 'Success Rate' : name
                      ]}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="fixSuccessRate" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="healthScore" 
                      stroke="#82ca9d" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            {/* Error Distribution */}
            <Grid item xs={12} lg={4}>
              <Paper sx={{ p: 3, height: 400 }}>
                <Typography variant="h6" gutterBottom>
                  Error Distribution
                </Typography>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Successful', value: summary.totalSuccessful || 0, color: '#82ca9d' },
                        { name: 'Failed', value: (summary.totalFixes || 0) - (summary.totalSuccessful || 0), color: '#ff8042' },
                      ]}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                    >
                      {[
                        { name: 'Successful', value: summary.totalSuccessful || 0, color: '#82ca9d' },
                        { name: 'Failed', value: (summary.totalFixes || 0) - (summary.totalSuccessful || 0), color: '#ff8042' },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Total Fixes: {summary.totalFixes || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Success Rate: {summary.overallSuccessRate ? `${(summary.overallSuccessRate * 100).toFixed(1)}%` : 'N/A'}
                  </Typography>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Mobile App Monitoring */}
        <TabPanel value={activeTab} index={1}>
          {mobileStats && (
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={1}>
                      <PhoneIphone color="primary" />
                      <Typography variant="body2" color="text.secondary">
                        Total Errors
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ mt: 1 }}>
                      {mobileStats.totalErrors || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Error color="error" />
                      <Typography variant="body2" color="text.secondary">
                        Crashes
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ mt: 1 }}>
                      {mobileStats.crashes || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Warning color="warning" />
                      <Typography variant="body2" color="text.secondary">
                        Critical Errors
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ mt: 1 }}>
                      {mobileStats.criticalErrors || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CheckCircle color="success" />
                      <Typography variant="body2" color="text.secondary">
                        Auto-fixed
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ mt: 1 }}>
                      {mobileStats.autoFixed || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {/* Mobile Errors Table */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Recent Mobile App Errors
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Platform</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Error Message</TableCell>
                    <TableCell>User</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mobileErrors.map((error) => (
                    <TableRow key={error.id} hover>
                      <TableCell>
                        {new Date(error.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={error.platform} 
                          color={error.platform === 'ios' ? 'primary' : 'success'} 
                          size="small" 
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={error.errorType} 
                          variant="outlined" 
                          size="small" 
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={error.severity} 
                          color={getSeverityColor(error.severity)} 
                          size="small" 
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {error.errorMessage}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {error.userId}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </TabPanel>

        {/* Cloud Functions Monitoring */}
        <TabPanel value={activeTab} index={2}>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Cloud color="info" />
                    <Typography variant="body2" color="text.secondary">
                      Total Functions
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {cloudFunctionErrors.length + 50} {/* Mock total */}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Error color="error" />
                    <Typography variant="body2" color="text.secondary">
                    Function Errors
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {cloudFunctionErrors.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Speed color="warning" />
                    <Typography variant="body2" color="text.secondary">
                      Avg Execution
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {cloudFunctionErrors.length > 0 
                      ? formatDuration(cloudFunctionErrors.reduce((sum, e) => sum + e.executionTime, 0) / cloudFunctionErrors.length)
                      : 'N/A'
                    }
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1}>
                    <HealthAndSafety color="success" />
                    <Typography variant="body2" color="text.secondary">
                      Success Rate
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ mt: 1 }}>
                    {cloudFunctionErrors.length > 0 
                      ? `${((50 / (50 + cloudFunctionErrors.length)) * 100).toFixed(1)}%`
                      : '100%'
                    }
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Cloud Function Errors Table */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Cloud Function Errors
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Function</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Error Message</TableCell>
                    <TableCell>Execution Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cloudFunctionErrors.map((error) => (
                    <TableRow key={error.id} hover>
                      <TableCell>
                        {new Date(error.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {error.functionName}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={error.errorType} 
                          variant="outlined" 
                          size="small" 
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={error.severity} 
                          color={getSeverityColor(error.severity)} 
                          size="small" 
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {error.errorMessage}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {formatDuration(error.executionTime)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </TabPanel>
      </Paper>

      {/* Alerts - Show across all tabs */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6">
            Recent Alerts
          </Typography>
          <Chip 
            label={`${alerts.filter(a => !a.resolved).length} Active`} 
            color="warning" 
            size="small" 
          />
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {alerts.slice(0, 10).map((alert) => (
                <TableRow key={alert.id} hover>
                  <TableCell>
                    {new Date(alert.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={alert.severity} 
                      color={getSeverityColor(alert.severity)} 
                      size="small" 
                    />
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={alert.type} 
                      variant="outlined" 
                      size="small" 
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ cursor: 'pointer' }} onClick={() => handleAlertClick(alert)}>
                      {alert.title}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={alert.resolved ? 'Resolved' : 'Active'} 
                      color={alert.resolved ? 'success' : 'warning'} 
                      size="small" 
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton 
                      size="small" 
                      onClick={() => handleAlertClick(alert)}
                    >
                      <Info />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Alert Details Dialog */}
      <Dialog 
        open={alertDialogOpen} 
        onClose={() => setAlertDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Alert Details
        </DialogTitle>
        <DialogContent>
          {selectedAlert && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedAlert.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                {selectedAlert.description}
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Severity
                  </Typography>
                  <Chip 
                    label={selectedAlert.severity} 
                    color={getSeverityColor(selectedAlert.severity)} 
                    size="small" 
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Type
                  </Typography>
                  <Chip 
                    label={selectedAlert.type} 
                    variant="outlined" 
                    size="small" 
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Created
                  </Typography>
                  <Typography variant="body2">
                    {new Date(selectedAlert.timestamp).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip 
                    label={selectedAlert.resolved ? 'Resolved' : 'Active'} 
                    color={selectedAlert.resolved ? 'success' : 'warning'} 
                    size="small" 
                  />
                </Grid>
              </Grid>
              {selectedAlert.resolved && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    Resolved by {selectedAlert.resolvedBy} on {selectedAlert.resolvedAt?.toLocaleString()}
                  </Typography>
                  {selectedAlert.actionTaken && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Action taken: {selectedAlert.actionTaken}
                    </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {selectedAlert && !selectedAlert.resolved && (
            <Button 
              variant="contained" 
              color="success"
              onClick={() => handleResolveAlert(selectedAlert.id)}
            >
              Mark as Resolved
            </Button>
          )}
          <Button onClick={() => setAlertDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AutoDevOpsMonitoring; 