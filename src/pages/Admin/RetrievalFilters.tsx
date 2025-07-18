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
  Switch,
  FormControlLabel,
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  Divider,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Badge,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Visibility as VisibilityIcon,
  FilterList as FilterListIcon,
  Preview as PreviewIcon,
  Assignment as AssignmentIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

interface RetrievalFilter {
  id?: string;
  name: string;
  priorityWeight: number;
  appliesTo: 'employee' | 'customer' | 'jobPosting' | 'moment' | 'feedback' | 'all';
  status: 'active' | 'inactive';
  rules: {
    field: string;
    operator: '==' | '!=' | '>=' | '<=' | 'contains' | 'in' | 'not_in';
    value: any;
    fallbackStrategy?: 'skip' | 'use_default' | 'interpolate';
  }[];
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  tags?: string[];
  previewData?: {
    originalChunks: number;
    filteredChunks: number;
    filtersApplied: number;
    chunks: any[];
  };
}

interface FilterPreview {
  filterId: string;
  originalChunks: number;
  filteredChunks: number;
  filtersApplied: number;
  chunks: any[];
  loading: boolean;
}

const RetrievalFilters: React.FC = () => {
  const [filters, setFilters] = useState<RetrievalFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<RetrievalFilter | null>(null);
  const [editData, setEditData] = useState<RetrievalFilter>({
    name: '',
    priorityWeight: 0.5,
    appliesTo: 'all',
    status: 'active',
    rules: [],
    description: '',
    tags: [],
  });
  const [previewData, setPreviewData] = useState<FilterPreview | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [tenants, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [modules, setModules] = useState<Array<{ name: string; description: string }>>([]);
  const navigate = useNavigate();

  const appliesToOptions = [
    { value: 'all', label: 'All Contexts' },
    { value: 'employee', label: 'Employee Data' },
    { value: 'customer', label: 'Customer Data' },
    { value: 'jobPosting', label: 'Job Postings' },
    { value: 'moment', label: 'AI Moments' },
    { value: 'feedback', label: 'Feedback Campaigns' },
  ];

  const operatorOptions = [
    { value: '==', label: 'Equals' },
    { value: '!=', label: 'Not Equals' },
    { value: '>=', label: 'Greater Than or Equal' },
    { value: '<=', label: 'Less Than or Equal' },
    { value: 'contains', label: 'Contains' },
    { value: 'in', label: 'In List' },
    { value: 'not_in', label: 'Not In List' },
  ];

  const fallbackOptions = [
    { value: 'skip', label: 'Skip Context' },
    { value: 'use_default', label: 'Use Default Value' },
    { value: 'interpolate', label: 'Interpolate from Similar' },
  ];

  const fieldOptions = [
    { value: 'tags', label: 'Tags' },
    { value: 'content', label: 'Content' },
    { value: 'source', label: 'Source' },
    { value: 'createdAt', label: 'Created Date' },
    { value: 'score', label: 'Relevance Score' },
    { value: 'tenantId', label: 'Customer ID' },
    { value: 'userId', label: 'User ID' },
  ];

  // Mock data for demonstration
  const mockCustomers = [
    { id: 'customer1', name: 'Acme Corp' },
    { id: 'customer2', name: 'TechStart Inc' },
    { id: 'customer3', name: 'Global Services' },
  ];

  const mockModules = [
    { name: 'FeedbackEngine', description: 'AI-powered feedback campaigns' },
    { name: 'MomentsEngine', description: 'Scheduled AI moments and check-ins' },
    { name: 'TraitsEngine', description: 'Worker trait analysis and engagement' },
    { name: 'ContextEngine', description: 'Dynamic context assembly' },
  ];

  useEffect(() => {
    fetchFilters();
    setCustomers(mockCustomers);
    setModules(mockModules);
  }, []);

  const fetchFilters = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app);
      const getRetrievalFilters = httpsCallable(functions, 'getRetrievalFilters');
      const result = await getRetrievalFilters();
      const data = result.data as { filters: RetrievalFilter[] };
      setFilters(data.filters || []);
    } catch (err: any) {
      setError('Failed to fetch retrieval filters');
      // Use mock data for demonstration
      setFilters([
        {
          id: 'filter1',
          name: 'Safety-First Filter',
          description: 'Prioritize safety-related content',
          priorityWeight: 0.8,
          appliesTo: 'all',
          status: 'active',
          rules: [
            { field: 'tags', operator: 'contains', value: 'safety' },
            { field: 'score', operator: '>=', value: 0.7 },
          ],
          tags: ['safety', 'compliance'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'filter2',
          name: 'Recent Content Only',
          description: 'Only include content from last 30 days',
          priorityWeight: 0.6,
          appliesTo: 'feedback',
          status: 'active',
          rules: [{ field: 'createdAt', operator: '>=', value: '30d' }],
          tags: ['recent', 'fresh'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }
    setLoading(false);
  };

  const handleAddFilter = () => {
    setEditingFilter(null);
    setEditData({
      name: '',
      priorityWeight: 0.5,
      appliesTo: 'all',
      status: 'active',
      rules: [],
      description: '',
      tags: [],
    });
    setDialogOpen(true);
  };

  const handleEditFilter = (filter: RetrievalFilter) => {
    setEditingFilter(filter);
    setEditData({ ...filter });
    setDialogOpen(true);
  };

  const handleDeleteFilter = async (filterId: string) => {
    try {
      const functions = getFunctions(app);
      const deleteRetrievalFilter = httpsCallable(functions, 'deleteRetrievalFilter');
      const filterName = filters.find((f) => f.id === filterId)?.name || 'Unknown';

      await deleteRetrievalFilter({ filterId, filterName, userId: 'current_user' });
      setFilters((prev) => prev.filter((f) => f.id !== filterId));
      setSuccess('Filter deleted successfully');
    } catch (err: any) {
      setError('Failed to delete filter');
    }
  };

  const handleSaveFilter = async () => {
    try {
      const functions = getFunctions(app);

      if (editingFilter?.id) {
        // Update existing filter
        const updateRetrievalFilter = httpsCallable(functions, 'updateRetrievalFilter');
        await updateRetrievalFilter({
          filterId: editingFilter.id,
          filter: editData,
          userId: 'current_user',
        });
        setFilters((prev) =>
          prev.map((f) => (f.id === editingFilter.id ? { ...editData, id: editingFilter.id } : f)),
        );
      } else {
        // Add new filter
        const createRetrievalFilter = httpsCallable(functions, 'createRetrievalFilter');
        const result = await createRetrievalFilter({
          filter: editData,
          userId: 'current_user',
        });
        const data = result.data as { id: string };
        setFilters((prev) => [...prev, { ...editData, id: data.id }]);
      }
      setDialogOpen(false);
      setSuccess(editingFilter ? 'Filter updated successfully' : 'Filter created successfully');
    } catch (err: any) {
      setError('Failed to save filter');
    }
  };

  const handleAddRule = () => {
    setEditData((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        {
          field: '',
          operator: '==',
          value: '',
          fallbackStrategy: 'skip',
        },
      ],
    }));
  };

  const handleRemoveRule = (index: number) => {
    setEditData((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== index),
    }));
  };

  const handleRuleChange = (index: number, field: string, value: any) => {
    setEditData((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => (i === index ? { ...rule, [field]: value } : rule)),
    }));
  };

  const handlePreviewFilter = async (filter: RetrievalFilter) => {
    if (!selectedCustomer) {
      setError('Please select a customer for preview');
      return;
    }

    setPreviewData({
      filterId: filter.id || '',
      originalChunks: 0,
      filteredChunks: 0,
      filtersApplied: 0,
      chunks: [],
      loading: true,
    });
    setPreviewDialogOpen(true);

    try {
      const functions = getFunctions(app);
      const evaluatePromptWithFilters = httpsCallable(functions, 'evaluatePromptWithFilters');
      const result = await evaluatePromptWithFilters({
        promptId: 'preview',
        tenantId: selectedCustomer,
        userId: 'current_user',
      });

      const data = result.data as any;
      setPreviewData({
        filterId: filter.id || '',
        originalChunks: data.originalChunks,
        filteredChunks: data.filteredChunks,
        filtersApplied: data.filtersApplied,
        chunks: data.chunks,
        loading: false,
      });
    } catch (err: any) {
      setError('Failed to preview filter');
      setPreviewData((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  const handleAssignFilter = async () => {
    if (!selectedCustomer || !selectedModule) {
      setError('Please select both customer and module');
      return;
    }

    try {
      const functions = getFunctions(app);
      const assignFilterToModule = httpsCallable(functions, 'assignFilterToModule');
      await assignFilterToModule({
        tenantId: selectedCustomer,
        moduleName: selectedModule,
        filterId: editingFilter?.id || '',
        userId: 'current_user',
      });
      setAssignmentDialogOpen(false);
      setSuccess('Filter assigned successfully');
    } catch (err: any) {
      setError('Failed to assign filter');
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'active' ? 'success' : 'default';
  };

  const getAppliesToColor = (appliesTo: string) => {
    const colors: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'error'> = {
      all: 'primary',
      employee: 'secondary',
      customer: 'success',
      jobPosting: 'warning',
      moment: 'error',
      feedback: 'primary',
    };
    return colors[appliesTo] || 'default';
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString();
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h3">
            Retrieval Filters
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Define filter rules that control which context chunks are retrieved when composing
            prompts
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
                <FilterListIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">{filters.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Total Filters
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
                  {filters.filter((f) => f.status === 'active').length}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Active Filters
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AssignmentIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">12</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Module Assignments
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PreviewIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">85%</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Avg. Filter Effectiveness
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters List */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">Active Filters</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddFilter}>
            Create Filter
          </Button>
        </Box>

        {loading ? (
          <LinearProgress />
        ) : (
          <Grid container spacing={3}>
            {filters.map((filter) => (
              <Grid item xs={12} md={6} key={filter.id}>
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
                          {filter.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {filter.description}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="Preview Filter">
                          <IconButton size="small" onClick={() => handlePreviewFilter(filter)}>
                            <PreviewIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Filter">
                          <IconButton size="small" onClick={() => handleEditFilter(filter)}>
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Filter">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => filter.id && handleDeleteFilter(filter.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                      <Chip
                        label={filter.status}
                        color={getStatusColor(filter.status)}
                        size="small"
                      />
                      <Chip
                        label={
                          appliesToOptions.find((opt) => opt.value === filter.appliesTo)?.label
                        }
                        color={getAppliesToColor(filter.appliesTo)}
                        size="small"
                      />
                      <Chip
                        label={`Priority: ${filter.priorityWeight}`}
                        variant="outlined"
                        size="small"
                      />
                      {filter.tags?.map((tag) => (
                        <Chip key={tag} label={tag} size="small" />
                      ))}
                    </Box>

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Rules: {filter.rules.length}
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AssignmentIcon />}
                        onClick={() => {
                          setEditingFilter(filter);
                          setAssignmentDialogOpen(true);
                        }}
                      >
                        Assign
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PreviewIcon />}
                        onClick={() => handlePreviewFilter(filter)}
                      >
                        Preview
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Paper>

      {/* Filter Creation/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingFilter ? 'Edit Filter' : 'Create New Filter'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Filter Name"
                value={editData.name}
                onChange={(e) => setEditData((prev) => ({ ...prev, name: e.target.value }))}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Applies To</InputLabel>
                <Select
                  value={editData.appliesTo}
                  label="Applies To"
                  onChange={(e) =>
                    setEditData((prev) => ({ ...prev, appliesTo: e.target.value as any }))
                  }
                >
                  {appliesToOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Description"
                value={editData.description}
                onChange={(e) => setEditData((prev) => ({ ...prev, description: e.target.value }))}
                fullWidth
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" gutterBottom>
                Priority Weight: {editData.priorityWeight}
              </Typography>
              <Slider
                value={editData.priorityWeight}
                onChange={(_, value) =>
                  setEditData((prev) => ({ ...prev, priorityWeight: value as number }))
                }
                min={0}
                max={1}
                step={0.1}
                marks
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editData.status === 'active'}
                    onChange={(e) =>
                      setEditData((prev) => ({
                        ...prev,
                        status: e.target.checked ? 'active' : 'inactive',
                      }))
                    }
                  />
                }
                label="Active"
              />
            </Grid>
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <Typography variant="h6">Filter Rules</Typography>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddRule}>
                  Add Rule
                </Button>
              </Box>
              {editData.rules.map((rule, index) => (
                <Paper key={index} sx={{ p: 2, mb: 2 }}>
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Field</InputLabel>
                        <Select
                          value={rule.field}
                          label="Field"
                          onChange={(e) => handleRuleChange(index, 'field', e.target.value)}
                        >
                          {fieldOptions.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Operator</InputLabel>
                        <Select
                          value={rule.operator}
                          label="Operator"
                          onChange={(e) => handleRuleChange(index, 'operator', e.target.value)}
                        >
                          {operatorOptions.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Value"
                        value={rule.value}
                        onChange={(e) => handleRuleChange(index, 'value', e.target.value)}
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Fallback</InputLabel>
                        <Select
                          value={rule.fallbackStrategy}
                          label="Fallback"
                          onChange={(e) =>
                            handleRuleChange(index, 'fallbackStrategy', e.target.value)
                          }
                        >
                          {fallbackOptions.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={1}>
                      <IconButton color="error" onClick={() => handleRemoveRule(index)}>
                        <DeleteIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                </Paper>
              ))}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveFilter} variant="contained">
            Save Filter
          </Button>
        </DialogActions>
      </Dialog>

      {/* Filter Preview Dialog */}
      <Dialog
        open={previewDialogOpen}
        onClose={() => setPreviewDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          Filter Preview
          <Typography variant="body2" color="text.secondary">
            See how this filter affects context chunk retrieval
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 3 }}>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Select Customer</InputLabel>
              <Select
                value={selectedCustomer}
                label="Select Customer"
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                {tenants.map((customer) => (
                  <MenuItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {previewData && (
            <Box>
              <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} md={4}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" color="primary">
                        {previewData.originalChunks}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Original Chunks
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" color="success">
                        {previewData.filteredChunks}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Filtered Chunks
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" color="primary">
                        {previewData.filtersApplied}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Filters Applied
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              {previewData.loading ? (
                <LinearProgress />
              ) : (
                <TableContainer component={Paper}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Content Preview</TableCell>
                        <TableCell>Tags</TableCell>
                        <TableCell>Score</TableCell>
                        <TableCell>Source</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {previewData.chunks.map((chunk, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                              {chunk.content || chunk.text || 'No content'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {(chunk.tags || []).map((tag: string) => (
                                <Chip key={tag} label={tag} size="small" />
                              ))}
                            </Box>
                          </TableCell>
                          <TableCell>{chunk.score?.toFixed(2) || 'N/A'}</TableCell>
                          <TableCell>{chunk.source || 'Unknown'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Filter Assignment Dialog */}
      <Dialog open={assignmentDialogOpen} onClose={() => setAssignmentDialogOpen(false)}>
        <DialogTitle>Assign Filter to Module</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Select Customer</InputLabel>
              <Select
                value={selectedCustomer}
                label="Select Customer"
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                {tenants.map((customer) => (
                  <MenuItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Select Module</InputLabel>
              <Select
                value={selectedModule}
                label="Select Module"
                onChange={(e) => setSelectedModule(e.target.value)}
              >
                {modules.map((module) => (
                  <MenuItem key={module.name} value={module.name}>
                    {module.name} - {module.description}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignmentDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAssignFilter} variant="contained">
            Assign Filter
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

export default RetrievalFilters;
