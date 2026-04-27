/**
 * Email Thread Skeleton Loader
 * 
 * Loading skeleton for email thread list items
 */

import React from 'react';
import { TableRow, TableCell, Skeleton, Box } from '@mui/material';

interface EmailThreadSkeletonProps {
  count?: number;
}

const EmailThreadSkeleton: React.FC<EmailThreadSkeletonProps> = ({ count = 5 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <TableRow key={`skeleton-${index}`} sx={{ height: '44px' }}>
          <TableCell padding="checkbox" sx={{ width: '32px', py: 0.25, px: 1 }}>
            <Skeleton variant="rectangular" width={18} height={18} />
          </TableCell>
          <TableCell sx={{ width: '56px', py: 1, px: 0 }}>
            <Skeleton variant="circular" width={32} height={32} />
          </TableCell>
          <TableCell sx={{ py: 1, px: 1.5, width: '200px' }}>
            <Skeleton variant="text" width="80%" height={16} />
            <Skeleton variant="text" width="60%" height={12} sx={{ mt: 0.5 }} />
          </TableCell>
          <TableCell sx={{ py: 1, px: 1.5, width: '400px' }}>
            <Skeleton variant="text" width="90%" height={16} />
            <Skeleton variant="text" width="70%" height={12} sx={{ mt: 0.5 }} />
          </TableCell>
          <TableCell sx={{ py: 1, px: 1.5, width: '120px' }}>
            <Skeleton variant="text" width="60%" height={14} />
          </TableCell>
          <TableCell sx={{ py: 1, px: 1.5, width: '120px' }}>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Skeleton variant="rectangular" width={24} height={24} />
              <Skeleton variant="rectangular" width={24} height={24} />
              <Skeleton variant="rectangular" width={24} height={24} />
            </Box>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
};

export default EmailThreadSkeleton;

