import React from 'react';
import {
  Box,
  Typography,
  Avatar,
  Chip,
  Button,
  IconButton,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  Work as WorkIcon,
  LinkedIn as LinkedInIcon,
  Facebook as FacebookIcon,
  Business as BusinessIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import MUILink from '@mui/material/Link';

interface LocationHeaderProps {
  location: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    type?: string;
    phone?: string;
  };
  company: {
    id: string;
    companyName?: string;
    name?: string;
    logo?: string;
    website?: string;
    linkedin?: string;
    indeed?: string;
    facebook?: string;
  };
  companyId: string;
  routePrefix?: 'crm' | 'recruiter';
  
  // Action button handlers
  onAddNote?: () => void;
  
  // Helper to ensure URL has protocol
  ensureUrlProtocol?: (url: string) => string;
}

const LocationHeader: React.FC<LocationHeaderProps> = ({
  location,
  company,
  companyId,
  routePrefix = 'crm',
  onAddNote,
  ensureUrlProtocol,
}) => {
  const navigate = useNavigate();
  
  const companyName = company?.companyName || company?.name || 'Company';
  const companyLogo = company?.logo;
  
  // Helper to ensure URL has protocol (do not treat phone numbers as URLs)
  const ensureProtocol = (url: string): string => {
    if (ensureUrlProtocol) {
      return ensureUrlProtocol(url);
    }
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (/^[\d\s().\-+xX]+$/.test(trimmed) || (trimmed.length <= 20 && !trimmed.includes('.') && /\d{3}/.test(trimmed))) return '';
    return 'https://' + trimmed;
  };
  
  // Get company initial for avatar
  const getCompanyInitial = () => {
    return (companyName || 'C').charAt(0).toUpperCase();
  };
  
  // Build full address string
  const getFullAddress = () => {
    return [
      location.address,
      location.city,
      location.state,
      location.zipCode
    ].filter(Boolean).join(', ');
  };
  
  const routePath = routePrefix === 'recruiter' ? '/recruiter' : '/crm';
  
  return (
    <Box
      sx={{
        p: 3,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
        mb: 3,
      }}
    >
      {/* Desktop Layout */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
          {/* Company Logo/Avatar */}
          <Box sx={{ position: 'relative' }}>
            <Avatar
              src={companyLogo}
              alt={companyName}
              sx={{ 
                width: 120, 
                height: 120,
                bgcolor: 'primary.main',
                fontSize: '2.5rem',
                fontWeight: 'bold',
                border: '3px solid',
                borderColor: 'background.paper',
                boxShadow: 'none',
              }}
            >
              {getCompanyInitial()}
            </Avatar>
          </Box>

          {/* Location Information */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
              <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.75rem' }}>
                {location.name}
              </Typography>
            </Box>
            
            {/* Location Type */}
            {location.type && (
              <Chip
                label={location.type}
                size="small"
                sx={{
                  variant: 'outlined',
                  height: '28px',
                  borderRadius: 1,
                  maxWidth: 'fit-content',
                  my: 0.5,
                  borderColor: 'primary.main',
                  bgcolor: 'primary.50',
                  color: 'text.primary',
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  '& .MuiChip-label': {
                    px: 1.25,
                  },
                }}
              />
            )}
            
            {/* Company Name */}
            <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <BusinessIcon sx={{ fontSize: 18, color: 'primary.main' }} />
              <MUILink
                underline="hover"
                color="primary"
                href={`${routePath}/companies/${companyId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`${routePath}/companies/${companyId}`);
                }}
                sx={{ cursor: 'pointer', fontWeight: 'normal' }}
              >
                {companyName}
              </MUILink>
            </Typography>

            {/* Location Phone Number */}
            {location.phone && (
              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                <PhoneIcon sx={{ fontSize: 18 }} />
                {location.phone}
              </Typography>
            )}

            {/* Location Address */}
            {getFullAddress() && (
              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                <LocationIcon sx={{ fontSize: 18 }} />
                {getFullAddress()}
              </Typography>
            )}

            {/* Company Social Media Icons */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
              <IconButton
                size="small"
                sx={{ 
                  p: 1,
                  color: company?.website ? 'primary.main' : 'text.disabled',
                  bgcolor: company?.website ? 'action.hover' : 'transparent',
                  borderRadius: 1,
                  '&:hover': {
                    color: company?.website ? 'primary.dark' : 'text.disabled',
                    bgcolor: company?.website ? 'action.selected' : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }
                }}
                onClick={() => {
                  if (company?.website) {
                    window.open(ensureProtocol(company.website), '_blank');
                  }
                }}
                title={company?.website ? 'Visit Website' : 'Add Website URL'}
              >
                <LanguageIcon sx={{ fontSize: 20 }} />
              </IconButton>
              
              <IconButton
                size="small"
                sx={{ 
                  p: 1,
                  color: company?.linkedin ? 'primary.main' : 'text.disabled',
                  bgcolor: company?.linkedin ? 'action.hover' : 'transparent',
                  borderRadius: 1,
                  '&:hover': {
                    color: company?.linkedin ? 'primary.dark' : 'text.disabled',
                    bgcolor: company?.linkedin ? 'action.selected' : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }
                }}
                onClick={() => {
                  if (company?.linkedin) {
                    window.open(ensureProtocol(company.linkedin), '_blank');
                  }
                }}
                title={company?.linkedin ? 'Open LinkedIn' : 'Add LinkedIn URL'}
              >
                <LinkedInIcon sx={{ fontSize: 20 }} />
              </IconButton>
              
              <IconButton
                size="small"
                sx={{ 
                  p: 1,
                  color: company?.indeed ? 'primary.main' : 'text.disabled',
                  bgcolor: company?.indeed ? 'action.hover' : 'transparent',
                  borderRadius: 1,
                  '&:hover': {
                    color: company?.indeed ? 'primary.dark' : 'text.disabled',
                    bgcolor: company?.indeed ? 'action.selected' : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }
                }}
                onClick={() => {
                  if (company?.indeed) {
                    window.open(ensureProtocol(company.indeed), '_blank');
                  }
                }}
                title={company?.indeed ? 'View Jobs on Indeed' : 'Add Indeed URL'}
              >
                <WorkIcon sx={{ fontSize: 20 }} />
              </IconButton>
              
              <IconButton
                size="small"
                sx={{ 
                  p: 1,
                  color: company?.facebook ? 'primary.main' : 'text.disabled',
                  bgcolor: company?.facebook ? 'action.hover' : 'transparent',
                  borderRadius: 1,
                  '&:hover': {
                    color: company?.facebook ? 'primary.dark' : 'text.disabled',
                    bgcolor: company?.facebook ? 'action.selected' : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }
                }}
                onClick={() => {
                  if (company?.facebook) {
                    window.open(ensureProtocol(company.facebook), '_blank');
                  }
                }}
                title={company?.facebook ? 'View Facebook Page' : 'Add Facebook URL'}
              >
                <FacebookIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Box>
          </Box>
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
          {onAddNote && (
            <Button 
              variant="outlined" 
              startIcon={<AddIcon />}
              onClick={onAddNote}
              size="small"
              sx={{
                height: '28px',
                borderRadius: 1,
                px: 1.25,
                fontSize: '0.8125rem',
                minWidth: 'auto',
                textTransform: 'none',
              }}
            >
              Add Note
            </Button>
          )}
        </Box>
      </Box>

      {/* Mobile Layout */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 2 }}>
        {/* Avatar and Action Buttons Row */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Avatar
            src={companyLogo}
            alt={companyName}
            sx={{ 
              width: 96, 
              height: 96,
              bgcolor: 'primary.main',
              fontSize: '2rem',
              fontWeight: 'bold',
              border: '3px solid',
              borderColor: 'background.paper',
              boxShadow: 'none',
            }}
          >
            {getCompanyInitial()}
          </Avatar>
          
          {/* Action Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {onAddNote && (
              <Button 
                variant="outlined" 
                startIcon={<AddIcon />}
                onClick={onAddNote}
                size="small"
                sx={{
                  height: '28px',
                  borderRadius: 1,
                  px: 1.5,
                  fontSize: '0.8125rem',
                  minWidth: 'auto',
                  textTransform: 'none',
                }}
              >
                Note
              </Button>
            )}
          </Box>
        </Box>

        {/* Location Information */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            {location.name}
          </Typography>
          
          {/* Location Type */}
          {location.type && (
            <Chip
              label={location.type}
              size="small"
              sx={{
                variant: 'outlined',
                height: '28px',
                borderRadius: 1,
                maxWidth: 'fit-content',
                my: 0.5,
                borderColor: 'primary.main',
                bgcolor: 'primary.50',
                color: 'text.primary',
                fontWeight: 500,
                fontSize: '0.8125rem',
                '& .MuiChip-label': {
                  px: 1.25,
                },
              }}
            />
          )}
          
          {/* Company Name */}
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <BusinessIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            <MUILink
              underline="hover"
              color="primary"
              href={`${routePath}/companies/${companyId}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`${routePath}/companies/${companyId}`);
              }}
              sx={{ cursor: 'pointer', fontWeight: 'normal' }}
            >
              {companyName}
            </MUILink>
          </Typography>

          {/* Location Phone Number */}
          {location.phone && (
            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <PhoneIcon sx={{ fontSize: 16 }} />
              {location.phone}
            </Typography>
          )}

          {/* Location Address */}
          {getFullAddress() && (
            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <LocationIcon sx={{ fontSize: 16 }} />
              {getFullAddress()}
            </Typography>
          )}

          {/* Company Social Media Icons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
            <IconButton
              size="small"
              sx={{ 
                p: 1,
                color: company?.website ? 'primary.main' : 'text.disabled',
                bgcolor: company?.website ? 'action.hover' : 'transparent',
                borderRadius: 1,
              }}
              onClick={() => {
                if (company?.website) {
                  window.open(ensureProtocol(company.website), '_blank');
                }
              }}
              title={company?.website ? 'Visit Website' : 'Add Website URL'}
            >
              <LanguageIcon sx={{ fontSize: 18 }} />
            </IconButton>
            
            <IconButton
              size="small"
              sx={{ 
                p: 1,
                color: company?.linkedin ? 'primary.main' : 'text.disabled',
                bgcolor: company?.linkedin ? 'action.hover' : 'transparent',
                borderRadius: 1,
              }}
              onClick={() => {
                if (company?.linkedin) {
                  window.open(ensureProtocol(company.linkedin), '_blank');
                }
              }}
              title={company?.linkedin ? 'Open LinkedIn' : 'Add LinkedIn URL'}
            >
              <LinkedInIcon sx={{ fontSize: 18 }} />
            </IconButton>
            
            <IconButton
              size="small"
              sx={{ 
                p: 1,
                color: company?.indeed ? 'primary.main' : 'text.disabled',
                bgcolor: company?.indeed ? 'action.hover' : 'transparent',
                borderRadius: 1,
              }}
              onClick={() => {
                if (company?.indeed) {
                  window.open(ensureProtocol(company.indeed), '_blank');
                }
              }}
              title={company?.indeed ? 'View Jobs on Indeed' : 'Add Indeed URL'}
            >
              <WorkIcon sx={{ fontSize: 18 }} />
            </IconButton>
            
            <IconButton
              size="small"
              sx={{ 
                p: 1,
                color: company?.facebook ? 'primary.main' : 'text.disabled',
                bgcolor: company?.facebook ? 'action.hover' : 'transparent',
                borderRadius: 1,
              }}
              onClick={() => {
                if (company?.facebook) {
                  window.open(ensureProtocol(company.facebook), '_blank');
                }
              }}
              title={company?.facebook ? 'View Facebook Page' : 'Add Facebook URL'}
            >
              <FacebookIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default LocationHeader;

