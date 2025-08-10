import React from 'react';
import { Box, Skeleton } from '@mui/material';

interface SkeletonLoaderProps {
  variant?: 'card' | 'list' | 'table' | 'form';
  lines?: number;
  height?: number;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'card',
  lines = 3,
  height = 20
}) => {
  const renderSkeleton = () => {
    switch (variant) {
      case 'card':
        return (
          <Box sx={{ p: 3, border: '1px solid rgba(0,0,0,.08)', borderRadius: 12 }}>
            <Skeleton variant="rectangular" height={24} sx={{ mb: 2, borderRadius: 1 }} />
            <Skeleton variant="text" width="60%" sx={{ mb: 1 }} />
            <Skeleton variant="text" width="40%" sx={{ mb: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Skeleton variant="rectangular" height={28} width={80} sx={{ borderRadius: 14 }} />
              <Skeleton variant="rectangular" height={28} width={100} sx={{ borderRadius: 14 }} />
            </Box>
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="80%" />
          </Box>
        );

      case 'list':
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from({ length: lines }).map((_, index) => (
              <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="70%" sx={{ mb: 0.5 }} />
                  <Skeleton variant="text" width="40%" />
                </Box>
                <Skeleton variant="rectangular" height={28} width={80} sx={{ borderRadius: 14 }} />
              </Box>
            ))}
          </Box>
        );

      case 'table':
        return (
          <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, pb: 1, borderBottom: '1px solid rgba(0,0,0,.06)' }}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} variant="text" width={120} height={16} />
              ))}
            </Box>
            {/* Rows */}
            {Array.from({ length: lines }).map((_, rowIndex) => (
              <Box key={rowIndex} sx={{ display: 'flex', gap: 2, py: 1 }}>
                {Array.from({ length: 4 }).map((_, colIndex) => (
                  <Skeleton key={colIndex} variant="text" width={120} height={20} />
                ))}
              </Box>
            ))}
          </Box>
        );

      case 'form':
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {Array.from({ length: lines }).map((_, index) => (
              <Box key={index}>
                <Skeleton variant="text" width={100} height={20} sx={{ mb: 1 }} />
                <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
              </Box>
            ))}
          </Box>
        );

      default:
        return null;
    }
  };

  return renderSkeleton();
};
