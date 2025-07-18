import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface FilterRule {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: string | number | string[];
}

interface RetrievalFilter {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  rules: FilterRule[];
  assignedModules: string[];
  effectiveness: number;
  lastTested: string;
  testResults: {
    totalQueries: number;
    successfulMatches: number;
    averageRelevance: number;
  };
}

interface RetrievalFiltersProps {
  tenantId: string;
}

const RetrievalFilters: React.FC<RetrievalFiltersProps> = ({ tenantId }) => {
  const [filters, setFilters] = useState<RetrievalFilter[]>([
    {
      id: 'high_priority_feedback',
      name: 'High Priority Feedback',
      description: 'Filter for feedback with high sentiment scores or urgent flags',
      enabled: true,
      priority: 1,
      rules: [
        { field: 'sentiment_score', operator: 'greater_than', value: 0.8 },
        { field: 'urgency_flag', operator: 'equals', value: 'true' },
      ],
      assignedModules: ['FeedbackEngine', 'MomentsEngine'],
      effectiveness: 0.85,
      lastTested: '2024-01-01T00:00:00Z',
      testResults: { totalQueries: 150, successfulMatches: 127, averageRelevance: 0.87 },
    },
    {
      id: 'recent_interactions',
      name: 'Recent Interactions',
      description: 'Prioritize interactions from the last 30 days',
      enabled: true,
      priority: 2,
      rules: [{ field: 'timestamp', operator: 'greater_than', value: '30_days_ago' }],
      assignedModules: ['ContextEngine', 'TraitsEngine'],
      effectiveness: 0.72,
      lastTested: '2024-01-01T00:00:00Z',
      testResults: { totalQueries: 200, successfulMatches: 144, averageRelevance: 0.72 },
    },
    {
      id: 'specific_traits',
      name: 'Specific Traits Focus',
      description: 'Filter for interactions related to specific worker traits',
      enabled: false,
      priority: 3,
      rules: [
        {
          field: 'trait_mentioned',
          operator: 'in',
          value: ['reliability', 'communication', 'leadership'],
        },
      ],
      assignedModules: ['TraitsEngine'],
      effectiveness: 0.0,
      lastTested: '2024-01-01T00:00:00Z',
      testResults: { totalQueries: 0, successfulMatches: 0, averageRelevance: 0.0 },
    },
  ]);
  const [originalFilters, setOriginalFilters] = useState<RetrievalFilter[]>([]);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [editingFilter, setEditingFilter] = useState<RetrievalFilter | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [testingFilter, setTestingFilter] = useState<string | null>(null);

  const availableModules = [
    'ContextEngine',
    'TraitsEngine',
    'MomentsEngine',
    'FeedbackEngine',
    'WeightsEngine',
    'VectorEngine',
    'PromptEngine',
  ];

  const availableFields = [
    'sentiment_score',
    'urgency_flag',
    'timestamp',
    'trait_mentioned',
    'category',
    'source',
    'user_id',
    'customer_id',
    'priority_level',
  ];

  const availableOperators = [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'greater_than', label: 'Greater Than' },
    { value: 'less_than', label: 'Less Than' },
    { value: 'in', label: 'In List' },
    { value: 'not_in', label: 'Not In List' },
  ];

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const filtersRef = doc(db, 'tenants', tenantId, 'aiSettings', 'retrievalFilters');
        const filtersSnap = await getDoc(filtersRef);
        if (filtersSnap.exists()) {
          const data = filtersSnap.data();
          if (data.filters) {
            setFilters(data.filters);
            setOriginalFilters(data.filters);
          }
        }
      } catch (err) {
        setError('Failed to fetch retrieval filters');
      }
    };
    fetchFilters();
  }, [tenantId]);

  const handleFilterChange = (filterId: string, field: keyof RetrievalFilter, value: any) => {
    setFilters((prev) =>
      prev.map((filter) => (filter.id === filterId ? { ...filter, [field]: value } : filter)),
    );
  };

  const handleAddRule = (filterId: string) => {
    const newRule: FilterRule = { field: 'sentiment_score', operator: 'equals', value: '' };
    handleFilterChange(filterId, 'rules', [
      ...filters.find((f) => f.id === filterId)!.rules,
      newRule,
    ]);
  };

  const handleRemoveRule = (filterId: string, ruleIndex: number) => {
    const filter = filters.find((f) => f.id === filterId)!;
    const newRules = filter.rules.filter((_, index) => index !== ruleIndex);
    handleFilterChange(filterId, 'rules', newRules);
  };

  const handleRuleChange = (
    filterId: string,
    ruleIndex: number,
    field: keyof FilterRule,
    value: any,
  ) => {
    const filter = filters.find((f) => f.id === filterId)!;
    const newRules = [...filter.rules];
    newRules[ruleIndex] = { ...newRules[ruleIndex], [field]: value };
    handleFilterChange(filterId, 'rules', newRules);
  };

  const handleTestFilter = async (filterId: string) => {
    setTestingFilter(filterId);
    try {
      // Simulate testing process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Update test results
      const filter = filters.find((f) => f.id === filterId)!;
      const newEffectiveness = Math.random() * 0.3 + 0.6; // Random between 0.6-0.9
      const newTestResults = {
        totalQueries: Math.floor(Math.random() * 200) + 50,
        successfulMatches: Math.floor(Math.random() * 150) + 30,
        averageRelevance: Math.random() * 0.4 + 0.5,
      };

      handleFilterChange(filterId, 'effectiveness', newEffectiveness);
      handleFilterChange(filterId, 'testResults', newTestResults);
      handleFilterChange(filterId, 'lastTested', new Date().toISOString());

      // Log the test action
      await setDoc(doc(db, 'ai_logs', `${tenantId}_FilterTest_${Date.now()}`), {
        tenantId,
        section: 'RetrievalFilters',
        changed: 'test_filter',
        filterId,
        testResults: newTestResults,
        effectiveness: newEffectiveness,
        timestamp: new Date().toISOString(),
        eventType: 'filter_test',
        engineTouched: ['RetrievalEngine'],
      });
    } catch (err) {
      setError('Failed to test filter');
    } finally {
      setTestingFilter(null);
    }
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'retrievalFilters');
      await setDoc(ref, { filters }, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_RetrievalFilters_${Date.now()}`), {
        tenantId,
        section: 'RetrievalFilters',
        changed: 'retrieval_filters',
        oldValue: originalFilters,
        newValue: filters,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['RetrievalEngine'],
      });
      setOriginalFilters([...filters]);
      setSuccess(true);
    } catch (err) {
      setError('Failed to save retrieval filters');
    }
  };

  const isChanged = JSON.stringify(filters) !== JSON.stringify(originalFilters);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Retrieval Filters
        <Tooltip title="Configure filters to control what content the AI retrieves and prioritizes.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      <Grid container spacing={3}>
        {filters.map((filter) => (
          <Grid item xs={12} key={filter.id}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={filter.enabled}
                        onChange={(e) => handleFilterChange(filter.id, 'enabled', e.target.checked)}
                      />
                    }
                    label=""
                  />
                  <Typography fontWeight={600}>{filter.name}</Typography>
                  <Chip label={`Priority: ${filter.priority}`} size="small" color="primary" />
                  <Chip
                    label={`${(filter.effectiveness * 100).toFixed(0)}% effective`}
                    size="small"
                    color={
                      filter.effectiveness > 0.8
                        ? 'success'
                        : filter.effectiveness > 0.6
                        ? 'warning'
                        : 'error'
                    }
                  />
                  <Typography variant="caption" color="text.secondary">
                    Last tested: {new Date(filter.lastTested).toLocaleDateString()}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {filter.description}
                    </Typography>
                  </Grid>

                  {/* Basic Settings */}
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Filter Name"
                      value={filter.name}
                      onChange={(e) => handleFilterChange(filter.id, 'name', e.target.value)}
                      fullWidth
                      disabled={!filter.enabled}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography gutterBottom>Priority: {filter.priority}</Typography>
                    <Slider
                      value={filter.priority}
                      min={1}
                      max={10}
                      step={1}
                      onChange={(_, value) => handleFilterChange(filter.id, 'priority', value)}
                      disabled={!filter.enabled}
                    />
                  </Grid>

                  {/* Rules */}
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Typography variant="subtitle1">Filter Rules</Typography>
                      <Tooltip title="Add a new rule to this filter">
                        <IconButton
                          size="small"
                          onClick={() => handleAddRule(filter.id)}
                          disabled={!filter.enabled}
                        >
                          <AddIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <List>
                      {filter.rules.map((rule, index) => (
                        <ListItem
                          key={index}
                          sx={{ border: '1px solid #e0e0e0', borderRadius: 1, mb: 1 }}
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <FormControl size="small" sx={{ minWidth: 120 }}>
                                  <Select
                                    value={rule.field}
                                    onChange={(e) =>
                                      handleRuleChange(filter.id, index, 'field', e.target.value)
                                    }
                                    disabled={!filter.enabled}
                                  >
                                    {availableFields.map((field) => (
                                      <MenuItem key={field} value={field}>
                                        {field}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 120 }}>
                                  <Select
                                    value={rule.operator}
                                    onChange={(e) =>
                                      handleRuleChange(filter.id, index, 'operator', e.target.value)
                                    }
                                    disabled={!filter.enabled}
                                  >
                                    {availableOperators.map((op) => (
                                      <MenuItem key={op.value} value={op.value}>
                                        {op.label}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <TextField
                                  size="small"
                                  value={rule.value}
                                  onChange={(e) =>
                                    handleRuleChange(filter.id, index, 'value', e.target.value)
                                  }
                                  disabled={!filter.enabled}
                                  sx={{ minWidth: 150 }}
                                />
                              </Box>
                            }
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              onClick={() => handleRemoveRule(filter.id, index)}
                              disabled={!filter.enabled}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  </Grid>

                  {/* Module Assignment */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Assigned Modules
                      <Tooltip title="Select which AI engines should use this filter">
                        <IconButton size="small" sx={{ ml: 1 }}>
                          <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {availableModules.map((module) => (
                        <Chip
                          key={module}
                          label={module}
                          onClick={() => {
                            const currentModules = filter.assignedModules;
                            const newModules = currentModules.includes(module)
                              ? currentModules.filter((m) => m !== module)
                              : [...currentModules, module];
                            handleFilterChange(filter.id, 'assignedModules', newModules);
                          }}
                          color={filter.assignedModules.includes(module) ? 'primary' : 'default'}
                          disabled={!filter.enabled}
                        />
                      ))}
                    </Box>
                  </Grid>

                  {/* Test Results */}
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Typography variant="subtitle1">Test Results</Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={() => handleTestFilter(filter.id)}
                        disabled={!filter.enabled || testingFilter === filter.id}
                      >
                        {testingFilter === filter.id ? 'Testing...' : 'Test Filter'}
                      </Button>
                    </Box>
                    <Grid container spacing={2}>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="text.secondary">
                          Total Queries
                        </Typography>
                        <Typography variant="h6">{filter.testResults.totalQueries}</Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="text.secondary">
                          Successful Matches
                        </Typography>
                        <Typography variant="h6">{filter.testResults.successfulMatches}</Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="text.secondary">
                          Avg Relevance
                        </Typography>
                        <Typography variant="h6">
                          {(filter.testResults.averageRelevance * 100).toFixed(0)}%
                        </Typography>
                      </Grid>
                    </Grid>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
        ))}
      </Grid>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Retrieval Filters
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Retrieval filters updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default RetrievalFilters;
