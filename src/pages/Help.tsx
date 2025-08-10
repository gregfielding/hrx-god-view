import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardContent,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Search as SearchIcon,
  Category as CategoryIcon,
  Person as PersonIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  Close as CloseIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import ReactMarkdown from 'react-markdown';

import { useAuth } from '../contexts/AuthContext';

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
      id={`help-tabpanel-${index}`}
      aria-labelledby={`help-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const Help: React.FC = () => {
  const { user } = useAuth();
  const functions = getFunctions();

  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [filteredTopics, setFilteredTopics] = useState<HelpTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedAudience, setSelectedAudience] = useState<string>('');
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);

  const categories = [
    'AI Launchpad',
    'Vector Settings',
    'Retrieval Filters',
    'Context Engine',
    'Analytics',
    'Onboarding',
    'Broadcasts',
    'AI Chat',
    'Feedback Engine',
    'General',
  ];

  const audiences = ['7', '6', '5', '4', '3', '2', '1', '0'];

  useEffect(() => {
    fetchHelpTopics();
  }, []);

  useEffect(() => {
    filterTopics();
  }, [topics, searchQuery, selectedCategory, selectedAudience]);

  const fetchHelpTopics = async () => {
    try {
      setLoading(true);
      const getHelpTopics = httpsCallable(functions, 'getHelpTopics');
      const result = await getHelpTopics({
        status: 'published',
        limit: 100,
      });

      const data = result.data as { topics?: HelpTopic[] };
      setTopics(data.topics ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filterTopics = () => {
    let filtered = topics;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (topic) =>
          topic.title.toLowerCase().includes(query) ||
          topic.summary.toLowerCase().includes(query) ||
          topic.body.toLowerCase().includes(query),
      );
    }

    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter((topic) => topic.category === selectedCategory);
    }

    // Filter by audience
    if (selectedAudience) {
      filtered = filtered.filter((topic) => topic.audience.includes(selectedAudience));
    }

    setFilteredTopics(filtered);
  };

  const handleTopicClick = (topic: HelpTopic) => {
    setSelectedTopic(topic);
    setDrawerOpen(true);
    logHelpUsage(topic.id);
  };

  const logHelpUsage = async (topicId: string) => {
    try {
      const logHelpUsage = httpsCallable(functions, 'logHelpUsage');
      await logHelpUsage({
        componentId: 'help_page',
        helpTopicId: topicId,
      });
    } catch (err) {
      console.error('Failed to log help usage:', err);
    }
  };

  const handleFeedback = async (topicId: string, feedback: 'thumbs_up' | 'thumbs_down') => {
    try {
      setFeedbackLoading(topicId);
      const logHelpUsage = httpsCallable(functions, 'logHelpUsage');
      await logHelpUsage({
        componentId: 'help_page',
        helpTopicId: topicId,
        feedback,
      });

      // Update local state
      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                [feedback === 'thumbs_up' ? 'thumbsUp' : 'thumbsDown']:
                  topic[feedback === 'thumbs_up' ? 'thumbsUp' : 'thumbsDown'] + 1,
              }
            : topic,
        ),
      );
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setFeedbackLoading(null);
    }
  };

  const getPopularTopics = () => {
    return [...topics].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);
  };

  const getRecentTopics = () => {
    return [...topics]
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
      .slice(0, 5);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container sx={{ p: 0 }}>
      <Box sx={{ mb: 4, py: 0 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {/* <HelpIcon sx={{ mr: 2, verticalAlign: 'middle' }} /> */}
          Help & Documentation
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Find answers to your questions about the HRX AI Launchpad platform
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left Sidebar */}
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <CategoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Categories
              </Typography>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Category</InputLabel>
                <Select
                  value={selectedCategory}
                  label="Category"
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <MenuItem value="">All Categories</MenuItem>
                  {categories.map((category) => (
                    <MenuItem key={category} value={category}>
                      {category}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Audience
              </Typography>
              <FormControl fullWidth>
                <InputLabel>Audience</InputLabel>
                <Select
                  value={selectedAudience}
                  label="Audience"
                  onChange={(e) => setSelectedAudience(e.target.value)}
                >
                  <MenuItem value="">All Users</MenuItem>
                  {audiences.map((audience) => (
                    <MenuItem key={audience} value={audience}>
                      {audience}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <TrendingUpIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Popular Topics
              </Typography>
              <List dense>
                {(getPopularTopics() || []).map((topic) => (
                  <ListItem key={topic.id} button onClick={() => handleTopicClick(topic)}>
                    <ListItemText primary={topic.title} secondary={`${topic.usageCount} views`} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Main Content */}
        <Grid item xs={12} md={9}>
          <Card>
            <CardContent>
              <TextField
                fullWidth
                variant="outlined"
                placeholder="Search help topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 3 }}
              />

              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
                  <Tab label={`All Topics (${filteredTopics.length})`} />
                  <Tab label="Popular" />
                  <Tab label="Recent" />
                </Tabs>
              </Box>

              <TabPanel value={tabValue} index={0}>
                <Grid container spacing={2}>
                  {(filteredTopics || []).map((topic) => (
                    <Grid item xs={12} key={topic.id}>
                      <Card
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: 'action.hover' },
                        }}
                        onClick={() => handleTopicClick(topic)}
                      >
                        <CardContent>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="flex-start"
                          >
                            <Box flex={1}>
                              <Typography variant="h6" gutterBottom>
                                {topic.title}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                {topic.summary}
                              </Typography>
                              <Box display="flex" gap={1} flexWrap="wrap">
                                <Chip
                                  label={topic.category}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                                {(topic.audience || []).map((audience) => (
                                  <Chip
                                    key={audience}
                                    label={audience}
                                    size="small"
                                    variant="outlined"
                                  />
                                ))}
                              </Box>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Typography variant="caption" color="text.secondary">
                                {topic.usageCount} views
                              </Typography>
                              <Box display="flex" gap={0.5}>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFeedback(topic.id, 'thumbs_up');
                                  }}
                                  disabled={feedbackLoading === topic.id}
                                >
                                  <ThumbUpIcon fontSize="small" />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFeedback(topic.id, 'thumbs_down');
                                  }}
                                  disabled={feedbackLoading === topic.id}
                                >
                                  <ThumbDownIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </TabPanel>

              <TabPanel value={tabValue} index={1}>
                <Grid container spacing={2}>
                  {(getPopularTopics() || []).map((topic) => (
                    <Grid item xs={12} key={topic.id}>
                      <Card
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: 'action.hover' },
                        }}
                        onClick={() => handleTopicClick(topic)}
                      >
                        <CardContent>
                          <Typography variant="h6" gutterBottom>
                            {topic.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {topic.summary}
                          </Typography>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            sx={{ mt: 2 }}
                          >
                            <Chip
                              label={topic.category}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                            <Typography variant="caption" color="text.secondary">
                              {topic.usageCount} views
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </TabPanel>

              <TabPanel value={tabValue} index={2}>
                <Grid container spacing={2}>
                  {(getRecentTopics() || []).map((topic) => (
                    <Grid item xs={12} key={topic.id}>
                      <Card
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: 'action.hover' },
                        }}
                        onClick={() => handleTopicClick(topic)}
                      >
                        <CardContent>
                          <Typography variant="h6" gutterBottom>
                            {topic.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {topic.summary}
                          </Typography>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            sx={{ mt: 2 }}
                          >
                            <Chip
                              label={topic.category}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                            <Typography variant="caption" color="text.secondary">
                              Updated {new Date(topic.lastUpdated).toLocaleDateString()}
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </TabPanel>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Help Topic Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100%', sm: 600 },
            p: 3,
          },
        }}
      >
        {selectedTopic && (
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
              <Typography variant="h5">{selectedTopic.title}</Typography>
              <IconButton onClick={() => setDrawerOpen(false)}>
                <CloseIcon />
              </IconButton>
            </Box>

            <Box sx={{ mb: 3 }}>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                {selectedTopic.summary}
              </Typography>
              <Box display="flex" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
                <Chip label={selectedTopic.category} color="primary" variant="outlined" />
                {(selectedTopic?.audience || []).map((audience) => (
                  <Chip key={audience} label={audience} variant="outlined" />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">
                Last updated: {new Date(selectedTopic.lastUpdated).toLocaleDateString()}
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 3 }}>
              <ReactMarkdown>{selectedTopic.body}</ReactMarkdown>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                {selectedTopic.usageCount} views
              </Typography>
              <Box display="flex" gap={1}>
                <Button
                  startIcon={<ThumbUpIcon />}
                  onClick={() => handleFeedback(selectedTopic.id, 'thumbs_up')}
                  disabled={feedbackLoading === selectedTopic.id}
                >
                  Helpful ({selectedTopic.thumbsUp})
                </Button>
                <Button
                  startIcon={<ThumbDownIcon />}
                  onClick={() => handleFeedback(selectedTopic.id, 'thumbs_down')}
                  disabled={feedbackLoading === selectedTopic.id}
                >
                  Not Helpful ({selectedTopic.thumbsDown})
                </Button>
              </Box>
            </Box>
          </Box>
        )}
      </Drawer>
    </Container>
  );
};

export default Help;
