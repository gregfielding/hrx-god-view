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
  LinearProgress,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Badge,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Archive as ArchiveIcon,
  Tag as TagIcon,
  Score as ScoreIcon,
  Visibility as VisibilityIcon,
  Settings as SettingsIcon,
  DataUsage as DataUsageIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

interface VectorCollection {
  id: string;
  name: string;
  description: string;
  vectorCount: number;
  avgLatency: number;
  lastIndexed: Date;
  status: 'active' | 'indexing' | 'error' | 'inactive';
  dimensions: number;
  similarityThreshold: number;
  maxResults: number;
}

interface VectorChunk {
  id: string;
  content: string;
  tags: string[];
  score: number;
  source: string;
  tenantId: string;
  createdAt: Date;
  lastUsed: Date;
  embeddingModel: string;
  dimensions: number;
  archived: boolean;
}

interface VectorStats {
  totalVectors: number;
  totalCollections: number;
  avgSearchLatency: number;
  indexingStatus: 'idle' | 'running' | 'completed' | 'error';
  lastFullIndex: Date;
  storageUsed: string;
  activeChunks: number;
  archivedChunks: number;
  avgScore: number;
}

const VectorSettings: React.FC = (): JSX.Element => {
  const [collections, setCollections] = useState<VectorCollection[]>([]);
  const [chunks, setChunks] = useState<VectorChunk[]>([]);
  const [stats, setStats] = useState<VectorStats>({
    totalVectors: 0,
    totalCollections: 0,
    avgSearchLatency: 0,
    indexingStatus: 'idle',
    lastFullIndex: new Date(),
    storageUsed: '0 MB',
    activeChunks: 0,
    archivedChunks: 0,
    avgScore: 0,
  });
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [detailsDialog, setDetailsDialog] = useState(false);
  const [chunkDialog, setChunkDialog] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<VectorCollection | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<VectorChunk | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchFilters, setSearchFilters] = useState({
    source: '',
    tenantId: '',
    minScore: 0,
    maxScore: 1,
    tags: [] as string[],
  });
  const [editingChunk, setEditingChunk] = useState<VectorChunk | null>(null);
  const [newTags, setNewTags] = useState('');
  const [newScore, setNewScore] = useState(0.5);
  const navigate = useNavigate();

  // Mock data for demonstration
  const mockCollections: VectorCollection[] = [
    {
      id: 'traits',
      name: 'Worker Traits',
      description: 'Embedded worker personality and skill traits',
      vectorCount: 1247,
      avgLatency: 45,
      lastIndexed: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      status: 'active',
      dimensions: 1536,
      similarityThreshold: 0.8,
      maxResults: 10,
    },
    {
      id: 'moments',
      name: 'AI Moments',
      description: 'Conversation moments and interaction patterns',
      vectorCount: 892,
      avgLatency: 32,
      lastIndexed: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      status: 'active',
      dimensions: 1536,
      similarityThreshold: 0.75,
      maxResults: 5,
    },
    {
      id: 'feedback',
      name: 'Feedback Responses',
      description: 'Employee feedback and survey responses',
      vectorCount: 567,
      avgLatency: 28,
      lastIndexed: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      status: 'active',
      dimensions: 1536,
      similarityThreshold: 0.85,
      maxResults: 8,
    },
    {
      id: 'job_postings',
      name: 'Job Postings',
      description: 'Job descriptions and requirements',
      vectorCount: 234,
      avgLatency: 38,
      lastIndexed: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
      status: 'indexing',
      dimensions: 1536,
      similarityThreshold: 0.7,
      maxResults: 12,
    },
  ];

  const mockChunks: VectorChunk[] = [
    {
      id: 'chunk1',
      content: 'Worker shows strong communication skills and team collaboration abilities',
      tags: ['communication', 'teamwork', 'positive'],
      score: 0.92,
      source: 'feedback',
      tenantId: 'customer1',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastUsed: new Date(Date.now() - 2 * 60 * 60 * 1000),
      embeddingModel: 'text-embedding-ada-002',
      dimensions: 1536,
      archived: false,
    },
    {
      id: 'chunk2',
      content: 'Safety protocols must be followed at all times in the workplace',
      tags: ['safety', 'compliance', 'mandatory'],
      score: 0.88,
      source: 'policy',
      tenantId: 'customer1',
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      lastUsed: new Date(Date.now() - 1 * 60 * 60 * 1000),
      embeddingModel: 'text-embedding-ada-002',
      dimensions: 1536,
      archived: false,
    },
    {
      id: 'chunk3',
      content: 'Worker demonstrates excellent problem-solving skills and initiative',
      tags: ['problem-solving', 'initiative', 'positive'],
      score: 0.85,
      source: 'feedback',
      tenantId: 'customer2',
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      lastUsed: new Date(Date.now() - 4 * 60 * 60 * 1000),
      embeddingModel: 'text-embedding-ada-002',
      dimensions: 1536,
      archived: false,
    },
  ];

  useEffect(() => {
    fetchVectorData();
  }, []);

  const fetchVectorData = async () => {
    setLoading(true);
    try {
      const functions = getFunctions(app);
      const getVectorCollections = httpsCallable(functions, 'getVectorCollections');
      const result = await getVectorCollections();
      const data = result.data as { collections: VectorCollection[] };

      setCollections(data.collections || mockCollections);
      setChunks(mockChunks);

      // Calculate stats
      const totalVectors = (data.collections || mockCollections).reduce(
        (sum, col) => sum + col.vectorCount,
        0,
      );
      const avgLatency =
        (data.collections || mockCollections).length > 0
          ? (data.collections || mockCollections).reduce((sum, col) => sum + col.avgLatency, 0) /
            (data.collections || mockCollections).length
          : 0;

      const activeChunks = mockChunks.filter((chunk) => !chunk.archived).length;
      const archivedChunks = mockChunks.filter((chunk) => chunk.archived).length;
      const avgScore =
        mockChunks.length > 0
          ? mockChunks.reduce((sum, chunk) => sum + chunk.score, 0) / mockChunks.length
          : 0;

      setStats({
        totalVectors,
        totalCollections: (data.collections || mockCollections).length,
        avgSearchLatency: Math.round(avgLatency),
        indexingStatus: 'idle',
        lastFullIndex: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        storageUsed: `${Math.round(totalVectors * 0.002)} MB`, // Rough estimate
        activeChunks,
        archivedChunks,
        avgScore: Math.round(avgScore * 100) / 100,
      });
    } catch (err: any) {
      setError('Failed to fetch vector data');
      setCollections(mockCollections);
      setChunks(mockChunks);
    }
    setLoading(false);
  };

  const handleReindex = async (collectionId?: string) => {
    setReindexing(true);
    try {
      if (collectionId) {
        // Reindex specific collection
        setCollections((prev) =>
          prev.map((col) => (col.id === collectionId ? { ...col, status: 'indexing' } : col)),
        );

        // Simulate indexing process
        setTimeout(() => {
          setCollections((prev) =>
            prev.map((col) =>
              col.id === collectionId
                ? {
                    ...col,
                    status: 'active',
                    lastIndexed: new Date(),
                    vectorCount: Math.floor(col.vectorCount * (0.9 + Math.random() * 0.2)), // Simulate count change
                  }
                : col,
            ),
          );
          setSuccess(
            `Collection "${
              collections.find((c) => c.id === collectionId)?.name
            }" reindexed successfully`,
          );
          setReindexing(false);
        }, 3000);
      } else {
        // Full reindex
        setStats((prev) => ({ ...prev, indexingStatus: 'running' }));
        setCollections((prev) => prev.map((col) => ({ ...col, status: 'indexing' })));

        setTimeout(() => {
          setCollections((prev) =>
            prev.map((col) => ({
              ...col,
              status: 'active',
              lastIndexed: new Date(),
              vectorCount: Math.floor(col.vectorCount * (0.9 + Math.random() * 0.2)),
            })),
          );
          setStats((prev) => ({ ...prev, indexingStatus: 'completed' }));
          setSuccess('All collections reindexed successfully');
          setReindexing(false);
        }, 5000);
      }
    } catch (err: any) {
      setError('Failed to reindex collection');
      setReindexing(false);
    }
  };

  const handleViewDetails = (collection: VectorCollection) => {
    setSelectedCollection(collection);
    setDetailsDialog(true);
  };

  const handleViewChunk = (chunk: VectorChunk) => {
    setSelectedChunk(chunk);
    setChunkDialog(true);
  };

  const handleEditChunk = (chunk: VectorChunk) => {
    setEditingChunk(chunk);
    setNewTags(chunk.tags.join(', '));
    setNewScore(chunk.score);
    setChunkDialog(true);
  };

  const handleSaveChunk = async () => {
    if (!editingChunk) return;

    try {
      const functions = getFunctions(app);

      // Update tags
      if (newTags !== editingChunk.tags.join(', ')) {
        const tagChunk = httpsCallable(functions, 'tagChunk');
        await tagChunk({
          chunkId: editingChunk.id,
          tagList: newTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          userId: 'current_user',
        });
      }

      // Update score
      if (Math.abs(newScore - editingChunk.score) > 0.01) {
        const rescoreVectorChunk = httpsCallable(functions, 'rescoreVectorChunk');
        await rescoreVectorChunk({
          chunkId: editingChunk.id,
          newScore,
          userId: 'current_user',
        });
      }

      // Update local state
      setChunks((prev) =>
        prev.map((chunk) =>
          chunk.id === editingChunk.id
            ? {
                ...chunk,
                tags: newTags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                score: newScore,
              }
            : chunk,
        ),
      );

      setChunkDialog(false);
      setEditingChunk(null);
      setSuccess('Chunk updated successfully');
    } catch (err: any) {
      setError('Failed to update chunk');
    }
  };

  const handleArchiveChunk = async (chunkId: string) => {
    try {
      const functions = getFunctions(app);
      const archiveVectorChunk = httpsCallable(functions, 'archiveVectorChunk');
      await archiveVectorChunk({
        chunkId,
        userId: 'current_user',
      });

      setChunks((prev) =>
        prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, archived: true } : chunk)),
      );

      setSuccess('Chunk archived successfully');
    } catch (err: any) {
      setError('Failed to archive chunk');
    }
  };

  const handleSearch = () => {
    // Filter chunks based on search criteria
    const filtered = mockChunks.filter((chunk) => {
      const matchesSearch =
        !searchTerm ||
        chunk.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        chunk.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesSource = !searchFilters.source || chunk.source === searchFilters.source;
      const matchesCustomer =
        !searchFilters.tenantId || chunk.tenantId === searchFilters.tenantId;
      const matchesScore =
        chunk.score >= searchFilters.minScore && chunk.score <= searchFilters.maxScore;

      return matchesSearch && matchesSource && matchesCustomer && matchesScore;
    });

    setChunks(filtered);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
      active: 'success',
      indexing: 'warning',
      error: 'error',
      inactive: 'default',
    };
    return colors[status] || 'default';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircleIcon />;
      case 'indexing':
        return <CircularProgress size={20} />;
      case 'error':
        return <ErrorIcon />;
      case 'inactive':
        return <StopIcon />;
      default:
        return <WarningIcon />;
    }
  };

  const formatLatency = (latency: number) => {
    return `${latency}ms`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const truncateText = (text: string, maxLength = 100) => {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h3" >
            Vector Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage vector embeddings, search settings, and chunk lifecycle
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
                <StorageIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.totalVectors.toLocaleString()}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Total Vectors
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <SpeedIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.avgSearchLatency}ms</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Avg Search Latency
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <DataUsageIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.storageUsed}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Storage Used
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <ScoreIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">{stats.avgScore}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Avg Relevance Score
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Collections Overview */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">Vector Collections</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchVectorData}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => handleReindex()}
              disabled={reindexing}
            >
              {reindexing ? 'Reindexing...' : 'Full Reindex'}
            </Button>
          </Box>
        </Box>

        {loading ? (
          <LinearProgress />
        ) : (
          <Grid container spacing={3}>
            {collections.map((collection) => (
              <Grid item xs={12} md={6} key={collection.id}>
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
                          {collection.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {collection.description}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="View Details">
                          <IconButton size="small" onClick={() => handleViewDetails(collection)}>
                            <VisibilityIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Reindex Collection">
                          <IconButton
                            size="small"
                            onClick={() => handleReindex(collection.id)}
                            disabled={collection.status === 'indexing'}
                          >
                            <RefreshIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                      <Chip
                        icon={getStatusIcon(collection.status)}
                        label={collection.status}
                        color={getStatusColor(collection.status)}
                        size="small"
                      />
                      <Chip
                        label={`${collection.vectorCount.toLocaleString()} vectors`}
                        variant="outlined"
                        size="small"
                      />
                      <Chip label={`${collection.dimensions}d`} variant="outlined" size="small" />
                    </Box>

                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Latency: {formatLatency(collection.avgLatency)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Last indexed: {formatDate(collection.lastIndexed)}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Paper>

      {/* Vector Chunks Browser */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">Vector Chunks Browser</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {chunks.filter((c) => !c.archived).length} active /{' '}
              {chunks.filter((c) => c.archived).length} archived
            </Typography>
          </Box>
        </Box>

        {/* Search and Filters */}
        <Box sx={{ mb: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                label="Search chunks"
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
                <InputLabel>Source</InputLabel>
                <Select
                  value={searchFilters.source}
                  label="Source"
                  onChange={(e) =>
                    setSearchFilters((prev) => ({ ...prev, source: e.target.value }))
                  }
                >
                  <MenuItem value="">All Sources</MenuItem>
                  <MenuItem value="feedback">Feedback</MenuItem>
                  <MenuItem value="policy">Policy</MenuItem>
                  <MenuItem value="training">Training</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Customer</InputLabel>
                <Select
                  value={searchFilters.tenantId}
                  label="Customer"
                  onChange={(e) =>
                    setSearchFilters((prev) => ({ ...prev, tenantId: e.target.value }))
                  }
                >
                  <MenuItem value="">All Customers</MenuItem>
                  <MenuItem value="customer1">Customer 1</MenuItem>
                  <MenuItem value="customer2">Customer 2</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button variant="contained" onClick={handleSearch} fullWidth>
                Search
              </Button>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                variant="outlined"
                onClick={() => {
                  setSearchTerm('');
                  setSearchFilters({
                    source: '',
                    tenantId: '',
                    minScore: 0,
                    maxScore: 1,
                    tags: [],
                  });
                  setChunks(mockChunks);
                }}
                fullWidth
              >
                Clear
              </Button>
            </Grid>
          </Grid>
        </Box>

        {/* Chunks Table */}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Content</TableCell>
                <TableCell>Tags</TableCell>
                <TableCell>Score</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Last Used</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chunks
                .filter((chunk) => !chunk.archived)
                .map((chunk) => (
                  <TableRow key={chunk.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 300 }}>
                        {truncateText(chunk.content)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {chunk.tags.map((tag) => (
                          <Chip key={tag} label={tag} size="small" />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color={chunk.score > 0.8 ? 'success.main' : 'text.secondary'}
                      >
                        {chunk.score.toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={chunk.source} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(chunk.lastUsed)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="View Details">
                          <IconButton size="small" onClick={() => handleViewChunk(chunk)}>
                            <VisibilityIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Chunk">
                          <IconButton size="small" onClick={() => handleEditChunk(chunk)}>
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Archive Chunk">
                          <IconButton
                            size="small"
                            color="warning"
                            onClick={() => handleArchiveChunk(chunk.id)}
                          >
                            <ArchiveIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Collection Details Dialog */}
      <Dialog open={detailsDialog} onClose={() => setDetailsDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{selectedCollection?.name} - Collection Details</DialogTitle>
        <DialogContent>
          {selectedCollection && (
            <Box>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {selectedCollection.description}
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Performance
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Average Latency"
                            secondary={formatLatency(selectedCollection.avgLatency)}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Vector Count"
                            secondary={selectedCollection.vectorCount.toLocaleString()}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Dimensions"
                            secondary={`${selectedCollection.dimensions}d`}
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Settings
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Similarity Threshold"
                            secondary={selectedCollection.similarityThreshold}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Max Results"
                            secondary={selectedCollection.maxResults}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Last Indexed"
                            secondary={formatDate(selectedCollection.lastIndexed)}
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Chunk Details/Edit Dialog */}
      <Dialog open={chunkDialog} onClose={() => setChunkDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingChunk ? 'Edit Chunk' : 'Chunk Details'}</DialogTitle>
        <DialogContent>
          {selectedChunk && (
            <Box>
              {editingChunk ? (
                <Grid container spacing={3} sx={{ mt: 1 }}>
                  <Grid item xs={12}>
                    <TextField
                      label="Content"
                      value={selectedChunk.content}
                      fullWidth
                      multiline
                      rows={4}
                      disabled
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Tags (comma-separated)"
                      value={newTags}
                      onChange={(e) => setNewTags(e.target.value)}
                      fullWidth
                      helperText="Enter tags separated by commas"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" gutterBottom>
                      Relevance Score: {newScore}
                    </Typography>
                    <Slider
                      value={newScore}
                      onChange={(_, value) => setNewScore(value as number)}
                      min={0}
                      max={1}
                      step={0.01}
                      marks
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                </Grid>
              ) : (
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Content
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}
                  >
                    {selectedChunk.content}
                  </Typography>

                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="h6" gutterBottom>
                        Metadata
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Score"
                            secondary={selectedChunk.score.toFixed(3)}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText primary="Source" secondary={selectedChunk.source} />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Created"
                            secondary={formatDate(selectedChunk.createdAt)}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Last Used"
                            secondary={formatDate(selectedChunk.lastUsed)}
                          />
                        </ListItem>
                      </List>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="h6" gutterBottom>
                        Tags
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                        {selectedChunk.tags.map((tag) => (
                          <Chip key={tag} label={tag} />
                        ))}
                      </Box>

                      <Typography variant="h6" gutterBottom>
                        Technical Info
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText
                            primary="Embedding Model"
                            secondary={selectedChunk.embeddingModel}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Dimensions"
                            secondary={`${selectedChunk.dimensions}d`}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText
                            primary="Customer ID"
                            secondary={selectedChunk.tenantId}
                          />
                        </ListItem>
                      </List>
                    </Grid>
                  </Grid>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChunkDialog(false)}>Cancel</Button>
          {editingChunk && (
            <Button onClick={handleSaveChunk} variant="contained">
              Save Changes
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

export default VectorSettings;
