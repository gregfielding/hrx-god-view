import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Badge,
  Checkbox,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  Refresh as RefreshIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';

interface HelpTopic {
  id: string;
  title: string;
  category: string;
  audience: string[];
  summary: string;
  body: string;
  relatedComponents?: string[];
  lastUpdated: Date;
  usageCount: number;
  thumbsUp: number;
  thumbsDown: number;
  priority: number;
  status: string;
  createdBy: string;
  createdAt: Date;
}

interface HelpAnalytics {
  totalUsage: number;
  uniqueUsers: number;
  mostUsedComponents: Record<string, number>;
  feedbackBreakdown: {
    thumbsUp: number;
    thumbsDown: number;
    confused: number;
  };
  usageByDay: Record<string, number>;
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
      id={`help-admin-tabpanel-${index}`}
      aria-labelledby={`help-admin-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const HelpManagement: React.FC = () => {
  const { user } = useAuth();
  const functions = getFunctions();
  const navigate = useNavigate();

  const [allTopics, setAllTopics] = useState<HelpTopic[]>([]); // Store all topics for counts and filtering
  const [topics, setTopics] = useState<HelpTopic[]>([]); // Only used for display in current tab
  const [analytics, setAnalytics] = useState<HelpAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<HelpTopic | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    category: '',
    audience: [] as string[],
    summary: '',
    body: '',
    relatedComponents: [] as string[],
    status: 'draft',
    priority: 1,
  });

  const categories = [
    'Staffing',
    'Onboarding',
    'Compliance',
    'Payroll',
    'Scheduling',
    'Benefits',
    'AI Launchpad',
    'Vector Settings',
    'Retrieval Filters',
    'Context Engine',
    'Analytics',
    'Broadcasts',
    'AI Chat',
    'Feedback Engine',
    'General',
  ];

  const audiences = ['7', '6', '5', '4', '3', '2', '1', '0'];
  const statuses = ['draft', 'published', 'archived'];

  useEffect(() => {
    fetchAllTopics();
    // Only fetch analytics once on mount
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    setTopics(getFilteredTopics(tabValue));
  }, [tabValue, allTopics]);

  const getStatusForTab = (tabIdx: number) => {
    switch (tabIdx) {
      case 1:
        return 'draft';
      case 2:
        return 'published';
      case 3:
        return 'archived';
      default:
        return undefined;
    }
  };

  const fetchAllTopics = async () => {
    try {
      setLoading(true);
      const getHelpTopics = httpsCallable(functions, 'getHelpTopics');
      const result = await getHelpTopics({ limit: 100 });
      const data = result.data as { topics: HelpTopic[] };
      setAllTopics(Array.isArray(data.topics) ? data.topics : []);
      setTopics(getFilteredTopics(tabValue, Array.isArray(data.topics) ? data.topics : []));
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const getHelpAnalytics = httpsCallable(functions, 'getHelpAnalytics');
      const result = await getHelpAnalytics({
        timeRange: '30d',
      });

      const data = result.data as { analytics: HelpAnalytics };
      setAnalytics(data.analytics);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  };

  const handleCreateTopic = async () => {
    try {
      const createHelpTopic = httpsCallable(functions, 'createHelpTopic');
      await createHelpTopic(formData);
      setDialogOpen(false);
      setFormData({
        title: '',
        category: '',
        audience: [],
        summary: '',
        body: '',
        relatedComponents: [],
        status: 'draft',
        priority: 1,
      });
      fetchAllTopics();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateTopic = async () => {
    if (!editingTopic) return;
    try {
      const updateHelpTopic = httpsCallable(functions, 'updateHelpTopic');
      await updateHelpTopic({
        topicId: editingTopic.id,
        updates: formData,
      });
      setDialogOpen(false);
      setEditingTopic(null);
      setFormData({
        title: '',
        category: '',
        audience: [],
        summary: '',
        body: '',
        relatedComponents: [],
        status: 'draft',
        priority: 1,
      });
      fetchAllTopics();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEditTopic = (topic: HelpTopic) => {
    setEditingTopic(topic);
    setFormData({
      title: topic.title,
      category: topic.category,
      audience: Array.isArray(topic.audience) ? topic.audience : [],
      summary: topic.summary,
      body: topic.body,
      relatedComponents: topic.relatedComponents || [],
      status: topic.status,
      priority: topic.priority,
    });
    setDialogOpen(true);
  };

  const handleGenerateDrafts = async () => {
    try {
      setError(null);
      const generateHelpDraftsFromCode = httpsCallable(functions, 'generateHelpDraftsFromCode');
      const result = await generateHelpDraftsFromCode({
        userId: user?.uid,
        limit: 5,
      });
      const data = result.data as { draftsGenerated: number; message: string };
      fetchAllTopics();
      alert(data.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateArticles = async () => {
    try {
      const updateHelpArticlesWithNewInfo = httpsCallable(functions, 'updateHelpArticlesWithNewInfo');
      const result = await updateHelpArticlesWithNewInfo({ userId: user?.uid });
      const data = result.data as { updatedCount: number; message: string };
      setError(null);
      fetchAllTopics();
      alert(data.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getFilteredTopics = (tabIdx: number, sourceTopics?: HelpTopic[]) => {
    const list = sourceTopics || allTopics;
    switch (tabIdx) {
      case 1:
        return list.filter((topic) => topic.status === 'draft');
      case 2:
        return list.filter((topic) => topic.status === 'published');
      case 3:
        return list.filter((topic) => topic.status === 'archived');
      default:
        return list;
    }
  };

  const getConfusionScore = (topic: HelpTopic) => {
    const total = topic.thumbsUp + topic.thumbsDown;
    if (total === 0) return 0;
    return Math.round((topic.thumbsDown / total) * 100);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h3" gutterBottom>
            Help Content Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage help topics, review feedback, and track usage analytics
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

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab label={`All Topics (${allTopics.length})`} />
          <Tab
            label={
              <Badge
                badgeContent={allTopics.filter((t) => t.status === 'draft').length}
                color="primary"
              >
                Drafts
              </Badge>
            }
          />
          <Tab
            label={
              <Badge
                badgeContent={allTopics.filter((t) => t.status === 'published').length}
                color="success"
              >
                Published
              </Badge>
            }
          />
          <Tab
            label={
              <Badge
                badgeContent={allTopics.filter((t) => t.status === 'archived').length}
                color="default"
              >
                Archived
              </Badge>
            }
          />
          <Tab label="Analytics" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <HelpTopicsTable
          topics={getFilteredTopics(tabValue)}
          onEdit={handleEditTopic}
          onRefresh={() => fetchAllTopics()}
          functions={functions}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <HelpTopicsTable
          topics={getFilteredTopics(tabValue)}
          onEdit={handleEditTopic}
          onRefresh={() => fetchAllTopics()}
          functions={functions}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <HelpTopicsTable
          topics={getFilteredTopics(tabValue)}
          onEdit={handleEditTopic}
          onRefresh={() => fetchAllTopics()}
          functions={functions}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <HelpTopicsTable
          topics={getFilteredTopics(tabValue)}
          onEdit={handleEditTopic}
          onRefresh={() => fetchAllTopics()}
          functions={functions}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <HelpAnalyticsPanel analytics={analytics} />
      </TabPanel>

      {/* Action Buttons */}
      <Box sx={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', gap: 2 }}>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleGenerateDrafts}>
          Generate Drafts
        </Button>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          color="secondary"
          onClick={handleUpdateArticles}
        >
          Update Existing Articles
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingTopic(null);
            setFormData({
              title: '',
              category: '',
              audience: [],
              summary: '',
              body: '',
              relatedComponents: [],
              status: 'draft',
              priority: 1,
            });
            setDialogOpen(true);
          }}
        >
          Create Topic
        </Button>
      </Box>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingTopic ? 'Edit Help Topic' : 'Create Help Topic'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={formData.category}
                  label="Category"
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  {categories.map((category) => (
                    <MenuItem key={category} value={category}>
                      {category}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status}
                  label="Status"
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  {statuses.map((status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Audience</InputLabel>
                <Select
                  multiple
                  value={formData.audience}
                  label="Audience"
                  onChange={(e) =>
                    setFormData({ ...formData, audience: e.target.value as string[] })
                  }
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(selected as string[]).map((value) => (
                        <Chip
                          key={value}
                          label={value}
                          onDelete={() =>
                            setFormData((prev) => ({
                              ...prev,
                              audience: prev.audience.filter((a) => a !== value),
                            }))
                          }
                        />
                      ))}
                    </Box>
                  )}
                >
                  {audiences.map((audience) => (
                    <MenuItem key={audience} value={audience}>
                      {audience}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Summary"
                multiline
                rows={2}
                value={formData.summary}
                onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Content (Markdown)"
                multiline
                rows={10}
                value={formData.body}
                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                helperText="Use Markdown formatting for rich content"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Related Components (comma-separated)"
                value={formData.relatedComponents.join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    relatedComponents: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter((s) => s),
                  })
                }
                helperText="Component IDs that this help topic relates to"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="number"
                label="Priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                inputProps={{ min: 1, max: 10 }}
                helperText="1 = highest priority, 10 = lowest. Higher priority topics appear first in results."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={editingTopic ? handleUpdateTopic : handleCreateTopic}
            variant="contained"
          >
            {editingTopic ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Help Topics Table Component
interface HelpTopicsTableProps {
  topics: HelpTopic[];
  onEdit: (topic: HelpTopic) => void;
  onRefresh: () => void;
  functions: any;
}

const HelpTopicsTable: React.FC<HelpTopicsTableProps> = ({ topics = [], onEdit, onRefresh, functions }) => {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const getConfusionScore = (topic: HelpTopic) => {
    const total = topic.thumbsUp + topic.thumbsDown;
    if (total === 0) return 0;
    return Math.round((topic.thumbsDown / total) * 100);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTopics(topics.map(topic => topic.id));
    } else {
      setSelectedTopics([]);
    }
  };

  const handleSelectTopic = (topicId: string, checked: boolean) => {
    if (checked) {
      setSelectedTopics(prev => [...prev, topicId]);
    } else {
      setSelectedTopics(prev => prev.filter(id => id !== topicId));
    }
  };

  const handleMassPublish = async () => {
    if (selectedTopics.length === 0) return;
    
    setLoading(true);
    try {
      const updateHelpTopic = httpsCallable(functions, 'updateHelpTopic');
      const promises = selectedTopics.map(topicId =>
        updateHelpTopic({
          topicId,
          updates: {
            status: 'published',
            priority: 5,
            lastUpdated: new Date()
          }
        })
      );
      
      await Promise.all(promises);
      setSelectedTopics([]);
      onRefresh();
    } catch (error) {
      console.error('Error mass publishing topics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMassDelete = async () => {
    if (selectedTopics.length === 0) return;
    
    if (!window.confirm(`Are you sure you want to delete ${selectedTopics.length} topic(s)?`)) {
      return;
    }
    
    setLoading(true);
    try {
      const deleteHelpTopic = httpsCallable(functions, 'deleteHelpTopic');
      const promises = selectedTopics.map(topicId =>
        deleteHelpTopic({ topicId })
      );
      
      await Promise.all(promises);
      setSelectedTopics([]);
      onRefresh();
    } catch (error) {
      console.error('Error mass deleting topics:', error);
    } finally {
      setLoading(false);
    }
  };

  const isAllSelected = topics.length > 0 && selectedTopics.length === topics.length;
  const isIndeterminate = selectedTopics.length > 0 && selectedTopics.length < topics.length;

  return (
    <Box>
      {/* Bulk Actions */}
      {selectedTopics.length > 0 && (
        <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
          <Typography variant="body2">
            {selectedTopics.length} topic(s) selected
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={handleMassPublish}
            disabled={loading}
          >
            {loading ? 'Publishing...' : `Publish ${selectedTopics.length} Topic(s)`}
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={handleMassDelete}
            disabled={loading}
          >
            {loading ? 'Deleting...' : `Delete ${selectedTopics.length} Topic(s)`}
          </Button>
        </Box>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Audience</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Usage</TableCell>
              <TableCell>Feedback</TableCell>
              <TableCell>Confusion</TableCell>
              <TableCell>Last Updated</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {topics.map((topic) => (
              <TableRow key={topic.id}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedTopics.includes(topic.id)}
                    onChange={(e) => handleSelectTopic(topic.id, e.target.checked)}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle2">{topic.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {topic.summary}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={topic.category} size="small" color="primary" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {(topic.audience ?? []).map((audience) => (
                      <Chip key={audience} label={audience} size="small" variant="outlined" />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={topic.status}
                    size="small"
                    color={
                      topic.status === 'published'
                        ? 'success'
                        : topic.status === 'draft'
                        ? 'warning'
                        : 'default'
                    }
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{topic.usageCount}</Typography>
                </TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <ThumbUpIcon fontSize="small" color="success" />
                    <Typography variant="body2">{topic.thumbsUp}</Typography>
                    <ThumbDownIcon fontSize="small" color="error" />
                    <Typography variant="body2">{topic.thumbsDown}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    color={getConfusionScore(topic) > 50 ? 'error' : 'text.secondary'}
                  >
                    {getConfusionScore(topic)}%
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {topic.lastUpdated && !isNaN(new Date(topic.lastUpdated).getTime())
                      ? new Date(topic.lastUpdated).toLocaleDateString()
                      : ''}
                  </Typography>
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => onEdit(topic)}>
                    <EditIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

// Help Analytics Panel Component
interface HelpAnalyticsPanelProps {
  analytics: HelpAnalytics | null;
}

const HelpAnalyticsPanel: React.FC<HelpAnalyticsPanelProps> = ({ analytics }) => {
  if (!analytics) {
    return (
      <Box textAlign="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Usage Overview
            </Typography>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h4">{analytics.totalUsage}</Typography>
              <Typography variant="body2" color="text.secondary">
                Total Help Views
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
              <Typography variant="h4">{analytics.uniqueUsers}</Typography>
              <Typography variant="body2" color="text.secondary">
                Unique Users
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Feedback Breakdown
            </Typography>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center">
                <ThumbUpIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h4">{analytics.feedbackBreakdown.thumbsUp}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Helpful
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
              <Box display="flex" alignItems="center">
                <ThumbDownIcon color="error" sx={{ mr: 1 }} />
                <Typography variant="h4">{analytics.feedbackBreakdown.thumbsDown}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Not Helpful
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Most Used Components
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Component</TableCell>
                    <TableCell>Help Views</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(analytics.mostUsedComponents)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([component, count]) => (
                      <TableRow key={component}>
                        <TableCell>{component}</TableCell>
                        <TableCell>{count}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

export default HelpManagement;
