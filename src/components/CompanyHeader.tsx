import React, { useState, useRef } from 'react';
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
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  Work as WorkIcon,
  LinkedIn as LinkedInIcon,
  Facebook as FacebookIcon,
  Twitter as TwitterIcon,
  Add as AddIcon,
  RocketLaunch as RocketLaunchIcon,
  CheckCircle as CheckCircleIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  AttachMoney as DealIcon,
  AccountTree as AccountTreeIcon,
  Edit as EditIcon,
  AccountBalance as AccountBalanceIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { db, storage } from '../firebase';
import FavoriteButton from './FavoriteButton';
import ImageCropDialog from './common/ImageCropDialog';

interface NavigationLink {
  type: 'company';
  id: string;
  name: string;
}

interface CompanyHeaderProps {
  company: {
    id: string;
    companyName?: string;
    name?: string;
    logo?: string;
    foundedYear?: number;
    estimatedEmployees?: number;
    annualRevenue?: number | string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    zipcode?: string;
    website?: string;
    linkedin?: string;
    indeed?: string;
    facebook?: string;
    twitter?: string;
    angellist?: string;
    crunchbase?: string;
    industry?: string;
    subIndustry?: string;
    parentCompany?: any;
    childCompanies?: any[];
    msp?: any;
    pipelineValue?: {
      low?: number;
      high?: number;
    };
    lastEnrichedAt?: any;
    relationships?: {
      strength?: 'weak' | 'medium' | 'strong';
    };
    pipeline?: {
      status?: 'excellent' | 'good' | 'needs_attention';
    };
  };
  tenantId: string;
  routePrefix?: 'crm' | 'recruiter'; // Determines navigation routes
  
  // Favorite functionality
  favoriteType?: 'companies';
  isFavorite?: (itemId: string) => boolean;
  toggleFavorite?: (itemId: string) => string[];
  
  // Navigation links (optional - for related companies)
  navigationLinks?: NavigationLink[];
  
  // Metrics for relationship/pipeline calculation
  metrics?: {
    contactsCount?: number;
    dealsCount?: number;
  };
  
  // Action button handlers
  onAddNote?: () => void;
  onAIEnhance?: () => void;
  onLogActivity?: () => void;
  onViewInCRM?: () => void; // For recruiter view
  
  // Loading states
  aiEnhancing?: boolean;
  
  // Avatar upload/delete handlers (optional - if not provided, won't show upload buttons)
  onAvatarUpload?: (url: string) => Promise<void>;
  onAvatarDelete?: () => Promise<void>;
  
  // Industry helper function (optional)
  getIndustryByCode?: (code: string) => { name: string } | null;
  
  // Company name display component (optional - for related company links)
  CompanyNameDisplay?: React.ComponentType<{ tenantId: string; companyId: string }>;
  /** When the company is linked to a recruiter account, show account icon first in the icon row and link here */
  linkedAccount?: { id: string; name?: string } | null;
}

const AngelListIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? '/img/angellist-icon-blue.svg' : '/img/angellist-icon-grey.svg'}
      alt="AngelList"
      style={{ width: '16px', height: '16px' }}
    />
  </Box>
);

const CrunchbaseIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? '/img/crunchbase-icon-blue.svg' : '/img/crunchbase-icon-grey.svg'}
      alt="Crunchbase"
      style={{ width: '18px', height: '18px' }}
    />
  </Box>
);

const CompanyHeader: React.FC<CompanyHeaderProps> = ({
  company,
  tenantId,
  routePrefix = 'crm',
  favoriteType = 'companies',
  isFavorite,
  toggleFavorite,
  navigationLinks = [],
  metrics,
  onAddNote,
  onAIEnhance,
  onLogActivity,
  onViewInCRM,
  aiEnhancing = false,
  onAvatarUpload,
  onAvatarDelete,
  getIndustryByCode,
  CompanyNameDisplay,
  linkedAccount,
}) => {
  const navigate = useNavigate();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [logoHover, setLogoHover] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  
  const companyName = company.companyName || company.name || 'Company';
  
  // Calculate relationship strength based on contacts
  const contactsCount = metrics?.contactsCount || 0;
  const relationshipStrength = contactsCount > 5 ? 'Strong' : contactsCount > 2 ? 'Medium' : 'Weak';
  const relationshipColor = contactsCount > 5 ? 'success' : contactsCount > 2 ? 'warning' : 'error';
  
  // Calculate pipeline status based on deals
  const dealsCount = metrics?.dealsCount || 0;
  const pipelineStatus = dealsCount > 3 ? 'Excellent' : dealsCount > 1 ? 'Good' : 'Needs Attention';
  const pipelineColor = dealsCount > 3 ? 'success' : dealsCount > 1 ? 'warning' : 'error';
  
  // Get initial for avatar
  const getInitials = (name: string) => {
    return (name || 'C').charAt(0).toUpperCase();
  };
  
  // Handle logo upload
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onAvatarUpload) return;

    // File size validation
    if (file.size > 2 * 1024 * 1024) {
      console.error('Logo file size must be less than 2MB');
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
      console.error('Error preparing logo crop:', error);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleConfirmCroppedLogo = async (blob: Blob) => {
    if (!onAvatarUpload) return;
    try {
      setUploading(true);

      // Best-effort delete previous logo blob to avoid storage leaks
      if (company.logo) {
        try {
          await deleteObject(ref(storage, company.logo));
        } catch {}
      }

      const logoRef = ref(storage, `tenants/${tenantId}/companies/${company.id}/logo/logo.jpg`);
      await uploadBytes(logoRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(logoRef);
      await onAvatarUpload(downloadURL);

      setCropOpen(false);
      setPendingImageSrc(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
    } catch (error) {
      console.error('Error uploading cropped logo:', error);
    } finally {
      setUploading(false);
    }
  };
  
  // Handle logo delete
  const handleDeleteLogo = async () => {
    if (!company.logo || !onAvatarDelete) return;
    
    try {
      // Delete from storage
      const logoRef = ref(storage, company.logo);
      await deleteObject(logoRef);
      
      // Update company document
      await onAvatarDelete();
    } catch (error) {
      console.error('Error deleting logo:', error);
    }
  };
  
  // Build related companies links from navigationLinks or company data
  const relatedCompanies: Array<{ id: string; name: string; relation: string }> = [];
  
  if (navigationLinks.length > 0) {
    navigationLinks.forEach(link => {
      relatedCompanies.push({ id: link.id, name: link.name, relation: 'related' });
    });
  } else {
    // Build from company data
    const parentId = company.parentCompany;
    if (parentId) {
      const actualParentId = typeof parentId === 'string' ? parentId : 
                           (parentId && typeof parentId === 'object' && parentId.id) ? parentId.id : 
                           null;
      if (actualParentId) {
        relatedCompanies.push({ id: actualParentId, name: 'Parent Company', relation: 'parent' });
      }
    }
    
    const childIds: any[] = Array.isArray(company.childCompanies) ? company.childCompanies : [];
    childIds.forEach((cid) => {
      const actualChildId = typeof cid === 'string' ? cid : 
                          (cid && typeof cid === 'object' && cid.id) ? cid.id : 
                          null;
      if (actualChildId) {
        relatedCompanies.push({ id: actualChildId, name: 'Child Company', relation: 'child' });
      }
    });
    
    const msp = company.msp;
    if (msp) {
      const actualMspId = typeof msp === 'string' ? msp : 
                        (msp && typeof msp === 'object' && msp.id) ? msp.id : 
                        null;
      if (actualMspId) {
        relatedCompanies.push({ id: actualMspId, name: 'MSP', relation: 'msp' });
      }
    }
  }
  
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
              src={company.logo}
              alt={companyName}
              sx={{ 
                width: 96, 
                height: 96,
                bgcolor: company.logo ? 'transparent' : 'primary.main',
                fontSize: '2rem',
                fontWeight: 'bold'
              }}
            >
              {getInitials(companyName)}
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
                id={`logo-upload-mobile-${company.id}`}
                type="file"
                onChange={handleLogoUpload}
                disabled={uploading}
                ref={logoInputRef}
              />
              <label htmlFor={`logo-upload-mobile-${company.id}`}>
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
                  disabled={uploading}
                >
                  {uploading ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <UploadIcon sx={{ fontSize: 14 }} />
                  )}
                </IconButton>
              </label>
              
              {company.logo && onAvatarDelete && (
                <IconButton
                  size="small"
                  onClick={handleDeleteLogo}
                  disabled={uploading}
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
                  {uploading ? (
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
            src={company.logo}
            alt={companyName}
            sx={{ 
              width: 96, 
              height: 96,
              bgcolor: company.logo ? 'transparent' : 'primary.main',
              fontSize: '2rem',
              fontWeight: 'bold'
            }}
          >
            {getInitials(companyName)}
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
          {/* Company Logo/Avatar */}
          <Box
            sx={{ position: 'relative' }}
            onMouseEnter={() => setLogoHover(true)}
            onMouseLeave={() => setLogoHover(false)}
          >
            <Avatar
              src={company.logo}
              alt={companyName}
              sx={{ 
                width: 120, 
                height: 120,
                bgcolor: company.logo ? 'transparent' : 'primary.main',
                fontSize: '2.5rem',
                fontWeight: 'bold',
                border: '3px solid',
                borderColor: 'background.paper',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
            >
              {getInitials(companyName)}
            </Avatar>
            {(onAvatarUpload || onAvatarDelete) && (
              <Box sx={{ 
                position: 'absolute', 
                bottom: -8, 
                right: -8, 
                display: 'flex', 
                gap: 0.5 
              }}>
                {onAvatarUpload && (
                  <>
                    <input
                      accept="image/*"
                      style={{ display: 'none' }}
                      id={`logo-upload-${company.id}`}
                      type="file"
                      onChange={handleLogoUpload}
                      disabled={uploading}
                      ref={logoInputRef}
                    />
                    <label htmlFor={`logo-upload-${company.id}`}>
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
                          display: logoHover ? 'inline-flex' : 'none'
                        }}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <UploadIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    </label>
                  </>
                )}
                {company.logo && onAvatarDelete && (
                  <IconButton
                    size="small"
                    onClick={handleDeleteLogo}
                    disabled={uploading}
                    sx={{
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': { 
                        bgcolor: 'grey.400'
                      },
                      width: 28,
                      height: 28,
                      display: logoHover ? 'inline-flex' : 'none'
                    }}
                  >
                    {uploading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

          {/* Company Information */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>
            {/* Name with Favorite Star */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '1.75rem' }}>
                {companyName}
              </Typography>
              {isFavorite && toggleFavorite && (
                <FavoriteButton
                  itemId={company.id}
                  favoriteType={favoriteType}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="medium"
                  tooltipText={{
                    favorited: 'Remove from favorites',
                    notFavorited: 'Add to favorites',
                  }}
                />
              )}
            </Box>
            
            {/* Pipeline Value (if available) */}
            {company.pipelineValue && typeof company.pipelineValue.low === 'number' && typeof company.pipelineValue.high === 'number' && (
              <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <DealIcon sx={{ fontSize: 18, color: 'success.main' }} />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  ${Number(company.pipelineValue.low || 0).toLocaleString()} – ${Number(company.pipelineValue.high || 0).toLocaleString()}
                </Typography>
              </Box>
            )}

            {/* Company Stats */}
            {(company.foundedYear || company.estimatedEmployees || company.annualRevenue) && (
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 2, 
                mt: 0
              }}>
                {company.foundedYear && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Founded:</Typography>
                    <Typography variant="body2" color="text.primary">{company.foundedYear}</Typography>
                  </Box>
                )}
                {company.estimatedEmployees && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Employees:</Typography>
                    <Typography variant="body2" color="text.primary">{company.estimatedEmployees.toLocaleString()}</Typography>
                  </Box>
                )}
                {company.annualRevenue && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Revenue:</Typography>
                    <Typography variant="body2" color="text.primary">
                      ${typeof company.annualRevenue === 'string' ? company.annualRevenue : company.annualRevenue.toLocaleString()}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {/* Industry Information */}
            {(company.industry || company.subIndustry) && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0 }}>
                {company.industry && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Industry:</Typography>
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                      {getIndustryByCode ? (getIndustryByCode(company.industry)?.name || company.industry) : company.industry}
                    </Typography>
                  </Box>
                )}
                {company.subIndustry && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Sub-Industry:</Typography>
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                      {getIndustryByCode ? (getIndustryByCode(company.subIndustry)?.name || company.subIndustry) : company.subIndustry}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
            
            {/* Address */}
            {(company.address || company.city || company.state) && (
              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <LocationIcon sx={{ fontSize: 16 }} />
                {[
                  company.address,
                  company.city,
                  company.state,
                  company.zip || company.zipcode
                ].filter(Boolean).join(', ')}
              </Typography>
            )}
            
            {/* Related Companies */}
            {relatedCompanies.length > 0 && tenantId && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0 }}>
                <AccountTreeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {relatedCompanies.map((rel, index) => (
                    <React.Fragment key={`${rel.relation}-${rel.id}`}>
                      {CompanyNameDisplay ? (
                        <Box
                          component="button"
                          onClick={() => navigate(`/${routePrefix}/companies/${rel.id}`)}
                          sx={{ 
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textDecoration: 'none',
                            fontWeight: 500,
                            color: 'primary.main',
                            fontSize: '0.875rem',
                            '&:hover': { textDecoration: 'underline' }
                          }}
                        >
                          <CompanyNameDisplay tenantId={tenantId} companyId={rel.id} />
                        </Box>
                      ) : (
                        <Typography
                          variant="body2"
                          color="primary"
                          sx={{ 
                            fontWeight: 500,
                            cursor: 'pointer',
                            '&:hover': { textDecoration: 'underline' }
                          }}
                          onClick={() => navigate(`/${routePrefix}/companies/${rel.id}`)}
                        >
                          {rel.name}
                        </Typography>
                      )}
                      {index < relatedCompanies.length - 1 && (
                        <Typography variant="body2" color="text.secondary">•</Typography>
                      )}
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            )}
            
            {/* Social Media Icons */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {linkedAccount && (
                <Tooltip title={linkedAccount.name ? `Open account: ${linkedAccount.name}` : 'Open account'}>
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
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      },
                      transition: 'all 0.2s ease',
                    }}
                    onClick={() => navigate(`/accounts/${linkedAccount.id}`)}
                  >
                    <AccountBalanceIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              {company.website && (
                <Tooltip title={`Visit ${company.website}`}>
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.website ? 'primary.main' : 'text.disabled',
                      bgcolor: company.website ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.website ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.website ? 'primary.light' : 'transparent',
                        transform: company.website ? 'translateY(-1px)' : 'none',
                        boxShadow: company.website ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.website) {
                        let url = company.website;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <LanguageIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {company.linkedin && (
                <Tooltip title="View LinkedIn Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.linkedin ? 'primary.main' : 'text.disabled',
                      bgcolor: company.linkedin ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.linkedin ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.linkedin ? 'primary.light' : 'transparent',
                        transform: company.linkedin ? 'translateY(-1px)' : 'none',
                        boxShadow: company.linkedin ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.linkedin) {
                        let url = company.linkedin;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <LinkedInIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {company.indeed && (
                <Tooltip title="View Jobs on Indeed">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.indeed ? 'primary.main' : 'text.disabled',
                      bgcolor: company.indeed ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.indeed ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.indeed ? 'primary.light' : 'transparent',
                        transform: company.indeed ? 'translateY(-1px)' : 'none',
                        boxShadow: company.indeed ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.indeed) {
                        let url = company.indeed;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <WorkIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              )}
              
              {company.facebook && (
                <Tooltip title="View Facebook Page">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.facebook ? 'primary.main' : 'text.disabled',
                      bgcolor: company.facebook ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.facebook ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.facebook ? 'primary.light' : 'transparent',
                        transform: company.facebook ? 'translateY(-1px)' : 'none',
                        boxShadow: company.facebook ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.facebook) {
                        let url = company.facebook;
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
              
              {company.twitter && (
                <Tooltip title="View Twitter Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.twitter ? 'primary.main' : 'text.disabled',
                      bgcolor: company.twitter ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.twitter ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.twitter ? 'primary.light' : 'transparent',
                        transform: company.twitter ? 'translateY(-1px)' : 'none',
                        boxShadow: company.twitter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.twitter) {
                        let url = company.twitter;
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

              {company.angellist && (
                <Tooltip title="View AngelList Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.angellist ? 'primary.main' : 'text.disabled',
                      bgcolor: company.angellist ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.angellist ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.angellist ? 'primary.light' : 'transparent',
                        transform: company.angellist ? 'translateY(-1px)' : 'none',
                        boxShadow: company.angellist ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.angellist) {
                        let url = company.angellist;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <AngelListIcon hasUrl={!!company.angellist} />
                  </IconButton>
                </Tooltip>
              )}

              {company.crunchbase && (
                <Tooltip title="View Crunchbase Profile">
                  <IconButton
                    size="small"
                    sx={{ 
                      p: 1,
                      color: company.crunchbase ? 'primary.main' : 'text.disabled',
                      bgcolor: company.crunchbase ? 'action.hover' : 'transparent',
                      borderRadius: 1,
                      '&:hover': {
                        color: company.crunchbase ? 'primary.dark' : 'text.disabled',
                        bgcolor: company.crunchbase ? 'primary.light' : 'transparent',
                        transform: company.crunchbase ? 'translateY(-1px)' : 'none',
                        boxShadow: company.crunchbase ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      },
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => {
                      if (company.crunchbase) {
                        let url = company.crunchbase;
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <CrunchbaseIcon hasUrl={!!company.crunchbase} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            {/* Relationship and Pipeline Status - Modern Badge Design */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
              <Tooltip title="Relationship Strength" arrow>
                <Chip 
                  icon={<LocationIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                  label={relationshipStrength} 
                  size="small"
                  variant="outlined"
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    borderColor: relationshipColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.3)' 
                      : relationshipColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.3)' 
                      : 'rgba(244, 67, 54, 0.3)',
                    bgcolor: relationshipColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.08)' 
                      : relationshipColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.08)' 
                      : 'rgba(244, 67, 54, 0.08)',
                    color: relationshipColor === 'success' 
                      ? '#4CAF50' 
                      : relationshipColor === 'warning' 
                      ? '#FF9800' 
                      : '#F44336',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                      opacity: 0.7
                    },
                    '&:hover': {
                      borderColor: relationshipColor === 'success' 
                        ? 'rgba(76, 175, 80, 0.5)' 
                        : relationshipColor === 'warning' 
                        ? 'rgba(255, 152, 0, 0.5)' 
                        : 'rgba(244, 67, 54, 0.5)',
                      bgcolor: relationshipColor === 'success' 
                        ? 'rgba(76, 175, 80, 0.12)' 
                        : relationshipColor === 'warning' 
                        ? 'rgba(255, 152, 0, 0.12)' 
                        : 'rgba(244, 67, 54, 0.12)',
                    },
                    transition: 'all 0.2s ease'
                  }}
                />
              </Tooltip>
              
              <Tooltip title={`Pipeline Status: ${pipelineStatus}`} arrow>
                <Chip 
                  icon={<DealIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                  label={pipelineStatus} 
                  size="small"
                  variant="outlined"
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    height: '28px',
                    borderRadius: 1,
                    borderColor: pipelineColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.3)' 
                      : pipelineColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.3)' 
                      : 'rgba(244, 67, 54, 0.3)',
                    bgcolor: pipelineColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.08)' 
                      : pipelineColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.08)' 
                      : 'rgba(244, 67, 54, 0.08)',
                    color: pipelineColor === 'success' 
                      ? '#4CAF50' 
                      : pipelineColor === 'warning' 
                      ? '#FF9800' 
                      : '#F44336',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                      opacity: 0.7
                    },
                    '&:hover': {
                      borderColor: pipelineColor === 'success' 
                        ? 'rgba(76, 175, 80, 0.5)' 
                        : pipelineColor === 'warning' 
                        ? 'rgba(255, 152, 0, 0.5)' 
                        : 'rgba(244, 67, 54, 0.5)',
                      bgcolor: pipelineColor === 'success' 
                        ? 'rgba(76, 175, 80, 0.12)' 
                        : pipelineColor === 'warning' 
                        ? 'rgba(255, 152, 0, 0.12)' 
                        : 'rgba(244, 67, 54, 0.12)',
                    },
                    transition: 'all 0.2s ease'
                  }}
                />
              </Tooltip>
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
            </Box>
            {company.lastEnrichedAt && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                Last updated: {(() => {
                  try {
                    // Handle Firestore timestamp
                    if (company.lastEnrichedAt.toDate) {
                      return company.lastEnrichedAt.toDate().toLocaleString();
                    }
                    // Handle string or number
                    const date = new Date(company.lastEnrichedAt);
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

      {/* Mobile: Company Information Section */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        {/* Company Information */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Name with Favorite Star */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {companyName}
            </Typography>
            {isFavorite && toggleFavorite && (
              <FavoriteButton
                itemId={company.id}
                favoriteType={favoriteType}
                isFavorite={isFavorite}
                toggleFavorite={toggleFavorite}
                size="medium"
                tooltipText={{
                  favorited: 'Remove from favorites',
                  notFavorited: 'Add to favorites',
                }}
              />
            )}
          </Box>
          
          {/* Pipeline Value (if available) */}
          {company.pipelineValue && typeof company.pipelineValue.low === 'number' && typeof company.pipelineValue.high === 'number' && (
            <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <DealIcon sx={{ fontSize: 18, color: 'success.main' }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                ${Number(company.pipelineValue.low || 0).toLocaleString()} – ${Number(company.pipelineValue.high || 0).toLocaleString()}
              </Typography>
            </Box>
          )}

          {/* Company Stats */}
          {(company.foundedYear || company.estimatedEmployees || company.annualRevenue) && (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 2, 
              mt: 0,
              flexWrap: 'wrap'
            }}>
              {company.foundedYear && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Founded:</Typography>
                  <Typography variant="body2" color="text.primary">{company.foundedYear}</Typography>
                </Box>
              )}
              {company.estimatedEmployees && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Employees:</Typography>
                  <Typography variant="body2" color="text.primary">{company.estimatedEmployees.toLocaleString()}</Typography>
                </Box>
              )}
              {company.annualRevenue && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Revenue:</Typography>
                  <Typography variant="body2" color="text.primary">
                    ${typeof company.annualRevenue === 'string' ? company.annualRevenue : company.annualRevenue.toLocaleString()}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Industry Information */}
          {(company.industry || company.subIndustry) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0, flexWrap: 'wrap' }}>
              {company.industry && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Industry:</Typography>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                    {getIndustryByCode ? (getIndustryByCode(company.industry)?.name || company.industry) : company.industry}
                  </Typography>
                </Box>
              )}
              {company.subIndustry && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Sub-Industry:</Typography>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                    {getIndustryByCode ? (getIndustryByCode(company.subIndustry)?.name || company.subIndustry) : company.subIndustry}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
          
          {/* Address */}
          {(company.address || company.city || company.state) && (
            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <LocationIcon sx={{ fontSize: 16 }} />
              {[
                company.address,
                company.city,
                company.state,
                company.zip || company.zipcode
              ].filter(Boolean).join(', ')}
            </Typography>
          )}
          
          {/* Related Companies */}
          {relatedCompanies.length > 0 && tenantId && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
              <AccountTreeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {relatedCompanies.map((rel, index) => (
                  <React.Fragment key={`${rel.relation}-${rel.id}`}>
                    {index > 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ mx: 0.5 }}>
                        /
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {CompanyNameDisplay ? (
                        <Box
                          component="button"
                          onClick={() => navigate(`/${routePrefix}/companies/${rel.id}`)}
                          sx={{ 
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textDecoration: 'none',
                            fontWeight: 500,
                            color: 'primary.main',
                            fontSize: '0.875rem',
                            '&:hover': { textDecoration: 'underline' }
                          }}
                        >
                          <CompanyNameDisplay tenantId={tenantId} companyId={rel.id} />
                        </Box>
                      ) : (
                        <Typography
                          variant="body2"
                          color="primary"
                          sx={{ 
                            cursor: 'pointer', 
                            textDecoration: 'underline', 
                            '&:hover': { color: 'primary.dark' } 
                          }}
                          onClick={() => navigate(`/${routePrefix}/companies/${rel.id}`)}
                        >
                          {rel.name}
                        </Typography>
                      )}
                    </Box>
                  </React.Fragment>
                ))}
              </Box>
            </Box>
          )}
            
          {/* Social Media Icons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, mt: 0, flexWrap: 'wrap' }}>
            {company.website && (
              <Tooltip title={`Visit ${company.website}`}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.website ? 'primary.main' : 'text.disabled',
                    bgcolor: company.website ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.website ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.website ? 'primary.light' : 'transparent',
                      transform: company.website ? 'translateY(-1px)' : 'none',
                      boxShadow: company.website ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.website) {
                      let url = company.website;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {company.linkedin && (
              <Tooltip title="View LinkedIn Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.linkedin ? 'primary.main' : 'text.disabled',
                    bgcolor: company.linkedin ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.linkedin ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.linkedin ? 'primary.light' : 'transparent',
                      transform: company.linkedin ? 'translateY(-1px)' : 'none',
                      boxShadow: company.linkedin ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.linkedin) {
                      let url = company.linkedin;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {company.indeed && (
              <Tooltip title="View Jobs on Indeed">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.indeed ? 'primary.main' : 'text.disabled',
                    bgcolor: company.indeed ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.indeed ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.indeed ? 'primary.light' : 'transparent',
                      transform: company.indeed ? 'translateY(-1px)' : 'none',
                      boxShadow: company.indeed ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.indeed) {
                      let url = company.indeed;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <WorkIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
            
            {company.facebook && (
              <Tooltip title="View Facebook Page">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.facebook ? 'primary.main' : 'text.disabled',
                    bgcolor: company.facebook ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.facebook ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.facebook ? 'primary.light' : 'transparent',
                      transform: company.facebook ? 'translateY(-1px)' : 'none',
                      boxShadow: company.facebook ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.facebook) {
                      let url = company.facebook;
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
            
            {company.twitter && (
              <Tooltip title="View Twitter Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.twitter ? 'primary.main' : 'text.disabled',
                    bgcolor: company.twitter ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.twitter ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.twitter ? 'primary.light' : 'transparent',
                      transform: company.twitter ? 'translateY(-1px)' : 'none',
                      boxShadow: company.twitter ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.twitter) {
                      let url = company.twitter;
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

            {company.angellist && (
              <Tooltip title="View AngelList Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.angellist ? 'primary.main' : 'text.disabled',
                    bgcolor: company.angellist ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.angellist ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.angellist ? 'primary.light' : 'transparent',
                      transform: company.angellist ? 'translateY(-1px)' : 'none',
                      boxShadow: company.angellist ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.angellist) {
                      let url = company.angellist;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <AngelListIcon hasUrl={!!company.angellist} />
                </IconButton>
              </Tooltip>
            )}

            {company.crunchbase && (
              <Tooltip title="View Crunchbase Profile">
                <IconButton
                  size="small"
                  sx={{ 
                    p: 1,
                    color: company.crunchbase ? 'primary.main' : 'text.disabled',
                    bgcolor: company.crunchbase ? 'action.hover' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.crunchbase ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.crunchbase ? 'primary.light' : 'transparent',
                      transform: company.crunchbase ? 'translateY(-1px)' : 'none',
                      boxShadow: company.crunchbase ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    },
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => {
                    if (company.crunchbase) {
                      let url = company.crunchbase;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                >
                  <CrunchbaseIcon hasUrl={!!company.crunchbase} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Relationship and Pipeline Status - Modern Badge Design */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
            <Tooltip title="Relationship Strength" arrow>
              <Chip 
                icon={<LocationIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                label={relationshipStrength} 
                size="small"
                variant="outlined"
                sx={{ 
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  height: '28px',
                  borderRadius: 1,
                  borderColor: relationshipColor === 'success' 
                    ? 'rgba(76, 175, 80, 0.3)' 
                    : relationshipColor === 'warning' 
                    ? 'rgba(255, 152, 0, 0.3)' 
                    : 'rgba(244, 67, 54, 0.3)',
                  bgcolor: relationshipColor === 'success' 
                    ? 'rgba(76, 175, 80, 0.08)' 
                    : relationshipColor === 'warning' 
                    ? 'rgba(255, 152, 0, 0.08)' 
                    : 'rgba(244, 67, 54, 0.08)',
                  color: relationshipColor === 'success' 
                    ? '#4CAF50' 
                    : relationshipColor === 'warning' 
                    ? '#FF9800' 
                    : '#F44336',
                  '& .MuiChip-icon': {
                    color: 'inherit',
                    opacity: 0.7
                  },
                  '&:hover': {
                    borderColor: relationshipColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.5)' 
                      : relationshipColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.5)' 
                      : 'rgba(244, 67, 54, 0.5)',
                    bgcolor: relationshipColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.12)' 
                      : relationshipColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.12)' 
                      : 'rgba(244, 67, 54, 0.12)',
                  },
                  transition: 'all 0.2s ease'
                }}
              />
            </Tooltip>
            
            <Tooltip title={`Pipeline Status: ${pipelineStatus}`} arrow>
              <Chip 
                icon={<DealIcon sx={{ fontSize: '14px !important', ml: '4px' }} />}
                label={pipelineStatus} 
                size="small"
                variant="outlined"
                sx={{ 
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  height: '28px',
                  borderRadius: 1,
                  borderColor: pipelineColor === 'success' 
                    ? 'rgba(76, 175, 80, 0.3)' 
                    : pipelineColor === 'warning' 
                    ? 'rgba(255, 152, 0, 0.3)' 
                    : 'rgba(244, 67, 54, 0.3)',
                  bgcolor: pipelineColor === 'success' 
                    ? 'rgba(76, 175, 80, 0.08)' 
                    : pipelineColor === 'warning' 
                    ? 'rgba(255, 152, 0, 0.08)' 
                    : 'rgba(244, 67, 54, 0.08)',
                  color: pipelineColor === 'success' 
                    ? '#4CAF50' 
                    : pipelineColor === 'warning' 
                    ? '#FF9800' 
                    : '#F44336',
                  '& .MuiChip-icon': {
                    color: 'inherit',
                    opacity: 0.7
                  },
                  '&:hover': {
                    borderColor: pipelineColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.5)' 
                      : pipelineColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.5)' 
                      : 'rgba(244, 67, 54, 0.5)',
                    bgcolor: pipelineColor === 'success' 
                      ? 'rgba(76, 175, 80, 0.12)' 
                      : pipelineColor === 'warning' 
                      ? 'rgba(255, 152, 0, 0.12)' 
                      : 'rgba(244, 67, 54, 0.12)',
                  },
                  transition: 'all 0.2s ease'
                }}
              />
            </Tooltip>
          </Box>
        </Box>

        {/* Last Updated - Mobile */}
        {company.lastEnrichedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', mt: 1, display: 'block' }}>
            Last updated: {(() => {
              try {
                // Handle Firestore timestamp
                if (company.lastEnrichedAt.toDate) {
                  return company.lastEnrichedAt.toDate().toLocaleString();
                }
                // Handle string or number
                const date = new Date(company.lastEnrichedAt);
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

      <ImageCropDialog
        open={cropOpen}
        title="Edit company logo"
        imageSrc={pendingImageSrc}
        cropShape="rect"
        aspect={1}
        confirmLabel={uploading ? 'Saving…' : 'Save'}
        loading={uploading}
        onCancel={() => {
          if (uploading) return;
          setCropOpen(false);
          setPendingImageSrc(null);
          if (logoInputRef.current) logoInputRef.current.value = '';
        }}
        onConfirm={handleConfirmCroppedLogo}
      />
    </Box>
  );
};

export default CompanyHeader;

