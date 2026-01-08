import React from 'react';
import {
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  TableSortLabel,
  Skeleton,
  Box,
  Typography,
  Button,
  CircularProgress,
} from '@mui/material';
import CompanyTableRow from './CompanyTableRow';
import StandardTablePagination from './StandardTablePagination';

interface CompanyTableProps {
  companies: any[];
  loading: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Optional: pixels to offset the sticky table header from the top (e.g., height of a sticky filter row above). */
  stickyHeaderOffset?: number;
  /** Optional: when true, do not make the TableContainer the scroll container (let a parent handle scrolling). */
  useOuterScroll?: boolean;
  /** Optional: when true, render the container without rounded corners (square top edge). */
  square?: boolean;
  pagination?: {
    count: number;
    page: number;
    rowsPerPage: number;
    onPageChange: (event: React.MouseEvent<HTMLButtonElement> | null, page: number) => void;
    onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  };
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
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  onRowClick: (company: any) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => string[];
  getAvatarColor: (name: string) => string;
  getAvatarTextColor: (name: string) => string;
  getCompanyContacts: (companyId: string) => any[];
  getCompanyDeals: (companyId: string) => any[];
  getCompanyPipelineValue: (company: any) => { totalLow: number; totalHigh: number; dealCount: number };
  getCompanySalespeople: (company: any) => string[];
  formatCurrency: (amount: number) => string;
  emptyStateMessage?: string;
  emptyStateAction?: React.ReactNode;
}

const CompanyTable: React.FC<CompanyTableProps> = ({
  companies,
  loading,
  hasMore = false,
  onLoadMore,
  stickyHeaderOffset = 0,
  useOuterScroll = false,
  square = false,
  pagination,
  columns,
  sortField,
  sortDirection,
  onSort,
  onRowClick,
  isFavorite,
  toggleFavorite,
  getAvatarColor,
  getAvatarTextColor,
  getCompanyContacts,
  getCompanyDeals,
        getCompanyPipelineValue,
        getCompanySalespeople,
  formatCurrency,
  emptyStateMessage = 'No companies found',
  emptyStateAction,
}) => {
  // Standardized column widths
  const getColumnWidth = (columnKey: string): number | string | undefined => {
    const widths: { [key: string]: number } = {
      favorites: 60,
      avatar: 60,
      companyName: 250,
      contacts: 100,
      deals: 100,
      pipelineValue: 180,
      headquarters: 180,
      salespeople: 200,
    };
    return widths[columnKey];
  };

  const renderHeaderCell = (
    label: string,
    field?: string,
    columnKey?: string,
    align: 'left' | 'right' | 'center' = 'left'
  ) => {
    const width = columnKey ? getColumnWidth(columnKey) : undefined;
    const cellContent = field && onSort ? (
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDirection : 'asc'}
        onClick={() => onSort(field)}
        sx={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          '& .MuiTableSortLabel-icon': {
            fontSize: '1rem',
            opacity: sortField === field ? 1 : 0.3,
          },
        }}
      >
        {label}
      </TableSortLabel>
    ) : (
      <Typography
        variant="caption"
        sx={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </Typography>
    );

    return (
      <TableCell
        align={align}
        sx={{
          ...(width && { width, minWidth: width, ...(columnKey === 'favorites' && { maxWidth: width }) }),
          // Sticky header cells (outer-scroll friendly)
          position: 'sticky',
          top: stickyHeaderOffset,
          zIndex: 12,
          bgcolor: '#FFFFFF',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          py: 1.75,
          ...(columnKey === 'favorites' && { px: 1 }),
          ...(columnKey === 'avatar' && { px: 1 }),
          ...(columnKey === 'companyName' && { pl: 2 }),
        }}
      >
        {cellContent}
      </TableCell>
    );
  };

  return (
    <>
      <TableContainer
        component={Paper}
        sx={{
          borderRadius: square ? 0 : 2,
          border: '1px solid #EAEEF4',
          borderTop: square ? 'none' : '1px solid #EAEEF4',
          boxShadow: 'none',
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: useOuterScroll ? 'visible' : 'auto',
          overflowX: useOuterScroll ? 'visible' : 'auto',
          width: '100%',
          // Scrollbar styling per Inbox Standard
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
        <Table size="small" stickyHeader sx={{ width: '100%' }}>
          <TableHead
            sx={{
              backgroundColor: '#FFFFFF',
            }}
          >
            <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
              {columns.favorites && renderHeaderCell('', undefined, 'favorites')}
              {columns.avatar && renderHeaderCell('', undefined, 'avatar', 'center')}
              {columns.companyName && renderHeaderCell('Company Name', 'companyName', 'companyName')}
              {columns.contacts && renderHeaderCell('Contacts', undefined, 'contacts')}
              {columns.deals && renderHeaderCell('Deals', undefined, 'deals')}
              {columns.pipelineValue && renderHeaderCell('Pipeline Value', undefined, 'pipelineValue', 'right')}
              {columns.headquarters && renderHeaderCell('Headquarters', undefined, 'headquarters')}
              {columns.salespeople && renderHeaderCell('Salespeople', undefined, 'salespeople')}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && companies.length === 0 ? (
              // Skeleton loader rows
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow
                  key={`skeleton-${index}`}
                  sx={{
                    bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                  }}
                >
                  {columns.favorites && (
                    <TableCell sx={{ py: 1.5, px: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Skeleton variant="circular" width={20} height={20} />
                      </Box>
                    </TableCell>
                  )}
                  {columns.avatar && (
                    <TableCell sx={{ py: 1.5, px: 1, borderBottom: '1px solid', borderColor: 'divider' }} align="center">
                      <Skeleton variant="circular" width={32} height={32} sx={{ mx: 'auto' }} />
                    </TableCell>
                  )}
                  {columns.companyName && (
                    <TableCell sx={{ py: 1.5, px: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                      {columns.avatar ? (
                        <Skeleton variant="text" width={180} height={20} />
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Skeleton variant="circular" width={32} height={32} />
                          <Skeleton variant="text" width={150} height={20} />
                        </Box>
                      )}
                    </TableCell>
                  )}
                  {columns.contacts && (
                    <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Skeleton variant="text" width={40} height={20} />
                    </TableCell>
                  )}
                  {columns.deals && (
                    <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Skeleton variant="text" width={40} height={20} />
                    </TableCell>
                  )}
                  {columns.pipelineValue && (
                    <TableCell align="right" sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Skeleton variant="text" width={100} height={20} />
                    </TableCell>
                  )}
                  {columns.headquarters && (
                    <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Skeleton variant="text" width={120} height={20} />
                    </TableCell>
                  )}
                  {columns.salespeople && (
                    <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Skeleton variant="text" width={120} height={20} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              // Actual company rows
              companies.map((company, index) => (
                <CompanyTableRow
                  key={company.id}
                  company={company}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  onRowClick={onRowClick}
                  getAvatarColor={getAvatarColor}
                  getAvatarTextColor={getAvatarTextColor}
                  columns={columns}
                  getCompanyContacts={getCompanyContacts}
                  getCompanyDeals={getCompanyDeals}
                  getCompanyPipelineValue={getCompanyPipelineValue}
                  getCompanySalespeople={getCompanySalespeople}
                  formatCurrency={formatCurrency}
                  rowIndex={index}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Inbox-standard pagination footer (when enabled by parent) */}
      {pagination && (
        <StandardTablePagination
          count={pagination.count}
          page={pagination.page}
          onPageChange={pagination.onPageChange}
          rowsPerPage={pagination.rowsPerPage}
          onRowsPerPageChange={pagination.onRowsPerPageChange}
        />
      )}

      {/* Legacy Load More Controls (used by TenantCRM) */}
      {!pagination && hasMore !== undefined && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, gap: 2 }}>
          {loading && companies.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Loading companies...
              </Typography>
            </Box>
          )}
          {hasMore && !loading && onLoadMore && (
            <Button
              variant="outlined"
              onClick={onLoadMore}
              disabled={loading}
              sx={{
                borderRadius: 1,
                textTransform: 'none',
                fontWeight: 500,
                borderColor: 'divider',
                color: 'text.secondary',
                '&:hover': {
                  borderColor: 'action.hover',
                  backgroundColor: 'action.hover',
                },
              }}
            >
              Load More Companies
            </Button>
          )}
          {!hasMore && companies.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              All companies loaded ({companies.length} total)
            </Typography>
          )}
        </Box>
      )}

      {/* Empty State */}
      {!loading && companies.length === 0 && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 8,
            textAlign: 'center',
          }}
        >
          {emptyStateAction || (
            <>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
                {emptyStateMessage}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                No companies match your search criteria
              </Typography>
            </>
          )}
        </Box>
      )}
    </>
  );
};

export default CompanyTable;

