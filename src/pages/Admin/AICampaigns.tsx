import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Switch,
  FormControlLabel,
  Snackbar,
  Alert,
  Card,
  CardContent,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Tabs,
  Tab,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Tooltip,
  Fab,
  LinearProgress,
  CircularProgress,
  useTheme,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Autocomplete,
  FormHelperText,
  AlertTitle,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import CampaignIcon from '@mui/icons-material/Campaign';
import SendIcon from '@mui/icons-material/Send';
import ScheduleIcon from '@mui/icons-material/Schedule';
import GroupIcon from '@mui/icons-material/Group';
import BarChartIcon from '@mui/icons-material/BarChart';
import AutomationIcon from '@mui/icons-material/AutoAwesome';
import TimelineIcon from '@mui/icons-material/Timeline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';

interface Campaign {
  id?: string;
  title: string;
  objective: string;
  category: 'morale' | 'feedback' | 'sales' | 'policy' | 'support' | 'wellness';
  tone: 'motivational' | 'survey' | 'coaching' | 'feedback-seeking' | 'empathetic' | 'directive';
  targetAudience: {
    regionIds: string[];
    divisionIds: string[];
    locationIds: string[];
    departmentIds: string[];
    userIds: string[];
    userGroupIds: string[];
    jobOrderIds: string[];
  };
  startDate: Date;
  frequency: 'one-time' | 'daily' | 'weekly' | 'monthly' | 'custom';
  status: 'draft' | 'active' | 'paused' | 'completed';
  creatorUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
  followUpStrategy: 'none' | '1_followup' | 'continuous' | 'ai_paced';
  tags: string[];
  aiBehavior: {
    responsePattern: string;
    escalationThreshold: number;
    escalationEmail?: string;
    traitTracking: string[];
  };
  analytics?: {
    totalRecipients: number;
    responsesReceived: number;
    avgEngagementScore: number;
    traitChanges: Record<string, number>;
  };
  createdBy: 'HRX' | 'Agency' | 'Customer';
  template: boolean;
  sourceCampaignId?: string;
  tenantId?: string; // Added for HRX filters
  endDate?: Date;
  endAfterCount?: number;
  automation?: {
    autoOptimize: boolean;
    smartScheduling: boolean;
    adaptiveTargeting: boolean;
    performanceThresholds: {
      engagementRate: number;
      responseRate: number;
      satisfactionScore: number;
    };
    optimizationRules: {
      frequencyAdjustment: boolean;
      toneAdjustment: boolean;
      targetingAdjustment: boolean;
      timingAdjustment: boolean;
    };
  };
}

const defaultCampaigns: Campaign[] = [
  {
    title: 'Q3 Sales Push',
    objective: 'Motivate sales team to achieve quarterly targets',
    category: 'sales',
    tone: 'motivational',
    targetAudience: {
      regionIds: [],
      divisionIds: [],
      locationIds: [],
      departmentIds: ['sales'],
      userIds: [],
      userGroupIds: [],
      jobOrderIds: [],
    },
    startDate: new Date(),
    frequency: 'weekly',
    status: 'draft',
    creatorUserId: 'admin',
    followUpStrategy: 'ai_paced',
    tags: ['sales', 'motivation', 'quarterly'],
    aiBehavior: {
      responsePattern: 'encouraging',
      escalationThreshold: 0.3,
      escalationEmail: 'sales-manager@company.com',
      traitTracking: ['motivation', 'engagement', 'performance'],
    },
    createdBy: 'HRX',
    template: true,
    sourceCampaignId: undefined,
    tenantId: 'tenant1', // Added for HRX filters
  },
  {
    title: 'New PTO Policy Feedback',
    objective: 'Gather employee sentiment on new PTO policy',
    category: 'feedback',
    tone: 'survey',
    targetAudience: {
      regionIds: [],
      divisionIds: [],
      locationIds: [],
      departmentIds: [],
      userIds: [],
      userGroupIds: [],
      jobOrderIds: [],
    },
    startDate: new Date(),
    frequency: 'one-time',
    status: 'draft',
    creatorUserId: 'admin',
    followUpStrategy: '1_followup',
    tags: ['policy', 'feedback', 'pto'],
    aiBehavior: {
      responsePattern: 'neutral',
      escalationThreshold: 0.5,
      traitTracking: ['satisfaction', 'engagement'],
    },
    createdBy: 'HRX',
    template: true,
    sourceCampaignId: undefined,
    tenantId: 'tenant2', // Added for HRX filters
  },
];

const AICampaigns: React.FC = () => {
  const { currentUser, orgType, tenantId } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>(defaultCampaigns);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Campaign | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [automationDialog, setAutomationDialog] = useState(false);
  const [automationCampaign, setAutomationCampaign] = useState<Campaign | null>(null);
  const [automationStep, setAutomationStep] = useState(0);
  const [automationConfig, setAutomationConfig] = useState({
    autoOptimize: false,
    smartScheduling: false,
    adaptiveTargeting: false,
    performanceThresholds: {
      engagementRate: 0.3,
      responseRate: 0.2,
      satisfactionScore: 0.7
    },
    optimizationRules: {
      frequencyAdjustment: true,
      toneAdjustment: true,
      targetingAdjustment: true,
      timingAdjustment: true
    }
  });
  const [newCampaign, setNewCampaign] = useState<Campaign>({
    title: '',
    objective: '',
    category: 'morale',
    tone: 'motivational',
    targetAudience: {
      regionIds: [],
      divisionIds: [],
      locationIds: [],
      departmentIds: [],
      userIds: [],
      userGroupIds: [],
      jobOrderIds: [],
    },
    startDate: new Date(),
    frequency: 'one-time',
    status: 'draft',
    creatorUserId: 'admin',
    followUpStrategy: 'none',
    tags: [],
    aiBehavior: {
      responsePattern: 'encouraging',
      escalationThreshold: 0.3,
      traitTracking: ['motivation', 'engagement'],
    },
    createdBy: 'Agency', // or 'Customer' depending on context
    template: false,
    sourceCampaignId: undefined,
    tenantId: 'tenant1', // Added for HRX filters
    endDate: undefined,
    endAfterCount: undefined,
  });
  const [analyticsDialogOpen, setAnalyticsDialogOpen] = useState(false);
  const [analyticsCampaign, setAnalyticsCampaign] = useState<Campaign | null>(null);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [analyticsTenant, setAnalyticsTenant] = useState('');
  // Add state for real tenants
  const [tenantList, setTenantList] = useState<{ id: string; name: string; type: 'Agency' | 'Customer' }[]>([]);

  // Add state for audience data
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [divisions, setDivisions] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string; nickname?: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [userGroups, setUserGroups] = useState<{ id: string; title: string; description?: string }[]>([]);
  const [audienceEntireWorkforce, setAudienceEntireWorkforce] = useState(false);
  // Frequency end logic
  const [endType, setEndType] = useState<'date' | 'count'>('date');

  // Extract unique tenants and categories for filters
  const tenantOptions = Array.from(new Set(campaigns.map(c => c.tenantId).filter(Boolean)));
  const categoryOptions = Array.from(new Set(campaigns.map(c => c.category)));
  const statusOptions = Array.from(new Set(campaigns.map(c => c.status)));

  // Filter campaigns for HRX
  const filteredCampaigns = campaigns.filter(c => {
    if (orgType === 'HRX') {
      if (filterTenant && c.tenantId !== filterTenant) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (filterCategory && c.category !== filterCategory) return false;
    }
    return true;
  });

  // Helper to aggregate analytics for a tenant
  const getTenantAggregateAnalytics = (tenantId: string) => {
    const tenantCampaigns = campaigns.filter(c => c.tenantId === tenantId && c.analytics);
    if (tenantCampaigns.length === 0) return null;
    const totalRecipients = tenantCampaigns.reduce((sum, c) => sum + (c.analytics?.totalRecipients || 0), 0);
    const responsesReceived = tenantCampaigns.reduce((sum, c) => sum + (c.analytics?.responsesReceived || 0), 0);
    const avgEngagementScore = tenantCampaigns.length > 0 ? (tenantCampaigns.reduce((sum, c) => sum + (c.analytics?.avgEngagementScore || 0), 0) / tenantCampaigns.length) : 0;
    // Aggregate trait changes
    const traitChanges: Record<string, number> = {};
    tenantCampaigns.forEach(c => {
      if (c.analytics?.traitChanges) {
        Object.entries(c.analytics.traitChanges).forEach(([trait, delta]) => {
          traitChanges[trait] = (traitChanges[trait] || 0) + delta;
        });
      }
    });
    return { totalRecipients, responsesReceived, avgEngagementScore, traitChanges };
  };

  const navigate = useNavigate();
  const functions = getFunctions();
  const theme = useTheme();

  useEffect(() => {
    fetchCampaigns();
  }, []);

  // Fetch tenants and tenants for tenant dropdown
  useEffect(() => {
    if (orgType === 'HRX') {
      const fetchTenants = async () => {
        try {
          const tenantsSnap = await getDocs(collection(db, 'tenants'));
          const tenants = tenantsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id, type: doc.data().type || 'Tenant' }));
          setTenantList(tenants);
        } catch (err) {
          // Optionally handle error
        }
      };
      fetchTenants();
    }
  }, [orgType]);

  // Fetch audience data based on user type
  useEffect(() => {
    const fetchAudienceData = async () => {
      try {
        if (orgType === 'HRX') {
          // For HRX, we'll fetch from the selected tenant or show all
          if (filterTenant) {
            const tenant = tenantList.find(t => t.id === filterTenant);
            if (tenant) {
              await fetchTenantAudienceData(tenant.id);
            }
          }
        } else if (orgType === 'Tenant' && tenantId) {
          await fetchTenantAudienceData(tenantId);
        }
      } catch (err) {
        console.error('Error fetching audience data:', err);
      }
    };

    fetchAudienceData();
  }, [orgType, tenantId, filterTenant, tenantList]);

  const fetchAgencyAudienceData = async (tenantId: string) => {
    try {
      // Fetch regions
      const regionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'regions'));
      setRegions(regionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
      // Fetch divisions
      const divisionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'divisions'));
      setDivisions(divisionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
      // Fetch locations
      const locationsSnap = await getDocs(collection(db, 'tenants', tenantId, 'locations'));
      setLocations(locationsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().nickname || doc.data().street || doc.id, nickname: doc.data().nickname })));
      // Fetch departments
      const departmentsSnap = await getDocs(collection(db, 'tenants', tenantId, 'departments'));
      setDepartments(departmentsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id, code: doc.data().code })));
      // Fetch user groups
      const userGroupsSnap = await getDocs(collection(db, 'tenants', tenantId, 'userGroups'));
      setUserGroups(userGroupsSnap.docs.map(doc => ({ id: doc.id, title: doc.data().title || doc.id, description: doc.data().description })));
    } catch (err) {
      console.error('Error fetching agency audience data:', err);
    }
  };

  const fetchCustomerAudienceData = async (tenantId: string) => {
    try {
      // Fetch regions
      const regionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'regions'));
      setRegions(regionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
      // Fetch divisions
      const divisionsSnap = await getDocs(collection(db, 'tenants', tenantId, 'divisions'));
      setDivisions(divisionsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })));
      // Fetch locations
      const locationsSnap = await getDocs(collection(db, 'tenants', tenantId, 'locations'));
      setLocations(locationsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().nickname || doc.data().street || doc.id, nickname: doc.data().nickname })));
      // Fetch departments
      const departmentsSnap = await getDocs(collection(db, 'tenants', tenantId, 'departments'));
      setDepartments(departmentsSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id, code: doc.data().code })));
      // Fetch user groups
      const userGroupsSnap = await getDocs(collection(db, 'tenants', tenantId, 'userGroups'));
      setUserGroups(userGroupsSnap.docs.map(doc => ({ id: doc.id, title: doc.data().title || doc.id, description: doc.data().description })));
    } catch (err) {
      console.error('Error fetching customer audience data:', err);
    }
  };

  const fetchTenantAudienceData = async (tenantId: string) => {
    try {
      // Fetch users for this tenant
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        where('role', '==', 'Worker')
      );
      const snapshot = await getDocs(q);
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      
      // For HRX, we'll use the fetched users as the audience
      setAudienceEntireWorkforce(false); // Explicitly set to false
      setLocations(users.map(user => ({ 
        id: user.id, 
        name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email || user.id, 
        nickname: user.firstName || user.email || user.id 
      })));
      setDepartments([]); // No departments for users
      setUserGroups([]); // No user groups for users
    } catch (err) {
      console.error('Error fetching tenant audience data:', err);
    }
  };

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const campaignsRef = collection(db, 'campaigns');
      const campaignsSnap = await getDocs(campaignsRef);
      if (!campaignsSnap.empty) {
        const fetchedCampaigns = campaignsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Campaign[];
        setCampaigns(fetchedCampaigns);
      } else {
        await initializeDefaultCampaigns();
      }
    } catch (err: any) {
      setError('Failed to fetch campaigns');
    }
    setLoading(false);
  };

  const initializeDefaultCampaigns = async () => {
    try {
      const campaignsRef = collection(db, 'campaigns');
      for (const campaign of defaultCampaigns) {
        await addDoc(campaignsRef, {
          ...campaign,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      await fetchCampaigns();
    } catch (err: any) {
      setError('Failed to initialize default campaigns');
    }
  };

  const handleSave = async (campaign: Campaign) => {
    try {
      const startTime = Date.now();
      let success = false;
      const errorMessage = '';

      if (campaign.id) {
        const campaignRef = doc(db, 'campaigns', campaign.id);
        await updateDoc(campaignRef, {
          ...campaign,
          updatedAt: new Date(),
        });
        success = true;
      } else {
        const campaignsRef = collection(db, 'campaigns');
        const newCampaign = {
          ...campaign,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await addDoc(campaignsRef, newCampaign);
        success = true;
      }

      // Log the campaign save action
      const logAIAction = httpsCallable(functions, 'logAIAction');
      await logAIAction({
        userId: 'admin', // TODO: Get from auth context
        actionType: 'campaign_save',
        sourceModule: 'CampaignsEngine',
        inputPrompt: JSON.stringify(campaign),
        composedPrompt: `Campaign "${campaign.title}" saved with objective: ${campaign.objective}`,
        aiResponse: 'Campaign saved successfully',
        success,
        errorMessage,
        latencyMs: Date.now() - startTime,
        versionTag: 'v1',
        eventType: campaign.id ? 'campaign.updated' : 'campaign.created',
        targetType: 'campaign',
        targetId: campaign.id || 'new',
        aiRelevant: true,
        contextType: 'campaigns',
        traitsAffected: campaign.aiBehavior.traitTracking,
        aiTags: ['campaign', campaign.category],
        urgencyScore: 6,
        reason: `${campaign.id ? 'Updated' : 'Created'} campaign "${campaign.title}"`
      });

      setEditingCampaign(null);
      setEditingData(null);
      setSuccess(true);
      fetchCampaigns();
    } catch (err: any) {
      setError('Failed to save campaign');
    }
  };

  const handleDelete = async (campaignId: string) => {
    try {
      const startTime = Date.now();
      const campaign = campaigns.find(c => c.id === campaignId);
      
      await deleteDoc(doc(db, 'campaigns', campaignId));
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));

      // Log the campaign deletion action
      const logAIAction = httpsCallable(functions, 'logAIAction');
      await logAIAction({
        userId: 'admin', // TODO: Get from auth context
        actionType: 'campaign_delete',
        sourceModule: 'CampaignsEngine',
        inputPrompt: JSON.stringify({ campaignId }),
        composedPrompt: `Campaign "${campaign?.title || campaignId}" deleted`,
        aiResponse: 'Campaign deleted successfully',
        success: true,
        latencyMs: Date.now() - startTime,
        versionTag: 'v1',
        eventType: 'campaign.deleted',
        targetType: 'campaign',
        targetId: campaignId,
        aiRelevant: true,
        contextType: 'campaigns',
        traitsAffected: campaign?.aiBehavior.traitTracking || [],
        aiTags: ['campaign', campaign?.category || 'unknown'],
        urgencyScore: 7,
        reason: `Deleted campaign "${campaign?.title || campaignId}"`
      });

      setSuccess(true);
    } catch (err: any) {
      setError('Failed to delete campaign');
    }
  };

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign.id || 'new');
    setEditingData({ ...campaign });
  };

  const handleCancel = () => {
    setEditingCampaign(null);
    setEditingData(null);
  };

  const handlePreview = (campaign: Campaign) => {
    setPreviewCampaign(campaign);
    setPreviewDialog(true);
  };

  const handleCampaignChange = (field: keyof Campaign, value: any) => {
    if (editingData) {
      setEditingData({ ...editingData, [field]: value });
    }
  };

  const handleCreateCampaign = async () => {
    try {
      const startTime = Date.now();
      const campaignsRef = collection(db, 'campaigns');
      await addDoc(campaignsRef, {
        ...newCampaign,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Log the campaign creation action
      const logAIAction = httpsCallable(functions, 'logAIAction');
      await logAIAction({
        userId: 'admin', // TODO: Get from auth context
        actionType: 'campaign_create',
        sourceModule: 'CampaignsEngine',
        inputPrompt: JSON.stringify(newCampaign),
        composedPrompt: `Campaign "${newCampaign.title}" created with objective: ${newCampaign.objective}`,
        aiResponse: 'Campaign created successfully',
        success: true,
        latencyMs: Date.now() - startTime,
        versionTag: 'v1',
        eventType: 'campaign.created',
        targetType: 'campaign',
        targetId: 'new',
        aiRelevant: true,
        contextType: 'campaigns',
        traitsAffected: newCampaign.aiBehavior.traitTracking,
        aiTags: ['campaign', newCampaign.category],
        urgencyScore: 6,
        reason: `Created campaign "${newCampaign.title}"`
      });

      setShowCreateForm(false);
      setNewCampaign({
        title: '',
        objective: '',
        category: 'morale',
        tone: 'motivational',
        targetAudience: {
          regionIds: [],
          divisionIds: [],
          locationIds: [],
          departmentIds: [],
          userIds: [],
          userGroupIds: [],
          jobOrderIds: [],
        },
        startDate: new Date(),
        frequency: 'one-time',
        status: 'draft',
        creatorUserId: 'admin',
        followUpStrategy: 'none',
        tags: [],
        aiBehavior: {
          responsePattern: 'encouraging',
          escalationThreshold: 0.3,
          traitTracking: ['motivation', 'engagement'],
        },
        createdBy: 'Agency', // or 'Customer' depending on context
        template: false,
        sourceCampaignId: undefined,
        tenantId: 'tenant1', // Added for HRX filters
        endDate: undefined,
        endAfterCount: undefined,
      });
      setAudienceEntireWorkforce(false);
      fetchCampaigns();
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to create campaign');
    }
  };

  const handleOpenAnalytics = (campaign: Campaign) => {
    setAnalyticsCampaign(campaign);
    setAnalyticsDialogOpen(true);
  };
  const handleCloseAnalytics = () => {
    setAnalyticsDialogOpen(false);
    setAnalyticsCampaign(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'draft':
        return 'default';
      case 'paused':
        return 'warning';
      case 'completed':
        return 'info';
      default:
        return 'default';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'morale':
        return 'primary';
      case 'feedback':
        return 'secondary';
      case 'sales':
        return 'success';
      case 'policy':
        return 'warning';
      case 'support':
        return 'info';
      case 'wellness':
        return 'error';
      default:
        return 'default';
    }
  };

  const handleActivateTemplate = async (templateCampaign: Campaign) => {
    try {
      let tenantId = '';
      let createdBy: 'Tenant' | 'HRX' = 'Tenant';
      if (orgType === 'Tenant') {
        tenantId = tenantId || '';
        createdBy = 'Tenant';
      } else if (orgType === 'HRX') {
        tenantId = tenantId || '';
        createdBy = 'HRX';
      }
      const creatorUserId = currentUser?.uid || '';
      if (!tenantId || !creatorUserId) {
        setError('Missing user or tenant context');
        return;
      }
      const activateTemplate = httpsCallable(functions, 'activateCampaignTemplate');
      const result = await activateTemplate({
        templateCampaignId: templateCampaign.id,
        tenantId,
        creatorUserId,
        createdBy,
      });
      fetchCampaigns();
      setSuccessMessage('Template activated!');
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to activate template');
    }
  };

  const handleOpenAutomation = (campaign: Campaign) => {
    setAutomationCampaign(campaign);
    setAutomationDialog(true);
    setAutomationStep(0);
  };

  const handleCloseAutomation = () => {
    setAutomationDialog(false);
    setAutomationCampaign(null);
    setAutomationStep(0);
  };

  const handleAutomationConfigChange = (field: string, value: any) => {
    setAutomationConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAutomationConfigNestedChange = (parent: string, field: string, value: any) => {
    setAutomationConfig(prev => ({
      ...prev,
      [parent]: {
        ...(prev[parent as keyof typeof prev] as Record<string, any>),
        [field]: value
      }
    }));
  };

  const handleEnableAutomation = async () => {
    if (!automationCampaign) return;
    
    try {
      setLoading(true);
      // Update campaign with automation settings
      const updatedCampaign = {
        ...automationCampaign,
        automation: automationConfig,
        status: 'active' as const
      };
      
      await handleSave(updatedCampaign);
      setSuccessMessage('Campaign automation enabled successfully!');
      setSuccess(true);
      handleCloseAutomation();
    } catch (error: any) {
      setError(error.message || 'Failed to enable automation');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteCampaign = async (campaign: Campaign) => {
    try {
      setLoading(true);
      const functions = getFunctions();
      const executeCampaign = httpsCallable(functions, 'executeScheduledCampaigns');
      
      const result = await executeCampaign({
        campaignId: campaign.id,
        workerIds: [] // Empty array means target all eligible workers
      });
      
      const resultData = result.data as any;
      setSuccessMessage(`Campaign executed successfully! Sent to ${resultData.totalWorkers} workers.`);
      setSuccess(true);
      await fetchCampaigns();
    } catch (error: any) {
      setError(error.message || 'Failed to execute campaign');
    } finally {
      setLoading(false);
    }
  };

  const handleGetAnalytics = async (campaign: Campaign) => {
    try {
      setLoading(true);
      const functions = getFunctions();
      const getAnalytics = httpsCallable(functions, 'getCampaignAnalytics');
      
      const result = await getAnalytics({
        campaignId: campaign.id,
        timeRange: '30d'
      });
      
      // Update campaign with analytics
      const resultData = result.data as any;
      const updatedCampaign = {
        ...campaign,
        analytics: {
          totalRecipients: resultData.totalSent || 0,
          responsesReceived: resultData.totalReplied || 0,
          avgEngagementScore: resultData.avgEngagementScore || 0,
          traitChanges: resultData.traitImpact || {}
        }
      };
      
      await handleSave(updatedCampaign);
      setSuccessMessage('Analytics updated successfully!');
      setSuccess(true);
    } catch (error: any) {
      setError(error.message || 'Failed to get analytics');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0, maxWidth: 2400, mx: 'auto' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h3" gutterBottom>
            Campaigns
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Launch goal-oriented AI initiatives with multi-step engagement and trait tracking.
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateForm((prev) => !prev)}
            sx={{ height: 40 }}
          >
            {showCreateForm ? 'Hide Form' : 'New Campaign'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/admin/ai')}
            sx={{ height: 40 }}
          >
            Back to Launchpad
          </Button>
        </Box>
      </Box>

      {/* Inline Create Campaign Form - full width, below description, above tabs */}
      {showCreateForm && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <Paper sx={{ p: 2, width: '100%' }} elevation={2}>
            <Typography variant="h6" gutterBottom>
              Create New Campaign
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Campaign Title"
                  value={newCampaign.title}
                  onChange={(e) => setNewCampaign({ ...newCampaign, title: e.target.value })}
                  margin="normal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth margin="normal">
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={newCampaign.category}
                    onChange={(e) => setNewCampaign({ ...newCampaign, category: e.target.value as any })}
                  >
                    <MenuItem value="morale">Morale</MenuItem>
                    <MenuItem value="feedback">Feedback</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="policy">Policy</MenuItem>
                    <MenuItem value="support">Support</MenuItem>
                    <MenuItem value="wellness">Wellness</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Objective"
                  value={newCampaign.objective}
                  onChange={(e) => setNewCampaign({ ...newCampaign, objective: e.target.value })}
                  margin="normal"
                  multiline
                  rows={3}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth margin="normal">
                  <InputLabel>AI Tone</InputLabel>
                  <Select
                    value={newCampaign.tone}
                    onChange={(e) => setNewCampaign({ ...newCampaign, tone: e.target.value as any })}
                  >
                    <MenuItem value="motivational">Motivational</MenuItem>
                    <MenuItem value="survey">Survey</MenuItem>
                    <MenuItem value="coaching">Coaching</MenuItem>
                    <MenuItem value="feedback-seeking">Feedback-Seeking</MenuItem>
                    <MenuItem value="empathetic">Empathetic</MenuItem>
                    <MenuItem value="directive">Directive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth margin="normal">
                  <InputLabel>Frequency</InputLabel>
                  <Select
                    value={newCampaign.frequency}
                    onChange={(e) => setNewCampaign({ ...newCampaign, frequency: e.target.value as any })}
                  >
                    <MenuItem value="one-time">One-time</MenuItem>
                    <MenuItem value="daily">Daily</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="monthly">Monthly</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {/* Frequency Details: Show if not one-time */}
            {newCampaign.frequency !== 'one-time' && (
              <Box sx={{ mt: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      label="Start Date"
                      type="date"
                      InputLabelProps={{ shrink: true }}
                      value={newCampaign.startDate ? new Date(newCampaign.startDate).toISOString().slice(0, 10) : ''}
                      onChange={e => setNewCampaign({ ...newCampaign, startDate: new Date(e.target.value) })}
                    />
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <Box display="flex" alignItems="center" gap={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={endType === 'count'}
                            onChange={e => setEndType(e.target.checked ? 'count' : 'date')}
                          />
                        }
                        label={endType === 'count' ? 'End after X campaigns' : 'End on date'}
                      />
                      {endType === 'date' ? (
                        <TextField
                          label="End Date"
                          type="date"
                          InputLabelProps={{ shrink: true }}
                          value={newCampaign.endDate ? new Date(newCampaign.endDate).toISOString().slice(0, 10) : ''}
                          onChange={e => setNewCampaign({ ...newCampaign, endDate: new Date(e.target.value) })}
                        />
                      ) : (
                        <TextField
                          label="End After X Campaigns"
                          type="number"
                          inputProps={{ min: 1 }}
                          value={newCampaign.endAfterCount || ''}
                          onChange={e => setNewCampaign({ ...newCampaign, endAfterCount: Number(e.target.value) })}
                        />
                      )}
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Audience Selection Section */}
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Target Audience
              </Typography>
              
              {/* Entire Workforce Option */}
              <FormControlLabel
                control={
                  <Switch
                    checked={audienceEntireWorkforce}
                    onChange={(e) => {
                      setAudienceEntireWorkforce(e.target.checked);
                      if (e.target.checked) {
                        // Clear all specific selections when "entire workforce" is selected
                        setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            regionIds: [],
                            divisionIds: [],
                            locationIds: [],
                            departmentIds: [],
                            userIds: [],
                            userGroupIds: [],
                            jobOrderIds: [],
                          }
                        });
                      }
                    }}
                  />
                }
                label="Target Entire Workforce"
              />

              {!audienceEntireWorkforce && (
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {/* Regions */}
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Regions</InputLabel>
                      <Select
                        multiple
                        value={newCampaign.targetAudience.regionIds}
                        onChange={(e) => setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            ...newCampaign.targetAudience,
                            regionIds: e.target.value as string[],
                            divisionIds: newCampaign.targetAudience.divisionIds || [],
                            locationIds: newCampaign.targetAudience.locationIds || [],
                            departmentIds: newCampaign.targetAudience.departmentIds || [],
                            userIds: newCampaign.targetAudience.userIds || [],
                            userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                            jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                          }
                        })}
                        label="Regions"
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((value) => {
                              const region = regions.find(r => r.id === value);
                              return (
                                <Chip
                                  key={value}
                                  label={region?.name || value}
                                  size="small"
                                  onDelete={() => {
                                    setNewCampaign({
                                      ...newCampaign,
                                      targetAudience: {
                                        ...newCampaign.targetAudience,
                                        regionIds: newCampaign.targetAudience.regionIds.filter(id => id !== value),
                                        divisionIds: newCampaign.targetAudience.divisionIds || [],
                                        locationIds: newCampaign.targetAudience.locationIds || [],
                                        departmentIds: newCampaign.targetAudience.departmentIds || [],
                                        userIds: newCampaign.targetAudience.userIds || [],
                                        userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                                        jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                                      }
                                    });
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {regions.map((region) => (
                          <MenuItem key={region.id} value={region.id}>
                            {region.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* Divisions */}
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Divisions</InputLabel>
                      <Select
                        multiple
                        value={newCampaign.targetAudience.divisionIds}
                        onChange={(e) => setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            ...newCampaign.targetAudience,
                            divisionIds: e.target.value as string[],
                            regionIds: newCampaign.targetAudience.regionIds || [],
                            locationIds: newCampaign.targetAudience.locationIds || [],
                            departmentIds: newCampaign.targetAudience.departmentIds || [],
                            userIds: newCampaign.targetAudience.userIds || [],
                            userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                            jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                          }
                        })}
                        label="Divisions"
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((value) => {
                              const division = divisions.find(d => d.id === value);
                              return (
                                <Chip
                                  key={value}
                                  label={division?.name || value}
                                  size="small"
                                  onDelete={() => {
                                    setNewCampaign({
                                      ...newCampaign,
                                      targetAudience: {
                                        ...newCampaign.targetAudience,
                                        divisionIds: newCampaign.targetAudience.divisionIds.filter(id => id !== value),
                                        regionIds: newCampaign.targetAudience.regionIds || [],
                                        locationIds: newCampaign.targetAudience.locationIds || [],
                                        departmentIds: newCampaign.targetAudience.departmentIds || [],
                                        userIds: newCampaign.targetAudience.userIds || [],
                                        userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                                        jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                                      }
                                    });
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {divisions.map((division) => (
                          <MenuItem key={division.id} value={division.id}>
                            {division.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* Locations */}
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Locations</InputLabel>
                      <Select
                        multiple
                        value={newCampaign.targetAudience.locationIds}
                        onChange={(e) => setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            ...newCampaign.targetAudience,
                            regionIds: newCampaign.targetAudience.regionIds || [],
                            divisionIds: newCampaign.targetAudience.divisionIds || [],
                            locationIds: e.target.value as string[],
                            departmentIds: newCampaign.targetAudience.departmentIds || [],
                            userIds: newCampaign.targetAudience.userIds || [],
                            userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                            jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                          }
                        })}
                        label="Locations"
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((value) => {
                              const location = locations.find(loc => loc.id === value);
                              return (
                                <Chip
                                  key={value}
                                  label={location?.name || value}
                                  size="small"
                                  onDelete={() => {
                                    setNewCampaign({
                                      ...newCampaign,
                                      targetAudience: {
                                        ...newCampaign.targetAudience,
                                        regionIds: newCampaign.targetAudience.regionIds || [],
                                        divisionIds: newCampaign.targetAudience.divisionIds || [],
                                        locationIds: newCampaign.targetAudience.locationIds.filter(id => id !== value),
                                        departmentIds: newCampaign.targetAudience.departmentIds || [],
                                        userIds: newCampaign.targetAudience.userIds || [],
                                        userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                                        jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                                      }
                                    });
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {locations.map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* Departments */}
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Departments</InputLabel>
                      <Select
                        multiple
                        value={newCampaign.targetAudience.departmentIds}
                        onChange={(e) => setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            ...newCampaign.targetAudience,
                            regionIds: newCampaign.targetAudience.regionIds || [],
                            divisionIds: newCampaign.targetAudience.divisionIds || [],
                            locationIds: newCampaign.targetAudience.locationIds || [],
                            departmentIds: e.target.value as string[],
                            userIds: newCampaign.targetAudience.userIds || [],
                            userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                            jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                          }
                        })}
                        label="Departments"
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((value) => {
                              const dept = departments.find(d => d.id === value);
                              return (
                                <Chip
                                  key={value}
                                  label={dept?.name || value}
                                  size="small"
                                  onDelete={() => {
                                    setNewCampaign({
                                      ...newCampaign,
                                      targetAudience: {
                                        ...newCampaign.targetAudience,
                                        regionIds: newCampaign.targetAudience.regionIds || [],
                                        divisionIds: newCampaign.targetAudience.divisionIds || [],
                                        locationIds: newCampaign.targetAudience.locationIds || [],
                                        departmentIds: newCampaign.targetAudience.departmentIds.filter(id => id !== value),
                                        userIds: newCampaign.targetAudience.userIds || [],
                                        userGroupIds: newCampaign.targetAudience.userGroupIds || [],
                                        jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                                      }
                                    });
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {departments.map((dept) => (
                          <MenuItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* User Groups */}
                  <Grid item xs={12}>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>User Groups</InputLabel>
                      <Select
                        multiple
                        value={newCampaign.targetAudience.userGroupIds}
                        onChange={(e) => setNewCampaign({
                          ...newCampaign,
                          targetAudience: {
                            ...newCampaign.targetAudience,
                            regionIds: newCampaign.targetAudience.regionIds || [],
                            divisionIds: newCampaign.targetAudience.divisionIds || [],
                            locationIds: newCampaign.targetAudience.locationIds || [],
                            departmentIds: newCampaign.targetAudience.departmentIds || [],
                            userIds: newCampaign.targetAudience.userIds || [],
                            userGroupIds: e.target.value as string[],
                            jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                          }
                        })}
                        label="User Groups"
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((value) => {
                              const group = userGroups.find(g => g.id === value);
                              return (
                                <Chip
                                  key={value}
                                  label={group?.title || value}
                                  size="small"
                                  onDelete={() => {
                                    setNewCampaign({
                                      ...newCampaign,
                                      targetAudience: {
                                        ...newCampaign.targetAudience,
                                        regionIds: newCampaign.targetAudience.regionIds || [],
                                        divisionIds: newCampaign.targetAudience.divisionIds || [],
                                        locationIds: newCampaign.targetAudience.locationIds || [],
                                        departmentIds: newCampaign.targetAudience.departmentIds || [],
                                        userIds: newCampaign.targetAudience.userIds || [],
                                        userGroupIds: newCampaign.targetAudience.userGroupIds.filter(id => id !== value),
                                        jobOrderIds: newCampaign.targetAudience.jobOrderIds || [],
                                      }
                                    });
                                  }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {userGroups.map((group) => (
                          <MenuItem key={group.id} value={group.id}>
                            {group.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              )}

              {/* Audience Summary */}
              <Box sx={{ mt: 2, p: 2, borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Audience Summary:</strong> {
                    audienceEntireWorkforce 
                      ? 'Entire workforce will be targeted'
                      : [
                          newCampaign.targetAudience.regionIds.length > 0 && `${newCampaign.targetAudience.regionIds.length} region(s)`,
                          newCampaign.targetAudience.divisionIds.length > 0 && `${newCampaign.targetAudience.divisionIds.length} division(s)`,
                          newCampaign.targetAudience.locationIds.length > 0 && `${newCampaign.targetAudience.locationIds.length} location(s)`,
                          newCampaign.targetAudience.departmentIds.length > 0 && `${newCampaign.targetAudience.departmentIds.length} department(s)`,
                          newCampaign.targetAudience.userGroupIds.length > 0 && `${newCampaign.targetAudience.userGroupIds.length} user group(s)`
                        ].filter(Boolean).join(', ') || 'No specific audience selected'
                  }
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button onClick={() => setShowCreateForm(false)} color="secondary">
                Cancel
              </Button>
              <Button
                onClick={handleCreateCampaign}
                variant="contained"
                disabled={!newCampaign.title || !newCampaign.objective}
              >
                Create Campaign
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      {loading ? (
        <LinearProgress sx={{ mb: 2 }} />
      ) : (
        <>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mb: 3 }}>
            <Tab label="All Campaigns" />
            <Tab label="Active" />
            <Tab label="Drafts" />
            <Tab label="Completed" />
            <Tab label="Analytics" />
            <Tab label="Templates" />
          </Tabs>

          {/* HRX Filters */}
          {orgType === 'HRX' && (
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Tenant</InputLabel>
                <Select value={filterTenant} label="Tenant" onChange={e => setFilterTenant(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {tenantList.map(tenant => (
                    <MenuItem key={tenant.id} value={tenant.id}>
                      {tenant.type}: {tenant.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Status</InputLabel>
                <Select value={filterStatus} label="Status" onChange={e => setFilterStatus(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {statusOptions.map(status => (
                    <MenuItem key={status} value={status}>{status}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Category</InputLabel>
                <Select value={filterCategory} label="Category" onChange={e => setFilterCategory(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {categoryOptions.map(cat => (
                    <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}

          {activeTab === 0 && (
            <Grid container spacing={3}>
              {filteredCampaigns.filter(c => !c.template).map((campaign) => (
                <Grid item xs={12} key={campaign.id || campaign.title}>
                  <Paper
                    sx={{
                      p: 3,
                      border:
                        editingCampaign === (campaign.id || 'new') ? '2px solid #1976d2' : undefined,
                      bgcolor:
                        editingCampaign === (campaign.id || 'new')
                          ? 'rgba(25, 118, 210, 0.07)'
                          : undefined,
                    }}
                  >
                    {editingCampaign === (campaign.id || 'new') ? (
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          mb={2}
                        >
                          <Typography variant="h6">Edit Campaign</Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton
                              color="primary"
                              onClick={() => editingData && handleSave(editingData)}
                            >
                              <SaveIcon />
                            </IconButton>
                            <IconButton onClick={handleCancel}>
                              <CancelIcon />
                            </IconButton>
                          </Box>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              label="Campaign Title"
                              value={editingData?.title || ''}
                              onChange={(e) => handleCampaignChange('title', e.target.value)}
                              margin="normal"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth margin="normal">
                              <InputLabel>Category</InputLabel>
                              <Select
                                value={editingData?.category || 'morale'}
                                onChange={(e) => handleCampaignChange('category', e.target.value)}
                              >
                                <MenuItem value="morale">Morale</MenuItem>
                                <MenuItem value="feedback">Feedback</MenuItem>
                                <MenuItem value="sales">Sales</MenuItem>
                                <MenuItem value="policy">Policy</MenuItem>
                                <MenuItem value="support">Support</MenuItem>
                                <MenuItem value="wellness">Wellness</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              label="Objective"
                              value={editingData?.objective || ''}
                              onChange={(e) => handleCampaignChange('objective', e.target.value)}
                              margin="normal"
                              multiline
                              rows={2}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth margin="normal">
                              <InputLabel>AI Tone</InputLabel>
                              <Select
                                value={editingData?.tone || 'motivational'}
                                onChange={(e) => handleCampaignChange('tone', e.target.value)}
                              >
                                <MenuItem value="motivational">Motivational</MenuItem>
                                <MenuItem value="survey">Survey</MenuItem>
                                <MenuItem value="coaching">Coaching</MenuItem>
                                <MenuItem value="feedback-seeking">Feedback-Seeking</MenuItem>
                                <MenuItem value="empathetic">Empathetic</MenuItem>
                                <MenuItem value="directive">Directive</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth margin="normal">
                              <InputLabel>Frequency</InputLabel>
                              <Select
                                value={editingData?.frequency || 'one-time'}
                                onChange={(e) => handleCampaignChange('frequency', e.target.value)}
                              >
                                <MenuItem value="one-time">One-time</MenuItem>
                                <MenuItem value="daily">Daily</MenuItem>
                                <MenuItem value="weekly">Weekly</MenuItem>
                                <MenuItem value="monthly">Monthly</MenuItem>
                                <MenuItem value="custom">Custom</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                        </Grid>
                      </Box>
                    ) : (
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          mb={2}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Box display="flex" alignItems="center" gap={2} mb={1}>
                              <Typography variant="h6" fontWeight={600}>
                                {campaign.title}
                              </Typography>
                              <Chip
                                label={campaign.status}
                                color={getStatusColor(campaign.status) as any}
                                size="small"
                              />
                              <Chip
                                label={campaign.category}
                                color={getCategoryColor(campaign.category) as any}
                                size="small"
                              />
                              <Chip label={campaign.createdBy} color="info" size="small" />
                              {campaign.template && <Chip label="Template" color="secondary" size="small" />}
                            </Box>
                            <Typography variant="body2" color="text.secondary" mb={2}>
                              {campaign.objective}
                            </Typography>
                            <Box display="flex" gap={1} flexWrap="wrap">
                              {campaign.tags.map((tag, index) => (
                                <Chip key={index} label={tag} size="small" variant="outlined" />
                              ))}
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Tooltip title="Analytics">
                              <IconButton onClick={() => handleOpenAnalytics(campaign)}>
                                <BarChartIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Preview">
                              <IconButton onClick={() => handlePreview(campaign)}>
                                <VisibilityIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Automation">
                              <IconButton 
                                onClick={() => handleOpenAutomation(campaign)}
                                color={campaign.automation ? "success" : "default"}
                              >
                                <AutomationIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Execute Now">
                              <IconButton 
                                onClick={() => handleExecuteCampaign(campaign)}
                                color="primary"
                                disabled={campaign.status !== 'active'}
                              >
                                <SendIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Update Analytics">
                              <IconButton onClick={() => handleGetAnalytics(campaign)}>
                                <TrendingUpIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Edit">
                              <IconButton onClick={() => handleEdit(campaign)}>
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton
                                color="error"
                                onClick={() => campaign.id && handleDelete(campaign.id)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={3}>
                            <Typography variant="caption" color="text.secondary">
                              Tone
                            </Typography>
                            <Typography variant="body2">{campaign.tone}</Typography>
                          </Grid>
                          <Grid item xs={12} md={3}>
                            <Typography variant="caption" color="text.secondary">
                              Frequency
                            </Typography>
                            <Typography variant="body2">{campaign.frequency}</Typography>
                          </Grid>
                          <Grid item xs={12} md={3}>
                            <Typography variant="caption" color="text.secondary">
                              Follow-up
                            </Typography>
                            <Typography variant="body2">{campaign.followUpStrategy}</Typography>
                          </Grid>
                          <Grid item xs={12} md={3}>
                            <Typography variant="caption" color="text.secondary">
                              Created
                            </Typography>
                            <Typography variant="body2">
                              {campaign.createdAt
                                ? new Date(campaign.createdAt).toLocaleDateString()
                                : 'N/A'}
                            </Typography>
                          </Grid>
                        </Grid>

                        {campaign.analytics && (
                          <>
                            <Divider sx={{ my: 2 }} />
                            <Grid container spacing={2}>
                              <Grid item xs={12} md={3}>
                                <Typography variant="caption" color="text.secondary">
                                  Recipients
                                </Typography>
                                <Typography variant="h6">{campaign.analytics.totalRecipients}</Typography>
                              </Grid>
                              <Grid item xs={12} md={3}>
                                <Typography variant="caption" color="text.secondary">
                                  Responses
                                </Typography>
                                <Typography variant="h6">{campaign.analytics.responsesReceived}</Typography>
                              </Grid>
                              <Grid item xs={12} md={3}>
                                <Typography variant="caption" color="text.secondary">
                                  Engagement
                                </Typography>
                                <Typography variant="h6">
                                  {(campaign.analytics.avgEngagementScore * 100).toFixed(1)}%
                                </Typography>
                              </Grid>
                              <Grid item xs={12} md={3}>
                                <Typography variant="caption" color="text.secondary">
                                  Response Rate
                                </Typography>
                                <Typography variant="h6">
                                  {campaign.analytics.totalRecipients > 0
                                    ? ((campaign.analytics.responsesReceived /
                                        campaign.analytics.totalRecipients) *
                                        100).toFixed(1)
                                    : 0}%
                                </Typography>
                              </Grid>
                            </Grid>
                          </>
                        )}
                      </Box>
                    )}
                  </Paper>
                </Grid>
              ))}
            </Grid>
          )}

          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Active Campaigns
              </Typography>
              <Typography color="text.secondary">
                Campaigns currently running and engaging with workers.
              </Typography>
            </Box>
          )}

          {activeTab === 2 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Draft Campaigns
              </Typography>
              <Typography color="text.secondary">
                Campaigns in development that haven't been launched yet.
              </Typography>
            </Box>
          )}

          {activeTab === 3 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Completed Campaigns
              </Typography>
              <Typography color="text.secondary">
                Campaigns that have finished their lifecycle.
              </Typography>
            </Box>
          )}

          {activeTab === 4 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Campaign Analytics
              </Typography>
              <Typography color="text.secondary">
                Comprehensive analytics and insights across all campaigns.
              </Typography>
            </Box>
          )}

          {activeTab === 5 && (
            <Grid container spacing={3}>
              {campaigns.filter(c => c.template).map((campaign) => (
                <Grid item xs={12} key={campaign.id || campaign.title}>
                  <Paper sx={{ p: 3 }}>
                    <Box display="flex" alignItems="center" gap={2} mb={1}>
                      <Typography variant="h6" fontWeight={600}>{campaign.title}</Typography>
                      <Chip label={campaign.category} color={getCategoryColor(campaign.category) as any} size="small" />
                      <Chip label="HRX Default" color="primary" size="small" />
                      <Chip label="Template" color="secondary" size="small" />
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>{campaign.objective}</Typography>
                    <Box display="flex" gap={1} flexWrap="wrap">{campaign.tags.map((tag, index) => (<Chip key={index} label={tag} size="small" variant="outlined" />))}</Box>
                    <Divider sx={{ my: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Tone</Typography><Typography variant="body2">{campaign.tone}</Typography></Grid>
                      <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Frequency</Typography><Typography variant="body2">{campaign.frequency}</Typography></Grid>
                      <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Follow-up</Typography><Typography variant="body2">{campaign.followUpStrategy}</Typography></Grid>
                    </Grid>
                    {/* Activate/Clone button for non-HRX users */}
                    <Box mt={2}>
                      <Button variant="contained" color="primary" onClick={() => handleActivateTemplate(campaign)}>
                        Activate This Template
                      </Button>
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewDialog} onClose={() => setPreviewDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Campaign Preview</DialogTitle>
        <DialogContent>
          {previewCampaign && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {previewCampaign.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                {previewCampaign.objective}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>
                    Campaign Details
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary="Category"
                        secondary={previewCampaign.category}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="Tone" secondary={previewCampaign.tone} />
                    </ListItem>
                    <ListItem>
                      <ListItemText primary="Frequency" secondary={previewCampaign.frequency} />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary="Follow-up Strategy"
                        secondary={previewCampaign.followUpStrategy}
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>
                    AI Behavior
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary="Response Pattern"
                        secondary={previewCampaign.aiBehavior.responsePattern}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary="Escalation Threshold"
                        secondary={`${(previewCampaign.aiBehavior.escalationThreshold * 100).toFixed(0)}%`}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary="Traits Tracked"
                        secondary={previewCampaign.aiBehavior.traitTracking.join(', ')}
                      />
                    </ListItem>
                  </List>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Analytics Dialog */}
      <Dialog open={analyticsDialogOpen} onClose={handleCloseAnalytics} maxWidth="md" fullWidth>
        <DialogTitle>Campaign Analytics</DialogTitle>
        <DialogContent>
          {analyticsCampaign ? (
            <Box>
              <Typography variant="h6" gutterBottom>{analyticsCampaign.title}</Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>{analyticsCampaign.objective}</Typography>
              {analyticsCampaign.tenantId && (
                <Typography variant="caption" color="text.secondary">Tenant: {analyticsCampaign.tenantId}</Typography>
              )}
              {/* HRX Tenant Drilldown */}
              {orgType === 'HRX' && tenantList.length > 0 && (
                <Box mb={2} mt={2}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Tenant Drilldown</InputLabel>
                    <Select value={analyticsTenant} label="Tenant Drilldown" onChange={e => setAnalyticsTenant(e.target.value)}>
                      <MenuItem value="">(This Campaign Only)</MenuItem>
                      {tenantList.map(tenant => (
                        <MenuItem key={tenant.id} value={tenant.id}>
                          {tenant.type}: {tenant.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              )}
              {/* Show aggregate analytics if tenant selected, else show campaign analytics */}
              {orgType === 'HRX' && analyticsTenant ? (
                (() => {
                  const agg = getTenantAggregateAnalytics(analyticsTenant);
                  if (!agg) return <Typography color="text.secondary">No analytics for this tenant.</Typography>;
                  return (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Aggregate Analytics for Tenant: {analyticsTenant}</Typography>
                      <Divider sx={{ my: 2 }} />
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Recipients</Typography><Typography variant="h6">{agg.totalRecipients}</Typography></Grid>
                        <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Responses</Typography><Typography variant="h6">{agg.responsesReceived}</Typography></Grid>
                        <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Engagement</Typography><Typography variant="h6">{agg.avgEngagementScore ? (agg.avgEngagementScore * 100).toFixed(1) : '0.0'}%</Typography></Grid>
                        <Grid item xs={12} md={3}><Typography variant="caption" color="text.secondary">Response Rate</Typography><Typography variant="h6">{agg.totalRecipients ? ((agg.responsesReceived / agg.totalRecipients) * 100).toFixed(1) : '0.0'}%</Typography></Grid>
                      </Grid>
                      <Divider sx={{ my: 2 }} />
                      <Typography variant="subtitle2" gutterBottom>Trait Changes</Typography>
                      <Box>
                        {Object.keys(agg.traitChanges).length > 0 ? (
                          Object.entries(agg.traitChanges).map(([trait, delta]) => (
                            <Typography key={trait}>{trait}: {delta > 0 ? '+' : ''}{delta}</Typography>
                          ))
                        ) : (
                          <Typography color="text.secondary">No trait data available.</Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })()
              ) : (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={3}>
                      <Typography variant="caption" color="text.secondary">Recipients</Typography>
                      <Typography variant="h6">{analyticsCampaign.analytics?.totalRecipients ?? 0}</Typography>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="caption" color="text.secondary">Responses</Typography>
                      <Typography variant="h6">{analyticsCampaign.analytics?.responsesReceived ?? 0}</Typography>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="caption" color="text.secondary">Engagement</Typography>
                      <Typography variant="h6">{analyticsCampaign.analytics?.avgEngagementScore ? (analyticsCampaign.analytics.avgEngagementScore * 100).toFixed(1) : '0.0'}%</Typography>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="caption" color="text.secondary">Response Rate</Typography>
                      <Typography variant="h6">{analyticsCampaign.analytics?.totalRecipients && analyticsCampaign.analytics?.responsesReceived ? ((analyticsCampaign.analytics.responsesReceived / analyticsCampaign.analytics.totalRecipients) * 100).toFixed(1) : '0.0'}%</Typography>
                    </Grid>
                  </Grid>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Trait Changes</Typography>
                  <Box>
                    {analyticsCampaign.analytics?.traitChanges ? (
                      Object.entries(analyticsCampaign.analytics.traitChanges).map(([trait, delta]) => (
                        <Typography key={trait}>{trait}: {delta > 0 ? '+' : ''}{delta}</Typography>
                      ))
                    ) : (
                      <Typography color="text.secondary">No trait data available.</Typography>
                    )}
                  </Box>
                </>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAnalytics}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Automation Dialog */}
      <Dialog open={automationDialog} onClose={handleCloseAutomation} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <AutomationIcon color="primary" />
            <Typography variant="h6">Campaign Automation Setup</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {automationCampaign && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {automationCampaign.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                {automationCampaign.objective}
              </Typography>

              <Stepper activeStep={automationStep} orientation="vertical">
                <Step>
                  <StepLabel>
                    <Box display="flex" alignItems="center" gap={1}>
                      <SmartToyIcon />
                      <Typography variant="subtitle1">AI Automation Features</Typography>
                    </Box>
                  </StepLabel>
                  <StepContent>
                    <Box sx={{ mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={automationConfig.autoOptimize}
                            onChange={(e) => handleAutomationConfigChange('autoOptimize', e.target.checked)}
                          />
                        }
                        label="Auto-Optimize Campaign Performance"
                      />
                      <FormHelperText>
                        AI will automatically adjust campaign parameters based on performance metrics
                      </FormHelperText>
                    </Box>
                    <Box sx={{ mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={automationConfig.smartScheduling}
                            onChange={(e) => handleAutomationConfigChange('smartScheduling', e.target.checked)}
                          />
                        }
                        label="Smart Scheduling"
                      />
                      <FormHelperText>
                        AI will optimize send times based on worker engagement patterns
                      </FormHelperText>
                    </Box>
                    <Box sx={{ mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={automationConfig.adaptiveTargeting}
                            onChange={(e) => handleAutomationConfigChange('adaptiveTargeting', e.target.checked)}
                          />
                        }
                        label="Adaptive Targeting"
                      />
                      <FormHelperText>
                        AI will refine audience targeting based on response patterns
                      </FormHelperText>
                    </Box>
                    <Button
                      variant="contained"
                      onClick={() => setAutomationStep(1)}
                      sx={{ mt: 1 }}
                    >
                      Continue
                    </Button>
                  </StepContent>
                </Step>

                <Step>
                  <StepLabel>
                    <Box display="flex" alignItems="center" gap={1}>
                      <TrendingUpIcon />
                      <Typography variant="subtitle1">Performance Thresholds</Typography>
                    </Box>
                  </StepLabel>
                  <StepContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={4}>
                        <Typography variant="subtitle2" gutterBottom>
                          Engagement Rate Threshold
                        </Typography>
                        <Slider
                          value={automationConfig.performanceThresholds.engagementRate}
                          onChange={(_, value) => handleAutomationConfigNestedChange('performanceThresholds', 'engagementRate', value)}
                          min={0}
                          max={1}
                          step={0.1}
                          marks
                          valueLabelDisplay="auto"
                          valueLabelFormat={(value) => `${(value * 100).toFixed(0)}%`}
                        />
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <Typography variant="subtitle2" gutterBottom>
                          Response Rate Threshold
                        </Typography>
                        <Slider
                          value={automationConfig.performanceThresholds.responseRate}
                          onChange={(_, value) => handleAutomationConfigNestedChange('performanceThresholds', 'responseRate', value)}
                          min={0}
                          max={1}
                          step={0.1}
                          marks
                          valueLabelDisplay="auto"
                          valueLabelFormat={(value) => `${(value * 100).toFixed(0)}%`}
                        />
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <Typography variant="subtitle2" gutterBottom>
                          Satisfaction Score Threshold
                        </Typography>
                        <Slider
                          value={automationConfig.performanceThresholds.satisfactionScore}
                          onChange={(_, value) => handleAutomationConfigNestedChange('performanceThresholds', 'satisfactionScore', value)}
                          min={0}
                          max={1}
                          step={0.1}
                          marks
                          valueLabelDisplay="auto"
                          valueLabelFormat={(value) => `${(value * 100).toFixed(0)}%`}
                        />
                      </Grid>
                    </Grid>
                    <Box sx={{ mt: 2 }}>
                      <Button
                        variant="outlined"
                        onClick={() => setAutomationStep(0)}
                        sx={{ mr: 1 }}
                      >
                        Back
                      </Button>
                      <Button
                        variant="contained"
                        onClick={() => setAutomationStep(2)}
                      >
                        Continue
                      </Button>
                    </Box>
                  </StepContent>
                </Step>

                <Step>
                  <StepLabel>
                    <Box display="flex" alignItems="center" gap={1}>
                      <TimelineIcon />
                      <Typography variant="subtitle1">Optimization Rules</Typography>
                    </Box>
                  </StepLabel>
                  <StepContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={automationConfig.optimizationRules.frequencyAdjustment}
                              onChange={(e) => handleAutomationConfigNestedChange('optimizationRules', 'frequencyAdjustment', e.target.checked)}
                            />
                          }
                          label="Frequency Adjustment"
                        />
                        <FormHelperText>
                          Automatically adjust campaign frequency based on engagement
                        </FormHelperText>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={automationConfig.optimizationRules.toneAdjustment}
                              onChange={(e) => handleAutomationConfigNestedChange('optimizationRules', 'toneAdjustment', e.target.checked)}
                            />
                          }
                          label="Tone Adjustment"
                        />
                        <FormHelperText>
                          Optimize message tone based on response sentiment
                        </FormHelperText>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={automationConfig.optimizationRules.targetingAdjustment}
                              onChange={(e) => handleAutomationConfigNestedChange('optimizationRules', 'targetingAdjustment', e.target.checked)}
                            />
                          }
                          label="Targeting Adjustment"
                        />
                        <FormHelperText>
                          Refine audience targeting based on response patterns
                        </FormHelperText>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={automationConfig.optimizationRules.timingAdjustment}
                              onChange={(e) => handleAutomationConfigNestedChange('optimizationRules', 'timingAdjustment', e.target.checked)}
                            />
                          }
                          label="Timing Adjustment"
                        />
                        <FormHelperText>
                          Optimize send timing based on worker activity patterns
                        </FormHelperText>
                      </Grid>
                    </Grid>
                    <Box sx={{ mt: 2 }}>
                      <Button
                        variant="outlined"
                        onClick={() => setAutomationStep(1)}
                        sx={{ mr: 1 }}
                      >
                        Back
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        onClick={handleEnableAutomation}
                        startIcon={<AutomationIcon />}
                      >
                        Enable Automation
                      </Button>
                    </Box>
                  </StepContent>
                </Step>
              </Stepper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAutomation}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Alerts */}
      <Snackbar open={success} autoHideDuration={6000} onClose={() => setSuccess(false)}>
        <Alert onClose={() => setSuccess(false)} severity="success">
          {successMessage || 'Campaign saved successfully!'}
        </Alert>
      </Snackbar>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AICampaigns; 