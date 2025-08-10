import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Avatar,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardHeader,
  TextField,
} from '@mui/material';

import {
  ArrowBack as ArrowBackIcon,
  AttachMoney as DealIcon,
  Info as InfoIcon,
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  List as ListIcon,
  Task as TaskIcon,
  Delete as DeleteIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { createDenormalizedAssociationService } from '../../utils/denormalizedAssociationService';
import StageChip from '../../components/StageChip';
import CRMNotesTab from '../../components/CRMNotesTab';
import FastAssociationsCard from '../../components/FastAssociationsCard';
import DealStageForms from '../../components/DealStageForms';
import ActivityLogTab from '../../components/ActivityLogTab';
import DealStageAISuggestions from '../../components/DealStageAISuggestions';
import DealCoachPanel from '../../components/DealCoachPanel';
import DealTasksDashboard from '../../components/DealTasksDashboard';
import DealAISummary from '../../components/DealAISummary';
import EmailTab from '../../components/EmailTab';

interface DealData {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  locationId?: string;
  locationName?: string;
  stage: string;
  estimatedRevenue: number;
  closeDate: string;
  owner: string;
  tags: string[];
  notes: string;
  stageData?: any;
  createdAt?: any;
  updatedAt?: any;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`deal-tabpanel-${index}`}
      aria-labelledby={`deal-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const DealDetails: React.FC = () => {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  
  const [deal, setDeal] = useState<DealData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [company, setCompany] = useState<any>(null);
  const [stageData, setStageData] = useState<any>({});
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);

  useEffect(() => {
    if (!dealId || !tenantId) return;

    const loadDeal = async () => {
      try {
        setLoading(true);
        const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId));
        
        if (!dealDoc.exists()) {
          setError('Deal not found');
          return;
        }

        const dealData = { id: dealDoc.id, ...dealDoc.data() } as DealData;
        
        // Ensure the deal has a valid stage, default to 'discovery' if not set
        if (!dealData.stage) {
          dealData.stage = 'discovery';
          // Update the deal in Firestore with the default stage
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId), {
            stage: 'discovery',
            updatedAt: new Date()
          });
        }
        
        setDeal(dealData);
        
        // Load stage data if it exists
        if (dealData.stageData) {
          setStageData(dealData.stageData);
          console.log('Loaded stage data from Firestore:', dealData.stageData);
        } else {
          // Initialize empty stage data
          setStageData({});
          console.log('No stage data found, initializing empty state');
        }

        // Load associated company if deal has companyId
        if (dealData.companyId) {
          const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', dealData.companyId));
          if (companyDoc.exists()) {
            const companyData = { id: companyDoc.id, ...companyDoc.data() };
            setCompany(companyData);
          }
        }

      } catch (err: any) {
        console.error('Error loading deal:', err);
        setError(err.message || 'Failed to load deal');
      } finally {
        setLoading(false);
      }
    };

    loadDeal();
  }, [dealId, tenantId]);



  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleDealUpdate = async (field: string, value: any) => {
    if (!deal || !tenantId) return;
    
    try {
      const updatedDeal = { ...deal, [field]: value };
      setDeal(updatedDeal);
      
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        [field]: value,
        updatedAt: new Date()
      });
    } catch (err) {
      console.error('Error updating deal:', err);
      // Revert the local state if update fails
      setDeal(deal);
    }
  };

  const handleStageDataChange = async (newStageData: any) => {
    console.log('handleStageDataChange called with:', newStageData);
    setStageData(newStageData);
    
    // Save stage data to Firestore
    if (deal && tenantId) {
      try {
        console.log('Saving to Firestore - dealId:', deal.id, 'tenantId:', tenantId);
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
          stageData: newStageData,
          updatedAt: new Date()
        });
        console.log('✅ Stage data successfully saved to Firestore:', newStageData);
      } catch (error) {
        console.error('❌ Error saving stage data:', error);
      }
    } else {
      console.error('❌ Cannot save - missing deal or tenantId:', { deal: !!deal, tenantId });
    }
  };

  const handleStageAdvance = async (newStage: string) => {
    if (!deal || !tenantId) return;
    
    try {
      const updatedDeal = { ...deal, stage: newStage };
      setDeal(updatedDeal);
      
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        stage: newStage,
        updatedAt: new Date()
      });
    } catch (err) {
      console.error('Error advancing stage:', err);
      // Revert the local state if update fails
      setDeal(deal);
    }
  };

  const handleMarkStageIncomplete = async (stageKey: string) => {
    if (!deal || !tenantId) return;
    
    try {
      // Find the stage index and go back to the previous stage
      const STAGES = [
        { key: 'discovery', label: 'Discovery' },
        { key: 'qualification', label: 'Qualification' },
        { key: 'scoping', label: 'Scoping' },
        { key: 'proposalDrafted', label: 'Proposal Drafted' },
        { key: 'proposalReview', label: 'Proposal Review' },
        { key: 'negotiation', label: 'Negotiation' },
        { key: 'verbalAgreement', label: 'Verbal Agreement' },
        { key: 'closedWon', label: 'Closed Won' },
        { key: 'closedLost', label: 'Closed Lost' },
        { key: 'onboarding', label: 'Onboarding' },
        { key: 'liveAccount', label: 'Live Account' },
        { key: 'dormant', label: 'Dormant' }
      ];
      
      const currentIndex = STAGES.findIndex(s => s.key === deal.stage);
      const targetIndex = STAGES.findIndex(s => s.key === stageKey);
      
      if (targetIndex >= 0 && targetIndex < currentIndex) {
        const previousStage = STAGES[targetIndex];
        const updatedDeal = { ...deal, stage: previousStage.key };
        setDeal(updatedDeal);
        
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
          stage: previousStage.key,
          updatedAt: new Date()
        });
      }
    } catch (err) {
      console.error('Error marking stage incomplete:', err);
      // Revert the local state if update fails
      setDeal(deal);
    }
  };

  const handleDeleteDeal = async () => {
    if (!deal || !tenantId) return;
    
    if (!window.confirm(`Are you sure you want to delete "${deal.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      // Delete the deal from Firestore
      await deleteDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id));
      
      // Navigate back to CRM with Opportunities tab active
      navigate('/crm?tab=opportunities');
    } catch (err) {
      console.error('Error deleting deal:', err);
      alert('Failed to delete deal. Please try again.');
    }
  };

  const loadAssociatedContacts = async () => {
    if (!deal || !tenantId || !user?.uid) return;
    
    try {
      console.log('Loading associated contacts for deal:', deal.id);
      
      // Use the denormalized association service for fast loading
      const associationService = createDenormalizedAssociationService(tenantId);
      const result = await associationService.getAssociations('deal', deal.id);
      
      console.log('Association service result:', result);
      console.log('Found contacts:', result.contacts);
      
      // Map the contacts to the expected format (defensive against undefined)
      const contacts = (result?.contacts || []).map(contact => ({
        id: contact.id,
        fullName: contact.name || 'Unknown Contact',
        email: contact.email || '',
        phone: contact.phone || '',
        title: '' // Title not available in denormalized format
      }));
      
      console.log('Mapped contacts:', contacts);
      setAssociatedContacts(contacts);
      
    } catch (err) {
      console.error('Error loading associated contacts:', err);
      setAssociatedContacts([]);
    }
  };

  // Calculate expected annual revenue range based on qualification data
  const calculateExpectedRevenueRange = () => {
    if (!stageData?.qualification) {
      return { min: 0, max: 0, hasData: false };
    }

    const qualData = stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
    const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
    const timeline = qualData.staffPlacementTimeline;

    if (!timeline) {
      return { min: 0, max: 0, hasData: false };
    }

    // Calculate bill rate: pay rate + markup
    const billRate = payRate * (1 + markup / 100);
    
    // Annual hours per employee (2080 full-time hours)
    const annualHoursPerEmployee = 2080;
    
    // Calculate annual revenue per employee
    const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
    
    // Get starting and 180-day numbers
    const startingCount = timeline.starting || 0;
    const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
    
    // Calculate revenue range
    const minRevenue = annualRevenuePerEmployee * startingCount;
    const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
    
    return {
      min: minRevenue,
      max: maxRevenue,
      hasData: startingCount > 0 || after180DaysCount > 0,
      billRate,
      annualRevenuePerEmployee,
      startingCount,
      after180DaysCount
    };
  };

  useEffect(() => {
    if (deal && tenantId) {
      loadAssociatedContacts();
    }
  }, [deal, tenantId]);

  // Ensure stage synchronization between overview and DealStageForms
  useEffect(() => {
    if (deal && (!deal.stage || deal.stage === '')) {
      // If deal has no stage, set it to discovery
      handleDealUpdate('stage', 'discovery');
    }
  }, [deal]);



  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !deal) {
    return (
      <Box p={3}>
        <Alert severity="error">{error || 'Deal not found'}</Alert>
      </Box>
    );
  }

  // Guard: require tenantId to proceed so downstream props are typed as string
  if (!tenantId) {
    return (
      <Box p={3}>
        <Alert severity="warning">Missing tenant context. Please reload or switch tenant.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Deal Avatar - Use company avatar if available, otherwise deal icon */}
            <Avatar
              sx={{ 
                width: 80, 
                height: 80,
                bgcolor: company?.logo ? 'transparent' : 'primary.main',
                fontSize: '1.5rem',
                fontWeight: 'bold'
              }}
              src={company?.logo}
              alt={company?.companyName || company?.name || 'Deal'}
            >
              {!company?.logo && <DealIcon />}
            </Avatar>

            {/* Deal Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, pb:0, pt:0 }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                {deal.name}
              </Typography>
              
              {/* Company and Location */}
              {company && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography 
                    variant="body2" 
                    color="primary"
                    sx={{ 
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      '&:hover': {
                        color: 'primary.dark'
                      }
                    }}
                    onClick={() => navigate(`/crm/companies/${company.id}`)}
                  >
                    {company.companyName || company.name}
                  </Typography>
                  {deal.locationName && (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        /
                      </Typography>
                      <Typography 
                        variant="body2" 
                        color="primary"
                        sx={{ 
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          '&:hover': {
                            color: 'primary.dark'
                          }
                        }}
                        onClick={() => navigate(`/crm/companies/${company.id}/locations/${deal.locationId}`)}
                      >
                        {deal.locationName}
                      </Typography>
                    </>
                  )}
                </Box>
              )}
              
              {/* Stage, Revenue, and Close Date */}
              <Box sx={{ display: 'flex', alignItems: 'center', pt:1, gap: 2 }}>
                <StageChip stage={deal.stage} size="small" useCustomColors={true} />
                {(() => {
                  const revenueRange = calculateExpectedRevenueRange();
                  return (
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'bold' }}>
                      {revenueRange.hasData 
                        ? `$${revenueRange.min.toLocaleString()} - $${revenueRange.max.toLocaleString()}`
                        : 'Revenue range pending qualification'
                      }
                    </Typography>
                  );
                })()}
                {(() => {
                  const qualData = stageData?.qualification;
                  const expectedCloseDate = qualData?.expectedCloseDate;
                  
                  return expectedCloseDate ? (
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'bold' }}>
                      Close: {new Date(expectedCloseDate + 'T00:00:00').toLocaleDateString()}
                    </Typography>
                  ) : null;
                })()}
              </Box>
            </Box>
          </Box>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button 
              variant="outlined" 
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/crm?tab=opportunities')}
            >
              Back to Opportunities
            </Button>
            <Button 
              variant="outlined" 
              color="error"
              sx={{ 
                borderColor: 'error.main',
                '&:hover': {
                  borderColor: 'error.dark',
                  backgroundColor: 'error.light'
                }
              }}
              startIcon={<DeleteIcon />}
              onClick={handleDeleteDeal}
            >
              Delete Deal
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Deal details tabs"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <InfoIcon fontSize="small" />
                Overview
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TaskIcon fontSize="small" />
                Tasks
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TimelineIcon fontSize="small" />
                Stages
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NotesIcon fontSize="small" />
                Notes
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {/* <AutoAwesomeIcon fontSize="small" /> */}
                <ListIcon fontSize="small" />
                Activity Log
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <EmailIcon fontSize="small" />
                Email
              </Box>
            } 
          />
          {/* <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon fontSize="small" />
                Job Order Settings
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PsychologyIcon fontSize="small" />
                AI Suggestions
              </Box>
            } 
          /> */}
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader title="Opportunity Information" sx={{ p: 0, mb: 2 }} />
              <CardContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label="Deal Name"
                    value={deal.name || ''}
                    onChange={(e) => handleDealUpdate('name', e.target.value)}
                    fullWidth
                    size="small"
                  />

                  <Box>
                    <Typography variant="body1" color="text.primary" sx={{ mb: 1, fontWeight: 'bold' }}>
                      Stage
                    </Typography>
                    <StageChip stage={deal.stage} size="medium" useCustomColors={true} />
                  </Box>
                  {(() => {
                    const revenueRange = calculateExpectedRevenueRange();
                    return (
                      <Box>
                        <Typography variant="body1" color="text.primary" sx={{ mb: 1, fontWeight: 'bold' }}>
                          Expected Annual Revenue Range
                        </Typography>
                        {revenueRange.hasData ? (
                          <Box>
                            <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
                              ${revenueRange.min.toLocaleString()} - ${revenueRange.max.toLocaleString()}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Based on ${Number(revenueRange.billRate ?? 0).toFixed(2)}/hr bill rate • {revenueRange.startingCount} starting • {revenueRange.after180DaysCount} after 6 months
                            </Typography>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            Complete qualification data to see revenue range
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                  {(() => {
                    const qualData = stageData?.qualification;
                    const expectedCloseDate = qualData?.expectedCloseDate;
                    
                    return (
                      <Box>
                        <Typography variant="body1" color="text.primary" sx={{ mb: 1, fontWeight: 'bold' }}>
                          Expected Close Date
                        </Typography>
                        {expectedCloseDate ? (
                          <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
                            {new Date(expectedCloseDate + 'T00:00:00').toLocaleDateString()}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            Set expected close date in qualification data
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}

                  {/* AI Summary */}
                  <Box sx={{ mt: 3 }}>
                    <DealAISummary
                      dealId={deal.id}
                      tenantId={tenantId}
                      onSummaryUpdate={() => {
                        // Optionally refresh deal data when summary updates
                        console.log('AI Summary updated');
                      }}
                    />
                  </Box>

                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <FastAssociationsCard
              entityType="deal"
              entityId={deal.id}
              tenantId={tenantId}
              entityName={deal.name}
              showAssociations={{
                companies: true,
                locations: true,
                contacts: true,
                salespeople: true,
                deals: false, // Don't show deals for deals
                tasks: false
              }}
            />
          </Grid>

        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <DealTasksDashboard
          dealId={deal.id}
          tenantId={tenantId}
          deal={deal}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <DealStageForms
              dealId={deal.id}
              tenantId={tenantId}
              currentStage={deal.stage}
              stageData={stageData}
              onStageDataChange={handleStageDataChange}
              onStageAdvance={handleStageAdvance}
              onStageIncomplete={handleMarkStageIncomplete}
              associatedContacts={associatedContacts}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            {(() => {
              let enable = true;
              try { enable = localStorage.getItem('feature.dealCoach') !== 'false'; } catch {}
              return enable ? (
                <DealCoachPanel dealId={deal.id} stageKey={deal.stage} tenantId={tenantId} />
              ) : (
                <Card>
                  <CardHeader title="AI Stage Suggestions" sx={{ p: 0, mb: 2 }} titleTypographyProps={{ variant: 'h6' }} />
                  <CardContent>
                    <DealStageAISuggestions
                      dealId={deal.id}
                      tenantId={tenantId}
                      currentStage={deal.stage}
                      onTaskCreated={(taskId) => { console.log('Task created from side panel:', taskId); }}
                    />
                  </CardContent>
                </Card>
              );
            })()}
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <CRMNotesTab
          entityId={deal.id}
          entityType="deal"
          entityName={deal.name || 'Deal'}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <ActivityLogTab
          entityId={deal.id}
          entityType="deal"
          entityName={deal.name || 'Deal'}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <EmailTab
          dealId={deal.id}
          tenantId={tenantId}
          contacts={associatedContacts}
          companies={company ? [company] : []}
          currentUser={user}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={6}>
        <Card>
          <CardHeader title="Order Defaults" sx={{ p: 0, mb: 2 }} />
          <CardContent>
            <Typography color="text.secondary">
              Job Order Settings functionality coming soon...
            </Typography>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={tabValue} index={7}>
        <Card>
          <CardHeader title="AI Suggestions" sx={{ p: 0, mb: 2 }} />
          <CardContent>
            <DealStageAISuggestions
              dealId={deal.id}
              tenantId={tenantId}
              currentStage={deal.stage}
              onTaskCreated={(taskId) => {
                console.log('Task created from AI suggestions tab:', taskId);
              }}
            />
          </CardContent>
        </Card>
      </TabPanel>
    </Box>
  );
};

export default DealDetails; 