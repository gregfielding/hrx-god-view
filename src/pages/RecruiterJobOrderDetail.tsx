import React, { useState, useEffect } from 'react';

console.log('🔍 RecruiterJobOrderDetail: Module loaded');
import { safeToDate, getJobOrderAge } from '../utils/dateUtils';
import {
  Box,
  Typography,
  Chip,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Tabs,
  Tab,
  IconButton,
  Menu,
  MenuItem,
  Alert,
  CircularProgress,
  Paper,
  Avatar,
  Link as MUILink,
  Button,
  Skeleton,
  TextField
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Work as BriefcaseIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Work as WorkIcon,
  Group as GroupIcon,
  Description as DescriptionIcon,
  Security as SecurityIcon,
  Assignment as AssignmentIcon,
  Timeline as TimelineIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  AttachMoney as DealIcon,
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
  Notes as NotesIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/recruiter/jobOrder';
import JobOrderForm from '../components/JobOrderForm';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import ManageContactsDialog from '../components/ManageContactsDialog';
import StaffInstructionCard from '../components/recruiter/StaffInstructionCard';
import CRMNotesTab from '../components/CRMNotesTab';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
      id={`job-order-tabpanel-${index}`}
      aria-labelledby={`job-order-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const RecruiterJobOrderDetail: React.FC = () => {
  const { jobOrderId } = useParams<{ jobOrderId: string }>();
  const navigate = useNavigate();
  const { user, tenantId } = useAuth();
  
  console.log('🔍 RecruiterJobOrderDetail: Component mounted with params:', { jobOrderId, tenantId, user: user?.uid });
  
  // State
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [deal, setDeal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [recruiterUsers, setRecruiterUsers] = useState<Array<{id: string; displayName: string; email?: string}>>([]);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [connectedJobPosts, setConnectedJobPosts] = useState<JobsBoardPost[]>([]);
  const [manageContactsOpen, setManageContactsOpen] = useState(false);

  // Load job order
  useEffect(() => {
    console.log('🔍 RecruiterJobOrderDetail: useEffect triggered with:', { jobOrderId, tenantId });
    if (jobOrderId && tenantId) {
      console.log('🔍 RecruiterJobOrderDetail: Calling fetchJobOrder');
      fetchJobOrder();
    } else {
      console.log('🔍 RecruiterJobOrderDetail: Missing jobOrderId or tenantId, not fetching');
    }
  }, [jobOrderId, tenantId]);

  const loadCompanyData = async (companyId: string) => {
    if (!companyId || !tenantId) return;
    
    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companyDoc = await getDoc(companyRef);
      
      if (companyDoc.exists()) {
        const companyData = { id: companyDoc.id, ...companyDoc.data() };
        setCompany(companyData);
      }
    } catch (error) {
      console.error('Error loading company data:', error);
    }
  };

  const loadLocationData = async (companyId: string, locationId: string) => {
    if (!companyId || !locationId || !tenantId) return;
    
    try {
      console.log('🔍 Loading location:', { companyId, locationId, tenantId });
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
      const locationDoc = await getDoc(locationRef);
      
      if (locationDoc.exists()) {
        const locationData = { id: locationDoc.id, ...locationDoc.data() };
        console.log('🔍 Location loaded:', locationData);
        setLocation(locationData);
      } else {
        console.log('🔍 Location not found');
      }
    } catch (error) {
      console.error('Error loading location data:', error);
    }
  };

  const loadConnectedJobPosts = async (jobOrderId: string) => {
    if (!jobOrderId || !tenantId) return;
    
    try {
      console.log('🔍 Loading connected job posts for job order:', jobOrderId);
      const jobsBoardService = JobsBoardService.getInstance();
      const posts = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrderId);
      setConnectedJobPosts(posts);
      console.log('🔍 Connected job posts loaded:', posts);
    } catch (error) {
      console.error('Error loading connected job posts:', error);
    }
  };

  const loadDealData = async (dealId: string) => {
    if (!dealId || !tenantId) return;
    
    try {
      console.log('🔍 Loading deal:', { dealId, tenantId });
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealDoc = await getDoc(dealRef);
      
      if (dealDoc.exists()) {
        const dealData = { id: dealDoc.id, ...dealDoc.data() };
        console.log('🔍 Deal loaded:', dealData);
        setDeal(dealData);
      } else {
        console.log('🔍 Deal not found');
      }
    } catch (error) {
      console.error('Error loading deal data:', error);
    }
  };

  const fetchJobOrder = async () => {
    if (!jobOrderId || !tenantId) {
      console.log('🔍 RecruiterJobOrderDetail: Missing jobOrderId or tenantId:', { jobOrderId, tenantId });
      return;
    }
    
    console.log('🔍 RecruiterJobOrderDetail: Fetching job order:', { jobOrderId, tenantId });
    setLoading(true);
    try {
      // First try the current tenant-scoped path
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      console.log('🔍 RecruiterJobOrderDetail: Job order ref path:', jobOrderRef.path);
      
      const jobOrderSnap = await getDoc(jobOrderRef);
      console.log('🔍 RecruiterJobOrderDetail: Job order exists in tenant path:', jobOrderSnap.exists());
      
      if (jobOrderSnap.exists()) {
        const data = jobOrderSnap.data() as JobOrder;
        console.log('🔍 RecruiterJobOrderDetail: Job order data:', data);
        console.log('🔍 RecruiterJobOrderDetail: Date fields:', {
          createdAt: data.createdAt,
          startDate: data.startDate,
          endDate: data.endDate
        });
        setJobOrder({ ...data, id: jobOrderSnap.id });
        
        // Load company data if companyId exists in deal data
        const flatCompanyId = (data as any).companyId || data.deal?.companyId;
        if (flatCompanyId) {
          await loadCompanyData(flatCompanyId);
        }
        
        // Load connected job board posts
        await loadConnectedJobPosts(jobOrderId);
      } else {
        // Try the top-level collection as fallback
        console.log('🔍 RecruiterJobOrderDetail: Job order not found in tenant path, checking top-level collection...');
        const topLevelJobOrderRef = doc(db, 'jobOrders', jobOrderId);
        const topLevelJobOrderSnap = await getDoc(topLevelJobOrderRef);
        
        if (topLevelJobOrderSnap.exists()) {
          console.log('🔍 RecruiterJobOrderDetail: Job order found in top-level collection!');
          const data = topLevelJobOrderSnap.data() as JobOrder;
          console.log('🔍 RecruiterJobOrderDetail: Date fields:', {
            createdAt: data.createdAt,
            startDate: data.startDate,
            endDate: data.endDate
          });
          setJobOrder({ ...data, id: topLevelJobOrderSnap.id });
          
          // Load company data if companyId exists in deal data
          const flatCompanyIdTop = (data as any).companyId || data.deal?.companyId;
          if (flatCompanyIdTop) {
            await loadCompanyData(flatCompanyIdTop);
          }
          
          // Load connected job board posts
          await loadConnectedJobPosts(jobOrderId);
          return; // Exit early since we found the job order
        }
        // Job order not found - let's see what job orders actually exist
        console.log('🔍 RecruiterJobOrderDetail: Job order not found in database');
        console.log('🔍 RecruiterJobOrderDetail: Checking what job orders exist...');
        
        try {
          const { collection, getDocs } = await import('firebase/firestore');
          
          // Check the current path
          const jobOrdersRef = collection(db, p.jobOrders(tenantId));
          const jobOrdersSnapshot = await getDocs(jobOrdersRef);
          console.log('🔍 RecruiterJobOrderDetail: Found job orders in current path:', jobOrdersSnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
          
          // Check legacy path
          const legacyJobOrdersRef = collection(db, `tenants/${tenantId}/recruiter_jobOrders`);
          const legacyJobOrdersSnapshot = await getDocs(legacyJobOrdersRef);
          console.log('🔍 RecruiterJobOrderDetail: Found job orders in legacy path:', legacyJobOrdersSnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
          
          // Check if the specific job order exists in legacy path
          if (legacyJobOrdersSnapshot.docs.some(doc => doc.id === jobOrderId)) {
            console.log('🔍 RecruiterJobOrderDetail: Job order found in legacy path!');
          }
          
          // Check top-level jobOrders collection (legacy)
          const topLevelJobOrdersRef = collection(db, 'jobOrders');
          const topLevelJobOrdersSnapshot = await getDocs(topLevelJobOrdersRef);
          console.log('🔍 RecruiterJobOrderDetail: Found job orders in top-level path:', topLevelJobOrdersSnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
          
          // Check if the specific job order exists in top-level path
          const foundJobOrder = topLevelJobOrdersSnapshot.docs.find(doc => doc.id === jobOrderId);
          if (foundJobOrder) {
            console.log('🔍 RecruiterJobOrderDetail: Job order found in top-level path!', foundJobOrder.data());
            // Load the job order from the top-level collection
            const data = foundJobOrder.data() as JobOrder;
            setJobOrder({ ...data, id: foundJobOrder.id });
            
            // Load company data if companyId exists in deal data
            const flatCompanyIdLegacy = (data as any).companyId || data.deal?.companyId;
            if (flatCompanyIdLegacy) {
              await loadCompanyData(flatCompanyIdLegacy);
            }
            return; // Exit early since we found the job order
          } else {
            console.log('🔍 RecruiterJobOrderDetail: Job order not found in any path');
          }
        } catch (error) {
          console.error('🔍 RecruiterJobOrderDetail: Error listing job orders:', error);
        }
        
        setJobOrder(null);
      }
    } catch (error) {
      console.error('Error fetching job order:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load assigned recruiter user names for header display
  const loadAssignedRecruiters = async (ids: string[]) => {
    if (!ids || ids.length === 0) {
      setRecruiterUsers([]);
      return;
    }
    try {
      const usersRef = collection(db, 'users');
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
      const results: Array<{id: string; displayName: string; email?: string}> = [];
      for (const batch of chunks) {
        const q = query(usersRef, where('__name__', 'in' as any, batch as any));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          const u: any = d.data() || {};
          const displayName = (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}`.trim() : '') ||
                              u.displayName ||
                              (u.email ? String(u.email).split('@')[0] : 'Salesperson');
          results.push({ id: d.id, displayName, email: u.email });
        });
      }
      setRecruiterUsers(results);
    } catch (error) {
      console.error('Error loading assigned recruiters:', error);
      setRecruiterUsers([]);
    }
  };

  // Load associated contacts and salespeople from job order or original deal data
  const loadAssociatedContactsAndSalespeople = async () => {
    if (!jobOrder) {
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
      return;
    }
    
    try {
      const hasEmbeddedAssociations = !!jobOrder.deal?.associations;
      if (!hasEmbeddedAssociations && jobOrder.dealId) {
        console.log('🔍 No associations in job order deal, loading from original deal:', jobOrder.dealId);
        try {
          const dealRef = doc(db, 'tenants', tenantId!, 'crm_deals', jobOrder.dealId);
          const dealDoc = await getDoc(dealRef);
          
          if (dealDoc.exists()) {
            const originalDealData = dealDoc.data();
            console.log('🔍 Original deal associations:', originalDealData.associations);
            
            if (originalDealData.associations) {
              // Use the original deal associations
              const associations = originalDealData.associations;
              let contacts: any[] = [];
              let salespeople: any[] = [];
              
              // Load contacts from original deal associations
              if (associations.contacts && Array.isArray(associations.contacts)) {
                contacts = associations.contacts.map((contact: any) => ({
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
              
              // Load salespeople from original deal associations
              if (associations.salespeople && Array.isArray(associations.salespeople)) {
                salespeople = associations.salespeople.map((salesperson: any) => {
                  const salespersonData = typeof salesperson === 'string' ? { id: salesperson } : salesperson;
                  const snapshot = salespersonData.snapshot || {};
                  
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
              
              console.log('🔍 Loaded contacts from original deal:', contacts);
              console.log('🔍 Loaded salespeople from original deal:', salespeople);
              return;
            }
          }
        } catch (error) {
          console.error('Error loading original deal associations:', error);
        }
      }
      
      if (!hasEmbeddedAssociations) {
        console.log('🔍 No associations found in deal data');
        setAssociatedContacts([]);
        setAssociatedSalespeople([]);
        return;
      }
      
      // Load contacts from deal associations (same as DealDetails.tsx)
      const associations = jobOrder.deal!.associations || {};
      
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
      
      // Load salespeople from deal associations (same as DealDetails.tsx)
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
      
      console.log('🔍 Loaded contacts:', associatedContacts);
      console.log('🔍 Loaded salespeople:', associatedSalespeople);
    } catch (error) {
      console.error('Error loading associated contacts and salespeople:', error);
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
    }
  };

  // Trigger recruiter load when job order changes
  useEffect(() => {
    if (jobOrder?.assignedRecruiters && jobOrder.assignedRecruiters.length > 0) {
      loadAssignedRecruiters(jobOrder.assignedRecruiters);
    } else {
      setRecruiterUsers([]);
    }
  }, [jobOrder?.assignedRecruiters]);

  // Load associated contacts and salespeople when job order deal data changes
  useEffect(() => {
    console.log('🔍 useEffect triggered for contacts/salespeople:', {
      hasJobOrder: !!jobOrder,
      hasDeal: !!jobOrder?.deal,
      hasDealId: !!jobOrder?.dealId,
      hasAssociations: !!jobOrder?.deal?.associations,
      associations: jobOrder?.deal?.associations
    });
    
    if (jobOrder) {
      loadAssociatedContactsAndSalespeople();
    } else {
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
    }
  }, [jobOrder, jobOrder?.deal?.associations, jobOrder?.dealId]);

  // Load location data if worksiteId exists but worksiteName is missing
  useEffect(() => {
    const hasWorksiteId = jobOrder?.worksiteId;
    const hasWorksiteName = jobOrder?.worksiteName;
    const hasCompanyId = jobOrder?.companyId || company?.id;
    
    console.log('🔍 Location loading check:', {
      hasWorksiteId,
      hasWorksiteName,
      hasCompanyId,
      worksiteId: jobOrder?.worksiteId,
      companyId: hasCompanyId
    });
    
    if (hasWorksiteId && !hasWorksiteName && hasCompanyId) {
      console.log('🔍 Loading location data because worksiteName is missing');
      loadLocationData(hasCompanyId, jobOrder!.worksiteId!);
    }
  }, [jobOrder?.worksiteId, jobOrder?.worksiteName, jobOrder?.companyId, company?.id]);

  // Load deal data if dealId exists but no embedded deal data
  useEffect(() => {
    const hasDealId = jobOrder?.dealId;
    const hasEmbeddedDeal = jobOrder?.deal?.name;
    
    if (hasDealId && !hasEmbeddedDeal && !deal) {
      console.log('🔍 Loading deal data for deal link');
      loadDealData(jobOrder!.dealId);
    }
  }, [jobOrder?.dealId, jobOrder?.deal?.name, deal]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'success';
      case 'on_hold': return 'warning';
      case 'cancelled': return 'error';
      case 'filled': return 'info';
      case 'completed': return 'default';
      default: return 'default';
    }
  };

  const formatJobOrderNumber = (number: string | number) => {
    if (typeof number === 'string') {
      return number; // Already formatted
    }
    return `#${number.toString().padStart(4, '0')}`;
  };

  const handleContactsChange = async (updatedContacts: any[]) => {
    if (!jobOrder || !tenantId || !jobOrderId) return;
    
    console.log('🔍 handleContactsChange called:', {
      updatedContacts: updatedContacts.length,
      hasDeal: !!jobOrder.deal,
      dealId: jobOrder.dealId,
      jobOrderId
    });
    
    try {
      // Update local state immediately for responsive UI
      setAssociatedContacts(updatedContacts);
      
      // Prepare the updated associations structure
      const updatedAssociations = {
        ...(jobOrder.deal?.associations || {}),
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
      
      console.log('🔍 Prepared associations:', updatedAssociations);
      
      // If job order has a deal object (created from deal OR manually created)
      if (jobOrder.deal) {
        console.log('🔍 JobOrder has deal object - updating deal.associations');
        // Update the existing deal object with new associations
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          'deal.associations': updatedAssociations,
          updatedAt: new Date()
        });
        console.log('✅ Updated existing deal.associations');
      } else {
        console.log('🔍 JobOrder has NO deal object - creating minimal deal structure');
        // Job order has no deal object - create minimal deal structure to store associations
        const minimalDeal = {
          id: null,
          name: jobOrder.jobOrderName,
          companyId: jobOrder.companyId,
          companyName: jobOrder.companyName,
          locationId: jobOrder.worksiteId,
          locationName: jobOrder.worksiteName,
          stage: null,
          status: null,
          estimatedRevenue: jobOrder.estimatedRevenue || 0,
          closeDate: null,
          owner: jobOrder.createdBy,
          tags: [],
          notes: '',
          stageData: {},
          associations: updatedAssociations,
          createdAt: null,
          updatedAt: new Date()
        };
        
        console.log('🔍 Minimal deal to save:', minimalDeal);
        
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          deal: minimalDeal,
          updatedAt: new Date()
        });
        console.log('✅ Created and saved minimal deal structure');
      }
      
      // If there's a source deal, also update it
      if (jobOrder.dealId) {
        console.log('🔍 JobOrder has dealId - also updating source deal:', jobOrder.dealId);
        try {
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', jobOrder.dealId), {
            associations: updatedAssociations,
            updatedAt: new Date()
          });
          console.log('✅ Updated source deal');
        } catch (error) {
          console.warn('Could not update source deal:', error);
        }
      }
      
      console.log('✅ Contacts updated successfully - total:', updatedContacts.length);
      
      // Reload job order to get fresh data
      await fetchJobOrder();
    } catch (error) {
      console.error('❌ Error updating contacts:', error);
      // Revert local state if update fails
      setAssociatedContacts(jobOrder?.deal?.associations?.contacts || []);
    }
  };

  console.log('🔍 RecruiterJobOrderDetail: Rendering with state:', { loading, jobOrder: !!jobOrder, jobOrderId, tenantId });

  if (loading) {
    console.log('🔍 RecruiterJobOrderDetail: Showing loading spinner');
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!jobOrder) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Job order not found or you don't have permission to view it.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Enhanced Header - Matching Deal Details Layout */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Company Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company?.logo}
                alt={jobOrder.companyName || company?.companyName || company?.name || 'Company'}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(jobOrder.companyName || company?.companyName || company?.name || 'C').charAt(0).toUpperCase()}
              </Avatar>
            </Box>

            {/* Job Order Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {jobOrder.jobOrderName}
                </Typography>
              </Box>
        
              {/* Job Order ID / Number */}
              {/* <Typography variant="h6" color="text.secondary" sx={{ mt: 0.5 }}>
                {formatJobOrderNumber(jobOrder.jobOrderNumber)}
              </Typography> */}

              {/* Status Row with Job Order Number */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Job Order:</Typography>
                  <Chip
                    label={`#${jobOrder.jobOrderNumber || '0002'}`}
                    size="small"
                    sx={{ bgcolor: 'grey.200', color: 'text.primary', fontWeight: 600 }}
                  />
                </Box>
                
                {(jobOrder as any).jobType && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Job Type:</Typography>
                    <Chip
                      label={(jobOrder as any).jobType === 'gig' ? 'Gig' : 'Career'}
                      size="small"
                      color="default"
                    />
                  </Box>
                )}
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Status:</Typography>
          <Chip
            label={jobOrder.status}
            color={getStatusColor(jobOrder.status) as any}
                    size="small"
                  />
                </Box>
                
                {location && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Location:</Typography>
                    <Chip
                      label={`${location.city || ''}${location.city && location.state ? ', ' : ''}${location.state || ''}`}
                      color="default"
                      size="small"
                    />
                  </Box>
                )}
                
                {jobOrder.startDate && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Start Date:</Typography>
                    <Chip
                      label={format(safeToDate(jobOrder.startDate), 'MMM dd, yyyy')}
                      color="default"
                      size="small"
                    />
                  </Box>
                )}
              </Box>

              {/* Company & Location Row */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
                {/* Company - with fallback to company object or deal */}
                {(() => {
                  const companyName = jobOrder?.companyName || company?.companyName || company?.name || jobOrder?.deal?.companyName;
                  const companyId = jobOrder?.companyId || company?.id || jobOrder?.deal?.companyId;
                  
                  if (companyName && companyId) {
                    return (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <BusinessIcon fontSize="small" color="primary" />
                        <MUILink
                          underline="hover"
                          color="primary"
                          href={`/recruiter/companies/${companyId}`}
                          onClick={(e) => { e.preventDefault(); navigate(`/recruiter/companies/${companyId}`); }}
                          sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                        >
                          {companyName}
                        </MUILink>
                      </Box>
                    );
                  }
                  return null;
                })()}

                {/* Location - with fallback to loaded location data or deal associations */}
                {(() => {
                  const worksiteName = jobOrder?.worksiteName;
                  const worksiteId = jobOrder?.worksiteId;
                  
                  // Try loaded location data first
                  const loadedLocationName = location?.nickname || location?.name;
                  
                  // Fallback to deal associations if no worksite name and no loaded location
                  const dealLocations = jobOrder?.deal?.associations?.locations || [];
                  const locationEntry = dealLocations.length > 0 ? dealLocations[0] : null;
                  const dealLocationId = typeof locationEntry === 'string' ? locationEntry : locationEntry?.id;
                  const dealLocationName = typeof locationEntry === 'string' ? '' : (locationEntry?.snapshot?.name || locationEntry?.snapshot?.nickname || locationEntry?.name || '');
                  
                  const displayLocationId = worksiteId || dealLocationId;
                  const displayLocationName = worksiteName || loadedLocationName || dealLocationName;
                  const displayCompanyId = jobOrder?.companyId || jobOrder?.deal?.companyId;
                  
                  console.log('🔍 Location header debug:', {
                    worksiteName,
                    worksiteId,
                    loadedLocationName,
                    dealLocations,
                    dealLocationName,
                    displayLocationName,
                    displayLocationId,
                    displayCompanyId
                  });
                  
                  if (displayLocationName && displayLocationId && displayCompanyId) {
                    return (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <LocationIcon fontSize="small" color="primary" />
                        <MUILink
                          underline="hover"
                          color="primary"
                          href={`/recruiter/companies/${displayCompanyId}/locations/${displayLocationId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/recruiter/companies/${displayCompanyId}/locations/${displayLocationId}`);
                          }}
                          sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                        >
                          {displayLocationName}
                        </MUILink>
                      </Box>
                    );
                  }
                  return null;
                })()}

                {/* Deal Link - if job order was created from a deal */}
                {jobOrder?.dealId && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <DealIcon fontSize="small" color="primary" />
                    <MUILink
                      underline="hover"
                      color="primary"
                      href={`/recruiter/deals/${jobOrder.dealId}`}
                      onClick={(e) => { 
                        e.preventDefault(); 
                        navigate(`/recruiter/deals/${jobOrder.dealId}`); 
                      }}
                      sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                    >
                      {jobOrder.deal?.name || deal?.name || 'Loading...'}
                    </MUILink>
                  </Box>
                )}

                {/* Connected Job Posts */}
                {connectedJobPosts.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <BriefcaseIcon fontSize="small" color="primary" />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                      {connectedJobPosts.map((post, index) => (
                        <Box key={post.id || index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <MUILink
                            underline="hover"
                            color="primary"
                            href={`/jobs-dashboard/edit/${post.id}`}
                            onClick={(e) => { e.preventDefault(); navigate(`/jobs-dashboard/edit/${post.id}`); }}
                            sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                          >
                            {post.postTitle}
                          </MUILink>
                          {index < connectedJobPosts.length - 1 && (
                            <Typography variant="body2" color="text.secondary">•</Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>

              {/* Associated Contacts Row */}
              {Array.isArray(associatedContacts) && associatedContacts.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
                  <GroupIcon fontSize="small" color="primary" />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    {associatedContacts.slice(0, 10).map((contact: any, index: number) => (
                      <Box key={contact.id || index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <MUILink
                          underline="hover"
                          color="primary"
                          href={`/recruiter/contacts/${contact.id}`}
                          onClick={(e) => { e.preventDefault(); navigate(`/recruiter/contacts/${contact.id}`); }}
                        >
                          <Typography variant="body2" color="primary">
                            {(contact.fullName || contact.name || 'Contact')}
                          </Typography>
                        </MUILink>
                        {index < Math.min(associatedContacts.length, 10) - 1 && (
                          <Typography variant="body2" color="text.secondary">•</Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Associated Salespeople Row */}
              {Array.isArray(associatedSalespeople) && associatedSalespeople.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
                  <PersonIcon fontSize="small" color="primary" />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    {associatedSalespeople.slice(0, 10).map((sp: any, index: number) => (
                      <Box key={sp.id || index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color="text.primary">
                          {sp.displayName || sp.fullName || sp.name || sp.email || 'Salesperson'}
                        </Typography>
                        {index < Math.min(associatedSalespeople.length, 10) - 1 && (
                          <Typography variant="body2" color="text.secondary">•</Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>

          
        </Box>
      </Box>

      {/* Tabs */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Job order details tabs"
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
                <DescriptionIcon fontSize="small" />
                Staff Instructions
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssignmentIcon fontSize="small" />
                Applications
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupIcon fontSize="small" />
                Placements
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
      <TabPanel value={activeTab} index={0}>
        {/* Overview Tab - Job Order Form with Widgets */}
        <Grid container spacing={3}>
          {/* Left Column - Job Order Form (70%) */}
          <Grid item xs={12} md={8}>
            <JobOrderForm
              jobOrderId={jobOrderId}
              dealId={jobOrder?.dealId}
              onSave={() => {
                // Refresh the job order data after save
                fetchJobOrder();
              }}
              onCancel={() => {
                // Optionally handle cancel
              }}
            />
          </Grid>

          {/* Right Column - Widgets (30%) */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Company Widget */}
              <SectionCard title="Company" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    if (company) {
                      navigate(`/recruiter/companies/${company.id}`);
                    }
                  }}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  View
                </Button>
              }>
                {company ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                      onClick={() => navigate(`/recruiter/companies/${company.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { 
                        if (e.key === 'Enter' || e.key === ' ') { 
                          e.preventDefault(); 
                          navigate(`/recruiter/companies/${company.id}`);
                        } 
                      }}
                    >
                      <Avatar 
                        src={company.logo || company.logoUrl || company.logo_url || company.avatar}
                        sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}
                      >
                        {(company.companyName || company.name || 'C').charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {company.companyName || company.name || 'Unknown Company'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {company.industry || company.sector || 'No industry'}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No company assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Active Salespeople Widget */}
              <SectionCard title="Active Salespeople" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    // TODO: Open manage salespeople dialog
                    console.log('Manage salespeople for job order');
                  }}
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
                {associatedSalespeople.length > 0 ? (
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
                    <Typography variant="body2" color="text.secondary">
                      No salespeople assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Deal Contacts Widget */}
              <SectionCard title="Deal Contacts" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setManageContactsOpen(true)}
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
                        onClick={() => navigate(`/recruiter/contacts/${contact.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/recruiter/contacts/${contact.id}`); } }}
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
                    <Typography variant="body2" color="text.secondary">
                      No contacts assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Location Widget */}
              <SectionCard title="Location" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    // TODO: Open manage location dialog
                    console.log('Manage location for job order');
                  }}
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
                  // Try to get location from job order directly, loaded location data, or deal associations
                  const worksiteName = jobOrder?.worksiteName;
                  const worksiteId = jobOrder?.worksiteId;
                  const loadedLocationName = location?.nickname || location?.name;
                  
                  // Fallback to deal associations if no worksite name
                  const dealLocations = jobOrder?.deal?.associations?.locations || [];
                  const locationEntry = dealLocations.length > 0 ? dealLocations[0] : null;
                  const dealLocationId = typeof locationEntry === 'string' ? locationEntry : locationEntry?.id;
                  const dealLocationName = typeof locationEntry === 'string' ? '' : (locationEntry?.snapshot?.name || locationEntry?.snapshot?.nickname || locationEntry?.name || '');
                  
                  const displayLocationId = worksiteId || dealLocationId;
                  const displayLocationName = worksiteName || loadedLocationName || dealLocationName;
                  const displayAddress = location?.address || (typeof jobOrder?.worksiteAddress === 'string' ? jobOrder.worksiteAddress : '');
                  
                  if (displayLocationName) {
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                          onClick={() => {
                            const companyId = company?.id || jobOrder?.companyId;
                            if (companyId && displayLocationId) {
                              navigate(`/recruiter/companies/${companyId}/locations/${displayLocationId}`);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter' || e.key === ' ') { 
                              e.preventDefault(); 
                              const companyId = company?.id || jobOrder?.companyId;
                              if (companyId && displayLocationId) {
                                navigate(`/recruiter/companies/${companyId}/locations/${displayLocationId}`);
                              }
                            } 
                          }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                            <BusinessIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {displayLocationName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {displayAddress || 'No address'}
                            </Typography>
                          </Box>
                        </Box>
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
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        {/* Staff Instructions Tab */}
        <Grid container spacing={3}>
          {/* First Day Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="First Day Instructions"
              fieldKey="firstDay"
              placeholder="Enter first day instructions (e.g., arrival time, what to bring, who to meet, orientation details...)"
              uploadPlaceholder="Upload first day schedules, orientation materials, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Parking Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Parking Instructions"
              fieldKey="parking"
              placeholder="Enter parking instructions for staff (e.g., where to park, parking pass requirements, visitor parking location...)"
              uploadPlaceholder="Upload parking maps, diagrams, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Check-In Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Check-In Instructions"
              fieldKey="checkIn"
              placeholder="Enter check-in instructions (e.g., where to report, who to ask for, required documents...)"
              uploadPlaceholder="Upload check-in forms, maps, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Uniform Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Uniform Instructions"
              fieldKey="uniform"
              placeholder="Enter uniform and dress code requirements (e.g., specific colors, safety gear, PPE requirements...)"
              uploadPlaceholder="Upload uniform photos, dress code guides, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Credential Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Credential Instructions"
              fieldKey="credentials"
              placeholder="Enter credential requirements (e.g., badge pickup, wristband issuance, ID requirements...)"
              uploadPlaceholder="Upload credential forms, badge photos, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Other Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Other Instructions"
              fieldKey="other"
              placeholder="Enter any additional instructions or important information for staff..."
              uploadPlaceholder="Upload any other relevant documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Other Attachments (attachments only, no text field) */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Other Attachments"
              fieldKey="attachments"
              placeholder="" 
              uploadPlaceholder="Upload any other relevant documents for this job order"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        {/* Applications Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Applications for this Job Order
            </Typography>
            <Alert severity="info">
              Applications functionality will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        {/* Placements Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Placements for this Job Order
            </Typography>
            <Alert severity="info">
              Placements functionality will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={4}>
        {/* Notes Tab */}
        <CRMNotesTab
          entityId={jobOrderId || ''}
          entityType={"jobOrder" as any}
          entityName={jobOrder?.jobOrderName || 'Job Order'}
          tenantId={tenantId || ''}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={5}>
        {/* Activity Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Activity Timeline
            </Typography>
            <Alert severity="info">
              Activity tracking will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Action Menu */}

      {/* Manage Contacts Dialog */}
      <ManageContactsDialog
        open={manageContactsOpen}
        onClose={() => setManageContactsOpen(false)}
        tenantId={tenantId || ''}
        currentContacts={associatedContacts}
        onContactsChange={handleContactsChange}
        dealCompanyId={jobOrder?.companyId || company?.id}
      />
     
    </Box>
  );
};

// SectionCard component (matching DealDetails)
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

export default RecruiterJobOrderDetail;
