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
  Checkbox,
} from '@mui/material';
import StandardTablePagination from './StandardTablePagination';

interface ContactTableProps {
  contacts: any[];
  loading: boolean;
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
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  renderRow: (contact: any, index: number) => React.ReactNode;
  pagination?: {
    count: number;
    page: number;
    rowsPerPage: number;
    onPageChange: (event: React.MouseEvent<HTMLButtonElement> | null, page: number) => void;
    onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  };
  /** Optional: pixels to offset the sticky table header from the top (e.g., height of a sticky filter row above). */
  stickyHeaderOffset?: number;
  /** Optional: when true, do not make the TableContainer the scroll container (let a parent handle scrolling). */
  useOuterScroll?: boolean;
  /** Optional: when true, render the container without rounded corners (square top edge). */
  square?: boolean;
  /** Selection support (Inbox standard) */
  selectedContactIds?: Set<string>;
  onSelectContact?: (contactId: string) => void;
  onSelectAll?: () => void;
}

const ContactTable: React.FC<ContactTableProps> = ({
  contacts,
  loading,
  columns,
  sortField,
  sortDirection,
  onSort,
  renderRow,
  pagination,
  stickyHeaderOffset = 0,
  useOuterScroll = false,
  square = false,
  selectedContactIds = new Set(),
  onSelectContact,
  onSelectAll,
}) => {
  // Standardized column widths
  const getColumnWidth = (columnKey: string): number | string | undefined => {
    const widths: { [key: string]: number } = {
      favorites: 60,
      name: 220,
      jobTitle: 150,
      role: 130,
      contactInfo: 220,
      company: 180,
      location: 150,
      lastActivity: 150,
    };
    return widths[columnKey];
  };

  const renderHeaderCell = (
    label: string,
    field?: string,
    columnKey?: string
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
            opacity: sortField === field ? 1 : 0.3
          }
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
          letterSpacing: '0.05em'
        }}
      >
        {label}
      </Typography>
    );

    return (
      <TableCell 
        sx={{ 
          ...(width && { width, minWidth: width, ...(columnKey === 'favorites' && { maxWidth: width }) }),
          // Make header cells sticky relative to the outer scroll container (CRM uses outer scroll, not TableContainer scroll)
          position: 'sticky',
          top: stickyHeaderOffset,
          zIndex: 12,
          // Inbox-standard table header styling
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'rgba(0, 0, 0, 0.85)',
          height: '32px',
          bgcolor: 'background.paper',
          ...(columnKey === 'favorites' && {
            width: '56px',
            minWidth: '56px',
            maxWidth: '56px',
            padding: '4px 12px',
            position: 'sticky',
            top: stickyHeaderOffset,
            left: 0,
            zIndex: 13, // keep above other sticky header cells
            bgcolor: 'background.paper',
          }),
          ...(columnKey === 'name' && { pl: 2 })
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
        elevation={0}
        sx={{
          borderRadius: square ? 0 : 2, // Square corners when used under sticky filter row
          border: '1px solid #EAEEF4',
          borderTop: square ? 'none' : '1px solid #EAEEF4', // Remove top border when square to connect with filter row
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: useOuterScroll ? 'visible' : 'auto',
          overflowX: 'auto', // Always allow horizontal scrolling when table is wider than viewport
          width: '100%',
          px: 2, // 16px left and right padding
          mt: 0, // Ensure no top margin
          pt: 0, // Ensure no top padding
          marginTop: 0, // Explicitly set to 0
          paddingTop: 0, // Explicitly set to 0
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
        <Table size="small" stickyHeader sx={{ minWidth: 1200, width: '100%' }}>
          <TableHead
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: 0,
              '& .MuiTableCell-root': {
                borderRadius: 0,
              },
            }}
          >
            <TableRow sx={{ height: '32px', backgroundColor: 'background.paper', borderRadius: 0 }}>
              {onSelectAll && (
                <TableCell
                  padding="checkbox"
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 13,
                    bgcolor: 'background.paper',
                    width: '48px',
                    minWidth: '48px',
                    maxWidth: '48px',
                    borderRadius: 0,
                  }}
                >
                  <Checkbox
                    indeterminate={
                      selectedContactIds.size > 0 &&
                      selectedContactIds.size < contacts.length
                    }
                    checked={
                      contacts.length > 0 &&
                      contacts.every(c => selectedContactIds.has(c.id))
                    }
                    onChange={onSelectAll}
                    size="small"
                  />
                </TableCell>
              )}
              {columns.favorites && renderHeaderCell('', undefined, 'favorites')}
              {columns.name && renderHeaderCell('Contact Name', 'fullName', 'name')}
              {(columns.jobTitle || columns.title) && renderHeaderCell('Job Title', 'jobTitle', 'jobTitle')}
              {columns.role && renderHeaderCell('Role', undefined, 'role')}
              {columns.contactInfo && renderHeaderCell('Contact Info', undefined, 'contactInfo')}
              {columns.company && renderHeaderCell('Company', 'companyName', 'company')}
              {columns.location && renderHeaderCell('Location', undefined, 'location')}
              {columns.lastActivity && renderHeaderCell('Last Activity', 'lastActivity', 'lastActivity')}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading || contacts.length === 0 ? (
              // Skeleton loader rows
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow
                  key={`skeleton-${index}`}
                  sx={{
                    height: '36px',
                    bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                    '& td': {
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    },
                  }}
                >
                  {onSelectAll && (
                    <TableCell padding="checkbox" sx={{ width: '48px', minWidth: '48px', maxWidth: '48px' }}>
                      <Skeleton variant="rectangular" width={20} height={20} sx={{ borderRadius: 1 }} />
                    </TableCell>
                  )}
                  {columns.favorites && (
                    <TableCell sx={{ width: 60, minWidth: 60, maxWidth: 60, px: 1, py: 0.75 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <Skeleton variant="circular" width={24} height={24} />
                      </Box>
                    </TableCell>
                  )}
                  {columns.name && (
                    <TableCell sx={{ pl: 2, pr: 2, py: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="text" width={140} height={20} />
                      </Box>
                    </TableCell>
                  )}
                  {(columns.jobTitle || columns.title) && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Skeleton variant="text" width={100} height={20} />
                    </TableCell>
                  )}
                  {columns.role && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 1 }} />
                    </TableCell>
                  )}
                  {columns.contactInfo && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Skeleton variant="text" width={140} height={16} />
                        <Skeleton variant="text" width={100} height={16} />
                      </Box>
                    </TableCell>
                  )}
                  {columns.company && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Skeleton variant="text" width={120} height={20} />
                    </TableCell>
                  )}
                  {columns.location && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Skeleton variant="text" width={100} height={20} />
                    </TableCell>
                  )}
                  {columns.lastActivity && (
                    <TableCell sx={{ px: 1.5, py: 0.75 }}>
                      <Skeleton variant="text" width={90} height={20} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              contacts.map((contact, index) => renderRow(contact, index))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pagination && (
        <StandardTablePagination
          count={pagination.count}
          page={pagination.page}
          onPageChange={pagination.onPageChange}
          rowsPerPage={pagination.rowsPerPage}
          onRowsPerPageChange={pagination.onRowsPerPageChange}
        />
      )}
    </>
  );
};

export default ContactTable;

