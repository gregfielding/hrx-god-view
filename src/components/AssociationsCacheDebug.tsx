import React from 'react';
import { Box, Typography, Chip, Paper } from '@mui/material';
import { useAssociationsCache } from '../contexts/AssociationsCacheContext';

interface AssociationsCacheDebugProps {
  entityKey?: string;
}

const AssociationsCacheDebug: React.FC<AssociationsCacheDebugProps> = ({ entityKey }) => {
  const { getCacheStats, getCacheAge, isCacheValid } = useAssociationsCache();
  const stats = getCacheStats();

  if (process.env.NODE_ENV !== 'development') {
    return null; // Only show in development
  }

  return (
    <Paper sx={{ p: 2, mb: 2, backgroundColor: '#f5f5f5' }}>
      <Typography variant="h6" gutterBottom>
        🗄️ Associations Cache Debug
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Chip 
          label={`Entries: ${stats.totalEntries}`} 
          size="small" 
          color="primary" 
          variant="outlined" 
        />
        <Chip 
          label={`Size: ${(stats.totalSize / 1024).toFixed(1)}KB`} 
          size="small" 
          color="secondary" 
          variant="outlined" 
        />
        {entityKey && (
          <Chip 
            label={isCacheValid(entityKey) ? '✅ Valid' : '❌ Invalid'} 
            size="small" 
            color={isCacheValid(entityKey) ? 'success' : 'error'} 
            variant="outlined" 
          />
        )}
        {entityKey && getCacheAge(entityKey) && (
          <Chip 
            label={`Age: ${(getCacheAge(entityKey)! / 1000).toFixed(1)}s`} 
            size="small" 
            color="info" 
            variant="outlined" 
          />
        )}
      </Box>
      
      {stats.oldestEntry && stats.newestEntry && (
        <Typography variant="caption" color="text.secondary">
          Cache range: {new Date(stats.oldestEntry).toLocaleTimeString()} - {new Date(stats.newestEntry).toLocaleTimeString()}
        </Typography>
      )}
    </Paper>
  );
};

export default AssociationsCacheDebug; 