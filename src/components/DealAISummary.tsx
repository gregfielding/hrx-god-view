import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Grid,
  IconButton,
  Tooltip,
  Collapse
} from '@mui/material';
import {
  Psychology as PsychologyIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
  Email as EmailIcon,
  Timeline as TimelineIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';

interface AISummary {
  summary: string;
  roadblocks: string[];
  customerResponsiveness: 'high' | 'medium' | 'low';
  likelihoodToClose: 'high' | 'medium' | 'low';
  salespersonPerformance: 'excellent' | 'good' | 'needs_improvement';
  lastUpdated: any;
  emailAnalysis: {
    totalEmails: number;
    responseTime: string;
    engagementLevel: string;
  };
  aiLogsAnalysis: {
    totalLogs: number;
    recentActivity: string;
    keyInsights: string[];
  };
  dealProgress: {
    stage: string;
    timeInStage: string;
    stageAdvancement: string;
  };
}

interface DealAISummaryProps {
  dealId: string;
  tenantId: string;
  onSummaryUpdate?: () => void;
}

const DealAISummary: React.FC<DealAISummaryProps> = ({ dealId, tenantId, onSummaryUpdate }) => {
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const functions = getFunctions();

  const loadAISummary = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log(`🔍 Loading AI summary for deal: ${dealId} in tenant: ${tenantId}`);

      // First try to get existing summary from deal document
      const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, dealId);
      const dealDoc = await getDoc(dealRef);
      
      if (dealDoc.exists()) {
        const dealData = dealDoc.data();
        if (dealData.aiSummary) {
          setAiSummary(dealData.aiSummary);
          setLastUpdated(dealData.aiSummary.lastUpdated?.toDate() || new Date());
          console.log('✅ Loaded existing AI summary');
          return;
        }
      }

      console.log('📝 No existing AI summary found, will generate new one');
      // If no existing summary, generate a new one
      await generateNewSummary();
    } catch (err: any) {
      console.error('Error loading AI summary:', err);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to load AI summary';
      
      if (err.code === 'permission-denied') {
        errorMessage = 'You do not have permission to access this deal\'s AI summary.';
      } else if (err.code === 'not-found') {
        errorMessage = 'Deal not found. Please check the deal ID.';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const generateNewSummary = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log(`🚀 Generating AI summary for deal: ${dealId} in tenant: ${tenantId}`);

      const generateDealAISummary = httpsCallable(functions, 'generateDealAISummary');
      const result = await generateDealAISummary({ tenantId, dealId });
      
      const { aiSummary: newSummary } = result.data as { aiSummary: AISummary };
      
      setAiSummary(newSummary);
      setLastUpdated(new Date());
      console.log('✅ Generated new AI summary');
      
      if (onSummaryUpdate) {
        onSummaryUpdate();
      }
    } catch (err: any) {
      console.error('Error generating AI summary:', err);
      
      // Provide more specific error messages based on the error type
      let errorMessage = 'Failed to generate AI summary';
      
      if (err.code === 'functions/unavailable') {
        errorMessage = 'AI summary service is temporarily unavailable. Please try again later.';
      } else if (err.code === 'functions/internal') {
        errorMessage = 'AI summary generation failed due to a server error. Please try again.';
      } else if (err.code === 'functions/deadline-exceeded') {
        errorMessage = 'AI summary generation timed out. Please try again.';
      } else if (err.message) {
        // Use the actual error message if available
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dealId && tenantId) {
      loadAISummary();
    }
  }, [dealId, tenantId]);

  const getResponsivenessColor = (level: string) => {
    switch (level) {
      case 'high': return 'success';
      case 'medium': return 'warning';
      case 'low': return 'error';
      default: return 'default';
    }
  };

  const getLikelihoodColor = (level: string) => {
    switch (level) {
      case 'high': return 'success';
      case 'medium': return 'warning';
      case 'low': return 'error';
      default: return 'default';
    }
  };

  const getPerformanceColor = (level: string) => {
    switch (level) {
      case 'excellent': return 'success';
      case 'good': return 'warning';
      case 'needs_improvement': return 'error';
      default: return 'default';
    }
  };

  const getPerformanceIcon = (level: string) => {
    switch (level) {
      case 'excellent': return <TrendingUpIcon />;
      case 'good': return <TrendingFlatIcon />;
      case 'needs_improvement': return <TrendingDownIcon />;
      default: return <InfoIcon />;
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  };

  if (loading && !aiSummary) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="center" minHeight={100}>
            <CircularProgress size={24} />
            <Typography variant="body2" sx={{ ml: 2 }}>
              Generating AI Summary...
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error" action={
            <Button color="inherit" size="small" onClick={generateNewSummary}>
              Retry
            </Button>
          }>
            {error}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!aiSummary) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeIcon color="primary" />
              AI Summary
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PsychologyIcon />}
              onClick={generateNewSummary}
              disabled={loading}
            >
              {loading ? 'Generating...' : 'Generate Summary'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <Box display="flex" alignItems="center" gap={1}>
            <AutoAwesomeIcon color="primary" />
            <Typography variant="h6">AI Summary</Typography>
            {lastUpdated && (
              <Typography variant="caption" color="text.secondary">
                Updated {formatTimeAgo(lastUpdated)}
              </Typography>
            )}
          </Box>
        }
        action={
          <Box display="flex" alignItems="center" gap={1}>
            <Tooltip title="Refresh Summary">
              <IconButton size="small" onClick={generateNewSummary} disabled={loading}>
                {loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              </IconButton>
            </Tooltip>
            <IconButton size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        }
      />
      
      <Collapse in={expanded}>
        <CardContent>
          {/* Summary Text */}
          <Typography variant="body1" sx={{ mb: 3, fontStyle: 'italic' }}>
            {aiSummary.summary}
          </Typography>

          <Divider sx={{ my: 2 }} />

          {/* Key Metrics Grid */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Box textAlign="center">
                <Typography variant="caption" color="text.secondary">
                  Customer Responsiveness
                </Typography>
                <Chip
                  label={aiSummary.customerResponsiveness.toUpperCase()}
                  color={getResponsivenessColor(aiSummary.customerResponsiveness)}
                  size="small"
                  sx={{ mt: 0.5 }}
                />
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box textAlign="center">
                <Typography variant="caption" color="text.secondary">
                  Likelihood to Close
                </Typography>
                <Chip
                  label={aiSummary.likelihoodToClose.toUpperCase()}
                  color={getLikelihoodColor(aiSummary.likelihoodToClose)}
                  size="small"
                  sx={{ mt: 0.5 }}
                />
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box textAlign="center">
                <Typography variant="caption" color="text.secondary">
                  Salesperson Performance
                </Typography>
                <Box display="flex" alignItems="center" justifyContent="center" gap={0.5} sx={{ mt: 0.5 }}>
                  {getPerformanceIcon(aiSummary.salespersonPerformance)}
                  <Chip
                    label={aiSummary.salespersonPerformance.replace('_', ' ').toUpperCase()}
                    color={getPerformanceColor(aiSummary.salespersonPerformance)}
                    size="small"
                  />
                </Box>
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Box textAlign="center">
                <Typography variant="caption" color="text.secondary">
                  Time in Stage
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 'bold' }}>
                  {aiSummary.dealProgress.timeInStage}
                </Typography>
              </Box>
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />

          {/* Detailed Analysis */}
          <Grid container spacing={2}>
            {/* Email Analysis */}
            <Grid item xs={12} md={6}>
              <Box>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <EmailIcon fontSize="small" />
                  Email Analysis
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemText 
                      primary={`${aiSummary.emailAnalysis.totalEmails} total emails`}
                      secondary={`Response time: ${aiSummary.emailAnalysis.responseTime}`}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText 
                      primary="Engagement Level"
                      secondary={
                        <Box component="span">
                          <Chip
                            label={aiSummary.emailAnalysis.engagementLevel}
                            color={getResponsivenessColor(aiSummary.emailAnalysis.engagementLevel)}
                            size="small"
                          />
                        </Box>
                      }
                      secondaryTypographyProps={{ component: 'span' }}
                    />
                  </ListItem>
                </List>
              </Box>
            </Grid>

            {/* AI Activity Analysis */}
            <Grid item xs={12} md={6}>
              <Box>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <TimelineIcon fontSize="small" />
                  AI Activity
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemText 
                      primary={`${aiSummary.aiLogsAnalysis.totalLogs} AI actions`}
                      secondary={aiSummary.aiLogsAnalysis.recentActivity}
                    />
                  </ListItem>
                  {aiSummary.aiLogsAnalysis.keyInsights.length > 0 && (
                    <ListItem>
                      <ListItemText 
                        primary="Recent Actions"
                        secondary={aiSummary.aiLogsAnalysis.keyInsights.slice(0, 2).join(', ')}
                      />
                    </ListItem>
                  )}
                </List>
              </Box>
            </Grid>
          </Grid>

          {/* Roadblocks */}
          {aiSummary.roadblocks.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <WarningIcon color="warning" fontSize="small" />
                  Roadblocks
                </Typography>
                <List dense>
                  {aiSummary.roadblocks.map((roadblock, index) => (
                    <ListItem key={index}>
                      <ListItemIcon>
                        <ErrorIcon color="error" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={roadblock} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            </>
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default DealAISummary;

