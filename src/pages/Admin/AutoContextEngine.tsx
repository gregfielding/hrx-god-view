import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Chip,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  ArrowBack as ArrowBackIcon,
  History as HistoryIcon,
  ContentCopy as ContentCopyIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { httpsCallable , getFunctions } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

const functions = getFunctions();


interface OrchestrationResult {
  finalPrompt: string;
  confidenceScore: number;
  escalationRisk: number;
  modulesEngaged: string[];
  walkthrough: string[];
  contextUsed: number;
  orchestrationId: string;
}

interface OrchestrationHistory {
  id: string;
  originalInput: string;
  finalPrompt: string;
  confidenceScore: number;
  escalationRisk: number;
  modulesEngaged: string[];
  walkthrough: string[];
  timestamp: any;
}

const AutoContextEngine: React.FC = () => {
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState('');
  const [tenantId, setCustomerId] = useState('');
  const [scenarioId, setScenarioId] = useState('default');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrchestrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<OrchestrationHistory[]>([]);
  const [copied, setCopied] = useState(false);

  const testOrchestration = httpsCallable(functions, 'testOrchestration');
  const getOrchestrationHistory = httpsCallable(functions, 'getOrchestrationHistory');

  useEffect(() => {
    // Load history when component mounts
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const result = await getOrchestrationHistory({ userId: userId || 'test-user', limit: 10 });
      setHistory(result.data as OrchestrationHistory[]);
    } catch (error: any) {
      console.error('Error loading history:', error);
    }
  };

  const navigate = useNavigate();

  const handleTest = async () => {
    if (!input.trim()) {
      setError('Please enter an input to test');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await testOrchestration({
        input: input.trim(),
        userId: userId || 'test-user',
        tenantId: tenantId || 'test-customer',
        scenarioId,
      });

      setResult(response.data as OrchestrationResult);
    } catch (error: any) {
      setError(error.message || 'Failed to test orchestration');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'warning';
    return 'error';
  };

  const getRiskColor = (risk: number) => {
    if (risk <= 3) return 'success';
    if (risk <= 6) return 'warning';
    return 'error';
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h3" >
          Auto-Context Engine
          </Typography>
          <Typography variant="body1" color="text.secondary">
          The conductor that orchestrates all AI engines and composes intelligent, context-aware
          prompts with full traceability.
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

      <Grid container spacing={3}>
        {/* Test Bench */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: 'fit-content' }}>
            <Typography variant="h6" gutterBottom>
              Test Bench
            </Typography>

            <TextField
              fullWidth
              label="User Input"
              multiline
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter a user question or request to test orchestration..."
              sx={{ mb: 2 }}
            />

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="test-user"
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="Customer ID"
                  value={tenantId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="test-customer"
                />
              </Grid>
            </Grid>

            <TextField
              fullWidth
              label="Scenario ID"
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              placeholder="default"
              sx={{ mb: 2 }}
            />

            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handleTest}
              disabled={loading || !input.trim()}
              fullWidth
            >
              {loading ? <CircularProgress size={20} /> : 'Test Orchestration'}
            </Button>

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </Paper>
        </Grid>

        {/* Results */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: 'fit-content' }}>
            <Typography variant="h6" gutterBottom>
              Orchestration Results
            </Typography>

            {result ? (
              <Box>
                {/* Metrics */}
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Card>
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography
                          variant="h6"
                          color={`${getConfidenceColor(result.confidenceScore)}.main`}
                        >
                          {(result.confidenceScore * 100).toFixed(1)}%
                        </Typography>
                        <Typography variant="caption">Confidence</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card>
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography
                          variant="h6"
                          color={`${getRiskColor(result.escalationRisk)}.main`}
                        >
                          {result.escalationRisk}/10
                        </Typography>
                        <Typography variant="caption">Escalation Risk</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                {/* Modules Engaged */}
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Modules Engaged:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {result.modulesEngaged.map((module, index) => (
                      <Chip
                        key={index}
                        label={module}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>

                {/* Final Prompt */}
                <Box sx={{ mb: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1,
                    }}
                  >
                    <Typography variant="subtitle2">
                      Final Prompt ({result.finalPrompt.length} chars)
                    </Typography>
                    <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(result.finalPrompt)}
                        color={copied ? 'success' : 'default'}
                      >
                        {copied ? <CheckCircleIcon /> : <ContentCopyIcon />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      backgroundColor: 'grey.50',
                      maxHeight: 200,
                      overflow: 'auto',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                    }}
                  >
                    {result.finalPrompt}
                  </Paper>
                </Box>

                {/* Walkthrough */}
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">Orchestration Walkthrough</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List dense>
                      {result.walkthrough.map((step, index) => (
                        <ListItem key={index} sx={{ py: 0.5 }}>
                          <ListItemText
                            primary={step}
                            primaryTypographyProps={{ variant: 'body2' }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">
                  Run a test to see orchestration results
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* History */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}
            >
              <Typography variant="h6">
                <HistoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Recent Orchestrations
              </Typography>
              <Button onClick={loadHistory} size="small">
                Refresh
              </Button>
            </Box>

            {history.length > 0 ? (
              <Grid container spacing={2}>
                {history.map((item) => (
                  <Grid item xs={12} md={6} lg={4} key={item.id}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" gutterBottom>
                          {item.originalInput.length > 50
                            ? `${item.originalInput.substring(0, 50)}...`
                            : item.originalInput}
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                          <Chip
                            label={`${(item.confidenceScore * 100).toFixed(0)}%`}
                            size="small"
                            color={getConfidenceColor(item.confidenceScore) as any}
                          />
                          <Chip
                            label={`Risk: ${item.escalationRisk}`}
                            size="small"
                            color={getRiskColor(item.escalationRisk) as any}
                          />
                        </Box>

                        <Typography variant="caption" color="text.secondary">
                          {item.timestamp?.toDate?.()?.toLocaleString() || 'Unknown time'}
                        </Typography>

                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            Modules: {item.modulesEngaged.join(', ')}
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">No orchestration history found</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AutoContextEngine;
