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
  Avatar,
  Snackbar,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Divider
} from '@mui/material';
import {
  LinkedIn as LinkedInIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  OpenInNew as OpenInNewIcon,
  TrendingUp as TrendingUpIcon,
  Work as WorkIcon,
  Search as SearchIcon,
  LocationOn as LocationIcon,
  WorkOutline as WorkOutlineIcon,
  ExpandMore as ExpandMoreIcon,
  Clear as ClearIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection } from 'firebase/firestore';

import { functions , db } from '../firebase';

interface DecisionMaker {
  name: string;
  title: string;
  linkedinUrl: string; // Changed from linkedInUrl to match API response
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
  
  // Search filter states
  const [locationKeywords, setLocationKeywords] = useState<string>('');
  const [jobTitleKeywords, setJobTitleKeywords] = useState<string>('');
  const [seniorityLevel, setSeniorityLevel] = useState<string>('all');
  const [department, setDepartment] = useState<string>('all');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [hasActiveFilters, setHasActiveFilters] = useState<boolean>(false);

  const fetchDecisionMakers = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const findDecisionMakers = httpsCallable(functions, 'findDecisionMakers');
      const result = await findDecisionMakers({
        companyName,
        companyId: forceRefresh ? `${companyId}-${Date.now()}` : companyId,
        tenantId,
        locationKeywords: locationKeywords.trim(),
        jobTitleKeywords: jobTitleKeywords.trim(),
        seniorityLevel: seniorityLevel !== 'all' ? seniorityLevel : undefined,
        department: department !== 'all' ? department : undefined,
      });
      const data = result.data as { success: boolean; decisionMakers: DecisionMaker[]; totalFound: number; message?: string };
      
      if (data.success) {
        console.log('Decision makers data received:', data.decisionMakers);
        // Debug: Log LinkedIn URLs
        data.decisionMakers?.forEach((dm: DecisionMaker, index: number) => {
          console.log(`Decision Maker ${index + 1}:`, {
            name: dm.name,
            linkedinUrl: dm.linkedinUrl,
            hasLinkedInUrl: !!dm.linkedinUrl
          });
        });
        setDecisionMakers(data.decisionMakers || []);
        setLastUpdated(new Date());
      } else {
        setError(data.message || 'Failed to fetch decision-makers');
        setDecisionMakers([]);
      }
    } catch (err) {
      console.warn('Callable failed, falling back to HTTP:', err);
      
      // HTTP fallback for CORS issues
      try {
        const resp = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/findDecisionMakersHttp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName,
            companyId: forceRefresh ? `${companyId}-${Date.now()}` : companyId,
            tenantId,
            locationKeywords: locationKeywords.trim(),
            jobTitleKeywords: jobTitleKeywords.trim(),
            seniorityLevel: seniorityLevel !== 'all' ? seniorityLevel : undefined,
            department: department !== 'all' ? department : undefined,
          })
        });
        
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP fallback failed: ${resp.status} ${errText}`);
        }
        
        const data = await resp.json();
        
        if (data.success) {
          console.log('Decision makers data received (HTTP):', data.decisionMakers);
          // Debug: Log LinkedIn URLs
                  data.decisionMakers?.forEach((dm: DecisionMaker, index: number) => {
          console.log(`Decision Maker ${index + 1} (HTTP):`, {
            name: dm.name,
            linkedinUrl: dm.linkedinUrl,
            hasLinkedInUrl: !!dm.linkedinUrl
          });
        });
          setDecisionMakers(data.decisionMakers || []);
          setLastUpdated(new Date());
        } else {
          setError(data.message || 'Failed to fetch decision-makers');
          setDecisionMakers([]);
        }
      } catch (httpErr) {
        console.error('HTTP fallback also failed:', httpErr);
        setError('Failed to fetch decision-makers (both callable and HTTP methods failed)');
        setDecisionMakers([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Check if any filters are active
  useEffect(() => {
    const hasFilters = Boolean(locationKeywords.trim() || 
                      jobTitleKeywords.trim() || 
                      seniorityLevel !== 'all' || 
                      department !== 'all');
    setHasActiveFilters(hasFilters);
  }, [locationKeywords, jobTitleKeywords, seniorityLevel, department]);

  useEffect(() => {
    if (companyName && companyId && tenantId) {
      fetchDecisionMakers();
    }
  }, [companyName, companyId, tenantId]);

  const clearAllFilters = () => {
    setLocationKeywords('');
    setJobTitleKeywords('');
    setSeniorityLevel('all');
    setDepartment('all');
  };

  const handleSearchWithFilters = () => {
    fetchDecisionMakers(true);
  };

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
        linkedInUrl: decisionMaker.linkedinUrl,
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
        linkedInUrl: decisionMaker.linkedinUrl,
        email: extractedEmail || 'Not found in snippet',
        phone: extractedPhone || 'Not found in snippet',
        relevance: decisionMaker.relevance
      });
      
      // Debug: Log the full contact data to verify LinkedIn URL is saved
      console.log('🔗 Full contact data with LinkedIn URL:', {
        ...contactData,
        linkedInUrl: contactData.linkedInUrl // Explicitly log LinkedIn URL
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
    <Box sx={{ px: 0, py: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 0, px:3 }}>
        <Typography variant="h6" fontWeight={700}>Decision Makers</Typography>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          disabled={loading}
          size="small"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Box>

      {lastUpdated && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0, mb: '8px', px:3 }}>
          Last updated: {lastUpdated.toLocaleString()}
        </Typography>
      )}

      {/* Search Filters Section */}
      <Box sx={{ px: 3, mb: 2 }}>
        <Accordion 
          expanded={showFilters} 
          onChange={() => setShowFilters(!showFilters)}
          sx={{ 
            boxShadow: 'none', 
            border: '1px solid', 
            borderColor: hasActiveFilters ? 'primary.main' : 'divider',
            '&:before': { display: 'none' }
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ 
              minHeight: '48px',
              '& .MuiAccordionSummary-content': { margin: '8px 0' }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterListIcon color={hasActiveFilters ? 'primary' : 'action'} />
              <Typography variant="subtitle2" fontWeight={500}>
                Search Filters
              </Typography>
              {hasActiveFilters && (
                <Chip 
                  label="Active" 
                  size="small" 
                  color="primary" 
                  variant="outlined"
                />
              )}
            </Box>
          </AccordionSummary>
          
          <AccordionDetails sx={{ pt: 0 }}>
            <Grid container spacing={2}>
              {/* Location Keywords */}
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location Keywords"
                  placeholder="e.g., New York, California, Remote"
                  value={locationKeywords}
                  onChange={(e) => setLocationKeywords(e.target.value)}
                  InputProps={{
                    startAdornment: <LocationIcon sx={{ mr: 1, color: 'action.active' }} />,
                    endAdornment: locationKeywords && (
                      <IconButton
                        size="small"
                        onClick={() => setLocationKeywords('')}
                        edge="end"
                      >
                        <ClearIcon />
                      </IconButton>
                    )
                  }}
                  helperText="Enter locations separated by commas (e.g., New York, California, Remote)"
                  size="small"
                />
              </Grid>

              {/* Job Title Keywords */}
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Job Title Keywords"
                  placeholder="e.g., Director, Manager, VP"
                  value={jobTitleKeywords}
                  onChange={(e) => setJobTitleKeywords(e.target.value)}
                  InputProps={{
                    startAdornment: <WorkOutlineIcon sx={{ mr: 1, color: 'action.active' }} />,
                    endAdornment: jobTitleKeywords && (
                      <IconButton
                        size="small"
                        onClick={() => setJobTitleKeywords('')}
                        edge="end"
                      >
                        <ClearIcon />
                      </IconButton>
                    )
                  }}
                  helperText="Search for specific job titles or roles"
                  size="small"
                />
              </Grid>

              {/* Seniority Level */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Seniority Level</InputLabel>
                  <Select
                    value={seniorityLevel}
                    label="Seniority Level"
                    onChange={(e) => setSeniorityLevel(e.target.value)}
                  >
                    <MenuItem value="all">All Levels</MenuItem>
                    <MenuItem value="executive">Executive (C-Suite, VP+)</MenuItem>
                    <MenuItem value="senior">Senior (Director, Senior Manager)</MenuItem>
                    <MenuItem value="mid">Mid-Level (Manager, Lead)</MenuItem>
                    <MenuItem value="junior">Junior (Coordinator, Specialist)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Department */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Department</InputLabel>
                  <Select
                    value={department}
                    label="Department"
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <MenuItem value="all">All Departments</MenuItem>
                    <MenuItem value="hr">Human Resources</MenuItem>
                    <MenuItem value="operations">Operations</MenuItem>
                    <MenuItem value="finance">Finance</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="marketing">Marketing</MenuItem>
                    <MenuItem value="it">IT/Technology</MenuItem>
                    <MenuItem value="legal">Legal</MenuItem>
                    <MenuItem value="procurement">Procurement</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            {/* Filter Actions */}
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                size="small"
                onClick={clearAllFilters}
                disabled={!hasActiveFilters}
                startIcon={<ClearIcon />}
              >
                Clear All
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={handleSearchWithFilters}
                disabled={loading}
                startIcon={<SearchIcon />}
              >
                {loading ? 'Searching...' : 'Search with Filters'}
              </Button>
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>

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
        <>
          {/* Active Filters Summary */}
          {hasActiveFilters && (
            <Box sx={{ px: 3, mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                <strong>Active Filters:</strong>
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {locationKeywords.trim() && (
                  <Chip 
                    label={`Location: ${locationKeywords}`} 
                    size="small" 
                    variant="outlined" 
                    color="primary"
                    onDelete={() => setLocationKeywords('')}
                  />
                )}
                {jobTitleKeywords.trim() && (
                  <Chip 
                    label={`Title: ${jobTitleKeywords}`} 
                    size="small" 
                    variant="outlined" 
                    color="primary"
                    onDelete={() => setJobTitleKeywords('')}
                  />
                )}
                {seniorityLevel !== 'all' && (
                  <Chip 
                    label={`Seniority: ${seniorityLevel}`} 
                    size="small" 
                    variant="outlined" 
                    color="primary"
                    onDelete={() => setSeniorityLevel('all')}
                  />
                )}
                {department !== 'all' && (
                  <Chip 
                    label={`Department: ${department}`} 
                    size="small" 
                    variant="outlined" 
                    color="primary"
                    onDelete={() => setDepartment('all')}
                  />
                )}
              </Box>
            </Box>
          )}
          
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
                        {decisionMaker.linkedinUrl ? (
                          <Chip
                            label="LinkedIn"
                            size="small"
                            color="primary"
                            variant="outlined"
                            icon={<LinkedInIcon />}
                          />
                        ) : (
                          <Chip
                            label="No LinkedIn"
                            size="small"
                            color="error"
                            variant="outlined"
                          />
                        )}
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

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => {
                        if (decisionMaker.linkedinUrl) {
                          // Ensure the URL has the proper protocol
                          let url = decisionMaker.linkedinUrl;
                          if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                          }
                          console.log('Opening LinkedIn URL:', url);
                          window.open(url, '_blank', 'noopener,noreferrer');
                        } else {
                          console.error('No LinkedIn URL available for:', decisionMaker.name);
                          setErrorMessage(`No LinkedIn URL available for ${decisionMaker.name}`);
                        }
                      }}
                      disabled={!decisionMaker.linkedinUrl}
                    >
                      View Profile
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={savingContact === decisionMaker.name ? <CircularProgress size={16} /> : <SaveIcon />}
                      onClick={() => handleSaveContact(decisionMaker)}
                      disabled={savingContact === decisionMaker.name}
                    >
                      {savingContact === decisionMaker.name ? 'Adding…' : 'Add to CRM'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
        </>
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