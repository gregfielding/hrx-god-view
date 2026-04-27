/**
 * Slack Channels Skeleton Component
 * 
 * Loading skeleton for Slack channels table/list.
 */

import React from 'react';
import { Box, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { useMediaQuery, useTheme } from '@mui/material';

const SlackChannelsSkeleton: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  if (isMobile) {
    return (
      <Box>
        {[1, 2, 3, 4, 5].map((i) => (
          <Box key={i} sx={{ mb: 2 }}>
            <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell><Skeleton width={100} /></TableCell>
            <TableCell><Skeleton width={200} /></TableCell>
            <TableCell><Skeleton width={150} /></TableCell>
            <TableCell><Skeleton width={100} /></TableCell>
            <TableCell align="right"><Skeleton width={120} /></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <TableRow key={i}>
              <TableCell><Skeleton width={150} /></TableCell>
              <TableCell><Skeleton width={250} /></TableCell>
              <TableCell><Skeleton width={120} /></TableCell>
              <TableCell><Skeleton width={80} /></TableCell>
              <TableCell align="right"><Skeleton width={100} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default SlackChannelsSkeleton;

