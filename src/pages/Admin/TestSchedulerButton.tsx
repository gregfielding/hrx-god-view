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
  CircularProgress,
  TextField,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Tabs,
  Tab,
} from '@mui/material';
import {
  PlayArrow as PlayArrowIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Visibility as VisibilityIcon,
  Timeline as TimelineIcon,
  Compare as CompareIcon,
  PlaylistPlay as PlaylistPlayIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../firebase';

interface TestScenario {
  id: string;
  name: string;
  description: string;
  trigger: string;
  userContext: any;
  tenantId: string;
  expectedOutput: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: {
    success: boolean;
    modulesEngaged: string[];
    contextUsed: any[];
    finalPrompt: string;
    aiResponse: string;
    confidenceScore: number;
    latencyMs: number;
    actualOutput: string;
    consistencyScore?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface ConsistencyTest {
  id: string;
  promptId: string;
  testCount: number;
  consistent: boolean;
  consistencyScore: number;
  responseConsistency: number;
  latencyConsistency: number;
  uniqueResponses: number;
  avgLatency: number;
  createdAt: Date;
}

const TestSchedulerButton: React.FC = (): JSX.Element => {
  const [scenarios, setScenarios] = useState<TestScenario[]>([]);
  const [consistencyTests, setConsistencyTests] = useState<ConsistencyTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [scenarioDialog, setScenarioDialog] = useState(false);
  const [consistencyDialog, setConsistencyDialog] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(null);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [newScenario, setNewScenario] = useState({
    name: '',
    description: '',
    trigger: '',
    userContext: '',
    tenantId: '',
    expectedOutput: '',
  });
  const [consistencyPromptId, setConsistencyPromptId] = useState('');
  const navigate = useNavigate();

  // Mock data for demonstration
  const mockScenarios: TestScenario[] = [
    {
      id: 'scenario1',
      name: 'Feedback Response Test',
      description: 'Test AI response to worker feedback submission',
      trigger: 'Worker submits feedback about workplace safety',
      userContext: { role: 'worker', department: 'manufacturing', experience: '2 years' },
      tenantId: 'customer1',
      expectedOutput: 'Empathetic response acknowledging safety concerns',
      status: 'completed',
      result: {
        success: true,
        modulesEngaged: ['FeedbackEngine', 'TraitsEngine', 'ContextEngine'],
        contextUsed: [
          { type: 'user_profile', content: 'Worker profile data' },
          { type: 'safety_policy', content: 'Safety protocols' },
        ],
        finalPrompt: 'Based on the context, respond to worker safety feedback...',
        aiResponse: 'Thank you for bringing this safety concern to our attention...',
        confidenceScore: 0.92,
        latencyMs: 1450,
        actualOutput: 'Empathetic response acknowledging safety concerns',
      },
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
    {
      id: 'scenario2',
      name: 'Moment Trigger Test',
      description: 'Test AI moment scheduling and execution',
      trigger: 'Worker completes shift with overtime',
      userContext: { role: 'worker', shiftType: 'overtime', hours: 12 },
      tenantId: 'customer1',
      expectedOutput: 'Recognition moment for overtime completion',
      status: 'pending',
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  ];

  const mockConsistencyTests: ConsistencyTest[] = [
    {
      id: 'consistency1',
      promptId: 'feedback_response',
      testCount: 10,
      consistent: true,
      consistencyScore: 0.95,
      responseConsistency: 1.0,
      latencyConsistency: 0.9,
      uniqueResponses: 1,
      avgLatency: 1420,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    {
      id: 'consistency2',
      promptId: 'moment_trigger',
      testCount: 8,
      consistent: false,
      consistencyScore: 0.65,
      responseConsistency: 0.5,
      latencyConsistency: 0.8,
      uniqueResponses: 4,
      avgLatency: 1850,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  ];

  useEffect(() => {
    setScenarios(mockScenarios);
    setConsistencyTests(mockConsistencyTests);
  }, []);

  const handleCreateScenario = () => {
    setNewScenario({
      name: '',
      description: '',
      trigger: '',
      userContext: '',
      tenantId: '',
      expectedOutput: '',
    });
    setScenarioDialog(true);
  };

  const handleSaveScenario = async () => {
    try {
      const functions = getFunctions(app);
      const simulateOrchestrationScenario = httpsCallable(
        functions,
        'simulateOrchestrationScenario',
      );

      const config = {
        trigger: newScenario.trigger,
        userContext: JSON.parse(newScenario.userContext || '{}'),
        tenantId: newScenario.tenantId,
        expectedOutput: newScenario.expectedOutput,
      };

      const result = await simulateOrchestrationScenario({ config, userId: 'current_user' });
      const data = result.data as any;

      const scenario: TestScenario = {
        id: data.scenarioId,
        name: newScenario.name,
        description: newScenario.description,
        trigger: newScenario.trigger,
        userContext: JSON.parse(newScenario.userContext || '{}'),
        tenantId: newScenario.tenantId,
        expectedOutput: newScenario.expectedOutput,
        status: 'completed',
        result: data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      setScenarios((prev) => [scenario, ...prev]);
      setScenarioDialog(false);
      setSuccess('Scenario created and executed successfully');
    } catch (err: any) {
      setError('Failed to create scenario');
    }
  };

  const handleRunScenario = async (scenarioId: string) => {
    setRunningScenario(scenarioId);
    try {
      const functions = getFunctions(app);
      const simulateOrchestrationScenario = httpsCallable(
        functions,
        'simulateOrchestrationScenario',
      );

      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;

      const config = {
        trigger: scenario.trigger,
        userContext: scenario.userContext,
        tenantId: scenario.tenantId,
        expectedOutput: scenario.expectedOutput,
      };

      const result = await simulateOrchestrationScenario({ config, userId: 'current_user' });
      const data = result.data as any;

      setScenarios((prev) =>
        prev.map((s) =>
          s.id === scenarioId
            ? {
                ...s,
                status: 'completed',
                result: data,
                updatedAt: new Date(),
              }
            : s,
        ),
      );

      setSuccess('Scenario executed successfully');
    } catch (err: any) {
      setError('Failed to run scenario');
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === scenarioId ? { ...s, status: 'failed', updatedAt: new Date() } : s,
        ),
      );
    } finally {
      setRunningScenario(null);
    }
  };

  const handleTestConsistency = async () => {
    if (!consistencyPromptId.trim()) {
      setError('Please enter a prompt ID');
      return;
    }

    try {
      const functions = getFunctions(app);
      const validatePromptConsistency = httpsCallable(functions, 'validatePromptConsistency');

      const result = await validatePromptConsistency({
        promptId: consistencyPromptId,
        userId: 'current_user',
      });
      const data = result.data as any;

      const consistencyTest: ConsistencyTest = {
        id: `consistency_${Date.now()}`,
        promptId: consistencyPromptId,
        testCount: data.totalChecks,
        consistent: data.consistent,
        consistencyScore: data.consistencyScore,
        responseConsistency: data.responseConsistency,
        latencyConsistency: data.latencyConsistency,
        uniqueResponses: data.uniqueResponses,
        avgLatency: data.avgLatency,
        createdAt: new Date(),
      };

      setConsistencyTests((prev) => [consistencyTest, ...prev]);
      setConsistencyDialog(false);
      setConsistencyPromptId('');
      setSuccess('Consistency test completed');
    } catch (err: any) {
      setError('Failed to test consistency');
    }
  };

  const handleViewScenario = (scenario: TestScenario) => {
    setSelectedScenario(scenario);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
      completed: 'success',
      running: 'warning',
      failed: 'error',
      pending: 'default',
    };
    return colors[status] || 'default';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon />;
      case 'running':
        return <CircularProgress size={20} />;
      case 'failed':
        return <ErrorIcon />;
      case 'pending':
        return <WarningIcon />;
      default:
        return <WarningIcon />;
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const truncateText = (text: string, maxLength = 100) => {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Integration Testing Framework
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Test full prompt flows, validate consistency, and simulate orchestration scenarios
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
                <PlaylistPlayIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">{scenarios.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Total Scenarios
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CheckCircleIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">
                  {scenarios.filter((s) => s.status === 'completed').length}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Completed Tests
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CompareIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">{consistencyTests.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Consistency Tests
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TimelineIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">
                  {consistencyTests.filter((t) => t.consistent).length}/{consistencyTests.length}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Consistent Prompts
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Content */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
            <Tab label="Test Scenarios" />
            <Tab label="Consistency Tests" />
            <Tab label="Test Results" />
          </Tabs>
        </Box>

        {/* Test Scenarios Tab */}
        {activeTab === 0 && (
          <Box>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Orchestration Test Scenarios</Typography>
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={handleCreateScenario}
              >
                Create Scenario
              </Button>
            </Box>

            <Grid container spacing={3}>
              {scenarios.map((scenario) => (
                <Grid item xs={12} md={6} key={scenario.id}>
                  <Card sx={{ height: '100%' }}>
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
                            {scenario.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {scenario.description}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title="View Details">
                            <IconButton size="small" onClick={() => handleViewScenario(scenario)}>
                              <VisibilityIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Run Scenario">
                            <IconButton
                              size="small"
                              onClick={() => handleRunScenario(scenario.id)}
                              disabled={runningScenario === scenario.id}
                            >
                              {runningScenario === scenario.id ? (
                                <CircularProgress size={20} />
                              ) : (
                                <PlayArrowIcon />
                              )}
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Chip
                          icon={getStatusIcon(scenario.status)}
                          label={scenario.status}
                          color={getStatusColor(scenario.status)}
                          size="small"
                        />
                        <Chip label={scenario.tenantId} variant="outlined" size="small" />
                        {scenario.result && (
                          <Chip
                            label={`${scenario.result.confidenceScore.toFixed(2)} confidence`}
                            color={scenario.result.confidenceScore > 0.8 ? 'success' : 'warning'}
                            size="small"
                          />
                        )}
                      </Box>

                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Trigger: {truncateText(scenario.trigger)}
                      </Typography>

                      {scenario.result && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="body2" color="text.secondary">
                            Modules: {scenario.result.modulesEngaged.join(', ')}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Latency: {scenario.result.latencyMs}ms
                          </Typography>
                        </Box>
                      )}

                      <Typography variant="caption" color="text.secondary">
                        Created: {formatDate(scenario.createdAt)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* Consistency Tests Tab */}
        {activeTab === 1 && (
          <Box>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
            >
              <Typography variant="h6">Prompt Consistency Tests</Typography>
              <Button
                variant="contained"
                startIcon={<CompareIcon />}
                onClick={() => setConsistencyDialog(true)}
              >
                Test Consistency
              </Button>
            </Box>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Prompt ID</TableCell>
                    <TableCell>Test Count</TableCell>
                    <TableCell>Consistency</TableCell>
                    <TableCell>Score</TableCell>
                    <TableCell>Unique Responses</TableCell>
                    <TableCell>Avg Latency</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {consistencyTests.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {test.promptId}
                        </Typography>
                      </TableCell>
                      <TableCell>{test.testCount}</TableCell>
                      <TableCell>
                        <Chip
                          icon={test.consistent ? <CheckCircleIcon /> : <ErrorIcon />}
                          label={test.consistent ? 'Consistent' : 'Inconsistent'}
                          color={test.consistent ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={test.consistencyScore > 0.8 ? 'success.main' : 'text.secondary'}
                        >
                          {test.consistencyScore.toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell>{test.uniqueResponses}</TableCell>
                      <TableCell>{test.avgLatency}ms</TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatDate(test.createdAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Test Results Tab */}
        {activeTab === 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Test Results & Analytics
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Success Rate
                    </Typography>
                    <Typography variant="h4" color="success.main">
                      {scenarios.length > 0
                        ? Math.round(
                            (scenarios.filter((s) => s.status === 'completed').length /
                              scenarios.length) *
                              100,
                          )
                        : 0}
                      %
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {scenarios.filter((s) => s.status === 'completed').length} of{' '}
                      {scenarios.length} scenarios passed
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Average Latency
                    </Typography>
                    <Typography variant="h4" color="primary.main">
                      {scenarios.length > 0
                        ? Math.round(
                            scenarios
                              .filter((s) => s.result)
                              .reduce((sum, s) => sum + (s.result?.latencyMs || 0), 0) /
                              scenarios.filter((s) => s.result).length,
                          )
                        : 0}
                      ms
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Across all completed scenarios
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        )}
      </Paper>

      {/* Create Scenario Dialog */}
      <Dialog
        open={scenarioDialog}
        onClose={() => setScenarioDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Create Test Scenario</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Scenario Name"
                value={newScenario.name}
                onChange={(e) => setNewScenario((prev) => ({ ...prev, name: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Description"
                value={newScenario.description}
                onChange={(e) =>
                  setNewScenario((prev) => ({ ...prev, description: e.target.value }))
                }
                fullWidth
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Trigger"
                value={newScenario.trigger}
                onChange={(e) => setNewScenario((prev) => ({ ...prev, trigger: e.target.value }))}
                fullWidth
                multiline
                rows={2}
                required
                helperText="Describe what triggers this scenario (e.g., 'Worker submits feedback')"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="User Context (JSON)"
                value={newScenario.userContext}
                onChange={(e) =>
                  setNewScenario((prev) => ({ ...prev, userContext: e.target.value }))
                }
                fullWidth
                multiline
                rows={3}
                helperText="Enter user context as JSON (e.g., {'role': 'worker', 'department': 'manufacturing'})"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Customer ID"
                value={newScenario.tenantId}
                onChange={(e) =>
                  setNewScenario((prev) => ({ ...prev, tenantId: e.target.value }))
                }
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Expected Output"
                value={newScenario.expectedOutput}
                onChange={(e) =>
                  setNewScenario((prev) => ({ ...prev, expectedOutput: e.target.value }))
                }
                fullWidth
                required
                helperText="Brief description of expected AI response"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScenarioDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveScenario} variant="contained">
            Create & Run
          </Button>
        </DialogActions>
      </Dialog>

      {/* Consistency Test Dialog */}
      <Dialog open={consistencyDialog} onClose={() => setConsistencyDialog(false)}>
        <DialogTitle>Test Prompt Consistency</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              label="Prompt ID"
              value={consistencyPromptId}
              onChange={(e) => setConsistencyPromptId(e.target.value)}
              fullWidth
              required
              helperText="Enter the prompt ID to test for consistency"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConsistencyDialog(false)}>Cancel</Button>
          <Button onClick={handleTestConsistency} variant="contained">
            Test Consistency
          </Button>
        </DialogActions>
      </Dialog>

      {/* Scenario Details Dialog */}
      <Dialog
        open={!!selectedScenario}
        onClose={() => setSelectedScenario(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>{selectedScenario?.name} - Scenario Details</DialogTitle>
        <DialogContent>
          {selectedScenario && (
            <Box>
              <Typography variant="body1" sx={{ mb: 3 }}>
                {selectedScenario.description}
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Scenario Info
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText primary="Trigger" secondary={selectedScenario.trigger} />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Customer ID"
                            secondary={selectedScenario.tenantId}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Expected Output"
                            secondary={selectedScenario.expectedOutput}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Status"
                            secondary={
                              <Chip
                                icon={getStatusIcon(selectedScenario.status)}
                                label={selectedScenario.status}
                                color={getStatusColor(selectedScenario.status)}
                                size="small"
                              />
                            }
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>

                {selectedScenario.result && (
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Test Results
                        </Typography>
                        <List dense>
                          <ListItem>
                            <ListItemText
                              primary="Success"
                              secondary={selectedScenario.result.success ? 'Yes' : 'No'}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemText
                              primary="Confidence Score"
                              secondary={selectedScenario.result.confidenceScore.toFixed(3)}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemText
                              primary="Latency"
                              secondary={`${selectedScenario.result.latencyMs}ms`}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemText
                              primary="Modules Engaged"
                              secondary={selectedScenario.result.modulesEngaged.join(', ')}
                            />
                          </ListItem>
                        </List>
                      </CardContent>
                    </Card>
                  </Grid>
                )}
              </Grid>

              {selectedScenario.result && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    AI Response
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2">{selectedScenario.result.aiResponse}</Typography>
                  </Paper>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedScenario(null)}>Close</Button>
          {selectedScenario && selectedScenario.status !== 'running' && (
            <Button
              onClick={() => {
                handleRunScenario(selectedScenario.id);
                setSelectedScenario(null);
              }}
              variant="contained"
              startIcon={<PlayArrowIcon />}
            >
              Re-run Scenario
            </Button>
          )}
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

export default TestSchedulerButton;
