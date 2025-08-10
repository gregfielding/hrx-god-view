import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Grid,
  IconButton,
  Tooltip,
  Avatar,
  Snackbar
} from '@mui/material';
import {
  LinkedIn as LinkedInIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  OpenInNew as OpenInNewIcon,
  TrendingUp as TrendingUpIcon,
  Work as WorkIcon
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection } from 'firebase/firestore';

import { functions , db } from '../firebase';

interface DecisionMaker {
  name: string;
  title: string;
  linkedinUrl: string;
  snippet: string;
  relevance: number;
}

interface DecisionMakersPanelProps {
  companyName: string;
  companyId: string;
  tenantId: string;
}

const DecisionMakersPanel: React.FC<DecisionMakersPanelProps> = ({
  companyName,
  companyId,
  tenantId
}) => {
  const [decisionMakers, setDecisionMakers] = useState<DecisionMaker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [savingContact, setSavingContact] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchDecisionMakers = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const findDecisionMakers = httpsCallable(functions, 'findDecisionMakers');
      const result = await findDecisionMakers({
        companyName,
        companyId: forceRefresh ? `${companyId}-${Date.now()}` : companyId,
        tenantId,
      });
      const data = result.data as { success: boolean; decisionMakers: DecisionMaker[]; totalFound: number; message?: string };
      
      if (data.success) {
        setDecisionMakers(data.decisionMakers || []);
        setLastUpdated(new Date());
      } else {
        setError(data.message || 'Failed to fetch decision-makers');
        setDecisionMakers([]);
      }
    } catch (err) {
      console.error('Error fetching decision-makers:', err);
      setError('Failed to fetch decision-makers');
      setDecisionMakers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyName && companyId && tenantId) {
      fetchDecisionMakers();
    }
  }, [companyName, companyId, tenantId]);

  const handleRefresh = () => {
    fetchDecisionMakers(true);
  };

  const handleSaveContact = async (decisionMaker: DecisionMaker) => {
    setSavingContact(decisionMaker.name);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      // Extract first and last name from the full name
      const nameParts = decisionMaker.name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Extract potential email from snippet if available
      const emailMatch = decisionMaker.snippet.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      const extractedEmail = emailMatch ? emailMatch[0] : '';
      
      // Extract potential phone from snippet if available
      const phoneMatch = decisionMaker.snippet.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
      const extractedPhone = phoneMatch ? phoneMatch[0] : '';
      
      // TODO: Future enhancement - Consider using LinkedIn API or web scraping
      // to extract additional contact information like email, phone, location, etc.
      // from the actual LinkedIn profiles. Current implementation only uses
      // SERP API which provides limited information from search snippets.
      // Create comprehensive contact data
      const contactData = {
        tenantId,
        firstName,
        lastName,
        fullName: decisionMaker.name,
        jobTitle: decisionMaker.title,
        title: decisionMaker.title, // Also save as title for compatibility
        companyId: companyId,
        companyName: companyName,
        linkedinUrl: decisionMaker.linkedinUrl,
        email: extractedEmail, // Save extracted email if found
        phone: extractedPhone, // Save extracted phone if found
        workPhone: extractedPhone, // Also save as workPhone for compatibility
        leadSource: 'AI Generated - Decision Maker',
        status: 'Prospect',
        role: 'decision_maker', // Set role based on context
        tags: ['AI Generated', 'Decision Maker', `Relevance: ${decisionMaker.relevance}%`],
        notes: `AI Generated Contact from Decision Makers Panel

Relevance Score: ${decisionMaker.relevance}%
Title: ${decisionMaker.title}
LinkedIn: ${decisionMaker.linkedinUrl}
Snippet: ${decisionMaker.snippet}

Generated on: ${new Date().toLocaleString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Location will be unassigned as requested
        locationId: null,
        locationName: null,
        // Additional fields for enhanced contact management
        enriched: false, // Mark as not yet enriched
        enrichedAt: null,
        // Professional context
        professionalSummary: decisionMaker.snippet,
        inferredSeniority: decisionMaker.title.toLowerCase().includes('director') || decisionMaker.title.toLowerCase().includes('vp') || decisionMaker.title.toLowerCase().includes('chief') ? 'senior' : 'mid-level',
        // Contact preferences (to be filled by user)
        preferredContactMethod: 'email', // Default to email
        communicationStyle: 'professional',
        // Deal intelligence fields
        dealRole: 'decision_maker',
        influence: decisionMaker.relevance >= 80 ? 'high' : decisionMaker.relevance >= 60 ? 'medium' : 'low',
        personality: 'analytical', // Default, can be updated
        isContractSigner: false, // Default, can be updated
        isDecisionInfluencer: true, // Default for decision makers
        isImplementationResponsible: false, // Default, can be updated
        // Relationship tracking
        relationshipStage: 'cold', // Default for new contacts
        lastContactedTime: null,
        // Metadata
        externalId: null, // No external ID for AI-generated contacts
        freshsalesId: null,
        salesOwnerId: null, // Will be assigned by system or user
        salesOwnerName: null,
        salesOwnerRef: null
      };

      // Add to Firestore
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const docRef = await addDoc(contactsRef, contactData);
      
      console.log('✅ Contact created successfully:', docRef.id);
      console.log('📋 Contact data saved:', {
        name: decisionMaker.name,
        title: decisionMaker.title,
        linkedinUrl: decisionMaker.linkedinUrl,
        email: extractedEmail || 'Not found in snippet',
        phone: extractedPhone || 'Not found in snippet',
        relevance: decisionMaker.relevance
      });
      
      // Debug: Log the full contact data to verify LinkedIn URL is saved
      console.log('🔗 Full contact data with LinkedIn URL:', {
        ...contactData,
        linkedinUrl: contactData.linkedinUrl // Explicitly log LinkedIn URL
      });
      
      // Create detailed success message
      const savedFields = [];
      if (extractedEmail) savedFields.push('email');
      if (extractedPhone) savedFields.push('phone');
      savedFields.push('LinkedIn URL');
      
      const successDetails = savedFields.length > 0 
        ? ` (Saved: ${savedFields.join(', ')})`
        : ' (LinkedIn URL saved)';
      
      setSuccessMessage(`Contact "${decisionMaker.name}" added successfully!${successDetails}`);
      
    } catch (err: any) {
      console.error('❌ Error saving contact:', err);
      setErrorMessage(`Failed to save contact: ${err.message}`);
    } finally {
      setSavingContact(null);
    }
  };

  const getRelevanceColor = (relevance: number) => {
    if (relevance >= 80) return 'success';
    if (relevance >= 60) return 'warning';
    return 'default';
  };

  const getRelevanceLabel = (relevance: number) => {
    if (relevance >= 80) return 'High Match';
    if (relevance >= 60) return 'Good Match';
    return 'Possible Match';
  };

  const getTitleIcon = (title: string) => {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('hr') || titleLower.includes('human resources')) {
      return <PersonIcon />;
    }
    if (titleLower.includes('operations') || titleLower.includes('manager')) {
      return <BusinessIcon />;
    }
    if (titleLower.includes('ceo') || titleLower.includes('president') || titleLower.includes('owner')) {
      return <TrendingUpIcon />;
    }
    return <WorkIcon />;
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" component="h2">
          Decision Makers
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          disabled={loading}
          size="small"
        >
          {loading ? 'Searching...' : 'Refresh'}
        </Button>
      </Box>

      {lastUpdated && (
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          Last updated: {lastUpdated.toLocaleString()}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box display="flex" justifyContent="center" p={3}>
          <CircularProgress />
        </Box>
      )}

      {!loading && decisionMakers.length === 0 && !error && (
        <Alert severity="info">
          No decision-makers found for {companyName}. Try refreshing to search again.
        </Alert>
      )}

      {!loading && decisionMakers.length > 0 && (
        <Grid container spacing={2}>
          {decisionMakers.map((decisionMaker, index) => (
            <Grid item xs={12} md={6} key={index}>
              <Card variant="outlined">
                <CardContent>
                  <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center" flex={1}>
                      <Avatar sx={{ mr: 1, bgcolor: 'primary.main' }}>
                        {getTitleIcon(decisionMaker.title)}
                      </Avatar>
                      <Box flex={1}>
                        <Typography variant="subtitle1" fontWeight="bold">
                          {decisionMaker.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {decisionMaker.title}
                        </Typography>
                      </Box>
                    </Box>
                    <Chip
                      label={getRelevanceLabel(decisionMaker.relevance)}
                      color={getRelevanceColor(decisionMaker.relevance) as any}
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {decisionMaker.snippet}
                  </Typography>

                  {/* Contact Information Indicators */}
                  {(() => {
                    const emailMatch = decisionMaker.snippet.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
                    const phoneMatch = decisionMaker.snippet.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
                    
                    return (
                      <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Chip
                          label="LinkedIn"
                          size="small"
                          color="primary"
                          variant="outlined"
                          icon={<LinkedInIcon />}
                        />
                        {emailMatch && (
                          <Chip
                            label="Email Found"
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        )}
                        {phoneMatch && (
                          <Chip
                            label="Phone Found"
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        )}
                        {!emailMatch && !phoneMatch && (
                          <Chip
                            label="Basic Info Only"
                            size="small"
                            color="default"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    );
                  })()}

                  <Box display="flex" gap={1} flexWrap="wrap">
                    <Tooltip title="View LinkedIn Profile">
                      <IconButton
                        size="small"
                        onClick={() => window.open(decisionMaker.linkedinUrl, '_blank')}
                        color="primary"
                      >
                        <LinkedInIcon />
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title={(() => {
                      const emailMatch = decisionMaker.snippet.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
                      const phoneMatch = decisionMaker.snippet.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
                      
                      const savedInfo = ['LinkedIn URL'];
                      if (emailMatch) savedInfo.push('Email');
                      if (phoneMatch) savedInfo.push('Phone');
                      
                      return `Save to Contacts: ${decisionMaker.name}\nWill save: ${savedInfo.join(', ')}`;
                    })()}>
                      <IconButton
                        size="small"
                        onClick={() => handleSaveContact(decisionMaker)}
                        color="secondary"
                        disabled={savingContact === decisionMaker.name}
                      >
                        {savingContact === decisionMaker.name ? (
                          <CircularProgress size={16} />
                        ) : (
                          <SaveIcon />
                        )}
                      </IconButton>
                    </Tooltip>

                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => window.open(decisionMaker.linkedinUrl, '_blank')}
                    >
                      View Profile
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {!loading && decisionMakers.length > 0 && (
        <Box mt={2} p={2} bgcolor="grey.50" borderRadius={1}>
          <Typography variant="body2" color="text.secondary">
            <strong>Note:</strong> These results are found through public search and may not be current. 
            Always verify contact information before reaching out.
          </Typography>
        </Box>
      )}

      {/* Success/Error Snackbars */}
      <Snackbar 
        open={!!successMessage} 
        autoHideDuration={4000} 
        onClose={() => setSuccessMessage(null)}
      >
        <Alert severity="success" onClose={() => setSuccessMessage(null)} sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>
      
      <Snackbar 
        open={!!errorMessage} 
        autoHideDuration={6000} 
        onClose={() => setErrorMessage(null)}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DecisionMakersPanel; 