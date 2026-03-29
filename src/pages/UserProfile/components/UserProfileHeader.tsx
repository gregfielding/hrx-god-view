import React, { useRef, useState, useEffect } from 'react';
import { toChipLabel } from '../../../utils/chipLabel';
import { Box, Avatar, IconButton, Button, Typography, Stack, Link, Chip, Breadcrumbs, Tooltip, CircularProgress, Snackbar, Alert, Badge, GlobalStyles, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { keyframes } from '@emotion/react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, getDoc, updateDoc, collection, getDocs, query } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import MessageIcon from '@mui/icons-material/Message';
import DescriptionIcon from '@mui/icons-material/Description';
import NoteIcon from '@mui/icons-material/Note';
import BusinessIcon from '@mui/icons-material/Business';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import PersonIcon from '@mui/icons-material/Person';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PublicIcon from '@mui/icons-material/Public';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import InsightsIcon from '@mui/icons-material/Insights';

import { storage, db } from '../../../firebase'; // adjust path
import { getScoreColor, getScoreLabel } from '../../../utils/applicantScoring';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import FavoriteButton from '../../../components/FavoriteButton';
import { useFavorites } from '../../../hooks/useFavorites';
import { useAuth } from '../../../contexts/AuthContext';
import DocumentIconBar from './DocumentIconBar';
import CertificationsModal from './CertificationsModal';
import ContactActionButtons from './ContactActionButtons';
import MessageDrawer, { MessageRecipient } from '../../../components/MessageDrawer';
import { functions } from '../../../firebase';
import { httpsCallable } from 'firebase/functions';
import MissingItemsAlert from './MissingItemsAlert';
import QuickActionToolbar from './QuickActionToolbar';
import ComplianceStatusChips from './ComplianceStatusChips';
import ProfileQualityMeter from './ProfileQualityMeter';
import CompactProfileQualityBar from './CompactProfileQualityBar';
import CompactActionGrid from './CompactActionGrid';
import type { ScoreSummary, ScoringDistribution } from '../../../utils/scoreSummary';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { detectMissingItems } from '../utils/detectMissingItems';
import AddUserNoteDialog from './AddUserNoteDialog';
import StartOnboardingDialog from './StartOnboardingDialog';
import { isOnboardingInProgress, getActiveOnboardingType, cancelOnboarding } from '../utils/onboardingHelpers';
import ImageCropDialog from '../../../components/common/ImageCropDialog';

interface UserProfileHeaderProps {
  uid: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void; // callback to update parent state
  showBackButton?: boolean;
  onBack?: () => void;
  jobTitle?: string;
  phone?: string;
  email?: string;
  createdAt?: any;
  city?: string;
  state?: string;
  workStatus?: string;
  securityLevel?: string; // '0'..'7'
  employmentType?: string;
  departmentName?: string;
  locationName?: string;
  divisionName?: string;
  regionName?: string;
  linkedinUrl?: string;
  canEditAvatar?: boolean;
  managerName?: string;
  managerId?: string;
  showBreadcrumbs?: boolean;
  breadcrumbPath?: Array<{ label: string; href?: string }>;
  isAdminView?: boolean; // True if viewer is admin (security >= 5)
  /** True only when staff (security 0–4) views their own record. Guard all staff-self-view-only UI with this so admin view is unchanged. */
  isStaffViewingOwnRecord?: boolean;
  profileScore?: number; // Profile completeness score (0-100)
  scoreSummary?: ScoreSummary;
  scoringDistribution?: ScoringDistribution | null;
  // New props for document access and additional data
  resume?: {
    fileName: string;
    downloadUrl?: string;
    storagePath?: string;
  } | null;
  certifications?: Array<{
    name: string;
    fileUrl?: string;
    fileName?: string;
    issuer?: string;
    dateObtained?: string;
    expirationDate?: string;
    uploadedAt?: Date;
  }>;
  workEligibility?: boolean;
  backgroundCheckStatus?: string;
  vaccinationStatus?: string;
  yearsExperience?: string;
  primarySkills?: string[];
  languages?: string[]; // Array of language strings
  behavioralTraits?: string[]; // Array of behavioral/personality traits
  educationLevel?: string;
  education?: Array<{ degree?: string; [key: string]: any }>;
  workExperience?: Array<{ jobTitle?: string; title?: string; [key: string]: any }>;
  activeApplicationsCount?: number;
  resumeCompleteness?: number;
  onTabChange?: (tabLabel: string) => void; // Callback to change tabs
  eVerifyOrders?: Array<{ id: string; dateSubmitted: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>;
  backgroundCheckOrders?: Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>;
  drugScreeningOrders?: Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>;
  additionalScreeningOrders?: Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>;
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  } | null;
  dateOfBirth?: Date | string | any;
  onAddNote?: () => void;
  onEditProfile?: () => void;
  onSendApplicationLink?: () => void;
  onPrintProfile?: () => void;
  onCreateAssignment?: () => void;
  onCallNow?: () => void;
  onMessageApplicant?: () => void;
  onViewTimeline?: () => void;
  hasPhone?: boolean;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  tenantId?: string;
  onOnboardingStarted?: () => void;
  headerUserGroups?: Array<{ id: string; title: string }>;
}

const UserProfileHeader: React.FC<UserProfileHeaderProps> = ({
  uid,
  firstName,
  lastName,
  preferredName,
  avatarUrl,
  onAvatarUpdated,
  showBackButton,
  onBack,
  jobTitle,
  phone,
  email,
  createdAt,
  city,
  state,
  workStatus,
  securityLevel,
  employmentType,
  departmentName,
  locationName,
  divisionName,
  regionName,
  linkedinUrl,
  canEditAvatar,
  managerName,
  managerId,
  showBreadcrumbs = false,
  breadcrumbPath = [],
  isAdminView = false,
  isStaffViewingOwnRecord = false,
  profileScore,
  scoreSummary,
  scoringDistribution,
  resume,
  certifications = [],
  workEligibility,
  backgroundCheckStatus,
  vaccinationStatus,
  yearsExperience,
  primarySkills = [],
  languages = [],
  behavioralTraits = [],
  educationLevel,
  education = [],
  workExperience = [],
  activeApplicationsCount,
  resumeCompleteness,
  onTabChange,
  eVerifyOrders = [],
  backgroundCheckOrders = [],
  drugScreeningOrders = [],
  additionalScreeningOrders = [],
  emergencyContact,
  dateOfBirth,
  onAddNote,
  onEditProfile,
  onSendApplicationLink,
  onPrintProfile,
  onCreateAssignment,
  onCallNow,
  onMessageApplicant,
  onViewTimeline,
  hasPhone,
  employeeOnboardStatus,
  contractorOnboardStatus,
  tenantId,
  onOnboardingStarted,
  headerUserGroups = [],
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [showCertificationsModal, setShowCertificationsModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showStartOnboardingDialog, setShowStartOnboardingDialog] = useState(false);
  const [showCancelOnboardingDialog, setShowCancelOnboardingDialog] = useState(false);
  const [cancellingOnboarding, setCancellingOnboarding] = useState(false);
  const [notesCount, setNotesCount] = useState<number>(0);
  const { securityLevel: viewerSecurityLevel, tenantId: authTenantId, activeTenant, user } = useAuth();
  const effectiveTenantId = tenantId || authTenantId || activeTenant?.id || '';
  const viewerLevel = parseInt(viewerSecurityLevel || '0');
  const canViewAdminContent = viewerLevel >= 5;
  const canViewUserGroupsInHeader = viewerLevel >= 4;
  const isOwnProfile = !!user?.uid && user.uid === uid;
  // Contact icons row should only show for admin viewers (5-7) and never on a user's own profile.
  const canShowContactIconsRow = !isOwnProfile && viewerLevel >= 5 && viewerLevel <= 7;
  const { isFavorite, toggleFavorite } = useFavorites('users');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [gmailConnected, setGmailConnected] = useState<boolean>(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean>(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [messageDrawerChannel, setMessageDrawerChannel] = useState<'email' | 'sms'>('email');
  
  // Check if onboarding is in progress
  const onboardingInProgress = isOnboardingInProgress(employeeOnboardStatus as any, contractorOnboardStatus as any);
  const activeOnboardingType = getActiveOnboardingType(employeeOnboardStatus as any, contractorOnboardStatus as any);
  
  // Handle cancel onboarding
  const handleCancelOnboarding = async () => {
    if (!activeOnboardingType || !effectiveTenantId) return;
    
    setCancellingOnboarding(true);
    try {
      await cancelOnboarding(uid, effectiveTenantId, activeOnboardingType, user?.uid);
      setShowCancelOnboardingDialog(false);
      
      // Refresh onboarding status
      if (onOnboardingStarted) {
        await onOnboardingStarted();
      }
    } catch (error: any) {
      console.error('Error cancelling onboarding:', error);
      // You could show an error snackbar here if needed
    } finally {
      setCancellingOnboarding(false);
    }
  };
  
  // Keyframe animation for onboarding button - golden shimmer only
  const goldenShimmer = keyframes`
    0%, 100% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  `;
  
  // Animated onboarding button styles - solid golden background with shimmer
  const animatedButtonSx = {
    background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FFD700 100%)',
    backgroundSize: '200% 200%',
    animation: `${goldenShimmer} 3s ease-in-out infinite`,
    color: '#000',
    fontWeight: 600,
  };

  useEffect(() => {
    let mounted = true;

    const checkSmsAccess = async () => {
      if (!effectiveTenantId || !user?.uid) {
        if (mounted) setHasTwilioNumber(false);
        return;
      }

      const level = Number.parseInt(String(viewerSecurityLevel || '0'), 10) || 0;
      if (level >= 5 && level <= 7) {
        if (mounted) setHasTwilioNumber(true);
        return;
      }

      try {
        const recruiterNumberDoc = await getDoc(
          doc(db, 'tenants', effectiveTenantId, 'recruiterNumbers', user.uid)
        );
        const hasNumber =
          recruiterNumberDoc.exists() &&
          !!(recruiterNumberDoc.data()?.twilioNumber || recruiterNumberDoc.data()?.useMainNumber);
        if (mounted) setHasTwilioNumber(!!hasNumber);
      } catch {
        if (mounted) setHasTwilioNumber(false);
      }
    };

    checkSmsAccess();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId, user?.uid, viewerSecurityLevel]);

  // Gmail connection for in-app compose (same logic as UserProfile index record header).
  // Without this, gmailConnected stayed false and the email icon always opened mailto:.
  useEffect(() => {
    let mounted = true;
    const checkGmail = async () => {
      const level = Number.parseInt(String(viewerSecurityLevel || '0'), 10) || 0;
      if (level < 5 || level > 7 || !user?.uid) {
        if (mounted) setGmailConnected(false);
        return;
      }
      try {
        const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');
        const result = await getGmailStatus({ userId: user.uid, force: true });
        const data = result.data as {
          connected?: boolean;
          rateLimited?: boolean;
          sampled?: boolean;
        };
        const connected =
          !!data?.connected || !!data?.rateLimited || !!data?.sampled;
        if (mounted) setGmailConnected(connected);
      } catch {
        try {
          const viewerSnap = await getDoc(doc(db, 'users', user.uid));
          const viewerData: any = viewerSnap.exists() ? viewerSnap.data() : null;
          if (mounted) {
            setGmailConnected(!!viewerData?.gmailTokens?.access_token);
          }
        } catch {
          if (mounted) setGmailConnected(false);
        }
      }
    };
    checkGmail();
    return () => {
      mounted = false;
    };
  }, [user?.uid, viewerSecurityLevel]);

  // Load notes count
  useEffect(() => {
    const loadNotesCount = async () => {
      try {
        const notesRef = collection(db, 'users', uid, 'notes');
        const notesSnapshot = await getDocs(query(notesRef));
        setNotesCount(notesSnapshot.size);
      } catch (error: any) {
        // Silently handle permission errors for lower-level users
        if (error?.code === 'permission-denied' || 
            error?.code === 'PERMISSION_DENIED' || 
            error?.message?.includes('Missing or insufficient permissions')) {
          setNotesCount(0);
        } else {
          console.error('Error loading notes count:', error);
        }
      }
    };

    if (uid) {
      loadNotesCount();
    }
  }, [uid]);

  // Detect missing items
  const missingItems = React.useMemo(() => detectMissingItems(
    {
      workEligibility,
      resume: resume ? {
        ...resume,
        timestamp: (resume as any).timestamp || null,
      } : null,
      certifications,
      emergencyContact,
      backgroundCheckStatus,
      vaccinationStatus,
      phone,
      email,
      dateOfBirth,
    },
    onTabChange
  ), [workEligibility, resume, certifications, emergencyContact, backgroundCheckStatus, vaccinationStatus, phone, email, dateOfBirth, onTabChange]);

  const handleAvatarClick = () => {
    if (!canEditAvatar) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });
        setPendingImageSrc(src);
        setCropOpen(true);
      } catch (err) {
        console.error('❌ Error uploading avatar:', err);
        console.error('Error details:', {
          code: err.code,
          message: err.message,
          stack: err.stack
        });
      }
    }
  };

  const handleConfirmCroppedAvatar = async (blob: Blob) => {
    setAvatarBusy(true);
    try {
      // Check authentication
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');

      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), { avatar: downloadURL });
      onAvatarUpdated(downloadURL);
      setCropOpen(false);
      setPendingImageSrc(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('❌ Error saving cropped avatar:', err);
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      // Prefer deleting by URL (works for both gs:// and https://)
      if (avatarUrl) {
        try {
          await deleteObject(ref(storage, avatarUrl));
        } catch {
          await deleteObject(ref(storage, `avatars/${uid}.jpg`));
        }
      } else {
        await deleteObject(ref(storage, `avatars/${uid}.jpg`));
      }
      await updateDoc(doc(db, 'users', uid), { avatar: '' });
      onAvatarUpdated('');
    } catch (err) {
      console.error('Error deleting avatar:', err);
    }
  };

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  const normalizeLinkedInUrl = (url?: string) => {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  };

  const getSecurityLabel = (lvl?: string) => {
    switch (lvl) {
      case '7': return 'Admin';
      case '6': return 'Manager';
      case '5': return 'Worker';
      case '4': return 'Hired Staff';
      case '3': return 'Flex';
      case '2': return 'Applicant';
      case '1': return 'Dismissed';
      case '0': return 'Suspended';
      default: return undefined;
    }
  };

  const getWorkStatusColor = (
    status?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch ((status || '').toLowerCase()) {
      case 'active': return 'success';
      case 'on leave':
      case 'pending': return 'warning';
      case 'terminated':
      case 'suspended': return 'error';
      default: return 'info';
    }
  };

  const getEmploymentTypeColor = (
    type?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch ((type || '').toLowerCase()) {
      case 'full-time': return 'success';
      case 'part-time': return 'info';
      case 'contract': return 'warning';
      case 'flex': return 'secondary';
      default: return 'default';
    }
  };

  const getEmploymentTypeLabel = (type?: string) => {
    if (!type) return '';
    // Convert "Full-Time" -> "Full Time"
    return String(type).replace(/-/g, ' ');
  };

  const getSecurityColor = (
    lvl?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (lvl) {
      case '7': return 'primary'; // Admin
      case '6': return 'secondary'; // Manager
      case '5': return 'info'; // Worker
      case '4': return 'warning'; // Hired Staff
      case '3': return 'info'; // Flex
      case '2': return 'default'; // Applicant
      case '1': return 'error'; // Dismissed
      case '0': return 'error'; // Suspended
      default: return 'default';
    }
  };

  const getSoftChipSx = (
    color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning',
  ) => {
    switch (color) {
      case 'primary':
        return { bgcolor: 'primary.light', color: 'primary.dark' };
      case 'secondary':
        return { bgcolor: 'secondary.light', color: 'secondary.dark' };
      case 'info':
        return { bgcolor: 'info.light', color: 'info.dark' };
      case 'warning':
        return { bgcolor: 'warning.light', color: 'warning.dark' };
      case 'error':
        return { bgcolor: 'error.light', color: 'error.dark' };
      case 'success':
        return { bgcolor: 'success.light', color: 'success.dark' };
      default:
        return { bgcolor: 'grey.100', color: 'text.primary' };
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (timestamp?.toDate) {
      date = timestamp.toDate();
    } else if (timestamp?._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      return 'N/A';
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Handler for resume click - open resume in new tab
  const handleResumeClick = async () => {
    if (!resume) return;

    try {
      // Try to use downloadUrl if available
      if (resume.downloadUrl) {
        window.open(resume.downloadUrl, '_blank');
        return;
      }

      // Otherwise construct public URL from storagePath
      if (resume.storagePath) {
        const encodedPath = encodeURIComponent(resume.storagePath);
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
        window.open(publicUrl, '_blank');
        return;
      }

      // Fallback: navigate to Resumé tab
      if (onTabChange) {
        onTabChange('Resumé');
      }
    } catch (error) {
      console.error('Error opening resume:', error);
      // Fallback: navigate to Resumé tab
      if (onTabChange) {
        onTabChange('Resumé');
      }
    }
  };

  // Handler for certifications click
  const handleCertificationsClick = () => {
    if (certifications && certifications.length > 0) {
      setShowCertificationsModal(true);
    } else if (onTabChange) {
      onTabChange('Qualifications');
    }
  };

  // Handler for work eligibility click
  const handleWorkEligibilityClick = () => {
    // Work Eligibility tab removed - do nothing
  };

  // Handler for background check click
  const handleBackgroundCheckClick = () => {
    if (onTabChange) {
      onTabChange('Backgrounds');
    }
  };

  // Handler for vaccination click
  const handleVaccinationClick = () => {
    if (onTabChange) {
      onTabChange('Backgrounds');
    }
  };

  return (
    <Box 
      mb={2} 
      sx={{ 
        p: 3,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none'
      }}
    >
      {/* Top Row: Breadcrumbs + Role Chip */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        {showBreadcrumbs && breadcrumbPath.length > 0 && (
          <Breadcrumbs 
            separator={<NavigateNextIcon fontSize="small" />} 
            aria-label="breadcrumb"
            sx={{ flex: 1 }}
          >
            {breadcrumbPath.map((item, index) => (
              item.href ? (
                <Link
                  key={index}
                  component={RouterLink}
                  to={item.href}
                  color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                  underline={index === breadcrumbPath.length - 1 ? "none" : "hover"}
                  sx={{
                    fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                    textDecoration: 'none',
                    '&:hover': {
                      textDecoration: index === breadcrumbPath.length - 1 ? 'none' : 'underline'
                    }
                  }}
                >
                  {item.label}
                </Link>
              ) : (
                <Typography
                  key={index}
                  color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                  sx={{
                    fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                  }}
                >
                  {item.label}
                </Typography>
              )
            ))}
          </Breadcrumbs>
        )}
      </Box>
      
      {/* Mobile Layout */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        {/* Mobile: Avatar + Action Buttons Row */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          justifyContent: 'space-between',
          mb: 2
        }}>
          {/* Avatar */}
          <Box
            position="relative"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <Avatar 
              src={avatarUrl || undefined} 
              sx={{ 
                width: 96, 
                height: 96, 
                fontSize: '2rem',
                fontWeight: 'bold'
              }}
              onError={(e) => {
                console.log('Avatar image failed to load, falling back to initials:', avatarUrl);
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            >
              {!avatarUrl && initials}
            </Avatar>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {canEditAvatar && (
              <Box sx={{ 
                position: 'absolute', 
                bottom: -8, 
                right: -8,
                display: 'flex',
                gap: 0.5
              }}>
                {hover && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarClick}
                    disabled={avatarBusy}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      width: 24,
                      height: 24,
                      '&:hover': {
                        bgcolor: 'grey.400'
                      }
                    }}
                  >
                    <CameraAltIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
                
                {hover && avatarUrl && (
                  <IconButton
                    size="small"
                    onClick={handleDeleteAvatar}
                    disabled={avatarBusy}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      width: 24,
                      height: 24,
                      '&:hover': {
                        bgcolor: 'grey.400'
                      }
                    }}
                  >
                    <ClearIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

          {/* Role Chip and Start Onboarding Button - Mobile */}
          {canViewAdminContent && (
            <Stack direction="column" spacing={0.5} alignItems="flex-end">
              {securityLevel && getSecurityLabel(securityLevel) && (
                <Chip
                  label={getSecurityLabel(securityLevel)}
                  size="small"
                  sx={{
                    ...getSoftChipSx(getSecurityColor(securityLevel)),
                    fontWeight: 600,
                    height: 24,
                    fontSize: '0.75rem',
                    px: 1,
                  }}
                />
              )}
              {isAdminView && (
                onboardingInProgress ? (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => setShowCancelOnboardingDialog(true)}
                    sx={{
                      fontSize: '0.75rem',
                      py: 0.5,
                      px: 1.5,
                      backgroundImage: 'linear-gradient(90deg, #FF8A00 0%, #FFB300 100%)', // Yellow-orange gradient
                      color: '#ffffff', // White text
                      fontWeight: 600,
                      '&:hover': {
                        backgroundImage: 'linear-gradient(90deg, #FB8C00 0%, #FFA000 100%)',
                      },
                    }}
                  >
                    Cancel Onboarding
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{
                      borderColor: 'success.main',
                      color: 'success.main',
                      fontSize: '0.75rem',
                      py: 0.5,
                      px: 1.5,
                      '&:hover': {
                        borderColor: 'success.dark',
                        backgroundColor: 'success.light',
                        color: 'success.dark',
                      },
                    }}
                    onClick={() => {
                      console.log('Start Onboarding clicked - tenantId:', tenantId || authTenantId || activeTenant?.id);
                      setShowStartOnboardingDialog(true);
                    }}
                  >
                    Start Onboarding
                  </Button>
                )
              )}
            </Stack>
          )}
        </Box>

        {/* Mobile: Name and Details */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {`${firstName} ${lastName}`}
                {preferredName && preferredName !== firstName && ` (${preferredName})`}
              </Typography>

              {canViewAdminContent && isAdminView && securityLevel && !['5', '6', '7'].includes(String(securityLevel)) && (
                <FavoriteButton
                  itemId={uid}
                  favoriteType="users"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                  tooltipText={{
                    favorited: 'Remove from favorites',
                    notFavorited: 'Add to favorites',
                  }}
                />
              )}

              {isAdminView && (() => {
                // Stored AI score only — same value as Score tab and users table (no relative scaling)
                const rawSummary = scoreSummary?.aiScore ?? scoreSummary?.qualityScore ?? profileScore;
                if (typeof rawSummary !== 'number' || Number.isNaN(rawSummary)) return null;
                const display = Math.round(rawSummary);
                return (
                  <Tooltip title={`AI Score (stored): ${display}`}>
                    <Chip
                      icon={<InsightsIcon sx={{ fontSize: 18 }} />}
                      label={`AI Score ${display}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 700, flexShrink: 0 }}
                    />
                  </Tooltip>
                );
              })()}
            </Box>
          </Box>
          {Boolean(jobTitle) && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 1 }}>
              {jobTitle}
            </Typography>
          )}

          {/* Mobile: Location */}
          {city && state && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <LocationOnOutlinedIcon fontSize="small" color="primary" />
              <Typography variant="body2" color="text.secondary">
                {city}, {state}
              </Typography>
            </Stack>
          )}

          {/* Mobile: User groups */}
          {canViewUserGroupsInHeader && headerUserGroups.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Member of:{' '}
                {headerUserGroups.map((g, idx) => (
                  <React.Fragment key={g.id}>
                    {idx > 0 ? ', ' : ''}
                    <Link component={RouterLink} to={`/usergroups/${g.id}`} underline="hover">
                      {g.title}
                    </Link>
                  </React.Fragment>
                ))}
              </Typography>
            </Box>
          )}

          {/* Mobile: Joined Date */}
          {createdAt && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', mb: 1 }}>
              Joined: {formatDate(createdAt)}
            </Typography>
          )}

          {/* Mobile: Contact Icons Row */}
          {canShowContactIconsRow && (phone || email || resume) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, mt: 1 }}>
              {phone && (
                <>
                  <Tooltip title={`Call ${formatPhoneNumber(phone)}`}>
                    <IconButton
                      size="small"
                      component="a"
                      href={`tel:${phone.replace(/\D/g, '')}`}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <PhoneOutlinedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                  {onMessageApplicant && (
                    <Tooltip title="Send Message">
                      <IconButton
                        size="small"
                        onClick={onMessageApplicant}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <MessageIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              )}
              {email && (
                <Tooltip
                  title={
                    gmailConnected
                      ? `Email ${email} (send from your Gmail)`
                      : `Email ${email} (open mail app)`
                  }
                >
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (gmailConnected) {
                        setMessageDrawerChannel('email');
                        setMessageDrawerOpen(true);
                      } else {
                        window.open(`mailto:${email}`, '_blank');
                      }
                    }}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <EmailOutlinedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              {resume && resume.fileName && (
                <Tooltip title={`View Resume: ${resume.fileName}`}>
                  <IconButton
                    size="small"
                    onClick={handleResumeClick}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <DescriptionIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              {canShowContactIconsRow && (
                <Tooltip title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}>
                  <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                    <IconButton
                      size="small"
                      onClick={() => setShowAddNoteDialog(true)}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <NoteIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Badge>
                </Tooltip>
              )}
            </Stack>
          )}
          
          {/* Onboarding Pills - Mobile - Above Skills */}
          {canViewAdminContent && (() => {
            // Helper function to get pill color for screening orders
            const getScreeningPillColor = (status: string, result?: string) => {
              if (status === 'In-Progress') {
                return '#ff9800'; // Yellow/warning
              } else if (status === 'Complete') {
                if (result === 'Passed') {
                  return '#4caf50'; // Green
                } else if (result === 'Failed') {
                  return '#f44336'; // Red/error
                }
              }
              return '#4caf50'; // Default green
            };

            // Filter and prepare E-Verify orders (newest first, show only newest)
            const activeEVerifyOrders = eVerifyOrders.filter(order => order.status !== 'Cancelled');
            const sortedEVerifyOrders = [...activeEVerifyOrders].sort((a, b) => {
              const dateA = a.dateSubmitted ? new Date(a.dateSubmitted).getTime() : 0;
              const dateB = b.dateSubmitted ? new Date(b.dateSubmitted).getTime() : 0;
              return dateB - dateA;
            });
            const newestEVerifyOrder = sortedEVerifyOrders.length > 0 ? sortedEVerifyOrders[0] : null;

            // Filter screening orders (exclude cancelled, show all active orders)
            const activeBackgroundOrders = backgroundCheckOrders.filter(order => order.status !== 'Cancelled');
            const activeDrugOrders = drugScreeningOrders.filter(order => order.status !== 'Cancelled');
            const activeAdditionalOrders = additionalScreeningOrders.filter(order => order.status !== 'Cancelled');

            // Combine all pills
            const allPills: Array<{ label: string; color: string; key: string }> = [];

            // Add E-Verify pill (only newest)
            if (newestEVerifyOrder) {
              let eVerifyColor = '#4caf50';
              if (newestEVerifyOrder.status === 'In-Progress') {
                eVerifyColor = '#ff9800';
              } else if (newestEVerifyOrder.status === 'Complete') {
                eVerifyColor = newestEVerifyOrder.result && newestEVerifyOrder.result !== 'Employment Authorized' 
                  ? '#f44336' 
                  : '#4caf50';
              }
              allPills.push({ label: 'E-Verify', color: eVerifyColor, key: `everify-${newestEVerifyOrder.id}` });
            }

            // Add Background Check pills (one per order)
            activeBackgroundOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Background Check',
                color: getScreeningPillColor(order.status, order.result),
                key: `bg-${order.id}`
              });
            });

            // Add Drug Screening pills (one per order)
            activeDrugOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Drug Screening',
                color: getScreeningPillColor(order.status, order.result),
                key: `drug-${order.id}`
              });
            });

            // Add Additional Screening pills (one per order)
            activeAdditionalOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Additional Screening',
                color: getScreeningPillColor(order.status, order.result),
                key: `addl-${order.id}`
              });
            });

            if (allPills.length === 0) return null;

            return (
              <Box sx={{ mt: 1, mb: 1 }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                  {allPills.map((pill) => (
                    <Chip
                      key={pill.key}
                      label={pill.label}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: pill.color,
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })()}
          
          {/* Skills Chips - Mobile - Above Profile Quality Bar */}
          {primarySkills && primarySkills.length > 0 && (
            <Box sx={{ mt: 1, mb: 1 }}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                {primarySkills.slice(0, 5).map((skill, index) => (
                  <Chip
                    key={index}
                    label={toChipLabel(skill)}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      fontWeight: 500,
                      bgcolor: '#2196F3',
                      color: 'white',
                      '& .MuiChip-label': {
                        px: 1,
                      },
                    }}
                  />
                ))}
                {primarySkills.length > 5 && (
                  <Tooltip 
                    title={`${primarySkills.length - 5} more skills`}
                    componentsProps={{
                      tooltip: {
                        sx: { color: 'white' }
                      }
                    }}
                  >
                    <Chip
                      label={`+${primarySkills.length - 5}`}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: 'grey.200',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  </Tooltip>
                )}
              </Stack>
            </Box>
          )}
          
          {/* Education, Work Experience, and Certs Chips - Mobile - Below Skills */}
          {(education.length > 0 || workExperience.length > 0 || (certifications && certifications.length > 0)) && (
            <Box sx={{ mt: 1, mb: 1 }}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                {/* Education Chips - Purple */}
                {education.slice(0, 3).map((edu, index) => {
                  const degree = toChipLabel(edu?.degree ?? edu?.name ?? edu);
                  if (!degree) return null;
                  return (
                    <Chip
                      key={`edu-${index}`}
                      label={degree}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#9C27B0',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
                {/* Work Experience Chips - Navy Blue */}
                {workExperience.slice(0, 3).map((exp, index) => {
                  const jobTitle = toChipLabel(exp?.jobTitle ?? exp?.title ?? exp?.name ?? exp);
                  if (!jobTitle) return null;
                  return (
                    <Chip
                      key={`exp-${index}`}
                      label={jobTitle}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#1976D2',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
                {/* Certifications Chips - Black */}
                {certifications && certifications.slice(0, 3).map((cert, index) => {
                  const certName = toChipLabel(cert);
                  if (!certName) return null;
                  return (
                    <Chip
                      key={`cert-${index}`}
                      label={certName}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#212121',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
              </Stack>
            </Box>
          )}
          
          {/* Profile Quality Meter - Mobile */}
          {isAdminView && profileScore !== undefined && (
            <Box sx={{ mt: 1 }}>
              <ProfileQualityMeter
                score={profileScore}
                missingItemsCount={missingItems.filter(item => item.type === 'error' || item.type === 'warning').length}
                missingItemsSummary={missingItems.slice(0, 3).map(item => item.message.toLowerCase()).join(', ')}
              />
            </Box>
          )}

          {/* Score stack removed (now shown as a single summary score on the name line) */}

        </Box>
      </Box>

      {/* Desktop Layout - 3-Column Compact Structure */}
      <Box sx={{ 
        display: { xs: 'none', md: 'flex' }, 
        alignItems: 'flex-start', 
        gap: 3, 
        width: '100%',
        py: 1.5,
        maxHeight: 280,
      }}>
        {/* Column A: Photo & Status */}
        <Box sx={{ flexShrink: 0 }}>
          <Box
            position="relative"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            sx={{ mb: 1 }}
          >
            <Avatar 
              src={avatarUrl || undefined} 
              sx={{ 
                width: 120, 
                height: 120, 
                fontSize: '2.5rem',
                fontWeight: 'bold',
                border: '2px solid',
                borderColor: 'divider',
                boxShadow: 'none'
              }}
              onError={(e) => {
                console.log('Avatar image failed to load, falling back to initials:', avatarUrl);
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            >
              {!avatarUrl && initials}
            </Avatar>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {canEditAvatar && (
              <Box sx={{ 
                position: 'absolute', 
                bottom: -6, 
                right: -6,
                display: 'flex',
                gap: 0.5
              }}>
                {hover && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarClick}
                    disabled={avatarBusy}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      width: 24,
                      height: 24,
                      '&:hover': {
                        bgcolor: 'grey.400'
                      }
                    }}
                  >
                    <CameraAltIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
                
                {hover && avatarUrl && (
                  <IconButton
                    size="small"
                    onClick={handleDeleteAvatar}
                    disabled={avatarBusy}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      width: 24,
                      height: 24,
                      '&:hover': {
                        bgcolor: 'grey.400'
                      }
                    }}
                  >
                    <ClearIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>
          
          {/* Status Pills - Removed duplicate Work Eligible and Active chips - they're shown in ComplianceStatusChips and Employment Row */}
        </Box>

        {/* Column B: Name & Primary Info (flex 1) */}
        <Box flex={1} sx={{ minWidth: 0 }}>
          {/* Name with Favorite Button + Summary Score */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Typography
                variant="h5"
                sx={{ fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {`${firstName} ${lastName}`}
                {preferredName && preferredName !== firstName && ` (${preferredName})`}
              </Typography>

              {canViewAdminContent && isAdminView && securityLevel && !['5', '6', '7'].includes(String(securityLevel)) && (
                <FavoriteButton
                  itemId={uid}
                  favoriteType="users"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                  tooltipText={{
                    favorited: 'Remove from favorites',
                    notFavorited: 'Add to favorites',
                  }}
                />
              )}

              {isAdminView && (() => {
                // Stored AI score only — same value as Score tab and users table (no relative scaling)
                const rawSummary = scoreSummary?.aiScore ?? scoreSummary?.qualityScore ?? profileScore;
                if (typeof rawSummary !== 'number' || Number.isNaN(rawSummary)) return null;
                const display = Math.round(rawSummary);
                return (
                  <Tooltip title={`AI Score (stored): ${display}`}>
                    <Chip
                      icon={<InsightsIcon sx={{ fontSize: 18 }} />}
                      label={`AI Score ${display}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 700, flexShrink: 0 }}
                    />
                  </Tooltip>
                );
              })()}
            </Box>
          </Box>
          
          {/* City, State - One Line */}
          {city && state && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem', mb: 0.25 }}>
              {city}, {state}
            </Typography>
          )}

          {/* User groups - One Line (below city/state) */}
          {canViewUserGroupsInHeader && headerUserGroups.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem', mb: 0.25 }}>
              Member of:{' '}
              {headerUserGroups.map((g, idx) => (
                <React.Fragment key={g.id}>
                  {idx > 0 ? ', ' : ''}
                  <Link component={RouterLink} to={`/usergroups/${g.id}`} underline="hover">
                    {g.title}
                  </Link>
                </React.Fragment>
              ))}
            </Typography>
          )}

          {/* Joined Date */}
          {createdAt && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
              Joined: {formatDate(createdAt)}
            </Typography>
          )}
          
          {/* Contact Icons Row - Phone, SMS, Email, Resume (Icon-only buttons) */}
          {canShowContactIconsRow && (phone || email || resume) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, mb: 0.5 }}>
              {phone && (
                <>
                  <Tooltip title={`Call ${formatPhoneNumber(phone)}`}>
                    <IconButton
                      size="small"
                      component="a"
                      href={`tel:${phone.replace(/\D/g, '')}`}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <PhoneOutlinedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                  {onMessageApplicant ? (
                    <Tooltip title="Send Message">
                      <IconButton
                        size="small"
                        onClick={onMessageApplicant}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <MessageIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  ) : phone && (
                    <Tooltip title="Send SMS">
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (hasTwilioNumber) {
                            setMessageDrawerChannel('sms');
                            setMessageDrawerOpen(true);
                          } else {
                            window.open(`sms:${phone.replace(/\D/g, '')}`, '_blank');
                          }
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <MessageIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              )}
              {email && (
                <Tooltip
                  title={
                    gmailConnected
                      ? `Email ${email} (send from your Gmail)`
                      : `Email ${email} (open mail app)`
                  }
                >
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (gmailConnected) {
                        setMessageDrawerChannel('email');
                        setMessageDrawerOpen(true);
                      } else {
                        window.open(`mailto:${email}`, '_blank');
                      }
                    }}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <EmailOutlinedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              {resume && resume.fileName && (
                <Tooltip title={`View Resume: ${resume.fileName}`}>
                  <IconButton
                    size="small"
                    onClick={handleResumeClick}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <DescriptionIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              {canShowContactIconsRow && (
                <Tooltip title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}>
                  <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                    <IconButton
                      size="small"
                      onClick={() => setShowAddNoteDialog(true)}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <NoteIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Badge>
                </Tooltip>
              )}
            </Stack>
          )}
          
          {/* Onboarding Pills - Above Skills */}
          {canViewAdminContent && (() => {
            // Helper function to get pill color for screening orders
            const getScreeningPillColor = (status: string, result?: string) => {
              if (status === 'In-Progress') {
                return '#ff9800'; // Yellow/warning
              } else if (status === 'Complete') {
                if (result === 'Passed') {
                  return '#4caf50'; // Green
                } else if (result === 'Failed') {
                  return '#f44336'; // Red/error
                }
              }
              return '#4caf50'; // Default green
            };

            // Filter and prepare E-Verify orders (newest first, show only newest)
            const activeEVerifyOrders = eVerifyOrders.filter(order => order.status !== 'Cancelled');
            const sortedEVerifyOrders = [...activeEVerifyOrders].sort((a, b) => {
              const dateA = a.dateSubmitted ? new Date(a.dateSubmitted).getTime() : 0;
              const dateB = b.dateSubmitted ? new Date(b.dateSubmitted).getTime() : 0;
              return dateB - dateA;
            });
            const newestEVerifyOrder = sortedEVerifyOrders.length > 0 ? sortedEVerifyOrders[0] : null;

            // Filter screening orders (exclude cancelled, show all active orders)
            const activeBackgroundOrders = backgroundCheckOrders.filter(order => order.status !== 'Cancelled');
            const activeDrugOrders = drugScreeningOrders.filter(order => order.status !== 'Cancelled');
            const activeAdditionalOrders = additionalScreeningOrders.filter(order => order.status !== 'Cancelled');

            // Combine all pills
            const allPills: Array<{ label: string; color: string; key: string }> = [];

            // Add E-Verify pill (only newest)
            if (newestEVerifyOrder) {
              let eVerifyColor = '#4caf50';
              if (newestEVerifyOrder.status === 'In-Progress') {
                eVerifyColor = '#ff9800';
              } else if (newestEVerifyOrder.status === 'Complete') {
                eVerifyColor = newestEVerifyOrder.result && newestEVerifyOrder.result !== 'Employment Authorized' 
                  ? '#f44336' 
                  : '#4caf50';
              }
              allPills.push({ label: 'E-Verify', color: eVerifyColor, key: `everify-${newestEVerifyOrder.id}` });
            }

            // Add Background Check pills (one per order)
            activeBackgroundOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Background Check',
                color: getScreeningPillColor(order.status, order.result),
                key: `bg-${order.id}`
              });
            });

            // Add Drug Screening pills (one per order)
            activeDrugOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Drug Screening',
                color: getScreeningPillColor(order.status, order.result),
                key: `drug-${order.id}`
              });
            });

            // Add Additional Screening pills (one per order)
            activeAdditionalOrders.forEach(order => {
              allPills.push({
                label: order.typeLabel || order.type || 'Additional Screening',
                color: getScreeningPillColor(order.status, order.result),
                key: `addl-${order.id}`
              });
            });

            if (allPills.length === 0) return null;

            return (
              <Box sx={{ mt: 1, mb: 1 }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                  {allPills.map((pill) => (
                    <Chip
                      key={pill.key}
                      label={pill.label}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: pill.color,
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })()}
          
          {/* Skills Chips - Above Profile Quality Bar */}
          {primarySkills && primarySkills.length > 0 && (
            <Box sx={{ mt: 1, mb: 1 }}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                {primarySkills.slice(0, 5).map((skill, index) => (
                  <Chip
                    key={index}
                    label={toChipLabel(skill)}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.7rem',
                      fontWeight: 500,
                      bgcolor: '#2196F3',
                      color: 'white',
                      '& .MuiChip-label': {
                        px: 1,
                      },
                    }}
                  />
                ))}
                {primarySkills.length > 5 && (
                  <Tooltip 
                    title={`${primarySkills.length - 5} more skills`}
                    componentsProps={{
                      tooltip: {
                        sx: { color: 'white' }
                      }
                    }}
                  >
                    <Chip
                      label={`+${primarySkills.length - 5}`}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: 'grey.200',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  </Tooltip>
                )}
              </Stack>
            </Box>
          )}
          
          {/* Education, Work Experience, and Certs Chips - Below Skills */}
          {(education.length > 0 || workExperience.length > 0 || (certifications && certifications.length > 0)) && (
            <Box sx={{ mt: 1, mb: 1 }}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                {/* Education Chips - Purple */}
                {education.slice(0, 3).map((edu, index) => {
                  const degree = toChipLabel(edu?.degree ?? edu?.name ?? edu);
                  if (!degree) return null;
                  return (
                    <Chip
                      key={`edu-${index}`}
                      label={degree}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#9C27B0',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
                {/* Work Experience Chips - Navy Blue */}
                {workExperience.slice(0, 3).map((exp, index) => {
                  const jobTitle = toChipLabel(exp?.jobTitle ?? exp?.title ?? exp?.name ?? exp);
                  if (!jobTitle) return null;
                  return (
                    <Chip
                      key={`exp-${index}`}
                      label={jobTitle}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#1976D2',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
                {/* Certifications Chips - Black */}
                {certifications && certifications.slice(0, 3).map((cert, index) => {
                  const certName = toChipLabel(cert);
                  if (!certName) return null;
                  return (
                    <Chip
                      key={`cert-${index}`}
                      label={certName}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        bgcolor: '#212121',
                        color: 'white',
                        '& .MuiChip-label': {
                          px: 1,
                        },
                      }}
                    />
                  );
                })}
              </Stack>
            </Box>
          )}
          
          {/* Profile Quality Bar - Slim 6px */}
          {isAdminView && profileScore !== undefined && (
            <Box sx={{ mt: 1 }}>
              <CompactProfileQualityBar score={profileScore} />
            </Box>
          )}

          {/* Score stack removed (now shown as a single summary score on the name line) */}
        </Box>
        
        {/* Column C: Right-aligned buttons - Same row as avatar */}
        <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end', alignSelf: 'flex-start', pt: 0 }}>
          {securityLevel && getSecurityLabel(securityLevel) && (
            <Chip
              label={getSecurityLabel(securityLevel)}
              size="medium"
              sx={{
                ...getSoftChipSx(getSecurityColor(securityLevel)),
                fontWeight: 600,
                height: 36,
                fontSize: '0.875rem',
                px: 1.5,
              }}
            />
          )}
          {isAdminView && (
            onboardingInProgress ? (
              <Button
                variant="contained"
                onClick={() => setShowCancelOnboardingDialog(true)}
                sx={{
                  px: 2,
                  backgroundImage: 'linear-gradient(90deg, #FF8A00 0%, #FFB300 100%)', // Yellow-orange gradient
                  color: '#ffffff', // White text
                  fontWeight: 600,
                  '&:hover': {
                    backgroundImage: 'linear-gradient(90deg, #FB8C00 0%, #FFA000 100%)',
                  },
                }}
              >
                Cancel Onboarding
              </Button>
            ) : (
              <Button
                variant="outlined"
                sx={{
                  borderColor: 'success.main',
                  color: 'success.main',
                  '&:hover': {
                    borderColor: 'success.dark',
                    backgroundColor: 'success.light',
                    color: 'success.dark',
                  },
                  px: 2,
                }}
                onClick={() => setShowStartOnboardingDialog(true)}
              >
                Start Onboarding
              </Button>
            )
          )}
        </Box>
        
      </Box>

      {/* Certifications Modal */}
      <CertificationsModal
        open={showCertificationsModal}
        onClose={() => setShowCertificationsModal(false)}
        certifications={certifications}
      />

      <ImageCropDialog
        open={cropOpen}
        title="Edit profile photo"
        imageSrc={pendingImageSrc}
        cropShape="round"
        aspect={1}
        confirmLabel={avatarBusy ? 'Saving…' : 'Save'}
        loading={avatarBusy}
        onCancel={() => {
          if (avatarBusy) return;
          setCropOpen(false);
          setPendingImageSrc(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
        onConfirm={handleConfirmCroppedAvatar}
      />
      
      {/* Copy Success Snackbar */}
      <Snackbar
        open={!!copySuccess}
        autoHideDuration={3000}
        onClose={() => setCopySuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopySuccess(null)} severity="success" sx={{ width: '100%' }}>
          {copySuccess}
        </Alert>
      </Snackbar>

      {/* Cancel Onboarding Confirmation Dialog */}
      <Dialog
        open={showCancelOnboardingDialog}
        onClose={() => !cancellingOnboarding && setShowCancelOnboardingDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Cancel Onboarding</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to cancel the {activeOnboardingType} onboarding process? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowCancelOnboardingDialog(false)}
            disabled={cancellingOnboarding}
          >
            Keep Onboarding
          </Button>
          <Button
            onClick={handleCancelOnboarding}
            variant="contained"
            color="error"
            disabled={cancellingOnboarding}
            startIcon={cancellingOnboarding ? <CircularProgress size={16} /> : null}
          >
            {cancellingOnboarding ? 'Cancelling...' : 'Cancel Onboarding'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Note Dialog */}
      <AddUserNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        userId={uid}
        userName={`${firstName} ${lastName}`}
        onNoteAdded={() => {
          // Reload notes count after adding a note
          const loadNotesCount = async () => {
            try {
              const notesRef = collection(db, 'users', uid, 'notes');
              const notesSnapshot = await getDocs(query(notesRef));
              setNotesCount(notesSnapshot.size);
            } catch (error) {
              console.error('Error loading notes count:', error);
            }
          };
          loadNotesCount();
        }}
      />

      {/* Start Onboarding Dialog */}
      <StartOnboardingDialog
        open={showStartOnboardingDialog}
        onClose={() => setShowStartOnboardingDialog(false)}
        userId={uid}
        tenantId={tenantId || authTenantId || activeTenant?.id || ''}
        onOnboardingStarted={() => {
          if (onOnboardingStarted) {
            onOnboardingStarted();
          }
          // Navigate to onboarding tab
          if (onTabChange) {
            onTabChange('Onboarding');
          }
        }}
      />

      {/* Message Drawer */}
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={(() => {
          const recipients: MessageRecipient[] = [];
          if (messageDrawerChannel === 'email' && email) {
            recipients.push({
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || email.split('@')[0],
              email: email,
            });
          } else if (messageDrawerChannel === 'sms' && phone) {
            recipients.push({
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || phone,
              phone: phone,
            });
          }
          return recipients;
        })()}
        tenantId={effectiveTenantId}
        defaultChannels={[messageDrawerChannel]}
        onSend={() => {
          setMessageDrawerOpen(false);
        }}
      />
    </Box>
  );
};

export default UserProfileHeader;
