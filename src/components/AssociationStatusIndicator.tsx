import React from 'react';
import { Box, Chip, Typography, Tooltip } from '@mui/material';
import { AssociationUtils } from '../utils/associationUtils';

interface AssociationStatusIndicatorProps {
  entity: any;
  userId: string;
  entityType: 'company' | 'deal' | 'contact';
  showDetails?: boolean;
}

const AssociationStatusIndicator: React.FC<AssociationStatusIndicatorProps> = ({ 
  entity, 
  userId, 
  entityType,
  showDetails = false 
}) => {
  const status = AssociationUtils.getAssociationStatus(entity, userId);
  
  if (!status.isAssociated && !status.hasActiveSalespeople) {
    return null; // Don't show anything if no associations
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {status.hasActiveSalespeople && (
        <Tooltip title={`Has ${Object.keys(entity.activeSalespeople || {}).length} active salespeople`}>
          <Chip 
            label="Active Salespeople" 
            size="small" 
            color={status.isUserActive ? "success" : "default"}
            variant="outlined"
            sx={{ 
              fontSize: '0.7rem',
              height: '20px',
              '& .MuiChip-label': {
                px: 1
              }
            }}
          />
        </Tooltip>
      )}
      
      {status.isAssociated && !status.isUserActive && (
        <Tooltip title={`Associated via: ${status.associationSources.join(', ')}`}>
          <Chip 
            label="Associated" 
            size="small" 
            color="primary"
            variant="outlined"
            sx={{ 
              fontSize: '0.7rem',
              height: '20px',
              '& .MuiChip-label': {
                px: 1
              }
            }}
          />
        </Tooltip>
      )}
      
      {showDetails && status.lastUpdated && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          Updated: {status.lastUpdated.toDate?.()?.toLocaleDateString() || 'Unknown'}
        </Typography>
      )}
      
      {showDetails && status.associationSources.length > 0 && (
        <Tooltip title={`Association sources: ${status.associationSources.join(', ')}`}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
            ({status.associationSources.length} source{status.associationSources.length !== 1 ? 's' : ''})
          </Typography>
        </Tooltip>
      )}
    </Box>
  );
};

export default AssociationStatusIndicator;
