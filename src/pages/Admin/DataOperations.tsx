import React, { useState, useEffect } from 'react';
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
  CardActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Business as BusinessIcon,
  Email as EmailIcon,
  Link as LinkIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  Visibility as VisibilityIcon,
  DeleteSweep as DeleteSweepIcon,
  Person as PersonIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { app } from '../../firebase';
import GmailBulkImport from '../../components/GmailBulkImport';
import GmailReauthHelper from '../../components/GmailReauthHelper';

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

interface TenantUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  gmailConnected?: boolean;
  gmailTokens?: any;
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
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResults, setCleanupResults] = useState<any>(null);
  const [clearAllLoading, setClearAllLoading] = useState(false);
  const [clearAllResults, setClearAllResults] = useState<any>(null);

  // Single user import state
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [singleUserImportLoading, setSingleUserImportLoading] = useState(false);
  const [singleUserImportResults, setSingleUserImportResults] = useState<any>(null);

  // Load users for the tenant
  useEffect(() => {
    if (tenantId) {
      loadUsers();
    }
  }, [tenantId]);

  const loadUsers = async () => {
    if (!tenantId) return;
    
    setUsersLoading(true);
    try {
      const functions = getFunctions();
      const getUsersByTenant = httpsCallable(functions, 'getUsersByTenant');
      
      const response = await getUsersByTenant({ tenantId });
      const data = response.data as { users: TenantUser[], count: number };
      
      // Filter for users with Gmail connected
      const gmailUsers = data.users.filter(user => 
        user.gmailConnected || user.gmailTokens?.access_token
      );
      
      setUsers(gmailUsers);
      console.log(`Found ${gmailUsers.length} users with Gmail connected`);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setUsersLoading(false);
    }
  };

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

  const runSingleUserGmailImport = async () => {
    if (!tenantId || !selectedUserId) {
      alert('Please select a user to import emails for');
      return;
    }

    if (!currentUser) {
      alert('You must be signed in to perform this operation');
      return;
    }

    setSingleUserImportLoading(true);
    setSingleUserImportResults(null);
    
    try {
      console.log('Current user:', currentUser?.uid, currentUser?.email);
      console.log('Tenant ID:', tenantId);
      console.log('Selected User ID:', selectedUserId);
      
      // Use callable function for both localhost and production to avoid CORS issues
      const functions = getFunctions(app, 'us-central1');
      console.log('Functions instance:', functions);
      console.log('Functions region:', functions.region);
      
      const queueGmailBulkImport = httpsCallable(functions, 'queueGmailBulkImport');
      console.log('Callable function created:', queueGmailBulkImport);
      
      const response = await queueGmailBulkImport({ userIds: [selectedUserId], tenantId, daysBack });
      const resultData = response.data as any;
      setSingleUserImportResults(resultData);
      
      console.log('Single user Gmail import queued:', resultData);
      
      if (resultData?.success && resultData?.requestId) {
        // Start polling for status
        pollSingleUserImportStatus(resultData.requestId);
      }
    } catch (error) {
      console.error('Error running single user Gmail import:', error);
      alert('Error running Gmail import: ' + error);
    } finally {
      setSingleUserImportLoading(false);
    }
  };

  const pollSingleUserImportStatus = async (requestId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        // Use callable function for both localhost and production to avoid CORS issues
        const functions = getFunctions(app, 'us-central1');
        const getGmailImportProgress = httpsCallable(functions, 'getGmailImportProgress');
        const response = await getGmailImportProgress({ requestId, tenantId });
        const progressData = response.data as any;
        
        if (progressData) {
          // Update results with current status
          setSingleUserImportResults({
            success: true,
            message: `Processing: ${progressData.completedUsers}/${progressData.totalUsers} users completed`,
            requestId,
            totalUsers: progressData.totalUsers,
            completedUsers: progressData.completedUsers,
            status: progressData.status,
            results: progressData.results || {}
          });
          
          // Stop polling if job is complete
          if (progressData.status === 'completed' || progressData.status === 'failed') {
            clearInterval(pollInterval);
            const totalEmails = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.emailsImported || 0), 0);
            const totalContacts = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.contactsFound || 0), 0);
            
            // Check for specific error types in the results
            const hasAuthErrors = Object.values(progressData.results || {}).some((result: any) => 
              result.errors?.some((error: string) => error.includes('Gmail access token has expired'))
            );
            
            setSingleUserImportResults(prev => ({
              ...prev,
              message: progressData.status === 'completed' 
                ? `✅ Import completed: ${totalEmails} emails processed, ${totalContacts} contacts found`
                : hasAuthErrors
                ? `❌ Import failed: Gmail access tokens have expired. Users need to re-authenticate.`
                : `❌ Import failed: ${progressData.failedUsers?.length || 0} users failed`
            }));
          }
        }
              } catch (error) {
          console.error('Error polling import status:', error);
          
          // If it's a CORS error and we're using HTTP function, try the callable function as fallback
          if (window.location.hostname === 'localhost' && error.message?.includes('CORS')) {
            console.log('CORS error detected, trying callable function as fallback...');
            try {
              const functions = getFunctions(app, 'us-central1');
              const getGmailImportProgress = httpsCallable(functions, 'getGmailImportProgress');
              const response = await getGmailImportProgress({ requestId, tenantId });
              const progressData = response.data as any;
              
              if (progressData) {
                // Update results with current status
                setSingleUserImportResults({
                  success: true,
                  message: `Processing: ${progressData.completedUsers}/${progressData.totalUsers} users completed`,
                  requestId,
                  totalUsers: progressData.totalUsers,
                  completedUsers: progressData.completedUsers,
                  status: progressData.status,
                  results: progressData.results || {}
                });
                
                // Stop polling if job is complete
                if (progressData.status === 'completed' || progressData.status === 'failed') {
                  clearInterval(pollInterval);
                  const totalEmails = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.emailsImported || 0), 0);
                  const totalContacts = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.contactsFound || 0), 0);
                  
                  setSingleUserImportResults(prev => ({
                    ...prev,
                    message: progressData.status === 'completed' 
                      ? `✅ Import completed: ${totalEmails} emails processed, ${totalContacts} contacts found`
                      : `❌ Import failed: ${progressData.failedUsers?.length || 0} users failed`
                  }));
                }
              }
            } catch (fallbackError) {
              console.error('Fallback callable function also failed:', fallbackError);
              clearInterval(pollInterval);
              setSingleUserImportResults(prev => ({
                ...prev,
                message: '❌ Failed to check import status. Please refresh the page to check manually.'
              }));
            }
          } else {
            clearInterval(pollInterval);
            setSingleUserImportResults(prev => ({
              ...prev,
              message: '❌ Failed to check import status. Please refresh the page to check manually.'
            }));
          }
        }
    }, 5000); // Poll every 5 seconds
    
    // Stop polling after 30 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 30 * 60 * 1000);
  };

  const runGmailBulkImport = async () => {
    if (!tenantId) {
      alert('No tenant ID found');
      return;
    }

    if (!currentUser) {
      alert('You must be signed in to perform this operation');
      return;
    }

    setGmailImportLoading(true);
    try {
      console.log('Current user:', currentUser?.uid, currentUser?.email);
      console.log('Tenant ID:', tenantId);
      
      // Use callable function for both localhost and production to avoid CORS issues
      const functions = getFunctions(app, 'us-central1');
      console.log('Functions instance:', functions);
      console.log('Functions region:', functions.region);
      
      const queueGmailBulkImport = httpsCallable(functions, 'queueGmailBulkImport');
      console.log('Callable function created:', queueGmailBulkImport);
      
      const response = await queueGmailBulkImport({ tenantId, daysBack });
      const resultData = response.data as any;
      setGmailImportResults(resultData);
      
      console.log('Gmail bulk import queued:', resultData);
      
      if (resultData?.success && resultData?.requestId) {
        // Start polling for status
        pollImportStatus(resultData.requestId);
      }
    } catch (error) {
      console.error('Error running Gmail bulk import:', error);
      alert('Error running Gmail bulk import: ' + error);
    } finally {
      setGmailImportLoading(false);
    }
  };

  const pollImportStatus = async (requestId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        // Use callable function for both localhost and production to avoid CORS issues
        const functions = getFunctions(app, 'us-central1');
        const getGmailImportProgress = httpsCallable(functions, 'getGmailImportProgress');
        const response = await getGmailImportProgress({ requestId, tenantId });
        const progressData = response.data as any;
        
        if (progressData) {
          // Update results with current status
          setGmailImportResults({
            success: true,
            message: `Processing: ${progressData.completedUsers}/${progressData.totalUsers} users completed`,
            requestId,
            totalUsers: progressData.totalUsers,
            completedUsers: progressData.completedUsers,
            status: progressData.status,
            results: progressData.results || {}
          });
          
          // Stop polling if job is complete
          if (progressData.status === 'completed' || progressData.status === 'failed') {
            clearInterval(pollInterval);
            const totalEmails = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.emailsImported || 0), 0);
            const totalContacts = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.contactsFound || 0), 0);
            
            setGmailImportResults(prev => ({
              ...prev,
              message: progressData.status === 'completed' 
                ? `✅ Import completed: ${totalEmails} emails processed, ${totalContacts} contacts found`
                : `❌ Import failed: ${progressData.failedUsers?.length || 0} users failed`
            }));
          }
        }
      } catch (error) {
        console.error('Error polling import status:', error);
        
        // If it's a CORS error and we're using HTTP function, try the callable function as fallback
        if (window.location.hostname === 'localhost' && error.message?.includes('CORS')) {
          console.log('CORS error detected, trying callable function as fallback...');
          try {
            const functions = getFunctions();
            const getGmailImportProgress = httpsCallable(functions, 'getGmailImportProgress');
            const response = await getGmailImportProgress({ requestId, tenantId });
            const progressData = response.data as any;
            
            if (progressData) {
              // Update results with current status
              setGmailImportResults({
                success: true,
                message: `Processing: ${progressData.completedUsers}/${progressData.totalUsers} users completed`,
                requestId,
                totalUsers: progressData.totalUsers,
                completedUsers: progressData.completedUsers,
                status: progressData.status,
                results: progressData.results || {}
              });
              
              // Stop polling if job is complete
              if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(pollInterval);
                const totalEmails = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.emailsImported || 0), 0);
                const totalContacts = Object.values(progressData.results || {}).reduce((sum: any, result: any) => sum + (result.contactsFound || 0), 0);
                
                setGmailImportResults(prev => ({
                  ...prev,
                  message: progressData.status === 'completed' 
                    ? `✅ Import completed: ${totalEmails} emails processed, ${totalContacts} contacts found`
                    : `❌ Import failed: ${progressData.failedUsers?.length || 0} users failed`
                }));
              }
            }
          } catch (fallbackError) {
            console.error('Fallback callable function also failed:', fallbackError);
            clearInterval(pollInterval);
            setGmailImportResults(prev => ({
              ...prev,
              message: '❌ Failed to check import status. Please refresh the page to check manually.'
            }));
          }
        } else {
          clearInterval(pollInterval);
          setGmailImportResults(prev => ({
            ...prev,
            message: '❌ Failed to check import status. Please refresh the page to check manually.'
          }));
        }
      }
    }, 5000); // Poll every 5 seconds
    
    // Stop polling after 30 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 30 * 60 * 1000);
  };

  const runCleanupDuplicateEmails = async () => {
    if (!tenantId || !currentUser?.uid) {
      alert('No tenant ID or user ID found');
      return;
    }

    setCleanupLoading(true);
    try {
      const functions = getFunctions();
      const cleanupDuplicateEmailLogs = httpsCallable(functions, 'cleanupDuplicateEmailLogs');
      
      const response = await cleanupDuplicateEmailLogs({
        tenantId,
        userId: currentUser.uid
      });
      
      const resultData = response.data as any;
      setCleanupResults(resultData);
      
      console.log('Duplicate cleanup result:', resultData);
    } catch (error) {
      console.error('Error cleaning up duplicate emails:', error);
      alert('Error cleaning up duplicate emails: ' + error);
    } finally {
      setCleanupLoading(false);
    }
  };

  const runClearAllEmails = async () => {
    if (!tenantId || !currentUser?.uid) {
      alert('No tenant ID or user ID found');
      return;
    }

    const confirmed = window.confirm(
      '⚠️ WARNING: This will delete ALL email logs and activity logs from the system. ' +
      'This action cannot be undone. Are you sure you want to proceed?'
    );

    if (!confirmed) {
      return;
    }

    setClearAllLoading(true);
    try {
      const functions = getFunctions();
      const clearAllEmails = httpsCallable(functions, 'clearAllEmails');
      
      const response = await clearAllEmails({
        tenantId
      });
      
      const resultData = response.data as any;
      setClearAllResults(resultData);
      
      console.log('Clear all emails result:', resultData);
    } catch (error) {
      console.error('Error clearing all emails:', error);
      alert('Error clearing all emails: ' + error);
    } finally {
      setClearAllLoading(false);
    }
  };

  const getSelectedUserDisplayName = () => {
    const user = users.find(u => u.id === selectedUserId);
    if (!user) return '';
    
    if (user.displayName) return user.displayName;
    if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
    return user.email;
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
        {/* Gmail Authentication Issues Helper */}
        <Grid item xs={12}>
          <GmailReauthHelper tenantId={tenantId} />
        </Grid>

        {/* Single User Gmail Import */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <PersonIcon color="primary" />
                <Typography variant="h6">
                  Single User Gmail Import
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Import historical Gmail emails for a single user. This is safer than bulk imports and allows you to process users one at a time.
              </Typography>

              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>Select User</InputLabel>
                <Select
                  value={selectedUserId}
                  label="Select User"
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={usersLoading}
                >
                  <MenuItem value="">
                    <em>Select a user with Gmail connected</em>
                  </MenuItem>
                  {users.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

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
                startIcon={singleUserImportLoading ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                onClick={runSingleUserGmailImport}
                disabled={singleUserImportLoading || !selectedUserId}
                fullWidth
              >
                {singleUserImportLoading ? 'Importing...' : `Import for ${getSelectedUserDisplayName() || 'Selected User'}`}
              </Button>

              {singleUserImportResults && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Import Results:
                  </Typography>
                  <Typography variant="body2">
                    {singleUserImportResults.message}
                  </Typography>
                  {singleUserImportResults.success && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="success.main">
                        ✅ Status: {singleUserImportResults.status}
                      </Typography>
                      <Typography variant="body2" color="primary.main">
                        👤 User: {getSelectedUserDisplayName()}
                      </Typography>
                      
                      {/* User Results Breakdown */}
                      {singleUserImportResults.results && Object.keys(singleUserImportResults.results).length > 0 && (
                        <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Import Details:
                          </Typography>
                          {Object.entries(singleUserImportResults.results).map(([userId, result]: [string, any], index: number) => (
                            <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                              <Typography variant="body2" fontWeight="medium">
                                {getSelectedUserDisplayName()}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {result.emailsImported} emails • {result.contactsFound} contacts found
                              </Typography>
                              {result.errors && result.errors.length > 0 && (
                                <Typography variant="caption" color="error.main" display="block">
                                  {result.errors.length} errors
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Bulk Email Domain Matching */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <BusinessIcon color="primary" />
                <Typography variant="h6">
                  Bulk Email Domain Matching
                </Typography>
              </Box>
              
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

        {/* Gmail Bulk Import (Legacy) */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <EmailIcon color="primary" />
                <Typography variant="h6">
                  Gmail Bulk Import (All Users)
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                ⚠️ LEGACY: Import historical Gmail emails for ALL users in the tenant. Use Single User Import above for safer processing.
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
                variant="outlined"
                startIcon={gmailImportLoading ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                onClick={runGmailBulkImport}
                disabled={gmailImportLoading}
                fullWidth
              >
                {gmailImportLoading ? 'Importing...' : 'Import Gmail Emails (All Users)'}
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
                        ✅ Status: {gmailImportResults.status}
                      </Typography>
                      <Typography variant="body2" color="primary.main">
                        👥 Users: {gmailImportResults.completedUsers}/{gmailImportResults.totalUsers} completed
                      </Typography>
                      
                      {/* User Results Breakdown */}
                      {gmailImportResults.results && Object.keys(gmailImportResults.results).length > 0 && (
                        <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="subtitle2" gutterBottom>
                            User Breakdown:
                          </Typography>
                          {Object.entries(gmailImportResults.results).map(([userId, result]: [string, any], index: number) => (
                            <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                              <Typography variant="body2" fontWeight="medium">
                                User {userId}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {result.emailsImported} emails • {result.contactsFound} contacts found
                              </Typography>
                              {result.errors && result.errors.length > 0 && (
                                <Typography variant="caption" color="error.main" display="block">
                                  {result.errors.length} errors
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}
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

        {/* Cleanup Duplicate Emails */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <DeleteSweepIcon color="primary" />
                <Typography variant="h6">
                  Cleanup Duplicate Emails
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Remove duplicate email logs based on Gmail message ID. This will keep only the most recent version of each email.
              </Typography>

              <Button
                variant="contained"
                color="warning"
                startIcon={cleanupLoading ? <CircularProgress size={20} /> : <DeleteSweepIcon />}
                onClick={runCleanupDuplicateEmails}
                disabled={cleanupLoading}
                fullWidth
              >
                {cleanupLoading ? 'Cleaning...' : 'Cleanup Duplicate Emails'}
              </Button>

              {cleanupResults && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Cleanup Results:
                  </Typography>
                  <Typography variant="body2">
                    {cleanupResults.message}
                  </Typography>
                  {cleanupResults.success && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="success.main">
                        ✅ Removed: {cleanupResults.duplicatesRemoved} total duplicates
                      </Typography>
                      {cleanupResults.emailDuplicatesRemoved > 0 && (
                        <Typography variant="body2" color="warning.main">
                          📧 Email duplicates: {cleanupResults.emailDuplicatesRemoved}
                        </Typography>
                      )}
                      {cleanupResults.activityDuplicatesRemoved > 0 && (
                        <Typography variant="body2" color="warning.main">
                          📋 Activity duplicates: {cleanupResults.activityDuplicatesRemoved}
                        </Typography>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        📊 Total emails: {cleanupResults.totalEmails}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        📋 Total activities: {cleanupResults.totalActivities}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        📈 Remaining emails: {cleanupResults.remainingEmails}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        📈 Remaining activities: {cleanupResults.remainingActivities}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Clear All Emails */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <DeleteSweepIcon color="error" />
                <Typography variant="h6">
                  Clear All Emails
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                ⚠️ DANGER: This will delete ALL email logs and activity logs from the system. Use this before bulk imports to start fresh.
              </Typography>

              <Button
                variant="contained"
                color="error"
                startIcon={clearAllLoading ? <CircularProgress size={20} /> : <DeleteSweepIcon />}
                onClick={runClearAllEmails}
                disabled={clearAllLoading}
                sx={{ mb: 2 }}
              >
                {clearAllLoading ? 'Clearing...' : 'Clear All Emails'}
              </Button>

              {clearAllResults && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Clear Results:
                  </Typography>
                  <Typography variant="body2">
                    {clearAllResults.message}
                  </Typography>
                  {clearAllResults.success && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="success.main">
                        ✅ Total deleted: {clearAllResults.totalDeleted}
                      </Typography>
                      <Typography variant="body2" color="warning.main">
                        📧 Emails deleted: {clearAllResults.emailsDeleted}
                      </Typography>
                      <Typography variant="body2" color="warning.main">
                        📋 Activities deleted: {clearAllResults.activitiesDeleted}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
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
