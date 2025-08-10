import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  CircularProgress,
  TextField,
  Divider,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';
// import { useAuth } from '../contexts/AuthContext';

interface DuplicateGroup {
  companyName: string;
  keepCompanyId: string;
  keepCompanyScore: number;
  deleteCompanyIds: string[];
  deleteCompanyScores: number[];
}

interface AnalysisResult {
  success: boolean;
  message: string;
  summary: {
    totalCompanies: number;
    duplicateGroups: number;
    companiesToDelete: number;
    companiesToKeep: number;
    groups: DuplicateGroup[];
  };
  dryRun: boolean;
}

const DuplicateCompanyRemover: React.FC = () => {
  // const { user } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionResult, setDeletionResult] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!tenantId.trim()) {
      setError('Please enter a tenant ID');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setDeletionResult(null);

    try {
      const removeDuplicateCompanies = httpsCallable(functions, 'removeDuplicateCompanies');
      const result = await removeDuplicateCompanies({
        tenantId: tenantId.trim(),
        dryRun: true
      });

      setAnalysisResult(result.data as AnalysisResult);
    } catch (err: any) {
      console.error('Error analyzing duplicates:', err);
      setError(err.message || 'Failed to analyze duplicate companies');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!analysisResult) return;

    setLoading(true);
    setError(null);

    try {
      const removeDuplicateCompanies = httpsCallable(functions, 'removeDuplicateCompanies');
      const result = await removeDuplicateCompanies({
        tenantId: tenantId.trim(),
        dryRun: false
      });

      setDeletionResult(result.data);
    } catch (err: any) {
      console.error('Error deleting duplicates:', err);
      setError(err.message || 'Failed to delete duplicate companies');
    } finally {
      setLoading(false);
    }
  };

  const formatScore = (score: number) => {
    return `${(score * 100).toFixed(1)}%`;
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        <BusinessIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        Duplicate Company Remover
      </Typography>
      
      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>⚠️ Warning:</strong> This tool will permanently delete duplicate companies. 
          Always run the analysis first to review what will be deleted before proceeding.
        </Typography>
      </Alert>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Configuration
        </Typography>
        
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Tenant ID"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="Enter tenant ID (e.g., tenant_abc123)"
              helperText="The tenant ID containing the crm_companies subcollection"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Button
              variant="contained"
              startIcon={<SearchIcon />}
              onClick={handleAnalyze}
              disabled={loading || !tenantId.trim()}
              sx={{ minWidth: 200 }}
            >
              {loading ? <CircularProgress size={20} /> : 'Analyze Duplicates'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {analysisResult && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Analysis Results
          </Typography>
          
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} md={3}>
              <Box textAlign="center">
                <Typography variant="h4" color="primary">
                  {analysisResult.summary.totalCompanies}
                </Typography>
                <Typography variant="body2">Total Companies</Typography>
              </Box>
            </Grid>
            <Grid item xs={6} md={3}>
              <Box textAlign="center">
                <Typography variant="h4" color="warning.main">
                  {analysisResult.summary.duplicateGroups}
                </Typography>
                <Typography variant="body2">Duplicate Groups</Typography>
              </Box>
            </Grid>
            <Grid item xs={6} md={3}>
              <Box textAlign="center">
                <Typography variant="h4" color="error">
                  {analysisResult.summary.companiesToDelete}
                </Typography>
                <Typography variant="body2">To Delete</Typography>
              </Box>
            </Grid>
            <Grid item xs={6} md={3}>
              <Box textAlign="center">
                <Typography variant="h4" color="success.main">
                  {analysisResult.summary.companiesToKeep}
                </Typography>
                <Typography variant="body2">To Keep</Typography>
              </Box>
            </Grid>
          </Grid>

          {analysisResult.summary.groups.length > 0 ? (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                Duplicate Groups Found
              </Typography>
              
              {analysisResult.summary.groups.map((group, index) => (
                <Accordion key={index} sx={{ mb: 1 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                        {group.companyName}
                      </Typography>
                      <Chip 
                        label={`${group.deleteCompanyIds.length} duplicates`} 
                        color="warning" 
                        size="small" 
                        sx={{ mr: 1 }}
                      />
                      <Chip 
                        label={`Keep: ${formatScore(group.keepCompanyScore)}`} 
                        color="success" 
                        size="small"
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <Typography variant="subtitle2" color="success.main" gutterBottom>
                          ✅ Keeping (ID: {group.keepCompanyId})
                        </Typography>
                        <Typography variant="body2">
                          Completeness Score: {formatScore(group.keepCompanyScore)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="subtitle2" color="error" gutterBottom>
                          🗑️ Deleting ({group.deleteCompanyIds.length} companies)
                        </Typography>
                        {group.deleteCompanyIds.map((id, idx) => (
                          <Typography key={id} variant="body2" sx={{ ml: 2 }}>
                            • {id} (Score: {formatScore(group.deleteCompanyScores[idx])})
                          </Typography>
                        ))}
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              ))}

              <Box sx={{ mt: 3, textAlign: 'center' }}>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDelete}
                  disabled={loading}
                  size="large"
                >
                  {loading ? <CircularProgress size={20} /> : 'Delete Duplicates'}
                </Button>
              </Box>
            </>
          ) : (
            <Alert severity="success">
              <Typography variant="body1">
                ✅ No duplicate companies found! All companies are unique.
              </Typography>
            </Alert>
          )}
        </Paper>
      )}

      {deletionResult && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Deletion Results
          </Typography>
          
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body1">
              ✅ Successfully deleted {deletionResult.summary?.companiesDeleted || 0} duplicate companies
            </Typography>
          </Alert>
          
          <Typography variant="body2" color="text.secondary">
            {deletionResult.message}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default DuplicateCompanyRemover; 