import React from 'react';
import { Box, CircularProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import StandardTablePagination from '../StandardTablePagination';

export interface OnboardingQueueTableShellProps {
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  colCount: number;
  /** Header row cells */
  head: React.ReactNode;
  /** Body rows */
  children: React.ReactNode;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/**
 * Full-width queue table: sticky header, horizontal scroll, inbox-style pagination.
 * Matches RecruiterUsers table container treatment.
 */
const OnboardingQueueTableShell: React.FC<OnboardingQueueTableShellProps> = ({
  loading,
  error,
  emptyMessage,
  colCount,
  head,
  children,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) => {
  const paginatedEmpty = !loading && !error && totalCount === 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minHeight: 360,
        flex: 1,
      }}
    >
      {error ? (
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>
          {error}
        </Typography>
      ) : null}

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: '1px solid #EAEEF4',
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'auto',
          width: '100%',
          px: 2,
          '&::-webkit-scrollbar': { width: '8px', height: '8px' },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Table size="small" stickyHeader sx={{ width: '100%', minWidth: 720 }}>
          <TableHead
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: 'background.paper',
              '& .MuiTableCell-root': { borderRadius: 0, bgcolor: 'background.paper' },
            }}
          >
            <TableRow>{head}</TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colCount} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : paginatedEmpty ? (
              <TableRow>
                <TableCell colSpan={colCount} sx={{ py: 5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              children
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <StandardTablePagination
        count={totalCount}
        page={page}
        onPageChange={(_, p) => onPageChange(p)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => {
          onPageSizeChange(parseInt(e.target.value, 10));
          onPageChange(0);
        }}
        sx={{ mt: 0 }}
      />
    </Box>
  );
};

export default OnboardingQueueTableShell;
