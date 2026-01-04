import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
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
  Card,
  CardContent,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as VisibilityIcon,
  Download as DownloadIcon,
  ArrowBack as ArrowBackIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Speed as SpeedIcon,
  Psychology as PsychologyIcon,
  Replay as ReplayIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../firebase';

interface AILog {
  id: string;
  timestamp: Date;
  userId: string;
  actionType: string;
  sourceModule: string;
  inputPrompt?: string;
  composedPrompt?: string;
  aiResponse?: string;
  success: boolean;
  errorMessage?: string;
  latencyMs?: number;
  versionTag?: string;
  scenarioContext?: string;
  tenantId?: string;
  globalContextUsed?: any;
  scenarioContextUsed?: any;
  customerContextUsed?: any;
  weightsApplied?: any;
  traitsActive?: any;
  vectorChunksUsed?: any;
  vectorSimilarityScores?: any;
  dryRun?: boolean;
  manualOverride?: boolean;
  feedbackGiven?: any;
  reason?: string;
  // New schema fields
  eventType?: string;
  targetType?: string;
  targetId?: string;
  aiRelevant?: boolean;
  contextType?: string;
  traitsAffected?: any;
  aiTags?: any;
  urgencyScore?: number;
  // Processing status fields
  processed?: boolean;
  engineTouched?: string[];
  processingResults?: any[];
  errors?: string[];
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  reprocessedAt?: Date;
}

interface LogStats {
  totalLogs: number;
  successRate: number;
  avgLatency: number;
  topModules: Array<{ module: string; count: number }>;
  recentErrors: number;
  activeUsers: number;
}

const AILogs: React.FC = () => {
  const [logs, setLogs] = useState<AILog[]>([]);
  const [stats, setStats] = useState<LogStats>({
    totalLogs: 0,
    successRate: 0,
    avgLatency: 0,
    topModules: [],
    recentErrors: 0,
    activeUsers: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [detailsDialog, setDetailsDialog] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AILog | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filters, setFilters] = useState({
    module: '',
    outcome: '',
    userId: '',
    startDate: '',
    endDate: '',
    actionType: '',
    // New filter fields
    engineTouched: '',
    aiRelevant: '',
    errorStatus: '',
    eventType: '',
    contextType: '',
    urgencyScore: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const listLogs = httpsCallable(functions, 'listAILogs');
      const res: any = await listLogs({
        limit: 100,
        ...filters,
      });

      // Use real backend data
      const fetchedLogs = (res?.data?.logs || []).map((log: any): AILog => {
        let date: Date;
        if (log.timestamp && log.timestamp.toDate) {
          date = log.timestamp.toDate();
        } else if (log.timestamp && typeof log.timestamp === 'string' && !isNaN(Date.parse(log.timestamp))) {
          date = new Date(log.timestamp);
        } else if (log.timestampIso && !isNaN(Date.parse(log.timestampIso))) {
          date = new Date(log.timestampIso);
        } else {
          date = new Date(); // fallback to now
        }
        return {
          ...log,
          timestamp: date,
        };
      });

      setLogs(fetchedLogs);

      // Calculate stats
      const totalLogs = fetchedLogs.length;
      const successCount = fetchedLogs.filter((log: AILog) => log.success).length;
      const successRate = totalLogs > 0 ? (successCount / totalLogs) * 100 : 0;
      const avgLatency =
        fetchedLogs.reduce((sum: number, log: AILog) => sum + (log.latencyMs || 0), 0) / (fetchedLogs.length || 1);

      const moduleCounts = fetchedLogs.reduce((acc: Record<string, number>, log: AILog) => {
        acc[log.sourceModule] = (acc[log.sourceModule] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const topModules = Object.entries(moduleCounts)
        .map(([module, count]) => ({ module, count: count as number }))
        .sort((a, b) => (b.count as number) - (a.count as number))
        .slice(0, 5);

      const recentErrors = fetchedLogs.filter((log: AILog) => !log.success).length;
      const activeUsers = new Set(fetchedLogs.map((log: AILog) => log.userId)).size;

      setStats({
        totalLogs,
        successRate,
        avgLatency: Math.round(avgLatency),
        topModules,
        recentErrors,
        activeUsers,
      });
    } catch (err: any) {
      setError('Failed to fetch AI logs');
    }
    setLoading(false);
  };

  const handleViewDetails = (log: AILog) => {
    setSelectedLog(log);
    setDetailsDialog(true);
  };

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleApplyFilters = () => {
    fetchLogs();
  };

  const handleClearFilters = () => {
    setFilters({
      module: '',
      outcome: '',
      userId: '',
      startDate: '',
      endDate: '',
      actionType: '',
      // New filter fields
      engineTouched: '',
      aiRelevant: '',
      errorStatus: '',
      eventType: '',
      contextType: '',
      urgencyScore: '',
    });
    setSearchTerm('');
  };

  const handleReprocessLog = async (logId: string) => {
    try {
      setLoading(true);
      const functions = getFunctions(app);
      const reprocessLog = httpsCallable(functions, 'reprocessTestLog');

      await reprocessLog({ logId });
      setSuccess('Log reprocessed successfully');
      fetchLogs(); // Refresh the logs
    } catch (error: any) {
      setError(`Failed to reprocess log: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        log.actionType.toLowerCase().includes(searchLower) ||
        log.sourceModule.toLowerCase().includes(searchLower) ||
        log.reason?.toLowerCase().includes(searchLower) ||
        log.userId.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const paginatedLogs = filteredLogs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getStatusColor = (success: boolean) => {
    return success ? 'success' : 'error';
  };

  const getStatusIcon = (success: boolean) => {
    return success ? <CheckCircleIcon /> : <ErrorIcon />;
  };

  const getModuleColor = (module: string) => {
    const colors: Record<
      string,
      'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'default'
    > = {
      FeedbackEngine: 'primary',
      MomentsEngine: 'secondary',
      CustomerToneOverrides: 'success',
      ContextEngine: 'warning',
      WeightsEngine: 'error',
    };
    return colors[module] || 'default';
  };

  const formatLatency = (latency?: number) => {
    if (!latency) return '-';
    return `${latency}ms`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const truncateText = (text: string, maxLength = 50) => {
    if (!text) return '-';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0 }}>
        <Typography variant="h3">
          AI Logs
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
        Comprehensive logging and analysis of all AI interactions with detailed context and
        performance metrics.
      </Typography>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PsychologyIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.totalLogs.toLocaleString()}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Total Logs
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TrendingUpIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.successRate.toFixed(1)}%</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Success Rate
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <SpeedIcon color="secondary" sx={{ mr: 1 }} />
                <Typography variant="h6">{formatLatency(stats.avgLatency)}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Avg Latency
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <ErrorIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.recentErrors}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Recent Errors
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <InfoIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.activeUsers}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Active Users
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TrendingDownIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.topModules[0]?.count || 0}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Top Module
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Filters & Search
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={2}>
            <TextField
              label="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              fullWidth
              size="small"
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Module</InputLabel>
              <Select
                value={filters.module}
                label="Module"
                onChange={(e) => handleFilterChange('module', e.target.value)}
              >
                <MenuItem value="">All Modules</MenuItem>
                <MenuItem value="FeedbackEngine">Feedback Engine</MenuItem>
                <MenuItem value="MomentsEngine">Moments Engine</MenuItem>
                <MenuItem value="CustomerToneOverrides">Customer Tone</MenuItem>
                <MenuItem value="ContextEngine">Context Engine</MenuItem>
                <MenuItem value="WeightsEngine">Weights Engine</MenuItem>
                <MenuItem value="TraitsEngine">Traits Engine</MenuItem>
                <MenuItem value="VectorEngine">Vector Engine</MenuItem>
                <MenuItem value="PriorityEngine">Priority Engine</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Outcome</InputLabel>
              <Select
                value={filters.outcome}
                label="Outcome"
                onChange={(e) => handleFilterChange('outcome', e.target.value)}
              >
                <MenuItem value="">All Outcomes</MenuItem>
                <MenuItem value="success">Success</MenuItem>
                <MenuItem value="error">Error</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Engine Touched</InputLabel>
              <Select
                value={filters.engineTouched}
                label="Engine Touched"
                onChange={(e) => handleFilterChange('engineTouched', e.target.value)}
              >
                <MenuItem value="">All Engines</MenuItem>
                <MenuItem value="ContextEngine">Context Engine</MenuItem>
                <MenuItem value="FeedbackEngine">Feedback Engine</MenuItem>
                <MenuItem value="MomentsEngine">Moments Engine</MenuItem>
                <MenuItem value="ToneEngine">Tone Engine</MenuItem>
                <MenuItem value="TraitsEngine">Traits Engine</MenuItem>
                <MenuItem value="WeightsEngine">Weights Engine</MenuItem>
                <MenuItem value="VectorEngine">Vector Engine</MenuItem>
                <MenuItem value="PriorityEngine">Priority Engine</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>AI Relevant</InputLabel>
              <Select
                value={filters.aiRelevant}
                label="AI Relevant"
                onChange={(e) => handleFilterChange('aiRelevant', e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="true">AI Relevant</MenuItem>
                <MenuItem value="false">Not AI Relevant</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Error Status</InputLabel>
              <Select
                value={filters.errorStatus}
                label="Error Status"
                onChange={(e) => handleFilterChange('errorStatus', e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="has_errors">Has Errors</MenuItem>
                <MenuItem value="no_errors">No Errors</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Grid container spacing={2} alignItems="center" sx={{ mt: 2 }}>
          <Grid item xs={12} md={2}>
            <TextField
              label="User ID"
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="Event Type"
              value={filters.eventType}
              onChange={(e) => handleFilterChange('eventType', e.target.value)}
              fullWidth
              size="small"
              placeholder="e.g., feedback.campaign.created"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Context Type</InputLabel>
              <Select
                value={filters.contextType}
                label="Context Type"
                onChange={(e) => handleFilterChange('contextType', e.target.value)}
              >
                <MenuItem value="">All Contexts</MenuItem>
                <MenuItem value="feedback">Feedback</MenuItem>
                <MenuItem value="moment">Moment</MenuItem>
                <MenuItem value="tone">Tone</MenuItem>
                <MenuItem value="traits">Traits</MenuItem>
                <MenuItem value="weights">Weights</MenuItem>
                <MenuItem value="vector">Vector</MenuItem>
                <MenuItem value="context">Context</MenuItem>
                <MenuItem value="priority">Priority</MenuItem>
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="retrieval">Retrieval</MenuItem>
                <MenuItem value="prompt">Prompt</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="Min Urgency Score"
              type="number"
              value={filters.urgencyScore}
              onChange={(e) => handleFilterChange('urgencyScore', e.target.value)}
              fullWidth
              size="small"
              inputProps={{ min: 1, max: 10 }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="Start Date"
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={<FilterIcon />}
                onClick={handleApplyFilters}
                size="small"
              >
                Apply
              </Button>
              <Button variant="outlined" onClick={handleClearFilters} size="small">
                Clear
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Logs Table */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">AI Logs ({filteredLogs.length} results)</Typography>
          <Box>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchLogs}
              disabled={loading}
              sx={{ mr: 1 }}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => setSuccess('Export functionality coming soon')}
            >
              Export
            </Button>
          </Box>
        </Box>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Event Type</TableCell>
                <TableCell>Module</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Processing</TableCell>
                <TableCell>Engines</TableCell>
                <TableCell>Urgency</TableCell>
                <TableCell>Latency</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <Typography color="text.secondary">
                      {loading ? 'Loading logs...' : 'No logs found'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {paginatedLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <Typography variant="body2">{formatDate(log.timestamp)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{log.userId}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{log.eventType || log.actionType}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={log.sourceModule}
                      size="small"
                      color={getModuleColor(log.sourceModule)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(log.success)}
                      label={log.success ? 'Success' : 'Error'}
                      size="small"
                      color={getStatusColor(log.success)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={log.processed ? <CheckCircleIcon /> : <SettingsIcon />}
                      label={log.processed ? 'Processed' : 'Pending'}
                      size="small"
                      color={log.processed ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {log.engineTouched?.slice(0, 2).map((engine: string) => (
                        <Chip
                          key={engine}
                          label={engine.replace('Engine', '')}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                      {log.engineTouched && log.engineTouched.length > 2 && (
                        <Typography variant="caption" color="text.secondary">
                          +{log.engineTouched.length - 2} more
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={log.urgencyScore || 'N/A'}
                      size="small"
                      color={log.urgencyScore && log.urgencyScore > 7 ? 'error' : 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{formatLatency(log.latencyMs)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="View Details">
                        <IconButton onClick={() => handleViewDetails(log)} size="small">
                          <VisibilityIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Reprocess Log">
                        <IconButton
                          onClick={() => handleReprocessLog(log.id)}
                          size="small"
                          color="secondary"
                          disabled={loading}
                        >
                          <ReplayIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={filteredLogs.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Paper>

      {/* Details Dialog */}
      <Dialog open={detailsDialog} onClose={() => setDetailsDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle>AI Log Details</DialogTitle>
        <DialogContent>
          {selectedLog && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" gutterBottom>
                  Basic Information
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Timestamp
                  </Typography>
                  <Typography variant="body1">{formatDate(selectedLog.timestamp)}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    User ID
                  </Typography>
                  <Typography variant="body1">{selectedLog.userId}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Action Type
                  </Typography>
                  <Typography variant="body1">{selectedLog.actionType}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Source Module
                  </Typography>
                  <Chip
                    label={selectedLog.sourceModule}
                    size="small"
                    color={getModuleColor(selectedLog.sourceModule)}
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    icon={getStatusIcon(selectedLog.success)}
                    label={selectedLog.success ? 'Success' : 'Error'}
                    size="small"
                    color={getStatusColor(selectedLog.success)}
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Latency
                  </Typography>
                  <Typography variant="body1">{formatLatency(selectedLog.latencyMs)}</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" gutterBottom>
                  Context Information
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Scenario Context
                  </Typography>
                  <Typography variant="body1">{selectedLog.scenarioContext || '-'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Customer ID
                  </Typography>
                  <Typography variant="body1">{selectedLog.tenantId || '-'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Version Tag
                  </Typography>
                  <Typography variant="body1">{selectedLog.versionTag || '-'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Dry Run
                  </Typography>
                  <Typography variant="body1">{selectedLog.dryRun ? 'Yes' : 'No'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Manual Override
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.manualOverride ? 'Yes' : 'No'}
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  Prompts & Responses
                </Typography>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Input Prompt</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                    >
                      {selectedLog.inputPrompt || 'No input prompt'}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Composed Prompt</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                    >
                      {selectedLog.composedPrompt || 'No composed prompt'}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>AI Response</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                    >
                      {selectedLog.aiResponse || 'No AI response'}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
                {selectedLog.errorMessage && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography color="error">Error Message</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography
                        variant="body2"
                        color="error"
                        sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                      >
                        {selectedLog.errorMessage}
                      </Typography>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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

export default AILogs;
