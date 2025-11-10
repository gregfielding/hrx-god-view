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
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Tooltip,
  Autocomplete
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
  Notes as NotesIcon,
  Add as AddIcon,
  CalendarMonth as CalendarIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/recruiter/jobOrder';
import JobOrderForm from '../components/JobOrderForm';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import ManageContactsDialog from '../components/ManageContactsDialog';
import StaffInstructionCard from '../components/recruiter/StaffInstructionCard';
import ShiftSetupTab from '../components/recruiter/ShiftSetupTab';
import CRMNotesTab from '../components/CRMNotesTab';
import GigJobsBoardToggle from '../components/recruiter/GigJobsBoardToggle';
import PlacementsTab from '../components/recruiter/PlacementsTab';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFavorites } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import { calculateProfileScore, getScoreColor, getScoreLabel } from '../utils/applicantScoring';

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

// ApplicantsTable Component
interface ApplicantsTableProps {
  jobOrderId: string;
  connectedJobPosts: JobsBoardPost[];
  tenantId: string;
  jobOrder: JobOrder | null;
}

interface Applicant {
  uid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  applicationData: any;
  city?: string;
  state?: string;
  workEligibility?: boolean;
  phoneVerified?: boolean;
  appliedAt?: any;
  applicationStatus?: string;
  profileScore?: number;
  fitScore?: number | null;
  // Shift selection (for Gig jobs)
  selectedShifts?: string[];
  shiftAssignments?: Record<string, 'pending' | 'approved' | 'rejected' | 'waitlisted'>;
}

const ApplicantsTable: React.FC<ApplicantsTableProps> = ({ jobOrderId, connectedJobPosts, tenantId, jobOrder }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [statusMenuAnchor, setStatusMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [levelMenuAnchor, setLevelMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [switchJobDialogOpen, setSwitchJobDialogOpen] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
  const [targetJobOrderId, setTargetJobOrderId] = useState('');
  const [availableJobOrders, setAvailableJobOrders] = useState<any[]>([]);
  const [addApplicantDialogOpen, setAddApplicantDialogOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  
  // Favorites hook for starring applicants
  const { isFavorite, toggleFavorite } = useFavorites('users');

  // Fetch available job orders for switching
  useEffect(() => {
    const fetchJobOrders = async () => {
      if (!tenantId) return;
      
      try {
        const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
        const jobOrdersSnapshot = await getDocs(jobOrdersRef);
        const jobOrdersData = jobOrdersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((jo: any) => jo.id !== jobOrderId && jo.status === 'open'); // Exclude current job order and only show open jobs
        
        setAvailableJobOrders(jobOrdersData);
      } catch (error) {
        console.error('Error fetching job orders:', error);
      }
    };

    fetchJobOrders();
  }, [tenantId, jobOrderId]);

  useEffect(() => {
    const fetchApplicants = async () => {
      if (!tenantId || connectedJobPosts.length === 0) {
        setLoading(false);
        return;
      }

      try {
        console.log('🔍 Fetching applicants for connected job posts:', connectedJobPosts.map(p => p.id));

        // Get all job post IDs
        const jobPostIds = connectedJobPosts.map(post => post.id).filter(Boolean);
        
        if (jobPostIds.length === 0) {
          setApplicants([]);
          setLoading(false);
          return;
        }

        // Query users collection for applicants
        // We need to check if applicationData contains any of our job post IDs
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        
        const applicantsData: Applicant[] = [];
        
        usersSnapshot.docs.forEach(doc => {
          const userData = doc.data();
          
        // Check if this user has applied to any of our connected job posts OR to this job order directly
        if (userData.applicationData) {
          const applicationEntries = Object.entries(userData.applicationData);
          
          for (const [applicationId, application] of applicationEntries) {
            const appData = application as any;
            
            // Check if this application is for one of our connected job posts OR for this job order
            const matchesJobPost = appData.jobId && jobPostIds.includes(appData.jobId);
            const matchesJobOrder = appData.jobOrderId === jobOrderId;
            
            if (matchesJobPost || matchesJobOrder) {
              // Calculate Profile Score (instant, free)
              const profileScore = calculateProfileScore(userData);
              
              // Get cached Fit Score from application data (if exists)
              const fitScore = appData.scores?.fitScore ?? null;
              
              applicantsData.push({
                uid: doc.id,
                displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                email: userData.email || '',
                phone: userData.phone || userData.phoneE164 || '',
                avatar: userData.avatar,
                applicationData: appData,
                city: userData.city || userData.addressInfo?.city || '',
                state: userData.state || userData.addressInfo?.state || '',
                workEligibility: userData.workEligibility || false,
                phoneVerified: userData.phoneVerified || false,
                appliedAt: appData.appliedAt,
                applicationStatus: appData.status || 'submitted',
                profileScore,
                fitScore,
                // Shift selection (for Gig jobs)
                selectedShifts: appData.selectedShifts || [],
                shiftAssignments: appData.shiftAssignments || {}
              });
              break; // Only add each user once, even if they applied to multiple connected posts
            }
          }
        }
        });

        // Sort by application date (most recent first)
        applicantsData.sort((a, b) => {
          const dateA = a.appliedAt?.toDate ? a.appliedAt.toDate() : new Date(0);
          const dateB = b.appliedAt?.toDate ? b.appliedAt.toDate() : new Date(0);
          return dateB.getTime() - dateA.getTime();
        });

        console.log('🔍 Found applicants:', applicantsData.length);
        setApplicants(applicantsData);
      } catch (error) {
        console.error('Error fetching applicants:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchApplicants();
  }, [jobOrderId, connectedJobPosts, tenantId]);

  const handleViewApplicant = (uid: string) => {
    // Open in new tab
    window.open(`/c1/users/${uid}`, '_blank');
  };

  const handleOpenActionMenu = (event: React.MouseEvent<HTMLElement>, applicantUid: string) => {
    setActionMenuAnchor({ ...actionMenuAnchor, [applicantUid]: event.currentTarget });
  };

  const handleCloseActionMenu = (applicantUid: string) => {
    setActionMenuAnchor({ ...actionMenuAnchor, [applicantUid]: null });
  };

  const handleOpenStatusMenu = (event: React.MouseEvent<HTMLElement>, applicantUid: string) => {
    event.stopPropagation();
    setStatusMenuAnchor({ ...statusMenuAnchor, [applicantUid]: event.currentTarget });
  };

  const handleCloseStatusMenu = (applicantUid: string) => {
    setStatusMenuAnchor({ ...statusMenuAnchor, [applicantUid]: null });
  };

  const handleOpenLevelMenu = (event: React.MouseEvent<HTMLElement>, applicantUid: string) => {
    event.stopPropagation();
    setLevelMenuAnchor({ ...levelMenuAnchor, [applicantUid]: event.currentTarget });
  };

  const handleCloseLevelMenu = (applicantUid: string) => {
    setLevelMenuAnchor({ ...levelMenuAnchor, [applicantUid]: null });
  };

  const handleChangeStatus = async (applicant: Applicant, newStatus: string) => {
    try {
      console.log('🔄 Changing application status:', { 
        uid: applicant.uid, 
        applicationId: Object.keys(applicant.applicationData)[0],
        oldStatus: applicant.applicationStatus,
        newStatus 
      });

      // Find the application ID from applicationData
      const applicationId = Object.keys(applicant.applicationData)[0] || 
        `${tenantId}_${applicant.applicationData.jobId}`;

      // Update the status in the user's applicationData
      const userRef = doc(db, 'users', applicant.uid);
      await updateDoc(userRef, {
        [`applicationData.${applicationId}.status`]: newStatus,
        [`applicationData.${applicationId}.updatedAt`]: new Date()
      });

      // TODO: Log activity
      console.log('✅ Application status updated to:', newStatus);

      // Update local state
      setApplicants(prev => 
        prev.map(a => 
          a.uid === applicant.uid 
            ? { ...a, applicationStatus: newStatus }
            : a
        )
      );

      handleCloseStatusMenu(applicant.uid);
    } catch (error) {
      console.error('❌ Error changing application status:', error);
    }
  };

  const handleChangeLevel = async (applicant: Applicant, newLevel: 'applicant' | 'candidate') => {
    try {
      console.log('🔄 Changing applicant level:', { 
        uid: applicant.uid, 
        oldLevel: applicant.applicationData?.candidateStatus ? 'candidate' : 'applicant',
        newLevel 
      });

      // Find the application ID
      const applicationId = Object.keys(applicant.applicationData)[0] || 
        `${tenantId}_${applicant.applicationData.jobId}`;

      const isCandidateNow = newLevel === 'candidate';

      // Update the candidateStatus in the user's applicationData
      const userRef = doc(db, 'users', applicant.uid);
      const updateData: any = {
        [`applicationData.${applicationId}.candidateStatus`]: isCandidateNow,
        [`applicationData.${applicationId}.updatedAt`]: new Date()
      };

      if (isCandidateNow) {
        updateData[`applicationData.${applicationId}.vettedBy`] = user?.uid;
        updateData[`applicationData.${applicationId}.vettedAt`] = new Date();
      }

      await updateDoc(userRef, updateData);

      // TODO: Log activity
      console.log(`✅ Level changed to ${newLevel}`);

      // Update local state
      setApplicants(prev => 
        prev.map(a => 
          a.uid === applicant.uid 
            ? { ...a, applicationData: { ...a.applicationData, candidateStatus: isCandidateNow } }
            : a
        )
      );

      handleCloseLevelMenu(applicant.uid);
    } catch (error) {
      console.error('❌ Error changing level:', error);
    }
  };

  const handleMarkAsCandidate = async (applicant: Applicant) => {
    // Reuse the new handleChangeLevel function
    await handleChangeLevel(applicant, 'candidate');
    handleCloseActionMenu(applicant.uid);
  };

  const handleRemoveApplication = async (applicant: Applicant) => {
    if (!confirm(`Are you sure you want to remove ${applicant.displayName}'s application?`)) {
      return;
    }

    try {
      console.log('🗑️ Removing application for:', applicant.uid);

      // Get the user's full application data map
      const userRef = doc(db, 'users', applicant.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.error('User document not found');
        return;
      }
      
      const userData = userDoc.data();
      const allApplicationData = userData.applicationData || {};
      
      // Find the correct application ID for this job
      let applicationIdToRemove: string | null = null;
      
      for (const [appId, appData] of Object.entries(allApplicationData)) {
        const app = appData as any;
        // Match by jobId or jobOrderId
        if (
          (app.jobId && connectedJobPosts.some(post => post.id === app.jobId)) ||
          app.jobOrderId === jobOrderId
        ) {
          applicationIdToRemove = appId;
          break;
        }
      }
      
      if (!applicationIdToRemove) {
        console.error('Could not find application to remove');
        alert('Error: Could not find application data');
        return;
      }
      
      console.log('Removing application ID:', applicationIdToRemove);

      // Remove the application from the map
      const updatedApplicationData = { ...allApplicationData };
      delete updatedApplicationData[applicationIdToRemove];

      // Also remove from applicationIds array
      const currentApplicationIds = userData.applicationIds || [];
      const updatedApplicationIds = currentApplicationIds.filter((id: string) => id !== applicationIdToRemove);

      await updateDoc(userRef, {
        applicationData: updatedApplicationData,
        applicationIds: updatedApplicationIds,
        updatedAt: serverTimestamp()
      });

      // Also delete from tenant's applications collection if it exists
      try {
        const tenantAppId = `${applicant.uid}_${applicant.applicationData.jobId}`;
        const tenantAppRef = doc(db, 'tenants', tenantId, 'applications', tenantAppId);
        const tenantAppDoc = await getDoc(tenantAppRef);
        
        if (tenantAppDoc.exists()) {
          await updateDoc(tenantAppRef, {
            status: 'deleted',
            deletedAt: serverTimestamp(),
            deletedBy: user?.uid,
            updatedAt: serverTimestamp()
          });
          console.log('✅ Tenant application marked as deleted');
        }
      } catch (tenantAppErr) {
        console.warn('Could not update tenant application:', tenantAppErr);
        // Don't fail the whole operation if this fails
      }

      console.log('✅ Application removed completely');

      // Update local state
      setApplicants(prev => prev.filter(a => a.uid !== applicant.uid));

      handleCloseActionMenu(applicant.uid);
    } catch (error) {
      console.error('❌ Error removing application:', error);
      alert('Error removing application. Please try again.');
    }
  };

  const handleOpenSwitchJobDialog = (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setSwitchJobDialogOpen(true);
    setTargetJobOrderId('');
    handleCloseActionMenu(applicant.uid);
  };

  const handleCloseSwitchJobDialog = () => {
    setSwitchJobDialogOpen(false);
    setSelectedApplicant(null);
    setTargetJobOrderId('');
  };

  const handleSwitchJob = async () => {
    if (!selectedApplicant || !targetJobOrderId) return;

    try {
      console.log('🔄 Switching applicant to different job:', {
        applicant: selectedApplicant.displayName,
        fromJobOrder: jobOrderId,
        toJobOrder: targetJobOrderId
      });

      // Get the target job order details
      const targetJobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', targetJobOrderId);
      const targetJobOrderDoc = await getDoc(targetJobOrderRef);
      
      if (!targetJobOrderDoc.exists()) {
        alert('Target job order not found');
        return;
      }

      const targetJobOrder = targetJobOrderDoc.data();

      // Get the user document to find the correct application ID
      const userRef = doc(db, 'users', selectedApplicant.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        alert('User not found');
        return;
      }

      const userData = userDoc.data();
      const applicationData = userData.applicationData || {};
      
      // Find the application that matches this job order
      let targetApplicationId: string | null = null;
      for (const [appId, appData] of Object.entries(applicationData)) {
        const app = appData as any;
        if (app.jobOrderId === jobOrderId || app.jobId === selectedApplicant.applicationData.jobId) {
          targetApplicationId = appId;
          break;
        }
      }

      if (!targetApplicationId) {
        console.error('Could not find application to switch');
        alert('Could not find application to switch');
        return;
      }

      console.log('🔍 Found application to switch:', targetApplicationId);

      // Create a unique application ID for the new job order
      const newApplicationId = `${tenantId}_${targetJobOrderId}_${Date.now()}`;
      
      // Create a new application entry for the target job order
      const newApplicationData = {
        applicationId: newApplicationId,
        jobId: null, // No specific job post, this is a switched application
        jobOrderId: targetJobOrderId,
        jobOrderName: targetJobOrder.jobOrderName || '',
        jobTitle: targetJobOrder.jobTitle || '',
        companyId: targetJobOrder.companyId || '',
        companyName: targetJobOrder.companyName || '',
        location: targetJobOrder.worksiteName || '',
        payRate: targetJobOrder.payRate || 0,
        startDate: targetJobOrder.startDate || null,
        status: 'submitted',
        candidateStatus: false,
        appliedAt: new Date(),
        updatedAt: new Date(),
        source: 'job_switch',
        switchedFrom: jobOrderId,
        switchedFromApplicationId: targetApplicationId,
        switchedAt: new Date(),
        switchedBy: user?.uid
      };

      // Remove old application and add new one
      const updatedApplicationData = { ...applicationData };
      delete updatedApplicationData[targetApplicationId];
      updatedApplicationData[newApplicationId] = newApplicationData;

      // Update the user document
      await updateDoc(userRef, {
        applicationData: updatedApplicationData,
        updatedAt: new Date()
      });

      // TODO: Log activity
      console.log('✅ Application switched to different job');

      // Remove from current list
      setApplicants(prev => prev.filter(a => a.uid !== selectedApplicant.uid));

      handleCloseSwitchJobDialog();
    } catch (error) {
      console.error('❌ Error switching job:', error);
      alert('Error switching job. Please try again.');
    }
  };

  const handleOpenAddApplicantDialog = async () => {
    setAddApplicantDialogOpen(true);
    setLoadingUsers(true);
    
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const users: any[] = [];
      
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        
        // Check if user belongs to this tenant
        if (!userData.tenantIds || !userData.tenantIds[tenantId]) return;
        
        const tenantData = userData.tenantIds[tenantId];
        const securityLevel = parseInt(tenantData.securityLevel || userData.securityLevel || '0');
        
        // Only include users with securityLevel 2 or 3 (Applicants and Candidates)
        if (securityLevel !== 2 && securityLevel !== 3) return;
        
        // If job order has userGroup restrictions, only show members of those groups
        if (jobOrder?.restrictedGroups && jobOrder.restrictedGroups.length > 0) {
          const userGroupIds = userData.userGroupIds || [];
          const hasMatchingGroup = jobOrder.restrictedGroups.some(groupId => 
            userGroupIds.includes(groupId)
          );
          
          if (!hasMatchingGroup) return;
        }
        
        // Don't include users who already applied
        const alreadyApplied = applicants.some(a => a.uid === doc.id);
        if (alreadyApplied) return;
        
        users.push({
          uid: doc.id,
          displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
          email: userData.email || '',
          securityLevel,
          city: userData.city || userData.addressInfo?.city || '',
          state: userData.state || userData.addressInfo?.state || ''
        });
      });
      
      // Sort by name
      users.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      console.log(`🔍 Found ${users.length} eligible users to add as applicants`);
      setAvailableUsers(users);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCloseAddApplicantDialog = () => {
    setAddApplicantDialogOpen(false);
    setSelectedUserId('');
  };

  const handleAddApplicant = async () => {
    if (!selectedUserId || !jobOrder) return;
    
    try {
      console.log('➕ Adding applicant manually:', selectedUserId);
      
      // Get the first connected job post to use as the jobId
      const jobId = connectedJobPosts[0]?.id || `manual_${Date.now()}`;
      const applicationId = `${tenantId}_${jobId}`;
      
      // Create application data
      const applicationData = {
        applicationId,
        jobId,
        jobOrderId: jobOrderId,
        jobOrderName: jobOrder.jobOrderName || '',
        jobTitle: jobOrder.jobTitle || '',
        postTitle: jobOrder.jobOrderName || '',
        companyId: jobOrder.companyId || '',
        companyName: jobOrder.companyName || '',
        location: jobOrder.worksiteName || '',
        payRate: jobOrder.payRate || 0,
        startDate: jobOrder.startDate || null,
        status: 'submitted',
        candidateStatus: false,
        appliedAt: new Date(),
        updatedAt: new Date(),
        source: 'manual_add',
        addedBy: user?.uid
      };
      
      // Update user document
      const userRef = doc(db, 'users', selectedUserId);
      await updateDoc(userRef, {
        [`applicationData.${applicationId}`]: applicationData,
        updatedAt: new Date()
      });
      
      // TODO: Log activity
      console.log('✅ Applicant added manually');
      
      // Refresh applicants list - re-fetch to get Firestore Timestamp
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const savedApplicationData = userData.applicationData?.[applicationId];
        
        // Calculate Profile Score
        const profileScore = calculateProfileScore(userData);
        const fitScore = savedApplicationData?.scores?.fitScore ?? null;
        
        const newApplicant: Applicant = {
          uid: selectedUserId,
          displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || '',
          phone: userData.phone || userData.phoneE164 || '',
          avatar: userData.avatar,
          applicationData: savedApplicationData,
          city: userData.city || userData.addressInfo?.city || '',
          state: userData.state || userData.addressInfo?.state || '',
          workEligibility: userData.workEligibility || false,
          phoneVerified: userData.phoneVerified || false,
          appliedAt: savedApplicationData?.appliedAt,
          applicationStatus: 'submitted',
          profileScore,
          fitScore
        };
        
        setApplicants(prev => [newApplicant, ...prev]);
      }
      
      handleCloseAddApplicantDialog();
    } catch (error) {
      console.error('❌ Error adding applicant:', error);
      alert('Error adding applicant. Please try again.');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (connectedJobPosts.length === 0) {
    return (
      <Card>
        <CardContent>
          <Alert severity="info">
            No job posts are connected to this job order. Create a job post to start receiving applications.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (applicants.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Applications
          </Typography>
          <Alert severity="info">
            No applications received yet for this job order.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader 
          title={`Applications (${applicants.length})`}
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenAddApplicantDialog}
            >
              Add Applicant
            </Button>
          }
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        />
        <CardContent sx={{ p: 0 }}>
          <TableContainer>
            <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ width: 60 }}></TableCell>
                <TableCell>Applicant</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Applied</TableCell>
                <TableCell>Profile</TableCell>
                <TableCell>Fit</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Level</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {applicants.map((applicant) => (
                <TableRow 
                  key={applicant.uid}
                  hover
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell sx={{ py: 1 }}>
                    <FavoriteButton
                      itemId={applicant.uid}
                      favoriteType="users"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      showTooltip={true}
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites'
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar 
                        src={applicant.avatar} 
                        alt={applicant.displayName}
                        sx={{ width: 40, height: 40 }}
                      >
                        {applicant.firstName?.[0]}{applicant.lastName?.[0]}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {applicant.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {applicant.applicationData?.jobTitle || 'N/A'}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{applicant.email}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {applicant.phone}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {applicant.city && applicant.state 
                        ? `${applicant.city}, ${applicant.state}`
                        : applicant.city || applicant.state || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {applicant.appliedAt 
                        ? (() => {
                            try {
                              // Handle Firestore Timestamp
                              if (applicant.appliedAt.toDate && typeof applicant.appliedAt.toDate === 'function') {
                                return formatDistanceToNow(applicant.appliedAt.toDate(), { addSuffix: true });
                              }
                              // Handle Date object
                              if (applicant.appliedAt instanceof Date) {
                                return formatDistanceToNow(applicant.appliedAt, { addSuffix: true });
                              }
                              // Handle timestamp number or string
                              const date = new Date(applicant.appliedAt);
                              if (!isNaN(date.getTime())) {
                                return formatDistanceToNow(date, { addSuffix: true });
                              }
                              return '-';
                            } catch (error) {
                              console.error('Error formatting appliedAt:', error, applicant.appliedAt);
                              return '-';
                            }
                          })()
                        : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Profile completeness score based on resume, skills, work history, and engagement">
                      <Chip 
                        label={getScoreLabel(applicant.profileScore)}
                        size="small"
                        color={getScoreColor(applicant.profileScore)}
                        sx={{ minWidth: 50, fontWeight: 600 }}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {applicant.fitScore !== null && applicant.fitScore !== undefined ? (
                      <Tooltip title="AI-powered job fit score based on skills, experience, and qualifications">
                        <Chip 
                          label={getScoreLabel(applicant.fitScore)}
                          size="small"
                          color={getScoreColor(applicant.fitScore)}
                          sx={{ minWidth: 50, fontWeight: 600 }}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title={
                        (applicant.profileScore ?? 0) >= 40 
                          ? "Fit score will be calculated automatically" 
                          : "Complete profile to 40% to enable fit scoring"
                      }>
                        <Chip 
                          label="..."
                          size="small"
                          variant="outlined"
                          sx={{ minWidth: 50, opacity: 0.5 }}
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={applicant.applicationStatus || 'submitted'}
                      size="small"
                      color={
                        applicant.applicationStatus === 'accepted' ? 'success' :
                        applicant.applicationStatus === 'rejected' ? 'error' :
                        applicant.applicationStatus === 'waitlisted' ? 'warning' :
                        'default'
                      }
                      onClick={(e) => handleOpenStatusMenu(e, applicant.uid)}
                      sx={{ cursor: 'pointer' }}
                    />
                    <Menu
                      anchorEl={statusMenuAnchor[applicant.uid]}
                      open={Boolean(statusMenuAnchor[applicant.uid])}
                      onClose={() => handleCloseStatusMenu(applicant.uid)}
                    >
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'submitted')}>
                        Submitted
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'accepted')}>
                        Accepted
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'waitlisted')}>
                        Waitlisted
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'rejected')}>
                        Rejected
                      </MenuItem>
                    </Menu>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={applicant.applicationData?.candidateStatus ? '⭐ Candidate' : 'Applicant'}
                      size="small"
                      color={applicant.applicationData?.candidateStatus ? 'primary' : 'default'}
                      onClick={(e) => handleOpenLevelMenu(e, applicant.uid)}
                      sx={{ 
                        cursor: 'pointer',
                        fontWeight: applicant.applicationData?.candidateStatus ? 600 : 400
                      }}
                    />
                    <Menu
                      anchorEl={levelMenuAnchor[applicant.uid]}
                      open={Boolean(levelMenuAnchor[applicant.uid])}
                      onClose={() => handleCloseLevelMenu(applicant.uid)}
                    >
                      <MenuItem onClick={() => handleChangeLevel(applicant, 'applicant')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PersonIcon fontSize="small" />
                          Applicant
                        </Box>
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeLevel(applicant, 'candidate')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CheckCircleIcon fontSize="small" />
                          ⭐ Candidate
                        </Box>
                      </MenuItem>
                    </Menu>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => handleOpenActionMenu(e, applicant.uid)}
                    >
                      <MoreVertIcon />
                    </IconButton>
                    <Menu
                      anchorEl={actionMenuAnchor[applicant.uid]}
                      open={Boolean(actionMenuAnchor[applicant.uid])}
                      onClose={() => handleCloseActionMenu(applicant.uid)}
                    >
                      <MenuItem onClick={() => { handleViewApplicant(applicant.uid); handleCloseActionMenu(applicant.uid); }}>
                        <PersonIcon fontSize="small" sx={{ mr: 1 }} />
                        View Profile
                      </MenuItem>
                      {!applicant.applicationData?.candidateStatus && (
                        <MenuItem onClick={() => handleMarkAsCandidate(applicant)}>
                          <CheckCircleIcon fontSize="small" sx={{ mr: 1 }} />
                          Mark as Candidate
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => handleOpenSwitchJobDialog(applicant)}>
                        <WorkIcon fontSize="small" sx={{ mr: 1 }} />
                        Switch to Different Job
                      </MenuItem>
                      <MenuItem 
                        onClick={() => handleRemoveApplication(applicant)}
                        sx={{ color: 'error.main' }}
                      >
                        <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
                        Remove Application
                      </MenuItem>
                    </Menu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>

    {/* Switch Job Dialog */}
    <Dialog 
      open={switchJobDialogOpen} 
      onClose={handleCloseSwitchJobDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Switch to Different Job Order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">
            Switching {selectedApplicant?.displayName}'s application to a different job order.
          </Alert>
          <FormControl fullWidth>
            <InputLabel>Target Job Order</InputLabel>
            <Select
              value={targetJobOrderId}
              onChange={(e) => setTargetJobOrderId(e.target.value)}
              label="Target Job Order"
            >
              {availableJobOrders.map((jo: any) => (
                <MenuItem key={jo.id} value={jo.id}>
                  {jo.jobOrderName || jo.jobTitle} - {jo.companyName} ({jo.status})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseSwitchJobDialog}>Cancel</Button>
        <Button 
          onClick={handleSwitchJob} 
          variant="contained"
          disabled={!targetJobOrderId}
        >
          Switch Job
        </Button>
      </DialogActions>
    </Dialog>

    {/* Add Applicant Dialog */}
    <Dialog 
      open={addApplicantDialogOpen} 
      onClose={handleCloseAddApplicantDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Add Applicant to Job Order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">
            {jobOrder?.restrictedGroups && jobOrder.restrictedGroups.length > 0
              ? 'This job order is restricted to specific user groups. Only eligible users are shown.'
              : 'Select an applicant or candidate to add to this job order.'}
          </Alert>
          {loadingUsers ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <FormControl fullWidth>
              <InputLabel>Select User</InputLabel>
              <Select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                label="Select User"
              >
                {availableUsers.length === 0 ? (
                  <MenuItem disabled>No eligible users found</MenuItem>
                ) : (
                  availableUsers.map((u: any) => (
                    <MenuItem key={u.uid} value={u.uid}>
                      {u.displayName} - {u.email} {u.city && u.state ? `(${u.city}, ${u.state})` : ''}
                      {u.securityLevel === 3 && ' ⭐ Candidate'}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseAddApplicantDialog}>Cancel</Button>
        <Button 
          onClick={handleAddApplicant} 
          variant="contained"
          disabled={!selectedUserId || loadingUsers}
        >
          Add Applicant
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
};

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
  
  // Persist active tab in localStorage
  const getStoredTab = () => {
    if (!jobOrderId) return 0;
    try {
      const stored = localStorage.getItem(`recruiter_job_order_tab_${jobOrderId}`);
      return stored ? parseInt(stored, 10) : 0;
    } catch {
      return 0;
    }
  };
  
  const [activeTab, setActiveTab] = useState(getStoredTab());
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [recruiterUsers, setRecruiterUsers] = useState<Array<{id: string; displayName: string; email?: string}>>([]);
  
  // Reload stored tab when jobOrderId changes
  useEffect(() => {
    if (jobOrderId) {
      try {
        const stored = localStorage.getItem(`recruiter_job_order_tab_${jobOrderId}`);
        const storedTab = stored ? parseInt(stored, 10) : 0;
        setActiveTab(storedTab);
      } catch {
        setActiveTab(0);
      }
    }
  }, [jobOrderId]);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [connectedJobPosts, setConnectedJobPosts] = useState<JobsBoardPost[]>([]);
  const [manageContactsOpen, setManageContactsOpen] = useState(false);
  const [manageRecruitersOpen, setManageRecruitersOpen] = useState(false);
  const [availableRecruiters, setAvailableRecruiters] = useState<Array<{id: string; displayName: string; email?: string}>>([]);
  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState<string[]>([]);
  const [loadingRecruiters, setLoadingRecruiters] = useState(false);
  const [shifts, setShifts] = useState<any[]>([]);

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

  // Load shifts for Gig jobs
  useEffect(() => {
    const fetchShifts = async () => {
      if (!jobOrder || !jobOrderId || !tenantId || (jobOrder as any).jobType !== 'gig') {
        setShifts([]);
        return;
      }

      try {
        // Use tenant/job_order subcollection path
        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
        const q = query(shiftsRef);
        const snapshot = await getDocs(q);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Format as YYYY-MM-DD in local timezone (not UTC)
        const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const shiftsData = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data(), shiftDate: doc.data().shiftDate }))
          .filter((shift: any) => shift.shiftDate >= todayISO)
          .sort((a: any, b: any) => a.shiftDate.localeCompare(b.shiftDate));
        
        setShifts(shiftsData);
      } catch (error) {
        console.error('Error fetching shifts:', error);
        setShifts([]);
      }
    };

    fetchShifts();
  }, [jobOrder, jobOrderId, tenantId]);

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
                              (u.email ? String(u.email).split('@')[0] : 'Recruiter');
          results.push({ id: d.id, displayName, email: u.email });
        });
      }
      setRecruiterUsers(results);
    } catch (error) {
      console.error('Error loading assigned recruiters:', error);
      setRecruiterUsers([]);
    }
  };

  // Load available recruiters (users with security level 5-7 or recruiter access)
  const loadAvailableRecruiters = async () => {
    if (!tenantId) return;
    
    setLoadingRecruiters(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const recruiters: Array<{id: string; displayName: string; email?: string}> = [];
      
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        
        // Check if user belongs to this tenant
        if (!userData.tenantIds || !userData.tenantIds[tenantId]) return;
        
        const tenantData = userData.tenantIds[tenantId];
        const securityLevel = parseInt(tenantData.securityLevel || userData.securityLevel || '0');
        
        // Include users with security level 5-7 (internal team) or users with recruiter access
        const hasRecruiterAccess = tenantData.recruiter || userData.recruiter || false;
        const isInternalTeam = securityLevel >= 5 && securityLevel <= 7;
        
        if (!isInternalTeam && !hasRecruiterAccess) return;
        
        const displayName = (userData.firstName && userData.lastName ? `${userData.firstName} ${userData.lastName}`.trim() : '') ||
                            userData.displayName ||
                            (userData.email ? String(userData.email).split('@')[0] : 'Recruiter');
        
        recruiters.push({
          id: doc.id,
          displayName,
          email: userData.email
        });
      });
      
      // Sort by name
      recruiters.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      setAvailableRecruiters(recruiters);
    } catch (error) {
      console.error('Error loading available recruiters:', error);
      setAvailableRecruiters([]);
    } finally {
      setLoadingRecruiters(false);
    }
  };

  // Handle opening manage recruiters dialog
  const handleOpenManageRecruiters = () => {
    if (jobOrder?.assignedRecruiters) {
      setSelectedRecruiterIds([...jobOrder.assignedRecruiters]);
    } else {
      setSelectedRecruiterIds([]);
    }
    loadAvailableRecruiters();
    setManageRecruitersOpen(true);
  };

  // Handle saving assigned recruiters
  const handleSaveRecruiters = async () => {
    if (!jobOrderId || !tenantId) return;
    
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await updateDoc(jobOrderRef, {
        assignedRecruiters: selectedRecruiterIds,
        updatedAt: serverTimestamp()
      });
      
      // Update local state
      setJobOrder(prev => prev ? { ...prev, assignedRecruiters: selectedRecruiterIds } : null);
      
      // Reload recruiter users for display
      if (selectedRecruiterIds.length > 0) {
        await loadAssignedRecruiters(selectedRecruiterIds);
      } else {
        setRecruiterUsers([]);
      }
      
      setManageRecruitersOpen(false);
    } catch (error) {
      console.error('Error saving assigned recruiters:', error);
      alert('Failed to save assigned recruiters. Please try again.');
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
                
                {/* For Gig jobs, show Next Shift Date; for Career jobs, show Start Date */}
                {(jobOrder as any).jobType === 'gig' ? (
                  shifts.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Next Shift:</Typography>
                      <Chip
                        label={format(new Date(shifts[0].shiftDate), 'MMM dd, yyyy')}
                        color="default"
                        size="small"
                      />
                    </Box>
                  )
                ) : (
                  jobOrder.startDate && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Start Date:</Typography>
                      <Chip
                        label={format(safeToDate(jobOrder.startDate), 'MMM dd, yyyy')}
                        color="default"
                        size="small"
                      />
                    </Box>
                  )
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
                      {connectedJobPosts.map((post, index) => {
                        // For Gig jobs, link to public jobs board; for Career jobs, link to admin edit page
                        const postUrl = jobOrder?.jobType === 'gig' 
                          ? `/c1/jobs-board/${post.id}`
                          : `/jobs-dashboard/edit/${post.id}`;
                        
                        return (
                          <Box key={post.id || index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <MUILink
                              underline="hover"
                              color="primary"
                              href={postUrl}
                              onClick={(e) => { 
                                e.preventDefault(); 
                                navigate(postUrl); 
                              }}
                              sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                              {...(jobOrder?.jobType === 'gig' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                            >
                              {post.postTitle}
                            </MUILink>
                            {index < connectedJobPosts.length - 1 && (
                              <Typography variant="body2" color="text.secondary">•</Typography>
                            )}
                          </Box>
                        );
                      })}
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
          onChange={(_, newValue) => {
            setActiveTab(newValue);
            // Persist tab selection
            if (jobOrderId) {
              try {
                localStorage.setItem(`recruiter_job_order_tab_${jobOrderId}`, String(newValue));
              } catch (error) {
                console.warn('Failed to persist tab selection:', error);
              }
            }
          }}
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
                <CalendarIcon fontSize="small" />
                Shift Setup
              </Box>
            } 
          />
          {jobOrder?.jobType === 'gig' && (
            <Tab 
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <VisibilityIcon fontSize="small" />
                  Job Board Visibility
                </Box>
              } 
            />
          )}
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

              {/* Assigned Recruiters Widget */}
              <SectionCard title="Assigned Recruiters" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleOpenManageRecruiters}
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
                {recruiterUsers.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {recruiterUsers.map((recruiter) => (
                      <Box
                        key={recruiter.id}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                        onClick={() => navigate(`/recruiter/users/${recruiter.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/recruiter/users/${recruiter.id}`); } }}
                      >
                        <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                          {recruiter.displayName?.charAt(0) || 'R'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="medium">
                            {recruiter.displayName || 'Unknown Recruiter'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {recruiter.email || 'No email'}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No recruiters assigned
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
        {/* Shift Setup Tab */}
        <ShiftSetupTab 
          tenantId={tenantId}
          jobOrderId={jobOrderId || ''}
          jobOrder={jobOrder}
        />
      </TabPanel>

      {/* Job Board Visibility Tab - Only for Gig jobs */}
      {jobOrder?.jobType === 'gig' && (
        <TabPanel value={activeTab} index={3}>
          <Box sx={{ maxWidth: 800, mx: 'auto', mt: 3 }}>
            <GigJobsBoardToggle
              jobOrder={jobOrder}
              onPostUpdated={(post) => {
                if (post) {
                  loadConnectedJobPosts(jobOrder.id);
                }
              }}
            />
          </Box>
        </TabPanel>
      )}

      <TabPanel value={activeTab} index={jobOrder?.jobType === 'gig' ? 4 : 3}>
        {/* Applications Tab */}
        <ApplicantsTable 
          jobOrderId={jobOrderId || ''} 
          connectedJobPosts={connectedJobPosts}
          tenantId={tenantId || ''}
          jobOrder={jobOrder}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={jobOrder?.jobType === 'gig' ? 5 : 4}>
        {/* Placements Tab */}
        <PlacementsTab
          tenantId={tenantId || ''}
          jobOrderId={jobOrderId || ''}
          jobOrder={jobOrder}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={jobOrder?.jobType === 'gig' ? 6 : 5}>
        {/* Notes Tab */}
        <CRMNotesTab
          entityId={jobOrderId || ''}
          entityType={"jobOrder" as any}
          entityName={jobOrder?.jobOrderName || 'Job Order'}
          tenantId={tenantId || ''}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={jobOrder?.jobType === 'gig' ? 7 : 6}>
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

      {/* Manage Recruiters Dialog */}
      <Dialog
        open={manageRecruitersOpen}
        onClose={() => setManageRecruitersOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Assign Recruiters</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Alert severity="info">
              Select one or more recruiters to assign to this job order. Recruiters can be internal team members (security levels 5-7) or users with recruiter access.
            </Alert>
            {loadingRecruiters ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Autocomplete
                multiple
                options={availableRecruiters}
                getOptionLabel={(option) => option.displayName || option.email || 'Unknown'}
                value={availableRecruiters.filter(r => selectedRecruiterIds.includes(r.id))}
                onChange={(_, newValue) => {
                  setSelectedRecruiterIds(newValue.map(r => r.id));
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Recruiters"
                    placeholder="Choose recruiters..."
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      label={option.displayName || option.email || 'Unknown'}
                      {...getTagProps({ index })}
                      key={option.id}
                    />
                  ))
                }
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageRecruitersOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSaveRecruiters} 
            variant="contained"
            disabled={loadingRecruiters}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

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
