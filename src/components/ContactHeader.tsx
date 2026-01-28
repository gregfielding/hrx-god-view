import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Chip,
  Button,
  IconButton,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  Email as EmailIcon,
  Phone as PhoneIcon,
  LinkedIn as LinkedInIcon,
  Twitter as TwitterIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  Language as LanguageIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  AttachMoney as AttachMoneyIcon,
  Work as WorkIcon,
  Add as AddIcon,
  RocketLaunch as RocketLaunchIcon,
  CheckCircle as CheckCircleIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  TrendingUp as TrendingUpIcon,
  BusinessCenter as BusinessCenterIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, storage, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import FavoriteButton from './FavoriteButton';
import MessageDrawer, { MessageRecipient } from './MessageDrawer';
import { useAuth } from '../contexts/AuthContext';
import ImageCropDialog from './common/ImageCropDialog';

interface NavigationLink {
  type: 'company' | 'location' | 'deal' | 'jobOrder';
  id: string;
  name: string;
  companyId?: string; // Required for location type
}

interface ContactHeaderProps {
  contact: {
    id: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    jobTitle?: string;
    title?: string;
    headline?: string;
    email?: string;
    phone?: string;
    workPhone?: string;
    linkedInUrl?: string;
    twitterUrl?: string;
    facebookUrl?: string;
    instagramUrl?: string;
    website?: string;
    websiteUrl?: string;
    contactType?: string;
    inferredSeniority?: string;
    lastEnrichedAt?: any;
    associations?: {
      companies?: any[];
      locations?: any[];
      deals?: any[];
    };
    locationId?: string;
    companyId?: string;
  };
  tenantId: string;
  
  // Favorite functionality
  favoriteType?: 'contacts';
  isFavorite?: (itemId: string) => boolean;
  toggleFavorite?: (itemId: string) => string[];
  
  // Navigation links (optional)
  navigationLinks?: NavigationLink[];
  
  // Metrics for engagement calculation
  metrics?: {
    completedTasks?: number;
    totalTasks?: number;
  };
  
  // Action button handlers
  onAddNote?: () => void;
  onAIEnhance?: () => void;
  onLogActivity?: () => void;
  
  // Loading states
  aiEnhancing?: boolean;
  
  // Avatar upload/delete handlers (optional - if not provided, won't show upload buttons)
  onAvatarUpload?: (url: string) => Promise<void>;
  onAvatarDelete?: () => Promise<void>;
  
  // Route prefix for navigation (defaults to '/crm' or can be '/recruiter')
  routePrefix?: string;
  
  // Company locations for location links
  companyLocations?: Array<{
    id: string;
    name?: string;
    nickname?: string;
    title?: string;
  }>;
}

const ContactHeader: React.FC<ContactHeaderProps> = ({
  contact,
  tenantId,
  favoriteType = 'contacts',
  isFavorite,
  toggleFavorite,
  navigationLinks = [],
  metrics = { completedTasks: 0, totalTasks: 0 },
  onAddNote,
  onAIEnhance,
  onLogActivity,
  aiEnhancing = false,
  onAvatarUpload,
  onAvatarDelete,
  routePrefix = '/crm',
  companyLocations = [],
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean>(false);
  const [hasTwilioNumber, setHasTwilioNumber] = useState<boolean>(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [messageDrawerChannel, setMessageDrawerChannel] = useState<'email' | 'sms'>('email');

  // Check Gmail connection status
  useEffect(() => {
    const checkGmailConnection = async () => {
      if (!user?.uid || !tenantId) {
        setGmailConnected(false);
        return;
      }
      try {
        const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');
        const result = await getGmailStatus({ userId: user.uid, force: true });
        const data = result.data as any;
        // If rate-limited/sampled, treat as connected to avoid false negatives; MessageDrawer will validate senders.
        const connected = !!data?.connected || !!data?.rateLimited || !!data?.sampled;
        setGmailConnected(connected);
      } catch {
        // Fallback: check tokens on user doc
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const tenantIntegration = userData.tenantIds?.[tenantId]?.integrations?.google;
            const topLevelIntegration = userData.integrations?.google;
            
            const isConnected = (tenantIntegration?.accessToken || topLevelIntegration?.accessToken) && 
                                (tenantIntegration?.email || topLevelIntegration?.email);
            setGmailConnected(!!isConnected);
          } else {
            setGmailConnected(false);
          }
        } catch (error) {
          console.error('Error checking Gmail connection:', error);
          setGmailConnected(false);
        }
      }
    };
    checkGmailConnection();
  }, [user?.uid, tenantId]);

  // Check Twilio number status
  useEffect(() => {
    const checkTwilioNumber = async () => {
      if (!tenantId) {
        setHasTwilioNumber(false);
        return;
      }
      try {
        const tenantDocRef = doc(db, 'tenants', tenantId);
        const tenantDocSnap = await getDoc(tenantDocRef);
        if (tenantDocSnap.exists()) {
          const tenantData = tenantDocSnap.data();
          setHasTwilioNumber(!!tenantData.integrations?.twilio?.phoneNumber);
        } else {
          setHasTwilioNumber(false);
        }
      } catch (error) {
        console.error('Error checking Twilio number:', error);
        setHasTwilioNumber(false);
      }
    };
    checkTwilioNumber();
  }, [tenantId]);

  // Get contact display name
  const getDisplayName = () => {
    if (contact.fullName) return contact.fullName;
    if (contact.firstName || contact.lastName) {
      return `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    }
    return 'Unnamed Contact';
  };

  // Get initials for avatar
  const getInitials = () => {
    const name = getDisplayName();
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name[0].toUpperCase();
  };

  // Build navigation links from contact data and navigationLinks prop
  const buildNavigationLinks = (): NavigationLink[] => {
    const links: NavigationLink[] = [];

    // Add company link if available
    const assocCompanies = contact.associations?.companies || [];
    let companyId: string | undefined;
    
    if (assocCompanies.length > 0) {
      const firstCompany = assocCompanies[0];
      companyId = typeof firstCompany === 'string' ? firstCompany : firstCompany?.id;
    } else if (contact.companyId) {
      companyId = contact.companyId;
    }

    if (companyId) {
      // We'll need to get company name from navigationLinks or pass it separately
      const existingCompanyLink = navigationLinks.find(l => l.type === 'company' && l.id === companyId);
      if (existingCompanyLink) {
        links.push(existingCompanyLink);
      }
    }

    // Add location links
    const assocLocations = contact.associations?.locations || [];
    const locationIds: string[] = [];
    
    if (assocLocations.length > 0) {
      assocLocations.forEach((loc: any) => {
        const locId = typeof loc === 'string' ? loc : loc?.id;
        if (locId) locationIds.push(locId);
      });
    } else if (contact.locationId) {
      locationIds.push(contact.locationId);
    }

    locationIds.forEach(locationId => {
      const existingLocationLink = navigationLinks.find(l => l.type === 'location' && l.id === locationId);
      if (existingLocationLink) {
        links.push(existingLocationLink);
      } else {
        // Try to find in companyLocations
        const location = companyLocations.find(l => l.id === locationId);
        if (location && companyId) {
          links.push({
            type: 'location',
            id: locationId,
            name: location.nickname || location.name || location.title || 'Location',
            companyId,
          });
        }
      }
    });

    // Add deal links from navigationLinks
    navigationLinks.filter(l => l.type === 'deal').forEach(link => links.push(link));

    // Add job order links from navigationLinks
    navigationLinks.filter(l => l.type === 'jobOrder').forEach(link => links.push(link));

    return links;
  };

  const allNavigationLinks = buildNavigationLinks();

  // Handle avatar upload
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onAvatarUpload) return;

    // File size validation
    if (file.size > 2 * 1024 * 1024) {
      console.error('Avatar file size must be less than 2MB');
      return;
    }

    // File type validation
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      console.error('Please upload a PNG, JPG, or SVG file');
      return;
    }

    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      setPendingImageSrc(src);
      setCropOpen(true);
    } catch (error) {
      console.error('Error preparing avatar crop:', error);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
    }
  };

  const handleConfirmCroppedAvatar = async (blob: Blob) => {
    if (!onAvatarUpload) return;
    try {
      setAvatarLoading(true);

      // Best-effort delete previous avatar to avoid storage leaks
      if (contact.avatar) {
        try {
          await deleteObject(ref(storage, contact.avatar));
        } catch {}
      }

      const storageRef = ref(storage, `contacts/${tenantId}/${contact.id}/avatar.jpg`);
      await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(storageRef);
      await onAvatarUpload(downloadURL);

      setCropOpen(false);
      setPendingImageSrc(null);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
    } catch (error) {
      console.error('Error uploading cropped avatar:', error);
    } finally {
      setAvatarLoading(false);
    }
  };

  // Handle avatar delete
  const handleAvatarDelete = async () => {
    if (!contact.avatar || !onAvatarDelete) return;

    try {
      setAvatarLoading(true);
      // Delete from storage (supports both gs:// and https:// refs)
      await deleteObject(ref(storage, contact.avatar));
      await onAvatarDelete();
    } catch (error) {
      console.error('Error deleting avatar:', error);
    } finally {
      setAvatarLoading(false);
    }
  };

  // Get navigation path for link type
  const getNavigationPath = (link: NavigationLink): string => {
    switch (link.type) {
      case 'company':
        return `${routePrefix}/companies/${link.id}`;
      case 'location':
        if (link.companyId) {
          return `${routePrefix}/companies/${link.companyId}/locations/${link.id}`;
        }
        return '#';
      case 'deal':
        return `${routePrefix}/deals/${link.id}`;
      case 'jobOrder':
        return `${routePrefix}/job-orders/${link.id}`;
      default:
        return '#';
    }
  };

  // Get icon for link type
  const getLinkIcon = (type: NavigationLink['type']) => {
    switch (type) {
      case 'company':
        return <BusinessIcon fontSize="small" color="primary" />;
      case 'location':
        return <LocationIcon fontSize="small" color="primary" />;
      case 'deal':
        return <AttachMoneyIcon fontSize="small" color="primary" />;
      case 'jobOrder':
        return <WorkIcon fontSize="small" color="primary" />;
    }
  };

  // Calculate engagement level
  const getEngagementLevel = (): { label: string; color: 'success' | 'warning' | 'error' } => {
    const completed = metrics.completedTasks || 0;
    if (completed > 5) return { label: 'High', color: 'success' };
    if (completed > 2) return { label: 'Medium', color: 'warning' };
    return { label: 'Low', color: 'error' };
  };

  const engagement = getEngagementLevel();

  // Prefer canonical `website` but tolerate `websiteUrl` (some CRM/enrichment payloads use this key).
  const websiteUrl = (contact.website || contact.websiteUrl || '').trim();
  const hasWebsite = !!websiteUrl;

  return (
    <Box sx={{ 
      mb: 3,
      p: 3,
      borderRadius: 2,
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: 'divider',
      boxShadow: 'none'
    }}>
      {/* Mobile Layout: Avatar + Action Buttons Row */}
      <Box sx={{ 
        display: { xs: 'flex', md: 'none' }, 
        alignItems: 'flex-start', 
        justifyContent: 'space-between',
        mb: 2
      }}>
        {/* Avatar */}
        {onAvatarUpload && (
          <Box sx={{ position: 'relative' }}>
            <Avatar
              src={contact.avatar}
              alt={getDisplayName()}
              sx={{ 
                width: 96, 
                height: 96,
                bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                fontSize: '2rem',
                fontWeight: 'bold'
              }}
            >
              {getInitials()}
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
                id={`avatar-upload-mobile-${contact.id}`}
                type="file"
                onChange={handleAvatarUpload}
                disabled={avatarLoading}
                ref={avatarFileInputRef}
              />
              <label htmlFor={`avatar-upload-mobile-${contact.id}`}>
                <IconButton
                  component="span"
                  size="small"
                  sx={{
                    bgcolor: 'grey.300',
                    color: 'grey.700',
                    '&:hover': {
                      bgcolor: 'grey.400'
                    },
                    width: 24,
                    height: 24
                  }}
                  disabled={avatarLoading}
                >
                  {avatarLoading ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <UploadIcon sx={{ fontSize: 14 }} />
                  )}
                </IconButton>
              </label>
              
              {contact.avatar && onAvatarDelete && (
                <IconButton
                  size="small"
                  onClick={handleAvatarDelete}
                  disabled={avatarLoading}
                  sx={{
                    bgcolor: 'grey.300',
                    color: 'grey.700',
                    '&:hover': {
                      bgcolor: 'grey.400'
                    },
                    width: 24,
                    height: 24
                  }}
                >
                  {avatarLoading ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  )}
                </IconButton>
              )}
            </Box>
          </Box>
        )}

        {/* Avatar without upload functionality (mobile) */}
        {!onAvatarUpload && (
          <Avatar
            src={contact.avatar}
            alt={getDisplayName()}
            sx={{ 
              width: 96, 
              height: 96,
              bgcolor: contact.avatar ? 'transparent' : 'primary.main',
              fontSize: '2rem',
              fontWeight: 'bold'
            }}
          >
            {getInitials()}
          </Avatar>
        )}

        {/* Action Buttons - Mobile (smaller, horizontal) */}
        {(onAddNote || onAIEnhance || onLogActivity) && (
          <Box sx={{ display: 'flex', gap: 0.5, flexDirection: 'row' }}>
            {onAddNote && (
              <Button 
                variant="outlined" 
                startIcon={<AddIcon />}
                onClick={onAddNote}
                size="small"
                sx={{ minWidth: 'auto', px: 1.5 }}
              >
                Note
              </Button>
            )}
            
            {onAIEnhance && (
              <Button
                variant="contained"
                startIcon={aiEnhancing ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
                onClick={onAIEnhance}
                disabled={aiEnhancing}
                size="small"
                sx={{ 
                  bgcolor: 'primary.main',
                  color: 'white',
                  minWidth: 'auto',
                  px: 1.5,
                  '&:hover': {
                    bgcolor: 'primary.dark'
                  },
                  '&:disabled': {
                    bgcolor: 'grey.400'
                  }
                }}
              >
                {aiEnhancing ? '...' : 'AI'}
              </Button>
            )}
            
            {onLogActivity && (
              <Button
                variant="contained"
                startIcon={<CheckCircleIcon />}
                onClick={onLogActivity}
                size="small"
                sx={{ 
                  bgcolor: 'primary.main',
                  minWidth: 'auto',
                  px: 1.5,
                  '&:hover': {
                    bgcolor: 'primary.dark'
                  }
                }}
              >
                Log
              </Button>
            )}
          </Box>
        )}
      </Box>

      {/* Desktop Layout: Full horizontal layout */}
      <Box sx={{ 
        display: { xs: 'none', md: 'flex' }, 
        alignItems: 'flex-start', 
        justifyContent: 'space-between' 
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
          {/* Contact Avatar */}
          {onAvatarUpload && (
            <Box
              sx={{ position: 'relative' }}
              onMouseEnter={() => setAvatarHover(true)}
              onMouseLeave={() => setAvatarHover(false)}
            >
              <Avatar
                src={contact.avatar}
                alt={getDisplayName()}
                sx={{ 
                  width: 120, 
                  height: 120,
                  bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                  fontSize: '2.5rem',
                  fontWeight: 'bold',
                  border: '3px solid',
                  borderColor: 'background.paper',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}
              >
                {getInitials()}
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
                  id={`avatar-upload-${contact.id}`}
                  type="file"
                  onChange={handleAvatarUpload}
                  disabled={avatarLoading}
                  ref={avatarFileInputRef}
                />
                <label htmlFor={`avatar-upload-${contact.id}`}>
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
                      height: 28,
                      display: avatarHover ? 'inline-flex' : 'none'
                    }}
                    disabled={avatarLoading}
                  >
                    {avatarLoading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <UploadIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                </label>
                
                {contact.avatar && onAvatarDelete && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarDelete}
                    disabled={avatarLoading}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': {
                        bgcolor: 'grey.400'
                      },
                      width: 28,
                      height: 28,
                      display: avatarHover ? 'inline-flex' : 'none'
                    }}
                  >
                    {avatarLoading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                )}
              </Box>
            </Box>
          )}

          {/* Avatar without upload functionality */}
          {!onAvatarUpload && (
            <Avatar
              src={contact.avatar}
              alt={getDisplayName()}
              sx={{ 
                width: 120, 
                height: 120,
                bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                fontSize: '2.5rem',
                fontWeight: 'bold',
                border: '3px solid',
                borderColor: 'background.paper',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
            >
              {getInitials()}
            </Avatar>
          )}

          {/* Contact Information */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>
            {/* Name + Contact Type + Favorite Star */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '1.75rem' }}>
                {getDisplayName()}
              </Typography>
              {contact.contactType && (
                <Chip
                  label={contact.contactType}
                  size="small"
                  color={contact.contactType === 'Decision Maker' ? 'success' : contact.contactType === 'Champion' ? 'primary' : 'default'}
                  sx={{
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    // Match the green styling from Additional Details section
                    borderColor: contact.contactType === 'Decision Maker'
                      ? 'rgba(76, 175, 80, 0.3)'
                      : contact.contactType === 'Unknown'
                      ? 'rgba(255, 152, 0, 0.3)'
                      : 'rgba(33, 150, 243, 0.3)',
                    bgcolor: contact.contactType === 'Decision Maker'
                      ? 'rgba(76, 175, 80, 0.08)'
                      : contact.contactType === 'Unknown'
                      ? 'rgba(255, 152, 0, 0.08)'
                      : 'rgba(33, 150, 243, 0.08)',
                    color: contact.contactType === 'Decision Maker'
                      ? '#4CAF50'
                      : contact.contactType === 'Unknown'
                      ? '#FF9800'
                      : '#2196F3',
                    '&:hover': {
                      borderColor: contact.contactType === 'Decision Maker'
                        ? 'rgba(76, 175, 80, 0.5)'
                        : contact.contactType === 'Unknown'
                        ? 'rgba(255, 152, 0, 0.5)'
                        : 'rgba(33, 150, 243, 0.5)',
                      bgcolor: contact.contactType === 'Decision Maker'
                        ? 'rgba(76, 175, 80, 0.12)'
                        : contact.contactType === 'Unknown'
                        ? 'rgba(255, 152, 0, 0.12)'
                        : 'rgba(33, 150, 243, 0.12)',
                    }
                  }}
                />
              )}
              {toggleFavorite && (
                <FavoriteButton
                  itemId={contact.id}
                  favoriteType={favoriteType}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="medium"
                />
              )}
            </Box>
            
            {/* Job Title and Company */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {(contact.jobTitle || contact.title) && (
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                  {contact.jobTitle || contact.title}
                </Typography>
              )}

              {/* Professional Headline */}
              {contact.headline && (
                <Typography 
                  variant="body2" 
                  color="text.secondary" 
                  sx={{ 
                    fontStyle: 'italic',
                    maxWidth: '600px',
                    lineHeight: 1.5,
                    fontSize: '0.875rem'
                  }}
                >
                  {contact.headline}
                </Typography>
              )}

              {/* Navigation Links */}
              {allNavigationLinks.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                  {allNavigationLinks.map((link, index) => (
                    <React.Fragment key={`${link.type}-${link.id}`}>
                      {index > 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ mx: 0.5 }}>
                          /
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {getLinkIcon(link.type)}
                        <Typography 
                          variant="body2" 
                          color="primary"
                          sx={{ 
                            cursor: 'pointer', 
                            textDecoration: 'none',
                            fontWeight: 500,
                            fontSize: '0.875rem',
                            '&:hover': { 
                              color: 'primary.dark',
                              textDecoration: 'underline'
                            } 
                          }}
                          onClick={() => navigate(getNavigationPath(link))}
                        >
                          {link.name}
                        </Typography>
                      </Box>
                    </React.Fragment>
                  ))}
                </Box>
              )}
            </Box>
              
            {/* Contact Icons */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {contact.email && (
                <Tooltip title={`Send Email to ${contact.email}`}>
                  <IconButton
                    size="small"
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
                    onClick={() => {
                      if (gmailConnected) {
                        setMessageDrawerChannel('email');
                        setMessageDrawerOpen(true);
                      } else {
                        window.open(`mailto:${contact.email}`, '_blank');
                      }
                    }}
                  >
                    <EmailIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {(contact.phone || contact.workPhone) && (
                <Tooltip title={contact.phone || contact.workPhone ? `Call ${contact.phone || contact.workPhone}` : 'No phone'}>
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: (contact.phone || contact.workPhone) ? 'primary.main' : 'text.disabled',
                      bgcolor: (contact.phone || contact.workPhone) ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: (contact.phone || contact.workPhone) ? 'primary.dark' : 'text.disabled',
                        bgcolor: (contact.phone || contact.workPhone) ? 'primary.light' : 'transparent',
                        transform: (contact.phone || contact.workPhone) ? 'translateY(-1px)' : 'none',
                        boxShadow: (contact.phone || contact.workPhone) ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (contact.phone || contact.workPhone) {
                        window.open(`tel:${contact.phone || contact.workPhone}`, '_blank');
                      }
                    }}
                  >
                    <PhoneIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {contact.linkedInUrl && (
                <Tooltip title="View LinkedIn Profile">
                  <IconButton
                    size="small"
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
                    onClick={() => {
                      let url = contact.linkedInUrl!;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }}
                  >
                    <LinkedInIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}

              {/* Website (right after LinkedIn per spec) */}
              {hasWebsite && (
                <Tooltip title={`Visit ${websiteUrl}`}>
                  <IconButton
                    size="small"
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
                    onClick={() => {
                      let url = websiteUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }}
                  >
                    <LanguageIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {contact.twitterUrl && (
                <Tooltip title="View Twitter Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: contact.twitterUrl ? 'primary.main' : 'text.disabled',
                      bgcolor: contact.twitterUrl ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: contact.twitterUrl ? 'primary.dark' : 'text.disabled',
                        bgcolor: contact.twitterUrl ? 'primary.light' : 'transparent',
                        transform: contact.twitterUrl ? 'translateY(-1px)' : 'none',
                        boxShadow: contact.twitterUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (contact.twitterUrl) {
                        let url = contact.twitterUrl;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <TwitterIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {contact.facebookUrl && (
                <Tooltip title="View Facebook Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: contact.facebookUrl ? 'primary.main' : 'text.disabled',
                      bgcolor: contact.facebookUrl ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: contact.facebookUrl ? 'primary.dark' : 'text.disabled',
                        bgcolor: contact.facebookUrl ? 'primary.light' : 'transparent',
                        transform: contact.facebookUrl ? 'translateY(-1px)' : 'none',
                        boxShadow: contact.facebookUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (contact.facebookUrl) {
                        let url = contact.facebookUrl;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <FacebookIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {contact.instagramUrl && (
                <Tooltip title="View Instagram Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: contact.instagramUrl ? 'primary.main' : 'text.disabled',
                      bgcolor: contact.instagramUrl ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: contact.instagramUrl ? 'primary.dark' : 'text.disabled',
                        bgcolor: contact.instagramUrl ? 'primary.light' : 'transparent',
                        transform: contact.instagramUrl ? 'translateY(-1px)' : 'none',
                        boxShadow: contact.instagramUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (contact.instagramUrl) {
                        let url = contact.instagramUrl;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <InstagramIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {/* Website icon moved up to right after LinkedIn */}
            </Box>

            {/* Contact Type, Engagement, and Seniority - Modern Badge Design */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
              {contact.contactType && (
                <Tooltip title="Contact Type" arrow>
                  <Chip 
                    icon={<PersonIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                    label={contact.contactType || 'Unknown'} 
                    size="small"
                    variant="outlined"
                    sx={{ 
                      fontWeight: 500,
                      fontSize: '0.8125rem',
                      height: '28px',
                      borderRadius: 1,
                      borderColor: contact.contactType === 'Decision Maker' 
                        ? 'rgba(76, 175, 80, 0.3)' 
                        : contact.contactType === 'Unknown' 
                        ? 'rgba(255, 152, 0, 0.3)' 
                        : 'rgba(33, 150, 243, 0.3)',
                      bgcolor: contact.contactType === 'Decision Maker' 
                        ? 'rgba(76, 175, 80, 0.08)' 
                        : contact.contactType === 'Unknown' 
                        ? 'rgba(255, 152, 0, 0.08)' 
                        : 'rgba(33, 150, 243, 0.08)',
                      color: contact.contactType === 'Decision Maker' 
                        ? '#4CAF50' 
                        : contact.contactType === 'Unknown' 
                        ? '#FF9800' 
                        : '#2196F3',
                      '& .MuiChip-icon': {
                        color: 'inherit',
                        opacity: 0.7
                      },
                      '&:hover': {
                        borderColor: contact.contactType === 'Decision Maker' 
                          ? 'rgba(76, 175, 80, 0.5)' 
                          : contact.contactType === 'Unknown' 
                          ? 'rgba(255, 152, 0, 0.5)' 
                          : 'rgba(33, 150, 243, 0.5)',
                        bgcolor: contact.contactType === 'Decision Maker' 
                          ? 'rgba(76, 175, 80, 0.12)' 
                          : contact.contactType === 'Unknown' 
                          ? 'rgba(255, 152, 0, 0.12)' 
                          : 'rgba(33, 150, 243, 0.12)',
                      },
                      transition: 'all 0.2s ease'
                    }}
                  />
                </Tooltip>
              )}
              
              <Tooltip title={`Engagement Level: ${engagement.label}`} arrow>
                <Chip 
                  icon={<TrendingUpIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                  label={engagement.label} 
                  size="small"
                  variant="outlined"
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    borderColor: engagement.color === 'success' 
                      ? 'rgba(76, 175, 80, 0.3)' 
                      : engagement.color === 'warning' 
                      ? 'rgba(255, 152, 0, 0.3)' 
                      : 'rgba(244, 67, 54, 0.3)',
                    bgcolor: engagement.color === 'success' 
                      ? 'rgba(76, 175, 80, 0.08)' 
                      : engagement.color === 'warning' 
                      ? 'rgba(255, 152, 0, 0.08)' 
                      : 'rgba(244, 67, 54, 0.08)',
                    color: engagement.color === 'success' 
                      ? '#4CAF50' 
                      : engagement.color === 'warning' 
                      ? '#FF9800' 
                      : '#F44336',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                      opacity: 0.7
                    },
                    '&:hover': {
                      borderColor: engagement.color === 'success' 
                        ? 'rgba(76, 175, 80, 0.5)' 
                        : engagement.color === 'warning' 
                        ? 'rgba(255, 152, 0, 0.5)' 
                        : 'rgba(244, 67, 54, 0.5)',
                      bgcolor: engagement.color === 'success' 
                        ? 'rgba(76, 175, 80, 0.12)' 
                        : engagement.color === 'warning' 
                        ? 'rgba(255, 152, 0, 0.12)' 
                        : 'rgba(244, 67, 54, 0.12)',
                    },
                    transition: 'all 0.2s ease'
                  }}
                />
              </Tooltip>
              
              {contact.inferredSeniority && (
                <Tooltip title="Seniority Level" arrow>
                  <Chip 
                    icon={<BusinessCenterIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                    label={contact.inferredSeniority} 
                    size="small"
                    variant="outlined"
                    sx={{ 
                      fontWeight: 500,
                      fontSize: '0.8125rem',
                      height: '28px',
                      borderRadius: 1,
                      borderColor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                        ? 'rgba(76, 175, 80, 0.3)' 
                        : contact.inferredSeniority === 'Senior' 
                        ? 'rgba(33, 150, 243, 0.3)' 
                        : contact.inferredSeniority === 'Mid-Level' 
                        ? 'rgba(255, 152, 0, 0.3)' 
                        : 'rgba(158, 158, 158, 0.3)',
                      bgcolor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                        ? 'rgba(76, 175, 80, 0.08)' 
                        : contact.inferredSeniority === 'Senior' 
                        ? 'rgba(33, 150, 243, 0.08)' 
                        : contact.inferredSeniority === 'Mid-Level' 
                        ? 'rgba(255, 152, 0, 0.08)' 
                        : 'rgba(158, 158, 158, 0.08)',
                      color: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                        ? '#4CAF50' 
                        : contact.inferredSeniority === 'Senior' 
                        ? '#2196F3' 
                        : contact.inferredSeniority === 'Mid-Level' 
                        ? '#FF9800' 
                        : '#9E9E9E',
                      '& .MuiChip-icon': {
                        color: 'inherit',
                        opacity: 0.7
                      },
                      '&:hover': {
                        borderColor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                          ? 'rgba(76, 175, 80, 0.5)' 
                          : contact.inferredSeniority === 'Senior' 
                          ? 'rgba(33, 150, 243, 0.5)' 
                          : contact.inferredSeniority === 'Mid-Level' 
                          ? 'rgba(255, 152, 0, 0.5)' 
                          : 'rgba(158, 158, 158, 0.5)',
                        bgcolor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                          ? 'rgba(76, 175, 80, 0.12)' 
                          : contact.inferredSeniority === 'Senior' 
                          ? 'rgba(33, 150, 243, 0.12)' 
                          : contact.inferredSeniority === 'Mid-Level' 
                          ? 'rgba(255, 152, 0, 0.12)' 
                          : 'rgba(158, 158, 158, 0.12)',
                      },
                      transition: 'all 0.2s ease'
                    }}
                  />
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>

        {/* Action Buttons - Desktop */}
        {(onAddNote || onAIEnhance || onLogActivity) && (
          <Box sx={{ 
            display: { xs: 'none', md: 'flex' }, 
            flexDirection: 'column', 
            alignItems: 'flex-end', 
            gap: 1.5,
            ml: 3,
            minWidth: 'fit-content'
          }}>
            <Box sx={{ display: 'flex', gap: 0.75, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {onAddNote && (
                <Button 
                  variant="outlined" 
                  size="small"
                  startIcon={<AddIcon sx={{ fontSize: '14px' }} />}
                  onClick={onAddNote}
                  sx={{
                    fontWeight: 500,
                    textTransform: 'none',
                    borderRadius: 1,
                    height: '28px',
                    px: 1.25,
                    fontSize: '0.8125rem',
                    minWidth: 'auto'
                  }}
                >
                  Add Note
                </Button>
              )}
              
              {onAIEnhance && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={aiEnhancing ? <CircularProgress size={14} color="inherit" /> : <RocketLaunchIcon sx={{ fontSize: '14px' }} />}
                  onClick={onAIEnhance}
                  disabled={aiEnhancing}
                  sx={{ 
                    bgcolor: 'primary.main',
                    color: 'white',
                    fontWeight: 500,
                    textTransform: 'none',
                    borderRadius: 1,
                    height: '28px',
                    px: 1.25,
                    fontSize: '0.8125rem',
                    minWidth: 'auto',
                    '&:hover': {
                      bgcolor: 'primary.dark'
                    },
                    '&:disabled': {
                      bgcolor: 'grey.400'
                    }
                  }}
                >
                  {aiEnhancing ? 'Enhancing...' : 'AI Enhance'}
                </Button>
              )}
              
              {onLogActivity && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<CheckCircleIcon sx={{ fontSize: '14px' }} />}
                  onClick={onLogActivity}
                  sx={{ 
                    bgcolor: 'primary.main',
                    fontWeight: 500,
                    textTransform: 'none',
                    borderRadius: 1,
                    height: '28px',
                    px: 1.25,
                    fontSize: '0.8125rem',
                    minWidth: 'auto',
                    '&:hover': {
                      bgcolor: 'primary.dark'
                    }
                  }}
                >
                  Log Activity
                </Button>
              )}
            </Box>
            
            {contact.lastEnrichedAt && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                Last updated: {(() => {
                  try {
                    // Handle Firestore timestamp
                    if (contact.lastEnrichedAt.toDate) {
                      return contact.lastEnrichedAt.toDate().toLocaleString();
                    }
                    // Handle string or number
                    const date = new Date(contact.lastEnrichedAt);
                    if (isNaN(date.getTime())) {
                      return 'Recently';
                    }
                    return date.toLocaleString();
                  } catch (error) {
                    return 'Recently';
                  }
                })()}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Mobile: Contact Information Row */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        {/* Contact Information */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Name + Contact Type + Favorite Star */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {getDisplayName()}
            </Typography>
            {contact.contactType && (
              <Chip
                label={contact.contactType}
                size="small"
                color={contact.contactType === 'Decision Maker' ? 'success' : contact.contactType === 'Champion' ? 'primary' : 'default'}
                sx={{
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  height: '28px',
                  borderRadius: 1,
                  // Match the green styling from Additional Details section
                  borderColor: contact.contactType === 'Decision Maker'
                    ? 'rgba(76, 175, 80, 0.3)'
                    : contact.contactType === 'Unknown'
                    ? 'rgba(255, 152, 0, 0.3)'
                    : 'rgba(33, 150, 243, 0.3)',
                  bgcolor: contact.contactType === 'Decision Maker'
                    ? 'rgba(76, 175, 80, 0.08)'
                    : contact.contactType === 'Unknown'
                    ? 'rgba(255, 152, 0, 0.08)'
                    : 'rgba(33, 150, 243, 0.08)',
                  color: contact.contactType === 'Decision Maker'
                    ? '#4CAF50'
                    : contact.contactType === 'Unknown'
                    ? '#FF9800'
                    : '#2196F3',
                  '&:hover': {
                    borderColor: contact.contactType === 'Decision Maker'
                      ? 'rgba(76, 175, 80, 0.5)'
                      : contact.contactType === 'Unknown'
                      ? 'rgba(255, 152, 0, 0.5)'
                      : 'rgba(33, 150, 243, 0.5)',
                    bgcolor: contact.contactType === 'Decision Maker'
                      ? 'rgba(76, 175, 80, 0.12)'
                      : contact.contactType === 'Unknown'
                      ? 'rgba(255, 152, 0, 0.12)'
                      : 'rgba(33, 150, 243, 0.12)',
                  }
                }}
              />
            )}
            {toggleFavorite && (
              <FavoriteButton
                itemId={contact.id}
                favoriteType={favoriteType}
                isFavorite={isFavorite}
                toggleFavorite={toggleFavorite}
                size="medium"
              />
            )}
          </Box>
          
          {/* Job Title */}
          {(contact.jobTitle || contact.title) && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
              {contact.jobTitle || contact.title}
            </Typography>
          )}

          {/* Professional Headline */}
          {contact.headline && (
            <Typography 
              variant="body2" 
              color="text.secondary" 
              sx={{ 
                fontStyle: 'italic',
                maxWidth: '100%',
                lineHeight: 1.4,
                mb: 0.5
              }}
            >
              {contact.headline}
            </Typography>
          )}

          {/* Navigation Links */}
          {allNavigationLinks.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0, flexWrap: 'wrap' }}>
              {allNavigationLinks.map((link, index) => (
                <React.Fragment key={`${link.type}-${link.id}`}>
                  {index > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mx: 0.5 }}>
                      /
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {getLinkIcon(link.type)}
                    <Typography 
                      variant="body2" 
                      color="primary"
                      sx={{ 
                        cursor: 'pointer', 
                        textDecoration: 'underline', 
                        '&:hover': { color: 'primary.dark' } 
                      }}
                      onClick={() => navigate(getNavigationPath(link))}
                    >
                      {link.name}
                    </Typography>
                  </Box>
                </React.Fragment>
              ))}
            </Box>
          )}
            
          {/* Contact Icons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, mt: 0, flexWrap: 'wrap' }}>
            {contact.email && (
              <Tooltip title={`Send Email to ${contact.email}`}>
                <IconButton
                  size="small"
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
                  onClick={() => {
                    if (gmailConnected) {
                      setMessageDrawerChannel('email');
                      setMessageDrawerOpen(true);
                    } else {
                      window.open(`mailto:${contact.email}`, '_blank');
                    }
                  }}
                  >
                  <EmailIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {(contact.phone || contact.workPhone) && (
              <Tooltip title={contact.phone || contact.workPhone ? `Call ${contact.phone || contact.workPhone}` : 'No phone'}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: (contact.phone || contact.workPhone) ? 'primary.main' : 'text.disabled',
                    bgcolor: (contact.phone || contact.workPhone) ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: (contact.phone || contact.workPhone) ? 'primary.dark' : 'text.disabled',
                      bgcolor: (contact.phone || contact.workPhone) ? 'primary.light' : 'transparent',
                      transform: (contact.phone || contact.workPhone) ? 'translateY(-1px)' : 'none',
                      boxShadow: (contact.phone || contact.workPhone) ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (contact.phone || contact.workPhone) {
                      window.open(`tel:${contact.phone || contact.workPhone}`, '_blank');
                    }
                  }}
                >
                  <PhoneIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {contact.linkedInUrl && (
              <Tooltip title="View LinkedIn Profile">
                <IconButton
                  size="small"
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
                  onClick={() => {
                    let url = contact.linkedInUrl!;
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                      url = 'https://' + url;
                    }
                    window.open(url, '_blank');
                  }}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}

            {/* Website (right after LinkedIn per spec) */}
            {hasWebsite && (
              <Tooltip title={`Visit ${websiteUrl}`}>
                <IconButton
                  size="small"
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
                  onClick={() => {
                    let url = websiteUrl;
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                      url = 'https://' + url;
                    }
                    window.open(url, '_blank');
                  }}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {contact.twitterUrl && (
              <Tooltip title="View Twitter Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: contact.twitterUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.twitterUrl ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.twitterUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.twitterUrl ? 'primary.light' : 'transparent',
                      transform: contact.twitterUrl ? 'translateY(-1px)' : 'none',
                      boxShadow: contact.twitterUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (contact.twitterUrl) {
                      let url = contact.twitterUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <TwitterIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {contact.facebookUrl && (
              <Tooltip title="View Facebook Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: contact.facebookUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.facebookUrl ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.facebookUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.facebookUrl ? 'primary.light' : 'transparent',
                      transform: contact.facebookUrl ? 'translateY(-1px)' : 'none',
                      boxShadow: contact.facebookUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (contact.facebookUrl) {
                      let url = contact.facebookUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <FacebookIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {contact.instagramUrl && (
              <Tooltip title="View Instagram Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: contact.instagramUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.instagramUrl ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.instagramUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.instagramUrl ? 'primary.light' : 'transparent',
                      transform: contact.instagramUrl ? 'translateY(-1px)' : 'none',
                      boxShadow: contact.instagramUrl ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (contact.instagramUrl) {
                      let url = contact.instagramUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <InstagramIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Website icon moved up to right after LinkedIn */}
          </Box>

          {/* Contact Type, Engagement, and Seniority - Modern Badge Design */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
            {contact.contactType && (
              <Tooltip title="Contact Type" arrow>
                <Chip 
                  icon={<PersonIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                  label={contact.contactType || 'Unknown'} 
                  size="small"
                  variant="outlined"
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    borderColor: contact.contactType === 'Decision Maker' 
                      ? 'rgba(76, 175, 80, 0.3)' 
                      : contact.contactType === 'Unknown' 
                      ? 'rgba(255, 152, 0, 0.3)' 
                      : 'rgba(33, 150, 243, 0.3)',
                    bgcolor: contact.contactType === 'Decision Maker' 
                      ? 'rgba(76, 175, 80, 0.08)' 
                      : contact.contactType === 'Unknown' 
                      ? 'rgba(255, 152, 0, 0.08)' 
                      : 'rgba(33, 150, 243, 0.08)',
                    color: contact.contactType === 'Decision Maker' 
                      ? '#4CAF50' 
                      : contact.contactType === 'Unknown' 
                      ? '#FF9800' 
                      : '#2196F3',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                      opacity: 0.7
                    },
                    '&:hover': {
                      borderColor: contact.contactType === 'Decision Maker' 
                        ? 'rgba(76, 175, 80, 0.5)' 
                        : contact.contactType === 'Unknown' 
                        ? 'rgba(255, 152, 0, 0.5)' 
                        : 'rgba(33, 150, 243, 0.5)',
                      bgcolor: contact.contactType === 'Decision Maker' 
                        ? 'rgba(76, 175, 80, 0.12)' 
                        : contact.contactType === 'Unknown' 
                        ? 'rgba(255, 152, 0, 0.12)' 
                        : 'rgba(33, 150, 243, 0.12)',
                    },
                    transition: 'all 0.2s ease'
                  }}
                />
              </Tooltip>
            )}
            
            <Tooltip title={`Engagement Level: ${engagement.label}`} arrow>
              <Chip 
                icon={<TrendingUpIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                label={engagement.label} 
                size="small"
                variant="outlined"
                sx={{ 
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  height: '28px',
                    borderRadius: 1,
                  borderColor: engagement.color === 'success' 
                    ? 'rgba(76, 175, 80, 0.3)' 
                    : engagement.color === 'warning' 
                    ? 'rgba(255, 152, 0, 0.3)' 
                    : 'rgba(244, 67, 54, 0.3)',
                  bgcolor: engagement.color === 'success' 
                    ? 'rgba(76, 175, 80, 0.08)' 
                    : engagement.color === 'warning' 
                    ? 'rgba(255, 152, 0, 0.08)' 
                    : 'rgba(244, 67, 54, 0.08)',
                  color: engagement.color === 'success' 
                    ? '#4CAF50' 
                    : engagement.color === 'warning' 
                    ? '#FF9800' 
                    : '#F44336',
                  '& .MuiChip-icon': {
                    color: 'inherit',
                    opacity: 0.7
                  },
                  '&:hover': {
                    borderColor: engagement.color === 'success' 
                      ? 'rgba(76, 175, 80, 0.5)' 
                      : engagement.color === 'warning' 
                      ? 'rgba(255, 152, 0, 0.5)' 
                      : 'rgba(244, 67, 54, 0.5)',
                    bgcolor: engagement.color === 'success' 
                      ? 'rgba(76, 175, 80, 0.12)' 
                      : engagement.color === 'warning' 
                      ? 'rgba(255, 152, 0, 0.12)' 
                      : 'rgba(244, 67, 54, 0.12)',
                  },
                  transition: 'all 0.2s ease'
                }}
              />
            </Tooltip>
            
            {contact.inferredSeniority && (
              <Tooltip title="Seniority Level" arrow>
                <Chip 
                  icon={<BusinessCenterIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                  label={contact.inferredSeniority} 
                  size="small"
                  variant="outlined"
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    borderColor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                      ? 'rgba(76, 175, 80, 0.3)' 
                      : contact.inferredSeniority === 'Senior' 
                      ? 'rgba(33, 150, 243, 0.3)' 
                      : contact.inferredSeniority === 'Mid-Level' 
                      ? 'rgba(255, 152, 0, 0.3)' 
                      : 'rgba(158, 158, 158, 0.3)',
                    bgcolor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                      ? 'rgba(76, 175, 80, 0.08)' 
                      : contact.inferredSeniority === 'Senior' 
                      ? 'rgba(33, 150, 243, 0.08)' 
                      : contact.inferredSeniority === 'Mid-Level' 
                      ? 'rgba(255, 152, 0, 0.08)' 
                      : 'rgba(158, 158, 158, 0.08)',
                    color: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                      ? '#4CAF50' 
                      : contact.inferredSeniority === 'Senior' 
                      ? '#2196F3' 
                      : contact.inferredSeniority === 'Mid-Level' 
                      ? '#FF9800' 
                      : '#9E9E9E',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                      opacity: 0.7
                    },
                    '&:hover': {
                      borderColor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                        ? 'rgba(76, 175, 80, 0.5)' 
                        : contact.inferredSeniority === 'Senior' 
                        ? 'rgba(33, 150, 243, 0.5)' 
                        : contact.inferredSeniority === 'Mid-Level' 
                        ? 'rgba(255, 152, 0, 0.5)' 
                        : 'rgba(158, 158, 158, 0.5)',
                      bgcolor: (contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive') 
                        ? 'rgba(76, 175, 80, 0.12)' 
                        : contact.inferredSeniority === 'Senior' 
                        ? 'rgba(33, 150, 243, 0.12)' 
                        : contact.inferredSeniority === 'Mid-Level' 
                        ? 'rgba(255, 152, 0, 0.12)' 
                        : 'rgba(158, 158, 158, 0.12)',
                    },
                    transition: 'all 0.2s ease'
                  }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Last Updated - Mobile */}
        {contact.lastEnrichedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', mt: 1, display: 'block' }}>
            Last updated: {(() => {
              try {
                // Handle Firestore timestamp
                if (contact.lastEnrichedAt.toDate) {
                  return contact.lastEnrichedAt.toDate().toLocaleString();
                }
                // Handle string or number
                const date = new Date(contact.lastEnrichedAt);
                if (isNaN(date.getTime())) {
                  return 'Recently';
                }
                return date.toLocaleString();
              } catch (error) {
                return 'Recently';
              }
            })()}
          </Typography>
        )}
      </Box>

      {/* Message Drawer */}
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={(() => {
          const recipients: MessageRecipient[] = [];
          if (messageDrawerChannel === 'email' && contact.email) {
            recipients.push({
              userId: '',
              name: getDisplayName() || contact.email.split('@')[0],
              email: contact.email,
            });
          } else if (messageDrawerChannel === 'sms' && (contact.phone || contact.workPhone)) {
            recipients.push({
              userId: '',
              name: getDisplayName() || (contact.phone || contact.workPhone),
              phone: contact.phone || contact.workPhone,
            });
          }
          return recipients;
        })()}
        tenantId={tenantId}
        defaultChannels={[messageDrawerChannel]}
        onSend={() => {
          setMessageDrawerOpen(false);
        }}
      />

      <ImageCropDialog
        open={cropOpen}
        title="Edit contact photo"
        imageSrc={pendingImageSrc}
        cropShape="round"
        aspect={1}
        confirmLabel={avatarLoading ? 'Saving…' : 'Save'}
        loading={avatarLoading}
        onCancel={() => {
          if (avatarLoading) return;
          setCropOpen(false);
          setPendingImageSrc(null);
          if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
        }}
        onConfirm={handleConfirmCroppedAvatar}
      />
    </Box>
  );
};

export default ContactHeader;

