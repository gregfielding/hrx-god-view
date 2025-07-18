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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Slider,
  Tabs,
  Tab,
  LinearProgress,
  CircularProgress,
} from '@mui/material';
import {
  Build as BuildIcon,
  PlayArrow as PlayArrowIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  ArrowBack as ArrowBackIcon,
  ExpandMore as ExpandMoreIcon,
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  Settings as SettingsIcon,
  Psychology as PsychologyIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'system' | 'user' | 'context' | 'custom';
  content: string;
  variables: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PromptTest {
  id: string;
  name: string;
  inputData: Record<string, any>;
  expectedOutput: string;
  actualOutput?: string;
  success?: boolean;
  latency?: number;
  timestamp: Date;
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
      id={`prompt-tabpanel-${index}`}
      aria-labelledby={`prompt-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const PromptBuilder: React.FC = () => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [tests, setTests] = useState<PromptTest[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<PromptTemplate | null>(null);
  const [editData, setEditData] = useState<Partial<PromptTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [testDialog, setTestDialog] = useState(false);
  const [testInput, setTestInput] = useState<Record<string, any>>({});
  const [assembledPrompt, setAssembledPrompt] = useState('');
  const navigate = useNavigate();

  // Mock data for demonstration
  const mockTemplates: PromptTemplate[] = [
    {
      id: 'system_base',
      name: 'System Base Prompt',
      description: 'Core system instructions for AI behavior',
      category: 'system',
      content:
        'You are an AI assistant helping workers with their professional development and workplace needs. Be supportive, empathetic, and professional.',
      variables: [],
      isActive: true,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 'tone_instructions',
      name: 'Tone Instructions',
      description: 'Dynamic tone settings based on customer preferences',
      category: 'context',
      content:
        'Maintain a tone that is {{formality}} formal, {{friendliness}} friendly, and {{conciseness}} concise.',
      variables: ['formality', 'friendliness', 'conciseness'],
      isActive: true,
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
    {
      id: 'worker_context',
      name: 'Worker Context',
      description: 'Worker-specific context and traits',
      category: 'context',
      content:
        'This worker shows {{empathy}} empathy, {{reliability}} reliability, and {{communication}} communication skills.',
      variables: ['empathy', 'reliability', 'communication'],
      isActive: true,
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    },
    {
      id: 'scenario_welcome',
      name: 'Welcome Scenario',
      description: 'Welcome message for new workers',
      category: 'user',
      content:
        "Welcome to {{company}}! I'm here to help you get started. How can I assist you with your onboarding today?",
      variables: ['company'],
      isActive: true,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 15 * 60 * 1000),
    },
    {
      id: 'feedback_request',
      name: 'Feedback Request',
      description: 'Template for requesting feedback',
      category: 'custom',
      content:
        "I'd love to hear your thoughts on {{topic}}. Could you share your experience with {{aspect}}?",
      variables: ['topic', 'aspect'],
      isActive: false,
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  ];

  const mockTests: PromptTest[] = [
    {
      id: 'test_1',
      name: 'Welcome Message Test',
      inputData: {
        company: 'TechCorp',
        formality: 0.7,
        friendliness: 0.9,
        conciseness: 0.6,
        empathy: 7.2,
        reliability: 8.1,
        communication: 6.8,
      },
      expectedOutput:
        "Welcome to TechCorp! I'm here to help you get started. How can I assist you with your onboarding today?",
      actualOutput:
        "Welcome to TechCorp! I'm here to help you get started. How can I assist you with your onboarding today?",
      success: true,
      latency: 245,
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
    },
    {
      id: 'test_2',
      name: 'Tone Adjustment Test',
      inputData: {
        formality: 0.8,
        friendliness: 0.7,
        conciseness: 0.5,
      },
      expectedOutput: 'Maintain a tone that is 0.8 formal, 0.7 friendly, and 0.5 concise.',
      actualOutput: 'Maintain a tone that is 0.8 formal, 0.7 friendly, and 0.5 concise.',
      success: true,
      latency: 123,
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
    },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app);
      const getPromptTemplates = httpsCallable(functions, 'getPromptTemplates');
      const result = await getPromptTemplates();
      const data = result.data as { templates: PromptTemplate[] };

      setTemplates(data.templates);
      setTests(mockTests); // Tests are still mock for now
    } catch (err: any) {
      setError('Failed to fetch prompt data');
    }
    setLoading(false);
  };

  const handleCreateTemplate = () => {
    setCurrentTemplate(null);
    setEditData({
      name: '',
      description: '',
      category: 'custom',
      content: '',
      variables: [],
      isActive: true,
    });
    setEditDialog(true);
  };

  const handleEditTemplate = (template: PromptTemplate) => {
    setCurrentTemplate(template);
    setEditData({ ...template });
    setEditDialog(true);
  };

  const handleSaveTemplate = async () => {
    try {
      const functions = getFunctions(app);

      if (currentTemplate?.id) {
        // Update existing template
        const updatePromptTemplate = httpsCallable(functions, 'updatePromptTemplate');
        await updatePromptTemplate({
          templateId: currentTemplate.id,
          template: editData,
          userId: 'current_user', // TODO: Get actual user ID
        });

        setTemplates((prev) =>
          prev.map((t) =>
            t.id === currentTemplate.id
              ? ({ ...editData, id: currentTemplate.id, updatedAt: new Date() } as PromptTemplate)
              : t,
          ),
        );
        setSuccess('Prompt template updated successfully');
      } else {
        // Add new template
        const createPromptTemplate = httpsCallable(functions, 'createPromptTemplate');
        const result = await createPromptTemplate({
          template: editData,
          userId: 'current_user', // TODO: Get actual user ID
        });

        const data = result.data as { id: string };
        const newTemplate: PromptTemplate = {
          id: data.id,
          name: editData.name || 'New Template',
          description: editData.description || '',
          category: editData.category || 'custom',
          content: editData.content || '',
          variables: editData.variables || [],
          isActive: editData.isActive !== false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setTemplates((prev) => [...prev, newTemplate]);
        setSuccess('Prompt template created successfully');
      }
      setEditDialog(false);
    } catch (err: any) {
      setError('Failed to save prompt template');
    }
  };

  const handleTestPrompt = async () => {
    setTesting(true);
    try {
      const functions = getFunctions(app);
      const testPromptTemplate = httpsCallable(functions, 'testPromptTemplate');

      const result = await testPromptTemplate({
        template: currentTemplate,
        inputData: testInput,
        userId: 'current_user', // TODO: Get actual user ID
      });

      const data = result.data as { success: boolean; assembledPrompt: string; latency: number };

      if (data.success) {
        const testResult: PromptTest = {
          id: `test_${Date.now()}`,
          name: 'Live Test',
          inputData: testInput,
          expectedOutput: 'Expected output based on template',
          actualOutput: data.assembledPrompt,
          success: true,
          latency: data.latency,
          timestamp: new Date(),
        };

        setTests((prev) => [testResult, ...prev]);
        setSuccess('Prompt test completed successfully');
        setTestDialog(false);
      }
    } catch (err: any) {
      setError('Failed to test prompt');
    }
    setTesting(false);
  };

  const handlePreviewPrompt = () => {
    // Assemble prompt from templates and test input
    let assembled = '';

    // Add system prompt
    const systemTemplate = templates.find((t) => t.id === 'system_base');
    if (systemTemplate) {
      assembled += systemTemplate.content + '\n\n';
    }

    // Add tone instructions
    const toneTemplate = templates.find((t) => t.id === 'tone_instructions');
    if (toneTemplate) {
      let toneContent = toneTemplate.content;
      toneTemplate.variables.forEach((variable) => {
        const value = testInput[variable] || '0.5';
        toneContent = toneContent.replace(new RegExp(`{{${variable}}}`, 'g'), value);
      });
      assembled += toneContent + '\n\n';
    }

    // Add worker context
    const workerTemplate = templates.find((t) => t.id === 'worker_context');
    if (workerTemplate) {
      let workerContent = workerTemplate.content;
      workerTemplate.variables.forEach((variable) => {
        const value = testInput[variable] || '5.0';
        workerContent = workerContent.replace(new RegExp(`{{${variable}}}`, 'g'), value);
      });
      assembled += workerContent + '\n\n';
    }

    // Add scenario template
    const scenarioTemplate = templates.find((t) => t.id === 'scenario_welcome');
    if (scenarioTemplate) {
      let scenarioContent = scenarioTemplate.content;
      scenarioTemplate.variables.forEach((variable) => {
        const value = testInput[variable] || 'Company';
        scenarioContent = scenarioContent.replace(new RegExp(`{{${variable}}}`, 'g'), value);
      });
      assembled += scenarioContent;
    }

    setAssembledPrompt(assembled);
    setPreviewDialog(true);
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard');
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<
      string,
      'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'default'
    > = {
      system: 'primary',
      user: 'secondary',
      context: 'success',
      custom: 'warning',
    };
    return colors[category] || 'default';
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'system':
        return <SettingsIcon />;
      case 'user':
        return <PsychologyIcon />;
      case 'context':
        return <StorageIcon />;
      case 'custom':
        return <BuildIcon />;
      default:
        return <BuildIcon />;
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" fontWeight={600}>
          Prompt Builder
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
        Build, test, and hot-reload dynamic prompts with real-time context assembly and preview.
      </Typography>

      {/* Main Content */}
      <Box sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
            <Tab label="Templates" />
            <Tab label="Testing" />
            <Tab label="Live Preview" />
          </Tabs>
        </Box>

        {/* Templates Tab */}
        <TabPanel value={tabValue} index={0}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
          >
            <Typography variant="h6">Prompt Templates</Typography>
            <Button variant="contained" startIcon={<BuildIcon />} onClick={handleCreateTemplate}>
              Create Template
            </Button>
          </Box>

          <Grid container spacing={3}>
            {templates.map((template) => (
              <Grid item xs={12} md={6} lg={4} key={template.id}>
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
                      <Typography variant="h6">{template.name}</Typography>
                      <Chip
                        icon={getCategoryIcon(template.category)}
                        label={template.category}
                        size="small"
                        color={getCategoryColor(template.category)}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {template.description}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        bgcolor: 'grey.100',
                        p: 1,
                        borderRadius: 1,
                        mb: 2,
                      }}
                    >
                      {template.content.substring(0, 100)}...
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Box>
                        {template.variables.map((variable) => (
                          <Chip
                            key={variable}
                            label={variable}
                            size="small"
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                        ))}
                      </Box>
                      <Box>
                        <IconButton onClick={() => handleEditTemplate(template)} size="small">
                          <BuildIcon />
                        </IconButton>
                        <IconButton onClick={() => handlePreviewPrompt()} size="small">
                          <VisibilityIcon />
                        </IconButton>
                      </Box>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 1 }}
                    >
                      Updated: {formatDate(template.updatedAt)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </TabPanel>

        {/* Testing Tab */}
        <TabPanel value={tabValue} index={1}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
          >
            <Typography variant="h6">Prompt Testing</Typography>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => setTestDialog(true)}
            >
              New Test
            </Button>
          </Box>

          <Grid container spacing={3}>
            {tests.map((test) => (
              <Grid item xs={12} md={6} key={test.id}>
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
                      <Typography variant="h6">{test.name}</Typography>
                      <Chip
                        icon={test.success ? <CheckCircleIcon /> : <ErrorIcon />}
                        label={test.success ? 'Passed' : 'Failed'}
                        size="small"
                        color={test.success ? 'success' : 'error'}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Latency: {test.latency}ms
                    </Typography>
                    <Accordion>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle2">Test Results</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                        >
                          {test.actualOutput}
                        </Typography>
                      </AccordionDetails>
                    </Accordion>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(test.timestamp)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </TabPanel>

        {/* Live Preview Tab */}
        <TabPanel value={tabValue} index={2}>
          <Typography variant="h6" gutterBottom>
            Live Prompt Assembly
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Test how your prompts assemble with different context variables.
          </Typography>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Test Variables
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField
                      label="Company"
                      value={testInput.company || ''}
                      onChange={(e) =>
                        setTestInput((prev) => ({ ...prev, company: e.target.value }))
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography gutterBottom>Formality</Typography>
                    <Slider
                      value={testInput.formality || 0.5}
                      onChange={(_, value) =>
                        setTestInput((prev) => ({ ...prev, formality: value as number }))
                      }
                      min={0}
                      max={1}
                      step={0.1}
                      marks
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography gutterBottom>Friendliness</Typography>
                    <Slider
                      value={testInput.friendliness || 0.5}
                      onChange={(_, value) =>
                        setTestInput((prev) => ({ ...prev, friendliness: value as number }))
                      }
                      min={0}
                      max={1}
                      step={0.1}
                      marks
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography gutterBottom>Empathy</Typography>
                    <Slider
                      value={testInput.empathy || 5}
                      onChange={(_, value) =>
                        setTestInput((prev) => ({ ...prev, empathy: value as number }))
                      }
                      min={0}
                      max={10}
                      step={0.1}
                      marks
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                </Grid>
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    onClick={handlePreviewPrompt}
                    fullWidth
                  >
                    Assemble Prompt
                  </Button>
                </Box>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Assembled Prompt
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    bgcolor: 'grey.100',
                    p: 2,
                    borderRadius: 1,
                    minHeight: 200,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {assembledPrompt || 'Click "Assemble Prompt" to see the result...'}
                </Typography>
                {assembledPrompt && (
                  <Box sx={{ mt: 2 }}>
                    <Button
                      variant="outlined"
                      startIcon={<CopyIcon />}
                      onClick={() => handleCopyToClipboard(assembledPrompt)}
                      fullWidth
                    >
                      Copy to Clipboard
                    </Button>
                  </Box>
                )}
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>
      </Box>

      {/* Edit Template Dialog */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {currentTemplate ? 'Edit Prompt Template' : 'Create Prompt Template'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Template Name"
                value={editData.name || ''}
                onChange={(e) => setEditData((prev) => ({ ...prev, name: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={editData.category || 'custom'}
                  label="Category"
                  onChange={(e) =>
                    setEditData((prev) => ({ ...prev, category: e.target.value as any }))
                  }
                >
                  <MenuItem value="system">System</MenuItem>
                  <MenuItem value="user">User</MenuItem>
                  <MenuItem value="context">Context</MenuItem>
                  <MenuItem value="custom">Custom</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Description"
                value={editData.description || ''}
                onChange={(e) => setEditData((prev) => ({ ...prev, description: e.target.value }))}
                fullWidth
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Template Content"
                value={editData.content || ''}
                onChange={(e) => setEditData((prev) => ({ ...prev, content: e.target.value }))}
                fullWidth
                multiline
                rows={6}
                helperText="Use {{variable}} syntax for dynamic content"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editData.isActive !== false}
                    onChange={(e) =>
                      setEditData((prev) => ({ ...prev, isActive: e.target.checked }))
                    }
                  />
                }
                label="Active"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(false)}>Cancel</Button>
          <Button
            onClick={handleSaveTemplate}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={!editData.name?.trim() || !editData.content?.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={testDialog} onClose={() => setTestDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Test Prompt Assembly</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Test Name"
                value={testInput.name || ''}
                onChange={(e) => setTestInput((prev) => ({ ...prev, name: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>
                Test Variables
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    label="Company"
                    value={testInput.company || ''}
                    onChange={(e) => setTestInput((prev) => ({ ...prev, company: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Formality"
                    type="number"
                    value={testInput.formality || 0.5}
                    onChange={(e) =>
                      setTestInput((prev) => ({ ...prev, formality: parseFloat(e.target.value) }))
                    }
                    fullWidth
                    size="small"
                    inputProps={{ min: 0, max: 1, step: 0.1 }}
                  />
                </Grid>
              </Grid>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestDialog(false)}>Cancel</Button>
          <Button
            onClick={handleTestPrompt}
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={testing}
          >
            {testing ? 'Testing...' : 'Run Test'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewDialog} onClose={() => setPreviewDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Prompt Preview</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" gutterBottom>
            Assembled Prompt
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              bgcolor: 'grey.100',
              p: 2,
              borderRadius: 1,
              whiteSpace: 'pre-wrap',
            }}
          >
            {assembledPrompt}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDialog(false)}>Close</Button>
          <Button onClick={() => handleCopyToClipboard(assembledPrompt)} startIcon={<CopyIcon />}>
            Copy
          </Button>
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

export default PromptBuilder;
