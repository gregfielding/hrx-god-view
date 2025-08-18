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
  IconButton,
  Collapse,
  Skeleton,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  Chip,
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
  Edit as EditIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  AttachMoney as AttachMoneyIcon,
  Event as EventIcon,
  Business as BusinessIcon,
  Add as AddIcon,
  Close as CloseIcon,
  SmartToy as AIIcon,
  Person as PersonIcon,
  Check as CheckIcon,
  CheckCircle as CheckCircleIcon,
  Hub as HubIcon,
  RocketLaunch as RocketLaunchIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';


import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { createUnifiedAssociationService } from '../../utils/unifiedAssociationService';
import StageChip from '../../components/StageChip';
import CRMNotesTab from '../../components/CRMNotesTab';
import FastAssociationsCard from '../../components/FastAssociationsCard';
import DealStageForms from '../../components/DealStageForms';
import { getDealCompanyIds, getDealPrimaryCompanyId } from '../../utils/associationsAdapter';
import ActivityLogTab from '../../components/ActivityLogTab';
import DealStageAISuggestions from '../../components/DealStageAISuggestions';
import SalesCoach from '../../components/SalesCoach';
import TasksDashboard from '../../components/TasksDashboard';
import AppointmentsDashboard from '../../components/AppointmentsDashboard';
import DealAISummary from '../../components/DealAISummary';
import EmailTab from '../../components/EmailTab';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import LogActivityDialog from '../../components/LogActivityDialog';

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
  associations?: {
    companies?: string[];
    locations?: string[];
    contacts?: string[];
    salespeople?: string[];
    deals?: string[];
    tasks?: string[];
  };
}

interface StageState {
  current: string;
  entered_at: Date;
  completed_at?: Date;
  checklist_status: {
    [itemId: string]: {
      completed: boolean;
      completed_by?: string;
      completed_at?: Date;
    }
  };
  ai_insights?: AIInsight[];
}

interface AIInsight {
  id: string;
  type: 'suggestion' | 'warning' | 'opportunity';
  message: string;
  priority: 'low' | 'medium' | 'high';
  created_at: Date;
  action_required?: boolean;
}

interface PinnedContent {
  notes: string[];
  widgets: {
    type: 'critical_notes' | 'email_summary' | 'ai_insights';
    config: any;
  }[];
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
  
  // FOUNDATIONAL DATA - Load first, before anything else
  const [deal, setDeal] = useState<DealData | null>(null);
  const [associationsLoading, setAssociationsLoading] = useState(true);
  const [associationsLoaded, setAssociationsLoaded] = useState(false);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  
  // SECONDARY DATA - Load after associations are ready
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [company, setCompany] = useState<any>(null);
  const [stageData, setStageData] = useState<any>({});
  const [dealContextOpen, setDealContextOpen] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [pinnedContent, setPinnedContent] = useState<PinnedContent>({ notes: [], widgets: [] });
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [patternAlerts, setPatternAlerts] = useState<Array<{id: string; type: 'warning' | 'info' | 'success'; message: string; action?: string}>>([]);
  const [taskFilter, setTaskFilter] = useState<'all' | 'ai-suggested' | 'stage-specific'>('all');
  const [roadblocks, setRoadblocks] = useState<Array<{id: string; type: string; severity: 'low' | 'medium' | 'high'; message: string; action?: string}>>([]);
  const [activityCount, setActivityCount] = useState(0);
  const [dealCoachActions, setDealCoachActions] = useState<Array<{action: string; label: string; priority: 'low' | 'medium' | 'high'; description?: string}>>([]);
  const [isEditingDealName, setIsEditingDealName] = useState(false);
  const [editingDealName, setEditingDealName] = useState('');
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [prefilledTaskData, setPrefilledTaskData] = useState<any>(null);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [dealCoachKey, setDealCoachKey] = useState<string>(`${dealId}-${Date.now()}`);
  
  // Feature Flags
  const featureFlags = {
    newDashboard: localStorage.getItem('feature.newDashboard') !== 'false',
    dealCoach: localStorage.getItem('feature.dealCoach') !== 'false',
    keyboardShortcuts: localStorage.getItem('feature.keyboardShortcuts') !== 'false',
    patternAlerts: localStorage.getItem('feature.patternAlerts') !== 'false',
    pinnedWidgets: localStorage.getItem('feature.pinnedWidgets') !== 'false'
  };

  // FOUNDATIONAL: Load deal and associations first - everything else waits for this
  useEffect(() => {
    if (!dealId || !tenantId) return;

    const loadFoundationalData = async () => {
      try {
        console.log('🚀 FOUNDATIONAL: Starting to load deal and associations...');
        setError('');
        
        // Step 1: Load deal data
        console.log('📋 Step 1: Loading deal data...');
        const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId));
        
        if (!dealDoc.exists()) {
          setError('Deal not found');
          setAssociationsLoading(false);
          return;
        }

        const dealData = { id: dealDoc.id, ...dealDoc.data() } as DealData;
        
        // Ensure the deal has a valid stage, default to 'discovery' if not set
        if (!dealData.stage) {
          dealData.stage = 'discovery';
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId), {
            stage: 'discovery',
            updatedAt: new Date()
          });
        }
        
        setDeal(dealData);
        console.log('✅ Step 1: Deal data loaded:', dealData.name);
        
        // Step 2: Load associations from denormalized data (instant)
        console.log('🔗 Step 2: Loading associations from denormalized data...');
        
        // Use associations directly from the deal document
        const associations = dealData.associations || {};
        
        // Load contacts from denormalized data
        if (associations.contacts && Array.isArray(associations.contacts)) {
          const contacts = associations.contacts.map((contact: any) => ({
            id: typeof contact === 'string' ? contact : contact.id,
            fullName: typeof contact === 'string' ? 'Unknown Contact' : (contact.snapshot?.fullName || contact.snapshot?.name || 'Unknown Contact'),
            email: typeof contact === 'string' ? '' : (contact.snapshot?.email || ''),
            phone: typeof contact === 'string' ? '' : (contact.snapshot?.phone || ''),
            title: typeof contact === 'string' ? '' : (contact.snapshot?.title || '')
          }));
          setAssociatedContacts(contacts);
          console.log('✅ Contacts loaded from denormalized data:', contacts.length);
        } else {
          setAssociatedContacts([]);
          console.log('✅ No contacts in denormalized data');
        }
        
        // Load salespeople from denormalized data
        if (associations.salespeople && Array.isArray(associations.salespeople)) {
          const salespeople = associations.salespeople.map((salesperson: any) => ({
            id: typeof salesperson === 'string' ? salesperson : salesperson.id,
            fullName: typeof salesperson === 'string' ? 'Unknown Salesperson' : (salesperson.snapshot?.fullName || salesperson.snapshot?.name || 'Unknown Salesperson'),
            email: typeof salesperson === 'string' ? '' : (salesperson.snapshot?.email || ''),
            title: typeof salesperson === 'string' ? '' : (salesperson.snapshot?.title || '')
          }));
          setAssociatedSalespeople(salespeople);
          console.log('✅ Salespeople loaded from denormalized data:', salespeople.length);
        } else {
          setAssociatedSalespeople([]);
          console.log('✅ No salespeople in denormalized data');
        }
        
        console.log('✅ Associations loaded instantly from denormalized data');
        setAssociationsLoaded(true);
        setAssociationsLoading(false);
        
      } catch (err: any) {
        console.error('❌ Error loading foundational data:', err);
        setError(err.message || 'Failed to load foundational data');
        setAssociationsLoading(false);
      }
    };

    loadFoundationalData();
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

  const loadAssociatedContacts = async (dealData?: DealData) => {
    const targetDeal = dealData || deal;
    if (!targetDeal || !tenantId || !user?.uid) return;
    
    try {
      console.log('Loading associated contacts for deal:', targetDeal.id);
      
      // Use the unified association service
      const associationService = createUnifiedAssociationService(tenantId, user.uid);
      const result = await associationService.getEntityAssociations('deal', targetDeal.id);
      
      console.log('Association service result:', result);
      console.log('Found contacts:', result.entities?.contacts);
      
      // Map the contacts to the expected format (defensive against undefined)
      const contacts = (result?.entities?.contacts || []).map((contact: any) => ({
        id: contact.id,
        fullName: contact.fullName || contact.name || 'Unknown Contact',
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

  const loadAssociatedSalespeople = async (dealData?: DealData) => {
    const targetDeal = dealData || deal;
    if (!targetDeal || !tenantId || !user?.uid) return;
    
    try {
      console.log('🔵 MASTER ASSOCIATIONS - Loading salespeople for deal:', targetDeal.id);
      
      // Use the PREFERRED method: users collection with crm_sales: true
      console.log('🔵 Loading salespeople from users collection (crm_sales: true)');
      
      // Query users collection for salespeople in this tenant
      const usersRef = collection(db, 'users');
      
      // First, let's see what users exist and their structure
      console.log('🔵 Debugging: Checking all users first...');
      const allUsersSnapshot = await getDocs(usersRef);
      console.log('🔵 Total users in collection:', allUsersSnapshot.size);
      
      // Log a few users to see their structure
      allUsersSnapshot.docs.slice(0, 3).forEach((doc, index) => {
        const userData = doc.data();
        console.log(`🔵 User ${index + 1}:`, {
          id: doc.id,
          email: userData.email,
          crm_sales: userData.crm_sales,
          tenantIds: userData.tenantIds,
          firstName: userData.firstName,
          lastName: userData.lastName
        });
      });
      
      // Now try the specific query - tenantIds is a nested map structure
      const usersQuery = query(
        usersRef,
        where('crm_sales', '==', true),
        where(`tenantIds.${tenantId}.status`, '==', 'active')
      );
      
      const usersSnapshot = await getDocs(usersQuery);
      console.log('🔵 Found salespeople users:', usersSnapshot.size);
      
      // If no results, try just crm_sales: true to see if any users have that field
      if (usersSnapshot.empty) {
        console.log('🔵 No results with tenant filter, trying just crm_sales: true...');
        const simpleQuery = query(usersRef, where('crm_sales', '==', true));
        const simpleSnapshot = await getDocs(simpleQuery);
        console.log('🔵 Users with crm_sales: true:', simpleSnapshot.size);
        
        if (!simpleSnapshot.empty) {
          simpleSnapshot.docs.slice(0, 3).forEach((doc, index) => {
            const userData = doc.data();
            console.log(`🔵 CRM Sales User ${index + 1}:`, {
              id: doc.id,
              email: userData.email,
              crm_sales: userData.crm_sales,
              tenantIds: userData.tenantIds,
              firstName: userData.firstName,
              lastName: userData.lastName
            });
          });
        }
      }
      
      if (!usersSnapshot.empty) {
        const salespeopleUsers = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        console.log('🔵 Raw salespeople from users collection:', salespeopleUsers);
        
        // Map to the expected dialog structure
        const mappedSalespeople = salespeopleUsers.map((user: any) => {
          console.log('🔵 Mapping salesperson user:', user);
          
          // Use firstName + lastName, fallback to displayName, then email
          const displayName = user.firstName && user.lastName ? 
                             `${user.firstName} ${user.lastName}` :
                             user.displayName || 
                             user.email?.split('@')[0] || 
                             'Unknown Salesperson';
          
          return {
            id: user.uid || user.id,
            displayName: displayName,
            email: user.email || '',
            phone: user.phone || '',
            tenantId: tenantId
          };
        });
        
        console.log('🔵 Mapped salespeople for dialogs:', mappedSalespeople);
        console.log('🔵 Setting associatedSalespeople state:', mappedSalespeople);
        console.log('🔵 Final salespeople structure:', mappedSalespeople.map(sp => ({
          id: sp.id,
          displayName: sp.displayName,
          email: sp.email,
          phone: sp.phone
        })));
        setAssociatedSalespeople(mappedSalespeople);
      } else {
        console.log('🔵 No salespeople found in users collection');
        setAssociatedSalespeople([]);
      }
      
    } catch (err) {
      console.error('Error loading associated salespeople:', err);
      setAssociatedSalespeople([]);
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

  // Deal Coach Action Handlers
  const handleDealCoachAction = async (action: string) => {
    setAiLoading(true);
    try {
      console.log('Deal Coach action:', action);
      // TODO: Implement AI-powered task creation
      // This would call the AI service to create a task based on the action
      setTimeout(() => {
        console.log('Task created from Deal Coach action:', action);
        setAiLoading(false);
        
        // Track success metric
        trackSuccessMetric('deal_coach_action_completed', {
          dealId: deal.id,
          stage: deal.stage,
          action,
          userId: user?.uid
        });
      }, 1000);
    } catch (error) {
      console.error('Error creating task from Deal Coach:', error);
      setAiLoading(false);
    }
  };

  // Log Activity Handler
  const handleLogActivity = async (taskData: any) => {
    setLogActivityLoading(true);
    try {
      // Import TaskService dynamically to avoid circular dependencies
      const { TaskService } = await import('../../utils/taskService');
      const taskService = TaskService.getInstance();
      
      // Create the task as completed
      await taskService.createTask({
        ...taskData,
        tenantId,
        status: 'completed',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      setShowLogActivityDialog(false);
      // Optionally refresh any task-related data
      console.log('Activity logged successfully:', taskData);
    } catch (error) {
      console.error('Error logging activity:', error);
    } finally {
      setLogActivityLoading(false);
    }
  };

  // Inline Deal Name Editing
  const handleStartEditDealName = () => {
    setIsEditingDealName(true);
    setEditingDealName(deal.name);
  };

  const handleSaveDealName = async () => {
    if (editingDealName.trim() && editingDealName !== deal.name) {
      try {
        await handleDealUpdate('name', editingDealName.trim());
        setIsEditingDealName(false);
      } catch (error) {
        console.error('Error updating deal name:', error);
      }
    } else {
      setIsEditingDealName(false);
    }
  };

  const handleCancelEditDealName = () => {
    setIsEditingDealName(false);
    setEditingDealName('');
  };

  const handleDealNameKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSaveDealName();
    } else if (event.key === 'Escape') {
      handleCancelEditDealName();
    }
  };

  // Canonical Stage State Management
  const initializeStageState = (currentStage: string): StageState => {
    return {
      current: currentStage,
      entered_at: new Date(),
      checklist_status: {},
      ai_insights: []
    };
  };

  const updateStageState = async (updates: Partial<StageState>) => {
    if (!stageState) return;
    
    const updatedState = { ...stageState, ...updates };
    setStageState(updatedState);
    
    // TODO: Save to Firestore
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'deals', deal.id), {
        stageState: updatedState,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating stage state:', error);
    }
  };

  const completeChecklistItem = async (itemId: string) => {
    if (!stageState || !user) return;
    
    const updatedChecklist = {
      ...stageState.checklist_status,
      [itemId]: {
        completed: true,
        completed_by: user.uid,
        completed_at: new Date()
      }
    };
    
    await updateStageState({
      checklist_status: updatedChecklist
    });

    // Track success metric
    trackSuccessMetric('checklist_item_completed', {
      dealId: deal.id,
      stage: deal.stage,
      itemId,
      userId: user.uid
    });
  };

  // Success Metrics Tracking
  const trackSuccessMetric = (metric: string, data: any) => {
    console.log('Success Metric:', metric, data);
    // TODO: Send to analytics service
    // Example: analytics.track(metric, { ...data, timestamp: new Date() });
  };

  // Pinned Content Management
  const pinNote = (noteId: string) => {
    setPinnedContent(prev => ({
      ...prev,
      notes: [...prev.notes, noteId]
    }));
  };

  const unpinNote = (noteId: string) => {
    setPinnedContent(prev => ({
      ...prev,
      notes: prev.notes.filter(id => id !== noteId)
    }));
  };

  const pinWidget = (type: 'critical_notes' | 'email_summary' | 'ai_insights', config: any) => {
    setPinnedContent(prev => ({
      ...prev,
      widgets: [...prev.widgets, { type, config }]
    }));
  };

  const unpinWidget = (type: string) => {
    setPinnedContent(prev => ({
      ...prev,
      widgets: prev.widgets.filter(w => w.type !== type)
    }));
  };

  // Stage Checklist Items
  const getStageChecklistItems = (stage: string) => {
    const checklistItems: { id: string; title: string; required: boolean }[] = [];
    
    switch (stage) {
      case 'discovery':
        checklistItems.push(
          { id: 'company_research', title: 'Research company background and needs', required: true },
          { id: 'initial_contact', title: 'Make initial contact with decision maker', required: true },
          { id: 'pain_points', title: 'Identify key pain points and challenges', required: false },
          { id: 'budget_scope', title: 'Understand budget and scope requirements', required: false }
        );
        break;
      case 'qualification':
        checklistItems.push(
          { id: 'decision_maker_meeting', title: 'Schedule meeting with decision maker', required: true },
          { id: 'budget_confirmation', title: 'Confirm budget and timeline', required: true },
          { id: 'technical_requirements', title: 'Gather technical requirements', required: false },
          { id: 'stakeholder_mapping', title: 'Map key stakeholders and influencers', required: false }
        );
        break;
      case 'proposal':
        checklistItems.push(
          { id: 'proposal_draft', title: 'Draft comprehensive proposal', required: true },
          { id: 'pricing_structure', title: 'Define pricing structure and terms', required: true },
          { id: 'timeline_detailed', title: 'Create detailed implementation timeline', required: false },
          { id: 'risk_assessment', title: 'Conduct risk assessment and mitigation', required: false }
        );
        break;
      case 'negotiation':
        checklistItems.push(
          { id: 'proposal_presentation', title: 'Present proposal to stakeholders', required: true },
          { id: 'negotiation_meetings', title: 'Conduct negotiation meetings', required: true },
          { id: 'contract_review', title: 'Review and finalize contract terms', required: false },
          { id: 'legal_approval', title: 'Obtain legal approval if required', required: false }
        );
        break;
      case 'closed_won':
        checklistItems.push(
          { id: 'contract_signed', title: 'Contract signed and executed', required: true },
          { id: 'project_kickoff', title: 'Schedule project kickoff meeting', required: true },
          { id: 'team_assignment', title: 'Assign project team members', required: false },
          { id: 'success_metrics', title: 'Define success metrics and KPIs', required: false }
        );
        break;
      default:
        checklistItems.push(
          { id: 'stage_requirements', title: 'Complete stage-specific requirements', required: true }
        );
    }
    
    return checklistItems;
  };

  // Global Keyboard Shortcuts
  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    // Only handle shortcuts when not typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'n':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          console.log('Create new note');
          // TODO: Open note creation dialog
        }
        break;
      case 't':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          console.log('Create new task');
          // TODO: Open task creation dialog
        }
        break;
      case 'e':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          console.log('Compose email');
          // TODO: Open email compose dialog
        }
        break;
      case '/':
        event.preventDefault();
        console.log('Search within deal');
        // TODO: Focus search input
        break;
      case '?':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setShowKeyboardShortcuts(true);
        }
        break;
    }
  };

  // Add keyboard event listeners
  useEffect(() => {
    if (featureFlags.keyboardShortcuts) {
      document.addEventListener('keydown', handleKeyboardShortcut);
      return () => {
        document.removeEventListener('keydown', handleKeyboardShortcut);
      };
    }
  }, [featureFlags.keyboardShortcuts]);

  // Enhanced Roadblock Detection
  const detectRoadblocks = () => {
    const roadblocks: Array<{id: string; type: string; severity: 'low' | 'medium' | 'high'; message: string; action?: string}> = [];
    
    if (deal) {
      // Check for communication gaps
      if (!deal.notes || deal.notes.length < 50) {
        roadblocks.push({
          id: 'no_recent_communication',
          type: 'communication',
          severity: 'high',
          message: 'No recent email communication with customer',
          action: 'Send Email'
        });
      }

      // Check for missing timeline information
      if (!deal.closeDate) {
        roadblocks.push({
          id: 'missing_timeline',
          type: 'timeline',
          severity: 'medium',
          message: 'Missing timeline information',
          action: 'Set Close Date'
        });
      }

      // Check for missing budget information
      if (!deal.estimatedRevenue || deal.estimatedRevenue === 0) {
        roadblocks.push({
          id: 'missing_budget',
          type: 'budget',
          severity: 'medium',
          message: 'Missing budget information',
          action: 'Set Budget'
        });
      }

      // Check for stalled deals
      if (stageState) {
        const daysInStage = Math.floor((new Date().getTime() - new Date(stageState.entered_at).getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysInStage > 14) {
          roadblocks.push({
            id: 'stalled_deal',
            type: 'velocity',
            severity: 'high',
            message: `Deal stalled in ${deal.stage} stage for ${daysInStage} days`,
            action: 'Advance Stage'
          });
        }
      }

      // Check for missing decision makers
      if (associatedContacts.length === 0) {
        roadblocks.push({
          id: 'no_decision_makers',
          type: 'contacts',
          severity: 'high',
          message: 'No decision makers identified',
          action: 'Add Contacts'
        });
      }
    }

    setRoadblocks(roadblocks);
  };

  // Enhanced Deal Coach Actions
  const generateDealCoachActions = () => {
    const actions: Array<{action: string; label: string; priority: 'low' | 'medium' | 'high'; description?: string}> = [];
    
    if (deal) {
      // Stage-specific actions
      switch (deal.stage) {
        case 'discovery':
          actions.push(
            { action: 'assess', label: 'Assess', priority: 'high', description: 'Evaluate deal potential' },
            { action: 'schedule_discovery', label: 'Schedule Discovery Call', priority: 'high', description: 'Initial qualification' },
            { action: 'research_company', label: 'Research Company', priority: 'medium', description: 'Background analysis' }
          );
          break;
        case 'qualification':
          actions.push(
            { action: 'schedule_qualification', label: 'Schedule Qualification Call', priority: 'high', description: 'Deep dive meeting' },
            { action: 'budget_discussion', label: 'Budget Discussion', priority: 'high', description: 'Financial alignment' },
            { action: 'stakeholder_mapping', label: 'Map Stakeholders', priority: 'medium', description: 'Decision maker identification' }
          );
          break;
        case 'proposal':
          actions.push(
            { action: 'draft_proposal', label: 'Draft Proposal', priority: 'high', description: 'Create comprehensive proposal' },
            { action: 'pricing_structure', label: 'Define Pricing', priority: 'high', description: 'Finalize pricing strategy' },
            { action: 'timeline_planning', label: 'Timeline Planning', priority: 'medium', description: 'Implementation timeline' }
          );
          break;
        case 'negotiation':
          actions.push(
            { action: 'present_proposal', label: 'Present Proposal', priority: 'high', description: 'Stakeholder presentation' },
            { action: 'negotiate_terms', label: 'Negotiate Terms', priority: 'high', description: 'Contract discussions' },
            { action: 'legal_review', label: 'Legal Review', priority: 'medium', description: 'Contract finalization' }
          );
          break;
        default:
          actions.push(
            { action: 'advance_stage', label: 'Advance Stage', priority: 'medium', description: 'Move to next stage' },
            { action: 'review_progress', label: 'Review Progress', priority: 'low', description: 'Current status assessment' }
          );
      }
    }

    setDealCoachActions(actions);
  };

  // Activity Intelligence
  const calculateActivityCount = () => {
    // TODO: Implement real activity counting from Firestore
    // For now, simulate based on deal data
    let count = 0;
    if (deal) {
      if (deal.notes) count += 1;
      if (deal.estimatedRevenue) count += 1;
      if (deal.closeDate) count += 1;
      if (associatedContacts.length > 0) count += associatedContacts.length;
      if (stageState) count += Object.keys(stageState.checklist_status).length;
    }
    setActivityCount(count);
  };

  // Pattern Detection and Alerts
  const detectPatterns = () => {
    const alerts: Array<{id: string; type: 'warning' | 'info' | 'success'; message: string; action?: string}> = [];
    
    if (deal && stageState) {
      // Check for stalled deals
      const daysInStage = Math.floor((new Date().getTime() - new Date(stageState.entered_at).getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysInStage > 14) {
        alerts.push({
          id: 'stalled_deal',
          type: 'warning',
          message: `This deal has been in ${deal.stage} stage for ${daysInStage} days. Consider advancing or revisiting the strategy.`,
          action: 'Advance Stage'
        });
      }

      // Check for incomplete required items
      const checklistItems = getStageChecklistItems(deal.stage);
      const requiredItems = checklistItems.filter(item => item.required);
      const completedRequiredItems = requiredItems.filter(item => 
        stageState.checklist_status[item.id]?.completed
      );

      if (completedRequiredItems.length < requiredItems.length) {
        alerts.push({
          id: 'incomplete_requirements',
          type: 'warning',
          message: `${requiredItems.length - completedRequiredItems.length} required items still need to be completed.`,
          action: 'View Checklist'
        });
      }

      // Check for no recent activity
      // TODO: Implement activity tracking
    }

    setPatternAlerts(alerts);
  };

  useEffect(() => {
    if (deal && stageState) {
      detectPatterns();
      detectRoadblocks();
      generateDealCoachActions();
      calculateActivityCount();
    }
  }, [deal, stageState, associatedContacts]);

  // SECONDARY: Load everything else after associations are ready
  useEffect(() => {
    if (!associationsLoaded || !deal || !tenantId) return;
    
    console.log('🔄 SECONDARY: Loading secondary data after associations are ready...');
    setLoading(true);
    
    const loadSecondaryData = async () => {
      try {
        // Load stage data if it exists
        if (deal.stageData) {
          setStageData(deal.stageData);
          console.log('✅ Stage data loaded from Firestore:', deal.stageData);
        } else {
          setStageData({});
          console.log('✅ No stage data found, initializing empty state');
        }

        // Load associated company using primary company id from associations
        const primaryCompanyId = getDealPrimaryCompanyId(deal as any);
        if (primaryCompanyId) {
          const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', primaryCompanyId));
          if (companyDoc.exists()) {
            const companyData = { id: companyDoc.id, ...companyDoc.data() } as any;
            setCompany(companyData);
            console.log('✅ Company data loaded:', companyData);
          }
        }
        
        console.log('✅ Secondary data loading complete');
        
      } catch (err: any) {
        console.error('❌ Error loading secondary data:', err);
        setError(err.message || 'Failed to load secondary data');
      } finally {
        setLoading(false);
      }
    };
    
    loadSecondaryData();
  }, [associationsLoaded, deal, tenantId]);

  // Separate useEffect for stage state management
  useEffect(() => {
    if (deal && tenantId) {
      // Initialize stage state if not exists
      if (!stageState && deal.stage) {
        const initialState = initializeStageState(deal.stage);
        setStageState(initialState);
      }
      
      // Update Deal Coach key to persist across tabs but reset for different deals
      setDealCoachKey(`${deal.id}-${Date.now()}`);
    }
  }, [deal, tenantId, stageState]);

  // Debug logging
  // REMOVED: Excessive logging causing re-renders

  // Ensure stage synchronization between overview and DealStageForms
  useEffect(() => {
    if (deal && (!deal.stage || deal.stage === '')) {
      // If deal has no stage, set it to discovery
      handleDealUpdate('stage', 'discovery');
    }
  }, [deal]);

  // Lazy load AI components for performance
  useEffect(() => {
    if (deal && !aiComponentsLoaded) {
      const timer = setTimeout(() => {
        setAiComponentsLoaded(true);
      }, 1000); // Load AI components after 1 second
      
      return () => clearTimeout(timer);
    }
  }, [deal, aiComponentsLoaded]);



  if (associationsLoading) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2, color: 'text.secondary' }}>
          Loading deal and associations...
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          This may take a few seconds
        </Typography>
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

  // Show secondary loading state if associations are loaded but secondary data is still loading
  if (associationsLoaded && loading) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress size={40} />
        <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>
          Loading additional data...
        </Typography>
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

  // Debug: Log when associations are ready and what data is available
  if (associationsLoaded && !loading) {
    console.log('🎯 ASSOCIATIONS READY - Data available for all components:');
    console.log('  - Deal:', deal?.name);
    console.log('  - Contacts:', associatedContacts.length, 'items');
    console.log('  - Salespeople:', associatedSalespeople.length, 'items');
    console.log('  - Salespeople data:', associatedSalespeople);
  }

  return (
    <Box sx={{ p: 0 }}>
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>
      {/* Enhanced Header - Persistent Deal Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Deal Avatar - Use company avatar if available, otherwise deal icon */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: company?.logo ? 'transparent' : 'primary.main',
                  fontSize: '2.5rem',
                  fontWeight: 'bold'
                }}
                src={company?.logo}
                alt={company?.companyName || company?.name || 'Deal'}
              >
                {!company?.logo && <DealIcon />}
              </Avatar>
              
              {/* Avatar Upload/Delete Buttons */}
              <Box sx={{ 
                position: 'absolute', 
                bottom: -8, 
                right: -8,
                display: 'flex',
                gap: 0.5
              }}>
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="deal-avatar-upload"
                  type="file"
                  onChange={(e) => {
                    // TODO: Implement logo upload for deals
                    console.log('Logo upload for deals not yet implemented');
                  }}
                />
                <label htmlFor="deal-avatar-upload">
                  <IconButton
                    component="span"
                    size="small"
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': {
                        bgcolor: 'grey.400'
                      },
                      width: 28,
                      height: 28
                    }}
                  >
                    <UploadIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </label>
                
                {company?.logo && (
                  <IconButton
                    size="small"
                    onClick={() => {
                      // TODO: Implement logo delete for deals
                      console.log('Logo delete for deals not yet implemented');
                    }}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': {
                        bgcolor: 'grey.400'
                      },
                      width: 28,
                      height: 28
                    }}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
            </Box>

            {/* Enhanced Deal Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
              {/* Deal Name - Editable Inline */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isEditingDealName ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                      value={editingDealName}
                      onChange={(e) => setEditingDealName(e.target.value)}
                      onKeyDown={handleDealNameKeyPress}
                      onBlur={handleSaveDealName}
                      variant="standard"
                      sx={{
                        '& .MuiInputBase-input': {
                          fontSize: '2rem',
                          fontWeight: 'bold',
                          color: 'text.primary',
                          padding: 0
                        },
                        '& .MuiInput-underline:before': { borderBottom: 'none' },
                        '& .MuiInput-underline:after': { borderBottom: '2px solid', borderColor: 'primary.main' }
                      }}
                      autoFocus
                    />
                    <IconButton size="small" onClick={handleSaveDealName} sx={{ color: 'success.main' }}>
                      <InfoIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={handleCancelEditDealName} sx={{ color: 'error.main' }}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ) : (
                  <>
                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                      {deal.name}
                    </Typography>
                    <IconButton 
                      size="small" 
                      sx={{ color: 'text.secondary' }}
                      onClick={handleStartEditDealName}
                      title="Edit deal name"
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Box>
              
              {/* Stage Badge */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <StageChip stage={deal.stage} size="medium" useCustomColors={true} />
              </Box>

              {/* Key Deal Metrics */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                {/* Revenue Range */}
                {(() => {
                  const revenueRange = calculateExpectedRevenueRange();
                  return revenueRange.hasData ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <AttachMoneyIcon fontSize="small" color="success" />
                      <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'bold' }}>
                        ${revenueRange.min.toLocaleString()} - ${revenueRange.max.toLocaleString()}
                      </Typography>
                    </Box>
                  ) : null;
                })()}

                {/* Close Date */}
                {(() => {
                  const qualData = stageData?.qualification;
                  const expectedCloseDate = qualData?.expectedCloseDate;
                  return expectedCloseDate ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <EventIcon fontSize="small" color="primary" />
                      <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'bold' }}>
                        Close: {new Date(expectedCloseDate + 'T00:00:00').toLocaleDateString()}
                      </Typography>
                    </Box>
                  ) : null;
                })()}

                {/* Company and Location */}
                {company && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <BusinessIcon fontSize="small" color="primary" />
                    <Typography 
                      variant="body2" 
                      color="primary"
                      sx={{ 
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        '&:hover': { color: 'primary.dark' }
                      }}
                      onClick={() => navigate(`/crm/companies/${company.id}`)}
                    >
                      {company.companyName || company.name}
                    </Typography>
                    {Array.isArray((deal as any)?.associations?.locations) && (deal as any).associations.locations.length > 0 && (() => {
                      const locEntry: any = (deal as any).associations.locations.find((l: any) => typeof l === 'object') || (deal as any).associations.locations[0];
                      const locationId = typeof locEntry === 'string' ? locEntry : locEntry.id;
                      const locationName = typeof locEntry === 'string' ? '' : (locEntry.snapshot?.name || locEntry.name || '');
                      if (!locationId || !locationName) return null;
                      return (
                      <>
                        <Typography variant="body2" color="text.secondary">/</Typography>
                        <Typography 
                          variant="body2" 
                          color="primary"
                          sx={{ 
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            '&:hover': { color: 'primary.dark' }
                          }}
                          onClick={() => navigate(`/crm/companies/${company.id}/locations/${locationId}`)}
                        >
                          {locationName}
                        </Typography>
                      </>
                      );
                    })()}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>

          {/* Quick Actions */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button 
                variant="outlined" 
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate('/crm?tab=opportunities')}
                size="small"
              >
                Back
              </Button>
              <Button 
                variant="outlined" 
                startIcon={<HubIcon />}
                onClick={() => setDealContextOpen(!dealContextOpen)}
                size="small"
                color={dealContextOpen ? 'primary' : 'inherit'}
              >
                Deal Connections
              </Button>
              <Button 
                variant="outlined" 
                startIcon={<RocketLaunchIcon />}
                onClick={() => setAiSummaryOpen(!aiSummaryOpen)}
                size="small"
                color={aiSummaryOpen ? 'primary' : 'inherit'}
              >
                AI Summary
              </Button>
            </Box>
            
            {/* Quick Action Buttons - Context-aware based on deal stage */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button 
                variant="contained" 
                startIcon={<CheckCircleIcon />}
                size="small"
                onClick={() => setShowLogActivityDialog(true)}
                sx={{ 
                  minWidth: 'auto', 
                  px: 2,
                  bgcolor: deal.stage === 'discovery' ? 'info.main' : 
                          deal.stage === 'qualification' ? 'warning.main' : 
                          deal.stage === 'proposal' ? 'primary.main' : 
                          deal.stage === 'negotiation' ? 'secondary.main' : 'success.main'
                }}
              >
                Log Activity
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Pattern Alerts */}
      {featureFlags.patternAlerts && patternAlerts.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {patternAlerts.map((alert) => (
            <Alert 
              key={alert.id}
              severity={alert.type}
              sx={{ mb: 1 }}
              action={
                alert.action && (
                  <Button 
                    color="inherit" 
                    size="small"
                    onClick={() => {
                      if (alert.action === 'Advance Stage') {
                        // TODO: Open stage advancement dialog
                        console.log('Advance stage clicked');
                      } else if (alert.action === 'View Checklist') {
                        setTabValue(2); // Switch to Stages tab
                      }
                    }}
                  >
                    {alert.action}
                  </Button>
                )
              }
            >
              {alert.message}
            </Alert>
          ))}
        </Box>
      )}

      {/* Collapsible Deal Context Drawer */}
      <Collapse in={dealContextOpen} timeout="auto" unmountOnExit>
        <Card sx={{ mb: 3, border: '1px solid', borderColor: 'primary.main' }}>
          <CardHeader 
            title="Deal Context" 
            action={
              <IconButton onClick={() => setDealContextOpen(false)}>
                <CloseIcon />
              </IconButton>
            }
            sx={{ p: 2, pb: 1 }}
            titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
          />
          <CardContent sx={{ p: 2, pt: 0 }}>
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
                deals: false,
                tasks: false
              }}
            />
          </CardContent>
        </Card>
      </Collapse>

      {/* Collapsible AI Summary Drawer */}
      <Collapse in={aiSummaryOpen} timeout="auto" unmountOnExit>
        <Card sx={{ mb: 3, border: '1px solid', borderColor: 'primary.main' }}>
          <CardHeader 
            title="AI Summary" 
            action={
              <IconButton onClick={() => setAiSummaryOpen(false)}>
                <CloseIcon />
              </IconButton>
            }
            sx={{ p: 2, pb: 1 }}
            titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
          />
          <CardContent sx={{ p: 2, pt: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Stage & Timeline */}
              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Stage & Timeline
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <StageChip stage={deal.stage} size="small" useCustomColors={true} />
                  <Typography variant="caption" color="text.secondary">
                    Day 3 in stage
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Deal is progressing well through the {deal.stage} stage. Current momentum suggests positive trajectory.
                </Typography>
              </Box>

              {/* Top Roadblocks */}
              {roadblocks.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                    Top Roadblocks
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {roadblocks.map((roadblock) => (
                      <Box 
                        key={roadblock.id}
                        sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: roadblock.severity === 'high' ? 'error.50' : 
                                  roadblock.severity === 'medium' ? 'warning.50' : 'info.50'
                        }}
                      >
                        <Box 
                          sx={{ 
                            width: 6, 
                            height: 6, 
                            borderRadius: '50%',
                            bgcolor: roadblock.severity === 'high' ? 'error.main' : 
                                    roadblock.severity === 'medium' ? 'warning.main' : 'info.main'
                          }} 
                        />
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                          {roadblock.message}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Deal Health */}
              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Deal Health
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Chip 
                    label="Likelihood: 75%" 
                    size="small" 
                    color="success"
                    variant="outlined"
                  />
                  <Chip 
                    label="Responsive" 
                    size="small" 
                    color="info"
                    variant="outlined"
                  />
                  <Chip 
                    label="On Track" 
                    size="small" 
                    color="primary"
                    variant="outlined"
                  />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Deal shows strong health indicators with high likelihood of success. Customer engagement is positive.
                </Typography>
              </Box>

              {/* AI Insight */}
              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  AI Insight
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Deal progressing well. Consider scheduling follow-up meeting to discuss proposal details. 
                  The customer has shown consistent engagement and the timeline aligns with typical sales cycles.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <strong>Recommendations:</strong>
                </Typography>
                <Box component="ul" sx={{ pl: 2, mt: 1 }}>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Schedule a follow-up meeting within the next 3-5 days
                  </Typography>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Prepare detailed proposal based on qualification data
                  </Typography>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Engage with key stakeholders identified in discovery
                  </Typography>
                </Box>
              </Box>

              {/* Deal Coach Actions */}
              {dealCoachActions.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                    Recommended Actions
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {dealCoachActions.slice(0, 3).map((action) => (
                      <Box 
                        key={action.action}
                        sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: 'background.paper',
                          border: '1px solid',
                          borderColor: 'divider'
                        }}
                      >
                        <Box 
                          sx={{ 
                            width: 6, 
                            height: 6, 
                            borderRadius: '50%',
                            bgcolor: action.priority === 'high' ? 'error.main' : 
                                    action.priority === 'medium' ? 'warning.main' : 'info.main'
                          }} 
                        />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {action.label}
                        </Typography>
                        {action.description && (
                          <Typography variant="caption" color="text.secondary">
                            {action.description}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Pattern Analysis */}
              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Pattern Analysis
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Based on historical data and current engagement patterns:
                </Typography>
                <Box component="ul" sx={{ pl: 2 }}>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Similar deals in this stage typically close within 30-45 days
                  </Typography>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Customer response time is above average (within 24 hours)
                  </Typography>
                  <Typography component="li" variant="body2" color="text.secondary">
                    Deal size aligns with typical successful conversions
                  </Typography>
                </Box>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Collapse>

      {/* Main Content Area */}
      <Box sx={{ display: 'flex', gap: 3 }}>
        {/* Main Content Area */}
        <Box sx={{ width: '100%' }}>
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
                    Dashboard
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
            </Tabs>
          </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {/* Dashboard - New Balanced Layout */}
        <Grid container spacing={3}>
          {/* Left Column (35%): Action Focused - To-Dos Only */}
          <Grid item xs={12} md={4}>
            <Card sx={{ minHeight: 600 }}>
          <CardHeader 
                title="To-Dos" 
                subheader="Priority tasks for this deal"
                action={
                  <IconButton 
                    size="small" 
                    title="Add new task"
                    onClick={() => {
                      const primaryCompanyId = getDealPrimaryCompanyId(deal);
                      setPrefilledTaskData({
                        associations: {
                          deals: [deal.id],
                          companies: primaryCompanyId ? [primaryCompanyId] : [],
                          contacts: [],
                          salespeople: []
                        }
                      });
                      setShowCreateTaskDialog(true);
                    }}
                  >
                    <AddIcon />
                  </IconButton>
                }
                sx={{ p: 0, mb: 2 }} 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
              />
              <CardContent sx={{ p: 0 }}>
                <TasksDashboard
                  entityId={deal.id}
                  entityType="deal"
                  tenantId={tenantId}
                  entity={deal}
                  preloadedContacts={associatedContacts}
                  preloadedSalespeople={associatedSalespeople}
                  preloadedCompany={company}
                />
              </CardContent>
            </Card>
          </Grid>



          {/* Center Column (40%): Appointments Widget */}
          <Grid item xs={12} md={5}>
            <Card sx={{ minHeight: 600 }}>
              <CardHeader 
                title="Appointments" 
                subheader="Upcoming meetings & calls"
                action={
                  <IconButton 
                    size="small" 
                    title="Schedule meeting"
                    onClick={() => {
                      const primaryCompanyIdAppt = getDealPrimaryCompanyId(deal);
                      setPrefilledTaskData({
                        classification: 'appointment',
                        type: 'scheduled_meeting_virtual',
                        title: 'New Meeting',
                        associations: {
                          deals: [deal.id],
                          companies: primaryCompanyIdAppt ? [primaryCompanyIdAppt] : [],
                          contacts: [],
                          salespeople: []
                        }
                      });
                      setShowCreateTaskDialog(true);
                    }}
                  >
                    <AddIcon />
                  </IconButton>
                }
                sx={{ p: 0, mb: 2 }} 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
              />
              <CardContent sx={{ p: 0 }}>
                <AppointmentsDashboard
                  entityId={deal.id}
                  entityType="deal"
                  tenantId={tenantId}
                  entity={deal}
                  preloadedContacts={associatedContacts}
                  preloadedSalespeople={associatedSalespeople}
                  preloadedCompany={company}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* Right Column (25%): Deal Coach Widget */}
          <Grid item xs={12} md={3}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardHeader 
                title="Deal Coach" 
                action={
                  <IconButton 
                    size="small" 
                    title="Start new conversation"
                    onClick={() => {
                      // This will be handled by the DealCoachPanel
                      // We'll pass a prop to trigger the new conversation
                      setDealCoachKey(`${deal.id}-${Date.now()}`);
                    }}
                  >
                    <AddIcon />
                  </IconButton>
                }
                sx={{ p: 0, mb: 2 }}
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ p: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                
                {/* Deal Coach Panel - Persistent across tabs */}
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  {(() => {
                    let enable = true;
                    try { enable = localStorage.getItem('feature.dealCoach') !== 'false'; } catch {}
                    return enable ? (
                      <SalesCoach 
                        key={dealCoachKey}
                        entityType="deal"
                        entityId={deal.id}
                        entityName={deal.name}
                        tenantId={tenantId}
                        dealStage={deal.stage}
                        associations={deal.associations}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, px: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          AI Stage Suggestions
                        </Typography>
                        <DealStageAISuggestions
                          dealId={deal.id}
                          tenantId={tenantId}
                          currentStage={deal.stage}
                          onTaskCreated={(taskId) => { console.log('Task created from side panel:', taskId); }}
                        />
                      </Box>
                    );
                  })()}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <DealStageForms
          dealId={deal.id}
          tenantId={tenantId}
          currentStage={deal.stage}
          stageData={stageData || {}}
          onStageDataChange={handleStageDataChange}
          onStageAdvance={handleStageAdvance}
          associatedContacts={associatedContacts}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <CRMNotesTab
          entityId={deal.id}
          entityType="deal"
          entityName={deal.name || 'Deal'}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <ActivityLogTab
          entityId={deal.id}
          entityType="deal"
          entityName={deal.name || 'Deal'}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <EmailTab
          dealId={deal.id}
          tenantId={tenantId}
          contacts={associatedContacts}
          companies={company ? [company] : []}
          currentUser={user}
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
      </Box>

      {/* Delete Deal Button - Bottom of page */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        mt: 9, // 72px spacing from content above
        pb: 3 
      }}>
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

      {/* Keyboard Shortcuts Dialog */}
      <Dialog 
        open={showKeyboardShortcuts} 
        onClose={() => setShowKeyboardShortcuts(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6">Keyboard Shortcuts</Typography>
            <Chip label="Deal View" size="small" color="primary" />
          </Box>
        </DialogTitle>
        <DialogContent>
          <List>
            <ListItem>
              <ListItemText 
                primary="Create Note"
                secondary="Quickly add a note to this deal"
              />
              <Chip label="Ctrl/Cmd + N" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText 
                primary="Create Task"
                secondary="Add a new task to this deal"
              />
              <Chip label="Ctrl/Cmd + T" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText 
                primary="Compose Email"
                secondary="Start composing an email"
              />
              <Chip label="Ctrl/Cmd + E" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText 
                primary="Search Deal"
                secondary="Search within this deal"
              />
              <Chip label="/" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText 
                primary="Show Shortcuts"
                secondary="Display this help dialog"
              />
              <Chip label="Ctrl/Cmd + ?" size="small" variant="outlined" />
            </ListItem>
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowKeyboardShortcuts(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>



      {/* Create Task Dialog */}
      {showCreateTaskDialog && (
        <>
          <CreateTaskDialog
            open={showCreateTaskDialog}
            onClose={() => {
              setShowCreateTaskDialog(false);
              setPrefilledTaskData(null); // Clear prefilled data when closing
            }}
            onSubmit={async (taskData) => {
              // Handle task creation
              console.log('Task created:', taskData);
              setShowCreateTaskDialog(false);
              setPrefilledTaskData(null); // Clear prefilled data after submission
            }}
            prefilledData={prefilledTaskData}
            salespeople={associatedSalespeople}
            contacts={associatedContacts}
            currentUserId={user?.uid || ''}
          />
          {console.log('🎯 CreateTaskDialog props:', { 
            salespeople: associatedSalespeople, 
            contacts: associatedContacts, 
            currentUserId: user?.uid 
          })}
        </>
      )}

      {/* Log Activity Dialog */}
      <>
        <LogActivityDialog
          open={showLogActivityDialog}
          onClose={() => setShowLogActivityDialog(false)}
          onSubmit={handleLogActivity}
          loading={logActivityLoading}
          salespeople={associatedSalespeople}
          contacts={associatedContacts}
          currentUserId={user?.uid || ''}
          tenantId={tenantId}
          dealId={deal?.id}
          dealName={deal?.name}
        />
        {console.log('🎯 LogActivityDialog props:', { 
          salespeople: associatedSalespeople, 
          contacts: associatedContacts, 
          currentUserId: user?.uid 
        })}
      </>
    </Box>
  );
};

export default DealDetails; 