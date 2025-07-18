import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
  Alert,
  Rating,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  Close as CloseIcon,
  Help as HelpIcon,
  Search as SearchIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  Bookmark as BookmarkIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import ReactMarkdown from 'react-markdown';

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

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  componentId: string;
  title?: string;
}

const HelpDrawer: React.FC<HelpDrawerProps> = ({ open, onClose, componentId, title = 'Help' }) => {
  const { user } = useAuth();
  const functions = getFunctions();

  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [relatedTopics, setRelatedTopics] = useState<HelpTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTopics, setFilteredTopics] = useState<HelpTopic[]>([]);

  useEffect(() => {
    if (open && componentId) {
      fetchHelpForComponent();
      fetchRelatedTopics();
    }
  }, [open, componentId]);

  useEffect(() => {
    if (searchQuery) {
      searchHelpTopics();
    } else {
      setFilteredTopics(topics);
    }
  }, [searchQuery, topics]);

  const fetchHelpForComponent = async () => {
    try {
      setLoading(true);
      setError(null);

      const getHelpForComponent = httpsCallable(functions, 'getHelpForComponent');
      const result = await getHelpForComponent({ componentId });

      const data = result.data as { topics: HelpTopic[] };
      setTopics(data.topics);
      setFilteredTopics(data.topics);

      // Log usage
      await logHelpUsage(componentId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRelatedTopics = async () => {
    try {
      const suggestRelatedHelpTopics = httpsCallable(functions, 'suggestRelatedHelpTopics');
      const result = await suggestRelatedHelpTopics({ componentId });

      const data = result.data as { topics: HelpTopic[] };
      setRelatedTopics(data.topics);
    } catch (err) {
      console.error('Failed to fetch related topics:', err);
    }
  };

  const searchHelpTopics = async () => {
    try {
      const searchHelpTopics = httpsCallable(functions, 'searchHelpTopics');
      const result = await searchHelpTopics({
        query: searchQuery,
        limit: 10,
      });

      const data = result.data as { topics: HelpTopic[] };
      setFilteredTopics(data.topics);
    } catch (err) {
      console.error('Failed to search help topics:', err);
    }
  };

  const logHelpUsage = async (compId: string) => {
    try {
      const logHelpUsage = httpsCallable(functions, 'logHelpUsage');
      await logHelpUsage({
        componentId: compId,
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
        componentId,
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

  const handleTopicClick = (topic: HelpTopic) => {
    // Update the current topics list to show the selected topic
    setTopics([topic]);
    setFilteredTopics([topic]);
    logHelpUsage(componentId);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDrawer-paper': {
          width: { xs: '100%', sm: 500 },
          p: 3,
        },
      }}
    >
      <Box>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <Box display="flex" alignItems="center">
            <HelpIcon sx={{ mr: 1 }} />
            <Typography variant="h6">{title}</Typography>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Search */}
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

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Help Topics */}
            {filteredTopics.length > 0 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom>
                  Help Topics
                </Typography>
                <List>
                  {filteredTopics.map((topic) => (
                    <React.Fragment key={topic.id}>
                      <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        <Box width="100%">
                          <Typography variant="subtitle1" gutterBottom>
                            {topic.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {topic.summary}
                          </Typography>
                          <Box display="flex" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
                            <Chip
                              label={topic.category}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                            {topic.audience.map((audience) => (
                              <Chip
                                key={audience}
                                label={audience}
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Box>
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Typography variant="caption" color="text.secondary">
                              {topic.usageCount} views
                            </Typography>
                            <Box display="flex" gap={0.5}>
                              <IconButton
                                size="small"
                                onClick={() => handleFeedback(topic.id, 'thumbs_up')}
                                disabled={feedbackLoading === topic.id}
                              >
                                <ThumbUpIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() => handleFeedback(topic.id, 'thumbs_down')}
                                disabled={feedbackLoading === topic.id}
                              >
                                <ThumbDownIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </Box>
                        </Box>
                      </ListItem>
                      <Divider />
                    </React.Fragment>
                  ))}
                </List>
              </Box>
            )}

            {/* Topic Content */}
            {filteredTopics.length === 1 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom>
                  {filteredTopics[0].title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {filteredTopics[0].summary}
                </Typography>
                <Box sx={{ mb: 3 }}>
                  <ReactMarkdown>{filteredTopics[0].body}</ReactMarkdown>
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    Last updated: {new Date(filteredTopics[0].lastUpdated).toLocaleDateString()}
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setTopics([]);
                      setFilteredTopics([]);
                      setSearchQuery('');
                    }}
                  >
                    Back to Topics
                  </Button>
                </Box>
              </Box>
            )}

            {/* Related Topics */}
            {relatedTopics.length > 0 && filteredTopics.length !== 1 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Related Topics
                </Typography>
                <List dense>
                  {relatedTopics.slice(0, 3).map((topic) => (
                    <ListItem
                      key={topic.id}
                      button
                      onClick={() => handleTopicClick(topic)}
                      sx={{ flexDirection: 'column', alignItems: 'flex-start' }}
                    >
                      <Typography variant="subtitle2" gutterBottom>
                        {topic.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {topic.summary}
                      </Typography>
                      <Box display="flex" gap={1} sx={{ mt: 1 }}>
                        <Chip label={topic.category} size="small" variant="outlined" />
                        <Typography variant="caption" color="text.secondary">
                          {topic.usageCount} views
                        </Typography>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* No Results */}
            {filteredTopics.length === 0 && !loading && (
              <Box textAlign="center" py={4}>
                <HelpIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No help topics found
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {searchQuery
                    ? `No topics match "${searchQuery}"`
                    : `No help topics available for this component`}
                </Typography>
                {searchQuery && (
                  <Button variant="outlined" sx={{ mt: 2 }} onClick={() => setSearchQuery('')}>
                    Clear Search
                  </Button>
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
};

export default HelpDrawer;
