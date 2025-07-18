import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  LinearProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Grid,
  IconButton,
  Tooltip,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Visibility,
  CheckCircle,
  Error,
  Warning,
  Info,
  ExpandMore,
  Timeline,
  Code,
  Security,
  Speed,
  BugReport,
  CloudUpload,
  Monitor,
  Restore
} from '@mui/icons-material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface PipelineStatus {
  isRunning: boolean;
  currentStage: string;
  progress: number;
  lastUpdate: Date;
  errors: string[];
  warnings: string[];
}

interface DeploymentFix {
  id: string;
  issueType: 'performance' | 'error' | 'security' | 'optimization';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  status: 'generated' | 'reviewed' | 'deployed' | 'monitoring' | 'completed' | 'rolled-back' | 'rollback-failed';
  confidence: number;
  createdAt: Date;
  deploymentId?: string;
  affectedFiles: string[];
  changes: any[];
}

interface PipelineMetrics {
  totalDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;
  averageDeploymentTime: number;
  rollbackRate: number;
  lastDeployment: Date;
}

const AutoDevOpsPipeline: React.FC = () => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({
    isRunning: false,
    currentStage: 'idle',
    progress: 0,
    lastUpdate: new Date(),
    errors: [],
    warnings: []
  });
  
  const [fixes, setFixes] = useState<DeploymentFix[]>([]);
  const [metrics, setMetrics] = useState<PipelineMetrics>({
    totalDeployments: 0,
    successfulDeployments: 0,
    failedDeployments: 0,
    averageDeploymentTime: 0,
    rollbackRate: 0,
    lastDeployment: new Date()
  });
  
  const [selectedFix, setSelectedFix] = useState<DeploymentFix | null>(null);
  const [fixDetailsOpen, setFixDetailsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Load data on component mount
  useEffect(() => {
    loadPipelineData();
    const interval = setInterval(loadPipelineData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadPipelineData = async () => {
    try {
      setIsLoading(true);
      
      // Load fixes using Firebase Functions SDK
      const getFixes = httpsCallable(functions, 'getAutoDevFixes');
      const fixesResult = await getFixes({ limit: 20 });
      const result = fixesResult.data as any;
      if (result.success) {
        setFixes(result.fixes);
      }
      
      // Load real deployment metrics from backend
      const getLatestMetrics = httpsCallable(functions, 'getLatestAutoDevOpsMetrics');
      const metricsResult = await getLatestMetrics();
      const metricsData = (metricsResult.data as any)?.metrics;
      if (metricsData) {
        setMetrics({
          totalDeployments: metricsData.totalFixAttempts || 0,
          successfulDeployments: metricsData.successfulFixes || 0,
          failedDeployments: metricsData.failedFixes || 0,
          averageDeploymentTime: metricsData.averageFixTimeMs ? Math.round(metricsData.averageFixTimeMs / 60000) : 0, // ms to min
          rollbackRate: metricsData.rollbackRate || 0,
          lastDeployment: metricsData.timestamp ? new Date(metricsData.timestamp) : new Date(),
        });
      }
    } catch (error) {
      console.error('Error loading pipeline data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startPipeline = async () => {
    try {
      setIsLoading(true);
      setPipelineStatus(prev => ({
        ...prev,
        isRunning: true,
        currentStage: 'analyzing',
        progress: 10
      }));
      
      // Simulate pipeline stages
      const stages = [
        { name: 'analyzing', progress: 20 },
        { name: 'generating_fixes', progress: 40 },
        { name: 'testing', progress: 60 },
        { name: 'deploying_staging', progress: 80 },
        { name: 'monitoring', progress: 90 },
        { name: 'completed', progress: 100 }
      ];
      
      for (const stage of stages) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        setPipelineStatus(prev => ({
          ...prev,
          currentStage: stage.name,
          progress: stage.progress,
          lastUpdate: new Date()
        }));
      }
      
      setPipelineStatus(prev => ({
        ...prev,
        isRunning: false,
        currentStage: 'completed'
      }));
      
      loadPipelineData(); // Refresh data
      
    } catch (error) {
      console.error('Error starting pipeline:', error);
      setPipelineStatus(prev => ({
        ...prev,
        isRunning: false,
        currentStage: 'error',
        errors: [...prev.errors, 'Failed to start pipeline']
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const stopPipeline = () => {
    setPipelineStatus(prev => ({
      ...prev,
      isRunning: false,
      currentStage: 'stopped'
    }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'deployed': return 'success';
      case 'monitoring': return 'info';
      case 'reviewed': return 'warning';
      case 'generated': return 'default';
      case 'rolled-back': return 'error';
      case 'rollback-failed': return 'error';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle />;
      case 'deployed': return <CloudUpload />;
      case 'monitoring': return <Monitor />;
      case 'reviewed': return <Visibility />;
      case 'generated': return <Code />;
      case 'rolled-back': return <Restore />;
      case 'rollback-failed': return <Error />;
      default: return <Info />;
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

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
        AutoDevOps Pipeline
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
      
      {/* Pipeline Status Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Pipeline Status: {pipelineStatus.currentStage.replace('_', ' ').toUpperCase()}
            </Typography>
            <Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<PlayArrow />}
                onClick={startPipeline}
                disabled={pipelineStatus.isRunning || isLoading}
                sx={{ mr: 1 }}
              >
                Start Pipeline
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<Stop />}
                onClick={stopPipeline}
                disabled={!pipelineStatus.isRunning}
                sx={{ mr: 1 }}
              >
                Stop Pipeline
              </Button>
              <IconButton onClick={loadPipelineData} disabled={isLoading}>
                <Refresh />
              </IconButton>
            </Box>
          </Box>
          
          {pipelineStatus.isRunning && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress 
                variant="determinate" 
                value={pipelineStatus.progress} 
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Typography variant="body2" sx={{ mt: 1 }}>
                Progress: {pipelineStatus.progress}%
              </Typography>
            </Box>
          )}
          
          {pipelineStatus.errors.length > 0 && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {pipelineStatus.errors[pipelineStatus.errors.length - 1]}
            </Alert>
          )}
          
          {pipelineStatus.warnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {pipelineStatus.warnings[pipelineStatus.warnings.length - 1]}
            </Alert>
          )}
          
          <Typography variant="body2" color="text.secondary">
            Last Update: {pipelineStatus.lastUpdate.toLocaleString()}
          </Typography>
        </CardContent>
      </Card>

      {/* Metrics Grid */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Deployments
              </Typography>
              <Typography variant="h4">
                {metrics.totalDeployments}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Success Rate
              </Typography>
              <Typography variant="h4" color="success.main">
                {((metrics.successfulDeployments / metrics.totalDeployments) * 100).toFixed(1)}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Avg Deployment Time
              </Typography>
              <Typography variant="h4">
                {formatDuration(metrics.averageDeploymentTime)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Rollback Rate
              </Typography>
              <Typography variant="h4" color="warning.main">
                {(metrics.rollbackRate * 100).toFixed(1)}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Recent Fixes Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Auto-Generated Fixes
          </Typography>
          
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Issue Type</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Confidence</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fixes.map((fix) => (
                  <TableRow key={fix.id}>
                    <TableCell>
                      <Chip 
                        icon={<BugReport />}
                        label={fix.issueType}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {fix.description}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={fix.severity}
                        size="small"
                        color={getSeverityColor(fix.severity)}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        icon={getStatusIcon(fix.status)}
                        label={fix.status.replace('-', ' ')}
                        size="small"
                        color={getStatusColor(fix.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <CircularProgress 
                          variant="determinate" 
                          value={fix.confidence * 100} 
                          size={20}
                          sx={{ mr: 1 }}
                        />
                        <Typography variant="body2">
                          {(fix.confidence * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(fix.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title="View Details">
                        <IconButton 
                          size="small"
                          onClick={() => {
                            setSelectedFix(fix);
                            setFixDetailsOpen(true);
                          }}
                        >
                          <Visibility />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Fix Details Dialog */}
      <Dialog 
        open={fixDetailsOpen} 
        onClose={() => setFixDetailsOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Fix Details: {selectedFix?.description}
        </DialogTitle>
        <DialogContent>
          {selectedFix && (
            <Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Issue Type</Typography>
                  <Typography variant="body2">{selectedFix.issueType}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Severity</Typography>
                  <Chip 
                    label={selectedFix.severity}
                    color={getSeverityColor(selectedFix.severity)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Status</Typography>
                  <Chip 
                    icon={getStatusIcon(selectedFix.status)}
                    label={selectedFix.status.replace('-', ' ')}
                    color={getStatusColor(selectedFix.status)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Confidence</Typography>
                  <Typography variant="body2">{(selectedFix.confidence * 100).toFixed(1)}%</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2">Description</Typography>
                  <Typography variant="body2">{selectedFix.description}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2">Affected Files</Typography>
                  <List dense>
                    {selectedFix.affectedFiles.map((file, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={file} />
                      </ListItem>
                    ))}
                  </List>
                </Grid>
                {selectedFix.deploymentId && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Deployment ID</Typography>
                    <Typography variant="body2" fontFamily="monospace">
                      {selectedFix.deploymentId}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFixDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AutoDevOpsPipeline; 