import React, { useRef, useState } from 'react';
import { Box, Avatar, IconButton, Button, Typography, Stack, Link, Chip, Breadcrumbs, Tooltip, CircularProgress, Snackbar, Alert } from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import BusinessIcon from '@mui/icons-material/Business';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import PersonIcon from '@mui/icons-material/Person';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PublicIcon from '@mui/icons-material/Public';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

import { storage, db } from '../../../firebase'; // adjust path
import { getScoreColor, getScoreLabel } from '../../../utils/applicantScoring';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import FavoriteButton from '../../../components/FavoriteButton';
import { useFavorites } from '../../../hooks/useFavorites';
import DocumentIconBar from './DocumentIconBar';
import CertificationsModal from './CertificationsModal';
import QuickInfoBar from './QuickInfoBar';
import ContactActionButtons from './ContactActionButtons';
import MissingItemsAlert from './MissingItemsAlert';
import CompactMissingItemsBanner from './CompactMissingItemsBanner';
import QuickActionToolbar from './QuickActionToolbar';
import ComplianceStatusChips from './ComplianceStatusChips';
import ProfileQualityMeter from './ProfileQualityMeter';
import CompactProfileQualityBar from './CompactProfileQualityBar';
import CompactActionGrid from './CompactActionGrid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { detectMissingItems } from '../utils/detectMissingItems';

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
  profileScore?: number; // Profile completeness score (0-100)
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
  activeApplicationsCount?: number;
  resumeCompleteness?: number;
  onTabChange?: (tabLabel: string) => void; // Callback to change tabs
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
  profileScore,
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
  activeApplicationsCount,
  resumeCompleteness,
  onTabChange,
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
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  const [showCertificationsModal, setShowCertificationsModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites('users');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
        console.log('🔄 Starting avatar upload...');
        console.log('User ID:', uid);
        console.log('File name:', file.name);
        console.log('File size:', file.size);
        
        // Check authentication
        const auth = getAuth();
        const currentUser = auth.currentUser;
        console.log('Current authenticated user:', currentUser?.uid);
        console.log('Is user authenticated?', !!currentUser);
        
        if (!currentUser) {
          throw new Error('User not authenticated');
        }
        
        const storageRef = ref(storage, `avatars/${uid}.jpg`);
        console.log('Storage path:', `avatars/${uid}.jpg`);
        
        await uploadBytes(storageRef, file);
        console.log('✅ File uploaded successfully');
        
        const downloadURL = await getDownloadURL(storageRef);
        console.log('✅ Download URL obtained:', downloadURL);
        
        await updateDoc(doc(db, 'users', uid), { avatar: downloadURL });
        console.log('✅ Firestore document updated');
        
        onAvatarUpdated(downloadURL);
        console.log('✅ Avatar update complete');
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

  const handleDeleteAvatar = async () => {
    try {
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await deleteObject(storageRef);
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
      onTabChange('Licenses & Certs');
    }
  };

  // Handler for work eligibility click
  const handleWorkEligibilityClick = () => {
    if (onTabChange) {
      onTabChange('Work Eligibility');
    }
  };

  // Handler for background check click
  const handleBackgroundCheckClick = () => {
    if (onTabChange) {
      onTabChange('Background & Vaccination');
    }
  };

  // Handler for vaccination click
  const handleVaccinationClick = () => {
    if (onTabChange) {
      onTabChange('Background & Vaccination');
    }
  };

  return (
    <Box mb={2} sx={{ py: 1.5 }}>
      {showBreadcrumbs && breadcrumbPath.length > 0 && (
        <Breadcrumbs 
          separator={<NavigateNextIcon fontSize="small" />} 
          aria-label="breadcrumb"
          sx={{ mb: 2 }}
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
      
      {/* Compact Missing Items Banner */}
      <CompactMissingItemsBanner
        items={missingItems}
        isAdminView={isAdminView}
      />

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
                {hover && !avatarUrl && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarClick}
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

          {/* Quick Action Buttons - Mobile */}
          {isAdminView && (email || phone) && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {email && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<EmailOutlinedIcon />}
                  href={`mailto:${email}`}
                  component="a"
                  sx={{
                    minWidth: 'auto',
                    px: 1.5,
                    height: 32,
                    textTransform: 'none',
                    textDecoration: 'none',
                  }}
                >
                  Email
                </Button>
              )}
              {phone && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PhoneOutlinedIcon />}
                  href={`tel:${phone.replace(/\D/g, '')}`}
                  component="a"
                  sx={{
                    minWidth: 'auto',
                    px: 1.5,
                    height: 32,
                    textTransform: 'none',
                    textDecoration: 'none',
                  }}
                >
                  Call
                </Button>
              )}
            </Stack>
          )}
        </Box>

        {/* Mobile: Name and Details */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {`${firstName} ${lastName}`}
              {preferredName && preferredName !== firstName && ` (${preferredName})`}
            </Typography>
            {isAdminView && securityLevel && !['5', '6', '7'].includes(String(securityLevel)) && (
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
          </Box>
          {Boolean(jobTitle) && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 1 }}>
              {jobTitle}
            </Typography>
          )}
          
          {/* Profile Quality Meter - Mobile */}
          {isAdminView && profileScore !== undefined && (
            <ProfileQualityMeter
              score={profileScore}
              missingItemsCount={missingItems.filter(item => item.type === 'error' || item.type === 'warning').length}
              missingItemsSummary={missingItems.slice(0, 3).map(item => item.message.toLowerCase()).join(', ')}
            />
          )}
          
          {/* Mobile: Compliance Status - High Priority */}
          {isAdminView && (
            <Box sx={{ mb: 1 }}>
              <ComplianceStatusChips
                workEligibility={workEligibility}
                backgroundCheckStatus={backgroundCheckStatus}
                vaccinationStatus={vaccinationStatus}
                onWorkEligibilityClick={handleWorkEligibilityClick}
                onBackgroundCheckClick={handleBackgroundCheckClick}
                onVaccinationClick={handleVaccinationClick}
                compact
              />
            </Box>
          )}

          {/* Mobile: Contact Info */}
          {isAdminView && (
            <Stack spacing={0.5} sx={{ mb: 1 }}>
              {city && state && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <LocationOnOutlinedIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary">
                    {city}, {state}
                  </Typography>
                </Stack>
              )}
              {phone && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <PhoneOutlinedIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                    {formatPhoneNumber(phone)}
                  </Typography>
                  <ContactActionButtons phone={phone} email={email} compact />
                </Stack>
              )}
              {email && !phone && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <EmailOutlinedIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                    {email}
                  </Typography>
                  <ContactActionButtons phone={phone} email={email} compact />
                </Stack>
              )}
              {createdAt && (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', mt: 0.5 }}>
                  Joined: {formatDate(createdAt)}
                </Typography>
              )}
            </Stack>
          )}
          {/* Mobile: Status Chips - Cleaner grouped layout */}
          {isAdminView && (workStatus || securityLevel || employmentType) && (
            <Stack spacing={0.5} sx={{ mb: 1 }}>
              {workStatus && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, minWidth: 60 }}>
                    Status:
                  </Typography>
                  <Chip
                    size="small"
                    label={workStatus}
                    color={getWorkStatusColor(workStatus)}
                    sx={{ height: 24 }}
                  />
                </Stack>
              )}
              {employmentType && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, minWidth: 60 }}>
                    Type:
                  </Typography>
                  <Chip
                    size="small"
                    label={getEmploymentTypeLabel(employmentType)}
                    color={getEmploymentTypeColor(employmentType)}
                    sx={{ height: 24 }}
                  />
                </Stack>
              )}
              {getSecurityLabel(securityLevel) && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500, minWidth: 60 }}>
                    Role:
                  </Typography>
                  <Chip
                    size="small"
                    label={getSecurityLabel(securityLevel)!}
                    sx={{ ...getSoftChipSx(getSecurityColor(securityLevel)), fontWeight: 600, height: 24 }}
                  />
                </Stack>
              )}
            </Stack>
          )}
          {/* Mobile: Quick Action Toolbar */}
          {isAdminView && (
            <Box sx={{ mb: 1.5 }}>
              <QuickActionToolbar
                onEdit={onEditProfile}
                onViewResume={handleResumeClick}
                onAddNote={onAddNote}
                onSendLink={onSendApplicationLink}
                onPrint={onPrintProfile}
                onCreateAssignment={onCreateAssignment}
                onCallNow={onCallNow}
                onMessageApplicant={onMessageApplicant}
                onViewTimeline={onViewTimeline}
                hasResume={!!resume}
                hasPhone={hasPhone}
                isAdminView={isAdminView}
                compact
              />
            </Box>
          )}

          {/* Mobile: Quick Info Bar */}
          {isAdminView && (
            <QuickInfoBar
              resume={resume}
              certifications={certifications}
              onResumeClick={handleResumeClick}
              onCertificationsClick={handleCertificationsClick}
              profileScore={profileScore}
              certificationsCount={certifications?.length}
              activeApplicationsCount={activeApplicationsCount}
              yearsExperience={yearsExperience}
              educationLevel={educationLevel}
              primarySkills={primarySkills}
              languages={languages}
              behavioralTraits={behavioralTraits}
              onSkillsClick={() => onTabChange?.('Skills')}
              workEligibility={workEligibility}
              backgroundCheckStatus={backgroundCheckStatus}
              vaccinationStatus={vaccinationStatus}
              onWorkEligibilityClick={handleWorkEligibilityClick}
              onBackgroundCheckClick={handleBackgroundCheckClick}
              onVaccinationClick={handleVaccinationClick}
              isAdminView={isAdminView}
            />
          )}
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
        {/* Column A: Photo & Status (~150px) */}
        <Box sx={{ width: 150, flexShrink: 0 }}>
          <Box
            position="relative"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            sx={{ mb: 1 }}
          >
            <Avatar 
              src={avatarUrl || undefined} 
              sx={{ 
                width: 96, 
                height: 96, 
                fontSize: '2rem',
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
                {hover && !avatarUrl && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarClick}
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
          
          {/* Favorite Button */}
          {isAdminView && securityLevel && !['5', '6', '7'].includes(String(securityLevel)) && (
            <Box sx={{ mb: 1, display: 'flex', justifyContent: 'center' }}>
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
            </Box>
          )}
          
          {/* Status Pills - Compact */}
          {isAdminView && (
            <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
              {workEligibility !== undefined && (
                <Chip
                  size="small"
                  label={workEligibility ? 'Work Eligible' : 'Not Eligible'}
                  color={workEligibility ? 'success' : 'error'}
                  sx={{ height: 22, fontSize: '0.7rem' }}
                />
              )}
              {workStatus && (
                <Chip
                  size="small"
                  label={workStatus}
                  color={getWorkStatusColor(workStatus)}
                  sx={{ height: 22, fontSize: '0.7rem' }}
                />
              )}
            </Stack>
          )}
        </Box>

        {/* Column B: Name & Primary Info (flex 1) */}
        <Box flex={1} sx={{ minWidth: 0 }}>
          {/* Name */}
          <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '1.5rem', mb: 0.25, lineHeight: 1.2 }}>
            {`${firstName} ${lastName}`}
            {preferredName && preferredName !== firstName && ` (${preferredName})`}
          </Typography>
          
          {/* City, State - One Line */}
          {city && state && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem', mb: 0.5 }}>
              {city}, {state}
            </Typography>
          )}
          
          {/* Contact Row - Phone + Email SAME LINE with Copy Icons */}
          {isAdminView && (phone || email) && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
              {phone && (
                <>
                  <PhoneOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {formatPhoneNumber(phone)}
                  </Typography>
                  <Tooltip title="Copy phone number">
                    <IconButton
                      size="small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(formatPhoneNumber(phone));
                          setCopySuccess('Phone number copied');
                          setTimeout(() => setCopySuccess(null), 3000);
                        } catch (err) {
                          console.error('Failed to copy:', err);
                        }
                      }}
                      sx={{ p: 0.25, ml: -0.5 }}
                    >
                      <ContentCopyIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
              {email && (
                <>
                  {phone && <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>•</Typography>}
                  <EmailOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {email}
                  </Typography>
                  <Tooltip title="Copy email">
                    <IconButton
                      size="small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(email);
                          setCopySuccess('Email copied');
                          setTimeout(() => setCopySuccess(null), 3000);
                        } catch (err) {
                          console.error('Failed to copy:', err);
                        }
                      }}
                      sx={{ p: 0.25, ml: -0.5 }}
                    >
                      <ContentCopyIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Stack>
          )}
          
          {/* Employment Row - Status | Applicant Type | Role - One Line */}
          {isAdminView && (workStatus || employmentType || securityLevel) && (
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {workStatus && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                    Status:
                  </Typography>
                  <Chip
                    size="small"
                    label={workStatus}
                    color={getWorkStatusColor(workStatus)}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </>
              )}
              {employmentType && (
                <>
                  {workStatus && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', mx: 0.25 }}>|</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                    Applicant Type:
                  </Typography>
                  <Chip
                    size="small"
                    label={getEmploymentTypeLabel(employmentType)}
                    color={getEmploymentTypeColor(employmentType)}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </>
              )}
              {getSecurityLabel(securityLevel) && (
                <>
                  {(workStatus || employmentType) && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', mx: 0.25 }}>|</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                    Role:
                  </Typography>
                  <Chip
                    size="small"
                    label={getSecurityLabel(securityLevel)!}
                    sx={{ ...getSoftChipSx(getSecurityColor(securityLevel)), fontWeight: 600, height: 20, fontSize: '0.7rem' }}
                  />
                </>
              )}
            </Stack>
          )}
          
          {/* Profile Quality Bar - Slim 6px */}
          {isAdminView && profileScore !== undefined && (
            <CompactProfileQualityBar score={profileScore} />
          )}
        </Box>
        
        {/* Column C: Action Grid (~300px) */}
        {isAdminView && (
          <CompactActionGrid
            onCallNow={onCallNow}
            onMessageApplicant={onMessageApplicant}
            onViewTimeline={onViewTimeline}
            onViewResume={handleResumeClick}
            onAddNote={onAddNote}
            onEditProfile={onEditProfile}
            onSendLink={onSendApplicationLink}
            onCreateAssignment={onCreateAssignment}
            hasResume={!!resume}
            hasPhone={hasPhone}
            isAdminView={isAdminView}
          />
        )}
      </Box>

      {/* Certifications Modal */}
      <CertificationsModal
        open={showCertificationsModal}
        onClose={() => setShowCertificationsModal(false)}
        certifications={certifications}
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
    </Box>
  );
};

export default UserProfileHeader;
