import React from 'react';
import {
  TableRow,
  TableCell,
  Box,
  Typography,
  Avatar,
  Chip,
} from '@mui/material';
import {
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
} from '@mui/icons-material';
import FavoriteButton from './FavoriteButton';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';

interface ContactTableRowProps {
  contact: any;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => string[];
  onRowClick: (contact: any) => void;
  getAvatarColor: (name: string) => string;
  getAvatarTextColor: (name: string) => string;
  getInitials: (contact: any) => string;
  columns: {
    favorites?: boolean;
    name?: boolean;
    jobTitle?: boolean;
    title?: boolean;
    role?: boolean;
    contactInfo?: boolean;
    company?: boolean;
    location?: boolean;
    lastActivity?: boolean;
  };
  companies?: any[];
  locations?: any[];
  lastActivity?: any;
  formatRelativeTime?: (activity: any) => string;
  getRoleLabel?: (role: string) => string;
  getRoleColor?: (role: string) => 'primary' | 'success' | 'warning' | 'info' | 'secondary' | 'default';
  rowIndex?: number; // For alternating row colors
}

const ContactTableRow: React.FC<ContactTableRowProps> = ({
  contact,
  isFavorite,
  toggleFavorite,
  onRowClick,
  getAvatarColor,
  getAvatarTextColor,
  getInitials,
  columns,
  companies = [],
  locations = [],
  lastActivity,
  formatRelativeTime,
  getRoleLabel,
  getRoleColor,
  rowIndex = 0,
}) => {
  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(contact.id);
  };

  const getCompanyName = () => {
    if (contact.companyName) return contact.companyName;
    if (contact.companyId) {
      const company = companies.find(c => c.id === contact.companyId);
      if (company) return company.companyName || company.name || '-';
    }
    const assocCompanies = (contact.associations?.companies || []).map((c: any) => 
      typeof c === 'string' ? c : c?.id
    ).filter(Boolean);
    const primaryCompanyId = assocCompanies[0];
    const company = companies.find(c => c.id === primaryCompanyId);
    return company?.companyName || company?.name || '-';
  };

  const getLocationName = () => {
    if (contact.locationName) return contact.locationName;
    if (contact.locationId) {
      const location = locations.find(loc => loc.id === contact.locationId);
      if (location) {
        const locationName = location.name || location.nickname || 'Unknown Location';
        const cityState = [location.city, location.state].filter(Boolean).join(', ');
        const locationCode = location.code ? ` [${location.code}]` : '';
        return cityState ? `${locationName}${locationCode} (${cityState})` : `${locationName}${locationCode}`;
      }
    }
    const assocLocs = (contact.associations?.locations || []) as any[];
    const obj = assocLocs.find(l => typeof l === 'object');
    const locName = obj?.snapshot?.name || obj?.name;
    const locCode = obj?.snapshot?.code || obj?.code;
    if (locName) {
      const codeDisplay = locCode ? ` [${locCode}]` : '';
      return `${locName}${codeDisplay}`;
    }
    if (contact.city && contact.state) return `${contact.city}, ${contact.state}`;
    return '-';
  };

  const fullName = contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Contact';

  return (
    <TableRow 
      hover
      onClick={() => onRowClick(contact)}
      sx={{ 
        // Inbox-standard row height
        height: '44px',
        cursor: 'pointer',
        bgcolor: rowIndex % 2 === 0 ? 'background.paper' : '#FAFAFA',
        transition: 'background-color 0.15s ease',
        '&:hover': {
          bgcolor: 'action.hover'
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2
        },
        '& td': {
          borderBottom: '1px solid',
          borderColor: 'divider'
        }
      }}
    >
      {columns.favorites && (
        <TableCell 
          onClick={handleFavoriteClick}
          sx={{ 
            width: '56px',
            minWidth: '56px',
            maxWidth: '56px',
            px: 1.5,
            py: 0.5,
            position: 'sticky',
            left: 0,
            zIndex: 2,
            bgcolor: rowIndex % 2 === 0 ? 'background.paper' : '#FAFAFA',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <FavoriteButton
              itemId={contact.id}
              favoriteType="contacts"
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              size="small"
              tooltipText={{
                favorited: 'Remove from favorites',
                notFavorited: 'Add to favorites'
              }}
            />
          </Box>
        </TableCell>
      )}

      {columns.name && (
        <TableCell sx={{ pl: 2, pr: 2, py: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar 
              src={contact.avatar || contact.logoUrl}
              sx={{ 
                width: TABLE_AVATAR_SIZE, 
                height: TABLE_AVATAR_SIZE,
                backgroundColor: getAvatarColor(fullName),
                color: getAvatarTextColor(fullName),
                fontWeight: 600,
                fontSize: '12px',
                flexShrink: 0
              }}
            >
              {getInitials(contact)}
            </Avatar>
            <Typography 
              variant="body2" 
              fontWeight={600} 
              color="text.primary"
              sx={{ 
                fontSize: '0.9375rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {fullName}
            </Typography>
          </Box>
        </TableCell>
      )}

      {columns.jobTitle && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          <Typography 
            variant="body2" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {contact.jobTitle || contact.title || '-'}
          </Typography>
        </TableCell>
      )}

      {columns.title && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          <Typography 
            variant="body2" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {contact.title || contact.jobTitle || '-'}
          </Typography>
        </TableCell>
      )}

      {columns.role && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          {contact.role && getRoleLabel && getRoleColor ? (
            <Chip
              label={getRoleLabel(contact.role)}
              size="small"
              color={getRoleColor(contact.role)}
              sx={{ 
                height: 24, 
                fontSize: '0.75rem',
                fontWeight: 500
              }}
            />
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.875rem' }}>
              -
            </Typography>
          )}
        </TableCell>
      )}

      {columns.contactInfo && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          {contact.email || contact.phone ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {contact.email && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <EmailIcon sx={{ color: 'text.disabled', fontSize: 14, flexShrink: 0 }} />
                  <Typography 
                    variant="body2" 
                    color="text.secondary"
                    sx={{ 
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '180px',
                      fontSize: '0.8125rem'
                    }}
                    title={contact.email}
                  >
                    {contact.email}
                  </Typography>
                </Box>
              )}
              {contact.phone && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <PhoneIcon sx={{ color: 'text.disabled', fontSize: 14, flexShrink: 0 }} />
                  <Typography 
                    variant="body2" 
                    color="text.secondary" 
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    {formatPhoneNumber(contact.phone)}
                  </Typography>
                </Box>
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.875rem' }}>
              -
            </Typography>
          )}
        </TableCell>
      )}

      {columns.company && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          {getCompanyName() !== '-' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <BusinessIcon sx={{ color: 'text.disabled', fontSize: 14, flexShrink: 0 }} />
              <Typography 
                variant="body2" 
                color="text.secondary"
                sx={{ 
                  fontSize: '0.875rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '160px'
                }}
                title={getCompanyName()}
              >
                {getCompanyName()}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.875rem' }}>
              -
            </Typography>
          )}
        </TableCell>
      )}

      {columns.location && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          {getLocationName() !== '-' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LocationOnIcon sx={{ color: 'text.disabled', fontSize: 14, flexShrink: 0 }} />
              <Typography 
                variant="body2" 
                color="text.secondary"
                sx={{ 
                  fontSize: '0.875rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '130px'
                }}
                title={getLocationName()}
              >
                {getLocationName()}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.875rem' }}>
              -
            </Typography>
          )}
        </TableCell>
      )}

      {columns.lastActivity && (
        <TableCell sx={{ px: 1.5, py: 1.5 }}>
          <Typography 
            variant="body2" 
            color={lastActivity ? "text.secondary" : "text.disabled"}
            sx={{ fontSize: '0.875rem' }}
          >
            {lastActivity && formatRelativeTime
              ? formatRelativeTime(lastActivity)
              : 'No Activity'
            }
          </Typography>
        </TableCell>
      )}
    </TableRow>
  );
};

export default ContactTableRow;

