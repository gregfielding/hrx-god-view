import React from 'react';
import {
  TableRow,
  TableCell,
  Box,
  Typography,
  Avatar,
} from '@mui/material';
import {
  Person as PersonIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import FavoriteButton from './FavoriteButton';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';

interface CompanyTableRowProps {
  company: any;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => string[];
  onRowClick: (company: any) => void;
  getAvatarColor: (name: string) => string;
  getAvatarTextColor: (name: string) => string;
  columns: {
    favorites?: boolean;
    avatar?: boolean;
    companyName?: boolean;
    contacts?: boolean;
    deals?: boolean;
    pipelineValue?: boolean;
    headquarters?: boolean;
    salespeople?: boolean;
  };
  getCompanyContacts: (companyId: string) => any[];
  getCompanyDeals: (companyId: string) => any[];
  getCompanyPipelineValue: (company: any) => { totalLow: number; totalHigh: number; dealCount: number };
  getCompanySalespeople: (company: any) => string[];
  formatCurrency: (amount: number) => string;
  rowIndex?: number; // For alternating row colors
}

const CompanyTableRow: React.FC<CompanyTableRowProps> = ({
  company,
  isFavorite,
  toggleFavorite,
  onRowClick,
  getAvatarColor,
  getAvatarTextColor,
  columns,
  getCompanyContacts,
  getCompanyDeals,
  getCompanyPipelineValue,
    getCompanySalespeople,
  formatCurrency,
  rowIndex = 0,
}) => {
  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(company.id);
  };

  const handleRowClick = () => {
    onRowClick(company);
  };

  const getInitials = (name: string) => {
    return (name || '?').charAt(0).toUpperCase();
  };

  const companyName = company.companyName || company.name || company.legalName || '-';
  const contacts = getCompanyContacts(company.id);
  const deals = getCompanyDeals(company.id);
  const pipeline = getCompanyPipelineValue(company);
  const salespeople = getCompanySalespeople(company);
  
  // Get headquarters city and state
  const headquartersCity = company.city || company.headquarters?.city || '';
  const headquartersState = company.state || company.headquarters?.state || '';
  const headquarters = headquartersCity && headquartersState 
    ? `${headquartersCity}, ${headquartersState}`
    : headquartersCity || headquartersState || '';

  return (
    <TableRow
      onClick={handleRowClick}
      hover
      sx={{
        cursor: 'pointer',
        bgcolor: rowIndex % 2 === 0 ? 'background.paper' : '#FAFAFA',
        transition: 'background-color 0.15s ease',
        '&:hover': {
          bgcolor: 'action.hover',
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: '-2px',
        },
      }}
    >
      {/* Favorites Column */}
      {columns.favorites && (
        <TableCell
          onClick={handleFavoriteClick}
          sx={{
            width: '60px',
            px: 1,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <FavoriteButton
              itemId={company.id}
              favoriteType="companies"
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              size="small"
              tooltipText={{
                favorited: 'Remove from favorites',
                notFavorited: 'Add to favorites',
              }}
            />
          </Box>
        </TableCell>
      )}

      {/* Avatar Column (no header label) */}
      {columns.avatar && (
        <TableCell
          sx={{
            width: '60px',
            px: 1,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
          align="center"
        >
          <Avatar
            src={company.logo || company.logoUrl || company.logo_url || company.avatar}
            sx={{
              width: TABLE_AVATAR_SIZE,
              height: TABLE_AVATAR_SIZE,
              backgroundColor: getAvatarColor(companyName),
              color: getAvatarTextColor(companyName),
              fontWeight: 600,
              fontSize: '12px',
              mx: 'auto',
            }}
          >
            {getInitials(companyName)}
          </Avatar>
        </TableCell>
      )}

      {/* Company Name Column */}
      {columns.companyName && (
        <TableCell
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {columns.avatar ? (
            <Typography
              variant="body2"
              fontWeight={600}
              color="text.primary"
              sx={{
                fontSize: '0.9375rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '340px',
              }}
              title={companyName}
            >
              {companyName}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar
                src={company.logo || company.logoUrl || company.logo_url || company.avatar}
                sx={{
                  width: TABLE_AVATAR_SIZE,
                  height: TABLE_AVATAR_SIZE,
                  backgroundColor: getAvatarColor(companyName),
                  color: getAvatarTextColor(companyName),
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                {getInitials(companyName)}
              </Avatar>
              <Typography
                variant="body2"
                fontWeight={600}
                color="text.primary"
                sx={{
                  fontSize: '0.9375rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '300px',
                }}
                title={companyName}
              >
                {companyName}
              </Typography>
            </Box>
          )}
        </TableCell>
      )}

      {/* Contacts Column */}
      {columns.contacts && (
        <TableCell
          sx={{
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon
              sx={{
                color: '#9CA3AF',
                fontSize: '16px',
              }}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontSize: '0.875rem' }}
            >
              {contacts.length}
            </Typography>
          </Box>
        </TableCell>
      )}

      {/* Deals Column */}
      {columns.deals && (
        <TableCell
          sx={{
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BusinessIcon
              sx={{
                color: '#9CA3AF',
                fontSize: '16px',
              }}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontSize: '0.875rem' }}
            >
              {deals.length}
            </Typography>
          </Box>
        </TableCell>
      )}

      {/* Pipeline Value Column */}
      {columns.pipelineValue && (
        <TableCell
          sx={{
            py: 1.5,
            textAlign: 'right',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {pipeline.dealCount === 0 ? (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ fontSize: '0.875rem' }}
            >
              -
            </Typography>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
                alignItems: 'flex-end',
              }}
            >
              <Typography
                variant="body2"
                fontWeight={500}
                color="text.primary"
                sx={{ fontSize: '0.8125rem' }}
              >
                {formatCurrency(pipeline.totalLow)} - {formatCurrency(pipeline.totalHigh)}
              </Typography>
              <Typography
                variant="caption"
                color="text.disabled"
                sx={{ fontSize: '0.6875rem' }}
              >
                {pipeline.dealCount} deal{pipeline.dealCount !== 1 ? 's' : ''}
              </Typography>
            </Box>
          )}
        </TableCell>
      )}

      {/* Headquarters Column */}
      {columns.headquarters && (
        <TableCell
          sx={{
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {headquarters ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontSize: '0.875rem' }}
            >
              {headquarters}
            </Typography>
          ) : (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ fontSize: '0.875rem' }}
            >
              -
            </Typography>
          )}
        </TableCell>
      )}

      {/* Salespeople Column */}
      {columns.salespeople && (
        <TableCell
          sx={{
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {salespeople.length === 0 ? (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{
                fontSize: '0.875rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '200px',
              }}
            >
              -
            </Typography>
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontSize: '0.875rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '200px',
              }}
              title={salespeople.join(', ')}
            >
              {salespeople.join(', ')}
            </Typography>
          )}
        </TableCell>
      )}
    </TableRow>
  );
};

export default CompanyTableRow;

