import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  Link as LinkIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface LinkingResult {
  tenantId: string;
  status: 'success' | 'error' | 'no_companies' | 'no_contacts';
  totalContacts?: number;
  contactsLinked?: number;
  errors?: number;
  companiesFound?: number;
  error?: string;
  message?: string;
}

interface LinkingSummary {
  totalProcessed: number;
  totalLinked: number;
  totalErrors: number;
  successRate: string;
}

const ContactLinkingManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LinkingResult[]>([]);
  const [summary, setSummary] = useState<LinkingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLinkContacts = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setSummary(null);

    try {
      const linkContactsToCompanies = httpsCallable(functions, 'linkContactsToCompanies');
      const result = await linkContactsToCompanies({});
      
      const data = result.data as any;
      
      if (data.success) {
        setSummary(data.summary);
        setResults(data.results);
      } else {
        setError(data.error || data.message || 'Linking process failed');
      }
    } catch (err) {
      console.error('Error linking contacts:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      default:
        return <InfoIcon color="info" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'info';
    }
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Contact-Company Linking Manager
      </Typography>
      
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Link all CRM contacts to their matching companies based on external IDs. 
        This process will update the companyId field on contacts to match the correct company document.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <LinkIcon color="primary" />
            <Typography variant="h6">
              Link Contacts to Companies
            </Typography>
          </Box>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This will process all tenants and link contacts that have an externalCompanyId 
            to the corresponding company with a matching externalId.
          </Typography>

          <Button
            variant="contained"
            onClick={handleLinkContacts}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <LinkIcon />}
            sx={{ mb: 2 }}
          >
            {loading ? 'Linking Contacts...' : 'Start Linking Process'}
          </Button>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Linking Summary
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <Chip
                icon={<PersonIcon />}
                label={`${summary.totalProcessed} Contacts Processed`}
                color="primary"
                variant="outlined"
              />
              <Chip
                icon={<CheckCircleIcon />}
                label={`${summary.totalLinked} Contacts Linked`}
                color="success"
                variant="outlined"
              />
              <Chip
                icon={<ErrorIcon />}
                label={`${summary.totalErrors} Errors`}
                color="error"
                variant="outlined"
              />
              <Chip
                icon={<InfoIcon />}
                label={`${summary.successRate}% Success Rate`}
                color="info"
                variant="outlined"
              />
            </Box>

            {summary.totalLinked > 0 && (
              <Alert severity="success">
                Successfully linked {summary.totalLinked} contacts to companies!
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Tenant Results
            </Typography>
            
            <List>
              {results.map((result, index) => (
                <React.Fragment key={result.tenantId}>
                  <ListItem>
                    <ListItemIcon>
                      {getStatusIcon(result.status)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle1">
                            Tenant: {result.tenantId}
                          </Typography>
                          <Chip
                            label={result.status}
                            color={getStatusColor(result.status) as any}
                            size="small"
                          />
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 1 }}>
                          {result.status === 'success' && (
                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                              <Chip
                                icon={<PersonIcon />}
                                label={`${result.totalContacts} contacts`}
                                size="small"
                                variant="outlined"
                              />
                              <Chip
                                icon={<CheckCircleIcon />}
                                label={`${result.contactsLinked} linked`}
                                size="small"
                                variant="outlined"
                                color="success"
                              />
                              <Chip
                                icon={<BusinessIcon />}
                                label={`${result.companiesFound} companies`}
                                size="small"
                                variant="outlined"
                              />
                              {result.errors && result.errors > 0 && (
                                <Chip
                                  icon={<ErrorIcon />}
                                  label={`${result.errors} errors`}
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                />
                              )}
                            </Box>
                          )}
                          {result.status === 'error' && (
                            <Typography variant="body2" color="error">
                              Error: {result.error}
                            </Typography>
                          )}
                          {(result.status === 'no_companies' || result.status === 'no_contacts') && (
                            <Typography variant="body2" color="text.secondary">
                              {result.message}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                  {index < results.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default ContactLinkingManager; 