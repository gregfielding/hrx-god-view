import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
  Breadcrumbs,
  Link as MUILink,
} from '@mui/material';

import {
  AttachMoney as DealIcon,
  Info as InfoIcon,
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  List as ListIcon,
  Task as TaskIcon,
  Delete as DeleteIcon,

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
  CloudUpload as UploadIcon,
  Dashboard as DashboardIcon,
  Stairs as StairsIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';


import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { createUnifiedAssociationService } from '../../utils/unifiedAssociationService';
import StageChip from '../../components/StageChip';
import CRMNotesTab from '../../components/CRMNotesTab';
import DealStageForms from '../../components/DealStageForms';
import { getDealCompanyIds, getDealPrimaryCompanyId } from '../../utils/associationsAdapter';
import DealActivityTab from '../../components/DealActivityTab';
import DealStageAISuggestions from '../../components/DealStageAISuggestions';
import SalesCoach from '../../components/SalesCoach';
import TasksDashboard from '../../components/TasksDashboard';
import AppointmentsDashboard from '../../components/AppointmentsDashboard';
import DealAISummary from '../../components/DealAISummary';

import CreateTaskDialog from '../../components/CreateTaskDialog';
import LogActivityDialog from '../../components/LogActivityDialog';
import AddNoteDialog from '../../components/AddNoteDialog';
import ManageSalespeopleDialog from '../../components/ManageSalespeopleDialog';
import ManageContactsDialog from '../../components/ManageContactsDialog';
import ManageLocationDialog from '../../components/ManageLocationDialog';
import NextStepsWidget from '../../components/NextStepsWidget';

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
    contacts?: Array<string | {
      id: string;
      snapshot: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        title?: string;
      };
    }>;
    salespeople?: Array<string | {
      id: string;
      snapshot: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        displayName?: string;
        email?: string;
        phone?: string;
        title?: string;
      };
    }>;
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
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showManageSalespeopleDialog, setShowManageSalespeopleDialog] = useState(false);
  const [showManageContactsDialog, setShowManageContactsDialog] = useState(false);
  const [showManageLocationDialog, setShowManageLocationDialog] = useState(false);
  const [dealCoachKey, setDealCoachKey] = useState<string>(`${dealId}-${Date.now()}`);
  const [tasksDashboardKey, setTasksDashboardKey] = useState<string>(`${dealId}-${Date.now()}`);
  const [loadingSalespeople, setLoadingSalespeople] = useState(false);
  const [locationData, setLocationData] = useState<any>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const foundationalDataLoadedRef = useRef(false);
  const secondaryDataLoadedRef = useRef<string | null>(null);
  
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
    if (!dealId || !tenantId || foundationalDataLoadedRef.current) return;
    
    foundationalDataLoadedRef.current = true;

    const loadFoundationalData = async () => {
      try {
        setError('');
        
        // Step 1: Load deal data
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
        
        // Step 2: Load associations from denormalized data (instant)
        
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
        } else {
          setAssociatedContacts([]);
        }
        
        // Load salespeople from denormalized data with better name resolution
        if (associations.salespeople && Array.isArray(associations.salespeople)) {
          const salespeople = associations.salespeople.map((salesperson: any) => {
            const salespersonData = typeof salesperson === 'string' ? { id: salesperson } : salesperson;
            const snapshot = salespersonData.snapshot || {};
            
            // Better name resolution: try multiple name fields
            const fullName = snapshot.fullName || 
                           snapshot.name || 
                           (snapshot.firstName && snapshot.lastName ? `${snapshot.firstName} ${snapshot.lastName}`.trim() : '') ||
                           snapshot.displayName ||
                           snapshot.email?.split('@')[0] ||
                           'Unknown Salesperson';
            
            return {
              id: salespersonData.id,
              fullName: fullName,
              firstName: snapshot.firstName || '',
              lastName: snapshot.lastName || '',
              displayName: snapshot.displayName || fullName,
              email: snapshot.email || '',
              phone: snapshot.phone || '',
              title: snapshot.title || ''
            };
          });
          setAssociatedSalespeople(salespeople);
        } else {
          setAssociatedSalespeople([]);
        }
        
        setAssociationsLoaded(true);
        setAssociationsLoading(false);
        
        // If salespeople don't have proper names, try to load them from users collection
        if (associations.salespeople && Array.isArray(associations.salespeople)) {
          const salespeopleFromAssociations = associations.salespeople.map((salesperson: any) => {
            const salespersonData = typeof salesperson === 'string' ? { id: salesperson } : salesperson;
            const snapshot = salespersonData.snapshot || {};
            const fullName = snapshot.fullName || 
                           snapshot.name || 
                           (snapshot.firstName && snapshot.lastName ? `${snapshot.firstName} ${snapshot.lastName}`.trim() : '') ||
                           snapshot.displayName ||
                           snapshot.email?.split('@')[0] ||
                           'Unknown Salesperson';
            return { fullName };
          });
          
          const hasUnknownSalespeople = salespeopleFromAssociations.some(sp => sp.fullName === 'Unknown Salesperson');
          if (hasUnknownSalespeople) {
            setLoadingSalespeople(true);
            // Load salespeople from users collection as a fallback
            loadAssociatedSalespeople(dealData).finally(() => {
              setLoadingSalespeople(false);
            });
          }
        }
        
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

  const handleDealUpdate = useCallback(async (field: string, value: any) => {
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
  }, [deal?.id, tenantId]);

  const handleStageDataChange = useCallback(async (newStageData: any) => {
    setStageData(newStageData);
    
    // Save stage data to Firestore
    if (deal && tenantId) {
      try {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
          stageData: newStageData,
          updatedAt: new Date()
        });
      } catch (error) {
        console.error('❌ Error saving stage data:', error);
      }
    }
  }, [deal?.id, tenantId]);

  const handleStageAdvance = useCallback(async (newStage: string) => {
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
  }, [deal?.id, tenantId]);

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
      // Use the unified association service
      const associationService = createUnifiedAssociationService(tenantId, user.uid);
      const result = await associationService.getEntityAssociations('deal', targetDeal.id);
      
      // Map the contacts to the expected format (defensive against undefined)
      const contacts = (result?.entities?.contacts || []).map((contact: any) => ({
        id: contact.id,
        fullName: contact.fullName || contact.name || 'Unknown Contact',
        email: contact.email || '',
        phone: contact.phone || '',
        title: '' // Title not available in denormalized format
      }));
      
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
      // Query users collection for salespeople in this tenant
      const usersRef = collection(db, 'users');
      
      // Now try the specific query - tenantIds is a nested map structure
      const usersQuery = query(
        usersRef,
        where('crm_sales', '==', true),
        where(`tenantIds.${tenantId}.status`, '==', 'active')
      );
      
      const usersSnapshot = await getDocs(usersQuery);
      
      // If no results, try just crm_sales: true to see if any users have that field
      if (usersSnapshot.empty) {
        const simpleQuery = query(usersRef, where('crm_sales', '==', true));
        const simpleSnapshot = await getDocs(simpleQuery);
      }
      
      if (!usersSnapshot.empty) {
        const salespeopleUsers = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Map to the expected dialog structure
        const mappedSalespeople = salespeopleUsers.map((user: any) => {
          
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
        

        
        // Merge with existing salespeople data, preferring the new data with better names
        setAssociatedSalespeople(prevSalespeople => {
          const existingIds = new Set(prevSalespeople.map(sp => sp.id));
          const newSalespeople = mappedSalespeople.filter(sp => !existingIds.has(sp.id));
          
          // Update existing salespeople with better name data if available
          const updatedExisting = prevSalespeople.map(existing => {
            const betterData = mappedSalespeople.find(newSp => newSp.id === existing.id);
            if (betterData && existing.fullName === 'Unknown Salesperson') {
              return {
                ...existing,
                fullName: betterData.displayName,
                displayName: betterData.displayName,
                email: betterData.email || existing.email,
                phone: betterData.phone || existing.phone
              };
            }
            return existing;
          });
          
          return [...updatedExisting, ...newSalespeople];
        });
      } else {
        setAssociatedSalespeople([]);
      }
      
    } catch (err) {
      console.error('Error loading associated salespeople:', err);
      setAssociatedSalespeople([]);
    }
  };

  // Load location data from database when not available in associations
  const loadLocationData = async (locationId: string, companyId: string) => {
    if (!locationId || !companyId || !tenantId) return;
    
    try {
      setLoadingLocation(true);
      console.log(`🔍 Loading location data for ID: ${locationId} in company: ${companyId}`);
      
      // Try to load location from company subcollection
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
      const locationDoc = await getDoc(locationRef);
      
      if (locationDoc.exists()) {
        const locationData = { id: locationDoc.id, ...locationDoc.data() };
        console.log('✅ Location data loaded:', locationData);
        setLocationData(locationData);
      } else {
        console.log('❌ Location not found in company subcollection');
        setLocationData(null);
      }
    } catch (error) {
      console.error('❌ Error loading location data:', error);
      setLocationData(null);
    } finally {
      setLoadingLocation(false);
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

  const handleSalespeopleChange = async (updatedSalespeople: any[]) => {
    if (!deal || !tenantId) return;
    
    try {
      // Update the local state immediately for responsive UI
      setAssociatedSalespeople(updatedSalespeople);
      
      // Prepare the associations update
      const currentAssociations = deal.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        salespeople: updatedSalespeople.map(sp => ({
          id: sp.id,
          snapshot: {
            fullName: sp.fullName,
            firstName: sp.firstName,
            lastName: sp.lastName,
            displayName: sp.displayName,
            email: sp.email,
            phone: sp.phone,
            title: sp.title
          }
        }))
      };
      
      // Update the deal document with new associations
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        associations: updatedAssociations,
        updatedAt: new Date()
      });
      
      // Update local deal state
      setDeal(prev => prev ? { ...prev, associations: updatedAssociations } : null);
      
      console.log('Salespeople updated successfully');
    } catch (error) {
      console.error('Error updating salespeople:', error);
      // Revert local state if update fails
      setAssociatedSalespeople(deal?.associations?.salespeople || []);
    }
  };

  const handleContactsChange = async (updatedContacts: any[]) => {
    if (!deal || !tenantId) return;
    
    try {
      // Update the local state immediately for responsive UI
      setAssociatedContacts(updatedContacts);
      
      // Prepare the associations update
      const currentAssociations = deal.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        contacts: updatedContacts.map(contact => ({
          id: contact.id,
          snapshot: {
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            title: contact.title
          }
        }))
      };
      
      // Update the deal document with new associations
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        associations: updatedAssociations,
        updatedAt: new Date()
      });
      
      // Update local deal state
      setDeal(prev => prev ? { ...prev, associations: updatedAssociations } : null);
      
      console.log('Contacts updated successfully');
    } catch (error) {
      console.error('Error updating contacts:', error);
      // Revert local state if update fails
      setAssociatedContacts(deal?.associations?.contacts || []);
    }
  };

  const handleLocationChange = async (locationId: string | null) => {
    if (!deal || !tenantId) return;
    
    try {
      // Prepare the associations update
      const currentAssociations = deal.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        locations: locationId ? [locationId] : []
      };
      
      // Update the deal document with new associations
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        associations: updatedAssociations,
        updatedAt: new Date()
      });
      
      // Update local deal state
      setDeal(prev => prev ? { ...prev, associations: updatedAssociations } : null);
      
      console.log('Location updated successfully');
    } catch (error) {
      console.error('Error updating location:', error);
    }
  };

  const handleSkipQuestion = async (stage: string, field: string) => {
    if (!deal || !tenantId) return;
    
    try {
      // Mark the question as skipped by setting it to a special value
      const currentStageData = stageData[stage] || {};
      const updatedStageData = {
        ...currentStageData,
        [field]: '__SKIPPED__'
      };
      
      // Update the stage data
      const newStageData = {
        ...stageData,
        [stage]: updatedStageData
      };
      
      setStageData(newStageData);
      
      // Save to Firestore
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', deal.id), {
        stageData: newStageData,
        updatedAt: new Date()
      });
      
      console.log(`Question ${field} in ${stage} stage marked as skipped`);
    } catch (error) {
      console.error('Error skipping question:', error);
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
  const detectRoadblocks = useCallback(() => {
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
  }, [deal?.id, deal?.stage, deal?.notes, deal?.closeDate, deal?.estimatedRevenue, stageState?.entered_at, associatedContacts.length]);

  // Enhanced Deal Coach Actions
  const generateDealCoachActions = useCallback(() => {
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
  }, [deal?.stage]);

  // Activity Intelligence
  const calculateActivityCount = useCallback(() => {
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
  }, [deal?.notes, deal?.estimatedRevenue, deal?.closeDate, associatedContacts.length, stageState?.checklist_status]);

  // Pattern Detection and Alerts
  const detectPatterns = useCallback(() => {
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
  }, [deal?.stage, stageState?.entered_at, stageState?.checklist_status]);

  useEffect(() => {
    if (deal && stageState) {
      detectPatterns();
      detectRoadblocks();
      generateDealCoachActions();
      calculateActivityCount();
    }
  }, [deal?.id, stageState?.current, associatedContacts.length]); // Only depend on specific values that should trigger recalculation

  // SECONDARY: Load everything else after associations are ready
  useEffect(() => {
    if (!associationsLoaded || !deal || !tenantId) return;
    
    // Prevent multiple runs for the same deal
    const dealKey = `${deal.id}-${tenantId}`;
    if (secondaryDataLoadedRef.current === dealKey) return;
    
    secondaryDataLoadedRef.current = dealKey;
    setLoading(true);
    
    const loadSecondaryData = async () => {
      try {
        // Load stage data if it exists
        if (deal.stageData) {
          setStageData(deal.stageData);
        } else {
          setStageData({});
        }

        // Load associated company using primary company id from associations
        const primaryCompanyId = getDealPrimaryCompanyId(deal as any);
        if (primaryCompanyId) {
          const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', primaryCompanyId));
          if (companyDoc.exists()) {
            const companyData = { id: companyDoc.id, ...companyDoc.data() } as any;
            setCompany(companyData);
          }
        }
        

        
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
  }, [deal?.id, tenantId]); // Only depend on deal.id and tenantId, not the entire deal object

  // Debug logging
  // REMOVED: Excessive logging causing re-renders

  // Ensure stage synchronization between overview and DealStageForms
  useEffect(() => {
    if (deal && (!deal.stage || deal.stage === '')) {
      // If deal has no stage, set it to discovery
      handleDealUpdate('stage', 'discovery');
    }
  }, [deal?.stage, handleDealUpdate]);

  // Lazy load AI components for performance
  useEffect(() => {
    if (deal && !aiComponentsLoaded) {
      const timer = setTimeout(() => {
        setAiComponentsLoaded(true);
      }, 1000); // Load AI components after 1 second
      
      return () => clearTimeout(timer);
    }
  }, [deal, aiComponentsLoaded]);

  // Load location data when needed
  useEffect(() => {
    if (!deal || !company || locationData || loadingLocation) return;
    
    const locations = (deal as any)?.associations?.locations || [];
    if (locations.length === 0) return;
    
    const locationEntry = locations[0];
    const locationId = typeof locationEntry === 'string' ? locationEntry : locationEntry.id;
    const locationName = typeof locationEntry === 'string' ? 'Unknown Location' : (locationEntry.snapshot?.name || locationEntry.name || 'Unknown Location');
    const locationNickname = typeof locationEntry === 'string' ? '' : (locationEntry.snapshot?.nickname || locationEntry.nickname || '');
    const locationAddress = typeof locationEntry === 'string' ? '' : (locationEntry.snapshot?.address || locationEntry.address || '');
    
    // Only load if we have incomplete location data
    if ((!locationNickname || !locationAddress || locationName === 'Unknown Location') && locationId) {
      console.log('🔍 Loading location data from database via useEffect...');
      loadLocationData(locationId, company.id);
    }
  }, [deal?.associations?.locations, company?.id, locationData, loadingLocation]);



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



  return (
    <Box sx={{ p: 0 }}>
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
          
          .css-1xte5ga-MuiCardContent-root:last-child {
            padding-bottom: 16px;
          }
        `}
      </style>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <MUILink underline="hover" color="inherit" href="/crm" onClick={(e) => { e.preventDefault(); navigate('/crm'); }}>
            CRM
          </MUILink>
          <MUILink underline="hover" color="inherit" href="/opportunities" onClick={(e) => { e.preventDefault(); navigate('/crm?tab=opportunities'); }}>
            Opportunities
          </MUILink>
          <Typography color="text.primary">{deal?.name || 'Deal'}</Typography>
        </Breadcrumbs>
      </Box>

      {/* Enhanced Header - Persistent Deal Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Deal Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company?.logo}
                alt={company?.companyName || company?.name || 'Deal'}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(company?.companyName || company?.name || 'D').charAt(0).toUpperCase()}
              </Avatar>
            </Box>

            {/* Deal Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {deal.name}
                </Typography>
              </Box>
              
              {/* Deal Value Range */}
              {(() => {
                const revenueRange = calculateExpectedRevenueRange();
                return revenueRange.hasData ? (
                  <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DealIcon sx={{ fontSize: 18, color: 'success.main' }} />
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      ${revenueRange.min.toLocaleString()} – ${revenueRange.max.toLocaleString()}
                    </Typography>
                  </Box>
                ) : null;
              })()}

              {/* Deal Stats */}
              <Box 
                className="deal-stats-box"
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 2, 
                  mt: 0, 
                  marginTop: 0,
                  '&.deal-stats-box': {
                    marginTop: '0 !important'
                  }
                }}
              >
                {/* Stage */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Stage:</Typography>
                  <StageChip stage={deal.stage} size="small" useCustomColors={true} />
                </Box>

                {/* Close Date */}
                {(() => {
                  const qualData = stageData?.qualification;
                  const expectedCloseDate = qualData?.expectedCloseDate;
                  return expectedCloseDate ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Close:</Typography>
                      <Typography variant="body2" color="text.primary">
                        {new Date(expectedCloseDate + 'T00:00:00').toLocaleDateString()}
                      </Typography>
                    </Box>
                  ) : null;
                })()}

                {/* Owner */}
                {deal.owner && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Owner:</Typography>
                    <Typography variant="body2" color="text.primary">{deal.owner}</Typography>
                  </Box>
                )}
              </Box>

              {/* Company and Location */}
              {company && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0 }}>
                  <BusinessIcon fontSize="small" color="primary" />
                  <Typography 
                    variant="body2" 
                    color="primary"
                    sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.dark' } }}
                    onClick={() => navigate(`/crm/companies/${company.id}`)}
                  >
                    {company.companyName || company.name}
                  </Typography>
                  {/* <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Company:</Typography> */}
                  {/* <Typography 
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
                  </Typography> */}
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

                              {/* Deal Health Indicators */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0, marginTop: 0 }}>
                  {/* Deal Health */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Health:</Typography>
                    <Chip
                      label={deal.stage === 'closed_won' ? 'Won' : deal.stage === 'closed_lost' ? 'Lost' : 'Active'}
                      size="small"
                      sx={{
                        bgcolor: deal.stage === 'closed_won' ? 'success.light' : deal.stage === 'closed_lost' ? 'error.light' : 'info.light',
                        color: deal.stage === 'closed_won' ? 'success.dark' : deal.stage === 'closed_lost' ? 'error.dark' : 'info.dark',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        my: 0.5
                      }}
                    />
                  </Box>
                  
                  {/* Deal Priority */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Priority:</Typography>
                    <Chip
                      label={deal.estimatedRevenue > 100000 ? 'High' : deal.estimatedRevenue > 50000 ? 'Medium' : 'Low'}
                      size="small"
                      sx={{
                        bgcolor: deal.estimatedRevenue > 100000 ? 'error.light' : deal.estimatedRevenue > 50000 ? 'warning.light' : 'success.light',
                        color: deal.estimatedRevenue > 100000 ? 'error.dark' : deal.estimatedRevenue > 50000 ? 'warning.dark' : 'success.dark',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        my: 0.5
                      }}
                    />
                  </Box>
                </Box>
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button 
                variant="outlined" 
                startIcon={<AddIcon />}
                onClick={() => setShowAddNoteDialog(true)}
                size="small"
              >
                Add Note
              </Button>
              <Button 
                variant="contained" 
                startIcon={<CheckCircleIcon />}
                onClick={() => setShowLogActivityDialog(true)}
                sx={{ 
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: 'primary.dark'
                  }
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





      {/* Main Content Area */}
      <Box sx={{ display: 'flex', gap: 3 }}>
        {/* Main Content Area */}
        <Box sx={{ width: '100%' }}>
          {/* Tabs */}
          <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
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
                    <DashboardIcon fontSize="small" />
                    Dashboard
                  </Box>
                } 
              />

              <Tab 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StairsIcon fontSize="small" />
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
                    <TimelineIcon fontSize="small" />
                    Activity
                  </Box>
                } 
              />
            </Tabs>
          </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {/* Dashboard - Matching CompanyDetails Layout */}
        <Grid container spacing={3}>
          {/* Left Column - Action Focused */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Next Steps Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Next Steps">
                  <NextStepsWidget
                    stageData={stageData}
                    currentStage={deal.stage}
                    onNavigateToStages={() => setTabValue(1)}
                    onSkipQuestion={handleSkipQuestion}
                  />
                </SectionCard>
              </Box>

              {/* To-Dos Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="To-Dos" action={
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
                }>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <TasksDashboard
                      key={tasksDashboardKey}
                      entityId={deal.id}
                      entityType="deal"
                      tenantId={tenantId}
                      entity={deal}
                      preloadedContacts={associatedContacts}
                      preloadedSalespeople={associatedSalespeople}
                      preloadedCompany={company}
                      showOnlyTodos={true}
                    />
                  </Box>
                </SectionCard>
              </Box>

              {/* Appointments Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Appointments" action={
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
                }>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <AppointmentsDashboard
                      entityId={deal.id}
                      entityType="deal"
                      tenantId={tenantId}
                      entity={deal}
                      preloadedContacts={associatedContacts}
                      preloadedSalespeople={associatedSalespeople}
                      preloadedCompany={company}
                    />
                  </Box>
                </SectionCard>
              </Box>
            </Box>
          </Grid>

          {/* Center Column - Deal Intelligence */}
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Sales Coach */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Sales Coach">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                </SectionCard>
              </Box>

              {/* Relationship Map */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Relationship Map">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {associatedContacts.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {associatedContacts.slice(0, 4).map((contact, index) => (
                          <Box key={contact.id || index} sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 0.5, 
                            p: 0.5, 
                            bgcolor: 'grey.50', 
                            borderRadius: 0.5,
                            flex: 1
                          }}>
                            <Avatar sx={{ width: 16, height: 16, fontSize: '0.625rem' }}>
                              <PersonIcon sx={{ fontSize: 12 }} />
                            </Avatar>
                            <Typography variant="caption" fontSize="0.625rem" sx={{ flex: 1 }}>
                              {contact.fullName?.length > 15 ? contact.fullName.substring(0, 15) + '...' : contact.fullName}
                            </Typography>
                            <Chip 
                              label="contact" 
                              size="small" 
                              color="primary"
                              sx={{ height: 16, fontSize: '0.625rem' }}
                            />
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Skeleton variant="rectangular" height={32} />
                        <Skeleton variant="rectangular" height={24} />
                        <Skeleton variant="rectangular" height={24} />
                        <Skeleton variant="rectangular" height={24} />
                      </Box>
                    )}
                  </Box>
                </SectionCard>
              </Box>

              {/* Suggested by AI */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Suggested by AI">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {dealCoachActions.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {dealCoachActions.slice(0, 3).map((action, index) => (
                          <Box key={action.action} sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 0.5, 
                            p: 0.5, 
                            bgcolor: 'grey.50', 
                            borderRadius: 0.5,
                            flex: 1
                          }}>
                            <Avatar sx={{ width: 16, height: 16, fontSize: '0.625rem' }}>
                              <AIIcon sx={{ fontSize: 12 }} />
                            </Avatar>
                            <Typography variant="caption" fontSize="0.625rem" sx={{ flex: 1 }}>
                              {action.label?.length > 15 ? action.label.substring(0, 15) + '...' : action.label}
                            </Typography>
                            <Chip 
                              label={action.priority} 
                              size="small" 
                              color={action.priority === 'high' ? 'error' : 'warning'}
                              sx={{ height: 16, fontSize: '0.625rem' }}
                            />
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Skeleton variant="rectangular" height={32} />
                        <Skeleton variant="rectangular" height={24} />
                        <Skeleton variant="rectangular" height={24} />
                      </Box>
                    )}
                  </Box>
                </SectionCard>
              </Box>
            </Box>
          </Grid>

          {/* Right Column - Recent Activity, Active Salespeople & Contacts */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Recent Activity */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Recent Activity">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {activityCount > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          {activityCount} activities recorded
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Last activity: {new Date().toLocaleDateString()}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No recent activity. Activities will appear here as they occur.
                      </Typography>
                    )}
                  </Box>
                </SectionCard>
              </Box>

              {/* Active Salespeople Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Active Salespeople" action={
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setShowManageSalespeopleDialog(true)}
                    sx={{ 
                      minWidth: 'auto',
                      px: 1,
                      py: 0.5,
                      fontSize: '0.75rem',
                      textTransform: 'none'
                    }}
                  >
                    Edit
                  </Button>
                }>
                  {loadingSalespeople ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Skeleton variant="rectangular" height={48} />
                      <Skeleton variant="rectangular" height={48} />
                    </Box>
                  ) : associatedSalespeople.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {associatedSalespeople.map((salesperson) => (
                        <Box
                          key={salesperson.id}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                            {salesperson.fullName?.charAt(0) || salesperson.firstName?.charAt(0) || salesperson.displayName?.charAt(0) || 'S'}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {salesperson.fullName || salesperson.displayName || `${salesperson.firstName || ''} ${salesperson.lastName || ''}`.trim() || 'Unknown Salesperson'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {salesperson.email || salesperson.title || 'No additional info'}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      {/* <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                        No salespeople assigned
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Assign salespeople to this deal
                      </Typography>
                      <Button 
                        variant="outlined" 
                        size="small"
                        onClick={() => {
                          console.log('Assign salespeople to deal');
                        }}
                      >
                        Assign Salespeople
                      </Button> */}
                    </Box>
                  )}
                </SectionCard>
              </Box>

              {/* Contacts Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Deal Contacts" action={
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setShowManageContactsDialog(true)}
                    sx={{ 
                      minWidth: 'auto',
                      px: 1,
                      py: 0.5,
                      fontSize: '0.75rem',
                      textTransform: 'none'
                    }}
                  >
                    Edit
                  </Button>
                }>
                  {associatedContacts.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {associatedContacts.map((contact) => (
                        <Box
                          key={contact.id}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                          onClick={() => navigate(`/crm/contacts/${contact.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/crm/contacts/${contact.id}`); } }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                            {contact.fullName?.charAt(0) || contact.firstName?.charAt(0) || contact.name?.charAt(0) || 'C'}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || 'Unknown Contact'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {contact.title || 'No title'}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      {/* <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                        No contacts yet
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Add contacts to this deal to get started
                      </Typography>
                      <Button 
                        variant="outlined" 
                        size="small"
                        onClick={() => {
                          // TODO: Open add contact dialog or navigate to contacts tab
                          console.log('Add contact to deal');
                        }}
                      >
                        Add Contact
                      </Button> */}
                    </Box>
                  )}
                </SectionCard>
              </Box>

              {/* Location Widget */}
              <Box sx={{ mb: 0 }}>
                <SectionCard title="Location" action={
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setShowManageLocationDialog(true)}
                    sx={{ 
                      minWidth: 'auto',
                      px: 1,
                      py: 0.5,
                      fontSize: '0.75rem',
                      textTransform: 'none'
                    }}
                  >
                    Edit
                  </Button>
                }>
                  {(() => {
                    const locations = (deal as any)?.associations?.locations || [];
                    const hasLocations = locations.length > 0;
                    
                    if (hasLocations) {
                      // Get the first location (assuming primary location)
                      const locationEntry = locations[0];
                      
                      const locationId = typeof locationEntry === 'string' ? locationEntry : locationEntry.id;
                      const locationName = typeof locationEntry === 'string' ? 'Unknown Location' : (locationEntry.snapshot?.name || locationEntry.name || 'Unknown Location');
                      const locationNickname = typeof locationEntry === 'string' ? '' : (locationEntry.snapshot?.nickname || locationEntry.nickname || '');
                      const locationAddress = typeof locationEntry === 'string' ? '' : (locationEntry.snapshot?.address || locationEntry.address || '');
                      
                      // Location data loading is handled by useEffect hook to prevent infinite re-renders
                      
                      // Use database location data if available, otherwise use association data
                      const displayName = locationData?.nickname || locationData?.name || locationNickname || locationName;
                      const displayAddress = locationData?.address || locationAddress;
                      
                      return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {loadingLocation ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}>
                              <CircularProgress size={16} />
                              <Typography variant="body2" color="text.secondary">
                                Loading location...
                              </Typography>
                            </Box>
                          ) : (
                            <Box
                              sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                              onClick={() => {
                                if (company && locationId) {
                                  navigate(`/crm/companies/${company.id}/locations/${locationId}`);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { 
                                if (e.key === 'Enter' || e.key === ' ') { 
                                  e.preventDefault(); 
                                  if (company && locationId) {
                                    navigate(`/crm/companies/${company.id}/locations/${locationId}`);
                                  }
                                } 
                              }}
                            >
                              <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                                <BusinessIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {displayName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {displayAddress || 'No address'}
                                </Typography>
                              </Box>
                            </Box>
                          )}
                        </Box>
                      );
                    } else {
                      return (
                        <Box sx={{ textAlign: 'center', py: 3 }}>
                          <Typography variant="body2" color="text.secondary">
                            No location assigned
                          </Typography>
                        </Box>
                      );
                    }
                  })()}
                </SectionCard>
              </Box>
            </Box>
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
        <DealActivityTab
          deal={deal}
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
              try {
                console.log('Creating task:', taskData);
                
                // Import TaskService dynamically to avoid circular dependencies
                const { TaskService } = await import('../../utils/taskService');
                const taskService = TaskService.getInstance();
                
                // Create the task with proper associations
                const taskWithAssociations = {
                  ...taskData,
                  tenantId,
                  createdBy: user?.uid || '', // Required by Cloud Function
                  assignedTo: user?.uid || '', // Required by Cloud Function
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  associations: {
                    ...taskData.associations,
                    deals: [deal.id], // Associate with current deal
                    companies: getDealPrimaryCompanyId(deal) ? [getDealPrimaryCompanyId(deal)!] : [],
                    contacts: associatedContacts.map(contact => contact.id),
                    salespeople: associatedSalespeople.map(salesperson => salesperson.id)
                  }
                };
                
                console.log('Task with associations:', taskWithAssociations);
                console.log('Deal ID:', deal.id);
                
                const taskId = await taskService.createTask(taskWithAssociations);
                console.log('Task created successfully with ID:', taskId);
                console.log('Task associations:', taskWithAssociations.associations);
                
                // Task created successfully - the TasksDashboard should pick it up via real-time subscription
                
                setShowCreateTaskDialog(false);
                setPrefilledTaskData(null); // Clear prefilled data after submission
                
                // Force refresh the TasksDashboard by updating the key after a short delay
                setTimeout(() => {
                  setTasksDashboardKey(`${deal.id}-${Date.now()}`);
                }, 500);
                
              } catch (error) {
                console.error('Error creating task:', error);
                // You might want to show an error message to the user here
              }
            }}
            prefilledData={prefilledTaskData}
            salespeople={associatedSalespeople}
            contacts={associatedContacts}
            currentUserId={user?.uid || ''}
          />

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
      </>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={deal?.id || ''}
        entityType="deal"
        entityName={deal?.name || ''}
        tenantId={tenantId}
        contacts={associatedContacts}
        onNoteAdded={() => {
          // Optionally refresh notes or trigger any updates
          console.log('Note added successfully');
        }}
      />

      {/* Manage Salespeople Dialog */}
      <ManageSalespeopleDialog
        open={showManageSalespeopleDialog}
        onClose={() => setShowManageSalespeopleDialog(false)}
        tenantId={tenantId}
        currentSalespeople={associatedSalespeople}
        onSalespeopleChange={handleSalespeopleChange}
      />

      {/* Manage Contacts Dialog */}
      <ManageContactsDialog
        open={showManageContactsDialog}
        onClose={() => setShowManageContactsDialog(false)}
        tenantId={tenantId}
        currentContacts={associatedContacts}
        onContactsChange={handleContactsChange}
        dealCompanyId={getDealPrimaryCompanyId(deal)}
      />

      {/* Manage Location Dialog */}
      {(() => {
        const companyId = getDealPrimaryCompanyId(deal);
        if (!companyId) {
          console.log('ManageLocationDialog: No company associated with deal, skipping dialog');
          return null;
        }
        
        return (
          <ManageLocationDialog
            open={showManageLocationDialog}
            onClose={() => setShowManageLocationDialog(false)}
            tenantId={tenantId}
            companyId={companyId}
            currentLocationId={(() => {
              const locations = (deal as any)?.associations?.locations || [];
              if (locations.length > 0) {
                const locationEntry = locations[0];
                return typeof locationEntry === 'string' ? locationEntry : locationEntry.id;
              }
              return undefined;
            })()}
            onLocationChange={handleLocationChange}
          />
        );
      })()}
    </Box>
  );
};

// SectionCard component (matching CompanyDetails)
const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Card>
    <CardHeader 
      title={title} 
      action={action}
      sx={{ p: 2, pb: 1 }}
      titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
    />
    <CardContent sx={{ p: 2, pt: 0 }}>
      {children}
    </CardContent>
  </Card>
);

export default DealDetails; 