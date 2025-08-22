import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  Chip,
  Autocomplete,
  Checkbox,
  Card,
  CardContent,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Badge,
  Avatar,
  Switch,
  FormControlLabel,
  CircularProgress,
  InputAdornment,
  Drawer,
  Tabs,
  Tab,
  Divider,
  Stack,
  Tooltip,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Slider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Search as SearchIcon,
  Save as SaveIcon,
  PlayArrow as RunIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  PersonAdd as AddToCRMIcon,
  List as ListIcon,
  MoreVert as MoreVertIcon,
  FilterList as FilterIcon,
  Bookmark as BookmarkIcon,
  Share as ShareIcon,
  Schedule as ScheduleIcon,
  TrendingUp as TrendingUpIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Work as WorkIcon,
  ExpandMore as ExpandMoreIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Campaign as CampaignIcon,
  Assignment as TaskIcon,
} from '@mui/icons-material';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, updateDoc, deleteDoc, onSnapshot, orderBy, limit } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCRMCache } from '../../contexts/CRMCacheContext';
import EmailTemplatesManager from '../../components/EmailTemplatesManager';

interface ProspectingResult {
  id: string;
  contact: {
    firstName: string;
    lastName: string;
    title: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
  };
  company: {
    name: string;
    domain?: string;
    location?: string;
    industry?: string;
    size?: string;
  };
  scores: {
    staffingFit: number;
    callPriority: number;
    rationale: string;
  };
  opener: string;
  status: 'new' | 'added_to_crm' | 'in_sequence' | 'called' | 'emailed' | 'dismissed';
  signals?: {
    jobPostings?: number;
    funding?: string;
    growth?: string;
    news?: string[];
  };
}

interface SavedSearch {
  id: string;
  name: string;
  prompt: string;
  parsed: {
    roles: string[];
    locations: string[];
    industries: string[];
    listSize: number;
    exclusions?: { companies?: string[]; domains?: string[] };
    intent: 'find_contacts' | 'find_companies' | 'mixed';
  };
  createdByUid: string;
  visibility: 'private' | 'team' | 'company';
  schedule?: { freq: 'none' | 'daily' | 'weekly'; byHour?: number };
  lastRun?: Date;
  resultCount?: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  ownerUid: string;
  visibility: 'private' | 'team' | 'company';
  tags?: string[];
  variables: string[];
}

const ProspectingHub: React.FC = () => {
  const { tenantId, currentUser, role, accessRole } = useAuth();
  const { cacheState } = useCRMCache();
  const functions = getFunctions();

  // Main state
  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState<ProspectingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  
  // UI state
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'info'
  });

  // Advanced filters
  const [filters, setFilters] = useState({
    locations: [] as string[],
    industries: [] as string[],
    companySizes: [] as string[],
    exclusions: [] as string[],
    minStaffingFit: 0,
    minCallPriority: 0,
  });

  // Summary state
  const [summary, setSummary] = useState({
    totalResults: 0,
    hotProspects: 0,
    goodProspects: 0,
    unclearProspects: 0,
    companiesFound: 0,
  });

  // Lazy-load saved searches only when drawer opens (reduces initial Firestore reads)
  useEffect(() => {
    if (showSavedSearches && savedSearches.length === 0) {
      loadSavedSearches();
    }
  }, [showSavedSearches, tenantId]);

  // Email templates are loaded inside EmailTemplatesManager when opened; no need to load at mount

  const loadSavedSearches = async () => {
    if (!tenantId) return;
    
    try {
      console.log('Loading saved searches for tenant:', tenantId);
      const q = query(
        collection(db, 'tenants', tenantId, 'prospecting_saved_searches'),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const searches = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedSearch[];
      
      console.log('Loaded saved searches:', searches.length);
      setSavedSearches(searches);
    } catch (error) {
      console.error('Error loading saved searches:', error);
      // Don't show error to user for saved searches - it's not critical
    }
  };

  const loadEmailTemplates = async () => {
    if (!tenantId) return;
    
    try {
      console.log('Loading email templates for tenant:', tenantId);
      const q = query(
        collection(db, 'tenants', tenantId, 'email_templates'),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const templates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as EmailTemplate[];
      
      console.log('Loaded email templates:', templates.length);
      setEmailTemplates(templates);
    } catch (error) {
      console.error('Error loading email templates:', error);
      // Don't show error to user for email templates - it's not critical
    }
  };

  const runProspectingSearch = async () => {
    if (!prompt.trim() || !tenantId) return;
    
    setLoading(true);
    setResults([]);
    setSelectedResults([]);
    
    try {
      console.log('Running prospecting search with:', { prompt, filters, tenantId });
      const runProspecting = httpsCallable(functions, 'runProspecting');
      const result = await runProspecting({
        prompt,
        filters,
        tenantId
      });
      
      console.log('Prospecting search result:', result.data);
      const data = result.data as any;
      setResults(data.results || []);
      setSummary(data.summary || {
        totalResults: 0,
        hotProspects: 0,
        goodProspects: 0,
        unclearProspects: 0,
        companiesFound: 0,
      });
      
      setSnackbar({
        open: true,
        message: `Found ${data.results?.length || 0} prospects across ${data.summary?.companiesFound || 0} companies`,
        severity: 'success'
      });
    } catch (error: any) {
      console.error('Error running prospecting search:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Error running search. Please try again.';
      if (error.code === 'functions/unavailable') {
        errorMessage = 'Service temporarily unavailable. Please try again in a few minutes.';
      } else if (error.code === 'functions/permission-denied') {
        errorMessage = 'Permission denied. Please check your access rights.';
      } else if (error.message?.includes('CORS')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const saveSearch = async () => {
    if (!prompt.trim() || !tenantId) return;
    
    try {
      const saveProspectingSearch = httpsCallable(functions, 'saveProspectingSearch');
      await saveProspectingSearch({
        name: `Search ${new Date().toLocaleDateString()}`,
        prompt,
        filters,
        visibility: 'private',
        tenantId
      });
      
      await loadSavedSearches();
      setSnackbar({
        open: true,
        message: 'Search saved successfully',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error saving search:', error);
      setSnackbar({
        open: true,
        message: 'Error saving search',
        severity: 'error'
      });
    }
  };

  const addToCRM = async (resultIds: string[]) => {
    if (!tenantId || resultIds.length === 0) return;
    
    try {
      const addToCRM = httpsCallable(functions, 'addProspectsToCRM');
      await addToCRM({
        resultIds,
        tenantId
      });
      
      // Update local state
      setResults(prev => prev.map(result => 
        resultIds.includes(result.id) 
          ? { ...result, status: 'added_to_crm' as const }
          : result
      ));
      
      setSnackbar({
        open: true,
        message: `Added ${resultIds.length} contacts to CRM`,
        severity: 'success'
      });
    } catch (error) {
      console.error('Error adding to CRM:', error);
      setSnackbar({
        open: true,
        message: 'Error adding to CRM',
        severity: 'error'
      });
    }
  };

  const createCallList = async () => {
    if (!tenantId || selectedResults.length === 0) return;
    
    try {
      const createCallList = httpsCallable(functions, 'createCallList');
      await createCallList({
        resultIds: selectedResults,
        tenantId,
        assignTo: currentUser?.uid
      });
      
      setSnackbar({
        open: true,
        message: `Created call list with ${selectedResults.length} tasks`,
        severity: 'success'
      });
    } catch (error) {
      console.error('Error creating call list:', error);
      setSnackbar({
        open: true,
        message: 'Error creating call list',
        severity: 'error'
      });
    }
  };

  const createEmailCampaign = async () => {
    if (!tenantId || selectedResults.length === 0) return;
    
    setShowEmailTemplates(true);
  };

  const handleSelectAll = () => {
    if (selectedResults.length === results.length) {
      setSelectedResults([]);
    } else {
      setSelectedResults(results.map(r => r.id));
    }
  };

  const handleSelectResult = (resultId: string) => {
    setSelectedResults(prev => 
      prev.includes(resultId)
        ? prev.filter(id => id !== resultId)
        : [...prev, resultId]
    );
  };

  const getPriorityColor = (score: number) => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'error';
  };

  const getPriorityLabel = (score: number) => {
    if (score >= 80) return 'Hot';
    if (score >= 60) return 'Good';
    return 'Low';
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ 
        p: 3, 
        borderBottom: 1, 
        borderColor: 'divider',
        bgcolor: 'background.paper'
      }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Prospecting Hub
        </Typography>
        <Typography variant="body2" color="text.secondary">
          AI-powered prospect discovery and outreach automation
        </Typography>
      </Box>

      {/* Prompt Bar */}
      <Box sx={{ 
        p: 3, 
        borderBottom: 1, 
        borderColor: 'divider',
        bgcolor: 'background.paper',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={12} md={8}>
            <TextField
              fullWidth
              multiline
              rows={2}
              variant="outlined"
              placeholder="Find me 50 ops managers in Dallas who might need temp workers..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              InputProps={{
                endAdornment: loading && (
                  <InputAdornment position="end">
                    <CircularProgress size={20} />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<RunIcon />}
                onClick={runProspectingSearch}
                disabled={!prompt.trim() || loading}
                sx={{ flex: 1 }}
              >
                Run Search
              </Button>
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                onClick={saveSearch}
                disabled={!prompt.trim() || loading}
              >
                Save
              </Button>
              <Button
                variant="outlined"
                startIcon={<BookmarkIcon />}
                onClick={() => setShowSavedSearches(true)}
              >
                Saved
              </Button>
            </Stack>
          </Grid>
        </Grid>

        {/* Advanced Filters */}
        <Accordion 
          expanded={showAdvancedFilters} 
          onChange={() => setShowAdvancedFilters(!showAdvancedFilters)}
          sx={{ mt: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterIcon fontSize="small" />
              Advanced Filters
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <Autocomplete
                  multiple
                  options={['Dallas', 'Austin', 'Houston', 'San Antonio', 'Fort Worth']}
                  value={filters.locations}
                  onChange={(_, value) => setFilters(prev => ({ ...prev, locations: value }))}
                  renderInput={(params) => (
                    <TextField {...params} label="Locations" size="small" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <Autocomplete
                  multiple
                  options={['Manufacturing', 'Healthcare', 'Technology', 'Construction', 'Hospitality']}
                  value={filters.industries}
                  onChange={(_, value) => setFilters(prev => ({ ...prev, industries: value }))}
                  renderInput={(params) => (
                    <TextField {...params} label="Industries" size="small" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <Autocomplete
                  multiple
                  options={['1-10', '11-50', '51-200', '201-1000', '1000+']}
                  value={filters.companySizes}
                  onChange={(_, value) => setFilters(prev => ({ ...prev, companySizes: value }))}
                  renderInput={(params) => (
                    <TextField {...params} label="Company Size" size="small" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Min Staffing Fit</InputLabel>
                  <Select
                    value={filters.minStaffingFit}
                    onChange={(e) => setFilters(prev => ({ ...prev, minStaffingFit: e.target.value as number }))}
                    label="Min Staffing Fit"
                  >
                    <MenuItem value={0}>Any</MenuItem>
                    <MenuItem value={30}>30%+</MenuItem>
                    <MenuItem value={50}>50%+</MenuItem>
                    <MenuItem value={70}>70%+</MenuItem>
                    <MenuItem value={90}>90%+</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Box>

      {/* AI Summary Strip */}
      {summary.totalResults > 0 && (
        <Box sx={{ 
          p: 2, 
          bgcolor: 'grey.800', 
          color: 'common.white',
          borderBottom: 1,
          borderColor: 'divider'
        }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            Found {summary.totalResults} contacts across {summary.companiesFound} companies. 
            {summary.hotProspects > 0 && ` ${summary.hotProspects} are hot prospects based on hiring signals.`}
          </Typography>
        </Box>
      )}

      {/* Results Table */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {results.length > 0 && (
          <Box sx={{ p: 3 }}>
            {/* Bulk Actions */}
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectedResults.length === results.length}
                      indeterminate={selectedResults.length > 0 && selectedResults.length < results.length}
                      onChange={handleSelectAll}
                    />
                  }
                  label={`${selectedResults.length} selected`}
                />
                {selectedResults.length > 0 && (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      startIcon={<AddToCRMIcon />}
                      onClick={() => addToCRM(selectedResults)}
                    >
                      Add to CRM
                    </Button>
                    <Button
                      size="small"
                      startIcon={<TaskIcon />}
                      onClick={createCallList}
                    >
                      Create Call List
                    </Button>
                    <Button
                      size="small"
                      startIcon={<EmailIcon />}
                      onClick={createEmailCampaign}
                    >
                      Email Campaign
                    </Button>
                  </Stack>
                )}
              </Box>
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                variant="outlined"
              >
                Export CSV
              </Button>
            </Box>

            {/* Results Table */}
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedResults.length === results.length}
                        indeterminate={selectedResults.length > 0 && selectedResults.length < results.length}
                        onChange={handleSelectAll}
                      />
                    </TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Phone</TableCell>
                    <TableCell>LinkedIn</TableCell>
                    <TableCell>Staffing Fit</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((result) => (
                    <TableRow key={result.id} hover>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedResults.includes(result.id)}
                          onChange={() => handleSelectResult(result.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 32, height: 32 }}>
                            {result.contact.firstName[0]}{result.contact.lastName[0]}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {result.contact.firstName} {result.contact.lastName}
                            </Typography>
                            {result.status !== 'new' && (
                              <Chip 
                                label={result.status.replace('_', ' ')} 
                                size="small" 
                                color="primary" 
                                variant="outlined"
                              />
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {result.contact.title}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {result.company.name}
                          </Typography>
                          {result.company.industry && (
                            <Typography variant="caption" color="text.secondary">
                              {result.company.industry}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {result.company.location}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {result.contact.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {result.contact.phone}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {result.contact.linkedinUrl ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkedInIcon />}
                            href={result.contact.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ textTransform: 'none' }}
                          >
                            View Profile
                          </Button>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Not available
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">
                            {result.scores.staffingFit}%
                          </Typography>
                          <Box
                            sx={{
                              width: 40,
                              height: 4,
                              bgcolor: 'grey.200',
                              borderRadius: 2,
                              overflow: 'hidden'
                            }}
                          >
                            <Box
                              sx={{
                                width: `${result.scores.staffingFit}%`,
                                height: '100%',
                                bgcolor: getPriorityColor(result.scores.staffingFit) === 'success' ? 'success.main' : 
                                         getPriorityColor(result.scores.staffingFit) === 'warning' ? 'warning.main' : 'error.main'
                              }}
                            />
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={getPriorityLabel(result.scores.callPriority)}
                          size="small"
                          color={getPriorityColor(result.scores.callPriority) as any}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Add to CRM">
                            <IconButton
                              size="small"
                              onClick={() => addToCRM([result.id])}
                              disabled={result.status === 'added_to_crm'}
                            >
                              <AddToCRMIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Call Now">
                            <IconButton size="small">
                              <PhoneIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Email Now">
                            <IconButton size="small">
                              <EmailIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && prompt && (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            p: 4
          }}>
            <SearchIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No results found
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Try adjusting your search criteria or filters to find more prospects.
            </Typography>
          </Box>
        )}

        {/* Initial State */}
        {!loading && results.length === 0 && !prompt && (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            p: 4
          }}>
            <BusinessIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Start Your Prospecting Journey
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 400 }}>
              Enter a natural language prompt to find prospects. For example: "Find me 50 ops managers in Dallas who might need temp workers"
            </Typography>
          </Box>
        )}
      </Box>

      {/* Saved Searches Drawer */}
      <Drawer
        anchor="right"
        open={showSavedSearches}
        onClose={() => setShowSavedSearches(false)}
        sx={{ '& .MuiDrawer-paper': { width: 400 } }}
      >
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Saved Searches
            </Typography>
            <IconButton onClick={() => setShowSavedSearches(false)}>
              <CloseIcon />
            </IconButton>
          </Box>

          <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} sx={{ mb: 2 }}>
            <Tab label="Mine" />
            <Tab label="Team" />
            <Tab label="Company" />
          </Tabs>

          <List>
            {savedSearches
              .filter(search => {
                if (activeTab === 0) return search.visibility === 'private' && search.createdByUid === currentUser?.uid;
                if (activeTab === 1) return search.visibility === 'team';
                return search.visibility === 'company';
              })
              .map((search) => (
                <ListItem key={search.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                  <ListItemText
                    primary={search.name}
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {search.prompt}
                        </Typography>
                        {search.lastRun && (
                          <Typography variant="caption" color="text.secondary">
                            Last run: {new Date(search.lastRun).toLocaleDateString()}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <Stack direction="row" spacing={1}>
                      <IconButton size="small">
                        <RunIcon />
                      </IconButton>
                      <IconButton size="small">
                        <ShareIcon />
                      </IconButton>
                    </Stack>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
          </List>
        </Box>
      </Drawer>

      {/* Email Templates Manager */}
      <EmailTemplatesManager
        open={showEmailTemplates}
        onClose={() => setShowEmailTemplates(false)}
        mode="select"
        onSelectTemplate={(template) => {
          console.log('Selected template:', template);
          setShowEmailTemplates(false);
          // TODO: Implement email campaign creation
        }}
      />

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ProspectingHub;
