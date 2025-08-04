import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Avatar,
  Chip,
  Button,
  IconButton,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Badge,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardHeader,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  AttachMoney as DealIcon,
  Info as InfoIcon,
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  Settings as SettingsIcon,
  Psychology as PsychologyIcon,
  LocationOn as LocationIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Analytics as AnalyticsIcon,
  AutoAwesome as AutoAwesomeIcon,
  Task as TaskIcon,
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { createAssociationService } from '../../utils/associationService';
import StageChip from '../../components/StageChip';
import CRMNotesTab from '../../components/CRMNotesTab';
import SimpleAssociationsCard from '../../components/SimpleAssociationsCard';
import DealStageForms from '../../components/DealStageForms';
import DealActivityTab from '../../components/DealActivityTab';
import DealStageAISuggestions from '../../components/DealStageAISuggestions';
import DealTasksDashboard from '../../components/DealTasksDashboard';
import { getAllStages } from '../../utils/crmStageColors';

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

  const loadAssociatedContacts = async () => {
    if (!deal || !tenantId || !user?.uid) return;
    
    try {
      console.log('Loading associated contacts for deal:', deal.id);
      
      // Use the associationService to load contacts (same as UniversalAssociationsCard)
      const associationService = createAssociationService(tenantId, user.uid);
      const result = await associationService.queryAssociations({
        entityType: 'deal',
        entityId: deal.id,
        targetTypes: ['contact']
      });
      
      console.log('Association service result:', result);
      console.log('Found contacts:', result.entities.contacts);
      
      // Map the contacts to the expected format
      const contacts = result.entities.contacts.map(contact => ({
        id: contact.id,
        fullName: contact.fullName || (contact as any).name || 'Unknown Contact',
        email: contact.email || '',
        phone: contact.phone || '',
        title: contact.title || (contact as any).jobTitle || ''
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
            {/* <Button variant="outlined" startIcon={<EditIcon />}>
              Edit
            </Button> */}
            <Button 
              variant="outlined" 
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/crm')}
            >
              Back to Opportunities
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper elevation={1} sx={{ mb: 2, borderRadius: 0 }}>
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
                <AutoAwesomeIcon fontSize="small" />
                Activity & AI
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
          />
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
                              Based on ${revenueRange.billRate.toFixed(2)}/hr bill rate • {revenueRange.startingCount} starting • {revenueRange.after180DaysCount} after 6 months
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

                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <SimpleAssociationsCard
              entityType="deal"
              entityId={deal.id}
              entityName={deal.name}
              tenantId={tenantId}
              showAssociations={{
                companies: true,
                locations: true,
                contacts: true,
                salespeople: true,
                deals: false, // Don't show deals for deals
                tasks: false
              }}
              customLabels={{
                companies: "Company",
                locations: "Location",
                contacts: "Contacts",
                salespeople: "Sales Team"
              }}
              onAssociationChange={(type, action, entityId) => {
                console.log(`${action} ${type} association: ${entityId}`);
              }}
              onError={(error) => {
                console.error('Association error:', error);
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
              associatedContacts={associatedContacts}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardHeader 
                title="AI Stage Suggestions" 
                sx={{ p: 0, mb: 2 }}
                titleTypographyProps={{ variant: 'h6' }}
              />
              <CardContent>
                <DealStageAISuggestions
                  dealId={deal.id}
                  tenantId={tenantId}
                  currentStage={deal.stage}
                  onTaskCreated={(taskId) => {
                    console.log('Task created from side panel:', taskId);
                  }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <DealActivityTab
          dealId={deal.id}
          tenantId={tenantId}
          dealName={deal.name}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <CRMNotesTab
          entityId={deal.id}
          entityType="deal"
          entityName={deal.name || 'Deal'}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <Card>
          <CardHeader title="Order Defaults" sx={{ p: 0, mb: 2 }} />
          <CardContent>
            <Typography color="text.secondary">
              Job Order Settings functionality coming soon...
            </Typography>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={tabValue} index={6}>
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