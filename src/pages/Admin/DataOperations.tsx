import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  Card,
  CardContent,
  CardActions
} from '@mui/material';
import {
  Business as BusinessIcon,
  Email as EmailIcon,
  Link as LinkIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';

interface MatchingResult {
  contactId: string;
  contactName: string;
  contactEmail: string;
  matchedCompanyId: string;
  matchedCompanyName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface BulkOperationResult {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalContacts: number;
    contactsWithEmail: number;
    contactsWithoutCompany: number;
    matchesFound: number;
    highConfidenceMatches: number;
    mediumConfidenceMatches: number;
    lowConfidenceMatches: number;
    errors: number;
  };
  results: MatchingResult[];
  errors: string[];
  message: string;
}

const DataOperations: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkOperationResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  
  // Gmail bulk import state
  const [gmailImportLoading, setGmailImportLoading] = useState(false);
  const [gmailImportResults, setGmailImportResults] = useState<any>(null);
  const [daysBack, setDaysBack] = useState(90);

  const runBulkEmailDomainMatching = async () => {
    if (!tenantId) {
      alert('No tenant ID found');
      return;
    }

    setLoading(true);
    try {
      const functions = getFunctions();
      const bulkEmailDomainMatching = httpsCallable(functions, 'bulkEmailDomainMatching');
      
      const response = await bulkEmailDomainMatching({
        tenantId,
        dryRun
      });
      
      const resultData = response.data as BulkOperationResult;
      setResult(resultData);
      setShowResults(true);
      
      console.log('Bulk email domain matching result:', resultData);
    } catch (error) {
      console.error('Error running bulk email domain matching:', error);
      alert('Error running bulk email domain matching: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'success';
      case 'medium': return 'warning';
      case 'low': return 'error';
      default: return 'default';
    }
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high': return <CheckCircleIcon fontSize="small" />;
      case 'medium': return <WarningIcon fontSize="small" />;
      case 'low': return <WarningIcon fontSize="small" />;
      default: return null;
    }
  };

  const runGmailBulkImport = async () => {
    if (!tenantId || !currentUser?.uid) {
      alert('No tenant ID or user ID found');
      return;
    }

    setGmailImportLoading(true);
    try {
      const functions = getFunctions();
      const bulkImportGmailEmails = httpsCallable(functions, 'bulkImportGmailEmails');
      
      const response = await bulkImportGmailEmails({
        tenantId,
        userId: currentUser.uid,
        daysBack
      });
      
      const resultData = response.data as any;
      setGmailImportResults(resultData);
      
      console.log('Gmail bulk import result:', resultData);
    } catch (error) {
      console.error('Error running Gmail bulk import:', error);
      alert('Error running Gmail bulk import: ' + error);
    } finally {
      setGmailImportLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Data Operations
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Bulk operations for data cleanup and enhancement
      </Typography>

      <Grid container spacing={3}>
        {/* Bulk Email Domain Matching */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <EmailIcon color="primary" />
                <Typography variant="h6">
                  Bulk Email Domain Matching
                </Typography>
              </Box>
              
              

        {/* Gmail Bulk Import */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <EmailIcon color="primary" />
                <Typography variant="h6">
                  Gmail Bulk Import
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Import historical Gmail emails and create activity logs for matching contacts.
                This will process emails from the last 90 days (or custom range) and create activity logs.
              </Typography>

              <TextField
                label="Days Back"
                type="number"
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value) || 90)}
                sx={{ mb: 2, width: '100%' }}
                helperText="Number of days back to import emails from"
              />

              <Button
                variant="contained"
                startIcon={gmailImportLoading ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                onClick={runGmailBulkImport}
                disabled={gmailImportLoading}
                fullWidth
              >
                {gmailImportLoading ? 'Importing...' : 'Import Gmail Emails'}
              </Button>

              {gmailImportResults && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Import Results:
                  </Typography>
                  <Typography variant="body2">
                    {gmailImportResults.message}
                  </Typography>
                  {gmailImportResults.success && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="success.main">
                        ✅ Processed: {gmailImportResults.processedCount} emails
                      </Typography>
                      <Typography variant="body2" color="primary.main">
                        📝 Activity logs created: {gmailImportResults.activityLogsCreated}
                      </Typography>
                      <Typography variant="body2" color="warning.main">
                        ⏭️ Duplicates skipped: {gmailImportResults.duplicatesSkipped}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Automatically associate contacts with companies based on email domain matching.
                This will find contacts that have company email addresses but aren't associated with those companies.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                }
                label="Dry Run (preview only)"
                sx={{ mb: 2 }}
              />

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={runBulkEmailDomainMatching}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={20} /> : 'Preview Matches'}
                </Button>
                
                {!dryRun && (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<PlayArrowIcon />}
                    onClick={runBulkEmailDomainMatching}
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={20} /> : 'Apply Matches'}
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Results Summary */}
        {result && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Results Summary
                </Typography>
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Total Contacts:</Typography>
                    <Typography variant="body2" fontWeight="bold">{result.summary.totalContacts}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Contacts with Email:</Typography>
                    <Typography variant="body2" fontWeight="bold">{result.summary.contactsWithEmail}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Contacts without Company:</Typography>
                    <Typography variant="body2" fontWeight="bold">{result.summary.contactsWithoutCompany}</Typography>
                  </Box>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Matches Found:</Typography>
                    <Typography variant="body2" fontWeight="bold" color="primary.main">{result.summary.matchesFound}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">High Confidence:</Typography>
                    <Typography variant="body2" fontWeight="bold" color="success.main">{result.summary.highConfidenceMatches}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Medium Confidence:</Typography>
                    <Typography variant="body2" fontWeight="bold" color="warning.main">{result.summary.mediumConfidenceMatches}</Typography>
                  </Box>
                </Box>

                <Button
                  variant="outlined"
                  onClick={() => setShowResults(true)}
                  sx={{ mt: 2 }}
                  fullWidth
                >
                  View Detailed Results
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Results Dialog */}
      <Dialog
        open={showResults}
        onClose={() => setShowResults(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Bulk Email Domain Matching Results
          {result && (
            <Chip 
              label={result.dryRun ? 'Dry Run' : 'Applied'} 
              color={result.dryRun ? 'warning' : 'success'}
              size="small"
              sx={{ ml: 1 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {result && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                {result.message}
              </Alert>

              {result.errors.length > 0 && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Errors:</Typography>
                  <List dense>
                    {result.errors.map((error, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={error} />
                      </ListItem>
                    ))}
                  </List>
                </Alert>
              )}

              <Typography variant="h6" gutterBottom>
                Matches Found ({result.results.length})
              </Typography>

              <List>
                {result.results.map((match, index) => (
                  <ListItem key={index} divider>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body1" fontWeight="medium">
                            {match.contactName}
                          </Typography>
                          <Chip
                            icon={getConfidenceIcon(match.confidence)}
                            label={match.confidence}
                            color={getConfidenceColor(match.confidence)}
                            size="small"
                          />
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {match.contactEmail} → {match.matchedCompanyName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {match.reason}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowResults(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DataOperations;
